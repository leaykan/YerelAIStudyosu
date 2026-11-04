const http = require("http");
const https = require("https");
// Callback-style dns module, looked up at call time (dnsModule.lookup) so the
// connection-pinning lookup below always uses the current implementation.
const dnsModule = require("dns");
const net = require("net");
const zlib = require("zlib");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LocalAIStudio/1.0";
const MAX_REDIRECTS = 3;
// Hard ceiling for decompressed bodies (decompression-bomb protection).
const MAX_DECODED_BYTES = 8 * 1024 * 1024;

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function isPrivateIpv4(ip) {
  const raw = String(ip || "");
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return true;
  const parts = raw.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 ||                                  // 0.0.0.0/8 "this network"
    a === 10 ||                                      // 10.0.0.0/8 private
    (a === 100 && b >= 64 && b <= 127) ||            // 100.64.0.0/10 CGNAT
    a === 127 ||                                     // 127.0.0.0/8 loopback
    (a === 169 && b === 254) ||                      // 169.254.0.0/16 link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||             // 172.16.0.0/12 private
    (a === 192 && b === 0 && c === 0) ||             // 192.0.0.0/24 IETF protocol assignments
    (a === 192 && b === 0 && c === 2) ||             // 192.0.2.0/24 TEST-NET-1
    (a === 192 && b === 88 && c === 99) ||           // 192.88.99.0/24 6to4 relay anycast
    (a === 192 && b === 168) ||                      // 192.168.0.0/16 private
    (a === 198 && (b === 18 || b === 19)) ||         // 198.18.0.0/15 benchmarking
    (a === 198 && b === 51 && c === 100) ||          // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||           // 203.0.113.0/24 TEST-NET-3
    a >= 224;                                        // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, broadcast
}

// Parses an IPv6 address into eight 16-bit groups; returns null if invalid.
function parseIpv6(ip) {
  let value = String(ip || "").toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  if (net.isIP(value) !== 6) return null;
  const lastColon = value.lastIndexOf(":");
  const last = value.slice(lastColon + 1);
  if (last.includes(".")) {
    const p = last.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    value = `${value.slice(0, lastColon + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill("0"), ...tail]
    .map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function embeddedIpv4(hi, lo) {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateIpv6(ip) {
  const g = parseIpv6(ip);
  if (!g) return true;
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  // ::ffff:a.b.c.d IPv4-mapped -> classify the embedded IPv4 address
  if (zeros(0, 5) && g[5] === 0xffff) return isPrivateIpv4(embeddedIpv4(g[6], g[7]));
  // ::/96 covers :: (unspecified), ::1 (loopback) and deprecated IPv4-compatible
  if (zeros(0, 6)) return true;
  // 64:ff9b::/96 NAT64 well-known prefix -> classify the embedded IPv4 address
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isPrivateIpv4(embeddedIpv4(g[6], g[7]));
  // 64:ff9b:1::/48 local-use NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;
  // Anything outside 2000::/3 global unicast: fc00::/7 ULA, fe80::/10 link-local,
  // fec0::/10 site-local, ff00::/8 multicast, 100::/64 discard, etc.
  if ((g[0] & 0xe000) !== 0x2000) return true;
  // 2001::/23 IETF special-purpose (Teredo, benchmarking, ORCHID)
  if (g[0] === 0x2001 && g[1] < 0x0200) return true;
  // 2001:db8::/32 documentation
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  // 3fff::/20 documentation (RFC 9637)
  if (g[0] === 0x3fff && g[1] < 0x1000) return true;
  // 2002::/16 6to4 -> classify the embedded IPv4 address
  if (g[0] === 0x2002) return isPrivateIpv4(embeddedIpv4(g[1], g[2]));
  return false;
}

function isPrivateIp(ip) {
  const value = String(ip || "").replace(/^\[|\]$/g, "");
  const family = net.isIP(value);
  if (family === 4) return isPrivateIpv4(value);
  if (family === 6) return isPrivateIpv6(value);
  return true;
}

function blockedAddressError() {
  const err = new Error("Private network addresses are blocked.");
  err.code = "ERR_PRIVATE_ADDRESS_BLOCKED";
  return err;
}

// Custom `lookup` for http(s).get: resolves ALL addresses, rejects if ANY is
// non-public, and hands only validated addresses to the socket. Because the
// socket connects to exactly what was validated here, there is no
// check-then-connect gap for DNS rebinding. Supports both the single-address
// and the `all: true` (autoSelectFamily) callback shapes used by net.connect.
function pinnedLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const opts = typeof options === "number" ? { family: options } : (options || {});
  dnsModule.lookup(hostname, { all: true, verbatim: true }, (err, records) => {
    if (err) return callback(err);
    const list = Array.isArray(records) ? records : [];
    if (!list.length || list.some((record) => !record || isPrivateIp(record.address))) {
      return callback(blockedAddressError());
    }
    const wanted = opts.family === 4 || opts.family === 6 ? opts.family : 0;
    const usable = wanted ? list.filter((record) => record.family === wanted) : list;
    if (!usable.length) {
      const notFound = new Error(`No IPv${wanted} address found for ${hostname}.`);
      notFound.code = "ENOTFOUND";
      return callback(notFound);
    }
    if (opts.all) return callback(null, usable.map(({ address, family }) => ({ address, family })));
    return callback(null, usable[0].address, usable[0].family);
  });
}

// Synchronous URL validation. DNS-based validation happens in pinnedLookup at
// connect time (for every hop, since each redirect re-enters fetchPageContent).
function assertPublicUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Invalid URL provided.");
  }
  // Mitigate CVE-2026-105482: NUL byte truncation / control char bypass
  if (rawUrl.includes("\0") || /[\u0000-\u001f\u007f]/.test(rawUrl)) {
    throw new Error("URL contains illegal characters.");
  }
  const parsed = new URL(rawUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs can be fetched.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are blocked.");
  }
  // Normalize unicode hostname (NFKC) and mitigate CVE-2026-105483
  const host = parsed.hostname.normalize("NFKC").toLowerCase().replace(/\.+$/, "");
  const bareHost = host.replace(/^\[|\]$/g, "");
  if (!bareHost) {
    throw new Error("Invalid URL provided.");
  }
  if (bareHost === "localhost" || bareHost.endsWith(".localhost") || bareHost.endsWith(".local") || bareHost.endsWith(".internal")) {
    throw new Error("Localhost and internal network URLs are blocked.");
  }
  // Literal IPs never go through `lookup`, so they must be checked here.
  if (net.isIP(bareHost) && isPrivateIp(bareHost)) {
    throw new Error("Private network URLs are blocked.");
  }
  return parsed;
}

// Yalnızca ASCII harfleri küçültür: uzunluk değişmez (toLowerCase "İ" harfini iki karaktere çevirip indeksleri kaydırır)
const asciiKucuk = (s) => s.replace(/[A-Z]+/g, (h) => h.toLowerCase());

// "<etiket ...> ... </etiket>" bloklarını doğrusal sürede siler (kapanmayan blok olduğu gibi kalır; eski davranışla aynı)
function bloklariSil(html, etiket) {
  const kucuk = asciiKucuk(html);
  const ac = "<" + etiket;
  const kapa = "</" + etiket;
  let cikti = "";
  let i = 0;
  let aramaBas = 0;
  while (i < html.length) {
    const b = kucuk.indexOf(ac, aramaBas);
    if (b < 0) break;
    const k = kucuk.indexOf(kapa, b + ac.length);
    if (k < 0) break; // bundan sonra kapanış yok: geri kalan hiçbir açılış eşleşmez
    const kSon = kucuk.indexOf(">", k + kapa.length);
    if (kSon < 0) break;
    cikti += html.slice(i, b) + " ";
    i = kSon + 1;
    aramaBas = i;
  }
  return cikti + html.slice(i);
}

// İlk "<etiket ...>" ile ardından gelen ilk "</etiket" arasını döndürür; yoksa null (doğrusal)
function icerikAl(html, etiket) {
  const kucuk = asciiKucuk(html);
  const ac = "<" + etiket;
  let b = kucuk.indexOf(ac);
  while (b >= 0) {
    const sonraki = kucuk.charCodeAt(b + ac.length);
    if (sonraki === 62 || sonraki === 47 || sonraki <= 32) break; // ">", "/", boşluk: gerçekten bu etiket
    b = kucuk.indexOf(ac, b + ac.length);
  }
  if (b < 0) return null;
  const acSon = kucuk.indexOf(">", b);
  if (acSon < 0) return null;
  const k = kucuk.indexOf("</" + etiket, acSon + 1);
  if (k < 0) return null;
  return html.slice(acSon + 1, k);
}

function stripHtml(html) {
  // Çok büyük sayfalar kısaltılır (asistana zaten ~1-2 bin karakter gider)
  let withoutNoise = String(html || "").slice(0, 1024 * 1024);
  for (const etiket of ["script", "style", "noscript", "svg", "nav", "footer", "header"]) withoutNoise = bloklariSil(withoutNoise, etiket);
  const title = decodeHtml((icerikAl(withoutNoise, "title") || "").replace(/\s+/g, " ").trim());
  const mainIcerik = icerikAl(withoutNoise, "main") ?? icerikAl(withoutNoise, "article") ?? icerikAl(withoutNoise, "body");
  const contentHtml = mainIcerik !== null ? mainIcerik : withoutNoise;
  const text = decodeHtml(contentHtml
    .replace(/<\/(p|div|section|article|main|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^<>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
  return { title, text };
}

function isOutputTooLarge(err) {
  return Boolean(err) && (err.code === "ERR_BUFFER_TOO_LARGE" || err instanceof RangeError);
}

// maxOutputLength caps the decompressed size; a body that would inflate past
// it (decompression bomb) is treated as empty text instead of being decoded.
function decodeBody(buffer, encoding, maxOutputLength = MAX_DECODED_BYTES) {
  const value = String(encoding || "").toLowerCase();
  const limit = Math.max(1, Math.min(MAX_DECODED_BYTES, Number(maxOutputLength) || MAX_DECODED_BYTES));
  if (value.includes("gzip")) {
    try {
      return zlib.gunzipSync(buffer, { maxOutputLength: limit }).toString("utf8");
    } catch (err) {
      if (isOutputTooLarge(err)) {
        console.warn("  [search] Decompressed body exceeds limit; ignoring content.");
        return "";
      }
    }
  }
  if (value.includes("deflate")) {
    try {
      return zlib.inflateSync(buffer, { maxOutputLength: limit }).toString("utf8");
    } catch (err) {
      if (isOutputTooLarge(err)) {
        console.warn("  [search] Decompressed body exceeds limit; ignoring content.");
        return "";
      }
    }
  }
  if (value.includes("br")) {
    try {
      return zlib.brotliDecompressSync(buffer, { maxOutputLength: limit }).toString("utf8");
    } catch (err) {
      if (isOutputTooLarge(err)) {
        console.warn("  [search] Decompressed body exceeds limit; ignoring content.");
        return "";
      }
      console.warn("  [search] Brotli decompression fallback:", err.message);
    }
  }
  return buffer.toString("utf8");
}

async function fetchPageContent(rawUrl, options = {}, redirects = 0) {
  const parsed = assertPublicUrl(rawUrl);
  const timeoutMs = Math.max(3000, Math.min(20000, Number(options.timeoutMs) || 10000));
  const maxBytes = Math.max(64 * 1024, Math.min(2 * 1024 * 1024, Number(options.maxBytes) || 768 * 1024));
  const maxDecodedBytes = Math.min(MAX_DECODED_BYTES, maxBytes * 4);
  const transport = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.get(parsed, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.2",
        "Accept-Encoding": "gzip, deflate, br;q=0.8",
      },
      timeout: timeoutMs,
      lookup: pinnedLookup,
    }, async (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < MAX_REDIRECTS) {
        res.resume();
        try {
          const nextUrl = new URL(res.headers.location, parsed).toString();
          // Re-enters fetchPageContent: scheme/credential/literal-IP checks and
          // the pinned DNS lookup are applied again to this hop.
          resolve(await fetchPageContent(nextUrl, options, redirects + 1));
        } catch (err) {
          reject(err);
        }
        return;
      }
      const contentType = String(res.headers["content-type"] || "").toLowerCase();
      if (res.statusCode < 200 || res.statusCode >= 300 || (!contentType.includes("text/") && !contentType.includes("html") && !contentType.includes("xml"))) {
        res.resume();
        reject(new Error(`Page returned HTTP ${res.statusCode || "unknown"} or unsupported content type.`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          req.destroy(new Error("Page content is too large."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        try {
          const html = decodeBody(Buffer.concat(chunks), res.headers["content-encoding"], maxDecodedBytes);
          resolve(stripHtml(html));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Page fetch timed out.")));
    req.on("error", reject);
  });
}

module.exports = {
  fetchPageContent,
};

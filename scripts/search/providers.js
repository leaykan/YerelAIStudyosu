const https = require("https");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LocalAIStudio/1.0";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function requestText(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(requestText(new URL(res.headers.location, url).toString(), timeoutMs));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Search provider returned HTTP ${res.statusCode}`));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 2_000_000) req.destroy(new Error("Search response too large."));
      });
      res.on("end", () => resolve(body));
    });
    req.on("timeout", () => req.destroy(new Error("Search provider timed out.")));
    req.on("error", reject);
  });
}

function extractDuckDuckGoUrl(rawHref) {
  const href = decodeHtml(rawHref);
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch (_) {}
  return "";
}

function parseDuckDuckGoHtml(html, limit) {
  const results = [];
  const resultRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)?/gi;
  let match;
  while ((match = resultRegex.exec(html)) && results.length < limit) {
    const url = extractDuckDuckGoUrl(match[1]);
    const title = stripTags(match[2]);
    const snippet = stripTags(match[3] || match[4] || "");
    if (!url || !title || results.some((item) => item.url === url)) continue;
    results.push({ title, url, snippet, provider: "duckduckgo" });
  }
  return results;
}

function normalizeTimeFilter(timeFilter) {
  const value = String(timeFilter || "any").toLowerCase();
  if (value === "day") return "d";
  if (value === "week") return "w";
  if (value === "month") return "m";
  if (value === "year") return "y";
  return "";
}

// Bölge: "tr" -> Türkiye/Türkçe, "en" -> ABD/İngilizce, "all" -> bölgesiz.
// Vega aracı çağırırken dili kendisi seçer; seçmezse sorgudaki Türkçe harflere bakılır.
function bolgeSec(query, dil) {
  const d = String(dil || "").toLowerCase();
  if (d === "tr") return "tr";
  if (d === "en") return "en";
  if (d === "all" || d === "hepsi") return "all";
  return /[çğıöşüÇĞİÖŞÜ]/.test(String(query || "")) ? "tr" : "all";
}

async function searchDuckDuckGo(query, options = {}) {
  const limit = Math.max(1, Math.min(10, Number(options.limit) || 5));
  const bolge = bolgeSec(query, options.dil);
  const params = new URLSearchParams({
    q: String(query || "").trim(),
    kl: bolge === "tr" ? "tr-tr" : bolge === "en" ? "us-en" : "wt-wt",
  });
  const df = normalizeTimeFilter(options.timeFilter);
  if (df) params.set("df", df);
  const html = await requestText(`https://html.duckduckgo.com/html/?${params.toString()}`);
  return parseDuckDuckGoHtml(html, limit);
}

// Google Haberler RSS: anahtar gerektirmez, güncel ve Türkçe haber başlıkları verir.
// Bağlantılar Google yönlendirmesi olduğu için sayfa içeriği okunmaz; başlık, kaynak ve tarih kullanılır.
async function searchGoogleNews(query, options = {}) {
  const limit = Math.max(1, Math.min(15, Number(options.limit) || 8));
  const bolge = bolgeSec(query, options.dil);
  const zaman = { day: "1d", week: "7d", month: "30d", year: "1y" }[String(options.timeFilter || "").toLowerCase()];
  const q = String(query || "").trim() + (zaman ? ` when:${zaman}` : "");
  const yerel = bolge === "en" ? { hl: "en-US", gl: "US", ceid: "US:en" } : { hl: "tr", gl: "TR", ceid: "TR:tr" };
  const params = new URLSearchParams({ q, ...yerel });
  const xml = await requestText(`https://news.google.com/rss/search?${params.toString()}`);
  const results = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) && results.length < limit) {
    const parca = m[1];
    const al = (etiket) => {
      const e = parca.match(new RegExp(`<${etiket}[^>]*>([\\s\\S]*?)<\\/${etiket}>`, "i"));
      return e ? decodeHtml(e[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim() : "";
    };
    const baslik = stripTags(al("title"));
    const link = al("link");
    const kaynak = stripTags(al("source"));
    const tarih = al("pubDate");
    if (!baslik || !link) continue;
    let tarihMetni = "";
    try { tarihMetni = new Date(tarih).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" }); } catch (_) {}
    results.push({
      title: baslik,
      url: link,
      snippet: [kaynak, tarihMetni].filter(Boolean).join(" · "),
      provider: "google-news",
      fetchable: false,
    });
  }
  return results;
}

// tur: "haber" -> Google Haberler + DuckDuckGo birlikte; diğer -> yalnızca DuckDuckGo
async function webSearch(query, options = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];
  if (String(options.tur || "").toLowerCase() === "haber") {
    const [haberler, genel] = await Promise.allSettled([
      searchGoogleNews(trimmed, { ...options, limit: 8 }),
      searchDuckDuckGo(trimmed, options),
    ]);
    const h = haberler.status === "fulfilled" ? haberler.value : [];
    const g = genel.status === "fulfilled" ? genel.value : [];
    if (!h.length && !g.length) {
      throw (haberler.reason || genel.reason || new Error("Arama sonuç vermedi"));
    }
    return [...h, ...g];
  }
  return searchDuckDuckGo(trimmed, options);
}

module.exports = {
  webSearch,
};

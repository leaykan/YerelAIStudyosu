// ============================================================================
// BULUT MODELLERİ (Yerel AI Stüdyosu)
// - Yalnızca sağlayıcıların RESMÎ REST API'leri, kullanıcının KENDİ API anahtarıyla:
//     OpenAI      https://api.openai.com/v1                       (Bearer)
//     Gemini      https://generativelanguage.googleapis.com/v1beta/openai (Bearer, OpenAI uyumlu uç)
//                 model listesi/görsel: .../v1beta (x-goog-api-key başlığı; anahtar asla URL'de değil)
//     Anthropic   https://api.anthropic.com/v1/messages           (x-api-key, yerel Messages API)
//     OpenRouter  https://openrouter.ai/api/v1                    (Bearer)
//   Abonelik girişi, çerez, tarayıcı oturumu ya da resmî olmayan uç nokta KULLANILMAZ.
// - Anahtarlar yalnızca bu bilgisayarda saklanır: Windows'ta DPAPI (CurrentUser) ile şifreli,
//   diğer sistemlerde 0600 izinli dosyada (şifresiz; arayüz bunu söyler). Çözülmüş anahtar
//   yalnızca bellekte tutulur, arayüze asla geri gönderilmez (yalnızca maske).
// - Sohbet istekleri OpenAI biçimine (SSE "data: {...chat.completion.chunk}") çevrilir; böylece
//   serve.cjs'teki araçlı sohbet / akış kodu bulut yanıtını llama-server çıktısı gibi okur.
// Fikir olarak DD:YZ "Sansürsüz Lokal AI Stüdyosu V2" (MIT) projesindeki bulut desteğinden esinlenildi.
// ============================================================================
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const { Readable } = require("stream");

const SAGLAYICILAR = {
  openai: {
    id: "openai", ad: "OpenAI", kisa: "OpenAI", tur: "openai",
    taban: "https://api.openai.com/v1",
    anahtarSayfasi: "https://platform.openai.com/api-keys",
    not: "ChatGPT Plus aboneliği API anahtarı yerine geçmez; API kullanımı platform.openai.com üzerinden ayrıca ücretlendirilir.",
    varsayilanModeller: ["gpt-5-mini", "gpt-5", "gpt-4.1-mini", "gpt-4o-mini"],
    gorsel: true,
  },
  gemini: {
    id: "gemini", ad: "Google Gemini", kisa: "Gemini", tur: "openai",
    taban: "https://generativelanguage.googleapis.com/v1beta/openai",
    yerelTaban: "https://generativelanguage.googleapis.com/v1beta",
    anahtarSayfasi: "https://aistudio.google.com/apikey",
    not: "Gemini Pro (Google One) aboneliği API anahtarı yerine geçmez; anahtarı Google AI Studio'dan alın. Ücretsiz katmanda Google gönderilen içeriği ürünlerini geliştirmek için kullanabilir; hassas bilgi paylaşmayın.",
    varsayilanModeller: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
    gorsel: true,
  },
  anthropic: {
    id: "anthropic", ad: "Anthropic (Claude)", kisa: "Claude", tur: "anthropic",
    taban: "https://api.anthropic.com/v1",
    anahtarSayfasi: "https://console.anthropic.com/settings/keys",
    not: "Claude Pro/Max aboneliği API anahtarı yerine geçmez; API kullanımı Anthropic Console üzerinden ayrıca ücretlendirilir.",
    varsayilanModeller: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"],
    gorsel: false,
  },
  openrouter: {
    id: "openrouter", ad: "OpenRouter", kisa: "OpenRouter", tur: "openai",
    taban: "https://openrouter.ai/api/v1",
    anahtarSayfasi: "https://openrouter.ai/settings/keys",
    not: "OpenRouter isteği seçtiğiniz modelin sağlayıcısına iletir; o sağlayıcının kuralları da geçerlidir. Bazı modeller ücretsizdir, çoğu kredi düşer.",
    varsayilanModeller: ["google/gemini-2.5-flash", "openai/gpt-5-mini", "anthropic/claude-sonnet-4.5", "meta-llama/llama-3.3-70b-instruct"],
    gorsel: false,
  },
};

const MODEL_KIMLIGI = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,159}$/;
const ANTHROPIC_SURUMU = "2023-06-01";
const DPAPI_EK_ENTROPI = "YerelAIStudyosu-bulut-v1"; // gizli değil; anahtarı yalnızca bu uygulamaya bağlar
const KULLANICI_AJANI = "YerelAIStudyosu/1.0 (+resmi API istemcisi)";

class BulutHatasi extends Error {
  constructor(mesaj, statusCode = 500, kod = "") {
    super(mesaj);
    this.name = "BulutHatasi";
    this.statusCode = statusCode;
    this.kod = kod;
  }
}

module.exports = function bulutAltyapisi(ctx = {}) {
  const ROOT = ctx.ROOT || path.join(__dirname, "..", "..");
  const json = ctx.json || ((res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); });
  const readJsonBody = ctx.readJsonBody;
  const motorGunlugu = ctx.motorGunlugu || (() => {});
  const log = ctx.log || ((...a) => console.log(...a));
  const PLATFORM = ctx.platform || process.platform;
  const ANAHTAR_DOSYASI = ctx.anahtarDosyasi || path.join(ROOT, "app", "config", "bulut-anahtarlari.json");
  // Testler için taban adresleri değiştirilebilir (gerçek kullanımda verilmez)
  const tabanlar = Object.assign({}, ...Object.values(SAGLAYICILAR).map((s) => ({ [s.id]: s.taban, [s.id + "Yerel"]: s.yerelTaban })), ctx.tabanUrlleri || {});

  const anahtarOnbellegi = new Map(); // saglayici -> çözülmüş anahtar (yalnızca bellekte)
  let kayitOnbellegi = null;
  let secili = null; // "bulut:<saglayici>:<model>" ya da null

  // ---------------------------------------------------------------- yardımcılar
  function maskele(anahtar) {
    const a = String(anahtar || "").trim();
    if (a.length < 12) return "••••";
    const onek = ["sk-ant-api03-", "sk-ant-", "sk-or-v1-", "sk-proj-", "sk-svcacct-", "sk-", "AIza"].find((o) => a.startsWith(o)) || "";
    return `${onek}••••${a.slice(-4)}`;
  }

  // Hata/günlük metinlerinden anahtarları ayıklar
  function temizle(metin) {
    let m = String(metin == null ? "" : metin);
    for (const a of anahtarOnbellegi.values()) if (a && a.length >= 8) m = m.split(a).join(maskele(a));
    return m
      .replace(/sk-[A-Za-z0-9_\-]{12,}/g, "sk-••••")
      .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "AIza••••")
      .replace(/(key=)[^&\s"']+/gi, "$1••••")
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, "$1••••");
  }

  function modelKimliginiCoz(kimlik) {
    const s = String(kimlik || "");
    if (!s.startsWith("bulut:")) return null;
    const ikinci = s.indexOf(":", 6);
    if (ikinci < 0) return null;
    const saglayici = s.slice(6, ikinci);
    const model = s.slice(ikinci + 1);
    if (!SAGLAYICILAR[saglayici] || !MODEL_KIMLIGI.test(model)) return null;
    return { saglayici, model, tanim: SAGLAYICILAR[saglayici] };
  }
  const bulutModeliMi = (kimlik) => typeof kimlik === "string" && kimlik.startsWith("bulut:");
  const modelKimligi = (saglayici, model) => `bulut:${saglayici}:${model}`;
  const etiket = (kimlik) => {
    const c = modelKimliginiCoz(kimlik);
    return c ? `Bulut · ${c.tanim.kisa} · ${c.model}` : "";
  };

  // ------------------------------------------------------------ anahtar deposu
  function kayitlariOku() {
    if (kayitOnbellegi) return kayitOnbellegi;
    try {
      const j = JSON.parse(fs.readFileSync(ANAHTAR_DOSYASI, "utf8"));
      kayitOnbellegi = { surum: 1, saglayicilar: (j && typeof j.saglayicilar === "object" && j.saglayicilar) || {} };
    } catch (_) {
      kayitOnbellegi = { surum: 1, saglayicilar: {} };
    }
    return kayitOnbellegi;
  }

  function kayitlariYaz(veri) {
    fs.mkdirSync(path.dirname(ANAHTAR_DOSYASI), { recursive: true });
    const gecici = ANAHTAR_DOSYASI + ".yaziliyor";
    fs.writeFileSync(gecici, JSON.stringify(veri, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(gecici, ANAHTAR_DOSYASI);
    try { fs.chmodSync(ANAHTAR_DOSYASI, 0o600); } catch (_) {}
    kayitOnbellegi = veri;
  }

  function powershellYolu() {
    const kok = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const p = path.join(kok, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    try { if (fs.existsSync(p)) return p; } catch (_) {}
    return "powershell.exe";
  }

  // Gizli veri stdin'den base64 olarak verilir (argv/ortam değişkeni kullanılmaz); çıktı base64.
  function dpapiBetigi(islem) {
    return [
      "$ErrorActionPreference='Stop'",
      "Add-Type -AssemblyName System.Security",
      "$g=[Console]::In.ReadToEnd().Trim()",
      "$b=[Convert]::FromBase64String($g)",
      `$e=[Text.Encoding]::UTF8.GetBytes('${DPAPI_EK_ENTROPI}')`,
      `$o=[Security.Cryptography.ProtectedData]::${islem}($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)`,
      "[Console]::Out.Write([Convert]::ToBase64String($o))",
    ].join("; ");
  }

  function dpapiCalistirGercek(islem, girdiB64) {
    return new Promise((resolve, reject) => {
      let cikti = "";
      let hata = "";
      let bitti = false;
      const cocuk = spawn(powershellYolu(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", dpapiBetigi(islem)], {
        windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
      const zamanlayici = setTimeout(() => { if (!bitti) { try { cocuk.kill(); } catch (_) {} } }, 30000);
      cocuk.stdout.setEncoding("utf8");
      cocuk.stderr.setEncoding("utf8");
      cocuk.stdout.on("data", (d) => { cikti += d; });
      cocuk.stderr.on("data", (d) => { hata += d; });
      cocuk.on("error", (err) => { bitti = true; clearTimeout(zamanlayici); reject(new BulutHatasi("Windows DPAPI çalıştırılamadı (PowerShell bulunamadı): " + err.message, 500)); });
      cocuk.on("close", (kod) => {
        if (bitti) return;
        bitti = true;
        clearTimeout(zamanlayici);
        const temiz = cikti.trim();
        if (kod === 0 && /^[A-Za-z0-9+/=]+$/.test(temiz)) return resolve(temiz);
        const satir = String(hata).split(/\r?\n/).find((s) => s.trim()) || `çıkış kodu ${kod}`;
        reject(new BulutHatasi(`Windows DPAPI işlemi başarısız (${islem}): ${satir.slice(0, 200)}`, 500));
      });
      cocuk.stdin.on("error", () => {});
      cocuk.stdin.end(girdiB64);
    });
  }
  const dpapiCalistir = ctx.dpapiCalistir || dpapiCalistirGercek;

  async function sifrele(anahtar) {
    const b64 = Buffer.from(anahtar, "utf8").toString("base64");
    if (PLATFORM === "win32") return { yontem: "dpapi", veri: await dpapiCalistir("Protect", b64) };
    return { yontem: "dosya", veri: b64 };
  }

  async function coz(kayit) {
    if (!kayit || !kayit.veri) throw new BulutHatasi("Anahtar kaydı bozuk; anahtarı yeniden girin.", 400);
    if (kayit.yontem === "dpapi") {
      if (PLATFORM !== "win32") throw new BulutHatasi("Bu anahtar Windows DPAPI ile şifrelenmiş; bu sistemde çözülemez. Anahtarı yeniden girin.", 400);
      const b64 = await dpapiCalistir("Unprotect", kayit.veri);
      return Buffer.from(b64, "base64").toString("utf8");
    }
    return Buffer.from(kayit.veri, "base64").toString("utf8");
  }

  async function anahtarAl(saglayici) {
    if (anahtarOnbellegi.has(saglayici)) return anahtarOnbellegi.get(saglayici);
    const kayit = kayitlariOku().saglayicilar[saglayici];
    if (!kayit) throw new BulutHatasi(`${SAGLAYICILAR[saglayici]?.ad || saglayici} için kayıtlı API anahtarı yok. Model seçicide "+ Bulut modeli ekle" ile anahtar girin.`, 400, "ANAHTAR_YOK");
    let anahtar;
    try { anahtar = (await coz(kayit)).trim(); }
    catch (err) { throw new BulutHatasi(`Kayıtlı anahtar çözülemedi (${err.message}). Anahtarı silip yeniden girin.`, 500, "ANAHTAR_COZULEMEDI"); }
    if (!anahtar) throw new BulutHatasi("Kayıtlı anahtar boş; yeniden girin.", 400);
    anahtarOnbellegi.set(saglayici, anahtar);
    return anahtar;
  }

  function anahtarBicimiGecerli(anahtar) {
    return typeof anahtar === "string" && anahtar.length >= 20 && anahtar.length <= 400 && /^[\x21-\x7e]+$/.test(anahtar);
  }

  // ----------------------------------------------------------------- HTTP
  function agHatasi(err) {
    if (err instanceof BulutHatasi) return err;
    const kod = String(err?.code || "");
    if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(kod)) {
      return new BulutHatasi(`Sağlayıcıya bağlanılamadı (${kod}). İnternet bağlantınızı kontrol edin.`, 502, "AG");
    }
    if (/CERT|SSL|TLS/i.test(kod) || /certificate/i.test(String(err?.message))) {
      return new BulutHatasi("Sağlayıcıyla güvenli bağlantı kurulamadı (sertifika hatası). Saat/tarih ayarını ve ağ filtrelerini kontrol edin.", 502, "TLS");
    }
    if (kod === "ECONNRESET") return new BulutHatasi("Sağlayıcıyla bağlantı beklenmedik biçimde kesildi. Yeniden deneyin.", 502, "AG");
    return new BulutHatasi("Sağlayıcıya istek gönderilemedi: " + temizle(err?.message || String(err)).slice(0, 200), 502, "AG");
  }

  // Yanıt başlıkları gelince { res, req } döndürür. Zaman aşımı = soket hareketsizlik süresi.
  function istekAt(url, { method = "GET", basliklar = {}, govde = null, zamanAsimiMs = 30000, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new BulutHatasi("İstek iptal edildi.", 499, "IPTAL"));
      const u = new URL(url);
      const modul = u.protocol === "http:" ? http : https;
      const veri = govde == null ? null : Buffer.from(typeof govde === "string" ? govde : JSON.stringify(govde), "utf8");
      const req = modul.request({
        protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method,
        headers: {
          "User-Agent": KULLANICI_AJANI,
          Accept: "application/json, text/event-stream",
          ...basliklar,
          ...(veri ? { "Content-Type": "application/json", "Content-Length": veri.length } : {}),
        },
      }, (res) => resolve({ res, req }));
      req.setTimeout(zamanAsimiMs, () => req.destroy(new BulutHatasi(`Sağlayıcı ${Math.round(zamanAsimiMs / 1000)} saniye içinde yanıt vermedi (zaman aşımı).`, 504, "ZAMAN_ASIMI")));
      req.on("error", (err) => reject(signal?.aborted ? new BulutHatasi("İstek iptal edildi.", 499, "IPTAL") : agHatasi(err)));
      if (signal) signal.addEventListener("abort", () => req.destroy(new BulutHatasi("İstek iptal edildi.", 499, "IPTAL")), { once: true });
      req.end(veri || undefined);
    });
  }

  function govdeOku(res, sinir = 16 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const parcalar = [];
      let boyut = 0;
      res.on("data", (p) => {
        boyut += p.length;
        if (boyut > sinir) { res.destroy(); reject(new BulutHatasi("Sağlayıcı yanıtı çok büyük.", 502)); return; }
        parcalar.push(p);
      });
      res.on("end", () => resolve(Buffer.concat(parcalar)));
      res.on("error", (err) => reject(agHatasi(err)));
      res.on("aborted", () => reject(new BulutHatasi("Sağlayıcı yanıtı yarıda kesildi.", 502)));
    });
  }

  function saglayiciMesaji(metin) {
    try {
      let j = JSON.parse(metin);
      if (Array.isArray(j)) j = j[0];
      const e = j?.error;
      const m = typeof e === "string" ? e : (e?.message || j?.message || j?.detail || "");
      return temizle(String(m || "")).replace(/\s+/g, " ").trim().slice(0, 300);
    } catch (_) {
      return temizle(String(metin || "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    }
  }

  function hataEsle(saglayici, durum, govdeMetni, model) {
    const ad = SAGLAYICILAR[saglayici]?.ad || saglayici;
    const sm = saglayiciMesaji(govdeMetni);
    const ek = sm ? ` Sağlayıcının mesajı: "${sm}"` : "";
    const anahtarGecersiz = /api[_ ]?key not valid|invalid[_ ]api[_ ]?key|incorrect api key|API_KEY_INVALID|invalid x-api-key|authentication_error|no auth credentials/i.test(govdeMetni || "");
    let mesaj;
    let kod = "HTTP_" + durum;
    if (durum === 401 || anahtarGecersiz) { mesaj = `${ad}: API anahtarı geçersiz, süresi dolmuş ya da iptal edilmiş. Anahtarı kontrol edip yeniden girin.`; kod = "ANAHTAR_GECERSIZ"; }
    else if (durum === 402) { mesaj = `${ad}: Hesapta yeterli kredi yok. Sağlayıcı panelinden kredi/ödeme durumunu kontrol edin.`; kod = "KREDI"; }
    else if (durum === 403) mesaj = `${ad}: Bu anahtarın bu modele ya da işleme izni yok (bölge, proje ya da hesap kısıtlaması olabilir).${ek}`;
    else if (durum === 404) mesaj = `${ad}: "${model || "?"}" modeli bulunamadı ya da bu anahtarla kullanılamıyor. Model kimliğini kontrol edin.${ek}`;
    else if (durum === 408 || durum === 504) mesaj = `${ad}: Sağlayıcı zamanında yanıt vermedi. Yeniden deneyin.`;
    else if (durum === 413) mesaj = `${ad}: İstek çok büyük (sohbet ya da ekli görsel fazla uzun). Yeni bir sohbet başlatmayı deneyin.`;
    else if (durum === 429) {
      if (/insufficient_quota|quota|billing|credit|exceeded your current/i.test(govdeMetni || "")) { mesaj = `${ad}: Kota ya da kredi bitti. Sağlayıcı panelinden kullanım sınırınızı ve ödeme durumunuzu kontrol edin.${ek}`; kod = "KOTA"; }
      else { mesaj = `${ad}: Çok sık istek gönderildi (hız sınırı). Biraz bekleyip yeniden deneyin.${ek}`; kod = "HIZ_SINIRI"; }
    }
    else if (durum >= 500) mesaj = `${ad}: Sağlayıcı şu an yanıt veremiyor ya da aşırı yoğun (HTTP ${durum}). Biraz sonra yeniden deneyin.`;
    else mesaj = `${ad}: İstek reddedildi (HTTP ${durum}).${ek}`;
    return new BulutHatasi(mesaj, durum === 401 || anahtarGecersiz ? 401 : durum, kod);
  }

  function kimlikBasliklari(saglayici, anahtar, yerel = false) {
    if (saglayici === "anthropic") return { "x-api-key": anahtar, "anthropic-version": ANTHROPIC_SURUMU };
    if (saglayici === "gemini" && yerel) return { "x-goog-api-key": anahtar };
    const b = { Authorization: `Bearer ${anahtar}` };
    if (saglayici === "openrouter") { b["HTTP-Referer"] = "http://localhost"; b["X-Title"] = "Yerel AI Studyosu"; }
    return b;
  }

  async function jsonGetir(saglayici, url, anahtar, yerel = false, zamanAsimiMs = 20000) {
    const { res } = await istekAt(url, { basliklar: kimlikBasliklari(saglayici, anahtar, yerel), zamanAsimiMs });
    const metin = (await govdeOku(res)).toString("utf8");
    if (res.statusCode < 200 || res.statusCode >= 300) throw hataEsle(saglayici, res.statusCode, metin, "");
    try { return JSON.parse(metin); } catch (_) { throw new BulutHatasi(`${SAGLAYICILAR[saglayici].ad}: geçersiz yanıt (JSON değil).`, 502); }
  }

  // ------------------------------------------------------------ model listeleri
  async function canliModelListesi(saglayici, anahtar) {
    if (saglayici === "openai") {
      const j = await jsonGetir(saglayici, `${tabanlar.openai}/models`, anahtar);
      return (j.data || []).map((m) => String(m.id || ""))
        .filter((id) => /^(gpt-|o\d|chatgpt-)/i.test(id) && !/(audio|realtime|tts|transcribe|search|image|embedding|instruct|moderation|dall-e|whisper|davinci|babbage|codex|computer-use)/i.test(id))
        .sort().map((id) => ({ id, ad: id }));
    }
    if (saglayici === "gemini") {
      const j = await jsonGetir(saglayici, `${tabanlar.geminiYerel}/models?pageSize=1000`, anahtar, true);
      return (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => ({ id: String(m.name || "").replace(/^models\//, ""), ad: m.displayName || "" }))
        .filter((m) => /gemini|gemma/i.test(m.id) && !/(embedding|image|tts|aqa|live|audio|robotics|computer-use|native)/i.test(m.id))
        .map((m) => ({ id: m.id, ad: m.ad && m.ad !== m.id ? `${m.ad} (${m.id})` : m.id }));
    }
    if (saglayici === "anthropic") {
      const j = await jsonGetir(saglayici, `${tabanlar.anthropic}/models?limit=100`, anahtar);
      return (j.data || []).map((m) => ({ id: String(m.id || ""), ad: m.display_name ? `${m.display_name} (${m.id})` : String(m.id || "") }));
    }
    if (saglayici === "openrouter") {
      const j = await jsonGetir(saglayici, `${tabanlar.openrouter}/models`, anahtar);
      return (j.data || []).map((m) => {
        const ucretsiz = m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;
        return { id: String(m.id || ""), ad: `${m.name || m.id}${ucretsiz ? " · ücretsiz" : ""}` };
      }).filter((m) => MODEL_KIMLIGI.test(m.id)).sort((a, b) => a.id.localeCompare(b.id));
    }
    return [];
  }

  // Anahtarı sağlayıcıya sorarak doğrular (yalnızca başlıkta). Başarılıysa model listesini döndürür.
  async function anahtarDogrula(saglayici, anahtar) {
    if (saglayici === "openrouter") {
      // /models herkese açık olduğundan anahtar ayrıca /key ile doğrulanır
      try { await jsonGetir(saglayici, `${tabanlar.openrouter}/key`, anahtar); }
      catch (err) {
        if (err.statusCode !== 404) throw err;
        await jsonGetir(saglayici, `${tabanlar.openrouter}/auth/key`, anahtar);
      }
    }
    const liste = await canliModelListesi(saglayici, anahtar);
    return liste.filter((m) => MODEL_KIMLIGI.test(m.id));
  }

  // ------------------------------------------------------------ istek gövdeleri
  function mesajlariTemizle(mesajlar) {
    return (Array.isArray(mesajlar) ? mesajlar : []).map((m) => {
      const r = String(m?.role || "user");
      const role = r === "system" || r === "developer" ? "system" : r === "assistant" ? "assistant" : "user";
      let content = m?.content;
      if (Array.isArray(content)) {
        content = content.map((p) => {
          if (typeof p === "string") return { type: "text", text: p };
          if (p?.type === "text") return { type: "text", text: String(p.text ?? "") };
          if (p?.type === "image_url") {
            const url = typeof p.image_url === "string" ? p.image_url : String(p.image_url?.url || "");
            return url ? { type: "image_url", image_url: { url } } : null;
          }
          return null;
        }).filter(Boolean);
        if (content.every((p) => p.type === "text")) content = content.map((p) => p.text).join("\n");
      } else {
        content = content == null ? "" : String(content);
      }
      return { role, content };
    });
  }

  function dusunenModelMi(saglayici, model) {
    const id = String(model).toLowerCase();
    if (saglayici === "openai") return /^(o\d|gpt-5)/.test(id) && !/chat/.test(id);
    if (saglayici === "gemini") return /gemini-(2\.5|3)/.test(id);
    if (saglayici === "openrouter") return /(\/o\d|gpt-5|gemini-(2\.5|3)|deepseek-r1|thinking|reason|qwq|-r1\b)/.test(id);
    return false;
  }

  function sayi(v) { const n = Number(v); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? undefined : n; }

  function azamiJeton(saglayici, model, govde) {
    let n = sayi(govde.max_tokens ?? govde.maxTokens ?? govde.max_completion_tokens);
    n = n && n > 0 ? Math.floor(n) : 1024;
    n = Math.min(n, 32000);
    // Düşünen modellerde gizli muhakeme de bu sınırdan yer; çok düşük sınır boş yanıt verir
    if (dusunenModelMi(saglayici, model)) n = Math.max(n, 2048);
    return n;
  }

  function durdurmalar(govde) {
    const s = Array.isArray(govde.stop) ? govde.stop : (govde.stop ? [govde.stop] : []);
    return s.map(String).filter((x) => x.trim()).slice(0, 4);
  }

  function openaiGovdesi(saglayici, model, govde, akis, sade) {
    const g = { model, messages: mesajlariTemizle(govde.messages), stream: akis };
    const dusunen = dusunenModelMi(saglayici, model);
    const n = azamiJeton(saglayici, model, govde);
    if (saglayici === "openai") g.max_completion_tokens = n; else g.max_tokens = n;
    if (sade) return g;
    if (akis && saglayici === "openai") g.stream_options = { include_usage: true };
    const sicaklik = sayi(govde.temperature);
    if (sicaklik !== undefined && !(saglayici === "openai" && dusunen)) g.temperature = Math.max(0, Math.min(2, sicaklik));
    if (dusunen && (saglayici === "openai" || saglayici === "gemini")) g.reasoning_effort = "low";
    const st = durdurmalar(govde);
    if (st.length) g.stop = st;
    return g;
  }

  function resimBlogu(url) {
    const m = String(url).match(/^data:([^;,]+);base64,(.+)$/);
    if (m) return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
    if (/^https?:\/\//i.test(url)) return { type: "image", source: { type: "url", url } };
    return null;
  }

  function anthropicGovdesi(model, govde, akis, sade) {
    const sistem = [];
    const liste = [];
    for (const m of mesajlariTemizle(govde.messages)) {
      if (m.role === "system") {
        const t = typeof m.content === "string" ? m.content : m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
        if (t.trim()) sistem.push(t);
        continue;
      }
      const bloklar = typeof m.content === "string"
        ? (m.content.trim() ? [{ type: "text", text: m.content }] : [])
        : m.content.map((p) => (p.type === "text" ? (p.text.trim() ? { type: "text", text: p.text } : null) : resimBlogu(p.image_url.url))).filter(Boolean);
      if (!bloklar.length) continue;
      const son = liste[liste.length - 1];
      if (son && son.role === m.role) son.content.push(...bloklar);
      else liste.push({ role: m.role, content: bloklar });
    }
    if (!liste.length || liste[0].role !== "user") liste.unshift({ role: "user", content: [{ type: "text", text: "(Sohbet devam ediyor.)" }] });
    const sonMesaj = liste[liste.length - 1];
    if (sonMesaj.role === "assistant") {
      for (const b of sonMesaj.content) if (b.type === "text") b.text = b.text.replace(/\s+$/, "");
      sonMesaj.content = sonMesaj.content.filter((b) => b.type !== "text" || b.text);
      if (!sonMesaj.content.length) liste.pop();
    }
    const g = {
      model,
      max_tokens: azamiJeton("anthropic", model, govde),
      messages: liste.map((m) => (m.content.length === 1 && m.content[0].type === "text" ? { role: m.role, content: m.content[0].text } : m)),
      stream: akis,
    };
    if (sistem.length) g.system = sistem.join("\n\n");
    if (sade) return g;
    const sicaklik = sayi(govde.temperature);
    if (sicaklik !== undefined) g.temperature = Math.max(0, Math.min(1, sicaklik)); // top_p birlikte gönderilmez
    const st = durdurmalar(govde);
    if (st.length) g.stop_sequences = st;
    return g;
  }

  function sohbetIstegi(saglayici, model, anahtar, govde, akis, sade) {
    if (saglayici === "anthropic") {
      return { url: `${tabanlar.anthropic}/messages`, basliklar: kimlikBasliklari(saglayici, anahtar), govde: anthropicGovdesi(model, govde, akis, sade) };
    }
    return { url: `${tabanlar[saglayici]}/chat/completions`, basliklar: kimlikBasliklari(saglayici, anahtar), govde: openaiGovdesi(saglayici, model, govde, akis, sade) };
  }

  // ------------------------------------------------------------ akış dönüştürme
  // Node'un IncomingMessage davranışını taklit eder: yok edilince yalnızca dinleyici varsa 'error' yayar.
  class YanitAkisi extends Readable {
    constructor(statusCode = 200, iptal = null) {
      super();
      this.statusCode = statusCode;
      this.statusMessage = "";
      this.headers = { "content-type": statusCode === 200 ? "text/event-stream; charset=utf-8" : "application/json" };
      this.complete = false;
      this._iptal = iptal;
    }
    _read() {}
    _destroy(err, cb) {
      if (!this.complete) { try { this.emit("aborted"); } catch (_) {} }
      try { this._iptal && this._iptal(); } catch (_) {}
      if (err && this.listenerCount("error") === 0) cb(); else cb(err);
    }
    bitir() { if (!this.destroyed && !this.complete) { this.complete = true; this.push(null); } }
  }

  function sseAyristirici(olayCb) {
    let tampon = "";
    const isle = (olay) => {
      let ad = "";
      const veri = [];
      for (const s of olay.split(/\r?\n/)) {
        if (!s || s.startsWith(":")) continue;
        if (s.startsWith("event:")) ad = s.slice(6).trim();
        else if (s.startsWith("data:")) veri.push(s.slice(5).replace(/^ /, ""));
      }
      if (veri.length) olayCb(ad, veri.join("\n"));
    };
    return {
      yaz(parca) {
        tampon += parca;
        const olaylar = tampon.split(/\r?\n\r?\n/);
        tampon = olaylar.pop() || "";
        for (const o of olaylar) isle(o);
      },
      bosalt() { if (tampon.trim()) isle(tampon); tampon = ""; },
    };
  }

  function bitisNedeni(n) {
    if (!n) return "stop";
    const s = String(n).toLowerCase();
    if (s === "max_tokens" || s === "length") return "length";
    if (s === "end_turn" || s === "stop_sequence" || s === "stop") return "stop";
    if (s === "refusal" || s === "content_filter" || s === "safety") return "content_filter";
    return s;
  }

  function akisDonustur(saglayici, modelKimligiTam, yukari, istek, akis) {
    const kimlik = "bulut-" + Date.now().toString(36);
    const olusturma = Math.floor(Date.now() / 1000);
    const durum = { bitis: null, kullanim: null, hata: null, tamam: false, kapandi: false };
    const parca = (delta, bitis = null) => ({ id: kimlik, object: "chat.completion.chunk", created: olusturma, model: modelKimligiTam, choices: [{ index: 0, delta, finish_reason: bitis }] });
    const gonder = (nesne) => { if (!akis.destroyed && !akis.complete) akis.push(`data: ${JSON.stringify(nesne)}\n\n`); };
    const metinYaz = (t) => { if (t) gonder(parca({ content: t })); };
    const dusunceYaz = (t) => { if (t) gonder(parca({ reasoning_content: t })); };

    const ayristirici = sseAyristirici((olayAdi, veri) => {
      if (saglayici === "anthropic") {
        let j; try { j = JSON.parse(veri); } catch (_) { return; }
        const tur = j.type || olayAdi;
        if (tur === "message_start") {
          const u = j.message?.usage || {};
          durum.kullanim = { prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), completion_tokens: u.output_tokens || 0 };
        } else if (tur === "content_block_delta") {
          if (j.delta?.type === "text_delta") metinYaz(j.delta.text);
          else if (j.delta?.type === "thinking_delta") dusunceYaz(j.delta.thinking);
        } else if (tur === "message_delta") {
          if (j.delta?.stop_reason) durum.bitis = bitisNedeni(j.delta.stop_reason);
          if (j.usage?.output_tokens != null) durum.kullanim = { ...(durum.kullanim || { prompt_tokens: 0 }), completion_tokens: j.usage.output_tokens };
        } else if (tur === "message_stop") {
          durum.tamam = true;
        } else if (tur === "error") {
          const t = j.error?.type || "";
          durum.hata = t === "overloaded_error"
            ? "Anthropic şu an aşırı yoğun; yanıt yarıda kaldı. Biraz sonra yeniden deneyin."
            : `Anthropic yanıtı yarıda kesti: ${temizle(j.error?.message || t).slice(0, 200)}`;
        }
        return;
      }
      if (veri === "[DONE]") { durum.tamam = true; return; }
      let j; try { j = JSON.parse(veri); } catch (_) { return; }
      if (j.error) {
        const e = j.error;
        durum.hata = `${SAGLAYICILAR[saglayici].ad} yanıtı yarıda kesti: ${temizle(typeof e === "string" ? e : (e.message || JSON.stringify(e))).slice(0, 200)}`;
        return;
      }
      const c = Array.isArray(j.choices) ? j.choices[0] : null;
      if (c) {
        const d = c.delta || c.message || {};
        const icerik = typeof d.content === "string" ? d.content : (Array.isArray(d.content) ? d.content.map((p) => p?.text || "").join("") : "");
        metinYaz(icerik);
        const dus = typeof d.reasoning_content === "string" ? d.reasoning_content : (typeof d.reasoning === "string" ? d.reasoning : "");
        dusunceYaz(dus);
        if (c.finish_reason) durum.bitis = bitisNedeni(c.finish_reason);
      }
      if (j.usage && (j.usage.prompt_tokens != null || j.usage.completion_tokens != null)) {
        durum.kullanim = { prompt_tokens: j.usage.prompt_tokens || 0, completion_tokens: j.usage.completion_tokens || 0 };
      }
    });

    const kapat = (agHatasiNesnesi) => {
      if (durum.kapandi) return;
      durum.kapandi = true;
      ayristirici.bosalt();
      if (akis.destroyed) return; // tüketici vazgeçti
      if (agHatasiNesnesi && !durum.tamam) durum.hata = durum.hata || agHatasi(agHatasiNesnesi).message;
      if (durum.hata) { metinYaz(`\n\n(Bulut hatası: ${durum.hata})`); motorGunlugu(`[bulut] ${modelKimligiTam}: akış hatası: ${temizle(durum.hata).slice(0, 200)}`); }
      gonder(parca({}, durum.hata ? "stop" : (durum.bitis || "stop")));
      if (durum.kullanim) {
        const k = { prompt_tokens: durum.kullanim.prompt_tokens || 0, completion_tokens: durum.kullanim.completion_tokens || 0 };
        k.total_tokens = k.prompt_tokens + k.completion_tokens;
        gonder({ id: kimlik, object: "chat.completion.chunk", created: olusturma, model: modelKimligiTam, choices: [], usage: k });
      }
      akis.push("data: [DONE]\n\n");
      akis.bitir();
    };

    let sonHata = null;
    istek.on("error", (e) => { sonHata = e; });
    yukari.setEncoding("utf8");
    yukari.on("data", (p) => ayristirici.yaz(p));
    yukari.on("end", () => kapat(null));
    yukari.on("error", (e) => { sonHata = sonHata || e; });
    yukari.on("close", () => { if (!durum.kapandi) kapat(yukari.complete ? null : (sonHata || Object.assign(new Error("bağlantı kesildi"), { code: "ECONNRESET" }))); });
  }

  function tamYanit(saglayici, modelKimligiTam, j) {
    const olusturma = Math.floor(Date.now() / 1000);
    if (saglayici === "anthropic") {
      const metin = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const u = j.usage || {};
      const p = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      return {
        id: j.id || "bulut-" + olusturma, object: "chat.completion", created: olusturma, model: modelKimligiTam,
        choices: [{ index: 0, message: { role: "assistant", content: metin }, finish_reason: bitisNedeni(j.stop_reason) }],
        usage: { prompt_tokens: p, completion_tokens: u.output_tokens || 0, total_tokens: p + (u.output_tokens || 0) },
      };
    }
    const c = (j.choices || [])[0] || {};
    const icerik = c.message?.content;
    const metin = typeof icerik === "string" ? icerik : (Array.isArray(icerik) ? icerik.map((p) => p?.text || "").join("") : "");
    const u = j.usage || {};
    return {
      id: j.id || "bulut-" + olusturma, object: "chat.completion", created: olusturma, model: modelKimligiTam,
      choices: [{ index: 0, message: { role: "assistant", content: metin }, finish_reason: bitisNedeni(c.finish_reason) }],
      usage: { prompt_tokens: u.prompt_tokens || 0, completion_tokens: u.completion_tokens || 0, total_tokens: u.total_tokens || ((u.prompt_tokens || 0) + (u.completion_tokens || 0)) },
    };
  }

  // ------------------------------------------------------------ ana sohbet işlevi
  // govde: OpenAI biçimi { messages, temperature, max_tokens, stream, stop }; llama'ya özgü alanlar yok sayılır.
  // stream:true  -> { stream: true, akis: Readable (OpenAI SSE metni), statusCode: 200 }
  // stream:false -> { stream: false, json: chat.completion }
  // Sağlayıcı HTTP hatası -> BulutHatasi (statusCode = sağlayıcının kodu, Türkçe mesaj) fırlatır.
  async function bulutSohbet(modelKimligiTam, govde = {}, { signal, zamanAsimiMs } = {}) {
    const c = modelKimliginiCoz(modelKimligiTam);
    if (!c) throw new BulutHatasi("Geçersiz bulut modeli kimliği.", 400);
    const anahtar = await anahtarAl(c.saglayici);
    const akisli = govde.stream === true;
    const sure = Number(zamanAsimiMs) > 0 ? Number(zamanAsimiMs) : (akisli ? 180000 : 300000);
    const baslangic = Date.now();

    for (let deneme = 0; deneme < 2; deneme += 1) {
      const sade = deneme === 1;
      const ist = sohbetIstegi(c.saglayici, c.model, anahtar, govde, akisli, sade);
      const { res: yukari, req } = await istekAt(ist.url, { method: "POST", basliklar: ist.basliklar, govde: ist.govde, zamanAsimiMs: sure, signal });
      if (yukari.statusCode < 200 || yukari.statusCode >= 300) {
        const metin = (await govdeOku(yukari, 1024 * 1024).catch(() => Buffer.from(""))).toString("utf8");
        // İsteğe bağlı bir parametre desteklenmiyorsa bir kez sade gövdeyle yeniden dene
        if (yukari.statusCode === 400 && !sade && /(temperature|top_p|reasoning|stream_options|stop|max_tokens|max_completion_tokens|unsupported|not supported)/i.test(metin)) {
          log(`  [bulut] ${c.saglayici}/${c.model}: parametre reddedildi, sade gövdeyle yeniden deneniyor`);
          continue;
        }
        const hata = hataEsle(c.saglayici, yukari.statusCode, metin, c.model);
        log(`  [bulut] ${c.saglayici}/${c.model}: HTTP ${yukari.statusCode} (${hata.kod})`);
        motorGunlugu(`[bulut] ${c.saglayici}/${c.model}: HTTP ${yukari.statusCode} ${hata.kod}`);
        throw hata;
      }
      if (!akisli) {
        const metin = (await govdeOku(yukari)).toString("utf8");
        let j;
        try { j = JSON.parse(metin); } catch (_) { throw new BulutHatasi(`${c.tanim.ad}: geçersiz yanıt (JSON değil).`, 502); }
        log(`  [bulut] ${c.saglayici}/${c.model}: tamamlandı (${Date.now() - baslangic} ms)`);
        return { stream: false, statusCode: 200, json: tamYanit(c.saglayici, modelKimligiTam, j) };
      }
      const akis = new YanitAkisi(200, () => { try { req.destroy(); } catch (_) {} });
      akisDonustur(c.saglayici, modelKimligiTam, yukari, req, akis);
      log(`  [bulut] ${c.saglayici}/${c.model}: akış başladı (${Date.now() - baslangic} ms)`);
      return { stream: true, statusCode: 200, akis };
    }
    throw new BulutHatasi(`${c.tanim.ad}: istek reddedildi.`, 400);
  }

  // http.request yerine geçen nesne: serve.cjs'teki llama-server çağrıları hiç değişmeden buluta gider.
  // secenekler.headers (LLM_YETKI dahil) YOK SAYILIR; yerel anahtar asla dışarı gitmez.
  function httpBenzeri(secenekler = {}, geriCagri) {
    const modelKimligiTam = secili;
    const istek = new EventEmitter();
    const parcalar = [];
    const kontrol = new AbortController();
    let yokEdildi = false;
    let yanitVerildi = false;
    let yanit = null;
    istek.destroyed = false;
    istek.setTimeout = () => istek;
    istek.setNoDelay = () => {};
    istek.setSocketKeepAlive = () => {};
    istek.write = (p) => { if (p) parcalar.push(Buffer.isBuffer(p) ? p : Buffer.from(String(p))); return true; };
    istek.end = (p) => { istek.write(p); process.nextTick(baslat); return istek; };
    istek.destroy = (err) => {
      if (yokEdildi) return istek;
      yokEdildi = true;
      istek.destroyed = true;
      kontrol.abort();
      if (!yanitVerildi) {
        const e = err || Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
        process.nextTick(() => istek.emit("error", e));
      } else if (yanit && !yanit.destroyed && !yanit.complete) {
        yanit.destroy(err || Object.assign(new Error("aborted"), { code: "ECONNRESET" }));
      }
      process.nextTick(() => istek.emit("close"));
      return istek;
    };
    const ver = (y) => {
      if (yokEdildi) { try { y.destroy(); } catch (_) {} return; }
      yanit = y;
      yanitVerildi = true;
      try { geriCagri && geriCagri(y); } catch (err) { log("  [bulut] yanıt işleyici hatası: " + err.message); }
    };
    async function baslat() {
      if (yokEdildi) return;
      if (!modelKimligiTam) return istek.emit("error", new BulutHatasi("Bulut modeli seçili değil.", 409));
      let govde;
      try { govde = JSON.parse(Buffer.concat(parcalar).toString("utf8") || "{}"); }
      catch (_) { govde = null; }
      try {
        if (!govde) throw new BulutHatasi("Geçersiz istek gövdesi.", 400);
        const sonuc = await bulutSohbet(modelKimligiTam, govde, { signal: kontrol.signal, zamanAsimiMs: secenekler.timeout });
        if (sonuc.stream) return ver(sonuc.akis);
        const y = new YanitAkisi(200);
        y.headers["content-type"] = "application/json";
        ver(y);
        y.push(JSON.stringify(sonuc.json));
        y.bitir();
      } catch (err) {
        if (yokEdildi) return;
        if (err instanceof BulutHatasi && err.statusCode >= 400 && err.statusCode < 600 && !["AG", "TLS", "ZAMAN_ASIMI", "IPTAL"].includes(err.kod)) {
          // Sağlayıcı HTTP hatası: llama-server'ın hata yanıtı biçiminde ilet ({error:{message}})
          const y = new YanitAkisi(err.statusCode);
          ver(y);
          y.push(JSON.stringify({ error: { message: err.message, code: err.kod || "" } }));
          y.bitir();
          return;
        }
        istek.emit("error", err instanceof BulutHatasi ? err : agHatasi(err));
      }
    }
    return istek;
  }

  // requestJson(...) yerine: akışsız sohbet, OpenAI chat.completion nesnesi döndürür
  async function jsonIstek(govde, zamanAsimiMs = 300000) {
    if (!secili) throw new BulutHatasi("Bulut modeli seçili değil.", 409);
    const sonuc = await bulutSohbet(secili, { ...govde, stream: false }, { zamanAsimiMs });
    return sonuc.json;
  }

  // ------------------------------------------------------------ seçim / durum
  function modelListesi() {
    const k = kayitlariOku();
    const liste = [];
    for (const [s, kayit] of Object.entries(k.saglayicilar)) {
      const tanim = SAGLAYICILAR[s];
      if (!tanim || !kayit || !Array.isArray(kayit.modeller)) continue;
      for (const m of kayit.modeller) {
        if (!MODEL_KIMLIGI.test(String(m))) continue;
        liste.push({
          filename: modelKimligi(s, m), name: m, bulut: true, saglayici: s, saglayiciAdi: tanim.ad,
          etiket: `Bulut · ${tanim.kisa}`, size: "Bulut", sizeBytes: 0, format: "Bulut API", isProjector: false,
        });
      }
    }
    return liste;
  }

  async function sec(kimlik) {
    const c = modelKimliginiCoz(kimlik);
    if (!c) throw new BulutHatasi("Geçersiz bulut modeli kimliği.", 400);
    const kayit = kayitlariOku().saglayicilar[c.saglayici];
    if (!kayit) throw new BulutHatasi(`${c.tanim.ad} için kayıtlı API anahtarı yok. "+ Bulut modeli ekle" ile anahtar girin.`, 400, "ANAHTAR_YOK");
    if (!Array.isArray(kayit.modeller) || !kayit.modeller.includes(c.model)) {
      throw new BulutHatasi(`"${c.model}" listenizde yok. Önce "+ Bulut modeli ekle" ile ekleyin.`, 400, "MODEL_EKLI_DEGIL");
    }
    await anahtarAl(c.saglayici); // çözülemiyorsa şimdi hata ver
    secili = modelKimligi(c.saglayici, c.model);
    log(`  [bulut] Seçildi: ${c.saglayici}/${c.model}`);
    return secili;
  }

  function secimiTemizle() {
    if (secili) log(`  [bulut] Seçim kaldırıldı: ${secili}`);
    secili = null;
  }
  const aktifModel = () => secili;

  // /api/llm/status için ayarlar (yerel ayarların üzerine bulut bilgisi)
  function durumAyarlari(llmSettings = {}) {
    const c = modelKimliginiCoz(secili);
    if (!c) return llmSettings;
    const goruntu = c.saglayici !== "openrouter";
    return {
      ...llmSettings,
      model: secili,
      bulut: true,
      saglayici: c.saglayici,
      saglayiciAdi: c.tanim.ad,
      bulutModel: c.model,
      etiket: etiket(secili),
      backendMode: `Bulut API · ${c.tanim.ad}`,
      backendBinary: "",
      contextSize: 32768,
      supportsVision: goruntu,
      visionMode: goruntu ? "bulut" : "none",
      visionStatus: goruntu ? "Bulut modeli (görsel desteği modele bağlı)" : "Projector not loaded",
      supportsThinking: false,
      enableThinking: false,
      mmproj: null,
      loadProfile: "bulut",
      backendFallbacks: [],
    };
  }

  function saglayiciDurumlari() {
    const k = kayitlariOku();
    return Object.values(SAGLAYICILAR).map((s) => {
      const kayit = k.saglayicilar[s.id];
      return {
        id: s.id, ad: s.ad, kisa: s.kisa, anahtarSayfasi: s.anahtarSayfasi, not: s.not,
        kayitli: Boolean(kayit && kayit.veri),
        maske: kayit?.maske || "",
        yontem: kayit?.yontem || "",
        eklenme: kayit?.eklenme || "",
        modeller: Array.isArray(kayit?.modeller) ? kayit.modeller : [],
        varsayilanModeller: s.varsayilanModeller,
      };
    });
  }

  // ------------------------------------------------------------ bulut görsel (sonra bağlanacak)
  // bulutGorsel(istem, "bulut:gemini:gemini-2.5-flash-image" | "bulut:openai:gpt-image-1", {en, boy})
  //   -> { buffer, mime }. Henüz hiçbir rotaya bağlı değil.
  async function bulutGorsel(istem, kimlik, { en = 1024, boy = 1024, signal } = {}) {
    const c = modelKimliginiCoz(kimlik);
    if (!c) throw new BulutHatasi("Geçersiz bulut görsel modeli.", 400);
    if (!String(istem || "").trim()) throw new BulutHatasi("İstem boş.", 400);
    const anahtar = await anahtarAl(c.saglayici);
    let b64 = "";
    let mime = "image/png";
    if (c.saglayici === "gemini") {
      const oran = en === boy ? "1:1" : en > boy ? (en / boy >= 1.6 ? "16:9" : "4:3") : (boy / en >= 1.6 ? "9:16" : "3:4");
      const { res } = await istekAt(`${tabanlar.geminiYerel}/models/${encodeURIComponent(c.model)}:generateContent`, {
        method: "POST", basliklar: kimlikBasliklari("gemini", anahtar, true), zamanAsimiMs: 180000, signal,
        govde: { contents: [{ parts: [{ text: `${istem}\n\n(Aspect ratio ${oran})` }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } },
      });
      const metin = (await govdeOku(res)).toString("utf8");
      if (res.statusCode < 200 || res.statusCode >= 300) throw hataEsle("gemini", res.statusCode, metin, c.model);
      const j = JSON.parse(metin);
      const parca = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data || p.inline_data?.data);
      const ic = parca?.inlineData || parca?.inline_data;
      b64 = ic?.data || "";
      mime = ic?.mimeType || ic?.mime_type || mime;
    } else if (c.saglayici === "openai") {
      const boyut = en === boy ? "1024x1024" : en > boy ? "1536x1024" : "1024x1536";
      const { res } = await istekAt(`${tabanlar.openai}/images/generations`, {
        method: "POST", basliklar: kimlikBasliklari("openai", anahtar), zamanAsimiMs: 180000, signal,
        govde: { model: c.model, prompt: istem, n: 1, size: boyut },
      });
      const metin = (await govdeOku(res)).toString("utf8");
      if (res.statusCode < 200 || res.statusCode >= 300) throw hataEsle("openai", res.statusCode, metin, c.model);
      b64 = JSON.parse(metin).data?.[0]?.b64_json || "";
    } else {
      throw new BulutHatasi(`${c.tanim.ad} için görsel üretimi desteklenmiyor.`, 400);
    }
    if (!b64) throw new BulutHatasi("Sağlayıcı görsel döndürmedi (içerik filtresi ya da kota olabilir).", 502);
    const buffer = Buffer.from(b64, "base64");
    if (buffer[0] === 0xff && buffer[1] === 0xd8) mime = "image/jpeg";
    else if (buffer[0] === 0x89 && buffer[1] === 0x50) mime = "image/png";
    return { buffer, mime };
  }

  // ------------------------------------------------------------ HTTP rotaları
  async function govdeAl(req, res) {
    if (readJsonBody) return readJsonBody(req, res);
    return new Promise((resolve) => {
      let v = "";
      req.setEncoding("utf8");
      req.on("data", (p) => { v += p; if (v.length > 1024 * 1024) req.destroy(); });
      req.on("end", () => { try { resolve(JSON.parse(v || "{}")); } catch (_) { json(res, 400, { ok: false, error: "Geçersiz JSON" }); resolve(null); } });
    });
  }

  function saglayiciDogrula(s) {
    const id = String(s || "").toLowerCase();
    if (!SAGLAYICILAR[id]) throw new BulutHatasi("Bilinmeyen sağlayıcı.", 400);
    return id;
  }

  async function handle(req, res) {
    const u = new URL(req.url, "http://localhost");
    const p = u.pathname;
    if (!p.startsWith("/api/bulut/")) return false;
    try {
      if (p === "/api/bulut/saglayicilar" && req.method === "GET") {
        return json(res, 200, { ok: true, saglayicilar: saglayiciDurumlari(), depolama: PLATFORM === "win32" ? "dpapi" : "dosya", aktif: secili }), true;
      }
      if (p === "/api/bulut/liste" && req.method === "GET") {
        return json(res, 200, { ok: true, modeller: modelListesi(), aktif: secili }), true;
      }
      if (p === "/api/bulut/durum" && req.method === "GET") {
        return json(res, 200, { ok: true, aktif: secili, etiket: etiket(secili) }), true;
      }
      if (p === "/api/bulut/anahtar" && req.method === "POST") {
        const body = await govdeAl(req, res);
        if (!body) return true;
        const s = saglayiciDogrula(body.saglayici);
        const anahtar = String(body.anahtar || "").trim().replace(/^["']|["']$/g, "");
        if (!anahtarBicimiGecerli(anahtar)) throw new BulutHatasi("Anahtar biçimi geçersiz (boşluk içermemeli, en az 20 karakter olmalı).", 400);
        let modeller;
        try { modeller = await anahtarDogrula(s, anahtar); }
        catch (err) { throw new BulutHatasi(`Anahtar doğrulanamadı: ${temizle(err.message)}`, err.statusCode === 401 ? 400 : (err.statusCode || 502), err.kod); }
        const sifreli = await sifrele(anahtar);
        const k = kayitlariOku();
        const eski = k.saglayicilar[s] || {};
        const yeni = { surum: 1, saglayicilar: { ...k.saglayicilar, [s]: { ...sifreli, maske: maskele(anahtar), eklenme: new Date().toISOString(), modeller: Array.isArray(eski.modeller) ? eski.modeller : [] } } };
        kayitlariYaz(yeni);
        anahtarOnbellegi.set(s, anahtar);
        log(`  [bulut] ${s} anahtarı doğrulandı ve kaydedildi (${sifreli.yontem})`);
        return json(res, 200, {
          ok: true, saglayici: s, maske: maskele(anahtar), yontem: sifreli.yontem,
          modeller: modeller.length ? modeller : SAGLAYICILAR[s].varsayilanModeller.map((id) => ({ id, ad: id })),
          kaynak: modeller.length ? "canli" : "varsayilan",
          uyari: sifreli.yontem === "dosya" ? "Bu sistemde Windows DPAPI yok; anahtar yalnızca bu kullanıcının okuyabildiği dosyada (0600) şifrelenmeden saklandı." : "",
        }), true;
      }
      if (p === "/api/bulut/anahtar-sil" && req.method === "POST") {
        const body = await govdeAl(req, res);
        if (!body) return true;
        const s = saglayiciDogrula(body.saglayici);
        const k = kayitlariOku();
        const kopya = { ...k.saglayicilar };
        delete kopya[s];
        kayitlariYaz({ surum: 1, saglayicilar: kopya });
        anahtarOnbellegi.delete(s);
        if (secili && modelKimliginiCoz(secili)?.saglayici === s) secimiTemizle();
        log(`  [bulut] ${s} anahtarı silindi`);
        return json(res, 200, { ok: true }), true;
      }
      if (p === "/api/bulut/modeller" && req.method === "GET") {
        const s = saglayiciDogrula(u.searchParams.get("saglayici"));
        const varsayilan = SAGLAYICILAR[s].varsayilanModeller.map((id) => ({ id, ad: id }));
        try {
          const anahtar = await anahtarAl(s);
          const liste = (await canliModelListesi(s, anahtar)).filter((m) => MODEL_KIMLIGI.test(m.id));
          return json(res, 200, { ok: true, modeller: liste.length ? liste : varsayilan, kaynak: liste.length ? "canli" : "varsayilan" }), true;
        } catch (err) {
          return json(res, 200, { ok: true, modeller: varsayilan, kaynak: "varsayilan", hata: temizle(err.message) }), true;
        }
      }
      if (p === "/api/bulut/model-ekle" && req.method === "POST") {
        const body = await govdeAl(req, res);
        if (!body) return true;
        const s = saglayiciDogrula(body.saglayici);
        const model = String(body.model || "").trim().replace(/^models\//, "");
        if (!MODEL_KIMLIGI.test(model)) throw new BulutHatasi("Model kimliği geçersiz (yalnızca harf, rakam ve . _ - / : @ + kullanılabilir).", 400);
        const k = kayitlariOku();
        const kayit = k.saglayicilar[s];
        if (!kayit) throw new BulutHatasi("Önce bu sağlayıcı için API anahtarı girin.", 400, "ANAHTAR_YOK");
        const modeller = Array.isArray(kayit.modeller) ? kayit.modeller.slice() : [];
        if (!modeller.includes(model)) modeller.push(model);
        kayitlariYaz({ surum: 1, saglayicilar: { ...k.saglayicilar, [s]: { ...kayit, modeller: modeller.slice(-50) } } });
        return json(res, 200, { ok: true, model: modelKimligi(s, model), modeller: modelListesi() }), true;
      }
      if (p === "/api/bulut/model-sil" && req.method === "POST") {
        const body = await govdeAl(req, res);
        if (!body) return true;
        const c = modelKimliginiCoz(body.model);
        if (!c) throw new BulutHatasi("Geçersiz bulut modeli kimliği.", 400);
        const k = kayitlariOku();
        const kayit = k.saglayicilar[c.saglayici];
        if (kayit && Array.isArray(kayit.modeller)) {
          kayitlariYaz({ surum: 1, saglayicilar: { ...k.saglayicilar, [c.saglayici]: { ...kayit, modeller: kayit.modeller.filter((m) => m !== c.model) } } });
        }
        if (secili === modelKimligi(c.saglayici, c.model)) secimiTemizle();
        return json(res, 200, { ok: true, modeller: modelListesi() }), true;
      }
      if (p === "/api/bulut/test" && req.method === "POST") {
        const body = await govdeAl(req, res);
        if (!body) return true;
        const s = saglayiciDogrula(body.saglayici);
        const model = String(body.model || "").trim();
        if (!MODEL_KIMLIGI.test(model)) throw new BulutHatasi("Model kimliği geçersiz.", 400);
        const bas = Date.now();
        const sonuc = await bulutSohbet(modelKimligi(s, model), {
          messages: [{ role: "user", content: "Bu bir bağlantı testidir. Yalnızca 'tamam' yaz." }], max_tokens: 16, temperature: 0, stream: false,
        }, { zamanAsimiMs: 60000 });
        return json(res, 200, { ok: true, yanit: String(sonuc.json.choices[0]?.message?.content || "").slice(0, 200), sureMs: Date.now() - bas }), true;
      }
      return json(res, 404, { ok: false, error: "Bilinmeyen bulut uç noktası." }), true;
    } catch (err) {
      const kod = err instanceof BulutHatasi ? err.statusCode : 500;
      if (!res.headersSent) json(res, kod >= 400 && kod < 600 ? kod : 500, { ok: false, error: temizle(err.message || String(err)), code: err.kod || "" });
      return true;
    }
  }

  return {
    handle,
    bulutModeliMi,
    bulutSohbet,
    httpBenzeri,
    jsonIstek,
    sec,
    secimiTemizle,
    aktifModel,
    durumAyarlari,
    modelListesi,
    etiket,
    bulutGorsel,
    maskele,
    temizle,
    SAGLAYICILAR,
    BulutHatasi,
    // yalnızca testler için
    _test: { anthropicGovdesi, openaiGovdesi, hataEsle, dpapiBetigi, anahtarOnbellegi, kayitlariOku, sifrele, coz },
  };
};

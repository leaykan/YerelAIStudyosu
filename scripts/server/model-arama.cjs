// ============================================================================
// MODEL ARAMA ve GÜVENLİ KURULUM (Yerel AI Stüdyosu)
//
// Her model türü için (görsel, metin, sesten metne, metinden sese, müzik/efekt, video) Hugging Face'te
// (resmî API: /api/models?search=&filter=&sort=downloads, ardından /api/models/<depo>?blobs=true — aynı
// commit'in dosya listesi, boyutları ve LFS SHA256 özetleri) ve uygun türlerde GitHub sürümlerinde arar.
// Yalnızca bu uygulamanın çalıştırabildiği biçimler listelenir; her sonuç için BU bilgisayara göre uyum
// tahmini yapılır ve en uygun dosya sürümü (ör. GGUF nicemi) otomatik önerilir.
//
// Kurulum: serve.cjs'in ortak indiricisi (startModelDownload: yalnızca https, HF anahtarı yalnızca
// huggingface.co'ya) ile yapılır. Dosya API'nin döndürdüğü 40 haneli commit'e sabitlenmiş adresten geçici
// adla iner, boyut + SHA256 (LFS dışı küçük dosyalarda git blob SHA1) + içerik biçimi doğrulanır, sonra
// yerine taşınır; doğrulama başarısızsa önceki dosya olduğu gibi kalır. Kurulan her model
// app/config/model-surumleri.json dosyasına (depo + commit + dosya özetleri) kaydedilir; güncelleme
// denetimi (guncelleme.cjs) bu kayıtları kullanır.
//
// Güvenlik kuralları (özet):
//  - Ağ: sorgu yalnızca https://huggingface.co/api/... ve https://api.github.com; indirme yalnızca
//    https://huggingface.co/<depo>/resolve/<commit>/... ve https://github.com/<sahip>/<depo>/releases/download/...
//    (GitHub'da SHA256 özeti — asset "digest" alanı — yayımlanmamış dosya kurulmaz).
//  - Hugging Face anahtarı yalnızca huggingface.co'ya, yalnızca kullanıcı tanımladıysa gider; GitHub'a anahtar
//    gönderilmez. Telemetri yok; yanıtlar önbelleğe alınır, her istekte zaman aşımı vardır.
//  - Pickle biçimleri (.ckpt/.pt/.pth/.pkl/.npy/.npz, torch .bin) reddedilir. whisper.cpp ggml .bin pickle
//    değildir: indirilen dosyanın ilk baytları ("ggml" sihirli sayısı) denetlenir.
//  - Çalıştırılabilir dosyalar (.exe/.dll/.py/.js ...) bu yoldan hiç kurulmaz.
//  - Özel kod (trust_remote_code) isteyen depolar kurulmaz; müzik/video yalnızca stüdyonun sabit commit'li
//    paketleriyle (studyo.cjs) kurulur.
//  - Kapılı (gated) / lisansı belirsiz modeller ve GitHub dosyaları kullanıcı onayı olmadan kurulmaz.
// ============================================================================
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const GUN_MS = 24 * 60 * 60 * 1000;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPO_DESENI = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const KOD_UZANTISI = /\.(py|pyc|pyd|pyw|pyx|js|mjs|cjs|ts|sh|bash|bat|cmd|ps1|psm1|vbs|exe|dll|so|dylib|jar|class|ipynb|lua|rb|pl|php|msi|scr|com|wasm)$/i;
const PICKLE_UZANTISI = /\.(ckpt|pt|pth|pkl|pickle|joblib|npy|npz|bin)$/i;
const AG_HATA_KODLARI = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]);

// Model türleri. "yukleyici": modeli ne açar (python ise özel kod ve pickle çok daha tehlikeli)
const TURLER = {
  text: { etiket: "Metin", hf: { filter: "gguf" }, yukleyici: "llama.cpp", kind: "text" },
  image: { etiket: "Görsel", hf: { pipeline_tag: "text-to-image" }, yukleyici: "sd.cpp", kind: "image" },
  speech: { etiket: "Konuşma tanıma", hf: { pipeline_tag: "automatic-speech-recognition" }, varsayilanArama: "whisper", yukleyici: "whisper.cpp", kind: "speech" },
  tts: { etiket: "Seslendirme (Piper)", hf: { pipeline_tag: "text-to-speech" }, varsayilanArama: "piper", yukleyici: "piper", kind: "tts" },
  muzik: { etiket: "Müzik / ses efekti", hf: { pipeline_tag: "text-to-audio" }, yukleyici: "python", kind: "muzik" },
  video: { etiket: "Video", hf: { pipeline_tag: "text-to-video" }, yukleyici: "python", kind: "video" },
};

// GGUF nicem kalitesi (yüksek = daha iyi kalite, daha büyük dosya)
const NICEM_KALITE = [
  [/^F32$/, 100], [/^(BF16|F16|FP16)$/, 95], [/^Q8_0$/, 90], [/^Q6_K(_L)?$/, 85], [/^Q5_K_(M|L|XL)$/, 80], [/^Q5_K_S$/, 78],
  [/^Q5_K$/, 79], [/^Q5_1$/, 76], [/^Q5_0$/, 75], [/^Q4_K_(M|L|XL)$/, 70], [/^Q4_K$/, 69], [/^Q4_K_S$/, 66], [/^IQ4_NL$/, 65],
  [/^IQ4_XS$/, 64], [/^Q4_1$/, 63], [/^Q4_0$/, 62], [/^Q3_K_(L|XL)$/, 55], [/^Q3_K_M$/, 52], [/^IQ3_M$/, 50],
  [/^IQ3_(S|XS|XXS)$/, 47], [/^Q3_K_S$/, 46], [/^Q2_K(_L|_S)?$/, 35], [/^IQ2_/, 30], [/^IQ1_/, 20],
];
const NICEM_DESENI = /(?:^|[-_.])(I?Q[1-8]_K(?:_[SMLX]{1,2})?|IQ[1-4]_(?:NL|XXS|XS|S|M)|Q[2-8]_[01]|Q[2-8]_K|BF16|F16|FP16|F32)(?=[-_.]|$)/i;

function nicemAl(dosyaAdi) {
  const m = NICEM_DESENI.exec(path.basename(String(dosyaAdi || "")).replace(/\.gguf$/i, "."));
  return m ? m[1].toUpperCase() : "";
}
function nicemKalitesi(nicem) {
  for (const [desen, puan] of NICEM_KALITE) if (desen.test(nicem)) return puan;
  return 0;
}

function bicimle(bayt) {
  const b = Number(bayt) || 0;
  if (b <= 0) return "?";
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1).replace(".", ",")} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}
const GB = 1024 ** 3;

// Dosya adı güvenli mi: alt klasör/.. yok, yalnızca makul karakterler
function guvenliAd(ad) {
  const b = path.basename(String(ad || "")).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
  if (!b || b === "." || b === ".." || b.startsWith(".")) return "";
  return b;
}
function guvenliDepoYolu(yol) {
  const s = String(yol || "");
  if (!s || s.length > 400 || s.includes("\\") || s.includes("\0") || s.startsWith("/")) return false;
  return s.split("/").every((p) => p && p !== "." && p !== "..");
}

// --------------------------------------------------------------------------
// Donanım özeti: paylaşımlı bellek (tümleşik ekran kartı) VRAM sayılmaz
// --------------------------------------------------------------------------
function donanimOzeti(specs = {}) {
  const ram = Math.max(0, Number(specs.ram_total_gb) || 0);
  const gpuAd = String(specs.gpu_name || "");
  const intelTumlesik = /intel/i.test(gpuAd) && !/\barc\b/i.test(gpuAd.replace(/\(tm\)/gi, " "));
  const tumlesik = intelTumlesik || /radeon\(tm\)\s*graphics|^amd radeon graphics|radeon\s+graphics$|vega\s*\d+\s*graphics|microsoft basic|llvmpipe|virtual|parsec|unknown/i.test(gpuAd) || !gpuAd;
  const apple = /apple/i.test(String(specs.cpu_name || "")) || /apple/i.test(gpuAd);
  // Donanım algılaması ayrık (dedicated) VRAM'i ayrıca veriyorsa o kullanılır; yoksa ada göre tümleşik kart elenir
  const ayrikAlan = [specs.gpu_dedicated_vram_gb, specs.dedicated_vram_gb].find((x) => typeof x === "number" && Number.isFinite(x));
  const vram = apple ? 0 : ayrikAlan !== undefined ? Math.max(0, ayrikAlan) : tumlesik ? 0 : Math.max(0, Number(specs.gpu_vram_gb) || 0);
  const rezerv = Math.max(4, ram * 0.3);
  const kullanilabilirRam = Math.max(0, ram - rezerv);
  const cekirdek = Math.max(1, Number(specs.cpu_cores_logical) || 4);
  // Etkin bellek bant genişliği (GB/sn) kaba tahmini: CPU'da jeton hızı ≈ bant / model boyutu
  const bant = apple ? 60 : cekirdek <= 4 ? 10 : cekirdek <= 8 ? 18 : 30;
  return {
    ram, vram, ayrikGpu: vram >= 2, apple, tumlesik, gpuAd, cekirdek, kullanilabilirRam, bant,
    ozet: `${ram} GB RAM` + (vram >= 2 ? `, ${vram} GB VRAM (${gpuAd})` : apple ? " (birleşik bellek)" : `, ayrık ekran kartı yok${gpuAd ? ` (${gpuAd}; paylaşımlı bellek VRAM sayılmaz)` : ""}`),
  };
}

// --------------------------------------------------------------------------
// Uyum tahminleri (türe göre)
// --------------------------------------------------------------------------
function seviyeEtiketi(seviye) {
  return { rahat: "Rahat çalışır", sigar: "Sığar (sınırda)", sigmaz: "Bu bilgisayara sığmaz", bilinmiyor: "Tahmin edilemedi" }[seviye] || "";
}

function metinUyumu(boyut, d) {
  if (!boyut) return { seviye: "bilinmiyor", etiket: seviyeEtiketi("bilinmiyor"), neden: "Dosya boyutu bilinmiyor." };
  const gb = boyut / GB;
  const gerek = gb * 1.15 + 0.8; // ağırlıklar + 4K bağlam önbelleği + çalışma payı
  const gpuSigar = d.vram > 0 && d.vram >= gerek;
  const bellek = d.apple ? d.kullanilabilirRam : d.kullanilabilirRam;
  let seviye = "sigmaz";
  if (gpuSigar || gerek <= bellek * 0.7) seviye = "rahat";
  else if (gerek <= bellek) seviye = "sigar";
  const hiz = (gpuSigar ? 150 : d.bant) / Math.max(0.1, gb);
  const neden = seviye === "sigmaz"
    ? `Yaklaşık ${gerek.toFixed(1).replace(".", ",")} GB bellek ister; bu bilgisayarda kullanılabilir ~${bellek.toFixed(1).replace(".", ",")} GB var.`
    : `Yaklaşık ${gerek.toFixed(1).replace(".", ",")} GB bellek ister (${gpuSigar ? "ekran kartı belleğinde" : "sistem belleğinde"}).`;
  return { seviye, etiket: seviyeEtiketi(seviye), neden, hiz: Math.round(hiz * 10) / 10, hizMetni: `~${hiz >= 10 ? Math.round(hiz) : hiz.toFixed(1).replace(".", ",")} jeton/sn` };
}

function gorselMimari(metin) {
  const s = String(metin || "").toLowerCase();
  if (/flux|sd3|stable-diffusion-3|hidream|qwen-image|hunyuan|cogview|kolors|auraflow|lumina|chroma/.test(s)) return "agir";
  if (/sdxl|[-_ ]xl[-_ .]|stable-diffusion-xl|pony|illustrious|noobai|playground-v2/.test(s + " ")) return "sdxl";
  return "sd15";
}

function gorselUyumu(boyut, d, mimari, hizli) {
  if (!boyut) return { seviye: "bilinmiyor", etiket: seviyeEtiketi("bilinmiyor"), neden: "Dosya boyutu bilinmiyor." };
  const gb = boyut / GB;
  const ek = mimari === "agir" ? 6 : mimari === "sdxl" ? 3.5 : 2;
  const gerek = gb * 1.2 + ek;
  const gpuSigar = d.vram >= gerek;
  let seviye = "sigmaz";
  if (gpuSigar || gerek <= d.kullanilabilirRam * 0.7) seviye = "rahat";
  else if (gerek <= d.kullanilabilirRam) seviye = "sigar";
  // Ölçüm: i5-7200U + HD 620'de SD1.5 512px ≈ 6,2 sn/adım. Çekirdek sayısıyla kabaca ölçeklenir.
  const adim = hizli ? 6 : 20;
  let snAdim = 6.2 * (4 / Math.min(16, d.cekirdek));
  if (mimari === "sdxl") snAdim *= 5;
  if (mimari === "agir") snAdim *= 20;
  if (gpuSigar) snAdim /= 15;
  const sure = snAdim * adim;
  const sureMetni = sure < 90 ? `~${Math.round(sure)} sn/görsel` : `~${Math.round(sure / 60)} dk/görsel`;
  const cozunurluk = mimari === "sd15" ? "512px" : "1024px";
  const neden = `${mimari === "sd15" ? "SD 1.5" : mimari === "sdxl" ? "SDXL" : "Büyük (Flux/SD3 sınıfı)"} model; ~${gerek.toFixed(1).replace(".", ",")} GB bellek ister.` +
    (mimari === "agir" && !gpuSigar ? " Ekran kartı olmadan pratikte kullanılamayacak kadar yavaştır." : "");
  if (mimari === "agir" && !gpuSigar && seviye === "rahat") seviye = "sigar";
  return { seviye, etiket: seviyeEtiketi(seviye), neden, hizMetni: `${sureMetni} (${adim} adım, ${cozunurluk})` };
}

function genelUyum(boyut, d, carpan = 1.5, ek = 1) {
  if (!boyut) return { seviye: "bilinmiyor", etiket: seviyeEtiketi("bilinmiyor"), neden: "Dosya boyutu bilinmiyor." };
  const gerek = (boyut / GB) * carpan + ek;
  let seviye = "sigmaz";
  if (d.vram >= gerek || gerek <= d.kullanilabilirRam * 0.7) seviye = "rahat";
  else if (gerek <= d.kullanilabilirRam) seviye = "sigar";
  return { seviye, etiket: seviyeEtiketi(seviye), neden: `~${gerek.toFixed(1).replace(".", ",")} GB bellek ister.` };
}

const SEVIYE_PUANI = { rahat: 3, sigar: 2, bilinmiyor: 1, sigmaz: 0 };

// --------------------------------------------------------------------------
// Dosya seçiciler: depo dosya listesinden kurulabilir seçenekleri çıkarır
// dosya: { yol, boyut, sha256, gitOid }
// --------------------------------------------------------------------------
function metinSecenekleri(dosyalar, d) {
  // Yalnızca tek dosyalık GGUF: parçalı (-00001-of-0000N) ve mtp/mmproj yardımcı dosyaları model sayılmaz
  // (uygulamanın model listesi ve llama-server başlatıcısı da parçalı dosyaları desteklemiyor).
  const gguf = dosyalar.filter((f) => /\.gguf$/i.test(f.yol) && !/mmproj|(?:^|[-_/])mtp(?:[-_./]|$)/i.test(f.yol) && !/-\d{5}-of-\d{5}\.gguf$/i.test(f.yol));
  // Görü (vision) projektörü: varsa f16 olan, yoksa en küçüğü. Yerel adı "depo--dosya" olduğundan
  // serve.cjs onu aynı depo önekiyle otomatik eşleştirir.
  const mmproj = dosyalar.filter((f) => /\.gguf$/i.test(f.yol) && /mmproj/i.test(f.yol))
    .sort((a, b) => (/f16/i.test(b.yol) - /f16/i.test(a.yol)) || a.boyut - b.boyut)[0] || null;
  return gguf.map((f) => {
    const nicem = nicemAl(f.yol);
    return {
      anahtar: f.yol, etiket: nicem || path.basename(f.yol), nicem, kalite: nicemKalitesi(nicem),
      dosyalar: [f], ekDosyalar: mmproj ? [mmproj] : [], boyut: f.boyut + (mmproj ? mmproj.boyut : 0), uyum: metinUyumu(f.boyut, d),
    };
  });
}

function metinOnerisi(secenekler, d) {
  if (!secenekler.length) return null;
  const hedefHiz = d.ayrikGpu || d.apple ? 15 : 4;
  const sigan = secenekler.filter((s) => s.uyum.seviye !== "sigmaz");
  const a = sigan.filter((s) => s.kalite >= 62 && s.kalite <= 90 && s.uyum.seviye === "rahat" && (s.uyum.hiz || 0) >= hedefHiz)
    .sort((x, y) => y.kalite - x.kalite || x.boyut - y.boyut);
  if (a.length) return { secenek: a[0], neden: `${a[0].etiket} önerilir: bu bilgisayarda kalite ile hızın en iyi dengesi (${a[0].uyum.hizMetni}).` };
  const q4km = sigan.find((s) => s.nicem === "Q4_K_M");
  if (q4km) return { secenek: q4km, neden: `Q4_K_M önerilir: kalite kaybı az, bellek ve hız için en dengeli nicem (${q4km.uyum.hizMetni}).` };
  const b = sigan.filter((s) => s.kalite >= 62).sort((x, y) => x.boyut - y.boyut);
  if (b.length) return { secenek: b[0], neden: `${b[0].etiket} önerilir: belleğe sığan en dengeli seçenek (${b[0].uyum.hizMetni}).` };
  const c = [...sigan].sort((x, y) => y.kalite - x.kalite);
  if (c.length) return { secenek: c[0], neden: `${c[0].etiket} önerilir: belleğe ancak bu düşük nicem sığıyor; kalite belirgin düşer.` };
  const en = [...secenekler].sort((x, y) => x.boyut - y.boyut)[0];
  return { secenek: en, neden: "Hiçbir sürüm bu bilgisayarın belleğine sığmıyor; daha küçük bir model seçin." };
}

function gorselSecenekleri(dosyalar, d, detay) {
  const etiketMetni = `${detay.id || ""} ${(detay.tags || []).join(" ")}`;
  const adaylar = dosyalar.filter((f) => !f.yol.includes("/") && /\.(safetensors|gguf)$/i.test(f.yol))
    .filter((f) => !/(^|[-_.])(vae|lora|lycoris|controlnet|control|embedding|textual|clip|t5|t5xxl|umt5|text_encoder|te|refiner|ip-adapter|adapter|upscaler?)([-_.]|$)/i.test(f.yol))
    // 800 MB altı tek dosyalar tam bir SD modeli olamaz (LoRA/yardımcı ağırlıklar)
    .filter((f) => !f.boyut || f.boyut >= 800 * 1024 * 1024);
  return adaylar.map((f) => {
    const mimari = gorselMimari(`${etiketMetni} ${f.yol}`);
    const hizli = /lightning|turbo|lcm|hyper|schnell|dmd/i.test(`${detay.id} ${f.yol}`);
    const nicem = /\.gguf$/i.test(f.yol) ? nicemAl(f.yol) : (/fp16|half/i.test(f.yol) ? "FP16" : /fp8/i.test(f.yol) ? "FP8" : "");
    return {
      anahtar: f.yol, etiket: `${path.basename(f.yol)}`, nicem, mimari, hizli,
      dosyalar: [f], ekDosyalar: [], boyut: f.boyut, uyum: gorselUyumu(f.boyut, d, mimari, hizli),
    };
  });
}

function gorselOnerisi(secenekler, d) {
  if (!secenekler.length) return null;
  const puan = (s) => {
    let p = SEVIYE_PUANI[s.uyum.seviye] * 100;
    if (!d.ayrikGpu && s.nicem === "Q8_0") p += 30; // işlemcide daha az bellek, aynıya yakın kalite
    if (s.nicem === "FP16" || /pruned|emaonly/i.test(s.anahtar)) p += 20;
    if (/\.gguf$/i.test(s.anahtar) && nicemKalitesi(s.nicem) < 62) p -= 40;
    return p;
  };
  const sirali = [...secenekler].sort((a, b) => puan(b) - puan(a) || a.boyut - b.boyut);
  const s = sirali[0];
  const neden = s.nicem === "Q8_0" ? "Q8_0 GGUF önerilir: ekran kartı olmadan daha az bellek, kalite neredeyse aynı."
    : s.nicem === "FP16" ? "FP16 sürüm önerilir: tam sürümün yarı boyutu, aynı kalite." : `${s.etiket} önerilir.`;
  return { secenek: s, neden };
}

const WHISPER_SINIF = { tiny: 1, base: 2, small: 3, medium: 4, "large-v3-turbo": 5, large: 6 };
function whisperBilgi(ad) {
  const s = path.basename(ad).toLowerCase();
  let sinif = "";
  for (const k of ["large-v3-turbo", "tiny", "base", "small", "medium", "large"]) if (s.includes(k)) { sinif = k; break; }
  const nicem = (/(q5_0|q5_1|q8_0|q4_0|q4_1)/.exec(s) || [])[1] || "f16";
  return { sinif, sinifPuani: WHISPER_SINIF[sinif] || 0, nicem, ingilizce: /\.en[.-]/.test(s) };
}

function konusmaSecenekleri(dosyalar, d) {
  return dosyalar.filter((f) => !f.yol.includes("/") && /\.bin$/i.test(f.yol))
    .filter((f) => /ggml/i.test(f.yol) && !/(pytorch_model|training_args|optimizer|scheduler|rng_state|encoder)/i.test(f.yol))
    .map((f) => {
      const b = whisperBilgi(f.yol);
      return {
        anahtar: f.yol, etiket: `${b.sinif || path.basename(f.yol)}${b.ingilizce ? " (İngilizce)" : ""} ${b.nicem.toUpperCase()}`.trim(), nicem: b.nicem.toUpperCase(),
        whisper: b, dosyalar: [f], ekDosyalar: [], boyut: f.boyut, uyum: genelUyum(f.boyut, d, 2, 0.3),
      };
    });
}

function konusmaOnerisi(secenekler, d, sorgu) {
  if (!secenekler.length) return null;
  const butce = d.ayrikGpu ? 3.5 * GB : d.cekirdek <= 4 ? 300 * 1024 ** 2 : 1.7 * GB;
  const ingilizceIstendi = /\b(en|english|ingilizce)\b/i.test(sorgu || "");
  const nicemSirasi = { q5_1: 5, q5_0: 4, q8_0: 3, q4_1: 2, q4_0: 1, f16: 0 };
  const aday = secenekler.filter((s) => s.boyut <= butce && s.uyum.seviye !== "sigmaz" && (ingilizceIstendi || !s.whisper.ingilizce));
  const havuz = aday.length ? aday : secenekler.filter((s) => s.uyum.seviye !== "sigmaz");
  if (!havuz.length) return { secenek: secenekler[0], neden: "Bu bilgisayara uygun sürüm bulunamadı." };
  havuz.sort((a, b) => b.whisper.sinifPuani - a.whisper.sinifPuani || (nicemSirasi[b.whisper.nicem] || 0) - (nicemSirasi[a.whisper.nicem] || 0));
  const s = havuz[0];
  return { secenek: s, neden: `${s.etiket} önerilir: bu işlemcide hız ile doğruluğun dengesi${s.whisper.nicem.startsWith("q") ? " (nicemli sürüm daha hızlı)" : ""}.` };
}

function seslendirmeSecenekleri(dosyalar, d, sorgu) {
  const yollar = new Set(dosyalar.map((f) => f.yol));
  const kelimeler = String(sorgu || "").toLowerCase().replace(/türkçe|turkce|turkish/g, "tr_tr").split(/\s+/).filter((k) => k && k !== "piper");
  let liste = dosyalar.filter((f) => /\.onnx$/i.test(f.yol) && yollar.has(`${f.yol}.json`));
  if (kelimeler.length) {
    const suzulmus = liste.filter((f) => kelimeler.every((k) => f.yol.toLowerCase().includes(k)));
    if (suzulmus.length) liste = suzulmus;
  }
  return liste.slice(0, 40).map((f) => {
    const json = dosyalar.find((x) => x.yol === `${f.yol}.json`);
    const kalite = (/(x_low|low|medium|high)/i.exec(path.basename(f.yol)) || [])[1] || "";
    return {
      anahtar: f.yol, etiket: path.basename(f.yol, ".onnx"), nicem: kalite, dosyalar: [f, json], ekDosyalar: [],
      boyut: f.boyut + (json ? json.boyut : 0), uyum: genelUyum(f.boyut, d, 2, 0.2),
    };
  });
}
function seslendirmeOnerisi(secenekler) {
  if (!secenekler.length) return null;
  const s = secenekler.find((x) => /medium/i.test(x.nicem)) || secenekler[0];
  return { secenek: s, neden: /medium/i.test(s.nicem) ? "medium kalite önerilir: işlemcide hızlı, sesi temiz." : `${s.etiket} önerilir.` };
}

// Müzik / video: Python çalışanı yalnızca desteklenen mimarileri açabilir; boyut bilgisi safetensors toplamı
function pythonSecenekleri(dosyalar, d) {
  const st = dosyalar.filter((f) => /\.safetensors$/i.test(f.yol));
  if (!st.length) return [];
  const boyut = st.reduce((t, f) => t + f.boyut, 0);
  return [{ anahtar: "*", etiket: "Tüm depo (safetensors)", nicem: "", dosyalar: st, ekDosyalar: [], boyut, uyum: genelUyum(boyut, d, 1.6, 2) }];
}

// ============================================================================
module.exports = function modelArama(ctx) {
  const {
    ROOT, json, readJsonBody, pathInside, getHardwareSpecs, startModelDownload, indirmeDurumu,
    klasorler = {}, OZ = null, STUDYO = null,
  } = ctx;
  const log = typeof ctx.log === "function" ? ctx.log : console.log;
  const fetchImpl = ctx.fetch || globalThis.fetch;
  const simdi = ctx.simdi || (() => Date.now());
  const hfAnahtari = typeof ctx.hfAnahtari === "function" ? ctx.hfAnahtari : (() => (OZ && OZ.hfAnahtari ? OZ.hfAnahtari() : (process.env.HF_TOKEN || "")));
  const bekle = ctx.bekle || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const CONFIG = path.join(ROOT, "app", "config");
  const MANIFEST = path.join(CONFIG, "model-surumleri.json");
  try { fs.mkdirSync(CONFIG, { recursive: true }); } catch (_) {}

  // ------------------------------------------------------------------------
  // Yerel dosyalar (atomik yazım)
  // ------------------------------------------------------------------------
  function jsonOku(dosya, varsayilan) {
    try { const v = JSON.parse(fs.readFileSync(dosya, "utf8")); return v && typeof v === "object" ? v : varsayilan; } catch (_) { return varsayilan; }
  }
  function jsonYaz(dosya, veri) {
    fs.mkdirSync(path.dirname(dosya), { recursive: true });
    const gecici = `${dosya}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(gecici, JSON.stringify(veri, null, 2), "utf8");
    fs.renameSync(gecici, dosya);
  }
  function manifestOku() {
    const m = jsonOku(MANIFEST, {});
    return { surum: 1, modeller: (m.modeller && typeof m.modeller === "object") ? m.modeller : {}, paketler: (m.paketler && typeof m.paketler === "object") ? m.paketler : {} };
  }
  function manifestYaz(m) { jsonYaz(MANIFEST, m); }

  // ------------------------------------------------------------------------
  // Ağ: yalnızca huggingface.co/api ve api.github.com
  // ------------------------------------------------------------------------
  function izinliSorguAdresi(u) {
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
    if (u.hostname === "huggingface.co" && u.pathname.startsWith("/api/")) return "hf";
    if (u.hostname === "api.github.com") return "gh";
    return null;
  }

  async function guvenliJson(adres, { zamanAsimiMs = 15000, azamiBayt = 40 * 1024 * 1024 } = {}) {
    let u = new URL(adres);
    for (let yonlendirme = 0; yonlendirme < 4; yonlendirme += 1) {
      const tur = izinliSorguAdresi(u);
      if (!tur) throw new Error("İzin verilmeyen adres: " + u.origin + u.pathname);
      const basliklar = { "User-Agent": "Yerel-AI-Studyosu/1.0", Accept: tur === "gh" ? "application/vnd.github+json" : "application/json" };
      if (tur === "gh") basliklar["X-GitHub-Api-Version"] = "2022-11-28";
      const anahtar = tur === "hf" ? String(hfAnahtari() || "").trim() : "";
      if (anahtar && /^[\x21-\x7e]{8,200}$/.test(anahtar)) basliklar.Authorization = `Bearer ${anahtar}`;
      const yanit = await fetchImpl(u.toString(), { headers: basliklar, redirect: "manual", signal: AbortSignal.timeout(zamanAsimiMs) });
      if ([301, 302, 303, 307, 308].includes(yanit.status)) {
        const konum = yanit.headers.get("location");
        if (!konum) throw new Error("Yönlendirme adresi yok");
        const yeni = new URL(konum, u);
        if (yeni.hostname !== u.hostname) throw new Error("Başka bir sunucuya yönlendirme reddedildi: " + yeni.hostname);
        u = yeni;
        continue;
      }
      const tampon = Buffer.from(await yanit.arrayBuffer());
      if (tampon.length > azamiBayt) throw new Error("Yanıt çok büyük");
      let veri = null;
      try { veri = JSON.parse(tampon.toString("utf8") || "null"); } catch (_) {}
      if (!yanit.ok) {
        const hata = new Error((veri && (veri.error || veri.message)) || `HTTP ${yanit.status}`);
        hata.status = yanit.status;
        throw hata;
      }
      if (veri === null) throw new Error("Geçersiz JSON yanıtı");
      return veri;
    }
    throw new Error("Çok fazla yönlendirme");
  }

  function agHatasiMi(err) {
    if (!err) return false;
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    const kod = err.code || (err.cause && (err.cause.code || (err.cause.cause && err.cause.cause.code)));
    if (kod && AG_HATA_KODLARI.has(kod)) return true;
    return /fetch failed|network|getaddrinfo|socket hang up/i.test(String(err.message || ""));
  }

  // ------------------------------------------------------------------------
  // Hugging Face yardımcıları
  // ------------------------------------------------------------------------
  const detayOnbellegi = new Map(); // repo -> { zaman, veri }
  async function hfDetay(repo, { taze = false } = {}) {
    if (!REPO_DESENI.test(repo)) throw new Error("Geçersiz depo adı");
    const onceki = detayOnbellegi.get(repo);
    if (!taze && onceki && simdi() - onceki.zaman < 10 * 60 * 1000) return onceki.veri;
    const veri = await guvenliJson(`https://huggingface.co/api/models/${repo}?blobs=true`);
    if (!veri || typeof veri !== "object" || !Array.isArray(veri.siblings)) throw new Error("Hugging Face yanıtı beklenen biçimde değil");
    detayOnbellegi.set(repo, { zaman: simdi(), veri });
    if (detayOnbellegi.size > 200) detayOnbellegi.delete(detayOnbellegi.keys().next().value);
    return veri;
  }
  function hfDosyalari(detay) {
    return (detay.siblings || []).filter((s) => s && typeof s.rfilename === "string" && guvenliDepoYolu(s.rfilename)).map((s) => ({
      yol: s.rfilename,
      boyut: Number((s.lfs && s.lfs.size) || s.size || 0),
      sha256: s.lfs && SHA256.test(String(s.lfs.sha256 || "").toLowerCase()) ? String(s.lfs.sha256).toLowerCase() : "",
      gitOid: !s.lfs && SHA40.test(String(s.blobId || "")) ? String(s.blobId) : "",
    }));
  }
  function hfAgacDosyalari(agac) {
    return (Array.isArray(agac) ? agac : []).filter((x) => x && x.type === "file" && guvenliDepoYolu(x.path)).map((x) => ({
      yol: x.path,
      boyut: Number((x.lfs && x.lfs.size) || x.size || 0),
      sha256: x.lfs && SHA256.test(String(x.lfs.oid || "")) ? String(x.lfs.oid) : "",
      gitOid: !x.lfs && SHA40.test(String(x.oid || "")) ? String(x.oid) : "",
    }));
  }
  function hfLisans(detay) {
    const kart = detay.cardData && typeof detay.cardData === "object" ? detay.cardData : {};
    let l = kart.license || ((detay.tags || []).find((t) => String(t).startsWith("license:")) || "").slice(8);
    if (Array.isArray(l)) l = l.join(", ");
    l = String(l || "").trim();
    const ad = kart.license_name ? String(kart.license_name) : "";
    return { lisans: l === "other" && ad ? ad : l, bilinmiyor: !l || /^(other|unknown)$/i.test(l) && !ad, ticariDegil: /(^|[-_ ])nc([-_ ]|$)|non-commercial|noncommercial|research/i.test(`${l} ${ad}`) };
  }
  function hfOzelKod(detay) {
    return (detay.tags || []).includes("custom_code") || Boolean(detay.config && detay.config.auto_map);
  }
  function hfUrl(repo, surum, yol) {
    if (!REPO_DESENI.test(repo) || !SHA40.test(surum) || !guvenliDepoYolu(yol)) throw new Error("Geçersiz indirme adresi");
    return `https://huggingface.co/${repo}/resolve/${surum}/${yol.split("/").map(encodeURIComponent).join("/")}`;
  }

  // ------------------------------------------------------------------------
  // Kart: bir depo için uyum, uyarılar, seçenekler
  // ------------------------------------------------------------------------
  function secenekleriCikar(tur, dosyalar, d, detay, sorgu) {
    if (tur === "text") return { secenekler: metinSecenekleri(dosyalar, d), oneri: (s) => metinOnerisi(s, d) };
    if (tur === "image") return { secenekler: gorselSecenekleri(dosyalar, d, detay), oneri: (s) => gorselOnerisi(s, d) };
    if (tur === "speech") return { secenekler: konusmaSecenekleri(dosyalar, d), oneri: (s) => konusmaOnerisi(s, d, sorgu) };
    if (tur === "tts") return { secenekler: seslendirmeSecenekleri(dosyalar, d, sorgu), oneri: (s) => seslendirmeOnerisi(s) };
    return { secenekler: pythonSecenekleri(dosyalar, d), oneri: (s) => (s.length ? { secenek: s[0], neden: "" } : null) };
  }

  function studyoModeliBul(repo) {
    if (!STUDYO || !OZ || !OZ.PAKETLER) return null;
    const paketIdleri = Object.entries(OZ.PAKETLER).filter(([, p]) => p.repo === repo).map(([id]) => id);
    if (!paketIdleri.length) return null;
    return [...(STUDYO.MUZIK_MODELLERI || []), ...(STUDYO.VIDEO_MODELLERI || [])]
      .find((m) => m.supported !== false && m.kurulabilir !== false && (m.paketler || []).some((p) => paketIdleri.includes(p))) || null;
  }

  function kartOlustur(tur, detay, d, sorgu) {
    const dosyalar = hfDosyalari(detay);
    const cikan = secenekleriCikar(tur, dosyalar, d, detay, sorgu);
    const { oneri } = cikan;
    let { secenekler } = cikan;
    // Flux / SD3 sınıfı görsel modeller ayrı metin kodlayıcı + VAE dosyaları ister: tek dosyayla çalışmaz
    const agirlar = tur === "image" ? secenekler.filter((x) => x.mimari === "agir") : [];
    if (agirlar.length) secenekler = secenekler.filter((x) => x.mimari !== "agir");
    const lisans = hfLisans(detay);
    const ozelKod = hfOzelKod(detay);
    const uyarilar = [];
    let engel = "";
    if (detay.gated) uyarilar.push({ kod: "gated", onayGerekir: true, metin: "Kapılı model: Hugging Face sayfasında lisansı kabul etmeniz ve Hugging Face anahtarı tanımlamanız gerekir." });
    if (lisans.bilinmiyor) uyarilar.push({ kod: "lisans", onayGerekir: true, metin: "Lisans belirtilmemiş ya da standart dışı: kullanım koşullarını model sayfasından okuyun." });
    else if (lisans.ticariDegil) uyarilar.push({ kod: "ticari", onayGerekir: false, metin: `Lisans (${lisans.lisans}) ticari kullanıma izin vermiyor olabilir.` });
    const python = TURLER[tur].yukleyici === "python";
    if (ozelKod) {
      if (python) engel = "Bu depo özel Python kodu (trust_remote_code) gerektiriyor; güvenlik nedeniyle kurulmaz.";
      else uyarilar.push({ kod: "kod", onayGerekir: false, metin: "Depoda özel kod var; bu uygulama onu indirmez ve çalıştırmaz (yalnızca model dosyası alınır)." });
    }
    if (!secenekler.length && !engel && agirlar.length) {
      engel = "Flux / SD3 sınıfı modeller ayrı metin kodlayıcı ve VAE dosyaları ister; bu uygulama tek dosyalık kurulumla çalıştıramaz.";
    }
    if (!secenekler.length && !engel) {
      const pickle = dosyalar.some((f) => PICKLE_UZANTISI.test(f.yol) && !(tur === "speech" && /ggml/i.test(f.yol)));
      engel = pickle ? "Bu depoda yalnızca pickle biçimli dosyalar (.ckpt/.pt/.pth/.bin) var; bu biçim kod çalıştırabildiği için kurulmaz."
        : "Bu depoda bu model türü için uygun dosya bulunamadı.";
    }
    let kurulabilir = !engel;
    let studyoModeli = null;
    if (python && !engel) {
      studyoModeli = studyoModeliBul(detay.id);
      if (!studyoModeli) {
        kurulabilir = false;
        engel = "Stüdyonun çalışanı yalnızca desteklediği mimarileri açabilir; bu model şimdilik bilgi amaçlı gösteriliyor.";
      }
    }
    const o = oneri(secenekler);
    const sirali = [...secenekler].sort((a, b) => (o && a === o.secenek ? -1 : o && b === o.secenek ? 1 : 0)
      || SEVIYE_PUANI[b.uyum.seviye] - SEVIYE_PUANI[a.uyum.seviye] || (b.kalite || 0) - (a.kalite || 0) || a.boyut - b.boyut);
    const disariSecenek = (s) => ({
      anahtar: s.anahtar, etiket: s.etiket, nicem: s.nicem || "", boyut: s.boyut, boyutMetni: bicimle(s.boyut),
      dosyalar: [...s.dosyalar, ...(s.ekDosyalar || [])].map((f) => ({ yol: f.yol, boyut: f.boyut })), uyum: s.uyum,
    });
    return {
      kaynak: "hf", tur, repo: detay.id, ad: String(detay.id || "").split("/").pop(), sahip: String(detay.id || "").split("/")[0],
      sayfa: `https://huggingface.co/${detay.id}`, sha: SHA40.test(String(detay.sha || "")) ? detay.sha : "",
      lisans: lisans.lisans || "belirtilmemiş", indirme: Number(detay.downloads || 0), begeni: Number(detay.likes || 0),
      guncelleme: detay.lastModified || "", gated: Boolean(detay.gated), ozelKod, uyarilar, engel, kurulabilir,
      studyoModeli: studyoModeli ? { id: studyoModeli.id, ad: studyoModeli.name } : null,
      secenekler: sirali.slice(0, 30).map(disariSecenek),
      onerilen: o ? o.secenek.anahtar : "", oneri: o ? o.neden : "", uyum: o ? o.secenek.uyum : null,
      boyut: o ? o.secenek.boyut : 0, boyutMetni: o ? bicimle(o.secenek.boyut) : "?",
    };
  }

  // Liste aşamasında (ayrıntı çekmeden) kaba ön eleme / sıralama
  function listeUygunMu(tur, model) {
    const adlar = (model.siblings || []).map((s) => String(s && s.rfilename || ""));
    if (!adlar.length) return true; // liste dosya göstermiyorsa ayrıntıda bakılır
    if (tur === "text") return adlar.some((a) => /\.gguf$/i.test(a) && !/mmproj/i.test(a));
    if (tur === "image") return adlar.some((a) => !a.includes("/") && /\.(safetensors|gguf)$/i.test(a));
    if (tur === "speech") return adlar.some((a) => /ggml.*\.bin$/i.test(a));
    if (tur === "tts") return adlar.some((a) => /\.onnx$/i.test(a)) && adlar.some((a) => /\.onnx\.json$/i.test(a));
    return adlar.some((a) => /\.safetensors$/i.test(a));
  }
  function onPuan(tur, model, d) {
    let puan = Math.log10(1 + Number(model.downloads || 0)) * 10;
    if (tur === "text") {
      const m = [...String(model.id || "").matchAll(/(?:^|[-_/ ])(\d+(?:\.\d+)?)\s*b(?:[-_/ ]|$)/gi)].map((x) => Number(x[1]));
      if (m.length) {
        const q4 = Math.min(...m) * 0.6 * 1.15 + 0.8;
        puan += q4 <= d.kullanilabilirRam * 0.7 ? 30 : q4 <= d.kullanilabilirRam ? 10 : -30;
      }
    }
    return puan;
  }

  const aramaOnbellegi = new Map();
  async function hfAra(tur, sorgu, sayfa) {
    const t = TURLER[tur];
    const d = donanimOzeti(getHardwareSpecs());
    let arama = String(sorgu || "").replace(/türkçe|turkce/gi, "turkish").trim();
    if (tur === "tts") arama = arama.replace(/turkish/gi, "").trim(); // Piper'da dil dosya adında: süzme dosya düzeyinde
    if (!arama && t.varsayilanArama) arama = t.varsayilanArama;
    const anahtar = `${tur}|${arama}|${sayfa}`;
    const onceki = aramaOnbellegi.get(anahtar);
    if (onceki && simdi() - onceki.zaman < 10 * 60 * 1000) return onceki.veri;
    const p = new URLSearchParams({ ...t.hf, sort: "downloads", direction: "-1", limit: "40", full: "true" });
    if (arama) p.set("search", arama.slice(0, 80));
    const liste = await guvenliJson(`https://huggingface.co/api/models?${p.toString()}`);
    const adaylar = (Array.isArray(liste) ? liste : [])
      .filter((m) => m && REPO_DESENI.test(String(m.id || "")) && !m.private && !m.disabled && listeUygunMu(tur, m))
      .sort((a, b) => onPuan(tur, b, d) - onPuan(tur, a, d));
    const boyut = 8;
    const dilim = adaylar.slice((sayfa - 1) * boyut, sayfa * boyut);
    const kartlar = [];
    for (let i = 0; i < dilim.length; i += 4) {
      const grup = await Promise.all(dilim.slice(i, i + 4).map(async (m) => {
        try { return kartOlustur(tur, await hfDetay(m.id), d, sorgu); } catch (err) { return null; }
      }));
      kartlar.push(...grup.filter(Boolean));
    }
    // En iyi uyumlu sürüm önce: kurulabilir > uyum seviyesi > indirme
    kartlar.sort((a, b) => (b.kurulabilir - a.kurulabilir)
      || SEVIYE_PUANI[(b.uyum && b.uyum.seviye) || "bilinmiyor"] - SEVIYE_PUANI[(a.uyum && a.uyum.seviye) || "bilinmiyor"]
      || b.indirme - a.indirme);
    const veri = { ok: true, kaynak: "hf", tur, sayfa, dahaVar: adaylar.length > sayfa * boyut, donanim: d.ozet, modeller: kartlar };
    aramaOnbellegi.set(anahtar, { zaman: simdi(), veri });
    if (aramaOnbellegi.size > 100) aramaOnbellegi.delete(aramaOnbellegi.keys().next().value);
    return veri;
  }

  // ------------------------------------------------------------------------
  // GitHub sürüm dosyaları (yalnızca "sahip/depo" ya da github.com adresi girildiğinde)
  // ------------------------------------------------------------------------
  const GH_UZANTI = { text: /\.gguf$/i, image: /\.(safetensors|gguf)$/i, speech: /^ggml-.*\.bin$/i, tts: /\.onnx(\.json)?$/i };
  function ghDepo(sorgu) {
    const m = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(String(sorgu || "").trim());
    return m ? `${m[1]}/${m[2]}` : "";
  }
  function ghSecenekleri(tur, surum, d) {
    const desen = GH_UZANTI[tur];
    if (!desen) return [];
    const varliklar = (surum.assets || []).filter((a) => a && desen.test(String(a.name || "")) && guvenliAd(a.name) === a.name);
    const sha = (a) => { const m = /^sha256:([0-9a-f]{64})$/i.exec(String(a.digest || "")); return m ? m[1].toLowerCase() : ""; };
    const dosya = (a) => ({ yol: a.name, boyut: Number(a.size || 0), sha256: sha(a), gitOid: "", url: String(a.browser_download_url || "") });
    if (tur === "tts") {
      return varliklar.filter((a) => /\.onnx$/i.test(a.name)).map((a) => {
        const j = varliklar.find((x) => x.name === `${a.name}.json`);
        if (!j) return null;
        return { anahtar: a.name, etiket: a.name, nicem: "", dosyalar: [dosya(a), dosya(j)], ekDosyalar: [], boyut: a.size + j.size, uyum: genelUyum(a.size, d, 2, 0.2) };
      }).filter(Boolean);
    }
    return varliklar.map((a) => {
      const f = dosya(a);
      const nicem = nicemAl(a.name);
      const uyum = tur === "text" ? metinUyumu(f.boyut, d) : tur === "image" ? gorselUyumu(f.boyut, d, gorselMimari(a.name), false) : genelUyum(f.boyut, d, 2, 0.3);
      return { anahtar: a.name, etiket: nicem || a.name, nicem, kalite: nicemKalitesi(nicem), dosyalar: [f], ekDosyalar: [], boyut: f.boyut, uyum };
    });
  }
  async function ghSonSurum(repo) {
    if (!ghDepo(repo) || ghDepo(repo) !== repo) throw new Error("Geçersiz GitHub deposu");
    const liste = await guvenliJson(`https://api.github.com/repos/${repo}/releases?per_page=10`);
    return (Array.isArray(liste) ? liste : []).find((r) => r && !r.draft && !r.prerelease) || null;
  }
  // GitHub depo araması (konu etiketiyle daraltılır). Sonuçlar yalnızca depo kartıdır; kurulabilir dosyalar
  // "sahip/depo" ile o deponun son sürümü açıldığında listelenir.
  const GH_KONU = { text: "gguf", image: "stable-diffusion", speech: "whisper", tts: "piper" };
  async function ghDepoAra(tur, sorgu) {
    const d = donanimOzeti(getHardwareSpecs());
    const kelime = String(sorgu || "").replace(/[^\p{L}\p{N} ._-]/gu, " ").trim().slice(0, 60);
    const q = `${kelime ? kelime + " " : ""}topic:${GH_KONU[tur]}`;
    const anahtar = `gh|${tur}|${q}`;
    const onceki = aramaOnbellegi.get(anahtar);
    if (onceki && simdi() - onceki.zaman < 10 * 60 * 1000) return onceki.veri;
    const r = await guvenliJson(`https://api.github.com/search/repositories?${new URLSearchParams({ q, sort: "stars", order: "desc", per_page: "12" })}`);
    const modeller = (Array.isArray(r && r.items) ? r.items : []).filter((x) => x && ghDepo(String(x.full_name || "")) === x.full_name && !x.archived).map((x) => ({
      kaynak: "github", tur, repo: x.full_name, ad: x.name, sahip: String(x.full_name).split("/")[0], sayfa: `https://github.com/${x.full_name}`,
      sha: "", lisans: (x.license && (x.license.spdx_id || x.license.name)) || "belirtilmemiş", indirme: 0, begeni: Number(x.stargazers_count || 0),
      guncelleme: x.pushed_at || "", gated: false, ozelKod: false, uyarilar: [], engel: "", kurulabilir: false, githubDepo: x.full_name,
      aciklama: String(x.description || "").slice(0, 240), secenekler: [], onerilen: "", oneri: "", uyum: null, boyut: 0, boyutMetni: "?",
    }));
    const veri = { ok: true, kaynak: "github", tur, sayfa: 1, dahaVar: false, donanim: d.ozet, modeller,
      bilgi: "Bir depoyu seçip \"Sürüm dosyalarını göster\" ile son sürümdeki kurulabilir dosyaları görün. Motor (exe/zip) dosyaları güvenlik nedeniyle buradan kurulmaz." };
    aramaOnbellegi.set(anahtar, { zaman: simdi(), veri });
    return veri;
  }

  async function ghAra(tur, sorgu) {
    if (!GH_UZANTI[tur]) return { ok: true, kaynak: "github", tur, sayfa: 1, dahaVar: false, modeller: [], bilgi: "Bu model türü GitHub sürüm dosyalarından kurulmaz." };
    const repo = ghDepo(sorgu);
    if (!repo) return ghDepoAra(tur, sorgu);
    const d = donanimOzeti(getHardwareSpecs());
    const depo = await guvenliJson(`https://api.github.com/repos/${repo}`);
    const surum = await ghSonSurum(repo);
    const secenekler = surum ? ghSecenekleri(tur, surum, d) : [];
    const ozetsiz = secenekler.filter((s) => s.dosyalar.some((f) => !f.sha256));
    const gecerli = secenekler.filter((s) => !ozetsiz.includes(s));
    const o = tur === "text" ? metinOnerisi(gecerli, d) : gecerli.length ? { secenek: gecerli[0], neden: "" } : null;
    const lisans = (depo.license && (depo.license.spdx_id || depo.license.name)) || "";
    const uyarilar = [];
    if (!lisans || lisans === "NOASSERTION") uyarilar.push({ kod: "lisans", onayGerekir: true, metin: "Lisans belirtilmemiş: kullanım koşullarını depo sayfasından okuyun." });
    uyarilar.push({ kod: "github", onayGerekir: true, metin: "GitHub sürüm dosyaları topluluk tarafından yüklenir; yalnızca güvendiğiniz depolardan kurun." });
    let engel = "";
    if (!surum) engel = "Bu depoda yayımlanmış sürüm yok.";
    else if (!gecerli.length) engel = ozetsiz.length ? "Sürüm dosyalarının SHA256 özeti yayımlanmamış; doğrulanamayan dosya kurulmaz." : "Sürümde bu model türü için uygun dosya yok.";
    return {
      ok: true, kaynak: "github", tur, sayfa: 1, dahaVar: false, donanim: d.ozet,
      modeller: [{
        kaynak: "github", tur, repo, ad: repo.split("/")[1], sahip: repo.split("/")[0], sayfa: `https://github.com/${repo}/releases`,
        sha: "", etiketSurum: surum ? String(surum.tag_name || "") : "", lisans: lisans || "belirtilmemiş",
        indirme: 0, begeni: Number(depo.stargazers_count || 0), guncelleme: surum ? surum.published_at : depo.pushed_at,
        gated: false, ozelKod: false, uyarilar, engel, kurulabilir: !engel,
        secenekler: gecerli.map((s) => ({ anahtar: s.anahtar, etiket: s.etiket, nicem: s.nicem, boyut: s.boyut, boyutMetni: bicimle(s.boyut), dosyalar: s.dosyalar.map((f) => ({ yol: f.yol, boyut: f.boyut })), uyum: s.uyum })),
        onerilen: o ? o.secenek.anahtar : "", oneri: o ? o.neden : "", uyum: o ? o.secenek.uyum : null,
        boyut: o ? o.secenek.boyut : 0, boyutMetni: o ? bicimle(o.secenek.boyut) : "?",
      }],
    };
  }

  // ------------------------------------------------------------------------
  // İndirme + doğrulama + yerine taşıma (önceki sürüm doğrulanana kadar korunur)
  // ------------------------------------------------------------------------
  let is = { aktif: false, tur: "", ad: "", asama: "", adim: 0, toplam: 0, hata: null, sonuc: null, bitti: null, kimlik: "" };
  const isSirasi = [];

  async function dosyaSha256(dosya) {
    const h = crypto.createHash("sha256");
    await new Promise((resolve, reject) => {
      const s = fs.createReadStream(dosya, { highWaterMark: 4 * 1024 * 1024 });
      s.on("data", (c) => h.update(c));
      s.on("end", resolve);
      s.on("error", reject);
    });
    return h.digest("hex");
  }
  async function gitBlobSha1(dosya) {
    const st = await fsp.stat(dosya);
    if (st.size > 50 * 1024 * 1024) return ""; // LFS dışı dosyalar küçüktür
    const icerik = await fsp.readFile(dosya);
    return crypto.createHash("sha1").update(`blob ${icerik.length}\0`).update(icerik).digest("hex");
  }
  async function ilkBaytlar(dosya, n) {
    const fh = await fsp.open(dosya, "r");
    try { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, 0); return b.subarray(0, bytesRead); } finally { await fh.close(); }
  }
  // İçerik denetimi: uzantının söylediği biçim gerçekten o mu (pickle kaçırılmasın)
  async function bicimDogrula(dosya, ad, tur = "") {
    const kucuk = ad.toLowerCase();
    const bas = await ilkBaytlar(dosya, 16);
    if (bas.length >= 2 && (bas[0] === 0x80 || (bas[0] === 0x50 && bas[1] === 0x4b))) throw new Error(`${ad}: pickle/zip içeriği tespit edildi, reddedildi`);
    if (kucuk.endsWith(".gguf")) { if (bas.subarray(0, 4).toString("latin1") !== "GGUF") throw new Error(`${ad}: GGUF dosyası değil`); return; }
    if (kucuk.endsWith(".safetensors")) {
      const st = await fsp.stat(dosya);
      if (bas.length < 9) throw new Error(`${ad}: safetensors başlığı okunamadı`);
      const n = Number(bas.readBigUInt64LE(0));
      if (!(n >= 2 && n <= 100 * 1024 * 1024 && n + 8 <= st.size) || bas[8] !== 0x7b) throw new Error(`${ad}: geçerli bir safetensors dosyası değil`);
      return;
    }
    if (kucuk.endsWith(".bin")) {
      // whisper.cpp ggml: ilk 4 bayt küçük-sonlu 0x67676d6c ("ggml")
      if (bas.length < 4 || bas.readUInt32LE(0) !== 0x67676d6c) throw new Error(`${ad}: whisper.cpp ggml biçiminde değil (pickle olabilir), reddedildi`);
      return;
    }
    if (kucuk.endsWith(".onnx")) { if (bas[0] !== 0x08) throw new Error(`${ad}: geçerli bir ONNX dosyası değil`); return; }
    if (kucuk.endsWith(".json")) { JSON.parse(await fsp.readFile(dosya, "utf8")); return; }
    if (tur === "paket") return; // paket içi yardımcı dosyalar (txt, model, md): yalnızca özetle doğrulanır
    throw new Error(`${ad}: izin verilmeyen dosya türü`);
  }
  function uzantiIzinli(tur, ad) {
    const k = ad.toLowerCase();
    if (tur === "text") return k.endsWith(".gguf");
    if (tur === "image") return k.endsWith(".safetensors") || k.endsWith(".gguf");
    if (tur === "speech") return k.endsWith(".bin");
    if (tur === "tts") return k.endsWith(".onnx") || k.endsWith(".onnx.json");
    if (tur === "paket") return !PICKLE_UZANTISI.test(k) && !KOD_UZANTISI.test(k);
    return false;
  }

  async function bosta() {
    while (indirmeDurumu().active || (OZ && OZ.paketDurumu && OZ.paketDurumu().aktif)) {
      is.asama = "Başka bir indirmenin bitmesi bekleniyor";
      await bekle(2000);
    }
  }

  // dosyalar: [{ url, hedefKlasor, ad, boyut, sha256, gitOid, gosterim }]
  async function indirDogrulaYerlestir(tur, dosyalar, kind) {
    const hazir = []; // { gecici, hedef }
    const yedekler = []; // { hedef, yedek }
    const yeniKonan = [];
    const ek = crypto.randomBytes(3).toString("hex");
    try {
      // Disk alanı
      const toplam = dosyalar.reduce((t, f) => t + (f.boyut || 0), 0);
      try {
        const st = fs.statfsSync(dosyalar[0].hedefKlasor);
        const bos = Number(st.bavail) * Number(st.bsize);
        if (bos && bos < toplam + 512 * 1024 * 1024) throw new Error(`Diskte yeterli yer yok: ${bicimle(toplam)} gerekiyor, ${bicimle(bos)} boş.`);
      } catch (err) { if (/Diskte/.test(err.message)) throw err; }
      is.toplam = dosyalar.length;
      for (let i = 0; i < dosyalar.length; i += 1) {
        const f = dosyalar[i];
        if (!f.sha256 && !f.gitOid) throw new Error(`${f.ad}: dosya özeti (hash) bilinmiyor, doğrulanamayan dosya indirilmez`);
        if (!uzantiIzinli(tur, f.ad)) throw new Error(`${f.ad}: bu dosya türü kurulamaz`);
        const hedef = path.join(f.hedefKlasor, f.ad);
        if (!pathInside(hedef, f.hedefKlasor)) throw new Error("Geçersiz hedef yolu");
        const geciciAd = `${f.ad}.arama-${ek}.indiriliyor`;
        const gecici = path.join(f.hedefKlasor, geciciAd);
        await bosta();
        is.adim = i + 1;
        is.asama = `İndiriliyor ${i + 1}/${dosyalar.length}: ${f.gosterim || f.ad}`;
        fs.mkdirSync(f.hedefKlasor, { recursive: true });
        startModelDownload(f.url, geciciAd, f.hedefKlasor, kind);
        hazir.push({ gecici, hedef, f });
        await bekle(300);
        while (indirmeDurumu().active) await bekle(1000);
        const ds = indirmeDurumu();
        if (ds.error) throw new Error(`${f.ad} indirilemedi: ${ds.error}`);
        if (!fs.existsSync(gecici)) throw new Error(`${f.ad} indirildi ama dosya bulunamadı`);
        is.asama = `Doğrulanıyor ${i + 1}/${dosyalar.length}: ${f.gosterim || f.ad}`;
        const st = fs.statSync(gecici);
        if (f.boyut && st.size !== f.boyut) throw new Error(`${f.ad}: boyut uyuşmuyor (${st.size} ≠ ${f.boyut})`);
        if (f.sha256) {
          const h = await dosyaSha256(gecici);
          if (h !== f.sha256) throw new Error(`${f.ad}: SHA256 özeti uyuşmuyor, dosya reddedildi`);
        } else if ((await gitBlobSha1(gecici)) !== f.gitOid) throw new Error(`${f.ad}: dosya özeti uyuşmuyor, dosya reddedildi`);
        await bicimDogrula(gecici, f.ad, tur);
      }
      // Hepsi doğrulandı: önce eskiler yedeğe, sonra yeniler yerine
      is.asama = "Yerine yerleştiriliyor";
      for (const h of hazir) {
        if (fs.existsSync(h.hedef)) {
          const yedek = `${h.hedef}.arama-${ek}.yedek`;
          fs.renameSync(h.hedef, yedek);
          yedekler.push({ hedef: h.hedef, yedek });
        }
        fs.renameSync(h.gecici, h.hedef);
        yeniKonan.push(h.hedef);
      }
      for (const y of yedekler) { try { fs.unlinkSync(y.yedek); } catch (_) {} }
      return hazir.map((h) => h.hedef);
    } catch (err) {
      // Geri alma: yeni konanları kaldır, yedekleri geri koy, geçicileri sil
      for (const y of yeniKonan) { try { fs.unlinkSync(y); } catch (_) {} }
      for (const y of yedekler) { try { fs.renameSync(y.yedek, y.hedef); } catch (e) { log(`  [model-arama] UYARI: yedek geri konamadı ${y.yedek}: ${e.message}`); } }
      for (const h of hazir) { try { fs.unlinkSync(h.gecici); } catch (_) {} try { fs.unlinkSync(`${h.gecici}.part`); } catch (_) {} }
      if (/EBUSY|EPERM|EACCES/.test(String(err.code || err.message))) throw new Error("Model dosyası şu an kullanımda; modeli bellekten çıkarıp tekrar deneyin. Önceki sürüm korundu.");
      throw err;
    }
  }

  function isEkle(tanim) {
    if (is.aktif) {
      if (isSirasi.some((x) => x.kimlik === tanim.kimlik) || is.kimlik === tanim.kimlik) return { sirada: true };
      isSirasi.push(tanim);
      return { sirada: true };
    }
    calistir(tanim);
    return { basladi: true };
  }
  function calistir(tanim) {
    is = { aktif: true, tur: tanim.tur, ad: tanim.ad, asama: "Hazırlanıyor", adim: 0, toplam: 0, hata: null, sonuc: null, bitti: null, kimlik: tanim.kimlik, baslangic: simdi() };
    (async () => {
      try {
        is.sonuc = await tanim.gorev();
        is = { ...is, aktif: false, asama: "Tamamlandı", bitti: simdi() };
        log(`  [model-arama] ${tanim.ad}: tamamlandı`);
      } catch (err) {
        is = { ...is, aktif: false, asama: "Hata", hata: err.message || String(err), bitti: simdi() };
        log(`  [model-arama] ${tanim.ad}: ${is.hata}`);
      }
      const sonraki = isSirasi.shift();
      if (sonraki) calistir(sonraki);
    })();
  }

  // ------------------------------------------------------------------------
  // Kurulum planı (sunucu tarafında yeniden hesaplanır; istemcinin söylediği yol/özet kullanılmaz)
  // ------------------------------------------------------------------------
  function hedefKlasor(tur) {
    const k = klasorler[tur];
    if (!k) throw new Error("Bu model türü için klasör tanımlı değil: " + tur);
    return k;
  }
  function hedefAdi(tur, repo, yol) {
    const taban = guvenliAd(path.basename(yol));
    if (!taban) throw new Error("Geçersiz dosya adı: " + yol);
    if (tur === "text") return guvenliAd(`${repo.replace("/", "--")}--${taban}`);
    return taban;
  }

  async function hfKurulumPlani(tur, repo, anahtar, { taze = true } = {}) {
    const detay = await hfDetay(repo, { taze });
    if (!SHA40.test(String(detay.sha || ""))) throw new Error("Deponun commit kimliği alınamadı");
    const d = donanimOzeti(getHardwareSpecs());
    const kart = kartOlustur(tur, detay, d, String(anahtar || ""));
    const { secenekler } = secenekleriCikar(tur, hfDosyalari(detay), d, detay, String(anahtar || ""));
    const secenek = secenekler.find((s) => s.anahtar === anahtar);
    // Yalnızca kartta sunulan (süzgeçlerden geçmiş) seçenekler kurulabilir
    if (!secenek || !kart.secenekler.some((x) => x.anahtar === anahtar)) throw Object.assign(new Error(kart.engel || "Seçilen dosya depoda bulunamadı ya da kurulamaz"), { status: 400 });
    const klasor = hedefKlasor(tur);
    const dosyalar = [...secenek.dosyalar, ...(secenek.ekDosyalar || [])].map((f) => ({
      yol: f.yol, url: hfUrl(repo, detay.sha, f.yol), hedefKlasor: klasor, ad: hedefAdi(tur, repo, f.yol),
      boyut: f.boyut, sha256: f.sha256, gitOid: f.gitOid, gosterim: path.basename(f.yol),
    }));
    return { kart, secenek, dosyalar, surum: detay.sha, detay };
  }

  function manifestKaydet(kimlik, kayit) {
    const m = manifestOku();
    m.modeller[kimlik] = kayit;
    jsonYaz(MANIFEST, m);
  }

  async function kurulumBaslat(govde) {
    const tur = String(govde.tur || "");
    const kaynak = govde.kaynak === "github" ? "github" : "hf";
    const repo = String(govde.repo || "");
    const anahtar = String(govde.anahtar || "");
    if (!TURLER[tur]) throw Object.assign(new Error("Geçersiz model türü"), { status: 400 });
    if (kaynak === "hf" && !REPO_DESENI.test(repo)) throw Object.assign(new Error("Geçersiz depo adı"), { status: 400 });

    // Müzik / video: yalnızca stüdyonun bildiği (sabit commit'li) paketler, stüdyonun kendi kurucusuyla
    if (TURLER[tur].yukleyici === "python") {
      const model = studyoModeliBul(repo);
      if (!model) throw Object.assign(new Error("Bu model stüdyonun desteklediği modeller arasında değil."), { status: 400 });
      const r = await STUDYO.modelKur(model.id);
      return { ok: true, studyo: true, model: model.id, ...r };
    }

    let plan;
    let kayitTaban;
    if (kaynak === "hf") {
      plan = await hfKurulumPlani(tur, repo, anahtar);
      if (plan.kart.engel && !plan.kart.kurulabilir) throw Object.assign(new Error(plan.kart.engel), { status: 400 });
      kayitTaban = { kaynak: "hf", repo, surum: plan.surum, lisans: plan.kart.lisans, gated: plan.kart.gated };
    } else {
      const ghRepo = ghDepo(repo);
      if (!ghRepo || !GH_UZANTI[tur]) throw Object.assign(new Error("Geçersiz GitHub deposu"), { status: 400 });
      const surum = await ghSonSurum(ghRepo);
      if (!surum) throw new Error("Bu depoda yayımlanmış sürüm yok");
      const d = donanimOzeti(getHardwareSpecs());
      const secenek = ghSecenekleri(tur, surum, d).find((s) => s.anahtar === anahtar);
      if (!secenek) throw new Error("Seçilen dosya sürümde bulunamadı");
      const onEk = `https://github.com/${ghRepo}/releases/download/`;
      for (const f of secenek.dosyalar) {
        if (!f.url.startsWith(onEk)) throw new Error("Beklenmeyen indirme adresi reddedildi");
        if (!f.sha256) throw new Error(`${f.yol}: SHA256 özeti yayımlanmamış`);
      }
      const depo = await guvenliJson(`https://api.github.com/repos/${ghRepo}`);
      const lisans = (depo.license && (depo.license.spdx_id || depo.license.name)) || "";
      const uyarilar = [{ kod: "github", onayGerekir: true, metin: "GitHub sürüm dosyaları topluluk tarafından yüklenir; yalnızca güvendiğiniz depolardan kurun." }];
      if (!lisans || lisans === "NOASSERTION") uyarilar.push({ kod: "lisans", onayGerekir: true, metin: "Lisans belirtilmemiş." });
      const klasor = hedefKlasor(tur);
      plan = {
        kart: { uyarilar, ad: ghRepo.split("/")[1], lisans: lisans || "belirtilmemiş" }, secenek,
        dosyalar: secenek.dosyalar.map((f) => ({ yol: f.yol, url: f.url, hedefKlasor: klasor, ad: hedefAdi(tur, ghRepo, f.yol), boyut: f.boyut, sha256: f.sha256, gitOid: "", gosterim: f.yol })),
        surum: String(surum.tag_name || ""),
      };
      kayitTaban = { kaynak: "github", repo: ghRepo, surum: plan.surum, surumKimligi: Number(surum.id) || 0, lisans: plan.kart.lisans };
    }

    // Onay gerektiren uyarılar (kapılı, lisans belirsiz, GitHub)
    const onayli = govde.uyarilariOnayla === true;
    const onayGereken = plan.kart.uyarilar.filter((u) => u.onayGerekir);
    if (plan.secenek && plan.secenek.uyum && plan.secenek.uyum.seviye === "sigmaz") {
      onayGereken.push({ kod: "sigmaz", onayGerekir: true, metin: `Bu sürüm bu bilgisayarın belleğine sığmıyor (${plan.secenek.uyum.neden}) Çalışmayabilir ya da bilgisayarı çok yavaşlatabilir.` });
    }
    if (onayGereken.length && !onayli) return { ok: false, onayGerekli: true, uyarilar: onayGereken, status: 409 };
    // Aynı adlı, kataloğa kayıtlı olmayan bir dosyanın üzerine yazma onayı
    const m = manifestOku();
    const kimlik = `${tur}:${kayitTaban.kaynak}:${kayitTaban.repo}:${anahtar}`;
    const cakisan = plan.dosyalar.filter((f) => fs.existsSync(path.join(f.hedefKlasor, f.ad))).map((f) => f.ad);
    if (cakisan.length && !m.modeller[kimlik] && govde.uzerineYaz !== true) {
      return { ok: false, uzerineYazOnayi: true, dosyalar: cakisan, status: 409 };
    }
    const ad = `${plan.kart.ad} (${plan.secenek.etiket})`;
    const r = isEkle({
      kimlik, tur, ad,
      gorev: async () => {
        const yollar = await indirDogrulaYerlestir(tur, plan.dosyalar, TURLER[tur].kind);
        manifestKaydet(kimlik, {
          ...kayitTaban, tur, anahtar, ad, klasor: tur,
          dosyalar: plan.dosyalar.map((f) => ({ yol: f.yol, ad: f.ad, boyut: f.boyut, sha256: f.sha256 || "", gitOid: f.gitOid || "" })),
          kuruldu: new Date(simdi()).toISOString(), guncellendi: new Date(simdi()).toISOString(),
        });
        return { tur, repo: kayitTaban.repo, dosyalar: yollar.map((y) => path.basename(y)), kimlik };
      },
    });
    return { ok: true, ...r, kimlik, ad, boyut: plan.dosyalar.reduce((t, f) => t + f.boyut, 0) };
  }


  // ------------------------------------------------------------------------
  // HTTP uç noktaları: /api/model-arama/*
  //   GET  /api/model-arama/ara?tur=&q=&sayfa=&kaynak=hf|github
  //   POST /api/model-arama/kur   { tur, kaynak, repo, anahtar, uyarilariOnayla?, uzerineYaz? }
  //   GET  /api/model-arama/durum
  // ------------------------------------------------------------------------
  function cevrimdisiYaniti(res, err, varsayilan) {
    const ag = agHatasiMi(err);
    const sinir = err && (err.status === 403 || err.status === 429);
    json(res, ag ? 503 : sinir ? 429 : (err && err.status) || 502, {
      ok: false, cevrimdisi: ag,
      error: ag ? "İnternet bağlantısı yok ya da sunucuya ulaşılamadı."
        : sinir ? "Arama sınırına ulaşıldı (Hugging Face / GitHub istek sınırı). Birkaç dakika sonra tekrar deneyin."
          : (err && err.message) || varsayilan,
    });
  }

  async function handle(req, res) {
    if (!req.url.startsWith("/api/model-arama/")) return false;
    const u = new URL(req.url, "http://127.0.0.1");
    const yol = u.pathname;
    try {
      if (yol === "/api/model-arama/ara" && req.method === "GET") {
        const tur = String(u.searchParams.get("tur") || "");
        if (!TURLER[tur]) { json(res, 400, { ok: false, error: "Geçersiz model türü" }); return true; }
        const sorgu = String(u.searchParams.get("q") || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100);
        const sayfa = Math.max(1, Math.min(10, Number(u.searchParams.get("sayfa")) || 1));
        const kaynak = u.searchParams.get("kaynak") === "github" ? "github" : "hf";
        try {
          let veri;
          if (kaynak === "github") {
            const anahtar = `ghr|${tur}|${sorgu}`;
            const onceki = aramaOnbellegi.get(anahtar);
            if (onceki && simdi() - onceki.zaman < 10 * 60 * 1000) veri = onceki.veri;
            else { veri = await ghAra(tur, sorgu); aramaOnbellegi.set(anahtar, { zaman: simdi(), veri }); }
          } else veri = await hfAra(tur, sorgu, sayfa);
          json(res, 200, veri);
        } catch (err) { cevrimdisiYaniti(res, err, "Arama başarısız"); }
        return true;
      }
      if (yol === "/api/model-arama/kur" && req.method === "POST") {
        const govde = await readJsonBody(req, res);
        if (!govde) return true;
        try {
          const r = await kurulumBaslat(govde);
          json(res, r.status || 200, r);
        } catch (err) {
          if (err.status === 400) json(res, 400, { ok: false, error: err.message });
          else cevrimdisiYaniti(res, err, "Kurulum başlatılamadı");
        }
        return true;
      }
      if (yol === "/api/model-arama/durum" && req.method === "GET") {
        const ds = indirmeDurumu() || {};
        json(res, 200, { ok: true, is: { ...is, sira: isSirasi.map((x) => x.ad) }, indirme: { aktif: Boolean(ds.active), ilerleme: ds.progress, hiz: ds.speed, kalanSn: ds.eta, inen: ds.downloadedBytes, toplam: ds.totalBytes } });
        return true;
      }
      json(res, 404, { ok: false, error: "Bilinmeyen uç nokta" });
      return true;
    } catch (err) {
      json(res, err.status || 500, { ok: false, error: err.message || String(err) });
      return true;
    }
  }

  // Güncelleme modülünün (guncelleme.cjs) kullandığı ortak parçalar: aynı ağ kuralları, aynı doğrulama,
  // aynı iş kuyruğu (kurulum ile güncelleme aynı anda indirme yapmaz), aynı sürüm kaydı.
  const ortak = {
    guvenliJson, agHatasiMi, hfDetay, hfDosyalari, hfAgacDosyalari, hfUrl, ghSonSurum, ghSecenekleri,
    indirDogrulaYerlestir, bicimDogrula, dosyaSha256, isEkle, isDurumu: () => ({ ...is }), aktifIs: () => is,
    manifestOku, manifestYaz, jsonOku, jsonYaz, hedefKlasor, donanim: () => donanimOzeti(getHardwareSpecs()),
    guvenliAd, guvenliDepoYolu, bekle, simdi, log, OZ, ROOT, json, readJsonBody, pathInside,
  };

  return {
    handle, kurulumBaslat, isDurumu: () => ({ ...is }), ortak,
    // testler için
    _ic: { donanimOzeti, metinSecenekleri, metinOnerisi, nicemAl, kartOlustur, hfAra, ghAra, guvenliJson, bicimDogrula, indirDogrulaYerlestir, manifestOku, agHatasiMi },
  };
};
module.exports.TURLER = TURLER;
module.exports.donanimOzeti = donanimOzeti;
module.exports.nicemAl = nicemAl;
module.exports.SABIT = { SHA40, SHA256, REPO_DESENI, KOD_UZANTISI, PICKLE_UZANTISI, GUN_MS, bicimle };

// Model profilleri: her model ailesinin eğitildiği boyutlar, adım ve CFG
// aralıkları, desteklenen özellikler. Arayüz bu tablodan beslenir; model
// dosyalarına dokunulmaz. Sınırlar yalnızca arayüz katmanında uygulanır.

// Tüm ailelerde kullanılan oran listesi (en kapsamlı küme).
export const ORANLAR = [
  { id: "1:1", ad: "Kare" },
  { id: "4:3", ad: "Yatay" },
  { id: "3:4", ad: "Dikey" },
  { id: "3:2", ad: "Fotoğraf" },
  { id: "2:3", ad: "Portre" },
  { id: "16:9", ad: "Geniş" },
  { id: "9:16", ad: "Telefon" },
  { id: "21:9", ad: "Sinema" },
  { id: "9:21", ad: "Uzun" },
];

// Motorun desteklediği örnekleyiciler (stable-diffusion.cpp).
export const ORNEKLEYICILER = [
  { id: "euler_a", ad: "Euler a", not: "Hızlı ve güvenli; her adımda biraz rastgelelik ekler, sonuç adım sayısıyla değişir." },
  { id: "euler", ad: "Euler", not: "Rastgelelik eklemez; aynı seed ile kararlı sonuç verir. Lightning modellerinde önerilir." },
  { id: "heun", ad: "Heun", not: "Daha doğru ama adım başına iki kat süre harcar." },
  { id: "dpm2", ad: "DPM2", not: "Heun'a benzer; adım başına iki kat süre." },
  { id: "dpm++2s_a", ad: "DPM++ 2S a", not: "Detaylı, biraz rastgele; adım başına iki kat süre." },
  { id: "dpm++2m", ad: "DPM++ 2M", not: "Az adımda keskin sonuç; Karras zamanlayıcıyla çok kullanılır." },
  { id: "dpm++2mv2", ad: "DPM++ 2M v2", not: "DPM++ 2M'nin düzeltilmiş sürümü." },
  { id: "ipndm", ad: "iPNDM", not: "Az adımda iyi sonuç veren çok adımlı yöntem." },
  { id: "ipndm_v", ad: "iPNDM v", not: "iPNDM'nin değişken adımlı sürümü." },
  { id: "lcm", ad: "LCM", not: "Yalnızca LCM modelleri için; 4–8 adım." },
  { id: "ddim_trailing", ad: "DDIM (trailing)", not: "Klasik DDIM; az adımda kullanılabilir." },
  { id: "tcd", ad: "TCD", not: "Damıtılmış (az adımlı) modeller için." },
  { id: "res_multistep", ad: "RES çok adımlı", not: "Yeni nesil çok adımlı yöntem." },
  { id: "res_2s", ad: "RES 2S", not: "Adım başına iki değerlendirme; yavaş ama doğru." },
  { id: "er_sde", ad: "ER-SDE", not: "Rastgele (SDE) örnekleyici; doku zenginliği verir." },
  { id: "euler_cfg_pp", ad: "Euler CFG++", not: "Düşük CFG ile çalışacak şekilde tasarlandı." },
  { id: "euler_a_cfg_pp", ad: "Euler a CFG++", not: "Euler a'nın CFG++ sürümü." },
];

export const ZAMANLAYICILAR = [
  { id: "", ad: "Model varsayılanı", not: "Motor, modele uygun zamanlayıcıyı kendisi seçer." },
  { id: "discrete", ad: "Discrete", not: "Klasik, eşit aralıklı." },
  { id: "karras", ad: "Karras", not: "Son adımlara daha fazla ağırlık verir; detayı artırır." },
  { id: "exponential", ad: "Üstel", not: "Karras'a benzer, daha yumuşak." },
  { id: "ays", ad: "AYS", not: "Az adım için optimize edilmiş sıra." },
  { id: "gits", ad: "GITS", not: "Az adım için optimize edilmiş sıra." },
  { id: "sgm_uniform", ad: "SGM Uniform", not: "Lightning / Turbo modelleri için önerilir." },
  { id: "simple", ad: "Simple", not: "Basit, eşit aralıklı." },
  { id: "smoothstep", ad: "Smoothstep", not: "Başta ve sonda yumuşak geçiş." },
  { id: "kl_optimal", ad: "KL Optimal", not: "Kuramsal olarak en uygun aralıklar." },
  { id: "lcm", ad: "LCM", not: "LCM modelleri için." },
  { id: "bong_tangent", ad: "Bong Tangent", not: "Deneysel." },
];

const SDXL_BOYUTLARI = {
  "1:1": [1024, 1024], "4:3": [1152, 896], "3:4": [896, 1152], "3:2": [1216, 832], "2:3": [832, 1216],
  "16:9": [1344, 768], "9:16": [768, 1344], "21:9": [1536, 640], "9:21": [640, 1536],
};
const SD15_BOYUTLARI = {
  "1:1": [512, 512], "4:3": [704, 512], "3:4": [512, 704], "3:2": [768, 512], "2:3": [512, 768],
  "16:9": [768, 448], "9:16": [448, 768], "21:9": [896, 384], "9:21": [384, 896],
};

function formuldenBoyutlar(dogal, kat) {
  const sonuc = {};
  for (const oran of ORANLAR) {
    const [a, b] = oran.id.split(":").map(Number);
    const r = a / b;
    const alan = dogal * dogal;
    sonuc[oran.id] = [
      Math.max(kat, Math.round(Math.sqrt(alan * r) / kat) * kat),
      Math.max(kat, Math.round(Math.sqrt(alan / r) / kat) * kat),
    ];
  }
  return sonuc;
}

const AILELER = {
  sd15: {
    ad: "SD 1.5", dogal: 512, kat: 64, boyutlar: SD15_BOYUTLARI,
    adim: { min: 5, max: 50, onerilen: [20, 30], varsayilan: 20 },
    cfg: { min: 1, max: 15, onerilen: [5, 8], varsayilan: 7 },
    negatif: true, clipSkip: true, ornekleyici: "euler_a", zamanlayici: "",
    not: "512×512 ile eğitildi. 768'i aşan kenarlarda nesneler tekrarlanabilir.",
  },
  sd2: {
    ad: "SD 2.x", dogal: 768, kat: 64, boyutlar: formuldenBoyutlar(768, 64),
    adim: { min: 5, max: 50, onerilen: [20, 30], varsayilan: 25 },
    cfg: { min: 1, max: 15, onerilen: [5, 9], varsayilan: 7 },
    negatif: true, clipSkip: false, ornekleyici: "euler_a", zamanlayici: "",
    not: "768×768 ile eğitildi (base sürümü 512).",
  },
  sdxl: {
    ad: "SDXL", dogal: 1024, kat: 64, boyutlar: SDXL_BOYUTLARI,
    adim: { min: 10, max: 60, onerilen: [25, 40], varsayilan: 30 },
    cfg: { min: 1, max: 12, onerilen: [4, 8], varsayilan: 6 },
    negatif: true, clipSkip: true, ornekleyici: "euler_a", zamanlayici: "",
    not: "Yaklaşık 1 megapiksel boyutlarla eğitildi (1024×1024 ve eşdeğerleri).",
  },
  sd3: {
    ad: "SD 3", dogal: 1024, kat: 64, boyutlar: SDXL_BOYUTLARI,
    adim: { min: 10, max: 60, onerilen: [26, 32], varsayilan: 28 },
    cfg: { min: 1, max: 10, onerilen: [4, 6], varsayilan: 4.5 },
    negatif: true, clipSkip: false, ornekleyici: "euler", zamanlayici: "",
    not: "Yaklaşık 1 megapiksel boyutlarla eğitildi.",
  },
  flux: {
    ad: "Flux", dogal: 1024, kat: 16, boyutlar: formuldenBoyutlar(1024, 16),
    adim: { min: 10, max: 50, onerilen: [20, 30], varsayilan: 20 },
    cfg: { min: 1, max: 1, onerilen: [1, 1], varsayilan: 1 },
    negatif: false, clipSkip: false, ornekleyici: "euler", zamanlayici: "",
    not: "Flux negatif prompt ve CFG kullanmaz; yönlendirme modelin içine gömülüdür.",
  },
  bilinmiyor: {
    ad: "Tanınmayan model", dogal: 512, kat: 64, boyutlar: SD15_BOYUTLARI,
    adim: { min: 1, max: 100, onerilen: [20, 30], varsayilan: 20 },
    cfg: { min: 1, max: 20, onerilen: [5, 8], varsayilan: 7 },
    negatif: true, clipSkip: true, ornekleyici: "euler_a", zamanlayici: "",
    not: "Model ailesi dosyadan anlaşılamadı. Sınırlar geniş tutuldu; sonuçlar beklenmedik olabilir.",
  },
};

// Damıtılmış (az adımlı) sürümler aileyi değiştirmez, adım/CFG sınırlarını değiştirir.
const DAMITMA = {
  lightning: {
    ad: "Lightning",
    adim: { min: 2, max: 10, onerilen: [4, 6], varsayilan: 4 },
    cfg: { min: 1, max: 3, onerilen: [1, 2], varsayilan: 1.5 },
    ornekleyiciOneri: "euler + sgm_uniform",
    not: "4–6 adımda bitirecek şekilde eğitildi. 8'in üzerinde görüntü aşırı keskinleşir, renkler yanar.",
  },
  hyper: {
    ad: "Hyper",
    adim: { min: 1, max: 12, onerilen: [4, 8], varsayilan: 8 },
    cfg: { min: 1, max: 3, onerilen: [1, 1.5], varsayilan: 1 },
    ornekleyiciOneri: "euler / ddim_trailing",
    not: "1–8 adım için eğitildi.",
  },
  turbo: {
    ad: "Turbo",
    adim: { min: 1, max: 8, onerilen: [1, 4], varsayilan: 4 },
    cfg: { min: 1, max: 2, onerilen: [1, 1], varsayilan: 1 },
    ornekleyiciOneri: "euler_a",
    not: "1–4 adım için eğitildi. CFG 1'de negatif prompt etkisizdir.",
  },
  lcm: {
    ad: "LCM",
    adim: { min: 2, max: 12, onerilen: [4, 8], varsayilan: 6 },
    cfg: { min: 1, max: 2.5, onerilen: [1, 2], varsayilan: 1.5 },
    ornekleyiciOneri: "lcm + lcm",
    not: "4–8 adım için eğitildi. LCM örnekleyicisiyle en iyi sonucu verir.",
  },
  schnell: {
    ad: "Schnell",
    adim: { min: 1, max: 8, onerilen: [4, 4], varsayilan: 4 },
    cfg: { min: 1, max: 1, onerilen: [1, 1], varsayilan: 1 },
    ornekleyiciOneri: "euler",
    not: "4 adım için eğitildi.",
  },
};

// Sunucudan gelen tespit bilgisinden (/api/model-info) profil üretir.
export function profilOlustur(tespit) {
  const aileAnahtari = tespit && AILELER[tespit.family] ? tespit.family : "bilinmiyor";
  const aile = AILELER[aileAnahtari];
  const damitma = tespit?.distilled ? DAMITMA[tespit.distilled] : null;
  const profil = {
    anahtar: aileAnahtari + (damitma ? "-" + tespit.distilled : ""),
    aile: aileAnahtari,
    ad: aile.ad + (damitma ? " " + damitma.ad : ""),
    dogal: aile.dogal,
    kat: aile.kat,
    boyutlar: aile.boyutlar,
    adim: damitma ? damitma.adim : aile.adim,
    cfg: damitma ? { ...damitma.cfg, max: Math.max(damitma.cfg.max, aile.cfg.min) } : aile.cfg,
    negatif: aile.negatif,
    clipSkip: aile.clipSkip,
    ornekleyici: aile.ornekleyici,
    zamanlayici: aile.zamanlayici,
    ornekleyiciOneri: damitma?.ornekleyiciOneri || "",
    damitilmis: Boolean(damitma),
    notlar: [aile.not, damitma?.not].filter(Boolean),
    kaynak: tespit?.source || "",
    inpaint: Boolean(tespit?.inpaint),
    sansursuz: Boolean(tespit?.uncensored),
    sansursuzKaynak: tespit?.uncensoredSource || "",
  };
  // Oran ne olursa olsun kenar sınırı: doğal boyutun iki katı.
  profil.kenarMax = Math.min(2048, profil.dogal * 2);
  profil.kenarMin = Math.max(256, Math.round(profil.dogal / 2 / profil.kat) * profil.kat);
  return profil;
}

export function yuvarla(profil, deger) {
  const kat = profil?.kat || 64;
  const v = Math.round((Number(deger) || 0) / kat) * kat;
  return Math.max(profil?.kenarMin || kat, Math.min(profil?.kenarMax || 2048, v));
}

// Bir boyutun modele uygunluğu: "onerilen" | "izinli" | "riskli"
export function boyutDegerlendir(profil, w, h) {
  if (!profil) return { durum: "izinli", mesaj: "" };
  const oran = (w * h) / (profil.dogal * profil.dogal);
  const uzunKenar = Math.max(w, h);
  if (oran <= 1.6 && uzunKenar <= profil.dogal * 1.55) {
    return { durum: "onerilen", mesaj: "" };
  }
  if (oran <= 2.3) {
    return { durum: "izinli", mesaj: "Eğitim boyutunun üzerinde. Kompozisyon bozulabilir, nesneler tekrarlanabilir." };
  }
  return { durum: "riskli", mesaj: "Önerilmez: eğitim boyutunun " + oran.toFixed(1) + " katı piksel. Nesneler büyük olasılıkla tekrarlanır; süre de katlanarak artar." };
}

export function aktifOran(profil, w, h) {
  if (!profil) return null;
  for (const [id, [bw, bh]] of Object.entries(profil.boyutlar)) {
    if (bw === w && bh === h) return id;
  }
  return null;
}

export function negatifEtkisiMi(profil, cfg) {
  if (!profil) return { etkili: true, neden: "" };
  if (!profil.negatif) return { etkili: false, neden: "Bu model ailesi negatif prompt kullanmaz." };
  if (Number(cfg) <= 1.0001) return { etkili: false, neden: "CFG 1 iken negatif prompt hesaba katılmaz. Etkisi için CFG'yi 1'in üzerine çıkarın." };
  if (profil.damitilmis && Number(cfg) < 2) return { etkili: true, zayif: true, neden: "Düşük CFG'de negatif prompt'un etkisi zayıftır." };
  return { etkili: true, neden: "" };
}

// Üretim sırasında adımın hangi aşamada olduğunu anlatır.
// Oranlar genel bir kuraldır; ölçüm değildir.
export function adimAsamasi(adim, toplam) {
  if (!toplam || adim <= 0) return { anahtar: "hazirlik", baslik: "Hazırlanıyor", aciklama: "Prompt metni modelin anlayacağı sayılara çevriliyor." };
  const f = adim / toplam;
  if (f <= 0.34) return { anahtar: "kompozisyon", baslik: "Genel yerleşim", aciklama: "Görüntü tamamen gürültüden başlar. Bu adımlarda genellikle ana şekillerin yeri, ışık ve renk dağılımı belirlenir." };
  if (f <= 0.7) return { anahtar: "sekil", baslik: "Şekiller netleşiyor", aciklama: "Genellikle nesnelerin sınırları, yüzler ve büyük yapılar belirginleşir." };
  return { anahtar: "detay", baslik: "İnce detaylar", aciklama: "Genellikle doku, keskinlik ve küçük ayrıntılar eklenir. Kalan gürültü temizlenir." };
}

export function adimAsamaAnahtari(adimNo, toplam) {
  return adimAsamasi(adimNo, toplam).anahtar;
}

// Adım sayısı seçilirken gösterilen açıklama.
export function adimYorumu(profil, adim) {
  if (!profil) return "";
  const [a, b] = profil.adim.onerilen;
  if (profil.damitilmis) {
    if (adim < a) return "Önerilenin altında: görüntü bulanık veya yarım kalabilir.";
    if (adim <= b) return "Önerilen aralıkta: bu model tam da bu kadar adım için eğitildi.";
    if (adim <= b + 2) return "Önerilenin biraz üstünde: fark çok az, süre uzar.";
    return "Fazla: bu model az adım için eğitildi. Daha fazla adım genellikle aşırı keskinlik ve yanık renk üretir.";
  }
  if (adim < Math.max(8, a / 2)) return "Çok az: görüntü bulanık, detaylar yarım kalır.";
  if (adim < a) return "Hızlı taslak: yerleşim oturur, ince detay eksik kalabilir.";
  if (adim <= b) return "Önerilen aralıkta: kalite ile süre dengeli.";
  return "Önerilenin üstünde: kalite farkı çok azdır, süre adım sayısıyla doğru orantılı uzar.";
}

// --- Süre tahmini -----------------------------------------------------------
// Ölçülen hız (sn/adım) her model ve piksel sayısı için tarayıcıda tutulur.
// Bu bir ayar değil, önbellektir; silinirse ilk üretimde yeniden ölçülür.
const HIZ_ANAHTARI = "gorselHizOlcumleri";

function hizlariOku() {
  try { return JSON.parse(localStorage.getItem(HIZ_ANAHTARI) || "{}") || {}; } catch (_) { return {}; }
}

export function hizKaydet(model, w, h, snAdim, ekSure) {
  if (!model || !(snAdim > 0)) return;
  try {
    const tum = hizlariOku();
    const liste = (tum[model] || []).filter((k) => k.px !== w * h);
    liste.unshift({ px: w * h, snAdim, ekSure: Math.max(0, Number(ekSure) || 0), t: Date.now() });
    tum[model] = liste.slice(0, 8);
    localStorage.setItem(HIZ_ANAHTARI, JSON.stringify(tum));
  } catch (_) {}
}

// Piksel arttıkça adım süresi doğrusaldan hızlı artar (dikkat katmanı).
// Bu makinede 512→1024 geçişinde ~7.9 kat ölçüldü: üs ≈ 1.5.
const PIKSEL_USSU = 1.5;

export function sureTahmini(model, w, h, adim) {
  const liste = hizlariOku()[model] || [];
  if (liste.length === 0) return null;
  const px = w * h;
  let enYakin = liste[0];
  for (const k of liste) {
    if (Math.abs(Math.log(k.px / px)) < Math.abs(Math.log(enYakin.px / px))) enYakin = k;
  }
  const carpan = Math.pow(px / enYakin.px, PIKSEL_USSU);
  const snAdim = enYakin.snAdim * carpan;
  const ek = (enYakin.ekSure || 0) * (px / enYakin.px);
  return {
    snAdim,
    toplam: snAdim * adim + ek,
    olculen: enYakin.px === px,
  };
}

export function sureYaz(sn) {
  if (sn === null || sn === undefined || !isFinite(sn)) return "–";
  const s = Math.max(0, Math.round(sn));
  if (s < 60) return s + " sn";
  const dk = Math.floor(s / 60);
  const kalan = s % 60;
  if (dk < 60) return kalan ? `${dk} dk ${kalan} sn` : `${dk} dk`;
  const sa = Math.floor(dk / 60);
  return `${sa} sa ${dk % 60} dk`;
}

// "30.5s/it" veya "1.2it/s" → saniye/adım
export function hizCoz(metin) {
  const m = String(metin || "").match(/([\d.]+)\s*(s\/it|it\/s)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!(v > 0)) return null;
  return m[2] === "s/it" ? v : 1 / v;
}

// İlk kurulum sihirbazının sunucu tarafı. serve.cjs bunu bir kez yükler:
//   const ILK_KURULUM = require("../setup/ilk-kurulum-sunucu.cjs")({ ROOT, json, readJsonBody, OZ, STUDYO, ... });
//   if (req.url.startsWith("/api/ilk-kurulum/") && await ILK_KURULUM.handle(req, res)) return;
//
// Uç noktalar (hepsi serve.cjs'in yerel istek / site dışı istek korumasının arkasında):
//   GET  /api/ilk-kurulum/durum?dil=tr   -> gösterilsin mi, donanım özeti, önerilen modeller (kategori + varsayılan +
//                                           alternatifler), ortak bileşenler, isteğe bağlı özellikler, kuyruk
//   POST /api/ilk-kurulum/indir {secimler: ["metin-gemma4-e4b", ...]}  -> seçilenleri sırayla indirir/kurar
//   POST /api/ilk-kurulum/iptal          -> kuyruğu durdurur (sürmekte olan dosya indirmesi iptal edilir)
//   POST /api/ilk-kurulum/tamam {atlandi, secilenler, yapayZeka: {ad, ozelMetin}}
//                                        -> app/config/ilk-kurulum.json yazılır; sihirbaz bir daha kendiliğinden açılmaz
//
// "Önerilen modeller" adımı: her kategoride DENENMİŞ VARSAYILAN set önceden seçili gelir; alternatifler altında,
// seçilmemiş olarak listelenir. Güçlü donanımda daha büyük alternatifler "güçlü bilgisayarınız için" diye
// vurgulanır ama varsayılan seçim değişmez. Yalnızca güçlü donanıma uygun ağır seçenekler (Wan 2.1) zayıf
// bilgisayarda gizli gelir ("Yine de göster"). Müzik/efekt/video varsayılanları seçili gelir ama "isteğe bağlı"
// diye boyutlarıyla işaretlenir. Amaç: model seçmeyi bilmeyen kullanıcı "İleri" diyerek denenmiş,
// çalışan bir kuruluma ulaşsın.
//
// Kurulum yolları (yeni indirici yazılmadı; uygulamanın mevcut altyapısı kullanılır):
//   dosya   -> serve.cjs startModelDownload (Model Yöneticisi'nin indiricisi). Adres Hugging Face'te sabit commit'e
//              bağlıdır (resolve/<commit>/...); inen dosyanın boyutu ve SHA256 özeti burada doğrulanır, uymazsa silinir.
//   ema     -> taşınabilir Python + sabit sürümlü pip paketleri (ses-motoru-kur.bat'ın uygulama içi karşılığı)
//   ozellik -> ozellikler.cjs ozellikKur (Antalia, Supertonic, Ahenk, OmniVoice: sabit pip sürümleri, ağırlıklar sabit commit)
//   paket   -> ozellikler.cjs paketIndir (Seda, Duyu: sabit commit, her dosya HF özetiyle doğrulanır)
//   studyo  -> studyo.cjs modelKur (MusicGen, AudioLDM-S, AnimateDiff, Wan: sabit commit + dosya özetleri)
//   kokoro  -> serve.cjs installTtsCatalogModel (İngilizce ses; ağırlıklar ilk kullanımda kokoro-js önbelleğine iner)
//   elle    -> sihirbazdan kurulmaz, yalnızca bilgi (Piper)
//
// "Yapay zekânız" adımı: sistem mesajının kendisi sunucuya gönderilmez ve burada saklanmaz. Sohbet onu tarayıcıdaki
// ayardan (App.jsx textSettings.systemPrompt → localStorage "textSettings") okur. İşaret dosyasına yalnızca seçilen ad
// ve metnin özelleştirilip özelleştirilmediği yazılır (tanılama ve sonraki sürümlerde ad gösterimi için).
//
// Güvenlik: arayüz yalnızca aşağıdaki sabit katalogdaki kimlikleri gönderebilir; adres ya da dosya adı istemciden alınmaz.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

module.exports = function ilkKurulumAltyapisi(ctx) {
  const {
    ROOT, json, readJsonBody, OZ,
    getHardwareSpecs, startModelDownload,
    indirmeDurumu, indirmeMesgulMu, indirmeIptal,
    emaKurulu,
    log = (...a) => console.log(...a),
  } = ctx;
  // İsteğe bağlı (eski serve.cjs bunları vermiyorsa ilgili öğeler "kullanılamaz" görünür)
  const STUDYO = ctx.STUDYO || null;
  const kokoroKur = typeof ctx.kokoroKur === "function" ? ctx.kokoroKur : null;
  const kokoroKurulu = typeof ctx.kokoroKurulu === "function" ? ctx.kokoroKurulu : null;

  const APP = path.join(ROOT, "app");
  const CONFIG = path.join(APP, "config");
  const ISARET = path.join(CONFIG, "ilk-kurulum.json");
  const DIZIN = {
    metin: path.join(APP, "llm-models"),
    konusma: path.join(APP, "speech-models"),
    gorsel: path.join(APP, "models"),
  };
  const INDIRME_TURU = { metin: "text", konusma: "speech", gorsel: "image" };
  const PY_DIR = path.join(APP, "tools", "python-win");
  const PYTHON = path.join(PY_DIR, "python.exe");
  const PIP_CACHE = path.join(APP, "cache", "pip");
  // python.org'un 3.12.10 gömülü sürümü için yayımladığı MD5 (ozellikler.cjs ile aynı değer)
  const PYTHON_EMBED_MD5 = "FE8EF205F2E9C3BA44D0CF9954E1ABD3";
  const EMA_KLASOR = path.join(APP, "tts-models", "ema");
  const EMA_ISARET = path.join(EMA_KLASOR, "kurulu.txt");
  const WINDOWS = process.platform === "win32";

  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  const gbYaz = (n) => String(Math.round((Number(n) || 0) * 10) / 10).replace(".", ",");

  // --------------------------------------------------------------------------
  // Kategoriler (sihirbazda bu sırayla gösterilir, kuyrukta da bu sırayla kurulur: küçükler önce,
  // görsel modeli videodan önce — AnimateDiff taban olarak bir SD 1.5 görsel modeli kullanır)
  // --------------------------------------------------------------------------
  const KATEGORILER = [
    { id: "sohbet", ad: "Sohbet modeli" },
    { id: "stt", ad: "Sesten metne (konuşma tanıma)" },
    { id: "tts", ad: "Metinden sese (seslendirme)" },
    { id: "gorsel", ad: "Görsel üretimi" },
    { id: "muzik", ad: "Müzik" },
    { id: "efekt", ad: "Ses efekti" },
    { id: "video", ad: "Video" },
  ];
  const KURULUM_SIRASI = { stt: 0, tts: 1, sohbet: 2, gorsel: 3, muzik: 4, efekt: 5, video: 6 };

  // Ortak bileşen: Python tabanlı motorların (EMA, Antalia, Ahenk, müzik, video ...) bir kez kurulan ortamı
  const ORTAK = {
    "python-torch": { ad: "Taşınabilir Python + PyTorch (işlemci sürümü), bir kez kurulur", bayt: 320 * MB },
  };

  // --------------------------------------------------------------------------
  // Sabit katalog. Tek dosyalı modellerde commit, boyut ve SHA256 Hugging Face API'sinden alındı ve iki ayrı
  // uç noktayla (model bilgisi + commit ağacı) karşılaştırılarak doğrulandı (Kasım 2026).
  //   varsayilan: true    -> denenmiş set; sihirbaz önceden seçili getirir ("Önerilen (denenmiş)")
//   istegeBagli: true   -> varsayılan ama büyük/isteğe bağlı (müzik, efekt, video): seçili gelir, boyutu ve
//                          "isteğe bağlı" notu belirgin gösterilir; kullanıcı işareti kaldırabilir
//   zayiftaGizle: true  -> gucluIcin(donanım) sağlanmıyorsa (zayıf bilgisayar) alternatifler arasında gizli gelir;
//                          sihirbazda "Yine de göster" ile açılır (ör. Wan 2.1)
  // --------------------------------------------------------------------------
  const hf = (depo, commit, yol) => `https://huggingface.co/${depo}/resolve/${commit}/${yol}`;
  const KATALOG = {
    // ---- Sohbet ----
    "metin-gemma4-e4b": {
      kategori: "sohbet", yontem: "dosya", hedef: "metin", varsayilan: true,
      ad: "Gemma 4 E4B · Q4_K_M",
      aciklama: "Türkçesi iyi, araç kullanabilen genel sohbet modeli.",
      depo: "unsloth/gemma-4-E4B-it-GGUF", commit: "bfc15c382204943c3a8fff0c750b94ae2364d7a3",
      dosya: "gemma-4-E4B-it-Q4_K_M.gguf", bayt: 4977171584,
      sha256: "85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87",
      lisans: "Apache-2.0", sure: "İşlemcide (i5-7200U, 16 GB) yükleme ~10–16 sn",
    },
    "metin-gemma4-e2b": {
      kategori: "sohbet", yontem: "dosya", hedef: "metin",
      ad: "Gemma 4 E2B · Q4_K_M",
      aciklama: "Daha küçük ve hızlı; 8 GB bellekli bilgisayarlar için. Türkçesi E4B'ye göre daha zayıf.",
      depo: "unsloth/gemma-4-E2B-it-GGUF", commit: "0314792d7f1f7e229411f620751375812bb9faf2",
      dosya: "gemma-4-E2B-it-Q4_K_M.gguf", bayt: 3106738272,
      sha256: "740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8",
      lisans: "Apache-2.0", sure: "",
    },

    // ---- Sesten metne ----
    "konusma-whisper-small-q5": {
      kategori: "stt", yontem: "dosya", hedef: "konusma", varsayilan: true,
      ad: "Whisper small · q5_1 (çok dilli)",
      aciklama: "Türkçe dahil çok dilli konuşma tanıma; küçük ve hızlı. Sesli sohbet için gerekli.",
      depo: "ggerganov/whisper.cpp", commit: "5359861c739e955e79d9a303bcbc70fb988958b1",
      dosya: "ggml-small-q5_1.bin", bayt: 190085487,
      sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
      lisans: "MIT", sure: "Kısa bir cümle birkaç saniyede yazıya dökülür",
    },
    "konusma-seda": {
      kategori: "stt", yontem: "paket", paket: "seda-v0.2", ozellik: "speech-seda",
      ad: "Seda v0.2 (Türkçeye özel)",
      aciklama: "Türkçe için eğitilmiş konuşma tanıma (int8 ONNX); kısa bir cümle işlemcide ~2 sn.",
      bayt: 260 * MB, yaklasik: true, ortak: "python",
      lisans: "CC BY-SA 4.0", sure: "",
    },
    "konusma-duyu": {
      kategori: "stt", yontem: "paket", paket: "duyu-small", ozellik: "speech-duyu",
      ad: "Duyu-small (Türkçeye özel)",
      aciklama: "Türkçeye özel, küçük konuşma tanıma motoru (int8 ONNX).",
      bayt: 180 * MB, yaklasik: true, ortak: "python",
      lisans: "Apache-2.0", sure: "",
    },
    "konusma-whisper-base-q5": {
      kategori: "stt", yontem: "dosya", hedef: "konusma",
      ad: "Whisper base · q5_1 (çok dilli)",
      aciklama: "En küçük çok dilli Whisper; çok zayıf bilgisayarlar için. Türkçe doğruluğu small'dan belirgin şekilde düşük.",
      depo: "ggerganov/whisper.cpp", commit: "5359861c739e955e79d9a303bcbc70fb988958b1",
      dosya: "ggml-base-q5_1.bin", bayt: 59707625,
      sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
      lisans: "MIT", sure: "",
    },
    "konusma-whisper-medium-q5": {
      kategori: "stt", yontem: "dosya", hedef: "konusma",
      ad: "Whisper medium · q5_0 (çok dilli)",
      aciklama: "Daha doğru ama işlemcide small'dan 2–3 kat yavaş.",
      depo: "ggerganov/whisper.cpp", commit: "5359861c739e955e79d9a303bcbc70fb988958b1",
      dosya: "ggml-medium-q5_0.bin", bayt: 539212467,
      sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
      lisans: "MIT", sure: "", gucluIcin: (d) => d.gpuVar,
    },
    "konusma-whisper-large-v3-turbo-q5": {
      kategori: "stt", yontem: "dosya", hedef: "konusma",
      ad: "Whisper large-v3 turbo · q5_0 (çok dilli)",
      aciklama: "En doğru Whisper seçeneği; ekran kartıyla hızlı, işlemcide yavaş.",
      depo: "ggerganov/whisper.cpp", commit: "5359861c739e955e79d9a303bcbc70fb988958b1",
      dosya: "ggml-large-v3-turbo-q5_0.bin", bayt: 574041195,
      sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
      lisans: "MIT", sure: "", gucluIcin: (d) => d.gpuVar,
    },

    // ---- Metinden sese ----
    "ses-ema": {
      kategori: "tts", yontem: "ema", varsayilan: true, yalnizcaWindows: true,
      ad: "EMA Lightning (Türkçe ses)",
      aciklama: "Doğal ve doğru telaffuzlu Türkçe seslendirme; işlemcide çalışır.",
      bayt: 40 * MB, yaklasik: true, ortak: "python-torch",
      lisans: "Apache-2.0", sure: "Kurulum 5–15 dk sürebilir",
    },
    "ses-antalia": {
      kategori: "tts", yontem: "ozellik", ozellik: "tts-antalia", yalnizcaWindows: true,
      ad: "Antalia-2 Mini (Türkçe erkek sesi)",
      aciklama: "5 anlatım profili; işlemcide çalışır.",
      bayt: 40 * MB, yaklasik: true, ortak: "python-torch",
      lisans: "Apache-2.0", sure: "",
    },
    "ses-supertonic": {
      kategori: "tts", yontem: "ozellik", ozellik: "tts-supertonic", yalnizcaWindows: true,
      ad: "Supertonic-3 (10 ses, kadın ve erkek)",
      aciklama: "Çok dilli, hızlı ONNX seslendirme; Türkçe dahil.",
      bayt: 400 * MB, yaklasik: true, ortak: "python",
      lisans: "Kod MIT, ağırlıklar OpenRAIL-M", sure: "",
    },
    "ses-ahenk": {
      kategori: "tts", yontem: "ozellik", ozellik: "tts-ahenk", yalnizcaWindows: true,
      ad: "Ahenk Cep (Türkçe kadın sesi, 7 ruh hali)",
      aciklama: "Duyguya göre okuyan Türkçe kadın sesi; işlemcide çalışır.",
      bayt: 40 * MB, yaklasik: true, ortak: "python-torch",
      lisans: "Ağırlıklar CC BY 4.0, kod Apache-2.0", sure: "",
    },
    "ses-piper": {
      kategori: "tts", yontem: "elle",
      ad: "Piper (çok dilli, Türkçe sesler dahil)",
      aciklama: "Piper programı ve ses dosyaları app/piper klasörüne konursa sesler listeye kendiliğinden eklenir. Ses dosyaları Model Yöneticisi › Model ara (Piper) ile bulunabilir.",
      bayt: 0,
      lisans: "Program MIT; her sesin kendi lisansı", sure: "",
    },
    "ses-kokoro": {
      kategori: "tts", yontem: "kokoro",
      ad: "Kokoro 82M (İngilizce)",
      aciklama: "Yalnızca İngilizce sesler. Uygulamayla birlikte gelir; model dosyaları ilk kullanımda (~90 MB) iner.",
      bayt: 90 * MB, yaklasik: true,
      lisans: "Apache-2.0", sure: "",
    },
    "ses-omnivoice": {
      kategori: "tts", yontem: "ozellik", ozellik: "tts-omnivoice", yalnizcaWindows: true, agir: true,
      ad: "OmniVoice (ses tasarımı ve klonlama) — ağır",
      aciklama: "Ses klonlama ve ses tasarımı. Büyük model: ekran kartı önerilir; işlemcide her cümle dakikalar sürebilir.",
      bayt: 3.5 * GB, yaklasik: true,
      lisans: "Model CC BY-NC (ticari olmayan), kod Apache-2.0", sure: "", gucluIcin: (d) => d.vram >= 8,
    },

    // ---- Görsel ----
    "gorsel-cyberrealistic-v8": {
      kategori: "gorsel", yontem: "dosya", hedef: "gorsel", varsayilan: true,
      ad: "CyberRealistic V8 (SD 1.5 sınıfı)",
      aciklama: "Gerçekçi görseller; ekran kartı olmayan bilgisayarlarda da çalışır (512×512). Video stüdyosunun da taban modeli.",
      depo: "cyberdelia/CyberRealistic", commit: "99827f96edd717dacb28c68560680c201c55df05",
      dosya: "CyberRealistic_V8_FP16.safetensors", bayt: 2132651162,
      sha256: "4a74f783f5d57e93ce86eb2a791c4a2d79fc6d281b4fca4f028255a067186a2a",
      lisans: "CreativeML OpenRAIL-M", sure: "İşlemcide tek görsel ~10 dk (hızlı modda ~3 dk)",
    },
    "gorsel-juggernaut-xl-lightning": {
      kategori: "gorsel", yontem: "dosya", hedef: "gorsel",
      ad: "Juggernaut XL v9 Lightning (SDXL sınıfı)",
      aciklama: "1024×1024, 4 adım; daha ayrıntılı, fotoğraf gerçekliğinde sonuç. Ekran kartı ister.",
      depo: "RunDiffusion/Juggernaut-XL-Lightning", commit: "9c35e7ca1112b7e567ae7b24400b83935909916d",
      dosya: "Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors", bayt: 7105348284,
      sha256: "c8df560d2992ac04299412be6a36fa53a4e7a1b74f27b94867ad3f84f4b425a5",
      lisans: "CreativeML OpenRAIL++-M", sure: "Ekran kartıyla saniyeler; işlemcide tek görsel ~20 dk",
      gucluIcin: (d) => d.vram >= 8,
    },
    "gorsel-dreamshaper8": {
      kategori: "gorsel", yontem: "dosya", hedef: "gorsel",
      ad: "DreamShaper 8 (SD 1.5 sınıfı)",
      aciklama: "Çok yönlü (illüstrasyon + gerçekçi) SD 1.5 modeli; ekran kartı olmadan da çalışır.",
      depo: "Lykon/DreamShaper", commit: "228d79cb20811466f5c5710aa91f05dabd0b8a14",
      dosya: "DreamShaper_8_pruned.safetensors", bayt: 2132625894,
      sha256: "879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd",
      lisans: "CreativeML OpenRAIL-M", sure: "İşlemcide tek görsel ~10 dk (hızlı modda ~3 dk)",
    },
    "gorsel-dreamshaperxl-lightning": {
      kategori: "gorsel", yontem: "dosya", hedef: "gorsel",
      ad: "DreamShaper XL Lightning (SDXL sınıfı)",
      aciklama: "1024×1024, 4 adım; çok yönlü SDXL modeli. Ekran kartı ister.",
      depo: "Lykon/dreamshaper-xl-lightning", commit: "561086c22aba3925b1e8803a73857f061635c7c3",
      dosya: "DreamShaperXL_Lightning.safetensors", bayt: 6939220250,
      sha256: "fdbe56354b8f876b736f24d3ad867ecd4140c019f57642ec8ddd878088d44f64",
      lisans: "CreativeML OpenRAIL++-M", sure: "Ekran kartıyla saniyeler; işlemcide tek görsel ~20 dk",
      gucluIcin: (d) => d.vram >= 8,
    },

    // ---- Müzik / efekt / video (studyo.cjs katalogları; depo ve commit'ler STUDYO_PAKETLERI'nde sabit) ----
    "muzik-musicgen-small": {
      kategori: "muzik", yontem: "studyo", studyoModel: "musicgen-small", varsayilan: true, istegeBagli: true,
      ad: "MusicGen Small",
      aciklama: "Metinden enstrümantal müzik (32 kHz).",
      bayt: 2.4 * GB, yaklasik: true, ortak: "python-torch",
      lisans: "CC BY-NC 4.0 (ticari olmayan)", sure: "İşlemcide 15 saniyelik parça ~6 dk",
    },
    "efekt-audioldm-s": {
      kategori: "efekt", yontem: "studyo", studyoModel: "audioldm-s", varsayilan: true, istegeBagli: true,
      ad: "AudioLDM-S Full v2",
      aciklama: "Ses efekti, ambiyans ve foley; en az bellekle çalışan seçenek.",
      bayt: 1.7 * GB, yaklasik: true, ortak: "python-torch",
      lisans: "CC BY-NC-SA 4.0 (ticari olmayan)", sure: "",
    },
    "video-animatediff": {
      kategori: "video", yontem: "studyo", studyoModel: "animatediff", varsayilan: true, istegeBagli: true,
      ad: "AnimateDiff v1.5 v2 (SD 1.5 tabanlı)",
      aciklama: "Kısa (≈2 sn) animasyon klipleri; taban olarak bilgisayarınızdaki SD 1.5 modelini (ör. CyberRealistic V8) kullanır.",
      bayt: 1.8 * GB, yaklasik: true, ortak: "python-torch",
      lisans: "Apache-2.0 (hareket adaptörü)", sure: "",
    },
    "video-wan21-1.3b": {
      kategori: "video", yontem: "studyo", studyoModel: "wan21-1.3b", agir: true, zayiftaGizle: true,
      gizliSebep: "Yalnızca güçlü ekran kartı (8 GB+) ve 32 GB bellek ile önerilir; ~29 GB indirir.",
      ad: "Wan 2.1 T2V 1.3B — ağır",
      aciklama: "Daha akıcı 480p videolar. ~29 GB indirir; ekran kartı (8 GB+) ve 32 GB bellek önerilir.",
      bayt: 29 * GB, yaklasik: true, ortak: "python-torch",
      lisans: "Apache-2.0", sure: "", gucluIcin: (d) => d.vram >= 8 && d.ram >= 30,
    },
  };

  const katalogdaMi = (id) => Object.prototype.hasOwnProperty.call(KATALOG, id);

  function studyoModeli(id) {
    if (!STUDYO) return null;
    const liste = [...(STUDYO.MUZIK_MODELLERI || []), ...(STUDYO.VIDEO_MODELLERI || [])];
    return liste.find((m) => m.id === id) || null;
  }

  // --------------------------------------------------------------------------
  // Donanım: tümleşik ekran kartının paylaşımlı belleği VRAM sayılmaz
  // --------------------------------------------------------------------------
  function tumlesikMi(ad) {
    const s = String(ad || "").toLowerCase();
    if (!s) return true;
    if (/nvidia|geforce|rtx|gtx|quadro|tesla/.test(s)) return false;
    if (/intel/.test(s)) return !/arc.*\b[ab]\d{3}\b/.test(s); // Arc A/B serisi ayrık; HD/UHD/Iris/"Arc Graphics" tümleşik
    if (/radeon|amd/.test(s)) {
      if (/\brx\s*\d|radeon\s*pro|\bw\d{4}\b/.test(s)) return false;
      return true; // "Radeon(TM) Graphics", "Radeon 780M", "Vega 8" vb.
    }
    if (/apple|adreno|mali|basic|virtual|llvmpipe|swiftshader/.test(s)) return true;
    return false;
  }

  function bosDisk() {
    try {
      const st = fs.statfsSync(ROOT);
      return Number(st.bavail) * Number(st.bsize);
    } catch (_) { return null; }
  }

  function donanim() {
    let s = {};
    try { s = getHardwareSpecs() || {}; } catch (_) {}
    const ram = Number(s.ram_total_gb) || Math.round(os.totalmem() / GB);
    const gpuAdi = String(s.gpu_name || "");
    const apple = process.platform === "darwin" && (os.arch() === "arm64" || /apple/i.test(String(s.cpu_name || "")));
    const tumlesik = !apple && tumlesikMi(gpuAdi);
    const bildirilen = Number(s.gpu_vram_gb) || 0;
    const vram = apple ? 0 : (tumlesik ? 0 : bildirilen);
    const gpuVar = apple ? ram >= 16 : vram >= 6;
    const seviye = gpuVar ? ((vram >= 12 || (apple && ram >= 32)) ? "yuksek" : "orta") : "dusuk";
    return {
      isletimSistemi: s.os_name || `${os.type()} ${os.release()}`,
      platform: process.platform,
      islemci: s.cpu_name || (os.cpus()[0] || {}).model || "",
      cekirdek: s.cpu_cores_physical || null,
      ram,
      gpuAdi,
      tumlesik,
      apple,
      // getHardwareSpecs tümleşik kartta gpu_vram_gb'yi zaten 0 verir; paylaşımlı bellek ayrı alanda gelir
      paylasimliBellek: tumlesik ? (Number(s.gpu_shared_memory_gb) || bildirilen) : 0,
      vram,
      gpuVar,
      seviye,
      bosDisk: bosDisk(),
    };
  }

  // --------------------------------------------------------------------------
  // "Bu bilgisayarda" notları: her öğe için o donanıma özel uyarı ve bilgiler
  // --------------------------------------------------------------------------
  function bilgisayarNotlari(id, d, tr = true) {
    const k = KATALOG[id];
    const notlar = [];
    let uyari = "";
    const gpuYok = !d.gpuVar;
    const tumlesikNot = d.tumlesik && d.paylasimliBellek > 0
      ? `Tümleşik ekran kartının ${gbYaz(d.paylasimliBellek)} GB paylaşımlı belleği VRAM değildir; bu model işlemci hızında çalışır.`
      : "";
    switch (k.kategori) {
      case "sohbet":
        if (id === "metin-gemma4-e4b") {
          if (d.ram < 7.5) uyari = `Bellek (${gbYaz(d.ram)} GB) bu model için çok düşük; açılmayabilir. Gemma 4 E2B'yi seçin.`;
          else if (d.ram < 12 * 0.9) uyari = `Bellek (${gbYaz(d.ram)} GB) sınırda: yavaş çalışabilir ya da diğer programları sıkıştırabilir. Gerekirse E2B'yi seçin.`;
          else notlar.push(`${gbYaz(d.ram)} GB bellekle ${d.gpuVar ? "ekran kartında" : "işlemcide"} rahat çalışır.`);
        } else if (id === "metin-gemma4-e2b") {
          if (d.ram < 6) uyari = `Bellek (${gbYaz(d.ram)} GB) çok düşük; sohbet çok yavaş olabilir.`;
          else if (d.ram < 12 * 0.9) notlar.push("Bu bilgisayarın belleğine daha uygun seçenek.");
        }
        break;
      case "stt":
        if (/medium|large/.test(id) && gpuYok) uyari = "Ekran kartı yok: sesli sohbette yazıya dökme belirgin şekilde gecikir.";
        break;
      case "tts":
        if (id === "ses-ema" && !tr) notlar.push("Tarayıcınızın dili Türkçe değil: Türkçe seslendirme gerekmiyorsa bunu kaldırabilirsiniz (İngilizce için Kokoro).");
        if (id === "ses-omnivoice") {
          uyari = gpuYok
            ? "Ekran kartı yok: her cümle dakikalar sürebilir; ~3,5 GB indirir. Ses klonlama yalnızca sesin sahibinin izniyle."
            : (d.vram < 8 ? `Ekran kartı belleği ${gbYaz(d.vram)} GB; 8 GB+ önerilir.` : "");
        }
        break;
      case "gorsel":
        if (/xl/.test(id)) {
          if (gpuYok) uyari = `Ekran kartı olmadan önerilmez: tek görsel ~20 dk ve ${gbYaz(d.ram)} GB bellek sıkışabilir.`;
          else if (d.vram < 8) uyari = `Ekran kartı belleği ${gbYaz(d.vram)} GB; SDXL için 8 GB+ önerilir.`;
        } else if (gpuYok) {
          notlar.push("Ekran kartı yok: çalışır ama yavaştır (tek görsel ~10 dk, hızlı modda ~3 dk).");
        }
        if (gpuYok && tumlesikNot) notlar.push(tumlesikNot);
        break;
      case "muzik":
      case "efekt":
        if (gpuYok) notlar.push(k.kategori === "muzik"
          ? "Ekran kartı yok: çalışır ama yavaştır (15 saniyelik müzik ~6 dk, i5-7200U ölçümü)."
          : "Ekran kartı yok: çalışır ama yavaştır (kısa bir efekt birkaç dakika sürebilir).");
        if (d.ram < 8) uyari = `Bellek (${gbYaz(d.ram)} GB) düşük; üretim sırasında bilgisayar yavaşlayabilir.`;
        break;
      case "video":
        if (id === "video-wan21-1.3b") {
          if (gpuYok) uyari = "Bu bilgisayarda önerilmez: ekran kartı yok, ~29 GB indirir; tek kısa video saatler sürebilir ya da bellek yetmeyebilir.";
          else if (d.vram < 8) uyari = `Ekran kartı belleği ${gbYaz(d.vram)} GB; Wan 2.1 için 8 GB+ önerilir.`;
          else if (d.ram < 30) uyari = `Bellek ${gbYaz(d.ram)} GB; Wan 2.1 için 32 GB önerilir.`;
        } else {
          if (gpuYok) uyari = "Ekran kartı yok: model kurulur ama tek kısa klip işlemcide çok uzun (saatler) sürebilir. Video için ekran kartı önerilir.";
          else if (d.vram < 6) uyari = `Ekran kartı belleği ${gbYaz(d.vram)} GB; AnimateDiff için 6 GB+ önerilir.`;
          if (d.ram < 12 * 0.9) notlar.push(`Bellek ${gbYaz(d.ram)} GB; 12 GB+ önerilir.`);
        }
        if (gpuYok && tumlesikNot) notlar.push(tumlesikNot);
        break;
      default:
        break;
    }
    return { uyari, notlar };
  }

  // --------------------------------------------------------------------------
  // Kurulu mu? (eşzamanlı; Python modül denetimleri ozellikler.cjs'in önbelleğinden okunur)
  // --------------------------------------------------------------------------
  function dosyaVarMi(k) {
    try { return fs.statSync(path.join(DIZIN[k.hedef], k.dosya)).size > 0; } catch (_) { return false; }
  }
  function ozellikBiliniyor(id) {
    try { return Boolean(OZ && typeof OZ.kuruluBiliniyorMu === "function" && OZ.kuruluBiliniyorMu(id)); } catch (_) { return false; }
  }
  function paketVar(id) {
    try { return Boolean(OZ && typeof OZ.paketKuruluMu === "function" && OZ.paketKuruluMu(id)); } catch (_) { return false; }
  }

  function kuruluMu(id) {
    const k = KATALOG[id];
    if (!k) return false;
    switch (k.yontem) {
      case "dosya": return dosyaVarMi(k);
      case "ema":
        try { return typeof emaKurulu === "function" ? Boolean(emaKurulu()) : fs.existsSync(EMA_ISARET); } catch (_) { return false; }
      case "ozellik": return ozellikBiliniyor(k.ozellik);
      case "paket": return paketVar(k.paket) && ozellikBiliniyor(k.ozellik);
      case "studyo": {
        const m = studyoModeli(k.studyoModel);
        if (!m) return false;
        return (m.paketler || []).every(paketVar) && (!m.ozellik || ozellikBiliniyor(m.ozellik));
      }
      case "kokoro":
        try { return kokoroKurulu ? Boolean(kokoroKurulu()) : false; } catch (_) { return false; }
      default: return false;
    }
  }

  // Bu sürümde / bu bilgisayarda kurulamıyorsa sebebi (boşsa kurulabilir)
  function kullanilamazSebep(id) {
    const k = KATALOG[id];
    if (!k) return "Bilinmeyen öğe.";
    if (k.yontem === "elle") return "Sihirbazdan kurulmaz: piper programını ve ses dosyalarını app/piper klasörüne koyun (ses dosyaları için Model Yöneticisi › Model ara › Piper).";
    if (k.yalnizcaWindows && !WINDOWS) {
      return k.yontem === "ema"
        ? "EMA otomatik kurulumu şimdilik yalnızca Windows'ta. İngilizce için Kokoro kurulumla birlikte gelir; Türkçe ses için README'deki elle kurulum adımlarına bakın."
        : "Bu ses motorunun otomatik kurulumu şimdilik yalnızca Windows'ta.";
    }
    if (k.yontem === "ozellik" && !(OZ && OZ.OZELLIKLER && OZ.OZELLIKLER[k.ozellik])) return "Bu sürümde bu motorun kurulum tanımı yok.";
    if (k.yontem === "paket" && !(OZ && OZ.PAKETLER && OZ.PAKETLER[k.paket])) return "Bu sürümde bu modelin kurulum tanımı yok.";
    if (k.yontem === "studyo") {
      const m = studyoModeli(k.studyoModel);
      if (!m || typeof STUDYO.modelKur !== "function") return "Bu sürümde stüdyo kurulumu sihirbaza bağlı değil; ilgili stüdyo sayfasındaki düğmeyle kurun.";
      if (m.supported === false || m.kurulabilir === false) return `${m.name} bu sürümde indirilemiyor.`;
    }
    if (k.yontem === "kokoro" && !kokoroKur) return "Kokoro uygulamayla birlikte kurulur (windows.bat).";
    return "";
  }

  // Doğrulama düzeyi (arayüzde kısa etiket olarak gösterilir)
  function dogrulama(k) {
    if (k.yontem === "dosya") return k.sha256 ? "Sabit sürüm + SHA256" : "Sabit sürüm";
    if (k.yontem === "paket" || k.yontem === "studyo") return "Sabit sürüm + dosya özetleri";
    if (k.yontem === "ozellik") return k.ozellik === "tts-omnivoice" ? "Sabit sürüm + paket özetleri" : "Sabit paket sürümleri + sabit model sürümü";
    if (k.yontem === "ema") return "Sabit paket sürümleri";
    return "";
  }

  function oneriler(d, dil) {
    const tr = String(dil || "tr").toLowerCase().startsWith("tr");
    const liste = [];
    for (const kat of KATEGORILER) {
      const ogeler = Object.keys(KATALOG).filter((id) => KATALOG[id].kategori === kat.id);
      // Varsayılan önce, alternatifler katalog sırasıyla altında
      ogeler.sort((a, b) => Number(Boolean(KATALOG[b].varsayilan)) - Number(Boolean(KATALOG[a].varsayilan)));
      for (const id of ogeler) {
        const k = KATALOG[id];
        const kurulu = kuruluMu(id);
        const sebep = kullanilamazSebep(id);
        const { uyari, notlar } = bilgisayarNotlari(id, d, tr);
        // Varsayılan seçim her bilgisayarda ve dilde aynı denenmiş settir (arayüz Türkçe)
        const varsayilan = Boolean(k.varsayilan);
        const guclu = !varsayilan && typeof k.gucluIcin === "function" && Boolean(k.gucluIcin(d));
        // Yalnızca güçlü donanımda önerilen ağır alternatif: zayıf bilgisayarda "Yine de göster"in arkasında
        const gizli = !varsayilan && Boolean(k.zayiftaGizle) && !guclu && !kurulu;
        liste.push({
          id,
          kategori: kat.id,
          grup: kat.ad,
          ad: k.ad,
          aciklama: k.aciklama,
          bayt: Math.round(Number(k.bayt) || 0),
          yaklasik: Boolean(k.yaklasik),
          lisans: k.lisans,
          sure: k.sure,
          ortak: k.ortak || "",
          dogrulama: dogrulama(k),
          varsayilan,
          alternatif: !varsayilan,
          guclu,
          agir: Boolean(k.agir),
          istegeBagli: varsayilan && Boolean(k.istegeBagli),
          gizli,
          gizliSebep: gizli ? (k.gizliSebep || "Bu bilgisayar için önerilmez.") : "",
          kurulu,
          secili: varsayilan && !kurulu && !sebep,
          uyari,
          notlar,
          kullanilamaz: sebep,
        });
      }
    }
    return liste;
  }

  function ortakBilesenler() {
    // Windows'ta taşınabilir Python + PyTorch kuruluysa ortak bileşen indirmesi sayılmaz
    const torchVar = WINDOWS && fs.existsSync(path.join(PY_DIR, "Lib", "site-packages", "torch"));
    const pythonVar = WINDOWS ? fs.existsSync(PYTHON) : true;
    return {
      "python-torch": { ...ORTAK["python-torch"], kurulu: torchVar },
      python: { ad: "Taşınabilir Python", bayt: 30 * MB, kurulu: pythonVar || torchVar },
    };
  }

  function opsiyonel(d) {
    return [
      {
        id: "bulut", baslik: "Bulut modelleri (isteğe bağlı)", sekme: "chat",
        aciklama: "OpenAI, Gemini, Anthropic ya da OpenRouter modellerini kendi API anahtarınızla ekleyebilirsiniz (sohbet › model seçici › “+ Bulut modeli ekle”). Anahtar yalnızca bu bilgisayarda şifreli saklanır; asistan kendiliğinden buluta geçmez.",
        uyari: "Bulut istekleri internete gider ve sağlayıcının koşullarına tabidir; ücretlendirme sağlayıcı hesabınızdan yapılır.",
      },
      {
        id: "modeller", baslik: "Daha fazla model", sekme: "models",
        aciklama: "Model Yöneticisi'nden başka modeller indirebilir, Hugging Face'te arayabilir, kendi dosyalarınızı içe aktarabilir ya da silebilirsiniz.",
        uyari: d.gpuVar ? "" : "Ekran kartı olmayan bilgisayarlarda büyük modeller (SDXL, Wan, OmniVoice) çok yavaş çalışır.",
      },
    ];
  }

  // --------------------------------------------------------------------------
  // İşaret dosyası
  // --------------------------------------------------------------------------
  function isaretOku() {
    try { return JSON.parse(fs.readFileSync(ISARET, "utf8")); } catch (_) { return null; }
  }
  function isaretYaz(veri) {
    fs.mkdirSync(CONFIG, { recursive: true });
    const gecici = ISARET + ".yaziliyor";
    fs.writeFileSync(gecici, JSON.stringify(veri, null, 2), "utf8");
    fs.renameSync(gecici, ISARET);
  }

  // --------------------------------------------------------------------------
  // Kuyruk: seçilenler sırayla (sunucunun tek indirme yuvası ve kurulum sıraları kullanılır)
  // --------------------------------------------------------------------------
  let kuyruk = { aktif: false, iptal: false, ogeler: [], sira: -1, asama: "", baslangic: null, bitti: null };
  const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
  const iptalMi = () => { if (kuyruk.iptal) throw new Error("İptal edildi"); };

  async function mesgulBitsin(kosul, aciklama) {
    let bildirildi = false;
    while (kosul()) {
      iptalMi();
      if (!bildirildi) { kuyruk.asama = aciklama; bildirildi = true; }
      await bekle(1000);
    }
  }

  function sha256Hesapla(dosya) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash("sha256");
      const akis = fs.createReadStream(dosya, { highWaterMark: 4 * MB });
      akis.on("data", (p) => { if (kuyruk.iptal) akis.destroy(new Error("İptal edildi")); else h.update(p); });
      akis.on("error", reject);
      akis.on("end", () => resolve(h.digest("hex")));
    });
  }

  async function dosyaIndir(oge) {
    const k = KATALOG[oge.id];
    await mesgulBitsin(() => indirmeMesgulMu(), "Başka bir indirmenin bitmesi bekleniyor…");
    fs.mkdirSync(DIZIN[k.hedef], { recursive: true });
    kuyruk.asama = `${k.ad} indiriliyor`;
    startModelDownload(hf(k.depo, k.commit, k.dosya), k.dosya, DIZIN[k.hedef], INDIRME_TURU[k.hedef]);
    await bekle(300);
    while (indirmeDurumu().active) {
      if (kuyruk.iptal) { try { indirmeIptal(); } catch (_) {} throw new Error("İptal edildi"); }
      await bekle(500);
    }
    const son = indirmeDurumu();
    if (son.error) throw new Error(String(son.error));
    const yol = path.join(DIZIN[k.hedef], k.dosya);
    if (!dosyaVarMi(k)) throw new Error("İndirme tamamlandı görünüyor ama dosya bulunamadı.");
    // Bütünlük: önce boyut, sonra SHA256 (sabit commit'teki LFS özeti). Uymazsa dosya silinir.
    const boyut = fs.statSync(yol).size;
    if (k.bayt && boyut !== k.bayt) {
      try { fs.unlinkSync(yol); } catch (_) {}
      throw new Error(`Dosya boyutu beklenenden farklı (${boyut} ≠ ${k.bayt}); indirme reddedildi, yeniden deneyin.`);
    }
    if (k.sha256) {
      kuyruk.asama = `${k.ad}: SHA256 özeti doğrulanıyor`;
      const ozet = await sha256Hesapla(yol);
      if (ozet !== k.sha256) {
        try { fs.unlinkSync(yol); } catch (_) {}
        throw new Error(`SHA256 özeti uyuşmuyor (beklenen ${k.sha256.slice(0, 12)}…, inen ${ozet.slice(0, 12)}…). Dosya bozuk ya da değiştirilmiş olabilir; silindi.`);
      }
    }
  }

  // ---- Python özelliği (ozellikler.cjs): kurulum sırası bitene kadar bekle, sonra kesin denetle ----
  async function ozellikKurVeBekle(ozellikId, etiket) {
    if (await OZ.ozellikKuruluMu(ozellikId, true).catch(() => false)) return;
    kuyruk.asama = `${etiket}: Python paketleri kuruluyor`;
    await OZ.ozellikKur(ozellikId);
    await bekle(500);
    for (;;) {
      iptalMi();
      const kd = OZ.kurulumDurumu();
      const suruyor = kd.aktif && kd.id === ozellikId;
      const sirada = (kd.sira || []).includes(ozellikId);
      if (suruyor && kd.asama) kuyruk.asama = kd.asama;
      else if (sirada) kuyruk.asama = `${etiket}: başka bir kurulumun bitmesi bekleniyor…`;
      if (!suruyor && !sirada) break;
      await bekle(1000);
    }
    const kd = OZ.kurulumDurumu();
    if (kd.id === ozellikId && kd.hata) throw new Error(kd.hata);
    if (!(await OZ.ozellikKuruluMu(ozellikId, true).catch(() => false))) throw new Error(`${etiket}: Python paketleri kurulamadı.`);
  }

  // ---- Model paketi (Seda, Duyu): sabit commit, her dosya özetle doğrulanır ----
  async function paketKur(oge) {
    const k = KATALOG[oge.id];
    if (!paketVar(k.paket)) {
      await mesgulBitsin(() => indirmeMesgulMu(), "Başka bir indirmenin bitmesi bekleniyor…");
      kuyruk.asama = `${k.ad} indiriliyor`;
      await OZ.paketIndir(k.paket);
      await bekle(500);
      while (OZ.paketDurumu().aktif) {
        iptalMi();
        const p = OZ.paketDurumu();
        kuyruk.asama = `${k.ad} indiriliyor${p.ilerleme >= 0 ? ` (%${p.ilerleme})` : ""}`;
        await bekle(1000);
      }
      const p = OZ.paketDurumu();
      if (p.hata && p.id === k.paket) throw new Error(p.hata);
      if (!paketVar(k.paket)) throw new Error(`${k.ad} indirilemedi.`);
    }
    // paketIndir Python paketlerini arka planda kurmaya başlar; bitmesini bekle ve denetle
    await ozellikKurVeBekle(k.ozellik, k.ad);
  }

  // ---- Stüdyo modeli (studyo.cjs): Python özelliği + sabit commit'li paketler ----
  async function studyoKur(oge) {
    const k = KATALOG[oge.id];
    const m = studyoModeli(k.studyoModel);
    if (!m) throw new Error("Stüdyo modeli bulunamadı: " + k.studyoModel);
    await mesgulBitsin(() => indirmeMesgulMu(), "Başka bir indirmenin bitmesi bekleniyor…");
    kuyruk.asama = `${k.ad}: kurulum başlıyor`;
    await STUDYO.modelKur(k.studyoModel);
    await bekle(800);
    for (;;) {
      iptalMi();
      const s = STUDYO.kurulumDurumu();
      const ozAktif = s.ozellik && s.ozellik.aktif;
      const paketAktif = Boolean(s.aktifPaket) || (s.sira || []).length > 0;
      if (paketAktif && s.paket && s.paket.aktif) kuyruk.asama = `${k.ad}: ${s.paket.etiket || "model dosyaları"} indiriliyor${s.paket.ilerleme >= 0 ? ` (%${s.paket.ilerleme})` : ""}`;
      else if (ozAktif) kuyruk.asama = `${k.ad}: ${s.ozellik.asama || "Python paketleri kuruluyor"}`;
      if (!ozAktif && !paketAktif) break;
      await bekle(1500);
    }
    const s = STUDYO.kurulumDurumu();
    if (s.hata && s.sonModel === k.studyoModel) throw new Error(s.hata);
    if (m.ozellik && s.ozellik && s.ozellik.id === m.ozellik && s.ozellik.hata) throw new Error(s.ozellik.hata);
    const eksik = (m.paketler || []).filter((p) => !paketVar(p));
    if (eksik.length) throw new Error("Model dosyaları inmedi: " + eksik.join(", "));
    if (m.ozellik && !(await OZ.ozellikKuruluMu(m.ozellik, true).catch(() => false))) throw new Error("Python paketleri kurulamadı.");
  }

  // ---- EMA kurulumu (ses-motoru-kur.bat'ın uygulama içi karşılığı) ----
  function pipEnv(ek = {}) {
    return { ...process.env, PIP_CACHE_DIR: PIP_CACHE, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PIP_DISABLE_PIP_VERSION_CHECK: "1", ...ek };
  }
  function calistir(komut, argumanlar, secenekler = {}) {
    return new Promise((resolve) => {
      let cikti = "";
      let proc;
      try {
        proc = spawn(komut, argumanlar, { windowsHide: true, env: secenekler.env || process.env, cwd: secenekler.cwd || ROOT });
      } catch (err) { resolve({ kod: -1, cikti: String(err.message || err) }); return; }
      kuyruk.surec = proc;
      const ekle = (d) => { cikti = (cikti + d.toString()).slice(-20000); };
      proc.stdout.on("data", ekle);
      proc.stderr.on("data", ekle);
      const zaman = secenekler.zamanAsimiMs ? setTimeout(() => { try { proc.kill(); } catch (_) {} }, secenekler.zamanAsimiMs) : null;
      proc.on("error", (err) => { if (zaman) clearTimeout(zaman); kuyruk.surec = null; resolve({ kod: -1, cikti: cikti + String(err.message || err) }); });
      proc.on("exit", (kod) => { if (zaman) clearTimeout(zaman); kuyruk.surec = null; resolve({ kod, cikti }); });
    });
  }
  const sonSatirlar = (s, n = 3) => String(s || "").trim().split(/\r?\n/).slice(-n).join(" | ").slice(0, 600);

  async function pythonHazirla() {
    if (!fs.existsSync(PYTHON)) {
      kuyruk.asama = "EMA: taşınabilir Python indiriliyor (~10 MB)";
      fs.mkdirSync(PY_DIR, { recursive: true });
      const ps = [
        "$ProgressPreference='SilentlyContinue'",
        "$zip=Join-Path $env:YAS_PY_DIR 'python.zip'",
        "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile $zip",
        "if ((Get-FileHash $zip -Algorithm MD5).Hash -ne $env:YAS_PY_MD5) { Remove-Item $zip; throw 'Python arsivinin ozeti uyusmuyor' }",
        "Expand-Archive -Path $zip -DestinationPath $env:YAS_PY_DIR -Force",
        "Remove-Item $zip",
        "$pth=Join-Path $env:YAS_PY_DIR 'python312._pth'",
        "(Get-Content $pth) -replace '^#\\s*import site','import site' | Set-Content -Encoding ASCII $pth",
      ].join("; ");
      const r = await calistir("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        { zamanAsimiMs: 10 * 60 * 1000, env: { ...process.env, YAS_PY_DIR: PY_DIR, YAS_PY_MD5: PYTHON_EMBED_MD5 } });
      if (!fs.existsSync(PYTHON)) throw new Error("Python indirilemedi: " + sonSatirlar(r.cikti));
    }
    const pipVar = await calistir(PYTHON, ["-m", "pip", "--version"], { env: pipEnv() });
    if (pipVar.kod !== 0) {
      kuyruk.asama = "EMA: pip kuruluyor";
      // Sabit sürümlü pip wheel'i (PyPI), SHA256 doğrulanarak; sabitlenmemiş get-pip.py betiği çalıştırılmaz
      const PIP_TEKER = { ad: "pip-26.2.1-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/f3/6e/1736e5b4ae2b778ef2f81c47d797de9f891d4d8acb047a24ca37a60294dd/pip-26.2.1-py3-none-any.whl", sha256: "71138adf1f4ca900cdb7d289c21b7494329f2332b6d85f0e1c42108c0384ed3e" };
      const teker = path.join(PY_DIR, PIP_TEKER.ad);
      const ps = "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri $env:YAS_PIP_URL -OutFile $env:YAS_PIP_WHL; if ((Get-FileHash $env:YAS_PIP_WHL -Algorithm SHA256).Hash -ne $env:YAS_PIP_SHA) { Remove-Item $env:YAS_PIP_WHL; throw 'pip paketinin ozeti uyusmuyor' }";
      await calistir("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { zamanAsimiMs: 5 * 60 * 1000, env: { ...process.env, YAS_PIP_URL: PIP_TEKER.url, YAS_PIP_WHL: teker, YAS_PIP_SHA: PIP_TEKER.sha256 } });
      if (!fs.existsSync(teker)) throw new Error("pip paketi indirilemedi ya da SHA256 özeti uyuşmadı.");
      const kurucu = "import sys; w=sys.argv[1]; sys.path.insert(0, w); from pip._internal.cli.main import main; sys.exit(main(['install', '--no-index', '--no-warn-script-location', w]))";
      const r = await calistir(PYTHON, ["-c", kurucu, teker], { env: pipEnv(), zamanAsimiMs: 10 * 60 * 1000 });
      try { fs.unlinkSync(teker); } catch (_) {}
      if (r.kod !== 0) throw new Error("pip kurulamadı: " + sonSatirlar(r.cikti));
    }
  }

  async function emaKur() {
    if (!WINDOWS) throw new Error("EMA otomatik kurulumu şimdilik yalnızca Windows'ta.");
    // Aynı taşınabilir Python'a eşzamanlı pip yazılmasın: Model Yöneticisi'nden başlatılmış bir kurulum varsa bekle
    await mesgulBitsin(() => Boolean(OZ && OZ.kurulumDurumu && OZ.kurulumDurumu().aktif), "Başka bir ses motoru kurulumunun bitmesi bekleniyor…");
    await pythonHazirla();
    iptalMi();
    // Sürümler sabit, yalnızca hazır paket (ozellikler.cjs'teki Ahenk adımlarıyla aynı)
    const adimlar = [
      ["--only-binary=:all:", "--index-url", "https://download.pytorch.org/whl/cpu", "torch==2.14.1"],
      ["--only-binary=:all:", "ema-lightning==1.1.2", "soundfile==0.14.0", "huggingface_hub==2.3.0"],
    ];
    for (let i = 0; i < adimlar.length; i += 1) {
      iptalMi();
      kuyruk.asama = `EMA: paketler kuruluyor (${i + 1}/${adimlar.length})${i === 0 ? " — PyTorch, birkaç dakika sürebilir" : ""}`;
      const r = await calistir(PYTHON, ["-m", "pip", "install", "--no-warn-script-location", ...adimlar[i]], { env: pipEnv(), zamanAsimiMs: 60 * 60 * 1000 });
      if (r.kod !== 0) throw new Error("pip hatası: " + sonSatirlar(r.cikti, 4));
    }
    kuyruk.asama = "EMA: ses modeli indiriliyor (~34 MB) ve deneniyor";
    fs.mkdirSync(EMA_KLASOR, { recursive: true });
    const deneme = path.join(EMA_KLASOR, "deneme.wav");
    const py = "import os; from ema_lightning import EMA; s=EMA().say('Kurulum tamamlandı. Merhaba, ben Vega.', path=os.environ['YAS_WAV'], sample_rate=24000); print(round(s.duration, 1))";
    const r = await calistir(PYTHON, ["-c", py], {
      env: pipEnv({ HF_HOME: path.join(EMA_KLASOR, "hf"), HF_HUB_DISABLE_TELEMETRY: "1", YAS_WAV: deneme }),
      zamanAsimiMs: 30 * 60 * 1000,
    });
    if (r.kod !== 0 || !fs.existsSync(deneme)) throw new Error("EMA ses modeli indirilemedi ya da çalışmadı: " + sonSatirlar(r.cikti));
    fs.writeFileSync(EMA_ISARET, `kuruldu ${new Date().toISOString()} (ilk kurulum sihirbazı)\n`, "utf8");
  }

  async function ogeKur(oge) {
    const k = KATALOG[oge.id];
    switch (k.yontem) {
      case "dosya": return dosyaIndir(oge);
      case "ema": return emaKur();
      case "ozellik": return ozellikKurVeBekle(k.ozellik, k.ad);
      case "paket": return paketKur(oge);
      case "studyo": return studyoKur(oge);
      case "kokoro": kokoroKur(); return undefined;
      default: throw new Error("Bu öğe sihirbazdan kurulamaz.");
    }
  }

  async function kuyruguCalistir() {
    for (let i = 0; i < kuyruk.ogeler.length; i += 1) {
      const oge = kuyruk.ogeler[i];
      kuyruk.sira = i;
      if (kuyruk.iptal) { oge.durum = "iptal"; continue; }
      if (kuruluMu(oge.id)) { oge.durum = "atlandi"; continue; }
      oge.durum = "suruyor";
      try {
        await ogeKur(oge);
        oge.durum = "tamam";
        log(`  [ilk-kurulum] ${oge.id} hazır`);
      } catch (err) {
        oge.durum = kuyruk.iptal ? "iptal" : "hata";
        oge.hata = err.message || String(err);
        log(`  [ilk-kurulum] ${oge.id}: ${oge.hata}`);
      }
    }
    kuyruk = { ...kuyruk, aktif: false, sira: -1, asama: kuyruk.iptal ? "İptal edildi" : "Bitti", bitti: Date.now(), surec: null };
  }

  function kuyrukOzeti() {
    const oge = kuyruk.sira >= 0 ? kuyruk.ogeler[kuyruk.sira] : null;
    let indirme = null;
    if (oge && KATALOG[oge.id] && KATALOG[oge.id].yontem === "dosya") {
      const d = indirmeDurumu() || {};
      if (d.active && d.filename === KATALOG[oge.id].dosya) {
        indirme = { yuzde: Number(d.progress) || 0, hiz: d.speed || "", kalan: d.eta || 0, inen: d.downloadedBytes || 0, toplam: d.totalBytes || 0 };
      }
    }
    return {
      aktif: kuyruk.aktif, iptal: kuyruk.iptal, asama: kuyruk.asama, sira: kuyruk.sira, bitti: kuyruk.bitti,
      ogeler: kuyruk.ogeler.map((o) => ({ id: o.id, ad: KATALOG[o.id].ad, durum: o.durum, hata: o.hata || "" })),
      indirme,
    };
  }

  // --------------------------------------------------------------------------
  // HTTP
  // --------------------------------------------------------------------------
  async function handle(req, res) {
    const adres = new URL(req.url, "http://yerel");
    const yol = adres.pathname;

    if (yol === "/api/ilk-kurulum/durum" && req.method === "GET") {
      const d = donanim();
      const isaret = isaretOku();
      return json(res, 200, {
        ok: true,
        gosterilsin: !isaret,
        isaret,
        donanim: d,
        kategoriler: KATEGORILER,
        oneriler: oneriler(d, adres.searchParams.get("dil") || "tr"),
        ortak: ortakBilesenler(),
        opsiyonel: opsiyonel(d),
        kuyruk: kuyrukOzeti(),
      }), true;
    }

    if (yol === "/api/ilk-kurulum/indir" && req.method === "POST") {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      if (kuyruk.aktif) return json(res, 409, { ok: false, error: "Kurulum zaten sürüyor." }), true;
      const secimler = Array.isArray(body.secimler) ? [...new Set(body.secimler.map(String))] : [];
      // Yalnızca katalogun kendi anahtarları ("constructor", "__proto__" gibi kalıtılmış adlar değil) ve kurulabilenler
      const gecerli = secimler.filter((id) => katalogdaMi(id) && !kullanilamazSebep(id));
      if (!gecerli.length) return json(res, 400, { ok: false, error: "İndirilecek geçerli bir seçim yok." }), true;
      const sirasi = (id) => KURULUM_SIRASI[KATALOG[id].kategori] * 100 + Object.keys(KATALOG).indexOf(id);
      gecerli.sort((a, b) => sirasi(a) - sirasi(b));
      kuyruk = { aktif: true, iptal: false, ogeler: gecerli.map((id) => ({ id, durum: "bekliyor" })), sira: -1, asama: "Başlıyor", baslangic: Date.now(), bitti: null };
      kuyruguCalistir().catch((err) => { log("  [ilk-kurulum] kuyruk hatası: " + (err.message || err)); kuyruk.aktif = false; });
      return json(res, 200, { ok: true, kuyruk: kuyrukOzeti() }), true;
    }

    if (yol === "/api/ilk-kurulum/iptal" && req.method === "POST") {
      if (kuyruk.aktif) {
        kuyruk.iptal = true;
        try { if (kuyruk.surec) kuyruk.surec.kill(); } catch (_) {}
      }
      return json(res, 200, { ok: true, kuyruk: kuyrukOzeti() }), true;
    }

    if (yol === "/api/ilk-kurulum/tamam" && req.method === "POST") {
      const body = (await readJsonBody(req, res)) || null;
      if (!body) return true;
      try {
        const yz = body.yapayZeka && typeof body.yapayZeka === "object" ? body.yapayZeka : null;
        const yzAdi = yz ? String(yz.ad || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) : "";
        isaretYaz({
          surum: 2,
          tarih: new Date().toISOString(),
          atlandi: body.atlandi === true,
          secilenler: Array.isArray(body.secilenler) ? body.secilenler.map(String).filter(katalogdaMi) : [],
          ...(yz ? { yapayZeka: { ad: yzAdi || "Vega", ozelMetin: typeof yz.ozelMetin === "boolean" ? yz.ozelMetin : null } } : {}),
        });
        return json(res, 200, { ok: true }), true;
      } catch (err) {
        return json(res, 500, { ok: false, error: err.message || String(err) }), true;
      }
    }

    return false;
  }

  return { handle, KATALOG, KATEGORILER, donanim, tumlesikMi, oneriler, kullanilamazSebep };
};

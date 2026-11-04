// ============================================================================
// MÜZİK, SES EFEKTİ VE VİDEO STÜDYOSU — sunucu tarafı (Yerel AI Stüdyosu)
// DD:YZ Sansürsüz Lokal AI Stüdyosu V2 (MIT, Tech Jarves / DD:YZ) kaynağından uyarlanmıştır
// (serve.cjs: /api/music/models, /api/audio/music|progress|history|delete, /api/video/models|generate|
//  status|gallery uç noktaları, model katalogları ve donanım seviyeleri).
//
// KULLANIM (serve.cjs):
//   const studyo = require("./studyo.cjs")({ ROOT, OZ, json, readJsonBody, motorGunlugu, pathInside, log });
//   ... istek işleyicide, genel güvenlik denetimlerinden SONRA:
//   if (await studyo.handle(req, res)) return;
//
// ctx alanları:
//   ROOT, OZ (ozellikler.cjs dönüşü), json(res, kod, nesne), readJsonBody(req, res) (hata olursa null döner ve
//   yanıtı kendisi verir), motorGunlugu(satir), pathInside(cocuk, ebeveyn), log(...)
//   İsteğe bağlı:
//     ctx.bellekBosalt(tur) -> Promise   Ağır iş başlamadan önce çağrılır (ör. sohbet modelini / sd-server'ı
//                                         bellekten çıkarmak için). tur: "muzik" | "efekt" | "video".
//     ctx.cevir(metin, tur) -> Promise<string> Türkçe (ya da İngilizce olmayan) istemi İngilizceye çevirir
//                                         (ör. yerel sohbet modeli). Her türde, iş başlarken ve bellek boşaltılmadan
//                                         ÖNCE çağrılır (video sohbet modelini kapatmadan). Çeviri gerekmiyorsa ya da
//                                         model yoksa metni olduğu gibi döndürmelidir. Verilmezse istem olduğu gibi gider.
//     ctx.cevirHazir() -> bool            Çevirmen şu an kullanılabilir mi (Video Stüdyosu notu için).
//     bellekBosalt ikinci bağımsız değişken olarak { id, tur, kaynak, iptalMi(), asamaYaz(metin) } alır
//                                         (ör. Vega'nın yanıtı bitene kadar beklerken kartta aşama gösterilir).
//     ctx.isBitince(ozet)                 Başlamış bir iş bitince (tamam / hata / iptal) çağrılır
//                                         (ör. video için bellekten çıkarılan sohbet modelini geri yüklemek için).
//     ctx.isEkBilgi(id) -> nesne|null     GET /api/studyo/is/<id> yanıtına eklenir (ör. sohbet modelinin durumu).
//     ctx.sohbetModeliDurumu() -> nesne   GET /api/studyo/sohbet-modeli yanıtına eklenir.
//     ctx.sohbetModeliniSimdiYukle() -> { ok, error?, kod? }  POST /api/studyo/sohbet-modeli/geri-yukle
//                                         (sohbetteki "Şimdi geri yükle": bekleyen sohbet modelini beklemeden yükler).
//
// GÜVENLİK: Üretim her zaman AYRI bir Python sürecinde çalışır (tek seferlik süreç, HF_HUB_OFFLINE=1,
// Hugging Face anahtarı verilmez). Bellek yetmezliği, çökme ya da zaman aşımı Node sunucusunu etkilemez:
// süreç (alt süreçleriyle birlikte) öldürülür, hata JSON olarak bildirilir. Aynı anda tek ağır iş çalışır,
// diğerleri sıraya girer. Model ağırlıkları yalnızca huggingface.co'dan, sabit commit'ten, dosya özeti
// doğrulanarak (ozellikler.cjs paketIndir) ve yalnızca .safetensors/.json/.txt olarak indirilir.
// ============================================================================
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

module.exports = function studyoAltyapisi(ctx) {
  const { ROOT, OZ, json, readJsonBody, pathInside } = ctx;
  const motorGunlugu = typeof ctx.motorGunlugu === "function" ? ctx.motorGunlugu : () => {};
  const log = typeof ctx.log === "function" ? ctx.log : console.log;

  const APP = path.join(ROOT, "app");
  const CIKTI = { muzik: path.join(APP, "outputs", "muzik"), video: path.join(APP, "outputs", "video") };
  const GORSEL_MODELLER = path.join(APP, "models");
  const MUZIK_KLASORU = (OZ.KLASORLER && OZ.KLASORLER.muzik) || path.join(APP, "music-models");
  const VIDEO_KLASORU = (OZ.KLASORLER && OZ.KLASORLER.video) || path.join(APP, "video-models");
  const ISCILER = {
    muzik: path.join(ROOT, "scripts", "workers", "muzik_efekt.py"),
    video: path.join(ROOT, "scripts", "workers", "video_uret.py"),
  };
  const HF_CACHE = path.join(APP, "cache", "hf");
  for (const k of Object.values(CIKTI)) { try { fs.mkdirSync(k, { recursive: true }); } catch (_) {} }

  // --------------------------------------------------------------------------
  // Python özellikleri ve sabit model paketleri. ozellikler.cjs'teki nesnelere eklenir (aynı nesne
  // referansı; ozellikKur/paketIndir bunları doğrudan görür). ozellikler.cjs'e taşınırsa bu blok silinebilir.
  // --------------------------------------------------------------------------
  const ORTAK_PIP = ["--only-binary=:all:", "transformers==5.20.0", "accelerate==1.15.0", "diffusers==0.42.1",
    "huggingface_hub==2.3.0", "safetensors==0.8.0", "soundfile==0.14.0", "numpy==2.5.4", "regex==2026.9.29",
    "pillow==12.2.0", "requests==2.34.2", "urllib3==2.8.0", "certifi==2026.10.23", "charset-normalizer==3.5.2",
    "idna==3.20", "importlib-metadata==10.1.0", "zipp==4.1.2", "filelock==4.2.4", "psutil==7.2.2", "pyyaml==6.0.3"];
  const TORCH_PIP = ["--only-binary=:all:", "--index-url", "https://download.pytorch.org/whl/cpu", "torch==2.14.1"];
  const STUDYO_OZELLIKLERI = {
    "muzik-efekt": {
      etiket: "Müzik ve ses efekti (MusicGen Small, AudioLDM-S)",
      moduller: ["torch", "transformers", "diffusers", "accelerate", "soundfile", "safetensors", "PIL"],
      adimlar: [TORCH_PIP, ORTAK_PIP],
      boyut: "~60 MB (PyTorch kuruluysa), PyTorch yoksa ~250 MB daha",
    },
    "video": {
      etiket: "Video üretimi (AnimateDiff, Wan 2.1)",
      moduller: ["torch", "transformers", "diffusers", "accelerate", "safetensors", "PIL", "imageio_ffmpeg"],
      adimlar: [TORCH_PIP, [...ORTAK_PIP, "imageio-ffmpeg==0.6.0"]],
      boyut: "~90 MB (PyTorch kuruluysa)",
    },
  };
  const STUDYO_PAKETLERI = {
    // Lisans: CC-BY-NC 4.0. spiece.model ve pickle (.bin) dosyaları indirilmez; tokenizer.json yeterli.
    "musicgen-small": {
      repo: "facebook/musicgen-small", surum: "4c8334b02c6ec4e8664a91979669a501ec497792", klasor: MUZIK_KLASORU, ad: "musicgen-small", ozellik: "muzik-efekt",
      dahil: [/^(config|generation_config|preprocessor_config|special_tokens_map|tokenizer|tokenizer_config)\.json$/i, /^model\.safetensors$/i],
      etiket: "MusicGen Small (2,4 GB)",
    },
    // Lisans: CC-BY-NC-SA 4.0
    "audioldm-s-full-v2": {
      repo: "cvssp/audioldm-s-full-v2", surum: "feeb3d14203495a4b6ac0893cbdedb2159b4819c", klasor: MUZIK_KLASORU, ad: "audioldm-s-full-v2", ozellik: "muzik-efekt",
      dahil: [/^model_index\.json$/i, /^(scheduler|text_encoder|tokenizer|unet|vae|vocoder)\/[^/]+\.(json|txt|safetensors)$/i],
      etiket: "AudioLDM-S Full v2 (1,7 GB)",
    },
    // HF deposunda lisans alanı yok; özgün AnimateDiff (github.com/guoyww/AnimateDiff) Apache-2.0.
    "animatediff-v1-5-2": {
      repo: "guoyww/animatediff-motion-adapter-v1-5-2", surum: "6167b88ffe39b4441fdf2113e77b99a6f56b7906", klasor: VIDEO_KLASORU, ad: "animatediff-motion-adapter-v1-5-2", ozellik: "video",
      dahil: [/^config\.json$/i, /^diffusion_pytorch_model\.safetensors$/i],
      etiket: "AnimateDiff hareket adaptörü v1.5 v2 (1,8 GB)",
    },
    // Yalnızca yapılandırma + CLIP tokenizer (json/txt, ~2 MB); ağırlık yok. CreativeML OpenRAIL-M.
    "sd15-yapilandirma": {
      repo: "stable-diffusion-v1-5/stable-diffusion-v1-5", surum: "451f4fe16113bff5a5d2269ed5ad43b0592e9a14", klasor: VIDEO_KLASORU, ad: "sd15-yapilandirma", ozellik: "video",
      dahil: [/^model_index\.json$/i, /^(scheduler|text_encoder|tokenizer|unet|vae|feature_extractor)\/[^/]+\.(json|txt)$/i],
      etiket: "SD 1.5 yapılandırma dosyaları (2 MB)",
    },
    // Apache-2.0. ~29 GB (UMT5-XXL metin kodlayıcı fp32 22,7 GB). spiece.model indirilmez.
    "wan21-t2v-1.3b": {
      repo: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers", surum: "0fad780a534b6463e45facd96134c9f345acfa5b", klasor: VIDEO_KLASORU, ad: "wan21-t2v-1.3b", ozellik: "video",
      dahil: [/^model_index\.json$/i, /^(scheduler|text_encoder|tokenizer|transformer|vae)\/[^/]+\.(json|safetensors)$/i],
      etiket: "Wan 2.1 T2V 1.3B (~29 GB)",
    },
  };
  if (OZ.OZELLIKLER) for (const [k, v] of Object.entries(STUDYO_OZELLIKLERI)) if (!OZ.OZELLIKLER[k]) OZ.OZELLIKLER[k] = v;
  if (OZ.PAKETLER) for (const [k, v] of Object.entries(STUDYO_PAKETLERI)) if (!OZ.PAKETLER[k]) OZ.PAKETLER[k] = v;

  // --------------------------------------------------------------------------
  // Model katalogları
  // --------------------------------------------------------------------------
  const MUZIK_MODELLERI = [
    {
      id: "musicgen-small", tur: "muzik", name: "Meta MusicGen Small (300M)", paketler: ["musicgen-small"], ozellik: "muzik-efekt",
      format: "Transformers (klasör, safetensors)", approxSize: "2,4 GB", resolution: "32 kHz mono", maxDuration: 300, minRamGb: 8,
      lisans: "CC-BY-NC 4.0 — yalnızca ticari olmayan kullanım (Meta AudioCraft)",
      notes: "Metinden enstrümantal müzik üreten 300M parametreli otoregresif model. Türkçe tarifler V2'nin sözlüğüyle İngilizceye çevrilir. 30 sn'den uzun parçalar 25 sn'lik bölümlerin birleştirilmesiyle üretilir.",
      pageUrl: "https://huggingface.co/facebook/musicgen-small", recommendedTiers: ["Low", "Mid", "High"],
    },
    {
      id: "audioldm-s", tur: "efekt", name: "AudioLDM-S Full v2 (hafif ses efekti)", paketler: ["audioldm-s-full-v2"], ozellik: "muzik-efekt",
      format: "Diffusers (klasör, safetensors)", approxSize: "1,7 GB", resolution: "16 kHz mono", maxDuration: 20, minRamGb: 6,
      lisans: "CC-BY-NC-SA 4.0 — ticari olmayan kullanım, aynı lisansla paylaşım (Surrey CVSSP)",
      notes: "İlk nesil AudioLDM'nin küçük sürümü; en az bellekle ses efekti, ambiyans ve foley üretir. Türkçe terimler sözlükle çevrilir.",
      pageUrl: "https://huggingface.co/cvssp/audioldm-s-full-v2", recommendedTiers: ["Low", "Mid"],
    },
    {
      id: "musicgen-medium", tur: "muzik", name: "Meta MusicGen Medium / Large", supported: false, approxSize: "3,7-6,5 GB",
      notes: "Bu sürümde yok: V2 bu modelleri AudioCraft'ın pickle ağırlık dosyasından (torch.load) yüklüyor; güvenlik kuralımız gereği alınmadı. İşlemcide zaten çok yavaştır.",
      pageUrl: "https://huggingface.co/facebook/musicgen-medium",
    },
    {
      id: "audioldm2", tur: "efekt", name: "AudioLDM 2 / AudioLDM 2 Large", supported: false, approxSize: "4,5-6 GB",
      notes: "Bu sürümde yok: transformers 5 ile GPT-2 uyumluluk yaması gerektiriyor ve 4,5-6 GB; işlemcide AudioLDM-S'ye göre birkaç kat yavaş.",
      pageUrl: "https://huggingface.co/cvssp/audioldm2",
    },
    {
      id: "stable-audio-3-small", tur: "muzik", name: "Stable Audio 3 Small (müzik / SFX)", supported: false, approxSize: "3,5 GB",
      notes: "Bu sürümde yok: Hugging Face'te lisans onayı (gated) ve kişisel HF anahtarı gerektiriyor; Stability AI Community License + Gemma şartları. V2'nin kullandığı stable-audio-3 paketi PyPI'da yok ve torch 2.7.1'e sabitli. diffusers 0.42'de resmî StableAudio3Pipeline bulunduğundan ileride lisans onayı akışıyla eklenebilir.",
      pageUrl: "https://huggingface.co/stabilityai/stable-audio-3-small-music",
    },
  ];

  const VIDEO_MODELLERI = [
    {
      id: "animatediff", tier: "Low", tierLabel: "Düşük seviye: 6-8 GB VRAM", name: "AnimateDiff v1.5 v2 + SD 1.5 (metinden video)",
      paketler: ["sd15-yapilandirma", "animatediff-v1-5-2"], ozellik: "video", tabanGerekir: true,
      format: "Diffusers hareket adaptörü (safetensors) + SD 1.5 tek dosya", approxSize: "1,8 GB (+ app/models içindeki SD 1.5 modeliniz)",
      resolution: "512x512, 16 kare (8 FPS ≈ 2 sn)", minVramGb: 6, minRamGb: 12, modes: ["t2v"],
      lisans: "Hareket adaptörü: AnimateDiff (Apache-2.0, özgün proje). Taban model: seçtiğiniz SD 1.5 dosyasının kendi lisansı.",
      notes: "SD 1.5 tabanlı hareket modülü; kısa klip üretir. Bilgisayarınızdaki SD 1.5 görsel modellerinden birini taban olarak kullanır (gerçekçi sonuç için CyberRealistic önerilir).",
      pageUrl: "https://huggingface.co/guoyww/animatediff-motion-adapter-v1-5-2", recommendedTiers: ["Low", "Mid", "High"],
    },
    {
      id: "wan21-1.3b", tier: "Mid", tierLabel: "Orta seviye: 8 GB+ VRAM, 32 GB RAM önerilir", name: "Wan 2.1 T2V 1.3B (Diffusers)",
      paketler: ["wan21-t2v-1.3b"], ozellik: "video",
      format: "Diffusers (DiT + UMT5-XXL + VAE)", approxSize: "~29 GB (fp32 UMT5-XXL metin kodlayıcı dahil)",
      resolution: "832x480 (480p), 16 FPS", minVramGb: 8, minRamGb: 16, onerilenRamGb: 32, modes: ["t2v"],
      lisans: "Apache-2.0 (Alibaba Wan-AI)",
      notes: "Alibaba Wan 2.1'in 1.3B parametreli metinden video modeli. Önerilen çözünürlük 480p. İşlemcide metin kodlayıcı önce tek başına çalıştırılıp bellekten atılır (tepe ~12 GB RAM).",
      pageUrl: "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers", recommendedTiers: ["Mid", "High"],
    },
    {
      id: "svd-xt", tier: "High", tierLabel: "Yüksek seviye: 12 GB+ VRAM", name: "Stable Video Diffusion XT 1.1 (görselden video)",
      kurulabilir: false, elleKlasor: "svd-xt-1.1", ozellik: "video", approxSize: "4,5 GB",
      resolution: "1024x576, 25 kare", minVramGb: 12, minRamGb: 16, modes: ["i2v"],
      lisans: "Stability AI Community License (Hugging Face'te lisans onayı gerekir)",
      notes: "İndirme bu sürümde kapalı (lisans onaylı depo, NVIDIA ekran kartı gerekir). Diffusers klasörünü app/video-models/svd-xt-1.1 içine elle koyarsanız kullanılabilir.",
      pageUrl: "https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt-1-1", recommendedTiers: ["High"],
    },
    {
      id: "wan21-14b", tier: "High", tierLabel: "Yüksek seviye: 24 GB+ VRAM / 64 GB RAM", name: "Wan 2.1 T2V 14B (Diffusers)",
      kurulabilir: false, elleKlasor: "wan21-t2v-14b", ozellik: "video", approxSize: "~70 GB",
      resolution: "1280x720, 16 FPS", minVramGb: 24, minRamGb: 64, modes: ["t2v"],
      lisans: "Apache-2.0 (Alibaba Wan-AI)",
      notes: "İndirme bu sürümde kapalı (çok büyük). Diffusers klasörünü app/video-models/wan21-t2v-14b içine elle koyarsanız kullanılabilir.",
      pageUrl: "https://huggingface.co/Wan-AI/Wan2.1-T2V-14B-Diffusers", recommendedTiers: ["High"],
    },
  ];

  // --------------------------------------------------------------------------
  // Donanım
  // --------------------------------------------------------------------------
  let pyDonanim = { veri: null, zaman: 0, suren: null };
  let gpuAdlari = null;

  function calistirKisa(komut, argumanlar, girdi, zamanAsimiMs) {
    return new Promise((resolve) => {
      let out = "", err = "";
      let p;
      try { p = spawn(komut, argumanlar, { windowsHide: true, env: pyOrtami(), cwd: path.dirname(ISCILER.muzik) }); } catch (e) { resolve({ kod: -1, out: "", err: String(e.message || e) }); return; }
      const z = setTimeout(() => surecAgaciniOldur(p), zamanAsimiMs);
      p.stdout.on("data", (d) => { out = (out + d).slice(-20000); });
      p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
      p.on("error", (e) => { clearTimeout(z); resolve({ kod: -1, out, err: err + String(e.message || e) }); });
      p.on("close", (kod) => { clearTimeout(z); resolve({ kod, out, err }); });
      if (girdi != null) { try { p.stdin.end(Buffer.from(girdi, "utf8")); } catch (_) {} }
    });
  }

  function gpuAdlariniAl() {
    if (gpuAdlari) return Promise.resolve(gpuAdlari);
    if (process.platform !== "win32") { gpuAdlari = []; return Promise.resolve(gpuAdlari); }
    return new Promise((resolve) => {
      let out = "";
      let p;
      try {
        p = spawn("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }"], { windowsHide: true });
      } catch (_) { gpuAdlari = []; resolve(gpuAdlari); return; }
      const z = setTimeout(() => { try { p.kill(); } catch (_) {} }, 15000);
      p.stdout.on("data", (d) => { out += d; });
      p.on("error", () => { clearTimeout(z); gpuAdlari = []; resolve(gpuAdlari); });
      p.on("close", () => { clearTimeout(z); gpuAdlari = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 4); resolve(gpuAdlari); });
    });
  }

  function pythonVarMi() {
    return process.platform !== "win32" || fs.existsSync(OZ.PYTHON);
  }

  async function pythonDonanimi(yenile = false) {
    if (!yenile && pyDonanim.veri && Date.now() - pyDonanim.zaman < 30 * 60 * 1000) return pyDonanim.veri;
    if (pyDonanim.suren) return pyDonanim.suren;
    if (!pythonVarMi()) return null;
    pyDonanim.suren = (async () => {
      const r = await calistirKisa(OZ.PYTHON, ["-u", ISCILER.muzik], JSON.stringify({ islem: "donanim" }), 120000);
      let veri = null;
      try { veri = sonJsonSatiri(r.out); } catch (_) {}
      if (veri && veri.ok) { delete veri.ok; pyDonanim = { veri, zaman: Date.now(), suren: null }; return veri; }
      pyDonanim = { veri: null, zaman: Date.now(), suren: null };
      return null;
    })();
    return pyDonanim.suren;
  }

  async function donanim(yenile = false) {
    const cpus = os.cpus() || [];
    const [py, gpu] = await Promise.all([pythonDonanimi(yenile).catch(() => null), gpuAdlariniAl().catch(() => [])]);
    return {
      platform: process.platform,
      ramGb: +(os.totalmem() / 1073741824).toFixed(1),
      bosRamGb: +(os.freemem() / 1073741824).toFixed(1),
      cpuCekirdek: cpus.length,
      cpuAdi: String(cpus[0]?.model || "").trim(),
      gpuAdlari: gpu || [],
      // torch denetlenemediyse (PyTorch henüz kurulu değil) cuda null: bilinmiyor
      cuda: py && py.torch ? Boolean(py.cuda) : null,
      vramGb: py && py.torch ? Number(py.vramGb || 0) : null,
      cudaGpu: py?.gpuAdi || "",
      torch: py?.torch || "",
    };
  }

  // --------------------------------------------------------------------------
  // Süre tahmini. Baz: i5-7200U (2 çekirdek / 4 iş parçacığı) üzerinde gerçek ölçüm:
  // MusicGen Small, 15 sn müzik -> 6 dk 19 sn (yükleme dahil). Daha çok çekirdekte hız alt-doğrusal artar.
  // --------------------------------------------------------------------------
  const nvidiaAdi = (d) => (d.gpuAdlari || []).find((a) => /nvidia|geforce|rtx|gtx|quadro|tesla/i.test(a)) || "";
  // PyTorch henüz kurulu değilse (cuda null) NVIDIA kart adı varsa ekran kartı var sayılır (VRAM bilinmez)
  const gpuVarMi = (d) => d.cuda === true || (d.cuda == null && Boolean(nvidiaAdi(d)));
  function islemciHizi(d) {
    const c = Number(d.cpuCekirdek) || 4;
    return Math.max(0.6, Math.min(3, Math.pow(c / 4, 0.7)));
  }
  function sureYazi(sn) {
    if (sn < 90) return `${Math.max(5, Math.round(sn / 5) * 5)} sn`;
    if (sn < 5400) return `${Math.max(2, Math.round(sn / 60))} dk`;
    return `${Math.round(sn / 1800) / 2} saat`.replace(".", ",");
  }
  function sureAraligi(enAz, enCok) {
    const a = sureYazi(enAz), b = sureYazi(enCok);
    if (a === b) return `~${a}`;
    const [sa, ba] = a.split(" "), [sb, bb] = b.split(" ");
    return ba === bb ? `~${sa}-${sb} ${bb}` : `~${a} - ${b}`;
  }
  // MusicGen Small: işlemcide ~23 sn hesap / sn ses + ~30 sn yükleme (ölçümden); ekran kartında ~1-3 sn / sn ses
  function muzikSuresi(saniye, d) {
    if (gpuVarMi(d)) return sureAraligi(10 + saniye * 1, 20 + saniye * 3);
    const t = (30 + saniye * 23) / islemciHizi(d);
    return sureAraligi(t * 0.9, t * 1.5);
  }
  function efektSuresi(saniye, d) {
    if (gpuVarMi(d)) return sureAraligi(10, 30);
    const t = (20 + saniye * 15) / islemciHizi(d);
    return sureAraligi(t * 0.7, t * 1.8);
  }

  // Donanım uyarısı: { seviye: "onerilmez" | "yavas", baslik, neden, tahmin } ya da null.
  // Süreler KABA tahmindir (i5-7200U ölçümü baz alındı, iş parçacığı sayısına göre ölçeklenir).
  function donanimUyarisi(model, d) {
    if (!model || model.supported === false) return null;
    const ram = d.ramGb || 0;
    const gpuVar = gpuVarMi(d);
    const vram = d.cuda === true ? (d.vramGb || 0) : null; // null: bilinmiyor
    const ramAz = model.minRamGb && ram < model.minRamGb * 0.9; // 16 GB makine ~15,9 GB bildirir
    const tip = model.tur || "video";
    if (tip === "muzik") {
      if (ramAz) return { seviye: "onerilmez", baslik: "Bu donanımda önerilmez", neden: `Sistem belleği ${ram} GB; MusicGen için en az ${model.minRamGb} GB önerilir. Bellek yetmezse işlem hata verip durur.`, tahmin: "Yine de kısa (5-10 sn) bir parçayla deneyebilirsiniz." };
      if (!gpuVar) return { seviye: "yavas", baslik: "İşlemcide çalışacak (yavaş)", neden: "NVIDIA (CUDA) ekran kartı bulunamadı; müzik işlemcide üretilir.", tahmin: `Kaba tahmin: 10 sn müzik ${muzikSuresi(10, d)}, 30 sn ${muzikSuresi(30, d)}, 60 sn ${muzikSuresi(60, d)} (i5-7200U ölçümü: 15 sn müzik 6 dk 19 sn).` };
      return null;
    }
    if (tip === "efekt") {
      if (ramAz) return { seviye: "onerilmez", baslik: "Bu donanımda önerilmez", neden: `Sistem belleği ${ram} GB; AudioLDM-S için en az ${model.minRamGb} GB önerilir.`, tahmin: "" };
      if (!gpuVar) return { seviye: "yavas", baslik: "İşlemcide çalışacak (yavaş)", neden: "NVIDIA (CUDA) ekran kartı bulunamadı; ses efekti işlemcide üretilir.", tahmin: `Kaba tahmin: 6 sn efekt ${efektSuresi(6, d)}.` };
      return null;
    }
    // video
    const nedenler = [];
    if (!gpuVar) nedenler.push("NVIDIA (CUDA) ekran kartı yok; video işlemcide üretilecek. Video üretimi ekran kartı için tasarlanmıştır.");
    else if (model.minVramGb && vram != null && vram < model.minVramGb) nedenler.push(`Ekran kartı belleği ${vram} GB; bu model için en az ${model.minVramGb} GB önerilir (bellek yetmezliği hatası olabilir).`);
    if (ramAz) nedenler.push(`Sistem belleği ${ram} GB; en az ${model.minRamGb} GB önerilir.`);
    const ramOneriAlti = !ramAz && model.onerilenRamGb && ram < model.onerilenRamGb * 0.9;
    // Yalnızca önerilen RAM'in altındaysa (ekran kartı ve en az RAM yeterli) "yavaş" uyarısı verilir, kurulum gizlenmez
    if (!nedenler.length && ramOneriAlti) {
      return { seviye: "yavas", baslik: "Bellek sınırda", neden: `Sistem belleği ${ram} GB; bu model için ${model.onerilenRamGb} GB ve üzeri önerilir (yükleme ve üretim sırasında bilgisayar çok yavaşlayabilir).`, tahmin: "" };
    }
    if (ramOneriAlti) nedenler.push(`Sistem belleği ${ram} GB; bu model için ${model.onerilenRamGb} GB ve üzeri önerilir (indirme ve üretim sırasında bilgisayar çok yavaşlayabilir).`);
    if (!nedenler.length) return null;
    let tahmin = "";
    if (model.id === "animatediff") tahmin = gpuVar ? "Kaba tahmin: birkaç dakika." : "Kaba tahmin (işlemci): 512x512, 16 kare, 20 adım 1-3 saat; 384x384, 8 kare, 10 adım ~15-40 dakika. Önce küçük ayarlarla deneyin.";
    else if (model.id === "wan21-1.3b") tahmin = gpuVar ? "Kaba tahmin: 5-20 dakika." : "Kaba tahmin (işlemci): en küçük ayarda (416x240, 17 kare, 10 adım) bile birkaç saat; 480p birkaç saatten bir güne kadar. ~29 GB indirme ve ~12 GB RAM tepe kullanımı.";
    else tahmin = "Bu model işlemcide pratik olarak kullanılamaz.";
    return { seviye: "onerilmez", baslik: "Bu donanımda önerilmez", neden: nedenler.join(" "), tahmin };
  }

  // "Bu bilgisayarda: …" satırı: algılanan donanıma (NVIDIA ekran kartı/VRAM, RAM, iş parçacığı) ve modelin
  // ihtiyacına göre tek cümlelik özet. { metin, uygunluk: "uygun" | "yavas" | "onerilmez" } ya da null.
  function buBilgisayarda(model, d) {
    if (!model || model.supported === false || !d || !d.ramGb) return null;
    const ram = d.ramGb;
    const gpuVar = gpuVarMi(d);
    const vram = d.cuda === true ? Number(d.vramGb || 0) : null;
    const gpuAdi = d.cuda === true ? (d.cudaGpu || "NVIDIA") : nvidiaAdi(d);
    const ramAz = model.minRamGb && ram < model.minRamGb * 0.9;
    const ramUyari = ramAz ? `${Math.round(ram)} GB RAM yetmeyebilir (en az ${model.minRamGb} GB), bellek dolarsa işlem durdurulur.` : "";
    const vramAz = gpuVar && vram != null && model.minVramGb && vram < model.minVramGb;
    const gpuMetni = gpuVar ? `${gpuAdi}${vram != null ? ` (${vram} GB)` : ""}` : "";
    const tip = model.tur || "video";
    const birlestir = (...p) => p.filter(Boolean).join(" ");
    if (tip === "muzik") {
      if (gpuVar) return { metin: birlestir(ramAz ? "" : "Uygun.", `${gpuMetni} ekran kartında 10 sn müzik ${muzikSuresi(10, d)}.`, ramUyari), uygunluk: ramAz ? "onerilmez" : "uygun" };
      return { metin: birlestir(`Ekran kartı (NVIDIA) yok; işlemcide 10 sn müzik ${muzikSuresi(10, d)} sürer.`, ramUyari), uygunluk: ramAz ? "onerilmez" : "yavas" };
    }
    if (tip === "efekt") {
      if (gpuVar) return { metin: birlestir(ramAz ? "" : "Uygun.", `${gpuMetni} ekran kartında 6 sn efekt ${efektSuresi(6, d)}.`, ramUyari), uygunluk: ramAz ? "onerilmez" : "uygun" };
      return { metin: birlestir(`Ekran kartı (NVIDIA) yok; işlemcide 6 sn efekt ${efektSuresi(6, d)} sürer.`, ramUyari), uygunluk: ramAz ? "onerilmez" : "yavas" };
    }
    // video
    const boyut = String(model.approxSize || "").replace(/\s*\(.*$/, "");
    if (model.kurulabilir === false) {
      if (!gpuVar) return { metin: `Uygun değil: en az ${model.minVramGb} GB belleği olan NVIDIA ekran kartı ve ${model.minRamGb} GB RAM gerekir.`, uygunluk: "onerilmez" };
      if (vramAz || ramAz) return { metin: birlestir(vramAz ? `Ekran kartı belleği ${vram} GB; en az ${model.minVramGb} GB gerekir.` : "", ramUyari), uygunluk: "onerilmez" };
      return { metin: "Donanım yeterli görünüyor; dosyaları elle koymanız gerekir.", uygunluk: "uygun" };
    }
    if (!gpuVar) {
      const sure = model.id === "wan21-1.3b" ? "işlemcide en küçük ayarda bile saatler sürer" : "işlemcide 16 karelik kısa klip 1-3 saat sürer";
      const ek = model.id === "wan21-1.3b" ? `${boyut} indirme, üretimde ~12 GB RAM;` : "";
      return { metin: birlestir(`Ekran kartı (NVIDIA) yok;`, ek, `${sure}.`, ramUyari || (model.onerilenRamGb && ram < model.onerilenRamGb * 0.9 ? `${Math.round(ram)} GB RAM ile bilgisayar çok yavaşlayabilir.` : "")), uygunluk: "onerilmez" };
    }
    if (vramAz) return { metin: birlestir(`Ekran kartı belleği ${vram} GB; en az ${model.minVramGb} GB önerilir, bellek yetmezse işlem durdurulur.`, ramUyari), uygunluk: "onerilmez" };
    if (ramAz) return { metin: ramUyari, uygunluk: "onerilmez" };
    const sure = model.id === "wan21-1.3b" ? "480p klip ~5-20 dk" : "kısa klip birkaç dakika";
    if (model.onerilenRamGb && ram < model.onerilenRamGb * 0.9) {
      return { metin: `${gpuMetni} ekran kartında ${sure}; ${Math.round(ram)} GB RAM sınırda (${model.onerilenRamGb} GB önerilir), yüklerken bilgisayar yavaşlayabilir.`, uygunluk: "yavas" };
    }
    return { metin: `Uygun. ${gpuMetni} ekran kartında ${sure}.`, uygunluk: "uygun" };
  }

  // --------------------------------------------------------------------------
  // Kurulum durumu
  // --------------------------------------------------------------------------
  function paketKurulu(id) { return Boolean(OZ.paketKuruluMu && OZ.paketKuruluMu(id)); }

  async function modelKuruluMu(model) {
    if (!model || model.supported === false) return false;
    const oz = model.ozellik ? await OZ.ozellikKuruluMu(model.ozellik).catch(() => false) : true;
    if (!oz) return false;
    if (model.kurulabilir === false) return fs.existsSync(path.join(VIDEO_KLASORU, model.elleKlasor || "-", "model_index.json"));
    if (!(model.paketler || []).every(paketKurulu)) return false;
    if (model.tabanGerekir) return sd15Tabanlari().length > 0;
    return true;
  }

  async function modelDurumu(model, d) {
    const ozellikKurulu = model.ozellik && model.supported !== false ? await OZ.ozellikKuruluMu(model.ozellik).catch(() => false) : false;
    const eksikPaketler = (model.paketler || []).filter((p) => !paketKurulu(p));
    const installed = await modelKuruluMu(model);
    const kurulabilir = model.supported !== false && model.kurulabilir !== false;
    const uyari = donanimUyarisi(model, d);
    return {
      ...model,
      paketler: undefined,
      paketKimlikleri: [...(model.paketler || [])],
      supported: model.supported !== false,
      kurulabilir,
      installed,
      ozellikKurulu,
      eksikPaketler,
      uyari,
      buBilgisayarda: buBilgisayarda(model, d),
      // Donanım "önerilmez" diyorsa kurulum düğmesi varsayılan olarak gizlenir (arayüzde "Yine de göster")
      kurulumGizli: Boolean(kurulabilir && !installed && uyari && uyari.seviye === "onerilmez"),
      // Kurulu paket klasörleri silinebilir (elle konan klasörler ve paylaşılan dosyalar hariç)
      silinebilir: Boolean(installed && kurulabilir && (model.paketler || []).length),
    };
  }

  // Kurulum kuyruğu: önce Python özelliği (ozellikKur kendi sırasını tutar), sonra paketler tek tek
  const kurulum = { sira: [], aktif: null, hata: null, sonModel: "" };
  function bekle(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function paketKuyrugu() {
    if (kurulum.aktif) return;
    while (kurulum.sira.length) {
      const id = kurulum.sira[0];
      kurulum.aktif = id;
      try {
        if (!paketKurulu(id)) {
          // Başka bir paket (ör. ses tanıma modeli) iniyorsa bitmesini bekle
          while (OZ.paketDurumu().aktif) await bekle(2000);
          await OZ.paketIndir(id);
          await bekle(500);
          while (OZ.paketDurumu().aktif) await bekle(2000);
          const d = OZ.paketDurumu();
          if (d.hata && d.id === id) throw new Error(d.hata);
          if (!paketKurulu(id)) throw new Error(`${id} indirilemedi`);
        }
        kurulum.sira.shift();
      } catch (err) {
        kurulum.hata = `${id}: ${err.message || err}`;
        motorGunlugu(`[stüdyo] model indirilemedi: ${kurulum.hata}`);
        kurulum.sira = [];
      }
      kurulum.aktif = null;
    }
  }

  async function modelKur(modelId) {
    const model = [...MUZIK_MODELLERI, ...VIDEO_MODELLERI].find((m) => m.id === modelId);
    if (!model) throw new Error("Bilinmeyen model: " + modelId);
    if (model.supported === false) throw new Error(`${model.name} bu sürümde desteklenmiyor.`);
    if (model.kurulabilir === false) throw new Error(`${model.name} indirmesi bu sürümde kapalı. ${model.notes || ""}`);
    kurulum.hata = null;
    kurulum.sonModel = modelId;
    if (model.ozellik && !(await OZ.ozellikKuruluMu(model.ozellik, true).catch(() => false))) await OZ.ozellikKur(model.ozellik);
    for (const p of model.paketler || []) if (!paketKurulu(p) && !kurulum.sira.includes(p)) kurulum.sira.push(p);
    motorGunlugu(`[stüdyo] ${model.name} kurulumu başladı (paketler: ${(model.paketler || []).join(", ") || "-"})`);
    paketKuyrugu().catch(() => {});
    return { basladi: true, sira: [...kurulum.sira] };
  }

  function kurulumDurumu() {
    return { ozellik: OZ.kurulumDurumu(), paket: OZ.paketDurumu(), sira: [...kurulum.sira], aktifPaket: kurulum.aktif, hata: kurulum.hata, sonModel: kurulum.sonModel };
  }

  // Kurulu bir stüdyo modelinin indirilmiş paket klasörlerini siler. Başka bir kurulu modelin de kullandığı
  // paketler (ör. SD 1.5 yapılandırması) korunur. İndirme ya da üretim sürerken silme reddedilir.
  async function modelSil(modelId) {
    const tum = [...MUZIK_MODELLERI, ...VIDEO_MODELLERI];
    const model = tum.find((m) => m.id === modelId);
    if (!model) throw Object.assign(new Error("Bilinmeyen model: " + modelId), { kod: 400 });
    if (model.supported === false || model.kurulabilir === false || !(model.paketler || []).length) {
      throw Object.assign(new Error(`${model.name} bu ekrandan silinemez (elle konan klasörü kendiniz silebilirsiniz).`), { kod: 400 });
    }
    const pd = OZ.paketDurumu();
    if (kurulum.aktif || kurulum.sira.length || (pd.aktif && (model.paketler || []).includes(pd.id))) {
      throw Object.assign(new Error("Bir model kurulumu sürüyor; bitmesini bekleyin."), { kod: 409 });
    }
    if ((aktif && aktif.model === model.id) || sira.some((x) => x.model === model.id)) {
      throw Object.assign(new Error("Bu model şu anda bir üretimde kullanılıyor ya da sırada; önce işi bitirin veya iptal edin."), { kod: 409 });
    }
    const silinen = [];
    for (const pid of model.paketler || []) {
      const p = STUDYO_PAKETLERI[pid] || (OZ.PAKETLER && OZ.PAKETLER[pid]);
      if (!p) continue;
      const baskaKullanan = [];
      for (const m of tum) {
        if (m.id !== model.id && (m.paketler || []).includes(pid) && (await modelKuruluMu(m))) baskaKullanan.push(m);
      }
      if (baskaKullanan.length) continue;
      const klasor = path.join(p.klasor, p.ad);
      if (!pathInside(klasor, p.klasor) || path.resolve(klasor) === path.resolve(p.klasor)) continue;
      if (!fs.existsSync(klasor)) continue;
      fs.rmSync(klasor, { recursive: true, force: true });
      silinen.push(pid);
    }
    motorGunlugu(`[stüdyo] ${model.name} silindi (paketler: ${silinen.join(", ") || "-"})`);
    return { silinen };
  }

  // --------------------------------------------------------------------------
  // SD 1.5 taban modellerini bul (safetensors başlığı okunur; dosya yüklenmez, değiştirilmez)
  // --------------------------------------------------------------------------
  const tabanOnbellegi = new Map(); // yol -> { anahtar, sd15 }
  function safetensorsBasligi(dosya) {
    const fd = fs.openSync(dosya, "r");
    try {
      const b = Buffer.alloc(8);
      if (fs.readSync(fd, b, 0, 8, 0) !== 8) return null;
      const n = Number(b.readBigUInt64LE(0));
      if (!(n > 2 && n < 64 * 1024 * 1024)) return null;
      const h = Buffer.alloc(n);
      fs.readSync(fd, h, 0, n, 8);
      return JSON.parse(h.toString("utf8"));
    } finally { fs.closeSync(fd); }
  }
  function sd15Mi(baslik) {
    if (!baslik) return false;
    const giris = baslik["model.diffusion_model.input_blocks.0.0.weight"];
    if (!giris || !Array.isArray(giris.shape) || giris.shape[0] !== 320 || giris.shape[1] !== 4) return false; // inpainting (9 kanal) hariç
    const anahtarlar = Object.keys(baslik);
    if (anahtarlar.some((k) => k.startsWith("conditioner.embedders"))) return false; // SDXL
    return anahtarlar.some((k) => k.startsWith("cond_stage_model.transformer.")); // SD 1.x CLIP (SD 2.x OpenCLIP hariç)
  }
  function sd15Tabanlari() {
    let dosyalar = [];
    try { dosyalar = fs.readdirSync(GORSEL_MODELLER).filter((f) => /\.safetensors$/i.test(f)); } catch (_) { return []; }
    const liste = [];
    for (const f of dosyalar) {
      const yol = path.join(GORSEL_MODELLER, f);
      try {
        const st = fs.statSync(yol);
        if (!st.isFile() || st.size < 1e9 || st.size > 9e9) continue;
        const anahtar = `${st.size}:${st.mtimeMs}`;
        let k = tabanOnbellegi.get(yol);
        if (!k || k.anahtar !== anahtar) { k = { anahtar, sd15: sd15Mi(safetensorsBasligi(yol)) }; tabanOnbellegi.set(yol, k); }
        if (k.sd15) liste.push({ dosya: f, ad: f.replace(/\.safetensors$/i, ""), boyutGb: +(st.size / 1073741824).toFixed(1), gercekci: /cyberrealistic|realistic|photon|epicrealism/i.test(f) });
      } catch (_) {}
    }
    const sira = (x) => (/cyberrealistic/i.test(x.dosya) ? 0 : x.gercekci ? 1 : /dreamshaper/i.test(x.dosya) ? 2 : /v1-5-pruned/i.test(x.dosya) ? 3 : 4);
    return liste.sort((a, b) => sira(a) - sira(b) || a.dosya.localeCompare(b.dosya));
  }

  // --------------------------------------------------------------------------
  // İş kuyruğu (aynı anda tek ağır iş)
  // --------------------------------------------------------------------------
  const isler = new Map();
  const sira = [];
  let aktif = null;
  const SIRA_SINIRI = 5;

  function pyOrtami() {
    const env = { ...process.env, HF_HOME: HF_CACHE, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1",
      PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", TORCHDYNAMO_DISABLE: "1", TOKENIZERS_PARALLELISM: "false" };
    delete env.HF_TOKEN; delete env.HUGGING_FACE_HUB_TOKEN; // çalışanlar ağa çıkmaz, anahtar verilmez
    return env;
  }

  function surecAgaciniOldur(p) {
    if (!p || p.exitCode !== null) return;
    if (process.platform === "win32" && p.pid) {
      try { spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true }).on("error", () => {}); } catch (_) {}
    }
    try { p.kill("SIGKILL"); } catch (_) {}
  }

  function sonJsonSatiri(metin) {
    const satirlar = String(metin || "").trim().split(/\r?\n/).reverse();
    for (const s of satirlar) {
      const t = s.trim();
      if (t.startsWith("{") && t.endsWith("}")) { try { return JSON.parse(t); } catch (_) {} }
    }
    return null;
  }

  function damga() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-") + "-" + Math.random().toString(36).slice(2, 6); }

  function isOzeti(is) {
    if (!is) return null;
    return {
      id: is.id, tur: is.tur, durum: is.durum, ilerleme: is.ilerleme, asama: is.asama, adim: is.adim, toplam: is.toplam,
      model: is.model, istem: is.istem, sira: is.durum === "sirada" ? sira.indexOf(is) + 1 : 0,
      baslangic: is.baslangic, bitis: is.bitis, olusturma: is.olusturma, hata: is.hata, sonuc: is.sonuc,
      kaynak: (is.meta && is.meta.kaynak) || "", ozgunIstem: (is.meta && is.meta.ozgunIstem) || "",
      taban: (is.meta && is.meta.base) || "", // AnimateDiff'in SD 1.5 taban modeli (sohbet kartında gösterilir)
    };
  }

  function isEkle(tur, model, istem, isciIstegi, meta, zamanAsimiMs) {
    if (sira.length >= SIRA_SINIRI) throw Object.assign(new Error(`Sırada zaten ${sira.length} iş var; biraz sonra tekrar deneyin.`), { kod: 429 });
    const id = `${tur}-${damga()}`;
    const is = { id, sahip: (typeof ctx.aktifSahip === "function" && ctx.aktifSahip()) || null, tur, model, istem, isciIstegi, meta, zamanAsimiMs, durum: "sirada", ilerleme: 0, asama: "Sırada bekliyor", adim: 0, toplam: 0,
      olusturma: Date.now(), baslangic: 0, bitis: 0, hata: null, sonuc: null, proc: null };
    isler.set(id, is);
    sira.push(is);
    // Bellekte en fazla 60 iş kaydı tutulur
    if (isler.size > 60) for (const [k, v] of isler) { if (isler.size <= 60) break; if (v !== aktif && v.durum !== "sirada") isler.delete(k); }
    setImmediate(siradaki);
    return is;
  }

  function siradaki() {
    if (aktif || !sira.length) return;
    const is = sira.shift();
    aktif = is;
    calistir(is).catch((err) => { is.durum = is.iptal ? "iptal" : "hata"; is.hata = String(err.message || err); is.asama = is.iptal ? "İptal edildi" : "Hata"; }).finally(() => {
      is.proc = null;
      is.bitis = Date.now();
      if (aktif === is) aktif = null;
      setImmediate(siradaki);
      // Sıradaki iş (varsa) önce sıraya alınır; bitiş bildirimi onu görebilsin diye bir tur sonra
      setImmediate(() => { try { if (typeof ctx.isBitince === "function") ctx.isBitince(isOzeti(is)); } catch (_) {} });
    });
  }

  async function calistir(is) {
    is.durum = "calisiyor";
    is.baslangic = Date.now();
    is.asama = "Hazırlanıyor";
    is.ilerleme = 2;
    if (!pythonVarMi()) throw new Error("Taşınabilir Python kurulu değil. Önce modeli/özelliği kurun.");
    // Türkçe istem: bellek boşaltılmadan (video sohbet modelini kapatmadan) önce yüklü sohbet modeliyle çevrilir.
    // Çevirmen gerekip gerekmediğine kendisi karar verir (İngilizce istemde model çağrılmaz); hata olursa istem aynen kalır.
    if (typeof ctx.cevir === "function" && is.isciIstegi && is.isciIstegi.istem) {
      const kaynakIstem = String(is.isciIstegi.istem);
      is.asama = "İstem İngilizceye çevriliyor";
      try {
        const c = String(await ctx.cevir(kaynakIstem, is.tur) || "").trim();
        if (c && c !== kaynakIstem) {
          is.isciIstegi.istem = c;
          is.istem = c;
          is.meta.effectivePrompt = c;
          is.meta.prompt = c;
          if (!is.meta.ozgunIstem) is.meta.ozgunIstem = kaynakIstem.slice(0, 600);
        }
      } catch (_) {}
    }
    if (is.iptal) throw new Error("İptal edildi.");
    try {
      if (typeof ctx.bellekBosalt === "function") {
        is.asama = "Bellek boşaltılıyor (diğer modeller kapatılıyor)";
        await ctx.bellekBosalt(is.tur, { id: is.id, tur: is.tur, kaynak: (is.meta && is.meta.kaynak) || "",
          iptalMi: () => Boolean(is.iptal), asamaYaz: (metin) => { if (metin) is.asama = String(metin); } });
      }
    } catch (_) {}
    if (is.iptal) throw new Error("İptal edildi.");
    const betik = is.tur === "video" ? ISCILER.video : ISCILER.muzik;
    motorGunlugu(`[stüdyo] ${is.id} başladı (${is.model}): ${String(is.istem).slice(0, 80)}`);
    const sonuc = await new Promise((resolve, reject) => {
      let out = "", errKuyruk = "", tampon = "";
      let p;
      try {
        p = spawn(OZ.PYTHON, ["-u", betik], { cwd: path.dirname(betik), env: pyOrtami(), stdio: "pipe", windowsHide: true });
      } catch (err) { reject(err); return; }
      is.proc = p;
      // Üretimlere süre sınırı konmaz (işlemcide saatler sürebilir); zamanAsimiMs > 0 verilirse uygulanır
      const zaman = is.zamanAsimiMs > 0 ? setTimeout(() => {
        is.zamanAsimi = true;
        surecAgaciniOldur(p);
      }, is.zamanAsimiMs) : null;
      p.stdout.on("data", (d) => { out = (out + d.toString("utf8")).slice(-200000); });
      p.stderr.on("data", (d) => {
        tampon += d.toString("utf8");
        let i;
        while ((i = tampon.indexOf("\n")) >= 0) {
          const s = tampon.slice(0, i).trim();
          tampon = tampon.slice(i + 1);
          if (!s) continue;
          const k = s.indexOf("@@PROGRESS ");
          if (k >= 0) {
            try {
              const pr = JSON.parse(s.slice(k + 11));
              if (pr.phase) is.asama = String(pr.phase);
              if (typeof pr.progress === "number") is.ilerleme = Math.max(is.ilerleme, Math.min(99, pr.progress));
              if (pr.total) { is.adim = pr.step || 0; is.toplam = pr.total; }
            } catch (_) {}
            continue;
          }
          if (/it\/s\]|s\/it\]|Loading weights|Writing model shards/.test(s)) continue; // tqdm gürültüsü
          errKuyruk = (errKuyruk + s + "\n").slice(-3000);
        }
      });
      p.stdin.on("error", () => {});
      p.on("error", (err) => { clearTimeout(zaman); reject(err); });
      p.on("close", (kod) => {
        clearTimeout(zaman);
        const veri = sonJsonSatiri(out);
        if (veri && veri.ok) { resolve(veri); return; }
        if (is.iptal) { reject(new Error("İptal edildi.")); return; }
        if (is.zamanAsimi) { reject(new Error(`Zaman aşımı: iş ${Math.round(is.zamanAsimiMs / 60000)} dakikada bitmedi ve durduruldu.`)); return; }
        if (veri && veri.hata) { reject(new Error(veri.hata)); return; }
        const kuyruk = errKuyruk.trim().split(/\r?\n/).slice(-4).join(" | ");
        // Windows'ta bellek yetmezliğinde süreç sessizce kapanabilir (kod 3221225477 / 3221226505 vb.)
        reject(new Error(`Üretim süreci beklenmedik şekilde kapandı (kod ${kod}). Bellek yetmemiş olabilir.` + (kuyruk ? ` Ayrıntı: ${kuyruk.slice(0, 600)}` : "")));
      });
      try { p.stdin.end(Buffer.from(JSON.stringify(is.isciIstegi), "utf8")); } catch (_) {}
    }).catch((err) => {
      // Yarım kalan çıktıları temizle
      for (const ek of ["", ".part.wav", ".part.mp4"]) { try { fs.unlinkSync(is.isciIstegi.cikti + ek); } catch (_) {} }
      is.durum = is.iptal ? "iptal" : "hata";
      is.hata = String(err.message || err);
      is.asama = is.iptal ? "İptal edildi" : "Hata";
      motorGunlugu(`[stüdyo] ${is.id} ${is.iptal ? "iptal edildi" : "başarısız: " + is.hata}`);
      return null;
    });
    if (!sonuc) return;
    if (!fs.existsSync(is.isciIstegi.cikti)) { is.durum = "hata"; is.hata = "Çıktı dosyası oluşmadı."; return; }
    const dosya = path.basename(is.isciIstegi.cikti);
    const klasor = is.tur === "video" ? "video" : "muzik";
    const sureSn = Math.round((Date.now() - is.baslangic) / 1000);
    const meta = {
      ...is.meta,
      id: path.parse(dosya).name,
      filename: dosya,
      url: `/studyo-cikti/${klasor}/${encodeURIComponent(dosya)}`,
      createdAt: new Date().toISOString(),
      genDuration: sureSn >= 60 ? `${Math.floor(sureSn / 60)} dk ${sureSn % 60} sn` : `${sureSn} sn`,
      seed: sonuc.tohum,
      device: sonuc.cihaz || "",
    };
    if (is.tur === "video") Object.assign(meta, { engineName: sonuc.motorAdi, tier: sonuc.seviye, width: sonuc.genislik, height: sonuc.yukseklik, resolution: `${sonuc.genislik}x${sonuc.yukseklik}`, frames: sonuc.kare, fps: sonuc.fps, steps: sonuc.adim, duration: +(sonuc.kare / sonuc.fps).toFixed(1) });
    else {
      Object.assign(meta, { duration: sonuc.sure, sampleRate: sonuc.ornekleme, channels: sonuc.kanal, effectivePrompt: sonuc.etkinIstem, modelName: sonuc.modelAdi, isSfx: Boolean(sonuc.efekt) });
      // MusicGen sessizlik denetimi (muzik_efekt.py): sessizlik onarıldıysa/kaldıysa arayüzde gösterilir
      if (Number(sonuc.sessizlikOnarimi) > 0) meta.silenceRepairs = Number(sonuc.sessizlikOnarimi);
      if (sonuc.uyari) { meta.warning = String(sonuc.uyari).slice(0, 600); meta.trailingSilence = Number(sonuc.sessizKuyrukSn) || 0; }
    }
    if (is.sahip) meta.sahip = is.sahip;
    try { fs.writeFileSync(path.join(CIKTI[klasor], `${meta.id}.json`), JSON.stringify(meta, null, 2), "utf8"); } catch (_) {}
    is.sonuc = meta;
    is.durum = "tamam";
    is.ilerleme = 100;
    is.asama = "Tamamlandı";
    motorGunlugu(`[stüdyo] ${is.id} tamamlandı (${meta.genDuration}): ${dosya}` + (meta.warning ? ` | uyarı: ${meta.warning}` : ""));
  }

  function isIptal(id) {
    const is = isler.get(id);
    if (!is) return false;
    is.iptal = true;
    const k = sira.indexOf(is);
    if (k >= 0) {
      sira.splice(k, 1); is.durum = "iptal"; is.asama = "İptal edildi"; is.bitis = Date.now();
      // Hiç başlamamış iş de bitiş bildirir (ör. bekleyen sohbet modeli geri yüklemesi bunu bekliyor olabilir)
      setImmediate(() => { try { if (typeof ctx.isBitince === "function") ctx.isBitince(isOzeti(is)); } catch (_) {} });
      return true;
    }
    if (is.proc) surecAgaciniOldur(is.proc);
    return true;
  }

  // --------------------------------------------------------------------------
  // İş başlatıcılar (sayfa ve Vega aynı yolu kullanır)
  // --------------------------------------------------------------------------
  function hata(mesaj, kod = 400) { return Object.assign(new Error(mesaj), { kod }); }

  async function muzikBaslat(govde) {
    const istem = String(govde.prompt || govde.istem || "").trim().slice(0, 1000);
    if (!istem) throw hata("Müzik veya ses istemi (tarif) gereklidir.");
    const modelId = String(govde.model || (govde.mode === "sfx" ? "audioldm-s" : "musicgen-small"));
    const model = MUZIK_MODELLERI.find((m) => m.id === modelId);
    if (!model) throw hata("Bilinmeyen model: " + modelId);
    if (model.supported === false) throw hata(`${model.name} bu sürümde desteklenmiyor. ${model.notes}`);
    if (!(await modelKuruluMu(model))) throw hata(`${model.name} henüz kurulu değil. Müzik Stüdyosu sayfasından "İndir ve kur" ile kurun.`, 409);
    const efekt = model.tur === "efekt";
    const sure = Math.round(Math.max(efekt ? 2 : 3, Math.min(model.maxDuration, Number(govde.duration ?? govde.sure) || (efekt ? 6 : 15))));
    const tohum = Number.isInteger(Number(govde.seed)) && Number(govde.seed) >= 0 ? Number(govde.seed) : null;
    const ad = `${efekt ? "efekt" : "muzik"}_${damga()}.wav`;
    const d = await donanim().catch(() => ({}));
    const gpu = d.cuda === true;
    const zamanAsimiMs = 0; // sınırsız: kullanıcı isterse iptal eder
    const is = isEkle(efekt ? "efekt" : "muzik", model.id, istem,
      { islem: "uret", tur: efekt ? "efekt" : "muzik", model: model.id, istem, sure, tohum, cikti: path.join(CIKTI.muzik, ad),
        modelKlasoru: path.join(MUZIK_KLASORU, STUDYO_PAKETLERI[model.paketler[0]].ad) },
      { type: efekt ? "sfx" : "music", prompt: istem, model: model.id, requestedDuration: sure }, zamanAsimiMs);
    return is;
  }

  function cozunurluk(metin, vars) {
    const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(metin || ""));
    const [w, h] = m ? [Number(m[1]), Number(m[2])] : vars;
    const k = (x) => Math.max(128, Math.min(1280, Math.round(x / 8) * 8));
    return [k(w), k(h)];
  }

  async function videoBaslat(govde) {
    const motor = String(govde.engine || govde.motor || "animatediff");
    const model = VIDEO_MODELLERI.find((m) => m.id === motor || (motor === "animatediff-v15" && m.id === "animatediff"));
    if (!model) throw hata("Bilinmeyen video motoru: " + motor);
    if (!(await modelKuruluMu(model))) {
      throw hata(model.kurulabilir === false
        ? `${model.name} kurulu değil. ${model.notes}`
        : `${model.name} henüz kurulu değil. Video Stüdyosu sayfasından "İndir ve kur" ile kurun.`
        + (model.tabanGerekir && !sd15Tabanlari().length ? " Ayrıca app/models içinde bir SD 1.5 .safetensors model gerekir." : ""), 409);
    }
    const mod = model.modes.includes("i2v") ? "i2v" : "t2v";
    const istem = String(govde.prompt || govde.istem || "").trim().slice(0, 1500);
    if (mod === "t2v" && !istem) throw hata("Video istemi gereklidir.");
    const gorsel = mod === "i2v" ? String(govde.inputImageBase64 || "") : "";
    if (mod === "i2v" && !gorsel) throw hata("Görselden video için bir başlangıç görseli yükleyin.");
    if (gorsel.length > 20 * 1024 * 1024) throw hata("Görsel çok büyük (en fazla ~15 MB).");
    const tohum = Number.isInteger(Number(govde.seed)) && Number(govde.seed) >= 0 ? Number(govde.seed) : null;
    const istek = { islem: "uret", motor: model.id, istem, negatif: String(govde.negative_prompt || govde.negatif || "").slice(0, 1000), tohum };
    let tabanAdi = "";
    if (model.id === "animatediff") {
      const tabanlar = sd15Tabanlari();
      const secilen = tabanlar.find((t) => t.dosya === path.basename(String(govde.base || govde.taban || ""))) || tabanlar[0];
      if (!secilen) throw hata("app/models içinde SD 1.5 .safetensors model bulunamadı.", 409);
      const yol = path.join(GORSEL_MODELLER, secilen.dosya);
      if (!pathInside(yol, GORSEL_MODELLER)) throw hata("Geçersiz taban model yolu.");
      tabanAdi = secilen.dosya;
      const [w, h] = cozunurluk(govde.resolution, [512, 512]);
      Object.assign(istek, { taban: yol, genislik: Math.min(w, 768), yukseklik: Math.min(h, 768),
        kare: Math.max(8, Math.min(24, Number(govde.frames) || 16)), adim: Math.max(4, Math.min(50, Number(govde.steps) || 20)),
        cfg: Math.max(1, Math.min(15, Number(govde.guidance) || 7.5)), fps: Math.max(4, Math.min(24, Number(govde.fps) || 8)) });
    } else if (model.id.startsWith("wan")) {
      const [w, h] = cozunurluk(govde.resolution, [832, 480]);
      const sure = Math.max(0.5, Math.min(5, Number(govde.duration) || 2));
      const kare = Number(govde.frames) || Math.round((sure * 16) / 4) * 4 + 1;
      Object.assign(istek, { genislik: w, yukseklik: h, kare: Math.max(9, Math.min(81, kare)),
        adim: Math.max(4, Math.min(50, Number(govde.steps) || 30)), cfg: Math.max(1, Math.min(10, Number(govde.guidance) || 5)) });
    } else {
      Object.assign(istek, { gorsel, adim: Math.max(4, Math.min(50, Number(govde.steps) || 25)), hareket: Math.max(1, Math.min(255, Number(govde.motion) || 127)) });
    }
    const ad = `video_${damga()}.mp4`;
    istek.cikti = path.join(CIKTI.video, ad);
    const d = await donanim().catch(() => ({}));
    const gpu = d.cuda === true;
    const zamanAsimiMs = 0; // sınırsız: kullanıcı isterse iptal eder
    return isEkle("video", model.id, istem || "(görselden video)", istek,
      { prompt: istem, negativePrompt: istek.negatif, engine: model.id, mode: mod, base: tabanAdi }, zamanAsimiMs);
  }

  // --------------------------------------------------------------------------
  // Vega (sohbet asistanı) için araç işlevleri
  // --------------------------------------------------------------------------
  // SÖZLEŞME:
  //   const { id, durum } = await studyo.vegaMuzik({ istem: "sakin piyano", sure: 15 });
  //   const { id, durum } = await studyo.vegaEfekt({ istem: "gök gürültüsü ve yağmur", sure: 6 });
  //   const { id, durum } = await studyo.vegaVideo({ istem: "a cat walking in the rain", motor: "animatediff" });
  //   - Hemen döner (iş sıraya girer); üretim arka planda ayrı süreçte çalışır.
  //   - durum() ya da studyo.durum(id) anlık özeti verir:
  //       { id, tur, durum: "sirada"|"calisiyor"|"tamam"|"hata"|"iptal", ilerleme: 0-100, asama, sira,
  //         hata, sonuc: { url: "/studyo-cikti/...", filename, duration, ... } | null }
  //   - Model kurulu değilse, istem boşsa ya da sıra doluysa Error fırlatır (err.kod: 400/409/429);
  //     mesajlar Türkçedir, olduğu gibi kullanıcıya gösterilebilir.
  //   - İptal: studyo.iptal(id).
  //   - Türkçe istem: müzik/efekt için sözlükle çevrilir; video için ctx.cevir verilmişse çevrilir.
  // kaynak: "vega" (sohbetten başlatıldı); ozgunIstem: kullanıcının Türkçe tarifi (çeviriden önce, kartta gösterilir)
  function vegaEtiketle(is, kaynak, ozgunIstem) {
    is.meta.kaynak = String(kaynak || "vega").slice(0, 20);
    if (ozgunIstem && String(ozgunIstem).trim() !== String(is.istem).trim()) is.meta.ozgunIstem = String(ozgunIstem).slice(0, 600);
    return is;
  }
  async function vegaMuzik({ istem, sure = 15, model = "musicgen-small", tohum, kullaniciMetni, kaynak, ozgunIstem } = {}) {
    const is = vegaEtiketle(await muzikBaslat({ prompt: tempoyuKoru(istem, kullaniciMetni), duration: sure, model, seed: tohum }), kaynak, ozgunIstem);
    return { id: is.id, model: is.model, istem: is.istem, durum: () => isOzeti(isler.get(is.id)) };
  }
  async function vegaEfekt({ istem, sure = 6, model = "audioldm-s", tohum, kaynak, ozgunIstem } = {}) {
    const is = vegaEtiketle(await muzikBaslat({ prompt: istem, duration: sure, model, seed: tohum, mode: "sfx" }), kaynak, ozgunIstem);
    return { id: is.id, model: is.model, istem: is.istem, durum: () => isOzeti(isler.get(is.id)) };
  }
  async function vegaVideo({ istem, motor = "animatediff", cozunurluk: coz, kare, adim, taban, tohum, kaynak, ozgunIstem } = {}) {
    const is = vegaEtiketle(await videoBaslat({ prompt: istem, engine: motor, resolution: coz, frames: kare, steps: adim, base: taban, seed: tohum }), kaynak, ozgunIstem);
    return { id: is.id, model: is.model, istem: is.istem, durum: () => isOzeti(isler.get(is.id)) };
  }

  // Sohbet kartından başlatma (POST /api/studyo/vega-baslat). Süre sınırı yok (zamanAsimiMs 0); kaynak "vega".
  async function vegaBaslat(g) {
    const tur = ["muzik", "efekt", "video"].includes(g.tur) ? g.tur : "";
    if (!tur) throw hata("Geçersiz tür (muzik, efekt ya da video olmalı).");
    const istem = String(g.istem || g.prompt || "").trim().slice(0, 1000);
    if (!istem) throw hata("Tarif boş.");
    const ozgunIstem = String(g.ozgunIstem || "").slice(0, 600);
    const model = String(g.model || "");
    const sure = Number(g.sure) > 0 ? Number(g.sure) : undefined;
    const kaynak = "vega";
    const sonuc = tur === "muzik" ? await vegaMuzik({ istem, model: model || "musicgen-small", sure, kaynak, ozgunIstem })
      : tur === "efekt" ? await vegaEfekt({ istem, model: model || "audioldm-s", sure, kaynak, ozgunIstem })
      : await vegaVideo({ istem, motor: model || "animatediff", taban: String(g.taban || ""), kaynak, ozgunIstem });
    log(`  [studyo] sohbetten başlatıldı: ${sonuc.id} (${sonuc.model})`);
    return isler.get(sonuc.id);
  }

  // Sohbet kartındaki model seçici: aynı türden kurulu modeller (müzik / efekt / metinden video)
  async function kuruluModeller(tur) {
    const liste = tur === "video"
      ? VIDEO_MODELLERI.filter((m) => (m.modes || []).includes("t2v"))
      : MUZIK_MODELLERI.filter((m) => m.tur === (tur === "efekt" ? "efekt" : "muzik"));
    const sonuc = [];
    for (const m of liste) {
      if (m.supported === false) continue;
      if (await modelKuruluMu(m).catch(() => false)) sonuc.push({ id: m.id, name: m.name, tier: m.tier || "", notes: m.notes || "" });
    }
    return sonuc;
  }

  // Aynı tarifle başka bir modelle yeniden üret: önce yeni iş sıraya alınır, sonra eskisi (sürüyorsa) iptal edilir.
  // Böylece eski işin bitiş bildirimi geldiğinde yeni iş zaten sıradadır (ör. sohbet modeli arada geri yüklenmez).
  async function yenidenUret(id, model, taban) {
    const eski = isler.get(String(id || ""));
    if (!eski) throw hata("İş bulunamadı (sunucu yeniden başlamış olabilir).", 404);
    const meta = eski.meta || {};
    let yeni;
    if (eski.tur === "video") {
      yeni = await videoBaslat({ prompt: meta.prompt || eski.istem, engine: model || eski.model, base: taban || meta.base || "", negative_prompt: meta.negativePrompt || "" });
    } else {
      yeni = await muzikBaslat({ prompt: eski.istem, duration: meta.requestedDuration, model: model || eski.model, mode: eski.tur === "efekt" ? "sfx" : "music" });
    }
    if (meta.kaynak) yeni.meta.kaynak = meta.kaynak;
    if (meta.ozgunIstem) yeni.meta.ozgunIstem = meta.ozgunIstem;
    yeni.meta.oncekiIs = eski.id;
    if (eski.durum === "sirada" || eski.durum === "calisiyor") isIptal(eski.id);
    return yeni;
  }

  // Vega müzik tarifini İngilizceye çevirirken tempoyu bozabiliyor (30 Ekim: "86 bpm" -> "8-bit").
  // Kullanıcının son mesajındaki tempo ("86 bpm", "86 BPM", "dakikada 86 vuruş", "86 vuruş/dk", "tempo 86")
  // tarifte aynı sayıyla geçmiyorsa sona "86 bpm" olarak eklenir. kullaniciMetni: string ya da
  // OpenAI biçimli içerik dizisi ([{type:"text", text}]).
  function tempoBul(metin) {
    const s = String(metin || "");
    const desenler = [
      /(?<![\w.])(\d{2,3})\s*-?\s*b\.?\s?p\.?\s?m\.?(?![\p{L}\d])/iu,
      /(?<![\p{L}\d])dakikada\s+(\d{2,3})\s+vuru[sş]/iu,
      /(?<![\w.])(\d{2,3})\s+vuru[sş]\p{L}*\s*(?:\/|bölü|her)?\s*(?:dk|dakika)/iu,
      /(?<![\p{L}\d])tempo(?:su|sunda)?\s*[:=]?\s*(\d{2,3})(?!\d)/iu,
      /(?<![\w.])(\d{2,3})(?!\d)\s+tempo/iu,
    ];
    for (const d of desenler) {
      const m = d.exec(s);
      if (m && Number(m[1]) >= 30 && Number(m[1]) <= 300) return Number(m[1]);
    }
    return null;
  }
  function tempoyuKoru(istem, kullaniciMetni) {
    const metin = Array.isArray(kullaniciMetni)
      ? kullaniciMetni.map((p) => (p && typeof p.text === "string" ? p.text : "")).join(" ")
      : String(kullaniciMetni || "");
    const n = tempoBul(metin);
    if (!n) return istem;
    if (tempoBul(istem) === n) return istem;
    return `${String(istem || "").replace(/[\s,.;]+$/, "")}, ${n} bpm`;
  }

  // Genel durum (id verilirse o işin özeti)
  function durum(id) {
    if (id) return isOzeti(isler.get(id));
    return { aktif: isOzeti(aktif), sira: sira.map(isOzeti), kurulum: kurulumDurumu() };
  }

  // --------------------------------------------------------------------------
  // Çıktı listeleri
  // --------------------------------------------------------------------------
  function boyutYazi(b) {
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, v = Number(b) || 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  // Kullanıcı ayrımı: sahibi olmayan kullanıcı çıktıyı göremez / indiremez / silemez
  function ciktiGorulur(req, klasor, ad) {
    if (typeof ctx.gorebilirMi !== "function") return true;
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(CIKTI[klasor], path.parse(path.basename(String(ad || ""))).name + ".json"), "utf8")); } catch (_) {}
    return ctx.gorebilirMi(req, meta && meta.sahip, !meta);
  }
  function ciktiListesi(klasor, uzanti, req) {
    const liste = [];
    let dosyalar = [];
    try { dosyalar = fs.readdirSync(CIKTI[klasor]); } catch (_) { return liste; }
    for (const f of dosyalar) {
      if (!f.toLowerCase().endsWith(uzanti) || f.includes(".part.")) continue;
      const yol = path.join(CIKTI[klasor], f);
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(CIKTI[klasor], path.parse(f).name + ".json"), "utf8")); } catch (_) {}
      let st;
      try { st = fs.statSync(yol); } catch (_) { continue; }
      if (req && typeof ctx.gorebilirMi === "function" && !ctx.gorebilirMi(req, meta.sahip, !meta.id && !meta.createdAt)) continue;
      liste.push({ ...meta, id: meta.id || path.parse(f).name, filename: f, name: f, url: `/studyo-cikti/${klasor}/${encodeURIComponent(f)}`,
        createdAt: meta.createdAt || st.mtime.toISOString(), mtimeMs: st.mtimeMs, size: boyutYazi(st.size) });
    }
    return liste.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  const GECERLI_AD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
  function ciktiSil(klasor, ad, uzanti) {
    const temiz = path.basename(String(ad || ""));
    if (!GECERLI_AD.test(temiz) || !temiz.toLowerCase().endsWith(uzanti)) throw hata("Geçersiz dosya adı.");
    const yol = path.join(CIKTI[klasor], temiz);
    const meta = path.join(CIKTI[klasor], path.parse(temiz).name + ".json");
    if (!pathInside(yol, CIKTI[klasor])) throw hata("Geçersiz dosya yolu.");
    let silindi = false;
    for (const y of [yol, meta]) { try { fs.unlinkSync(y); silindi = true; } catch (_) {} }
    return silindi;
  }

  function dosyaSun(req, res, klasor, ad) {
    const temiz = decodeURIComponent(ad || "");
    const uz = path.extname(temiz).toLowerCase();
    const tur = { ".wav": "audio/wav", ".mp4": "video/mp4" }[uz];
    if (!tur || !GECERLI_AD.test(temiz) || temiz !== path.basename(temiz)) { json(res, 400, { ok: false, error: "Geçersiz dosya." }); return; }
    const yol = path.join(CIKTI[klasor], temiz);
    if (!pathInside(yol, CIKTI[klasor])) { json(res, 403, { ok: false, error: "Erişim reddedildi." }); return; }
    let st;
    try { st = fs.statSync(yol); } catch (_) { json(res, 404, { ok: false, error: "Dosya bulunamadı." }); return; }
    const basliklar = { "Content-Type": tur, "Accept-Ranges": "bytes", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
    if (new URL(req.url, "http://yerel").searchParams.get("indir") === "1") basliklar["Content-Disposition"] = `attachment; filename="${temiz}"`;
    const aralik = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (aralik && (aralik[1] || aralik[2])) {
      let bas = aralik[1] ? Number(aralik[1]) : Math.max(0, st.size - Number(aralik[2]));
      let son = aralik[1] && aralik[2] ? Number(aralik[2]) : st.size - 1;
      if (bas >= st.size || bas > son) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); res.end(); return; }
      son = Math.min(son, st.size - 1);
      res.writeHead(206, { ...basliklar, "Content-Range": `bytes ${bas}-${son}/${st.size}`, "Content-Length": son - bas + 1 });
      if (req.method === "HEAD") { res.end(); return; }
      fs.createReadStream(yol, { start: bas, end: son }).on("error", () => res.destroy()).pipe(res);
      return;
    }
    res.writeHead(200, { ...basliklar, "Content-Length": st.size });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(yol).on("error", () => res.destroy()).pipe(res);
  }

  function klasorAc(klasor, ad) {
    const dizin = CIKTI[klasor];
    let hedef = dizin;
    if (ad) {
      const temiz = path.basename(String(ad));
      if (!GECERLI_AD.test(temiz)) throw hata("Geçersiz dosya adı.");
      const y = path.join(dizin, temiz);
      if (pathInside(y, dizin) && fs.existsSync(y)) hedef = y;
    }
    let komut, arg;
    if (process.platform === "win32") { komut = "explorer.exe"; arg = hedef === dizin ? [dizin] : [`/select,${hedef}`]; }
    else if (process.platform === "darwin") { komut = "open"; arg = hedef === dizin ? [dizin] : ["-R", hedef]; }
    else { komut = "xdg-open"; arg = [dizin]; }
    const p = spawn(komut, arg, { detached: true, stdio: "ignore", windowsHide: false });
    p.on("error", () => {});
    p.unref();
  }

  // --------------------------------------------------------------------------
  // HTTP
  // --------------------------------------------------------------------------
  function vHata(res, err) {
    const kod = err.kod || 500;
    if (kod >= 500) log(`  [studyo] ${err.stack || err.message}`);
    json(res, kod, { ok: false, error: err.message || String(err) });
  }

  // V2 uyumlu ilerleme yanıtı
  function ilerlemeYaniti(is, varsayilanMod) {
    const o = isOzeti(is);
    return {
      ok: true,
      active: Boolean(is && (is.durum === "calisiyor" || is.durum === "sirada")),
      status: is ? is.durum : "idle",
      mode: is ? (is.tur === "efekt" ? "sfx" : is.tur === "muzik" ? "music" : "video") : varsayilanMod,
      progress: is ? is.ilerleme : 0,
      phase: is ? is.asama : "",
      step: is ? is.adim : 0,
      totalSteps: is ? is.toplam : 0,
      model: is ? is.model : "",
      startedAt: is ? is.baslangic : 0,
      error: is ? is.hata : null,
      job: o,
    };
  }

  function sonIs(turler) {
    if (aktif && turler.includes(aktif.tur)) return aktif;
    const s = sira.find((x) => turler.includes(x.tur));
    if (s) return s;
    let son = null;
    for (const v of isler.values()) if (turler.includes(v.tur) && (!son || v.olusturma > son.olusturma)) son = v;
    return son;
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://yerel");
    const yol = url.pathname;
    const m = req.method;
    if (!(yol.startsWith("/api/audio/") || yol.startsWith("/api/music/") || yol.startsWith("/api/video/") || yol.startsWith("/api/studyo/") || yol.startsWith("/studyo-cikti/"))) return false;
    try {
      // --- çıktı dosyaları ---
      const dm = /^\/studyo-cikti\/(muzik|video)\/([^/]+)$/.exec(yol);
      if (dm && (m === "GET" || m === "HEAD")) {
        if (!ciktiGorulur(req, dm[1], decodeURIComponent(dm[2]))) { json(res, 403, { ok: false, error: "Bu dosyaya erişim yetkiniz yok." }); return true; }
        dosyaSun(req, res, dm[1], dm[2]); return true;
      }

      // --- genel ---
      if (yol === "/api/studyo/donanim" && m === "GET") {
        json(res, 200, { ok: true, donanim: await donanim(url.searchParams.get("yenile") === "1") });
        return true;
      }
      if (yol === "/api/studyo/durum" && m === "GET") { json(res, 200, { ok: true, ...durum(url.searchParams.get("id") || "") }); return true; }
      // Sohbetteki stüdyo kartı: tek işin durumu (+ sunucunun eklediği bilgi, ör. sohbet modelinin geri yüklenmesi)
      const im = /^\/api\/studyo\/is\/([A-Za-z0-9._-]{1,80})(\/yeniden)?$/.exec(yol);
      if (im && !im[2] && m === "GET") {
        const is = isler.get(im[1]);
        let ek = null;
        try { ek = typeof ctx.isEkBilgi === "function" ? ctx.isEkBilgi(im[1]) : null; } catch (_) {}
        if (!is) { json(res, 404, { ok: false, error: "İş bulunamadı (sunucu yeniden başlamış olabilir).", ek }); return true; }
        json(res, 200, { ok: true, is: isOzeti(is), ek });
        return true;
      }
      if (im && im[2] && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        const yeni = await yenidenUret(im[1], String(g.model || ""), String(g.taban || ""));
        json(res, 200, { ok: true, is: isOzeti(yeni) });
        return true;
      }
      // Sohbet modeli durumu (video sürüyor mu, geri yükleme): sohbette model yüklemeden önce uyarı için
      if (yol === "/api/studyo/sohbet-modeli" && m === "GET") {
        let d = null;
        try { d = typeof ctx.sohbetModeliDurumu === "function" ? ctx.sohbetModeliDurumu() : null; } catch (_) {}
        json(res, 200, { ok: true, videoSuruyor: videoSuruyor(), ...(d || {}) });
        return true;
      }
      // Sohbetteki "Şimdi geri yükle": bekleyen sohbet modeli (Görsel Stüdyo / video sonrası) beklemeden yüklenir
      if (yol === "/api/studyo/sohbet-modeli/geri-yukle" && m === "POST") {
        let s = null;
        try { s = typeof ctx.sohbetModeliniSimdiYukle === "function" ? ctx.sohbetModeliniSimdiYukle() : null; } catch (err) { s = { ok: false, error: String(err.message || err) }; }
        if (!s) { json(res, 404, { ok: false, error: "Bu sürümde desteklenmiyor." }); return true; }
        json(res, s.ok ? 200 : (s.kod || 409), s);
        return true;
      }
      // Sohbetteki model seçim kartı: kullanıcı modeli seçip "Seç"e basınca (Vega'nın yanıtı bittikten sonra) iş başlar.
      // Gövde: { tur: muzik|efekt|video, model, istem, ozgunIstem?, sure?, taban? } -> { is: özet }
      if (yol === "/api/studyo/vega-baslat" && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        const is = await vegaBaslat(g);
        json(res, 200, { ok: true, is: isOzeti(is) });
        return true;
      }
      if (yol === "/api/studyo/kurulu-modeller" && m === "GET") {
        const t = url.searchParams.get("tur");
        const tur = t === "video" ? "video" : t === "efekt" ? "efekt" : "muzik";
        // Video: AnimateDiff için seçilebilecek SD 1.5 taban modelleri de (Video Stüdyosu'ndaki seçimle aynı liste)
        json(res, 200, { ok: true, modeller: await kuruluModeller(tur), ...(tur === "video" ? { tabanlar: sd15Tabanlari() } : {}) });
        return true;
      }
      if (yol === "/api/studyo/kurulum" && m === "GET") { json(res, 200, { ok: true, ...kurulumDurumu() }); return true; }
      if (yol === "/api/studyo/kur" && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        json(res, 200, { ok: true, ...(await modelKur(String(g.model || ""))) });
        return true;
      }
      if (yol === "/api/studyo/sil" && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        json(res, 200, { ok: true, ...(await modelSil(String(g.model || ""))) });
        return true;
      }
      if (yol === "/api/studyo/iptal" && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        json(res, 200, { ok: isIptal(String(g.id || "")) });
        return true;
      }
      if (yol === "/api/studyo/klasor-ac" && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        const k = g.tur === "video" ? "video" : "muzik";
        klasorAc(k, g.dosya || "");
        json(res, 200, { ok: true });
        return true;
      }

      // --- müzik / ses efekti ---
      if (yol === "/api/music/models" && m === "GET") {
        const d = await donanim();
        const models = await Promise.all(MUZIK_MODELLERI.map((x) => modelDurumu(x, d)));
        json(res, 200, { ok: true, models, donanim: d });
        return true;
      }
      if (yol === "/api/audio/music" && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        const is = await muzikBaslat(g);
        json(res, 200, { ok: true, jobId: is.id, job: isOzeti(is), message: "Üretim sıraya alındı." });
        return true;
      }
      if (yol === "/api/audio/progress" && m === "GET") {
        const id = url.searchParams.get("id");
        json(res, 200, ilerlemeYaniti(id ? isler.get(id) : sonIs(["muzik", "efekt"]), "audio"));
        return true;
      }
      if (yol === "/api/audio/history" && m === "GET") {
        const items = ciktiListesi("muzik", ".wav", req).map((x) => ({ ...x, type: x.isSfx ? "sfx" : "music", title: x.prompt || x.filename }));
        json(res, 200, { ok: true, items });
        return true;
      }
      if (yol === "/api/audio/delete" && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        if (!ciktiGorulur(req, "muzik", g.filename)) { json(res, 403, { ok: false, error: "Bu dosyayı silme yetkiniz yok." }); return true; }
        json(res, 200, { ok: ciktiSil("muzik", g.filename, ".wav") });
        return true;
      }

      // --- video ---
      if (yol === "/api/video/models" && m === "GET") {
        const d = await donanim();
        const models = await Promise.all(VIDEO_MODELLERI.map((x) => modelDurumu(x, d)));
        json(res, 200, { ok: true, models, tabanlar: sd15Tabanlari(), donanim: d,
          cevirmen: typeof ctx.cevir === "function" && (typeof ctx.cevirHazir !== "function" || Boolean(ctx.cevirHazir())) });
        return true;
      }
      if (yol === "/api/video/generate" && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        const is = await videoBaslat(g);
        json(res, 200, { ok: true, jobId: is.id, job: isOzeti(is), message: "Video üretimi sıraya alındı.",
          video: { id: is.id, prompt: is.istem, engine: is.model, status: "processing", createdAt: new Date(is.olusturma).toISOString() } });
        return true;
      }
      if (yol === "/api/video/status" && m === "GET") {
        const id = url.searchParams.get("id");
        const is = id ? isler.get(id) : sonIs(["video"]);
        const y = ilerlemeYaniti(is, "video");
        y.video = is && is.sonuc ? is.sonuc : null;
        json(res, 200, y);
        return true;
      }
      if (yol === "/api/video/gallery" && m === "GET") { json(res, 200, { ok: true, videos: ciktiListesi("video", ".mp4", req) }); return true; }
      if (yol === "/api/video/delete" && m === "POST") {
        const g = await readJsonBody(req, res);
        if (!g) return true;
        if (!ciktiGorulur(req, "video", g.filename)) { json(res, 403, { ok: false, error: "Bu dosyayı silme yetkiniz yok." }); return true; }
        json(res, 200, { ok: ciktiSil("video", g.filename, ".mp4") });
        return true;
      }
    } catch (err) {
      if (!res.headersSent) vHata(res, err);
      return true;
    }
    return false; // /api/audio/tts gibi bu modülün olmayan yolları serve.cjs'e kalır
  }

  function hepsiniDurdur() {
    for (const is of sira.splice(0)) { is.durum = "iptal"; is.asama = "İptal edildi"; }
    if (aktif) { aktif.iptal = true; surecAgaciniOldur(aktif.proc); }
  }

  // Video işi sürüyor ya da sırada mı (sohbet modeli yüklenmeden önce uyarı için)
  function videoSuruyor() {
    return Boolean((aktif && aktif.tur === "video") || sira.some((x) => x.tur === "video"));
  }

  return { handle, vegaMuzik, vegaEfekt, vegaVideo, tempoyuKoru, durum, iptal: isIptal, hepsiniDurdur, donanim, modelKur, modelSil, kurulumDurumu,
    videoSuruyor, kuruluModeller, yenidenUret,
    MUZIK_MODELLERI, VIDEO_MODELLERI, STUDYO_OZELLIKLERI, STUDYO_PAKETLERI };
};

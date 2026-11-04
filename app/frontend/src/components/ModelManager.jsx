import React, { memo, useState, useEffect, useCallback } from "react";
import { FolderOpen, DownloadCloud, RefreshCw, Database, Trash2, Square, HardDrive, Library, AlertTriangle, Search, X, EyeOff } from "lucide-react";
import { 
  listLocalModels, 
  startServer, 
  stopServer, 
  importModelFile, 
  deleteModel, 
  downloadModel, 
  downloadOpenVinoModel, 
  cancelModelDownload, 
  getDownloadProgress, 
  getBackendStatus, 
  pingServer, 
  formatBytes, 
  normalizeModel,
  listLlmModels,
  startLlm,
  stopLlm,
  downloadLlmModel,
  deleteLlmModel,
  importLlmModel,
  getLlmStatus,
  searchHuggingFaceModels,
  listSpeechModels,
  startSpeech,
  stopSpeech,
  downloadSpeechModel,
  deleteSpeechModel,
  importSpeechModel,
  getSpeechStatus,
  listTtsModels,
  startTts,
  stopTts,
  downloadTtsModel,
  deleteTtsModel,
  importTtsModel,
  getTtsStatus,
  isLocalServerMode,
  downloadDefaultModels,
  getCompatibleModels,
} from "../services/api";
import ModelArama from "./ModelArama";
// Eski metin araması (/api/huggingface/models) dosyayı resolve/main'den indirir: commit'e sabitlemez, özet doğrulamaz.
// Metin modelleri de ModelArama ile (sabit commit + SHA256) aranıp kurulur; eski arama kapalı.
const ESKI_HF_ARAMA = false;
import { kisaBoyut, modelKuruluyorMu, muzikModelleri, studyoModelSil, videoModelleri } from "../services/studyoApi";
import { BuBilgisayardaSatiri, DonanimRozeti, GizliKurulumKutusu, kutuphaneDonanimNotu, studyoKurulumBaslat, tumlesikGpuMu, useKurulumTakibi } from "./StudyoOrtak";

const MODEL_FILTERS = [
  { id: "vision", label: "Görüntü Anlama" },
  { id: "uncensored", label: "Sansürsüz" },
];

const MODEL_LIBRARY = [
  {
    group: "SDXL - En İyi Kalite",
    items: [
      {
        name: "Juggernaut XL v9 Lightning",
        filename: "Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
        format: "Safetensors",
        approxSize: "6.6 GB",
        resolution: "1024x1024",
        notes: "4-8 adımlı Lightning üretimi için ayarlanmış fotogerçekçi SDXL modeli.",
        url: "https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning/resolve/main/Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
        recommendedTiers: ["Mid", "High"],
      },
      {
        name: "DreamShaper XL Lightning",
        filename: "DreamShaperXL_Lightning.safetensors",
        format: "Safetensors",
        approxSize: "6.6 GB",
        resolution: "1024x1024",
        notes: "Fantastik sanat, render, illüstrasyon ve stilize görseller için çok yönlü SDXL modeli.",
        url: "https://huggingface.co/Lykon/dreamshaper-xl-lightning/resolve/main/DreamShaperXL_Lightning.safetensors",
        recommendedTiers: ["Mid", "High"],
      },
    ],
  },
  {
    group: "SD 1.5 - Çok Hızlı / Düşük Bellek",
    items: [
      {
        name: "DreamShaper 8",
        filename: "DreamShaper_8_pruned.safetensors",
        format: "Safetensors",
        approxSize: "2.1 GB",
        resolution: "512x512",
        notes: "İllüstrasyon, anime ve yarı gerçekçi portreler için genel amaçlı SD 1.5 modeli.",
        url: "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors",
        recommendedTiers: ["Low"],
      },
      {
        name: "CyberRealistic V8",
        filename: "CyberRealistic_V8_FP16.safetensors",
        format: "Safetensors",
        approxSize: "2.1 GB",
        resolution: "512x512",
        notes: "SD 1.5 ekosisteminde yüksek doğrulukta gerçekçilik ve fotogerçekçilik.",
        url: "https://huggingface.co/cyberdelia/CyberRealistic/resolve/main/CyberRealistic_V8_FP16.safetensors",
        recommendedTiers: ["Low"],
      },
      {
        name: "ReV Animated v1.2.2",
        filename: "rev-animated-v1-2-2.safetensors",
        format: "Safetensors",
        approxSize: "2.1 GB",
        resolution: "512x512",
        notes: "Yarı gerçekçi, 2.5D, anime, fantastik ve stilize dijital sanat.",
        url: "https://huggingface.co/danbrown/RevAnimated-v1-2-2/resolve/main/rev-animated-v1-2-2.safetensors",
        recommendedTiers: ["Low"],
      },
    ],
  },
];

const TEXT_MODEL_LIBRARY = [
  {
    group: "Önerilen Metin Modelleri (llama.cpp)",
    items: [
      {
        name: "Gemma 4 E4B Instruct Q4_K_M",
        filename: "gemma-4-E4B-it-Q4_K_M.gguf",
        format: "GGUF",
        approxSize: "5.0 GB",
        resolution: "N/A",
        notes: "Türkçesi en iyi hafif modellerden. 12 GB ve üzeri RAM'li bilgisayarlarda ekran kartı olmadan da çalışır (Google Gemma lisansı).",
        url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
        recommendedTiers: ["Low", "Mid", "High"],
        minRamGb: 12,
      },
      {
        name: "Gemma 4 E2B Instruct Q4_K_M",
        filename: "gemma-4-E2B-it-Q4_K_M.gguf",
        format: "GGUF",
        approxSize: "3.1 GB",
        resolution: "N/A",
        notes: "Gemma 4'ün küçük sürümü; 8 GB RAM'li bilgisayarlar için Türkçe sohbet seçeneği (Google Gemma lisansı).",
        url: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf",
        recommendedTiers: ["Low"],
      },
      {
        name: "Qwen2.5 Coder 0.5B Instruct Q4_K_M",
        filename: "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
        format: "GGUF",
        approxSize: "491 MB",
        resolution: "N/A",
        notes: "Son derece hızlı, hafif bir asistan; düşük RAM/VRAM'li makineler için ideal.",
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
        recommendedTiers: ["Low"],
      },
      {
        name: "SmolLM2 1.7B Instruct Q4_K_M",
        filename: "smollm2-1.7b-instruct-q4_k_m.gguf",
        format: "GGUF",
        approxSize: "1.1 GB",
        resolution: "N/A",
        notes: "Güçlü mantık, akıl yürütme ve prompt genişletme yeteneklerine sahip, mükemmel bir hafif asistan.",
        url: "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf",
        recommendedTiers: ["Low"],
      },
      {
        name: "Qwen2.5-Coder-7B-Instruct",
        filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
        format: "GGUF",
        size: "4.7 GB",
        approxSize: "4.7 GB",
        resolution: "N/A",
        notes: "Kodlama ve metin için oldukça zeki bir asistan. Orta/yüksek seviye sistemler için önerilir.",
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
        recommendedTiers: ["Mid", "High"],
      },
      {
        name: "Llama-3.1-8B-Instruct",
        filename: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        format: "GGUF",
        size: "4.9 GB",
        approxSize: "4.9 GB",
        resolution: "N/A",
        notes: "Mükemmel, genel amaçlı metin modeli. Yüksek seviye sistemler için önerilir.",
        url: "https://huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        recommendedTiers: ["High"],
      },
      {
        name: "LLaVA 1.5 7B",
        filename: "ggml-model-q4_k.gguf",
        format: "GGUF",
        size: "4.5 GB",
        approxSize: "4.5 GB",
        resolution: "N/A",
        notes: "Görselleri anlayabilen çok kipli model. Eşlik eden görüntü projektörünü otomatik olarak indirir.",
        url: "https://huggingface.co/mys/ggml_llava-v1.5-7b/resolve/main/ggml-model-q4_k.gguf",
        projectorUrl: "https://huggingface.co/mys/ggml_llava-v1.5-7b/resolve/main/mmproj-model-f16.gguf",
        projectorFilename: "mmproj-model-f16.gguf",
        recommendedTiers: ["Mid", "High"],
      },
    ],
  },
];

const OPENVINO_MODEL_LIBRARY = [
  {
    group: "Intel NPU - OpenVINO Testi",
    items: [
      {
        id: "lcm-dreamshaper-v7-fp16",
        name: "LCM DreamShaper v7 FP16",
        filename: "lcm-dreamshaper-v7-fp16",
        format: "OpenVINO",
        backendType: "openvino-npu",
        approxSize: "2.0 GB",
        resolution: "512x512",
        notes: "Windows ve Linux için NPU test modeli. Metin kodlayıcıyı CPU'da, UNet'i Intel NPU'da, VAE kod çözücüyü Intel GPU'da (yoksa CPU'da) çalıştırır.",
        url: "https://huggingface.co/OpenVINO/LCM_Dreamshaper_v7-fp16-ov",
      },
    ],
  },
];

const TTS_MODEL_LIBRARY = [
  {
    // Türkçe ses motorları (DD:YZ V2'den uyarlandı). Kurulumda Python paketleri ve model dosyaları sabit sürümden iner.
    group: "Türkçe Ses Motorları",
    items: [
      {
        id: "tts-antalia", ozellik: true, name: "Antalia-2 Mini", filename: "antalia:antalia_dogal",
        format: "Erkek sesi, 5 anlatım profili", approxSize: "40 MB (+ PyTorch yoksa ~250 MB)", resolution: "Türkçe",
        notes: "Hafif ve doğal Türkçe erkek sesi. Ekran kartı gerekmez. Lisans: Apache-2.0 (cloud0day3/antalia-mini).",
        pageUrl: "https://huggingface.co/cloud0day3/antalia-mini", recommendedTiers: ["Low", "Mid", "High"],
      },
      {
        id: "tts-supertonic", ozellik: true, name: "Supertonic-3", filename: "supertonic:M1",
        format: "10 ses (5 kadın, 5 erkek)", approxSize: "400 MB", resolution: "Çok dilli",
        notes: "Hızlı ONNX motoru, işlemcide rahat çalışır. Ağırlıklar OpenRAIL-M lisanslı (kullanım kısıtları model sayfasında).",
        pageUrl: "https://huggingface.co/Supertone/supertonic-3", recommendedTiers: ["Low", "Mid", "High"],
      },
      {
        id: "tts-ahenk", ozellik: true, name: "Ahenk Cep", filename: "ahenk:neutral",
        format: "Kadın sesi, 7 ruh hali", approxSize: "40 MB (+ PyTorch yoksa ~250 MB)", resolution: "Türkçe",
        notes: "Duygulu Türkçe kadın sesi (doğal, neşeli, sakin, empatik, hüzünlü, heyecanlı, sert). Model CC BY 4.0, kod Apache-2.0.",
        pageUrl: "https://huggingface.co/ozgurguler/ahenk-cep-tr", recommendedTiers: ["Low", "Mid", "High"],
      },
      {
        id: "tts-omnivoice", ozellik: true, name: "OmniVoice (ses klonlama)", filename: "omnivoice:otomatik",
        format: "Ses tasarımı + klonlama", approxSize: "3,5 GB", resolution: "Çok dilli",
        notes: "Ağır model: ekran kartı önerilir, işlemcide çok yavaş çalışır. Klon için app/reference-voices klasörüne 3-30 sn'lik WAV ve yanına aynı adlı .txt metni koyun. Lisans ticari olmayan kullanım içindir.",
        pageUrl: "https://huggingface.co/k2-fsa/OmniVoice", recommendedTiers: ["High"],
      },
    ],
  },
  {
    group: "Kokoro Metinden Sese Modelleri",
    items: [
      {
        id: "kokoro-onnx-q8",
        name: "Kokoro 82M ONNX Q8",
        filename: "kokoro-onnx-q8.json",
        format: "Kokoro ONNX",
        approxSize: "Model cache on first use",
        resolution: "24 kHz WAV",
        notes: "Önerilen yerel metinden sese modeli. Çoğu bilgisayarda iyi kalite sunar ve tam hassasiyetli sürümden daha hızlı başlar.",
        url: "kokoro://install/kokoro-onnx-q8",
        pageUrl: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
        recommendedTiers: ["Low", "Mid", "High"],
      },
      {
        id: "kokoro-onnx-fp32",
        name: "Kokoro 82M ONNX FP32",
        filename: "kokoro-onnx-fp32.json",
        format: "Kokoro ONNX",
        approxSize: "Model cache on first use",
        resolution: "24 kHz WAV",
        notes: "Kalite testi için tam hassasiyetli Kokoro ONNX sürümü. Daha fazla bellek ve disk önbelleği kullanır.",
        url: "kokoro://install/kokoro-onnx-fp32",
        pageUrl: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
        recommendedTiers: ["Mid", "High"],
      },
    ],
  },
];

const COREML_MODEL_LIBRARY = [
  {
    group: "Apple Silicon NPU - CoreML Testi",
    items: [
      {
        name: "Stable Diffusion v1.5 CoreML (split_einsum, palettized 6-bit)",
        filename: "coreml-stable-diffusion-v1-5-palettized_split_einsum_v2_compiled",
        format: "CoreML",
        approxSize: "2.0 GB",
        resolution: "512x512",
        notes: "Apple Silicon ANE (Neural Engine) için optimize edilmiş, 6 bit paletlenmiş Stable Diffusion 1.5 modeli. İndirme tamamlanınca otomatik olarak açılır ve Mac NPU'larında son derece hızlı çalışır.",
        url: "https://huggingface.co/apple/coreml-stable-diffusion-v1-5-palettized/resolve/main/coreml-stable-diffusion-v1-5-palettized_split_einsum_v2_compiled.zip",
      },
      {
        name: "CyberRealistic v1.5 CoreML (6-bit palettized)",
        filename: "cyberrealistic-6bit.coreml",
        format: "CoreML",
        approxSize: "815 MB",
        resolution: "512x512",
        notes: "CyberRealistic'in 6 bit paletlenmiş CoreML sürümü. Son derece hızlıdır ve Apple Silicon Neural Engine (ANE) için optimize edilmiştir.",
        url: "https://huggingface.co/orailnooor/cyberrealistic-coreml/resolve/main/cyberrealistic-6bit.coreml.zip",
      },
      {
        name: "CyberRealistic v1.5 CoreML (Standard)",
        filename: "cyberrealistic.coreml",
        format: "CoreML",
        approxSize: "1.8 GB",
        resolution: "512x512",
        notes: "CyberRealistic'in standart CoreML sürümü. Apple Silicon NPU'ları için optimize edilmiş, yüksek doğrulukta gerçekçilik sunar.",
        url: "https://huggingface.co/orailnooor/cyberrealistic-coreml/resolve/main/cyberrealistic.coreml.zip",
      },
    ],
  },
];

// Tümleşik ekran kartı denetimi (tumlesikGpuMu) StudyoOrtak.jsx içinde; sunucudaki isIntegratedGpu ile aynı kural.

// Seviye ayrı ekran belleği (VRAM) + RAM + işlemciye göre belirlenir; paylaşılan bellek VRAM sayılmaz.
// Sunucudaki getHardwareSpecs ile aynı kurallar (yama uygulanmamışsa da arayüz doğru seviyeyi gösterir).
const getHardwareTier = (specs) => {
  if (!specs) return "Low";
  const ram = Number(specs.ram_total_gb) || 0;
  const cekirdek = Number(specs.cpu_cores_physical) || Number(specs.cpu_cores_logical) || 0;
  const tumlesik = specs.gpu_integrated === true || tumlesikGpuMu(specs.gpu_name);
  const vram = tumlesik ? 0 : (Number(specs.gpu_dedicated_vram_gb ?? specs.gpu_vram_gb) || 0);

  if (vram >= 12) {
    return "High";
  } else if (vram >= 6 || (ram >= 32 && cekirdek >= 8)) {
    return "Mid";
  } else {
    return "Low";
  }
};

const SEVIYE_ADI = { low: "düşük", mid: "orta", high: "yüksek" };

// --------------------------------------------------------------------------
// Müzik/efekt ve video modelleri sekmesi. Veriler stüdyo sayfalarıyla aynı uç noktalardan gelir
// (/api/music/models, /api/video/models); kurulum aynı kuyruğu kullanır (/api/studyo/kur, /api/studyo/kurulum),
// bu yüzden burada başlatılan kurulumun ilerlemesi stüdyo sayfasında da görünür (ve tersi).
// Kart ve satır görünümü diğer sekmelerdeki kütüphane kartlarıyla aynıdır.
// --------------------------------------------------------------------------
const kartRozeti = (renk, zemin, kenar) => ({
  fontSize: "0.68rem", color: renk, background: zemin, padding: "2px 6px", borderRadius: "4px", fontWeight: "bold", border: `1px solid ${kenar}`,
});

function StudyoModelSekmesi({ tur, aktif, specs, showAlert, showConfirm }) {
  const [modeller, setModeller] = useState([]);
  const [donanim, setDonanim] = useState(null);
  const [tabanSayisi, setTabanSayisi] = useState(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [gosterilen, setGosterilen] = useState({});
  const [siliniyor, setSiliniyor] = useState("");
  const video = tur === "video";

  const yenile = useCallback(async () => {
    try {
      const v = video ? await videoModelleri() : await muzikModelleri();
      setModeller(v.models || []);
      setDonanim(v.donanim || null);
      setTabanSayisi(Array.isArray(v.tabanlar) ? v.tabanlar.length : null);
      setHata("");
    } catch (err) {
      setHata(err.message || String(err));
    } finally {
      setYukleniyor(false);
    }
  }, [video]);
  const takip = useKurulumTakibi(yenile);
  const { kurulum, ozet } = takip;

  useEffect(() => {
    setYukleniyor(true);
    setModeller([]);
    setGosterilen({});
  }, [tur]);
  useEffect(() => { if (aktif) yenile(); }, [aktif, yenile]);

  const systemTier = getHardwareTier(specs);
  const kurulu = modeller.filter((m) => m.installed);
  const desteklenen = modeller.filter((m) => m.supported !== false);
  const bolumler = video
    ? [
        { group: "Video Modelleri", items: desteklenen },
        { group: "Bu sürümde olmayan video modelleri", items: modeller.filter((m) => m.supported === false) },
      ]
    : [
        { group: "Müzik Modelleri", items: desteklenen.filter((m) => m.tur === "muzik") },
        { group: "Ses Efekti Modelleri", items: desteklenen.filter((m) => m.tur === "efekt") },
        { group: "Bu sürümde olmayan modeller (V2'de var)", items: modeller.filter((m) => m.supported === false) },
      ];

  const sil = async (model) => {
    const ok = await showConfirm({
      title: "Model Silinsin mi?",
      message: `"${model.name}" (${model.approxSize}) indirilen dosyalarıyla birlikte silinsin mi? Gerekirse yeniden indirebilirsiniz. Başka bir kurulu modelin de kullandığı dosyalar korunur.`,
      confirmLabel: "Sil",
      cancelLabel: "Vazgeç",
      danger: true,
    });
    if (!ok) return;
    setSiliniyor(model.id);
    try {
      await studyoModelSil(model.id);
      await yenile();
    } catch (err) {
      showAlert({ title: "Silinemedi", message: err.message || String(err), danger: true });
    } finally {
      setSiliniyor("");
    }
  };

  const klasor = video ? "app/video-models/" : "app/music-models/";
  return (
    <>
      <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        <DonanimRozeti donanim={donanim} />
        {ozet.aktif && (
          <span className="status-chip" style={{ maxWidth: "100%", overflowWrap: "anywhere" }}>
            <RefreshCw className="progress-spinner" size={12} /> {ozet.metin}
          </span>
        )}
      </div>
      {!ozet.aktif && ozet.hata && (
        <div className="model-search-warning" style={{ marginTop: "12px" }}>Son kurulum hatası: {ozet.hata}</div>
      )}

      {/* Kurulu stüdyo modelleri */}
      <div className="m3-card" style={{ marginTop: "24px" }}>
        <h3 className="m3-card-title">
          <Database size={18} style={{ color: "var(--md-sys-color-primary)" }} />
          Yerel {video ? "Video" : "Müzik ve Efekt"} Modelleri ({kurulu.length})
        </h3>
        {yukleniyor ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", padding: "24px 0", color: "var(--md-sys-color-outline)" }}>
            <RefreshCw className="progress-spinner" size={16} />
            <span style={{ fontSize: "0.9rem" }}>Modeller ve donanım okunuyor (ilk açılışta 10-30 sn sürebilir)...</span>
          </div>
        ) : kurulu.length === 0 ? (
          <p style={{ fontSize: "0.9rem", color: "var(--md-sys-color-outline)", textAlign: "center", padding: "16px 0" }}>
            {hata ? `Model listesi alınamadı: ${hata}` : `${klasor} içinde kurulu ${video ? "video" : "müzik / ses efekti"} modeli yok. Aşağıdaki kütüphaneden kurun.`}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {kurulu.map((model) => (
              <div
                key={model.id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap",
                  padding: "12px 16px", background: "var(--md-sys-color-surface-variant)", color: "var(--md-sys-color-on-surface-variant)",
                  borderRadius: "var(--md-shape-corner-medium)", border: "1px solid var(--md-sys-color-outline-variant)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 240px" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    {model.name}
                    <span className="status-chip" style={{ padding: "2px 8px", fontSize: "0.7rem", fontWeight: 700, background: "var(--md-sys-color-primary)", color: "var(--md-sys-color-on-primary)", border: "none" }}>Hazır</span>
                    {model.uyari?.seviye === "onerilmez" && <span className="status-chip chip-uyari" style={{ padding: "2px 8px", fontSize: "0.7rem" }}>Bu donanımda önerilmez</span>}
                  </span>
                  <span style={{ fontSize: "0.75rem", opacity: 0.8, overflowWrap: "anywhere" }}>
                    {[model.format, model.resolution, kisaBoyut(model.approxSize)].filter(Boolean).join(" · ")}
                    {model.id === "animatediff" && tabanSayisi != null ? ` · taban SD 1.5 modeli: ${tabanSayisi} adet` : ""}
                  </span>
                  <span style={{ fontSize: "0.72rem", opacity: 0.75 }}>
                    {video ? "Video Stüdyosu" : model.tur === "efekt" ? "Müzik ve Ses Efekti Stüdyosu (Ses Efekti)" : "Müzik ve Ses Efekti Stüdyosu (Müzik)"} sayfasında kullanılır; her üretimde ayrı bir süreçte yüklenir, bellekte kalmaz.
                  </span>
                  <BuBilgisayardaSatiri not={model.buBilgisayarda} style={{ fontSize: "0.72rem" }} />
                </div>
                {model.silinebilir && (
                  <button
                    className="m3-btn m3-btn-error"
                    style={{ height: "36px", width: "36px", padding: 0, minWidth: "36px" }}
                    onClick={() => sil(model)}
                    disabled={Boolean(siliniyor) || ozet.aktif}
                    title="İndirilen model dosyalarını sil"
                  >
                    {siliniyor === model.id ? <RefreshCw className="progress-spinner" size={14} /> : <Trash2 size={14} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="workspace-title-section" style={{ marginTop: "32px", marginBottom: "16px" }}>
        <h3 className="m3-card-title">
          <Library size={20} style={{ color: "var(--md-sys-color-primary)" }} />
          {video ? "Video Model Kütüphanesi" : "Müzik ve Ses Efekti Model Kütüphanesi"}
        </h3>
      </div>
      <ModelArama tur={tur === "video" ? "video" : "muzik"} showAlert={showAlert} showConfirm={showConfirm} onInstalled={() => yenile()} />

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {bolumler.filter((b) => b.items.length > 0).map((section) => (
          <div key={section.group} className="m3-card" style={{ margin: 0 }}>
            <h4 style={{ fontWeight: 700, marginBottom: "12px" }}>{section.group}</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "12px" }}>
              {section.items.map((model) => {
                const desteksiz = model.supported === false;
                const onerilmez = model.uyari?.seviye === "onerilmez";
                const isRecommended = !desteksiz && !onerilmez && (model.recommendedTiers || []).includes(systemTier);
                const buModel = modelKuruluyorMu(model, kurulum);
                const gizli = !model.installed && !desteksiz && model.kurulabilir
                  && (model.kurulumGizli ?? onerilmez) && !gosterilen[model.id] && !buModel;
                return (
                  <div key={model.id} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", minWidth: 0, overflowWrap: "anywhere", background: "var(--md-sys-color-surface-variant)", border: "1px solid var(--md-sys-color-outline-variant)", borderRadius: "var(--md-shape-corner-medium)", opacity: desteksiz ? 0.75 : 1 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        {model.name}
                        {isRecommended && (
                          <span title={`Önerilen: ${SEVIYE_ADI[systemTier.toLowerCase()] || systemTier} seviye donanım`} style={kartRozeti("#2e7d32", "#e8f5e9", "#c8e6c9")}>[Önerilen]</span>
                        )}
                        {onerilmez && (
                          <span title={model.uyari.neden} style={kartRozeti("#b42318", "#fdecea", "#f5c2bd")}>Bu donanımda önerilmez</span>
                        )}
                        {model.uyari?.seviye === "yavas" && (
                          <span title={model.uyari.neden} style={kartRozeti("#9a6700", "#fff4e0", "#f2d39b")}>{/İşlemci/.test(model.uyari.baslik || "") ? "İşlemcide yavaş" : model.uyari.baslik}</span>
                        )}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>
                        {[model.format, model.resolution, model.tierLabel].filter(Boolean).join(" · ")}
                      </span>
                      {model.approxSize && (
                        <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-on-surface-variant)", fontWeight: 600 }}>
                          Dosya boyutu: yaklaşık {model.approxSize}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: "0.78rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.35, margin: 0 }}>
                      {model.notes}
                    </p>
                    {model.lisans && (
                      <p style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)", lineHeight: 1.35, margin: 0 }}>Lisans: {model.lisans}</p>
                    )}
                    <BuBilgisayardaSatiri not={model.buBilgisayarda} />
                    {model.uyari && !model.buBilgisayarda && !model.installed && !desteksiz && (
                      <p style={{ fontSize: "0.74rem", color: onerilmez ? "var(--md-sys-color-error)" : "var(--md-sys-color-on-surface-variant)", lineHeight: 1.35, margin: 0 }}>
                        <strong>{model.uyari.baslik}:</strong> {model.uyari.neden}
                      </p>
                    )}
                    {buModel && (
                      <div className="model-progress-section" style={{ marginTop: "2px" }}>
                        <div className="model-progress-label">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                            <span className="loading-dot"></span>
                            Kuruluyor
                          </span>
                          <span>{ozet.yuzde != null ? `${ozet.yuzde}%` : "Hazırlanıyor"}</span>
                        </div>
                        <div className="model-progress-bar">
                          <div className="model-progress-fill" style={{ width: `${Math.min(100, Math.max(ozet.yuzde == null ? 8 : 0, ozet.yuzde || 0))}%`, transition: "width 0.2s ease" }}></div>
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "var(--md-sys-color-outline)", marginTop: "4px" }}>{ozet.metin}</div>
                      </div>
                    )}
                    {gizli ? (
                      <div style={{ marginTop: "auto" }}>
                        <GizliKurulumKutusu model={model} onGoster={() => setGosterilen((g) => ({ ...g, [model.id]: true }))} />
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: "8px", marginTop: "auto", flexWrap: "wrap" }}>
                        <button
                          className={model.installed ? "m3-btn m3-btn-tonal" : "m3-btn m3-btn-filled"}
                          style={{ height: "36px", flex: "1 1 auto", minWidth: 0 }}
                          onClick={() => studyoKurulumBaslat(model, { showAlert, showConfirm, onBasladi: takip.baslat })}
                          disabled={model.installed || desteksiz || !model.kurulabilir || ozet.aktif}
                          title={!model.kurulabilir && !desteksiz ? model.notes : undefined}
                        >
                          {model.installed ? <HardDrive size={14} /> : buModel ? <RefreshCw className="progress-spinner" size={14} /> : <DownloadCloud size={14} />}
                          <span>
                            {model.installed ? "Kurulu" : desteksiz ? "Bu sürümde yok" : !model.kurulabilir ? "İndirme kapalı (elle kurulum)" : buModel ? "Kuruluyor" : ozet.aktif ? "Başka kurulum sürüyor" : "İndir ve kur"}
                          </span>
                        </button>
                        {gosterilen[model.id] && !model.installed && !buModel && (
                          <button className="m3-btn m3-btn-outlined" style={{ height: "36px", padding: "0 12px" }} onClick={() => setGosterilen((g) => ({ ...g, [model.id]: false }))} title="Kurulum düğmesini yeniden gizle">
                            <EyeOff size={14} />
                          </button>
                        )}
                      </div>
                    )}
                    {model.pageUrl && (
                      <a
                        href={model.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ alignSelf: "center", color: "var(--md-sys-color-primary)", fontSize: "0.75rem", fontWeight: 600, lineHeight: 1.2, textDecoration: "none" }}
                      >
                        Hugging Face'te Görüntüle
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ModelManager({ 
  activeModel, 
  setActiveModel, 
  serverRunning, 
  setServerRunning, 
  constraints, 
  setConstraints, 
  telemetry, 
  backendOptions, 
  showAlert = async ({ message }) => window.alert(message), 
  showConfirm = async ({ message }) => window.confirm(message), 
  activeTab,
  specs,
  textSettings,
}) {
  const [activeModelType, setActiveModelType] = useState("image"); // "image", "text", "speech", "tts", "music" veya "video"
  const studyoSekmesi = activeModelType === "music" || activeModelType === "video";
  const [localModels, setLocalModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [downloadingModelId, setDownloadingModelId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState("");
  const [loadingModelId, setLoadingModelId] = useState(null);
  const [modelLoadProgress, setModelLoadProgress] = useState(null);
  const [compatibleModels, setCompatibleModels] = useState([]);
  const [compatibleTier, setCompatibleTier] = useState("");
  const [compatibleVram, setCompatibleVram] = useState(0);
  const [compatibleInfo, setCompatibleInfo] = useState({});
  const [importProgress, setImportProgress] = useState(null); // null when not importing
  const [importInfo, setImportInfo] = useState({ filename: "", speed: "0.0", eta: 0, status: "" });
  const [downloadUrl, setDownloadUrl] = useState("");
  const [importAbortController, setImportAbortController] = useState(null);
  const [isUnloading, setIsUnloading] = useState(false);
  const [unloadProgress, setUnloadProgress] = useState({ progress: 0, phase: "" });
  const [pendingLoadModel, setPendingLoadModel] = useState(null);
  const [vramWarning, setVramWarning] = useState(null);
  const [backendInfo, setBackendInfo] = useState({ backendMode: "", backendBinary: "", backendDevice: "" });
  const [activeLlmModel, setActiveLlmModel] = useState(null);
  const [llmRunning, setLlmRunning] = useState(false);
  const [activeSpeechModel, setActiveSpeechModel] = useState(null);
  const [speechRunning, setSpeechRunning] = useState(false);
  const [activeTtsModel, setActiveTtsModel] = useState(null);
  const [ttsRunning, setTtsRunning] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [selectedFilters, setSelectedFilters] = useState([]);
  const [huggingFaceModels, setHuggingFaceModels] = useState([]);
  const [isSearchingModels, setIsSearchingModels] = useState(false);
  const [modelSearchError, setModelSearchError] = useState("");
  const [hasHuggingFaceResults, setHasHuggingFaceResults] = useState(false);
  const [modelSearchPage, setModelSearchPage] = useState(1);
  const [isDownloadingDefaults, setIsDownloadingDefaults] = useState(false);
  const [hasMoreModels, setHasMoreModels] = useState(false);
  const [isLoadingMoreModels, setIsLoadingMoreModels] = useState(false);
  const searchRequestRef = React.useRef(0);
  const pendingCompanionDownloadRef = React.useRef(null);

  const cancelLoadRef = React.useRef(false);
  
  const handleCancelLoad = async () => {
    cancelLoadRef.current = true;
    try {
      await stopServer();
    } catch (err) {
      console.warn("Failed to stop server on cancel:", err);
    }
  };

  const normalizedLocalModels = activeModelType === "speech" || activeModelType === "tts"
    ? localModels.filter((model) => model.filename)
    : localModels.map(normalizeModel).filter((model) => model.filename);
  const displayedLocalModels = activeModelType === "speech" || activeModelType === "tts"
    ? normalizedLocalModels.filter((model) => model.installed)
    : normalizedLocalModels.filter((model) => !model.isProjector);
  const allModelNames = activeModelType === "speech" || activeModelType === "tts"
    ? displayedLocalModels.map((model) => model.filename)
    : normalizedLocalModels.map((model) => model.filename);
  const modelNames = displayedLocalModels.map((model) => model.filename);
  const isBusy = loadingModelId !== null || isUnloading;
  
  const openvinoSupported = Boolean(backendOptions?.openvinoNpu?.supported);
  const appleNpuSupported = Boolean(
    backendOptions?.options?.some((opt) => opt.id === "apple-npu") ||
    backendOptions?.unavailable?.some((opt) => opt.id === "apple-npu")
  );
  const displayedHuggingFaceModels = huggingFaceModels.filter((model) => (
    selectedFilters.every((filterId) => model.tags?.includes(filterId))
  ));

  const getModelTypeLabel = (type) => {
    if (type === "image") return "Görsel";
    if (type === "text") return "Metin";
    if (type === "speech") return "Konuşma";
    if (type === "tts") return "Metinden sese";
    return "Model";
  };

  const getRuntimeForType = (type) => {
    if (type === "image" && serverRunning && activeModel) {
      return { type: "image", model: activeModel, label: getModelTypeLabel("image") };
    }
    if (type === "text" && llmRunning && activeLlmModel) {
      return { type: "text", model: activeLlmModel, label: getModelTypeLabel("text") };
    }
    if (type === "speech" && speechRunning && activeSpeechModel) {
      return { type: "speech", model: activeSpeechModel, label: getModelTypeLabel("speech") };
    }
    if (type === "tts" && ttsRunning && activeTtsModel) {
      return { type: "tts", model: activeTtsModel, label: getModelTypeLabel("tts") };
    }
    return null;
  };

  const getActiveHeavyRuntime = () => (
    getRuntimeForType("image") ||
    getRuntimeForType("text")
  );

  const blockLoadIfOtherRuntimeActive = (modelId, targetType) => {
    if (targetType !== "image" && targetType !== "text") {
      return false;
    }

    const runtime = getActiveHeavyRuntime();
    if (!runtime || (runtime.type === targetType && runtime.model === modelId)) {
      return false;
    }
    setPendingLoadModel({
      modelId,
      targetType,
      activeRuntime: runtime,
    });
    return true;
  };
  
  let visibleModelLibrary = [];
  if (activeModelType === "image") {
    visibleModelLibrary = [...MODEL_LIBRARY];
    if (openvinoSupported) {
      visibleModelLibrary = [...visibleModelLibrary, ...OPENVINO_MODEL_LIBRARY];
    }
    if (appleNpuSupported) {
      visibleModelLibrary = [...visibleModelLibrary, ...COREML_MODEL_LIBRARY];
    }
  } else if (activeModelType === "text") {
    visibleModelLibrary = [{
      group: "Hugging Face'ten Önerilen Metin Modelleri",
      items: hasHuggingFaceResults ? displayedHuggingFaceModels : TEXT_MODEL_LIBRARY[0].items,
    }];
  } else if (activeModelType === "speech") {
    visibleModelLibrary = [{
      // Seda / Duyu: klasör halinde paket modeller (Python ile çalışır, Türkçe'ye özel)
      group: "Türkçe Sesten Metne Modelleri (önerilen)",
      items: normalizedLocalModels.filter((model) => model.paket).map((model) => ({
        ...model,
        format: model.engine === "seda" ? "Seda (ONNX)" : "Duyu (ONNX)",
        approxSize: model.size,
        notes: `${model.aciklama || "Türkçe sesten metne modeli."} İndirirken gerekli Python paketleri de kendiliğinden kurulur.`,
        recommendedTiers: model.recommended ? ["Low", "Mid", "High"] : [],
      })),
    }, {
      group: "Whisper Sesten Metne Modelleri",
      items: normalizedLocalModels.filter((model) => model.url && !model.paket).map((model) => ({
        ...model,
        format: "Whisper.cpp",
        approxSize: model.size,
        notes: `${model.language || "Konuşma"} döküm modeli. app/speech-models/ klasöründe saklanır.`,
        recommendedTiers: model.recommended ? ["Low", "Mid", "High"] : [],
      })),
    }];
  } else {
    visibleModelLibrary = TTS_MODEL_LIBRARY;
  }

  useEffect(() => {
    if (activeModelType !== "text" || !ESKI_HF_ARAMA) return;
    const requestId = ++searchRequestRef.current;
    const timer = setTimeout(async () => {
      setIsSearchingModels(true);
      setModelSearchError("");
      try {
        const result = await searchHuggingFaceModels(modelSearch, selectedFilters, 1);
        if (requestId !== searchRequestRef.current) return;
        const matchingModels = result.models.filter((model) => (
          selectedFilters.every((filterId) => model.tags?.includes(filterId))
        ));
        setHuggingFaceModels(matchingModels);
        setHasHuggingFaceResults(true);
        setModelSearchPage(1);
        setHasMoreModels(result.hasMore);
      } catch (err) {
        if (requestId !== searchRequestRef.current) return;
        setHuggingFaceModels([]);
        setHasHuggingFaceResults(false);
        setHasMoreModels(false);
        setModelSearchError(err.message || "Hugging Face'te arama yapılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.");
      } finally {
        if (requestId === searchRequestRef.current) setIsSearchingModels(false);
      }
    }, modelSearch ? 400 : 0);
    return () => clearTimeout(timer);
  }, [activeModelType, modelSearch, selectedFilters]);

  const toggleModelFilter = (filterId) => {
    setSelectedFilters((current) => (
      current.includes(filterId)
        ? current.filter((id) => id !== filterId)
        : [...current, filterId]
    ));
  };

  const handleLoadMoreModels = async () => {
    if (isLoadingMoreModels || !hasMoreModels) return;
    const nextPage = modelSearchPage + 1;
    setIsLoadingMoreModels(true);
    setModelSearchError("");
    try {
      const [result] = await Promise.all([
        searchHuggingFaceModels(modelSearch, selectedFilters, nextPage),
        new Promise((resolve) => setTimeout(resolve, 350)),
      ]);
      const matchingModels = result.models.filter((model) => (
        selectedFilters.every((filterId) => model.tags?.includes(filterId))
      ));
      setHuggingFaceModels((current) => {
        const known = new Set(current.map((model) => model.id));
        return [...current, ...matchingModels.filter((model) => !known.has(model.id))];
      });
      setModelSearchPage(result.page);
      setHasMoreModels(result.hasMore);
    } catch (err) {
      setModelSearchError(err.message || "Daha fazla Hugging Face modeli yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setIsLoadingMoreModels(false);
    }
  };
  
  const getLocalModelInfo = (modelId) => localModels.map(normalizeModel).find((model) => model.filename === modelId);

  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      if (activeModelType === "image") {
        const list = await listLocalModels();
        setLocalModels(list.map(normalizeModel).filter((model) => model.filename));
      } else if (activeModelType === "text") {
        const list = await listLlmModels();
        setLocalModels(list.map(normalizeModel).filter((model) => model.filename));
      } else if (activeModelType === "speech") {
        const list = await listSpeechModels();
        setLocalModels(list.filter((model) => model.filename));
      } else if (activeModelType === "music" || activeModelType === "video") {
        setLocalModels([]); // stüdyo modelleri StudyoModelSekmesi içinde okunur
      } else {
        const list = await listTtsModels();
        setLocalModels(list.filter((model) => model.filename));
      }
    } catch (e) {
      console.error(e);
      setLocalModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }, [activeModelType]);

  useEffect(() => {
    if (activeTab === "models") {
      fetchModels();
      checkActiveDownload();
    }
  }, [activeTab, fetchModels]);

  useEffect(() => {
    fetchModels();
    checkActiveDownload();
  }, [activeModelType]);

  useEffect(() => {
    let cancelled = false;
    const updateBackendInfo = async () => {
      try {
        const [sdStatus, llmStatus, speechStatus, ttsStatus] = await Promise.all([
          getBackendStatus(),
          getLlmStatus(),
          getSpeechStatus(),
          getTtsStatus()
        ]);
        if (cancelled) return;
        
        setBackendInfo({
          backendMode: sdStatus.settings?.backendMode || sdStatus.loading?.backendMode || "",
          backendBinary: sdStatus.settings?.backendBinary || sdStatus.loading?.backendBinary || "",
          backendDevice: sdStatus.settings?.backendDevice || sdStatus.loading?.device || "",
          llmBackendMode: llmStatus.settings?.backendMode || llmStatus.settings?.backendBinary || "",
          speechBackendMode: speechStatus.settings?.backendMode || speechStatus.backendMode || "",
          ttsBackendMode: ttsStatus.settings?.backendMode || ttsStatus.backendMode || "",
        });
        
        if (llmStatus.ready) {
          setActiveLlmModel(llmStatus.settings?.model || null);
          setLlmRunning(true);
        } else {
          setActiveLlmModel(null);
          setLlmRunning(false);
        }
        if (speechStatus.ready) {
          setActiveSpeechModel(speechStatus.settings?.model || null);
          setSpeechRunning(true);
        } else {
          setActiveSpeechModel(null);
          setSpeechRunning(false);
        }
        if (ttsStatus.ready) {
          setActiveTtsModel(ttsStatus.settings?.etkin || ttsStatus.settings?.model || null);
          setTtsRunning(true);
        } else {
          setActiveTtsModel(null);
          setTtsRunning(false);
        }
      } catch (_) {}
    };

    updateBackendInfo();
    const interval = setInterval(updateBackendInfo, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serverRunning, loadingModelId]);

  const checkActiveDownload = async () => {
    try {
      const status = await getDownloadProgress();
      if (status.active && status.filename) {
        startProgressPolling(status.filename);
      }
    } catch (e) {
      console.error("Check active download failed:", e);
    }
  };

  const downloadByUrl = async (url, expectedFilename, companion = null, options = {}) => {
    if (downloadingModelId) return;

    if (!options.skipExistingConfirm && allModelNames.includes(expectedFilename)) {
      if (!(await showConfirm({
        title: "Model Üzerine Yazılsın mı?",
        message: `"${expectedFilename}" zaten indirilmiş. Yeniden indirip üzerine yazmak istiyor musunuz?`,
        confirmLabel: "Üzerine Yaz",
      }))) {
        return;
      }
    }

    const isTauriDesktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;

    if (!isTauriDesktop && !isLocalServerMode()) {
      showAlert({ title: "Sunucu Gerekli", message: "Model indirmek için yerel sunucunun çalışıyor olması gerekir.", danger: true });
      return;
    }

    try {
      pendingCompanionDownloadRef.current = companion;
      let res;
      if (activeModelType === "image") {
        res = await downloadModel(url);
      } else if (activeModelType === "text") {
        res = await downloadLlmModel(url, expectedFilename, companion);
      } else if (activeModelType === "speech") {
        res = await downloadSpeechModel(url, expectedFilename);
      } else {
        res = await downloadTtsModel(url, expectedFilename);
      }
      if (res && res.ok) {
        if (!companion && res.projectorUrl && res.projectorFilename) {
          pendingCompanionDownloadRef.current = {
            url: res.projectorUrl,
            filename: res.projectorFilename,
          };
        }
        startProgressPolling(expectedFilename);
      } else {
        pendingCompanionDownloadRef.current = null;
        showAlert({ title: "İndirme Başarısız", message: res.error || "Bilinmeyen hata", danger: true });
      }
    } catch (err) {
      pendingCompanionDownloadRef.current = null;
      showAlert({ title: "İndirme Hatası", message: err.message, danger: true });
    }
  };

  const startProgressPolling = (modelId) => {
    setDownloadingModelId(modelId);
    
    const interval = setInterval(async () => {
      try {
        const status = await getDownloadProgress();
        if (status.active) {
          setDownloadProgress(status.progress === -1 ? 0 : status.progress);
          setDownloadSpeed(status.eta ? `${status.speed}  Kalan ${status.eta}s` : String(status.speed || ""));
        } else {
          clearInterval(interval);
          setDownloadingModelId(null);
          if (status.error) {
            if (!String(status.error).toLowerCase().includes("cancelled")) {
              showAlert({ title: "İndirme Başarısız", message: status.error, danger: true });
            }
          } else {
            fetchModels();
            const companion = pendingCompanionDownloadRef.current;
            pendingCompanionDownloadRef.current = null;
            if (companion?.url && companion?.filename && !allModelNames.includes(companion.filename)) {
              setTimeout(() => {
                downloadByUrl(
                  companion.url,
                  companion.filename,
                  null,
                  { skipExistingConfirm: true }
                );
              }, 500);
            }
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 1000);
  };

  const handleUrlDownloadSubmit = async (e) => {
    e.preventDefault();
    if (!downloadUrl.trim()) return;

    let modelName = activeModelType === "image" ? "model.safetensors" : activeModelType === "text" ? "model.gguf" : activeModelType === "speech" ? "model.bin" : "model.json";
    try {
      const parsed = new URL(downloadUrl.trim());
      modelName = parsed.pathname.split("/").pop() || modelName;
    } catch (_) {
      showAlert({ title: "Geçersiz URL", message: "Lütfen geçerli bir HTTP/HTTPS bağlantısı girin.", danger: true });
      return;
    }

    await downloadByUrl(downloadUrl.trim(), modelName);
    setDownloadUrl("");
  };

  const handleLibraryDownload = async (model) => {
    if (downloadingModelId) return;

    if (activeModelType === "speech") {
      const confirmed = await showConfirm({
        title: "Sesten Metne Modeli İndirilsin mi?",
        message: `Şu model indirilsin mi: "${model.name}" (${model.size || model.approxSize})?`,
        confirmLabel: "İndir",
      });
      if (confirmed) {
        // Seda / Duyu gibi paket modeller kimlikle indirilir (çok dosyalı klasör)
        await downloadByUrl(model.paket ? model.id : model.url, model.filename);
      }
      return;
    }

    if (activeModelType === "tts") {
      const confirmed = await showConfirm({
        title: model.ozellik ? "Ses Motoru Kurulsun mu?" : "Metinden Sese Modeli İndirilsin mi?",
        message: model.ozellik
          ? `"${model.name}" kurulsun mu (yaklaşık ${model.approxSize})? Gerekli Python paketleri ve model dosyaları sabit sürümlerinden indirilip doğrulanır. Bu birkaç dakika sürebilir.`
          : `Şu model kurulsun mu: "${model.name}"? Kokoro model dosyaları ilk üretimde önbelleğe alınır.`,
        confirmLabel: "Kur",
      });
      if (confirmed) {
        await downloadByUrl(model.id || model.url, model.filename);
      }
      return;
    }

    if (model.backendType === "openvino-npu") {
      const confirmed = await showConfirm({
        title: "OpenVINO Modeli İndirilsin mi?",
        message: `Şu model indirilsin mi: "${model.name}" (~${model.approxSize})? OpenVINO modelleri Python betiğiyle klasör klasör indirilir.`,
        confirmLabel: "İndir",
      });
      if (!confirmed) return;
      try {
        await downloadOpenVinoModel(model.id);
        startProgressPolling(model.name);
      } catch (err) {
        showAlert({ title: "İndirme Başarısız", message: err.message, danger: true });
      }
      return;
    }

    const hasMainModel = modelNames.includes(model.filename);
    const hasProjector = !model.projectorFilename || allModelNames.includes(model.projectorFilename);
    if (hasMainModel && model.projectorUrl && model.projectorFilename && !hasProjector) {
      const confirmed = await showConfirm({
        title: "Görüntü Projektörü İndirilsin mi?",
        message: `"${model.name}" indirildi, ancak görsel girişi için eşleşen projektör dosyası (${model.projectorFilename}) gerekiyor. Şimdi indirilsin mi?`,
        confirmLabel: "Projektörü İndir",
      });
      if (confirmed) {
        await downloadByUrl(model.projectorUrl, model.projectorFilename, null, { skipExistingConfirm: true });
      }
      return;
    }

    const confirmed = await showConfirm({
      title: "Model İndirilsin mi?",
      message: model.projectorUrl
        ? `Şu model indirilsin mi: "${model.name}" (~${model.approxSize}) ve gerektirdiği görüntü projektörü?`
        : `Şu model indirilsin mi: "${model.name}" (~${model.approxSize})?`,
      confirmLabel: "İndir",
    });
    if (confirmed) {
      await downloadByUrl(
        model.url,
        model.filename,
        model.projectorUrl && model.projectorFilename
          ? { url: model.projectorUrl, filename: model.projectorFilename }
          : null
      );
    }
  };

  const handleCancelDownload = async () => {
    try {
      await cancelModelDownload();
      setDownloadingModelId(null);
      setDownloadProgress(0);
      setDownloadSpeed("");
    } catch (err) {
      console.error(err);
    }
  };

  const checkVramAndLoad = async (modelId, options = {}) => {
    if (!options.skipActiveGuard && blockLoadIfOtherRuntimeActive(modelId, "image")) {
      return;
    }

    const modelInfo = getLocalModelInfo(modelId);
    if (!modelInfo) {
      await performLoadModel(modelId);
      return;
    }

    const isOpenVinoSelected = constraints.backendType === "openvino-npu";
    const isOpenVinoModel = modelInfo.backendType === "openvino-npu";
    const isCoreMLModel = modelInfo.format === "CoreML" || modelInfo.backendType === "apple-npu";
    const isStandardWeights = /\.(safetensors|ckpt|gguf)$/i.test(modelId) || (!isOpenVinoModel && !isCoreMLModel);
    if (isOpenVinoSelected && isStandardWeights) {
      const gpuBackend = backendOptions?.options?.find((backend) =>
        ["vulkan", "cuda", "rocm", "metal"].includes(backend.id)
      );
      const cpuBackend = backendOptions?.options?.find((backend) => backend.id === "cpu");
      const targetBackend = gpuBackend || cpuBackend;

      if (!targetBackend) {
        await showAlert({
          title: "Motor Değişikliği Gerekli",
          message: `"${modelId}" standart bir ağırlık dosyası. OpenVINO NPU yalnızca indirilmiş OpenVINO model klasörlerini yükleyebilir ve şu anda kurulu bir GPU ya da CPU motoru yok.`,
          danger: true,
        });
        return;
      }

      const confirmed = await showConfirm({
        title: "Hızlandırıcı Değiştirilsin mi?",
        message: `"${modelId}" OpenVINO NPU üzerinde yüklenemez. ${targetBackend.label} motoruna geçilip model orada yüklensin mi?`,
        confirmLabel: `Geç: ${targetBackend.label}`,
        cancelLabel: "Vazgeç",
      });
      if (!confirmed) return;

      const nextConstraints = {
        ...constraints,
        backendType: targetBackend.id,
        useGpu: targetBackend.id !== "cpu",
      };
      setConstraints(nextConstraints);
      await performLoadModel(modelId, nextConstraints);
      return;
    }

    const totalSizeBytes = Number(modelInfo.sizeBytes) || 0;
    if (totalSizeBytes <= 0) {
      await performLoadModel(modelId);
      return;
    }

    const freeVramGb = Number(telemetry.vram_total_gb - telemetry.vram_used_gb) || 0;
    const modelSizeGb = totalSizeBytes / (1024 ** 3);
    const hasNvidiaGpu = Boolean(telemetry.gpu_name && telemetry.gpu_name.toLowerCase().includes("nvidia"));
    
    const isCpuOnlyBackend = constraints.backendType === "cpu" || constraints.useGpu === false;

    if (hasNvidiaGpu && !isCpuOnlyBackend && modelInfo.backendType !== "openvino-npu" && modelInfo.format !== "CoreML") {
      const safetyMarginGb = 0.8;
      if (modelSizeGb + safetyMarginGb > freeVramGb) {
        setVramWarning({
          modelId,
          modelSizeGb,
          freeVramGb,
          totalVramGb: telemetry.vram_total_gb,
        });
        return;
      }
    }
    await performLoadModel(modelId);
  };

  const loadTextModel = async (modelId) => {
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 40,
      phase: "llama.cpp sunucusu başlatılıyor...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      const cores = textSettings?.threads || specs?.cpu_cores_physical || 4;
      const context = textSettings?.contextSize ?? 0;
      await startLlm(modelId, {
        threads: cores,
        contextSize: context,
        gpuLayers: -1,
        preferredBackend: textSettings?.preferredBackend
      });
      setActiveLlmModel(modelId);
      setLlmRunning(true);
    } catch (err) {
      showAlert({ title: "Model Yüklenemedi", message: err.message || String(err), danger: true });
    } finally {
      setModelLoadProgress(null);
      setLoadingModelId(null);
    }
  };

  const loadSpeechModel = async (modelId) => {
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 30,
      phase: "Sesten metne modeli hazırlanıyor...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      await startSpeech(modelId, { threads: textSettings?.threads || specs?.cpu_cores_physical || 4 });
      setActiveSpeechModel(modelId);
      setSpeechRunning(true);
    } catch (err) {
      showAlert({ title: "Sesten Metne Modeli Yüklenemedi", message: err.message || String(err), danger: true });
    } finally {
      setModelLoadProgress(null);
      setLoadingModelId(null);
    }
  };

  const loadTtsModel = async (modelId) => {
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 30,
      phase: "Metinden sese motoru hazırlanıyor...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      await startTts(modelId);
      setActiveTtsModel(modelId);
      setTtsRunning(true);
    } catch (err) {
      showAlert({ title: "Metinden Sese Modeli Yüklenemedi", message: err.message || String(err), danger: true });
    } finally {
      setModelLoadProgress(null);
      setLoadingModelId(null);
    }
  };

  const handleLoadModel = async (modelId) => {
    if (blockLoadIfOtherRuntimeActive(modelId, activeModelType)) {
      return;
    }

    if (activeModelType === "image") {
      await checkVramAndLoad(modelId);
    } else if (activeModelType === "text") {
      await loadTextModel(modelId);
    } else if (activeModelType === "speech") {
      await loadSpeechModel(modelId);
    } else {
      await loadTtsModel(modelId);
    }
  };

  const performLoadModel = async (modelId, forcedConstraints = null) => {
    const isTauriDesktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
    const backendStatus = await getBackendStatus();
    const backendPort = backendStatus?.port || 8080;
    
    if (!isTauriDesktop && !isLocalServerMode()) {
      const isAlreadyRunning = await pingServer();
      const modelInfo = getLocalModelInfo(modelId);
      const isOpenVinoModel = modelInfo?.backendType === "openvino-npu";
      const cmd = isOpenVinoModel
        ? `Yapılandırılmış bir Intel NPU makinesinde platform başlatıcısını çalıştırın ve Model Yöneticisi'nden "${modelId}" modelini yükleyin.`
        : `.\\backend\\win\\vulkan\\sd-vulkan.exe --listen-port ${backendPort} --model .\\models\\${modelId} --threads 8`;
      
      if (isAlreadyRunning) {
        if (await showConfirm({ title: "Web Tarayıcısı Modu", message: `"${modelId}" modelini etkin GPU sunucusunda yüklemek için terminaldeki motoru şu komutla yeniden başlatın:

${cmd}

Arayüz durumu yine de güncellensin mi?`, confirmLabel: "Arayüzü Güncelle" })) {
          setActiveModel(modelId);
          setServerRunning(true);
        }
      } else {
        if (await showConfirm({ title: "Motor Çalışmıyor", message: `C++ motor sunucusu şu bağlantı noktasında çalışmıyor: ${backendPort}.

Yerel olarak çalıştırmak için şunu başlatın:

${cmd}

Bunun yerine Simülasyon Modunda devam edilsin mi?`, confirmLabel: "Devam Et" })) {
          setActiveModel(modelId);
          setServerRunning(false);
        }
      }
      return;
    }

    cancelLoadRef.current = false;
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 0,
      phase: "Motor başlatılıyor...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      const modelInfo = getLocalModelInfo(modelId);
      const isCoreMLModel = modelInfo?.format === "CoreML" || modelInfo?.backendType === "apple-npu";
      const activeConstraints = forcedConstraints || constraints;
      const loadConstraints = isCoreMLModel
        ? {
            ...activeConstraints,
            backendType: "apple-npu",
            useGpu: true,
            width: 512,
            height: 512,
            steps: activeConstraints.steps || 20,
            cfgScale: Number(activeConstraints.cfgScale) > 1 ? activeConstraints.cfgScale : 7,
          }
        : modelInfo?.backendType === "openvino-npu"
        ? {
            ...activeConstraints,
            backendType: "openvino-npu",
            useGpu: true,
            width: activeConstraints.width >= 1024 ? 1024 : 512,
            height: activeConstraints.height >= 1024 ? 1024 : 512,
            steps: Math.max(1, Math.min(8, activeConstraints.steps || 4)),
            cfgScale: activeConstraints.cfgScale || 1,
          }
        : activeConstraints;
      
      const response = await startServer(modelId, loadConstraints);
      console.log(response);
      
      let isReady = false;
      let crashError = null;
      let readyStatus = null;
      const isOpenVinoModel = modelInfo?.backendType === "openvino-npu";
      const maxStartupPolls = (isOpenVinoModel || isCoreMLModel) ? 1200 : 240;
      for (let i = 0; i < maxStartupPolls; i++) {
        if (cancelLoadRef.current) {
          crashError = "Model yükleme kullanıcı tarafından iptal edildi.";
          break;
        }
        const status = await getBackendStatus();
        if (status.loading) {
          setModelLoadProgress({
            progress: status.loading.progress || 0,
            phase: status.loading.phase || "Model yükleniyor...",
            speed: status.loading.speed || "",
            current: status.loading.current || 0,
            total: status.loading.total || 0,
            model: status.loading.model || modelId,
            backendMode: status.loading.backendMode || status.settings?.backendMode || "",
            backendBinary: status.loading.backendBinary || status.settings?.backendBinary || "",
            device: status.loading.device || status.settings?.backendDevice || "",
          });
        }
        if (status.ready) {
          isReady = true;
          readyStatus = status;
          break;
        }
        if (status.error) {
          crashError = status.error;
          break;
        }
        if (!status.running && !status.loading?.active && i > 3) {
          crashError = "Motor işlemi başlatılır başlatılmaz kapandı.";
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      if (isReady) {
        const loadedModelId = readyStatus?.settings?.backendType === "openvino-npu"
          ? (readyStatus.settings.model || readyStatus.loading?.model || modelId)
          : modelId;
        setModelLoadProgress((prev) => ({
          ...(prev || {}),
          progress: 100,
          phase: "Model hazır",
          speed: "",
          current: prev?.current || 0,
          total: prev?.total || 0,
          model: loadedModelId,
        }));
        setActiveModel(loadedModelId);
        setServerRunning(true);
      } else {
        throw new Error(crashError || `Model sunucusu şu bağlantı noktasında yanıt vermedi: ${backendPort}.`);
      }
    } catch (e) {
      console.error("Failed to load model:", e);
      if (e.message !== "Model yükleme kullanıcı tarafından iptal edildi.") {
        showAlert({ title: "Model Yüklenemedi", message: e.message || String(e), danger: true });
      }
    } finally {
      setTimeout(() => setModelLoadProgress(null), 800);
      setLoadingModelId(null);
    }
  };

  const handleUnloadThenLoad = async () => {
    const pendingLoad = pendingLoadModel;
    const nextModel = pendingLoad?.modelId;
    const targetType = pendingLoad?.targetType;
    setPendingLoadModel(null);
    await handleUnloadModel(pendingLoad?.activeRuntime);
    if (nextModel) {
      if (targetType === "image") {
        await checkVramAndLoad(nextModel, { skipActiveGuard: true });
      } else if (targetType === "text") {
        await loadTextModel(nextModel);
      } else if (targetType === "speech") {
        await loadSpeechModel(nextModel);
      } else if (targetType === "tts") {
        await loadTtsModel(nextModel);
      }
    }
  };

  const handleUnloadPendingOnly = async () => {
    const pendingLoad = pendingLoadModel;
    setPendingLoadModel(null);
    await handleUnloadModel(pendingLoad?.activeRuntime);
  };

  const handleUnloadModel = async (runtimeOverride = null) => {
    const runtime = runtimeOverride?.type ? runtimeOverride : getRuntimeForType(activeModelType);
    if (!runtime || isUnloading) return;

    if (runtime.type === "image") {
      if (isUnloading) return;
      setIsUnloading(true);
      setUnloadProgress({ progress: 10, phase: "Motor işlemi durduruluyor..." });

      const poll = setInterval(async () => {
        try {
          const status = await getBackendStatus();
          if (status.unloading?.active) {
            setUnloadProgress({
              progress: status.unloading.progress || 50,
              phase: status.unloading.phase || "Model bellekten çıkarılıyor...",
            });
          } else {
            setUnloadProgress((prev) => ({
              progress: Math.min(95, prev.progress + 10),
              phase: prev.phase || "Model bellekten çıkarılıyor...",
            }));
          }
        } catch (_) {}
      }, 300);

      try {
        await stopServer();
        setUnloadProgress({ progress: 100, phase: "Model bellekten çıkarıldı" });
        setActiveModel(null);
        setPendingLoadModel(null);
        setServerRunning(false);
      } catch (e) {
        console.error(e);
        showAlert({ title: "Bellekten Çıkarılamadı", message: e.message || String(e), danger: true });
      } finally {
        clearInterval(poll);
        setTimeout(() => {
          setIsUnloading(false);
          setUnloadProgress({ progress: 0, phase: "" });
        }, 500);
      }
    } else if (runtime.type === "text") {
      setIsUnloading(true);
      setUnloadProgress({ progress: 50, phase: "llama.cpp motor işlemi durduruluyor..." });
      try {
        await stopLlm();
        setActiveLlmModel(null);
        setLlmRunning(false);
      } catch (e) {
        showAlert({ title: "Bellekten Çıkarılamadı", message: e.message || String(e), danger: true });
      } finally {
        setIsUnloading(false);
        setUnloadProgress({ progress: 0, phase: "" });
      }
    } else if (runtime.type === "speech") {
      setIsUnloading(true);
      setUnloadProgress({ progress: 50, phase: "whisper.cpp konuşma motoru durduruluyor..." });
      try {
        await stopSpeech();
        setActiveSpeechModel(null);
        setSpeechRunning(false);
      } catch (e) {
        showAlert({ title: "Bellekten Çıkarılamadı", message: e.message || String(e), danger: true });
      } finally {
        setIsUnloading(false);
        setUnloadProgress({ progress: 0, phase: "" });
      }
    } else {
      setIsUnloading(true);
      setUnloadProgress({ progress: 50, phase: "Kokoro metinden sese motoru durduruluyor..." });
      try {
        await stopTts();
        setActiveTtsModel(null);
        setTtsRunning(false);
      } catch (e) {
        showAlert({ title: "Bellekten Çıkarılamadı", message: e.message || String(e), danger: true });
      } finally {
        setIsUnloading(false);
        setUnloadProgress({ progress: 0, phase: "" });
      }
    }
  };

  // Bilgisayarinizin ozelliklerine gore secilecek uyumlu modelleri yukle (aciklama icin)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getCompatibleModels();
      if (!cancelled && res.ok) {
        setCompatibleModels(res.models || []);
        setCompatibleTier(res.tier || "");
        setCompatibleVram(res.vram || 0);
        setCompatibleInfo(res);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDownloadDefaultModels = async () => {
    if (isDownloadingDefaults) return;
    const ok = await showConfirm({
      title: "Tüm Varsayılan Modelleri İndir",
      message: "Görsel üretimi, metin sohbeti, konuşma ve ses sentezi için gereken temel modeller sırayla indirilecek. Devam edilsin mi?",
      confirmLabel: "İndir",
      cancelLabel: "Vazgeç",
    });
    if (!ok) return;
    setIsDownloadingDefaults(true);
    try {
      const result = await downloadDefaultModels();
      if (!result || result.ok === false) {
        throw new Error(result?.error || "Varsayılan modeller indirilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.");
      }
      showAlert({
        title: "İndirme Başladı",
        message: "Temel modeller arka planda indiriliyor. İlerlemeyi yukarıdaki genel indirme çubuğundan takip edebilirsiniz.",
      });
      const poll = setInterval(async () => {
        try {
          const progress = await getDownloadProgress();
          if (!progress.active) {
            clearInterval(poll);
            setIsDownloadingDefaults(false);
            fetchModels();
          }
        } catch (_) {
          clearInterval(poll);
          setIsDownloadingDefaults(false);
        }
      }, 2000);
    } catch (err) {
      setIsDownloadingDefaults(false);
      showAlert({ title: "İndirme Başlatılamadı", message: err.message || String(err), danger: true });
    }
  };

  const handleDeleteModel = async (filename) => {
    if (await showConfirm({
      title: "Model Silinsin mi?",
      message: `"${filename}" modeller klasöründen silinsin mi?`,
      confirmLabel: "Sil",
      danger: true,
    })) {
      try {
        if (activeModelType === "image") {
          await deleteModel(filename);
          if (activeModel === filename) {
            await handleUnloadModel();
          }
        } else if (activeModelType === "text") {
          await deleteLlmModel(filename);
          if (activeLlmModel === filename) {
            await handleUnloadModel();
          }
        } else if (activeModelType === "speech") {
          await deleteSpeechModel(filename);
          if (activeSpeechModel === filename) {
            await handleUnloadModel();
          }
        } else {
          await deleteTtsModel(filename);
          if (activeTtsModel === filename) {
            await handleUnloadModel();
          }
        }
        await fetchModels();
      } catch (err) {
        console.error("Failed to delete model:", err);
        showAlert({ title: "Silinemedi", message: err.message || String(err), danger: true });
      }
    }
  };

  const executeImport = async (sourcePath, displayName) => {
    const controller = new AbortController();
    setImportAbortController(controller);
    setImportProgress(0);
    setImportInfo({
      filename: displayName,
      speed: "0.0",
      eta: 0,
      status: "Dosya kopyalama başlatılıyor..."
    });

    try {
      if (activeModelType === "image") {
        await importModelFile(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else if (activeModelType === "text") {
        await importLlmModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else if (activeModelType === "speech") {
        await importSpeechModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else {
        await importTtsModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      }

      await fetchModels();
    } catch (err) {
      console.error("Import failed:", err);
      if (err.name !== "AbortError") {
        showAlert({ title: "İçe Aktarılamadı", message: err.message || String(err), danger: true });
      }
    } finally {
      setImportProgress(null);
      setImportAbortController(null);
    }
  };

  const handleCancelImport = () => {
    if (importAbortController) {
      importAbortController.abort();
    }
  };

  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (file) {
      executeImport(file, file.name);
    }
    e.target.value = "";
  };

  const isUrlDownloading = Boolean(downloadingModelId);

  return (
    <div className="workspace-area">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Model Yöneticisi</h2>
        <p className="workspace-subtitle">
          Yerel dosyaları yönetin ve önerilen ağırlıkları doğrudan yerel modeller klasörünüze indirin.
        </p>
      </div>

      {/* Tab Selector for Image vs Text */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", borderBottom: "1px solid var(--border-color)", paddingBottom: "16px", marginBottom: "20px" }}>
        <button
          className={`m3-btn ${activeModelType === "image" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("image")}
          style={{ height: "40px", padding: "0 20px" }}
        >
          Görsel Modelleri (SD)
        </button>
        <button
          className={`m3-btn ${activeModelType === "text" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("text")}
          style={{ height: "40px", padding: "0 20px" }}
        >
          Metin Modelleri (GGUF)
        </button>
        <button
          className={`m3-btn ${activeModelType === "speech" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("speech")}
          style={{ height: "40px", padding: "0 20px" }}
        >
          Sesten Metne Modelleri
        </button>
        <button
          className={`m3-btn ${activeModelType === "tts" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("tts")}
          style={{ height: "40px", padding: "0 20px" }}
        >
          Metinden Sese Modelleri
        </button>
        <button
          className={`m3-btn ${activeModelType === "music" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("music")}
          style={{ height: "40px", padding: "0 20px" }}
        >
          Müzik ve Efekt Modelleri
        </button>
        <button
          className={`m3-btn ${activeModelType === "video" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("video")}
          style={{ height: "40px", padding: "0 20px" }}
        >
          Video Modelleri
        </button>
      </div>

      {/* Uyumlu Modelleri Indir (bilgisayara gore secilen modeller) */}
      <div style={{ marginBottom: "20px" }}>
        <button
          className="m3-btn m3-btn-filled"
          style={{ height: "40px", padding: "0 20px", display: "inline-flex", alignItems: "center", gap: "8px" }}
          disabled={isDownloadingDefaults}
          onClick={handleDownloadDefaultModels}
        >
          <DownloadCloud size={18} />
          {isDownloadingDefaults ? "Uyumlu Modeller İndiriliyor..." : "Uyumlu Modelleri İndir"}
        </button>
        <p style={{ fontSize: "0.82rem", marginTop: "6px", opacity: 0.85, overflowWrap: "anywhere" }}>
          {(() => {
            // Sunucu yaması uygulanmamışsa da tümleşik ekran kartının paylaşılan belleği VRAM sayılmaz
            const gpuAdi = compatibleInfo.gpuName || specs?.gpu_name || "";
            const tumlesik = compatibleInfo.gpuIntegrated ?? tumlesikGpuMu(gpuAdi);
            const vram = tumlesik ? 0 : compatibleVram;
            const ram = compatibleInfo.ram || specs?.ram_total_gb || 0;
            const seviye = compatibleInfo.gpuIntegrated === undefined && tumlesik ? getHardwareTier(specs).toLowerCase() : compatibleTier;
            const gpuMetni = tumlesik
              ? `${gpuAdi} (tümleşik ekran kartı; ayrı ekran belleği yok, paylaşılan bellek VRAM sayılmaz)`
              : vram > 0 ? `${vram} GB ayrı ekran belleği${gpuAdi ? ` (${gpuAdi})` : ""}` : "ayrı ekran kartı bulunamadı";
            return `Bu bilgisayarın özelliklerine (${gpuMetni}, RAM: ${Math.round(ram)} GB, seviye: ${SEVIYE_ADI[seviye] || seviye || "-"}) göre en uygun modelleri otomatik olarak indirir. Her alandan yalnızca bir model seçilir.`;
          })()}
        </p>
        {compatibleModels.length > 0 && (
          <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {compatibleModels.map((m, i) => (
              <div key={i} style={{ fontSize: "0.8rem", padding: "8px 10px", background: "var(--md-sys-color-surface-container-high)", borderRadius: "8px", borderLeft: "3px solid #10b981" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ background: "#10b981", color: "#fff", fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: "999px" }}>Uyumlu</span>
                  <strong>{m.name}</strong> <span style={{ opacity: 0.7 }}>({({ image: "görsel", text: "metin", speech: "konuşma", tts: "metinden sese", music: "müzik", video: "video" })[m.kind] || m.kind})</span>
                </div>
                <div style={{ opacity: 0.8, marginTop: "4px" }}>{m.reason}</div>
                <div style={{ marginTop: "4px", fontSize: "0.75rem", fontWeight: 600, color: downloadingModelId && m.filename && downloadingModelId.indexOf(m.filename) !== -1 ? "var(--md-sys-color-primary)" : (m.installed ? "#10b981" : "#f59e0b") }}>
                  {downloadingModelId && m.filename && downloadingModelId.indexOf(m.filename) !== -1
                    ? "İndiriliyor..."
                    : m.installed
                      ? (m.url ? "İndirildi" : "Kurulu")
                      : m.url
                        ? "Bekliyor (Uyumlu Modelleri İndir ile alınır)"
                        : (m.kurulumNotu || "Ayrı kurulum gerekir")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>




      {/* Active Model Status Tonal Box */}
      {activeModelType === "image" && activeModel && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontWeight: 700 }}>Etkin Model: {activeModel}</h4>
              <p style={{ fontSize: "0.85rem", marginTop: "2px", opacity: 0.9 }}>
                Yerel C++ stable-diffusion sunucusu çalışıyor. Anlık performans verileri üst çubukta gösteriliyor.
              </p>
              {(backendInfo.backendMode || backendInfo.backendDevice || backendInfo.backendBinary) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                  {backendInfo.backendMode && (
                    <span className="status-chip" style={{ cursor: "default" }}>
                      <HardDrive size={14} />
                      <span>Yüklü: {backendInfo.backendMode}</span>
                    </span>
                  )}
                  {backendInfo.backendDevice && (
                    <span className="status-chip" style={{ cursor: "default" }}>
                      <span>{backendInfo.backendDevice}</span>
                    </span>
                  )}
                  {backendInfo.backendBinary && (
                    <span className="status-chip" style={{ cursor: "default" }}>
                      <span>{backendInfo.backendBinary}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModelType === "text" && activeLlmModel && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontWeight: 700 }}>Etkin Metin Modeli: {activeLlmModel}</h4>
              <p style={{ fontSize: "0.85rem", marginTop: "2px", opacity: 0.9 }}>
                Yerel C++ llama.cpp sunucusu çalışıyor. Sohbet istekleri Metin Sohbeti ekranından gönderilebilir.
              </p>
              {backendInfo.llmBackendMode && (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <span className="status-chip" style={{ cursor: "default", background: "rgba(255,255,255,0.15)", color: "inherit", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <span>{backendInfo.llmBackendMode}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModelType === "speech" && activeSpeechModel && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontWeight: 700 }}>Etkin Sesten Metne Modeli: {localModels.find((m) => m.filename === activeSpeechModel)?.name || activeSpeechModel}</h4>
              <p style={{ fontSize: "0.85rem", marginTop: "2px", opacity: 0.9 }}>
                Sesli sohbet ve Sesten Metne sayfası bu modeli kullanır. Başka bir model yüklediğinizde her yerde o kullanılır.
              </p>
              {backendInfo.speechBackendMode && (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <span className="status-chip" style={{ cursor: "default", background: "rgba(255,255,255,0.15)", color: "inherit", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <span>{backendInfo.speechBackendMode}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModelType === "tts" && activeTtsModel && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontWeight: 700 }}>Etkin Metinden Sese Modeli: {localModels.find((m) => m.filename === activeTtsModel)?.name || activeTtsModel}</h4>
              <p style={{ fontSize: "0.85rem", marginTop: "2px", opacity: 0.9 }}>
                Vega'nın sesli yanıtları ve Metinden Sese sayfası bu sesi kullanır. Başka bir ses yüklediğinizde her yerde o kullanılır.
              </p>
              {backendInfo.ttsBackendMode && (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <span className="status-chip" style={{ cursor: "default", background: "rgba(255,255,255,0.15)", color: "inherit", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <span>{backendInfo.ttsBackendMode}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Loading Progress Bar */}
      {modelLoadProgress && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", marginTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ fontWeight: 600 }}>Ağırlıklar Yükleniyor: {modelLoadProgress.model}</h4>
            <button className="m3-btn m3-btn-error" style={{ height: "34px", padding: "0 14px" }} onClick={handleCancelLoad}>
              <Square size={14} />
              <span>Yüklemeyi İptal Et</span>
            </button>
          </div>
          <div className="model-progress-section" style={{ margin: "12px 0 6px 0" }}>
            <div className="model-progress-label">
              <span>
                {modelLoadProgress.phase}
                {modelLoadProgress.speed ? ` (${modelLoadProgress.speed})` : ""}
              </span>
              <span>
                {modelLoadProgress.total > 0
                  ? `Yüklenen: ${modelLoadProgress.current} / ${modelLoadProgress.total} tensors`
                  : `${Math.round(modelLoadProgress.progress)}%`}
              </span>
            </div>
            <div className="model-progress-bar">
              <div className="model-progress-fill" style={{ width: `${Math.min(100, Math.max(0, modelLoadProgress.progress))}%`, transition: "width 0.2s ease" }}></div>
            </div>
            {(modelLoadProgress.backendMode || modelLoadProgress.device) && (
              <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", marginTop: "6px", lineHeight: "1.4" }}>
                <div>
                  Başlatılıyor: {modelLoadProgress.backendMode || "backend"}
                  {modelLoadProgress.device ? `  ${modelLoadProgress.device}` : ""}
                </div>
                {(modelLoadProgress.backendMode === "Apple NPU" || modelLoadProgress.backendMode === "Apple Neural Engine (NPU)") && (
                  <div style={{ color: "var(--md-sys-color-primary)", marginTop: "4px", fontWeight: "500" }}>
                     Not: Bu model ilk kez yüklenirken Apple Neural Engine (NPU) üzerinde derleme 3-4 dakika sürebilir. Sonraki yüklemeler neredeyse anında olur.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unloading Progress Bar */}
      {isUnloading && activeModelType === "image" && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-error)", marginTop: "24px" }}>
          <h4 style={{ fontWeight: 600 }}>{unloadProgress.phase || "Etkin model bellekten çıkarılıyor..."}</h4>
          <div className="model-progress-section" style={{ margin: "12px 0 0 0" }}>
            <div className="model-progress-bar">
              <div className="model-progress-fill" style={{ width: `${unloadProgress.progress}%`, background: "var(--md-sys-color-error)", transition: "width 0.15s ease" }}></div>
            </div>
          </div>
        </div>
      )}

      {studyoSekmesi ? (
        <StudyoModelSekmesi
          tur={activeModelType}
          aktif={activeTab === "models"}
          specs={specs}
          showAlert={showAlert}
          showConfirm={showConfirm}
        />
      ) : (<>
      {/* Detected Local Models Section */}
      <div className="m3-card" style={{ marginTop: "24px" }}>
        <h3 className="m3-card-title">
          <Database size={18} style={{ color: "var(--md-sys-color-primary)" }} />
          Yerel {activeModelType === "image" ? "Görsel" : activeModelType === "text" ? "Metin" : activeModelType === "speech" ? "Konuşma" : "Metinden sese"} Modelleri ({displayedLocalModels.length})
        </h3>
        
        {isLoadingModels ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", padding: "24px 0", color: "var(--md-sys-color-outline)" }}>
            <RefreshCw className="progress-spinner" size={16} />
            <span style={{ fontSize: "0.9rem" }}>Modeller klasörü taranıyor...</span>
          </div>
        ) : displayedLocalModels.length === 0 ? (
          <p style={{ fontSize: "0.9rem", color: "var(--md-sys-color-outline)", textAlign: "center", padding: "16px 0" }}>
            {activeModelType === "image"
              ? "app/models/ içinde görsel modeli bulunamadı. Aşağıdaki kütüphaneden indirin veya bir dosya içe aktarın."
              : activeModelType === "text"
              ? "app/llm-models/ içinde metin modeli bulunamadı. Aşağıdaki kütüphaneden indirin veya bir dosya içe aktarın."
              : activeModelType === "speech"
              ? "app/speech-models/ içinde sesten metne modeli bulunamadı. Aşağıdaki kütüphaneden indirin veya bir .bin dosyası içe aktarın."
              : "app/tts-models/ içinde metinden sese modeli bulunamadı. Aşağıdaki kütüphaneden Kokoro'yu kurun veya bir .json manifest dosyası içe aktarın."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {displayedLocalModels.map((model) => {
              const filename = model.filename;
              const isActive = activeModelType === "image" ? activeModel === filename : activeModelType === "text" ? activeLlmModel === filename : activeModelType === "speech" ? activeSpeechModel === filename : activeTtsModel === filename;
              
              return (
                <div 
                  key={filename} 
                  style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    alignItems: "center", 
                    padding: "12px 16px", 
                    background: isActive ? "var(--md-sys-color-primary-container)" : "var(--md-sys-color-surface-variant)",
                    color: isActive ? "var(--md-sys-color-on-primary-container)" : "var(--md-sys-color-on-surface-variant)",
                    borderRadius: "var(--md-shape-corner-medium)",
                    border: "1px solid var(--md-sys-color-outline-variant)"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      {(activeModelType === "speech" || activeModelType === "tts") && model.name ? model.name : filename}
                      {isActive && (
                        <span className="status-chip" style={{ padding: "2px 8px", fontSize: "0.7rem", fontWeight: 700, background: "var(--md-sys-color-primary)", color: "var(--md-sys-color-on-primary)", border: "none" }}>Etkin</span>
                      )}
                      {activeModelType === "image" && model.detected && (
                        <span className="status-chip" style={{ padding: "2px 8px", fontSize: "0.7rem" }} title={model.detected.source === "dosya-icerigi" ? "Dosyanın içinden tanındı" : "Dosya adından tahmin edildi"}>
                          {model.detected.familyLabel}{model.detected.distilled ? " " + model.detected.distilled.charAt(0).toUpperCase() + model.detected.distilled.slice(1) : ""}
                        </span>
                      )}
                      {activeModelType === "image" && model.detected?.uncensored && (
                        <span className="status-chip chip-uyari" style={{ padding: "2px 8px", fontSize: "0.7rem" }}>Sansürsüz</span>
                      )}
                    </span>
                    <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>
                      {activeModelType === "image"
                        ? (model.backendType === "openvino-npu" ? "OpenVINO NPU Modeli" : model.format || "Yerel Ağırlık Dosyası")
                        : activeModelType === "text"
                        ? "llama.cpp GGUF Modeli"
                        : activeModelType === "speech"
                        ? `${model.paket ? (model.engine === "seda" ? "Seda" : model.engine === "duyu" ? "Duyu" : "Türkçe") : "Whisper"} · ${model.language || "Çok dilli"}`
                        : (model.motor ? model.format : "Kokoro ONNX Modeli")
                      }  {model.size || formatBytes(model.sizeBytes)}
                    </span>
                  </div>
                  
                  <div style={{ display: "flex", gap: "8px" }}>
                    {isActive ? (
                      <button className="m3-btn m3-btn-error" style={{ height: "36px", padding: "0 16px" }} onClick={() => handleUnloadModel()} disabled={isUnloading}>
                        {isUnloading ? <RefreshCw className="progress-spinner" size={14} /> : <Trash2 size={14} />}
                        <span>{isUnloading ? "Çıkarılıyor" : "Bellekten çıkar"}</span>
                      </button>
                    ) : (
                      <>
                        <button 
                          className="m3-btn m3-btn-filled" 
                          style={{ height: "36px", padding: "0 16px" }} 
                          onClick={() => handleLoadModel(filename)}
                          disabled={isBusy}
                        >
                          {loadingModelId === filename ? (
                            <RefreshCw className="progress-spinner" size={14} />
                          ) : (
                            <Database size={14} />
                          )}
                          <span>{loadingModelId === filename ? "Yükleniyor" : "Yükle"}</span>
                        </button>
                        {!model.motor && (
                        <button
                          className="m3-btn m3-btn-error"
                          style={{ height: "36px", width: "36px", padding: 0, minWidth: "36px" }}
                          onClick={() => handleDeleteModel(filename)}
                          disabled={isBusy}
                          title="Modeller klasöründen sil"
                        >
                          <Trash2 size={14} />
                        </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="workspace-title-section" style={{ marginTop: "32px", marginBottom: "16px" }}>
        <h3 className="m3-card-title">
          <Library size={20} style={{ color: "var(--md-sys-color-primary)" }} />
          {activeModelType === "text" ? "Hugging Face Model Kütüphanesi" : activeModelType === "speech" ? "Sesten Metne Model Kütüphanesi" : activeModelType === "tts" ? "Metinden Sese Model Kütüphanesi" : "Model Kütüphanesi"}
        </h3>
      </div>
      {(<ModelArama tur={activeModelType === "music" ? "muzik" : activeModelType} showAlert={showAlert} showConfirm={showConfirm} onInstalled={() => fetchModels()} />)}

      {activeModelType === "text" && ESKI_HF_ARAMA && (
        <div className="model-discovery-controls">
          <div className="model-search-box">
            <Search size={18} />
            <input
              type="search"
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              placeholder="Hugging Face'te GGUF modeli ara..."
              aria-label="Hugging Face modellerinde ara"
            />
            {modelSearch && (
              <button type="button" onClick={() => setModelSearch("")} title="Aramayı temizle" aria-label="Model aramasını temizle">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="model-filter-row" aria-label="Model filtreleri">
            {MODEL_FILTERS.map((filter) => {
              const selected = selectedFilters.includes(filter.id);
              return (
                <button
                  key={filter.id}
                  type="button"
                  className={`model-filter-chip ${selected ? "selected" : ""}`}
                  onClick={() => toggleModelFilter(filter.id)}
                  aria-pressed={selected}
                >
                  {filter.label}
                  {selected && <X size={14} />}
                </button>
              );
            })}
            {selectedFilters.length > 0 && (
              <button type="button" className="model-filter-clear" onClick={() => setSelectedFilters([])}>
                Filtreleri temizle
              </button>
            )}
          </div>
          {isSearchingModels && (
            <div className="model-discovery-loading">
              <RefreshCw className="progress-spinner" size={16} />
              <span>Hugging Face'ten modeller yükleniyor...</span>
            </div>
          )}
          {modelSearchError && (
            <div className="model-search-warning">
              {modelSearchError} Yerleşik yedek katalog gösteriliyor.
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {activeModelType === "text" && hasHuggingFaceResults && !isSearchingModels && displayedHuggingFaceModels.length === 0 && (
          <div className="m3-card model-search-empty">
            Bu arama ve filtre birleşimiyle eşleşen, indirilebilir tek dosyalık GGUF modeli bulunamadı.
          </div>
        )}
        {visibleModelLibrary.filter((section) => section.items.length > 0).map((section) => (
          <div key={section.group} className="m3-card" style={{ margin: 0 }}>
            <h4 style={{ fontWeight: 700, marginBottom: "12px" }}>{section.group}</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "12px" }}>
              {section.items.map((model) => {
                const hasMainModel = modelNames.includes(model.filename);
                const hasProjector = !model.projectorFilename || allModelNames.includes(model.projectorFilename);
                const needsProjector = Boolean(hasMainModel && model.projectorFilename && !hasProjector);
                const installed = hasMainModel && hasProjector;
                const downloading = downloadingModelId === model.filename || downloadingModelId === model.projectorFilename || downloadingModelId === `${model.filename}.zip`;
                const systemTier = getHardwareTier(specs);
                const isCompatible = compatibleModels.some((c) => c.filename && model.filename && c.filename === model.filename);
                const ramYeterli = !model.minRamGb || (Number(specs?.ram_total_gb) || 0) >= model.minRamGb * 0.9;
                const donanimNotu = kutuphaneDonanimNotu(model, activeModelType, specs);
                const isRecommended = donanimNotu?.uygunluk !== "onerilmez" && (typeof model.recommendedFit === "boolean"
                  ? model.recommendedFit
                  : model.recommendedTiers && model.recommendedTiers.includes(systemTier) && ramYeterli);
                const fitLabel = model.fitLabel || "Önerilen";
                return (
                  <div key={`${model.id || section.group}:${model.filename}`} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", minWidth: 0, overflowWrap: "anywhere", background: "var(--md-sys-color-surface-variant)", border: "1px solid var(--md-sys-color-outline-variant)", borderRadius: "var(--md-shape-corner-medium)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        {model.name}
                        {isCompatible && (
                          <span title="Bilgisayarınıza uygun model (Uyumlu Modelleri İndir ile alınır)" style={{
                            fontSize: "0.68rem",
                            color: "#fff",
                            background: "#10b981",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontWeight: "bold"
                          }}>Uyumlu</span>
                        )}
                        {isRecommended && (
                          <span title={model.fitReason || `Önerilen: ${({ low: "düşük", mid: "orta", high: "yüksek" })[systemTier] || systemTier} seviye donanım`} style={{
                            fontSize: "0.68rem", 
                            color: "#2e7d32", 
                            background: "#e8f5e9", 
                            padding: "2px 6px", 
                            borderRadius: "4px", 
                            fontWeight: "bold",
                            border: "1px solid #c8e6c9" 
                          }}>
                            [{fitLabel}]
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>
                        {model.format} {model.resolution && model.resolution !== "N/A" && ` ${model.resolution}`}
                      </span>
                      {model.size && model.size !== "Unknown" && model.size !== "Bilinmiyor" ? (
                        <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-on-surface-variant)", fontWeight: 600 }}>
                          Dosya boyutu: {model.size}
                        </span>
                      ) : model.approxSize ? (
                        <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-on-surface-variant)", fontWeight: 600 }}>
                          Dosya boyutu: yaklaşık {model.approxSize}
                        </span>
                      ) : null}
                    </div>
                    <p style={{ fontSize: "0.78rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.35, margin: 0 }}>
                      {model.notes}
                    </p>
                    <BuBilgisayardaSatiri not={donanimNotu} />
                    {downloading && (
                      <div className="model-progress-section" style={{ marginTop: "2px" }}>
                        <div className="model-progress-label">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                            <span className="loading-dot"></span>
                            İndiriliyor
                          </span>
                          <span>{downloadProgress > 0 ? `${downloadProgress}%` : "Hazırlanıyor"}</span>
                        </div>
                        <div className="model-progress-bar">
                          <div className="model-progress-fill" style={{ width: `${Math.min(100, Math.max(0, downloadProgress))}%`, transition: "width 0.2s ease" }}></div>
                        </div>
                        {downloadSpeed && (
                          <div style={{ fontSize: "0.7rem", color: "var(--md-sys-color-outline)", marginTop: "4px" }}>
                            {downloadSpeed}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      className={installed ? "m3-btn m3-btn-tonal" : "m3-btn m3-btn-filled"}
                      style={{ height: "36px", marginTop: "auto" }}
                      onClick={() => handleLibraryDownload(model)}
                      disabled={installed || downloadingModelId === model.id}
                    >
                      {installed ? <HardDrive size={14} /> : downloading ? <RefreshCw className="progress-spinner" size={14} /> : <DownloadCloud size={14} />}
                      <span>{installed ? "İndirildi" : downloading ? "İndiriliyor" : needsProjector ? "Projektörü İndir" : "İndir"}</span>
                    </button>
                    <a
                      href={model.pageUrl || model.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        alignSelf: "center",
                        color: "var(--md-sys-color-primary)",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        lineHeight: 1.2,
                        textDecoration: "none",
                      }}
                    >
                      {model.pageUrl ? "Hugging Face'te Görüntüle" : "İndirilenler Klasörüne Kaydet"}
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {activeModelType === "text" && hasHuggingFaceResults && hasMoreModels && !isSearchingModels && (
          <button
            type="button"
            className="m3-btn m3-btn-tonal model-load-more"
            onClick={handleLoadMoreModels}
            disabled={isLoadingMoreModels}
          >
            {isLoadingMoreModels && <RefreshCw className="progress-spinner" size={16} />}
            <span>{isLoadingMoreModels ? "Daha fazla model yükleniyor..." : "Daha Fazla Yükle"}</span>
          </button>
        )}
      </div>

      {/* Local Drag and Drop Importer */}
      <div className="workspace-title-section" style={{ marginTop: "32px", marginBottom: "16px" }}>
        <h3 className="m3-card-title">
          <FolderOpen size={20} style={{ color: "var(--md-sys-color-primary)" }} />
          Yerel Model İçe Aktarma
        </h3>
      </div>
      {/* Importing Progress Bar */}
      {importProgress !== null && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", marginTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
            <h4 style={{ fontWeight: 600 }}>Model yerel klasöre kopyalanıyor: {importInfo.filename}</h4>
            <button className="m3-btn m3-btn-error" style={{ height: "34px", padding: "0 14px" }} onClick={handleCancelImport}>
              <Square size={14} />
              <span>İçe Aktarmayı Durdur</span>
            </button>
          </div>
          <div className="model-progress-section" style={{ margin: "12px 0 6px 0" }}>
            <div className="model-progress-label">
              <span>{importInfo.status} ({importInfo.speed} MB/sn)</span>
              <span>{importProgress}% ({importInfo.eta}sn kaldı)</span>
            </div>
            <div className="model-progress-bar">
              <div className="model-progress-fill" style={{ width: `${importProgress}%`, transition: "width 0.15s ease" }}></div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px", marginTop: "16px" }}>
        <label className="import-box" style={{ margin: 0, height: "100%", justifyContent: "center" }}>
          <input
            type="file"
            style={{ display: "none" }}
            accept={activeModelType === "image" ? ".safetensors,.ckpt" : activeModelType === "text" ? ".gguf" : activeModelType === "speech" ? ".bin" : ".json"}
            onChange={handleImportFile}
            disabled={importProgress !== null}
          />
          <FolderOpen className="import-icon" />
          <span style={{ fontWeight: 600 }}>Ağırlık dosyası seçin</span>
          <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", textAlign: "center" }}>
            Seçilecek dosya: {activeModelType === "image" ? "`.safetensors` veya `.ckpt` ağırlık dosyası." : activeModelType === "text" ? "`.gguf` ağırlık dosyası." : activeModelType === "speech" ? "`whisper.cpp .bin` ağırlık dosyası." : "`Kokoro .json` manifest dosyası."}
          </span>
        </label>

        <div className="m3-card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", margin: 0, padding: "20px" }}>
          <h4 style={{ fontWeight: 600, marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <DownloadCloud size={16} />
            URL'den Model İndir
          </h4>
          <p style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", marginBottom: "12px" }}>
            Hugging Face'ten herhangi bir {activeModelType === "image" ? "Safetensors" : activeModelType === "text" ? "GGUF" : activeModelType === "speech" ? "Whisper .bin" : "Kokoro manifest"} modelini doğrudan modeller klasörünüze indirin.
          </p>
          {isUrlDownloading ? (
            <div className="model-progress-section" style={{ marginTop: "0px" }}>
              <div className="model-progress-label">
                <span style={{ fontSize: "0.75rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px" }} title={downloadingModelId}>
                  {downloadingModelId}
                </span>
                <span>{downloadProgress}%</span>
              </div>
              <div className="model-progress-bar" style={{ margin: "4px 0" }}>
                <div className="model-progress-fill" style={{ width: `${downloadProgress}%`, transition: "width 0.15s ease" }}></div>
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--md-sys-color-outline)", marginTop: "2px" }}>
                {downloadSpeed}
              </div>
              <button className="m3-btn m3-btn-error" style={{ height: "34px", padding: "0 14px", marginTop: "10px" }} onClick={handleCancelDownload}>
                <Square size={14} />
                <span>İndirmeyi Durdur</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleUrlDownloadSubmit} style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                className="m3-input"
                style={{ flex: 1, height: "40px" }}
                placeholder="ör. https://huggingface.co/..."
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                disabled={downloadingModelId !== null}
              />
              <button 
                type="submit" 
                className="m3-btn m3-btn-filled" 
                style={{ height: "40px" }}
                disabled={downloadingModelId !== null}
              >
                İndir
              </button>
            </form>
          )}
        </div>
      </div>

      </>)}

      {pendingLoadModel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div className="m3-card" style={{ maxWidth: "460px", width: "100%", margin: 0, border: "1px solid var(--md-sys-color-outline-variant)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <AlertTriangle size={22} style={{ color: "var(--md-sys-color-error)" }} />
              <h3 style={{ fontSize: "1.05rem", fontWeight: 700 }}>Model Zaten Etkin</h3>
            </div>
            <p style={{ fontSize: "0.9rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.45, marginBottom: "16px" }}>
              "{pendingLoadModel.activeRuntime?.model}" şu anda {pendingLoadModel.activeRuntime?.label || "model"} modeli olarak yüklü. Önce onu bellekten çıkarın, ardından "{pendingLoadModel.modelId}" modelini şu türde yükleyin: {getModelTypeLabel(pendingLoadModel.targetType)} model.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button className="m3-btn m3-btn-outlined" onClick={() => setPendingLoadModel(null)} disabled={isUnloading}>
                Vazgeç
              </button>
              <button className="m3-btn m3-btn-error" onClick={handleUnloadPendingOnly} disabled={isUnloading}>
                <Trash2 size={14} />
                <span>Bellekten Çıkar</span>
              </button>
              <button className="m3-btn m3-btn-filled" onClick={handleUnloadThenLoad} disabled={isUnloading}>
                {isUnloading ? <RefreshCw className="progress-spinner" size={14} /> : <RefreshCw size={14} />}
                <span>Çıkar ve Yükle</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {vramWarning && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div className="m3-card" style={{ maxWidth: "480px", width: "100%", margin: 0, padding: "24px", border: "1px solid var(--md-sys-color-error)", boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)", background: "var(--md-sys-color-surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <AlertTriangle size={28} style={{ color: "var(--md-sys-color-error)" }} />
              <h3 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0, color: "var(--md-sys-color-on-surface)" }}>VRAM Sınırı Aşıldı</h3>
            </div>
            <p style={{ fontSize: "0.92rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.5, marginBottom: "20px", margin: 0 }}>
              Model <strong style={{ color: "var(--md-sys-color-on-surface)" }}>{vramWarning.modelId}</strong> boyutu yaklaşık <strong>{vramWarning.modelSizeGb.toFixed(1)} GB</strong>, yani şu anda kullanılabilir GPU VRAM miktarından büyük: <strong>{vramWarning.freeVramGb.toFixed(1)} GB boş</strong> (toplam {vramWarning.totalVramGb.toFixed(1)} GB).
              <br /><br />
              Bu modeli GPU'ya yüklemek başarısız olabilir, motorun çökmesine yol açabilir ya da bellek taşması nedeniyle üretimi aşırı yavaşlatabilir.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" }}>
              <button 
                className="m3-btn m3-btn-outlined" 
                onClick={() => setVramWarning(null)}
              >
                Vazgeç
              </button>
              <button 
                className="m3-btn m3-btn-tonal"
                style={{ borderColor: "var(--md-sys-color-primary)", color: "var(--md-sys-color-primary)" }}
                onClick={async () => {
                  const targetModel = vramWarning.modelId;
                  setVramWarning(null);
                  if (setConstraints) {
                    setConstraints((prev) => ({
                      ...prev,
                      backendType: "cpu",
                      useGpu: false,
                    }));
                  }
                  const cpuConstraints = {
                    ...constraints,
                    backendType: "cpu",
                    useGpu: false,
                  };
                  await performLoadModel(targetModel, cpuConstraints);
                }}
              >
                CPU'da Yükle
              </button>
              <button 
                className="m3-btn m3-btn-error" 
                onClick={async () => {
                  const targetModel = vramWarning.modelId;
                  setVramWarning(null);
                  await performLoadModel(targetModel);
                }}
              >
                Yine de devam et (GPU)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ModelManager);

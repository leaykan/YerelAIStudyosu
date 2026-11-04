import React, { memo, useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Sparkles, Download, Copy, Check, Trash2, ImagePlus, Maximize2, Ban, X } from "lucide-react";
import {
  generateImage,
  startServer,
  stopServer,
  waitForServerReady,
  getBackendStatus,
  getGenerationProgress,
  setGenerationPlan,
  saveGeneratedOutput,
  deleteGeneratedOutputs,
  listLocalModels,
  upscaleOutput,
  getJobQueueStatus,
} from "../services/api";
import {
  profilOlustur, yuvarla, negatifEtkisiMi, adimAsamasi, adimAsamaAnahtari,
  hizKaydet, hizCoz, sureTahmini, sureYaz,
} from "../modelProfilleri";
import { ModelKarti, BoyutKarti, KaliteKarti, YuksekCozunurlukKarti, BellekKarti } from "./GorselAyarKartlari";

const GalleryItem = memo(({ img, idx, isSelected, onClick }) => {
  const handleClick = (e) => {
    onClick(idx, e);
  };
  return (
    <div
      className={`gallery-item ${isSelected ? "selected" : ""}`}
      onClick={handleClick}
      title={`Prompt: ${img.prompt || ""}\nSeed: ${img.seed ?? "-"}${img.duration_sec ? `\nSüre: ${Number(img.duration_sec).toFixed(1)} sn` : ""}`}
    >
      <img src={img.url} className="gallery-thumb" alt="Küçük resim" loading="lazy" decoding="async" />
      {isSelected && (
        <div className="gallery-select-badge">
          <Check size={14} />
        </div>
      )}
    </div>
  );
});

// Üretim sırasında adımları gösteren şerit: her adım bir kutu, renk aşamayı gösterir.
function AdimSeridi({ adim, toplam }) {
  if (!toplam || toplam > 80) return null;
  const kutular = [];
  for (let i = 1; i <= toplam; i++) {
    const durum = i < adim ? "bitti" : i === adim ? "simdi" : "bekliyor";
    kutular.push(<span key={i} className={`adim-kutu asama-${adimAsamaAnahtari(i, toplam)} ${durum}`} />);
  }
  return (
    <div className="adim-seridi-kapsayici">
      <div className="adim-seridi">{kutular}</div>
      <div className="adim-seridi-etiketler">
        <span className="asama-kompozisyon-yazi">Yerleşim</span>
        <span className="asama-sekil-yazi">Şekiller</span>
        <span className="asama-detay-yazi">Detay</span>
      </div>
    </div>
  );
}

function Generator({
  prompt,
  setPrompt,
  negativePrompt,
  setNegativePrompt,
  constraints,
  setConstraints,
  activeModel,
  generatedImages,
  setGeneratedImages,
  isGenerating,
  setIsGenerating,
  generationProgress,
  setGenerationProgress,
  setActiveTab,
  showAlert = async ({ message }) => window.alert(message),
  showConfirm = async ({ message }) => window.confirm(message),
  specs,
  setActiveModel,
  modelBilgisi,
  setModelBilgisi,
  backendOptions,
  setBackendOptions,
  serverRunning,
  setServerRunning,
}) {
  const [outputImage, setOutputImage] = useState(null);
  const [outputSeed, setOutputSeed] = useState(null);
  const [genDuration, setGenDuration] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedLeftTime, setEstimatedLeftTime] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [toplamAdim, setToplamAdim] = useState(0);
  const [adimSuresi, setAdimSuresi] = useState(null);
  const [ikinciGecis, setIkinciGecis] = useState(false);
  const [isCpuFallback, setIsCpuFallback] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaleInfo, setUpscaleInfo] = useState("");
  const [hires, setHires] = useState({
    enabled: false,
    scale: 2,
    upscaler: "RealESRGAN_x4plus_anime_6B",
    denoise: 0.5,
    steps: 0,
  });
  const [isRestartingBackend, setIsRestartingBackend] = useState(false);
  const [restartLoadProgress, setRestartLoadProgress] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [selectedGalleryIndexes, setSelectedGalleryIndexes] = useState([]);
  const [baseImage, setBaseImage] = useState(null);
  const [modeller, setModeller] = useState([]);
  const [yukluModel, setYukluModel] = useState(null);
  const [kuyrukDurumu, setKuyrukDurumu] = useState(null);
  const timerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const hasRealGenerationStepRef = useRef(false);

  const profil = useMemo(() => (modelBilgisi ? profilOlustur(modelBilgisi) : null), [modelBilgisi]);
  const npuModu = constraints.backendType === "apple-npu" || constraints.backendType === "openvino-npu";

  // Model listesi
  const modelleriYenile = useCallback(async () => {
    try {
      const liste = await listLocalModels();
      setModeller(liste.filter((m) => m.filename));
    } catch (_) {}
  }, []);

  useEffect(() => {
    modelleriYenile();
    const odak = () => modelleriYenile();
    window.addEventListener("focus", odak);
    return () => window.removeEventListener("focus", odak);
  }, [modelleriYenile]);

  useEffect(() => {
    if (activeModel && !modeller.some((m) => m.filename === activeModel)) modelleriYenile();
  }, [activeModel, modeller, modelleriYenile]);

  // Hangi model bellekte? (Yüklü / yüklenecek bilgisini göstermek için)
  const yukluModeliOku = useCallback(async () => {
    try {
      const status = await getBackendStatus();
      const ad = status?.ready && status?.settings?.model ? status.settings.model.split(/[\\/]/).pop() : null;
      setYukluModel(ad);
    } catch (_) {}
    setKuyrukDurumu(await getJobQueueStatus());
  }, []);

  useEffect(() => {
    yukluModeliOku();
    if (isGenerating) return undefined;
    const id = setInterval(yukluModeliOku, 5000);
    return () => clearInterval(id);
  }, [yukluModeliOku, isGenerating, activeModel]);

  useEffect(() => {
    if (npuModu) setBaseImage(null);
  }, [npuModu]);

  const handleBaseImageSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMsg("Lütfen bir görsel dosyası seçin (PNG, JPG veya WEBP).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBaseImage(reader.result);
    reader.onerror = () => setErrorMsg("Seçilen görsel dosyası okunamadı.");
    reader.readAsDataURL(file);
  };

  const handleClearBaseImage = () => setBaseImage(null);

  const negatifDurum = negatifEtkisiMi(profil, constraints.cfgScale);

  // Üretimden önce tahmini süre (Görsel Üret düğmesinde gösterilir)
  const uretimTahmini = useMemo(() => {
    if (!activeModel) return null;
    const t = sureTahmini(activeModel, constraints.width, constraints.height, constraints.steps);
    if (!t) return null;
    let toplam = t.toplam;
    if (hires.enabled) {
      const hw = Math.round((constraints.width * hires.scale) / 8) * 8;
      const hh = Math.round((constraints.height * hires.scale) / 8) * 8;
      const ikinci = sureTahmini(activeModel, hw, hh, hires.steps || Math.max(1, Math.round(constraints.steps / 2)));
      if (ikinci) toplam += ikinci.toplam;
    }
    return toplam;
  }, [activeModel, constraints.width, constraints.height, constraints.steps, hires]);

  // Görsel üretimini başlat
  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    // Boyutu modelin kurallarına yuvarla (elle girilmiş değerler için)
    const genislik = profil ? yuvarla(profil, constraints.width) : constraints.width;
    const yukseklik = profil ? yuvarla(profil, constraints.height) : constraints.height;
    const ayarlar = { ...constraints, width: genislik, height: yukseklik };
    if (genislik !== constraints.width || yukseklik !== constraints.height) {
      setConstraints((prev) => ({ ...prev, width: genislik, height: yukseklik }));
    }

    setErrorMsg(null);
    setIsRestartingBackend(true);
    setRestartLoadProgress(null);

    // Motorun yeniden başlatılması yalnızca modeli belleğe yükleyen ayarlar
    // değiştiğinde gerekir. Adım, CFG, örnekleyici, boyut ve seed her istekte
    // ayrıca gönderilir; bunlar için model yeniden yüklenmez.
    let needsRestart = false;
    try {
      const status = await getBackendStatus();
      if (status && status.settings && status.ready) {
        const s = status.settings;
        const currentModelName = s.model ? s.model.split(/[\\/]/).pop() : null;
        const targetModelName = activeModel ? activeModel.split(/[\\/]/).pop() : null;
        const requestedBackend = ayarlar.backendType || (ayarlar.useGpu === false ? "cpu" : "auto");
        const currentBackend = s.backendType || (s.useGpu === false ? "cpu" : "auto");
        const openVino = requestedBackend === "openvino-npu";
        const appleNpu = requestedBackend === "apple-npu";

        if ((!openVino && currentModelName !== targetModelName) ||
            Boolean(s.useGpu) !== (ayarlar.useGpu !== false) ||
            currentBackend !== requestedBackend ||
            (!appleNpu && parseInt(s.threads) !== parseInt(ayarlar.threads)) ||
            (!appleNpu && Boolean(s.vaeTiling) !== Boolean(ayarlar.vaeTiling)) ||
            (!appleNpu && Boolean(s.vaeOnCpu) !== Boolean(ayarlar.vaeOnCpu)) ||
            (!appleNpu && Boolean(s.flashAttn) !== Boolean(ayarlar.useFlashAttn))) {
          needsRestart = true;
        }
        // NPU arka uçları boyut/adımı başlangıçta sabitler
        if ((openVino || appleNpu) && (
          parseInt(s.width || 512) !== genislik ||
          parseInt(s.height || 512) !== yukseklik ||
          (openVino && parseInt(s.steps) !== parseInt(ayarlar.steps)))) {
          needsRestart = true;
        }
      } else {
        needsRestart = true;
      }
    } catch (e) {
      needsRestart = true;
    }

    if (needsRestart) {
      try {
        await startServer(activeModel, ayarlar);
        let isReady = false;
        let crashError = null;
        const maxStartupPolls = 1200; // en fazla 10 dakika
        for (let i = 0; i < maxStartupPolls; i++) {
          const status = await getBackendStatus();
          if (status.loading) {
            setRestartLoadProgress({
              progress: status.loading.progress || 0,
              phase: status.loading.phase || "",
              speed: status.loading.speed || "",
              current: status.loading.current || 0,
              total: status.loading.total || 0,
              backendMode: status.loading.backendMode || status.settings?.backendMode || "",
              device: status.loading.device || status.settings?.backendDevice || "",
            });
          }
          if (status.ready) {
            isReady = true;
            break;
          }
          if (status.error) {
            crashError = status.error;
            break;
          }
          if (!status.running && !status.loading?.active && i > 3) {
            crashError = "Görsel motoru başlar başlamaz kapandı.";
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        if (!isReady) {
          throw new Error(crashError || "Görsel motoru yeni ayarlarla başlatılamadı.");
        }
        setServerRunning?.(true);
        setYukluModel(activeModel);
      } catch (err) {
        console.error("Failed to restart backend:", err);
        setErrorMsg(err.message || "Ayarlar görsel motoruna uygulanamadı.");
        setIsRestartingBackend(false);
        return;
      }
    }
    setIsRestartingBackend(false);
    setRestartLoadProgress(null);

    const ikinciAdimSayisi = hires.steps || Math.max(1, Math.round(ayarlar.steps / 2));
    await setGenerationPlan({ steps: ayarlar.steps, hrSteps: hires.enabled ? ikinciAdimSayisi : 0, hires: hires.enabled });

    if (timerRef.current) clearInterval(timerRef.current);
    setIsGenerating(true);
    setGenerationProgress(0);
    setElapsedTime(0);
    setCurrentStep(0);
    setToplamAdim(ayarlar.steps);
    setAdimSuresi(null);
    setIkinciGecis(false);
    hasRealGenerationStepRef.current = false;
    setIsCpuFallback(false);
    setIsDecoding(false);
    setGenDuration(null);
    setOutputImage(null);

    const onceTahmin = sureTahmini(activeModel, genislik, yukseklik, ayarlar.steps);
    setEstimatedLeftTime(onceTahmin ? Math.round(onceTahmin.toplam) : null);

    const gpuSelected = (ayarlar.backendType || (ayarlar.useGpu === false ? "cpu" : "auto")) !== "cpu";
    let cpuFallbackDetected = false;
    let elapsedSeconds = 0;
    let sonAdim = -1;
    const ilkGecisHizlari = [];
    const ikinciGecisTahmini = hires.enabled
      ? sureTahmini(activeModel, Math.round((genislik * hires.scale) / 8) * 8, Math.round((yukseklik * hires.scale) / 8) * 8, ikinciAdimSayisi)
      : null;

    timerRef.current = setInterval(async () => {
      elapsedSeconds++;
      setElapsedTime(elapsedSeconds);

      try {
        const progress = await getGenerationProgress();
        if (progress && progress.active) {
          const decoding = progress.decoding || false;
          const ikinci = Boolean(progress.ikinciGecis);
          setIsDecoding(decoding);
          setIkinciGecis(ikinci);

          const steps = progress.steps || ayarlar.steps || 20;
          const step = decoding ? steps : (progress.step || 0);
          const snAdim = decoding ? null : hizCoz(progress.speed);

          if (decoding || progress.steps > 0) {
            hasRealGenerationStepRef.current = true;
            setCurrentStep(step);
            setToplamAdim(steps);
          }
          if (snAdim) {
            setAdimSuresi(snAdim);
            if (!ikinci && step !== sonAdim) ilkGecisHizlari.push(snAdim);
          }
          sonAdim = step;

          // İlerleme yüzdesi: ikinci geçiş varsa iki geçiş ağırlıklandırılır
          let yuzde;
          if (hires.enabled) {
            const a = ikinci ? 50 : 0;
            yuzde = a + (decoding ? (ikinci ? 49 : 48) : Math.round((step / steps) * 48));
          } else {
            yuzde = decoding ? 99 : Math.round((step / steps) * 97);
          }
          yuzde = Math.min(99, yuzde);
          if (decoding || progress.steps > 0) setGenerationProgress(yuzde);
          else setGenerationProgress((prev) => Math.max(prev, Math.min(3, yuzde)));

          // Kalan süre
          let kalan = null;
          if (decoding) {
            kalan = ikinci || !hires.enabled ? 5 : (ikinciGecisTahmini ? ikinciGecisTahmini.toplam : null);
          } else if (snAdim) {
            kalan = Math.max(0, steps - step) * snAdim + 5;
            if (hires.enabled && !ikinci) kalan = ikinciGecisTahmini ? kalan + ikinciGecisTahmini.toplam : null;
          }
          if (kalan !== null) setEstimatedLeftTime(Math.round(kalan));
          else if (!decoding) setEstimatedLeftTime((prev) => (prev === null ? null : Math.max(1, prev - 1)));

          // GPU istendi ama işlem çok yavaşsa CPU'ya düşülmüş olabilir
          const backendMode = String(progress.backendMode || "").toLowerCase();
          const backendDevice = String(progress.backendDevice || "").toLowerCase();
          const gpuOnayli = ["gpu", "vulkan", "cuda", "rocm", "metal"].some((k) => backendMode.includes(k) || backendDevice.includes(k));
          if (gpuSelected && !cpuFallbackDetected && !gpuOnayli && snAdim && snAdim > 5) {
            cpuFallbackDetected = true;
            setIsCpuFallback(true);
          }
        } else {
          setEstimatedLeftTime((prev) => (prev === null ? null : Math.max(1, prev - 1)));
        }
      } catch (e) {
        console.warn("İlerleme okunamadı:", e);
      }
    }, 1000);

    try {
      abortControllerRef.current = new AbortController();
      const result = await generateImage(
        prompt,
        negativePrompt,
        hires.enabled
          ? { ...ayarlar, hiresEnabled: true, hiresScale: hires.scale, hiresUpscaler: hires.upscaler, hiresDenoise: hires.denoise, hiresSteps: ikinciAdimSayisi }
          : ayarlar,
        activeModel,
        baseImage,
        (prog) => setGenerationProgress((prev) => Math.max(prev, prog)),
        abortControllerRef.current.signal
      );

      if (timerRef.current) clearInterval(timerRef.current);
      setGenerationProgress(100);
      setCurrentStep(ayarlar.steps);
      setEstimatedLeftTime(0);

      // Ölçülen hızı kaydet (süre tahminleri için)
      if (ilkGecisHizlari.length > 0) {
        const sirali = [...ilkGecisHizlari].sort((a, b) => a - b);
        const ortanca = sirali[Math.floor(sirali.length / 2)];
        const ekSure = !hires.enabled && !baseImage ? result.duration_sec - ortanca * ayarlar.steps : 0;
        hizKaydet(activeModel, genislik, yukseklik, ortanca, ekSure);
      }

      const metadata = {
        prompt: prompt,
        negativePrompt: negativePrompt,
        seed: result.seed,
        steps: ayarlar.steps,
        cfgScale: ayarlar.cfgScale,
        width: genislik,
        height: yukseklik,
        sampler: ayarlar.sampler,
        scheduler: ayarlar.scheduler || "",
        clipSkip: Number(ayarlar.clipSkip) || 0,
        model: activeModel,
        modelFamily: profil?.ad || "",
        mode: baseImage ? "img2img" : "txt2img",
        denoisingStrength: baseImage ? ayarlar.denoisingStrength : null,
        hires: hires.enabled ? { scale: hires.scale, upscaler: hires.upscaler, denoise: hires.denoise, steps: ikinciAdimSayisi } : null,
        duration_sec: result.duration_sec,
        timestamp: new Date().toLocaleTimeString("tr-TR"),
      };
      let savedOutput = null;
      let savedUrl = null;
      try {
        savedOutput = await saveGeneratedOutput(result.image, metadata);
        savedUrl = savedOutput.url;
        if (!savedUrl) {
          throw new Error("Sunucu görseli kaydetti ama dosya adresini döndürmedi.");
        }
      } catch (saveErr) {
        console.error("Generated image could not be saved:", saveErr);
        throw new Error(`Görsel üretildi ama kaydedilemedi: ${saveErr.message || saveErr}`);
      }

      setOutputImage(savedUrl);
      setOutputSeed(result.seed);
      setGenDuration(result.duration_sec);

      setGeneratedImages((prev) => [{ ...metadata, ...(savedOutput || {}), url: savedUrl }, ...prev]);
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error("Generation failed:", e);
        setErrorMsg(e.message || "Üretim başarısız oldu. Lütfen tekrar deneyin.");
      }
      if (timerRef.current) clearInterval(timerRef.current);
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
      yukluModeliOku();
    }
  };

  // Üretimi durdur
  const handleCancelGeneration = async () => {
    if (await showConfirm({
      title: "Üretim durdurulsun mu?",
      message: "Devam eden üretim iptal edilecek. Bunun için görsel motoru yeniden başlatılır ve model tekrar yüklenir.",
      confirmLabel: "Durdur",
      cancelLabel: "Devam etsin",
      danger: true,
    })) {
      if (timerRef.current) clearInterval(timerRef.current);
      setIsCancelling(true);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      try {
        await stopServer();
        setCurrentStep(0);
        setIsDecoding(false);
        hasRealGenerationStepRef.current = false;
        if (activeModel) {
          await startServer(activeModel, constraints);
          await waitForServerReady();
        }
      } catch (err) {
        console.error("Failed to restart server on cancellation:", err);
      } finally {
        setIsCancelling(false);
        setIsGenerating(false);
        setGenerationProgress(0);
        setEstimatedLeftTime(null);
        yukluModeliOku();
      }
    }
  };

  // Görseli panoya kopyala
  const handleCopyImage = async () => {
    if (!outputImage) return;
    try {
      const response = await fetch(outputImage);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy image:", err);
    }
  };

  const downloadImageUrl = (url, filename = `gorsel-${Date.now()}.png`) => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownload = () => {
    if (!outputImage) return;
    downloadImageUrl(outputImage, `gorsel-${outputSeed || Date.now()}.png`);
  };

  // Galeriden bir görseli yalnızca göster
  const goster = useCallback((item) => {
    setOutputImage(item.url);
    setOutputSeed(item.seed);
    setGenDuration(item.duration_sec ?? item.durationSec ?? null);
    setErrorMsg(null);
  }, []);

  // Galerideki görselin prompt ve ayarlarını geri yükle ("Ayarları kullan")
  const ayarlariYukle = useCallback((item) => {
    setPrompt(item.prompt || "");
    setNegativePrompt(item.negativePrompt || "");
    setConstraints((prev) => ({
      ...prev,
      ...(item.steps ? { steps: item.steps, standardSteps: item.steps } : {}),
      ...(item.cfgScale ? { cfgScale: item.cfgScale } : {}),
      ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
      ...(item.sampler ? { sampler: item.sampler } : {}),
      scheduler: item.scheduler || "",
      clipSkip: Number(item.clipSkip) || 0,
      ...(item.seed !== undefined && item.seed !== null ? { seed: item.seed } : {}),
    }));
    goster(item);
  }, [setPrompt, setNegativePrompt, setConstraints, goster]);

  const toggleGallerySelection = useCallback((idx, event) => {
    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
    setSelectedGalleryIndexes((prev) => {
      if (!multi) return [idx];
      return prev.includes(idx) ? prev.filter((item) => item !== idx) : [...prev, idx];
    });
    if (generatedImages[idx]) {
      goster(generatedImages[idx]);
    }
  }, [generatedImages, goster]);

  const selectedGalleryItems = selectedGalleryIndexes
    .map((idx) => generatedImages[idx])
    .filter(Boolean);

  const clearGallerySelection = () => setSelectedGalleryIndexes([]);

  const useSelectedGalleryItem = () => {
    if (selectedGalleryItems[0]) ayarlariYukle(selectedGalleryItems[0]);
  };

  const downloadSelectedGalleryItems = () => {
    selectedGalleryItems.forEach((item, index) => {
      const seed = item.seed ?? Date.now();
      downloadImageUrl(item.url, `gorsel-${seed}-${index + 1}.png`);
    });
  };

  // Seçili çıktıları ESRGAN ile 4 kat büyütür (yeniden çizim yok). Sunucu
  // aynı anda tek iş çalıştırdığı için sırayla işlenir.
  const upscaleSelectedGalleryItems = async () => {
    const hedefler = selectedGalleryItems.filter((item) => item && item.image);
    if (hedefler.length === 0 || isUpscaling) return;
    setIsUpscaling(true);
    const yeniler = [];
    const hatalar = [];
    try {
      for (let i = 0; i < hedefler.length; i++) {
        setUpscaleInfo(`${i + 1}/${hedefler.length}`);
        try {
          yeniler.push(await upscaleOutput(hedefler[i].image, 1));
        } catch (err) {
          hatalar.push(`${hedefler[i].image}: ${err.message || String(err)}`);
        }
      }
      if (yeniler.length > 0) {
        setGeneratedImages((prev) => [...yeniler, ...prev]);
        setSelectedGalleryIndexes([]);
      }
      if (hatalar.length > 0) {
        showAlert?.({ title: "Büyütme kısmen başarısız", message: hatalar.join("\n"), danger: true });
      }
    } finally {
      setIsUpscaling(false);
      setUpscaleInfo("");
    }
  };

  const deleteSelectedGalleryItems = async () => {
    if (selectedGalleryItems.length === 0) return;
    const count = selectedGalleryItems.length;
    const confirmed = await showConfirm({
      title: "Seçili görseller silinsin mi?",
      message: `${count} görsel ve bilgi dosyası uygulama klasöründen kalıcı olarak silinecek.`,
      confirmLabel: "Sil",
      cancelLabel: "Vazgeç",
      danger: true,
    });
    if (!confirmed) return;

    try {
      await deleteGeneratedOutputs(selectedGalleryItems);
      const selectedSet = new Set(selectedGalleryIndexes);
      setGeneratedImages((prev) => prev.filter((_, idx) => !selectedSet.has(idx)));
      setSelectedGalleryIndexes([]);
      if (selectedGalleryItems.some((item) => item.url === outputImage)) {
        setOutputImage(null);
        setOutputSeed(null);
        setGenDuration(null);
      }
    } catch (err) {
      console.error("Failed to delete selected outputs:", err);
      showAlert({ title: "Silinemedi", message: err.message || String(err), danger: true });
    }
  };

  // --- İlerleme paneli metinleri ---
  const asama = isDecoding
    ? { baslik: "Görüntü çözümleniyor", aciklama: "Model, sıkıştırılmış gizli görüntüyü (latent) gerçek piksellere çeviriyor (VAE). Bu son aşamadır." }
    : adimAsamasi(currentStep, toplamAdim);
  const gecisEtiketi = hires.enabled ? (ikinciGecis ? "2. geçiş · yüksek çözünürlük" : "1. geçiş") : "";
  const dugmeMetni = !activeModel
    ? "Önce bir model seçin"
    : baseImage
      ? "Görselden Üret"
      : "Görsel Üret";

  return (
    <div className="workspace-area">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Görsel Stüdyo</h2>
        <p className="workspace-subtitle">
          Görseller tamamen bu bilgisayarda üretilir ve uygulama klasörüne kaydedilir. Tüm ayarlar seçili modele göre bu sayfada.
        </p>
      </div>

      {kuyrukDurumu?.calisiyor && (
        <div className="bilgi-kutusu" style={{ marginBottom: "16px" }}>
          Arka planda bir görsel işi çalışıyor (sohbetten istenen görsel ya da otomasyon kuyruğu): {kuyrukDurumu.asama || kuyrukDurumu.is}.
          Şimdi üretim başlatırsanız sıranız bu görsel bitince gelir. Model değiştirirseniz bu iş durup daha sonra tekrar denenir.
          <div style={{ marginTop: 8 }}>
            <button className="m3-btn m3-btn-error" onClick={async () => {
              if (!(await showConfirm?.({ title: "Görsel işi durdurulsun mu?", message: "Arka planda çalışan görsel işi durdurulur ve yeniden denenmez.", confirmLabel: "Durdur", danger: true }))) return;
              try { await fetch("/api/is-kuyrugu/durdur", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch (_) {}
              setKuyrukDurumu(await getJobQueueStatus());
            }}>Durdur</button>
          </div>
        </div>
      )}

      <div className="generator-layout">
        {/* Sol: model, prompt ve ayarlar */}
        <div>
          <ModelKarti
            modeller={modeller}
            activeModel={activeModel}
            setActiveModel={setActiveModel}
            profil={profil}
            modelBilgisi={modelBilgisi}
            setModelBilgisi={setModelBilgisi}
            yukluModel={yukluModel}
            isGenerating={isGenerating || isRestartingBackend}
            showAlert={showAlert}
            setActiveTab={setActiveTab}
          />

          <div className="m3-card">
            <h3 className="m3-card-title">
              <Sparkles size={18} style={{ color: "var(--md-sys-color-primary)" }} />
              Prompt
            </h3>

            <div className="m3-field-group">
              <div className="m3-text-field">
                <label className="m3-text-field-label" htmlFor="gorsel-prompt">Görsel tarifi</label>
                <textarea
                  id="gorsel-prompt"
                  className="m3-textarea"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Görseli İngilizce tarif edin (ör. 'A futuristic city in cyberpunk style, high detail, cinematic lighting')..."
                  disabled={isGenerating}
                />
                <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                  Görsel modelleri yalnızca İngilizce anlar. Türkçe yazılan kelimelerin çoğu dikkate alınmaz.
                </span>
              </div>

              <div className={`m3-text-field ${!negatifDurum.etkili ? "alan-soluk" : ""}`}>
                <label className="m3-text-field-label" htmlFor="gorsel-negatif">Negatif prompt (istenmeyenler)</label>
                <textarea
                  id="gorsel-negatif"
                  className="m3-textarea"
                  style={{ minHeight: "64px" }}
                  value={negativePrompt || ""}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="Görselde olmasını istemediklerinizi İngilizce yazın (ör. 'blurry, low quality, deformed hands, text, watermark')..."
                  disabled={isGenerating}
                />
                {negatifDurum.neden ? (
                  <div className="soluk-neden"><span>{negatifDurum.neden}</span></div>
                ) : (
                  <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                    Model bu kelimelerden uzaklaşacak şekilde çizer.
                  </span>
                )}
              </div>

              {!npuModu && (
                <div className="m3-text-field">
                  <label className="m3-text-field-label">Başlangıç görseli (isteğe bağlı)</label>
                  {baseImage ? (
                    <div className="baslangic-gorseli">
                      <img src={baseImage} alt="Başlangıç görseli" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>Başlangıç görseli hazır</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>
                          Model bu görseli prompt'a göre yeniden çizer.
                        </div>
                      </div>
                      <button type="button" className="m3-btn m3-btn-error" style={{ height: "34px", flexShrink: 0 }} onClick={handleClearBaseImage} disabled={isGenerating}>
                        <Trash2 size={14} />
                        <span>Kaldır</span>
                      </button>
                    </div>
                  ) : (
                    <label className="import-box" style={{ margin: 0, padding: "16px", cursor: isGenerating ? "not-allowed" : "pointer" }}>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: "none" }}
                        onChange={handleBaseImageSelect}
                        disabled={isGenerating}
                      />
                      <ImagePlus className="import-icon" />
                      <span style={{ fontWeight: 600 }}>Başlangıç görseli yükle</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", textAlign: "center" }}>
                        Kendi görselinizden yola çıkarak yeni bir görsel üretir.
                      </span>
                    </label>
                  )}

                  {baseImage && (
                    <div className="m3-slider-group" style={{ marginTop: "12px" }}>
                      <div className="m3-slider-header">
                        <label className="m3-slider-label" htmlFor="gorsel-donusum">Dönüşüm gücü</label>
                        <span className="settings-value-badge">{Number(constraints.denoisingStrength).toFixed(2)}</span>
                      </div>
                      <input
                        id="gorsel-donusum"
                        type="range"
                        className="m3-slider"
                        min="0.1"
                        max="1"
                        step="0.05"
                        value={constraints.denoisingStrength}
                        onChange={(e) => setConstraints((prev) => ({ ...prev, denoisingStrength: parseFloat(e.target.value) }))}
                        disabled={isGenerating}
                        style={{ "--value": `${((constraints.denoisingStrength - 0.1) / 0.9) * 100}%` }}
                      />
                      <span className="settings-option-desc">
                        Düşük değer görselinize yakın kalır, yüksek değer daha serbest yorumlar. 0,7 iyi bir başlangıç. Gerçekte çalışan adım sayısı yaklaşık adım × dönüşüm gücü kadardır.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <button
                className="m3-btn m3-btn-filled"
                style={{ height: "48px", marginTop: "8px" }}
                onClick={handleGenerate}
                disabled={isGenerating || isRestartingBackend || !prompt.trim() || !activeModel}
              >
                <Sparkles size={18} />
                <span>{dugmeMetni}</span>
                {activeModel && uretimTahmini && <span className="dugme-tahmin">≈ {sureYaz(uretimTahmini)}</span>}
              </button>
              {activeModel && yukluModel !== activeModel && !isGenerating && (
                <span className="settings-option-desc" style={{ textAlign: "center" }}>
                  İlk üretimden önce model belleğe yüklenecek.
                </span>
              )}
            </div>
          </div>

          <BoyutKarti profil={profil} constraints={constraints} setConstraints={setConstraints} isGenerating={isGenerating} />
          <KaliteKarti
            profil={profil}
            constraints={constraints}
            setConstraints={setConstraints}
            isGenerating={isGenerating}
            activeModel={activeModel}
            sonSeed={outputSeed}
          />
          {!npuModu && (
            <YuksekCozunurlukKarti
              profil={profil}
              constraints={constraints}
              hires={hires}
              setHires={setHires}
              isGenerating={isGenerating}
              activeModel={activeModel}
            />
          )}
          <BellekKarti
            constraints={constraints}
            setConstraints={setConstraints}
            backendOptions={backendOptions}
            setBackendOptions={setBackendOptions}
            serverRunning={serverRunning}
            setServerRunning={setServerRunning}
            setActiveModel={setActiveModel}
            showAlert={showAlert}
            showConfirm={showConfirm}
            isGenerating={isGenerating}
            specs={specs}
          />
        </div>

        {/* Sağ: çıktı (kaydırırken görünür kalır) */}
        <div className="m3-card output-panel uretici-cikti">
          <div className="output-image-container">
            {isGenerating || isCancelling || isRestartingBackend ? (
              <div className="progress-overlay uretim-paneli">
                {isRestartingBackend ? (
                  <>
                    <div className="progress-spinner"></div>
                    <div className="progress-text">Model belleğe yükleniyor</div>
                    {restartLoadProgress ? (
                      <div style={{ width: "min(360px, 90%)" }}>
                        <div className="uretim-satir">
                          <span>{restartLoadProgress.total > 0 ? `${restartLoadProgress.current} / ${restartLoadProgress.total} parça` : "Hazırlanıyor"}</span>
                          <span>%{Math.round(restartLoadProgress.progress)}</span>
                        </div>
                        <div className="progress-bar-container" style={{ width: "100%", margin: 0 }}>
                          <div className="progress-bar-fill" style={{ width: `${Math.min(100, Math.max(0, restartLoadProgress.progress))}%`, transition: "width 0.25s ease" }}></div>
                        </div>
                        {(restartLoadProgress.backendMode || restartLoadProgress.device) && (
                          <div className="uretim-aciklama" style={{ textAlign: "center", marginTop: "8px" }}>
                            {restartLoadProgress.backendMode || "Motor"}{restartLoadProgress.device ? ` · ${restartLoadProgress.device}` : ""}
                          </div>
                        )}
                      </div>
                    ) : null}
                    <p className="uretim-aciklama">
                      Model dosyası okunup ekran kartı belleğine aktarılıyor. Bu yalnızca model veya bellek ayarları değişince yapılır.
                    </p>
                  </>
                ) : isCancelling ? (
                  <>
                    <div className="progress-spinner"></div>
                    <div className="progress-text">Üretim durduruluyor</div>
                    <p className="uretim-aciklama">Görsel motoru durdurulup model yeniden yükleniyor. Lütfen bekleyin.</p>
                  </>
                ) : (
                  <>
                    {gecisEtiketi && <span className="gecis-etiketi">{gecisEtiketi}</span>}
                    <div className="progress-text" style={{ textAlign: "center" }}>
                      {isDecoding
                        ? asama.baslik
                        : currentStep > 0
                          ? `Adım ${currentStep} / ${toplamAdim} · ${asama.baslik}`
                          : asama.baslik}
                    </div>
                    <p className="uretim-aciklama">{asama.aciklama}</p>

                    {!isDecoding && <AdimSeridi adim={currentStep} toplam={toplamAdim} />}

                    {isCpuFallback && (
                      <div className="cpu-uyari">Beklenenden yavaş: işlem CPU'da çalışıyor olabilir.</div>
                    )}

                    <div className="progress-bar-container" style={{ margin: "2px 0" }}>
                      <div className="progress-bar-fill" style={{ width: `${generationProgress}%`, transition: "width 1s linear" }}></div>
                    </div>

                    <div className="uretim-istatistik">
                      <div><span>Geçen</span><strong>{sureYaz(elapsedTime)}</strong></div>
                      <div><span>Kalan (tahmini)</span><strong>{estimatedLeftTime === null ? "ölçülüyor" : sureYaz(estimatedLeftTime)}</strong></div>
                      <div><span>Adım süresi</span><strong>{adimSuresi ? sureYaz(adimSuresi) : "–"}</strong></div>
                    </div>

                    <button className="m3-btn m3-btn-error" style={{ marginTop: "6px", height: "36px", padding: "0 20px" }} onClick={handleCancelGeneration}>
                      <Ban size={14} />
                      <span>Üretimi durdur</span>
                    </button>
                  </>
                )}
              </div>
            ) : outputImage ? (
              <img src={outputImage} className="output-image" alt="Üretilen görsel" />
            ) : errorMsg ? (
              <div style={{ textAlign: "center", padding: "24px", color: "var(--md-sys-color-error)", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <X size={40} />
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: "bold" }}>Üretim başarısız</h3>
                <p style={{ margin: 0, fontSize: "0.9rem", opacity: 0.9, maxWidth: "320px", lineHeight: "1.4" }}>{errorMsg}</p>
                <div style={{ fontSize: "0.82rem", opacity: 0.85, color: "var(--md-sys-color-on-surface-variant)" }}>
                  İpucu: Boyutu modelin eğitim boyutuna düşürmeyi veya Gelişmiş bölümünde "VAE işlemini CPU'da yap"ı açmayı deneyin.
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center" }}>
                <Sparkles className="output-placeholder-icon" />
                <p className="output-placeholder-text">
                  Üretilen görsel burada görünecek.<br />
                  Prompt'u yazıp "Görsel Üret"e basın.
                </p>
              </div>
            )}
          </div>

          {outputImage && !isGenerating && (
            <>
              <div className="cikti-bilgi">
                <span>Seed: {outputSeed ?? "-"}</span>
                {genDuration ? <span>Süre: {sureYaz(genDuration)}</span> : null}
              </div>
              <div className="image-actions">
                <button className="m3-btn m3-btn-tonal" onClick={handleCopyImage}>
                  {copySuccess ? <Check size={16} /> : <Copy size={16} />}
                  <span>{copySuccess ? "Kopyalandı" : "Kopyala"}</span>
                </button>
                <button className="m3-btn m3-btn-outlined" onClick={handleDownload}>
                  <Download size={16} />
                  <span>İndir</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Galeri */}
      <div className="gallery-section">
        <div className="gallery-header">
          <h3 className="m3-card-title" style={{ marginBottom: 0 }}>Son Üretilenler</h3>
          {selectedGalleryItems.length > 0 && (
            <div className="gallery-selection-actions">
              <span className="gallery-selection-count">{selectedGalleryItems.length} seçili</span>
              <button className="m3-btn m3-btn-tonal" onClick={useSelectedGalleryItem} title="Bu görselin prompt'unu ve ayarlarını forma yükler">
                <Check size={14} />
                <span>Ayarlarını kullan</span>
              </button>
              <button
                className="m3-btn m3-btn-outlined"
                onClick={upscaleSelectedGalleryItems}
                disabled={isUpscaling || isGenerating}
                title="RealESRGAN ile 4 kat büyütür. Yeniden çizim yapmaz; 512'lik görsel için yaklaşık 70 saniye."
              >
                <Maximize2 size={14} />
                <span>{isUpscaling ? `Büyütülüyor ${upscaleInfo}` : "Büyüt 4x"}</span>
              </button>
              <button className="m3-btn m3-btn-outlined" onClick={downloadSelectedGalleryItems}>
                <Download size={14} />
                <span>İndir</span>
              </button>
              <button className="m3-btn m3-btn-error" onClick={deleteSelectedGalleryItems}>
                <Trash2 size={14} />
                <span>Sil</span>
              </button>
              <button className="m3-btn m3-btn-outlined" onClick={clearGallerySelection}>
                Seçimi kaldır
              </button>
            </div>
          )}
        </div>
        {generatedImages.length === 0 ? (
          <div className="m3-card gallery-empty">
            Henüz görsel üretilmedi. Üretilen her görsel uygulama klasörüne kaydedilir.
          </div>
        ) : (
          <>
            <div className="gallery-hint">Görmek için tıklayın. Birden fazla seçmek için Ctrl veya Shift ile tıklayın.</div>
            <div className="gallery-grid">
              {generatedImages.map((img, idx) => (
                <GalleryItem
                  key={img.image || idx}
                  img={img}
                  idx={idx}
                  isSelected={selectedGalleryIndexes.includes(idx)}
                  onClick={toggleGallerySelection}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(Generator);

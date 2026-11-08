import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import TopStatusBar from "./components/TopStatusBar";
import Generator from "./components/Generator";
import ModelManager from "./components/ModelManager";
import Settings from "./components/Settings";
import TextChat from "./components/TextChat";
import SpeechTranscriber from "./components/SpeechTranscriber";
import TextToSpeech from "./components/TextToSpeech";
import MuzikStudyosu from "./components/MuzikStudyosu";
import VideoStudyosu from "./components/VideoStudyosu";
import IlkKurulumSihirbazi, { onerilenSistemMesaji } from "./components/IlkKurulumSihirbazi";
import GuncellemeBildirimi from "./components/GuncellemeBildirimi";
import { AgKalkaniUyari, AgKalkaniDurum } from "./components/AgKalkani";
import { profilOlustur } from "./modelProfilleri";
import { getModelDetails, cleanupCandidates, formatBytes, getCleanupCandidates, getDiagnostics, getHardwareSpecs, getHealth, getTelemetry, getBackendOptions, getBackendStatus, listGeneratedOutputs, listLlmConversations, saveLlmConversation, deleteLlmConversation, listSpeechTranscriptions, deleteSpeechTranscription, listTtsOutputs, deleteTtsOutput, stopServer } from "./services/api";
import "./App.css";
import GirisEkrani from "./components/GirisEkrani";
import { kullaniciDurumu, cikisYap } from "./services/kullaniciApi";

function App() {
  // Kullanıcı girişi: kullanıcı oluşturulmuşsa ve oturum yoksa giriş ekranı gösterilir
  // undefined: henüz öğrenilmedi (sunucu açılıyor olabilir). Durum alınamazsa uygulama AÇILMAZ, birkaç saniyede bir yeniden denenir.
  const [girisDurumu, setGirisDurumu] = useState(undefined);
  useEffect(() => {
    let bitti = false;
    const dene = async () => {
      try { const d = await kullaniciDurumu(); if (!bitti) { window.__yasGirisli = !!d.girisli; window.__yasYonetici = !d.kurulum || !!(d.kullanici && d.kullanici.yonetici); setGirisDurumu(d); } }
      catch (_) { if (!bitti) setTimeout(dene, 1500); }
    };
    dene();
    return () => { bitti = true; };
  }, []);
  // Otomatik kilit: 15 dakika fare/klavye hareketi yoksa oturum kapanır, giriş ekranı gelir (süren üretimler etkilenmez)
  useEffect(() => {
    if (!girisDurumu?.girisli) return undefined;
    const KILIT_MS = 15 * 60 * 1000;
    let son = Date.now();
    const hareket = () => { son = Date.now(); };
    const olaylar = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    olaylar.forEach((o) => window.addEventListener(o, hareket, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - son > KILIT_MS) { clearInterval(t); cikisYap().catch(() => {}).finally(() => window.location.reload()); }
    }, 30000);
    return () => { clearInterval(t); olaylar.forEach((o) => window.removeEventListener(o, hareket)); };
  }, [girisDurumu?.girisli]);
  const dialogResolverRef = useRef(null);
  const [dialog, setDialog] = useState(null);

  const closeDialog = useCallback((value) => {
    const resolver = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setDialog(null);
    if (resolver) resolver(value);
  }, []);

  const showConfirm = useCallback(({ title = "Confirm Action", message, confirmLabel = "OK", cancelLabel = "Cancel", danger = false }) => {
    return new Promise((resolve) => {
      dialogResolverRef.current = resolve;
      setDialog({ type: "confirm", title, message, confirmLabel, cancelLabel, danger });
    });
  }, []);

  const showAlert = useCallback(({ title = "Notice", message, confirmLabel = "OK", danger = false }) => {
    return new Promise((resolve) => {
      dialogResolverRef.current = resolve;
      setDialog({ type: "alert", title, message, confirmLabel, danger });
    });
  }, []);

  // Tema State
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  // Sayfa iskeleti kaymamalı: taşması gizli (overflow: hidden) kapsayıcılar bir odaklanma ya da
  // kaydırma komutuyla kayarsa geri sıfırlanır. Böylece üst çubuk ekrandan çıkmaz.
  useEffect(() => {
    const kaymayiDuzelt = (e) => {
      const el = e.target;
      if (el === document || el === document.documentElement || el === document.body) {
        if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
        if (document.body.scrollTop) document.body.scrollTop = 0;
        return;
      }
      if (!(el instanceof HTMLElement) || (el.scrollTop === 0 && el.scrollLeft === 0)) return;
      const stil = getComputedStyle(el);
      if (stil.overflowY === "hidden" && stil.overflowX === "hidden") {
        el.scrollTop = 0;
        el.scrollLeft = 0;
      }
    };
    document.addEventListener("scroll", kaymayiDuzelt, true);
    return () => document.removeEventListener("scroll", kaymayiDuzelt, true);
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Navigation
  const [activeTab, setActiveTab] = useState("chat"); // açılışta sohbet ekranı
  // Sohbetteki medya kartlarının "Stüdyoda aç" düğmesi: window "yas-sekme-ac" olayı ({ detail: { sekme } })
  useEffect(() => {
    const ac = (e) => {
      const sekme = e?.detail?.sekme;
      if (["muzik", "video", "generator", "models", "chat"].includes(sekme)) setActiveTab(sekme);
    };
    window.addEventListener("yas-sekme-ac", ac);
    return () => window.removeEventListener("yas-sekme-ac", ac);
  }, []);

  // Prompts
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  // Model & Sunucu Status
  const [activeModel, setActiveModel] = useState(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [isStoppingServer, setIsStoppingServer] = useState(false);
  const [isLlmLoaded, setIsLlmLoaded] = useState(false);
  const [backendOptions, setBackendOptions] = useState({
    options: [{ id: "cpu", label: "CPU", available: true }],
    cudaAvailable: false,
    vulkanAvailable: false,
    defaultBackendType: "cpu",
  });
  const [health, setHealth] = useState(null);
  const [cleanupItems, setCleanupItems] = useState([]);
  const [isReadinessBusy, setIsReadinessBusy] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  // Gallery Gecmis
  const [generatedImages, setGeneratedImages] = useState([]);

  // Uretim status
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);

  // Sistem Ozellikler & Telemetry
  const [specs, setSpecs] = useState({
    os_name: "Loading Specs...",
    cpu_name: "Loading Specs...",
    cpu_cores_physical: 4,
    cpu_cores_logical: 8,
    ram_total_gb: 0,
    gpu_name: "Loading Specs...",
  });

  const [telemetry, setTelemetry] = useState({
    cpu_usage: 0,
    ram_used_gb: 0,
    ram_total_gb: 0,
    gpu_name: "Detecting...",
    vram_used_gb: 0,
    vram_total_gb: 0,
  });

  // Default Gorsel Constraints
  const [constraints, setConstraints] = useState({
    width: 1024,
    height: 1024,
    steps: 4,          // Recommended default steps for Flux.1 Schnell/Lightning
    npuSteps: 4,
    standardSteps: 20,
    cfgScale: 1.0,     // Recommended default CFG for Flux.1 Schnell
    sampler: "euler_a",
    scheduler: "",
    clipSkip: 0,
    seed: -1,
    denoisingStrength: 0.7,
    useGpu: true,
    useTaesd: true,
    useFlashAttn: true,
    useTiling: false,
    vaeTiling: true,
    vaeOnCpu: false,
    threads: 4,
    backendType: "auto",
  });

  const [textSettings, setTextSettings] = useState(() => {
    const saved = localStorage.getItem("textSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          enableThinking: parsed.enableThinking === true,
          maxTokens: !parsed.maxTokens || parsed.maxTokens === 384 ? 1024 : parsed.maxTokens,
          responseTokenMode: parsed.responseTokenMode || "auto",
          // Eski varsayılan sistem mesajları (elle değiştirilmemişse) yenisiyle değiştirilir
          systemPrompt: !parsed.systemPrompt || [
            "You are a helpful local AI assistant.",
            "Yardımsever bir yerel yapay zekâ asistanısın. Kullanıcı hangi dilde yazarsa o dilde yanıt ver.",
            "Senin adın Vega. Bu bilgisayarda çevrimdışı çalışan, yardımsever bir yapay zekâ asistanısın. Kullanıcı hangi dilde yazarsa o dilde yanıt ver.",
          ].includes(parsed.systemPrompt)
            ? onerilenSistemMesaji(parsed.assistantName)
            : parsed.systemPrompt,
        };
      } catch (_) {}
    }
    return {
      contextSize: 0,
      temperature: 0.7,
      systemPrompt: onerilenSistemMesaji(),
      assistantName: "Vega",
      threads: Math.max(4, Math.min(16, (navigator.hardwareConcurrency || 4) - 2)),
      enableThinking: false,
      // New performance ayarlar
      gpuLayers: -1,
      maxTokens: 1024,
      responseTokenMode: "auto",
      topP: 0.95,
      topK: 40,
      minP: 0.05,
      repeatPenalty: 1.1,
      seed: null,
      performanceProfile: "balanced",
      flashAttn: true,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      mlock: false,
      mmap: true,
      cachePrompt: true,
      defragThold: 0.1,
      batchSize: 512,
      ubatchSize: 512,
      preferredBackend: "auto",
    };
  });

  useEffect(() => {
    localStorage.setItem("textSettings", JSON.stringify(textSettings));
  }, [textSettings]);

  const [speechSettings, setSpeechSettings] = useState(() => {
    const saved = localStorage.getItem("speechSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Otomatik dil algılama kısa Türkçe kayıtları Rusça/Arapça sanabiliyor;
        // eski varsayılan "auto" bir kez Türkçeye çevrilir.
        let dil = parsed.language || "tr";
        if (dil === "auto" && !parsed.dilGocu) dil = "tr";
        return {
          language: dil,
          dilGocu: true,
          threads: Math.max(1, Math.min(32, Number(parsed.threads) || Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)))),
          backendPreference: ["auto", "vulkan", "metal", "cpu"].includes(parsed.backendPreference) ? parsed.backendPreference : "auto",
          translate: parsed.translate === true,
        };
      } catch (_) {}
    }
    return {
      language: "tr",
      dilGocu: true,
      threads: Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)),
      backendPreference: "auto",
      translate: false,
    };
  });

  useEffect(() => {
    localStorage.setItem("speechSettings", JSON.stringify(speechSettings));
  }, [speechSettings]);

  const [ttsSettings, setTtsSettings] = useState(() => {
    const saved = localStorage.getItem("ttsSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          model: parsed.model || "",
          voice: parsed.voice || "af_heart",
          speed: Math.max(0.5, Math.min(2, Number(parsed.speed) || 1)),
        };
      } catch (_) {}
    }
    return {
      model: "",
      voice: "af_heart",
      speed: 1,
    };
  });

  useEffect(() => {
    localStorage.setItem("ttsSettings", JSON.stringify(ttsSettings));
  }, [ttsSettings]);

  // Lifted Sohbet Gecmis States
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [showHistory, setShowHistory] = useState(false); // Default hide
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    const saved = localStorage.getItem("sidebarVisible");
    return saved !== "false";
  });

  useEffect(() => {
    localStorage.setItem("sidebarVisible", String(sidebarVisible));
  }, [sidebarVisible]);

  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem("fontSize");
    return saved ? Number(saved) : 16;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--app-font-size", `${fontSize}px`);
    localStorage.setItem("fontSize", String(fontSize));
  }, [fontSize]);
  const [speechTranscriptions, setSpeechTranscriptions] = useState([]);
  const [selectedSpeechTranscript, setSelectedSpeechTranscript] = useState(null);
  const [showSpeechHistory, setShowSpeechHistory] = useState(false);
  const [ttsOutputs, setTtsOutputs] = useState([]);
  const [selectedTtsOutput, setSelectedTtsOutput] = useState(null);
  const [showTtsHistory, setShowTtsHistory] = useState(false);

  const sanitizeMessageForStorage = (message) => {
    if (!Array.isArray(message?.content)) return message;
    return {
      ...message,
      content: message.content.map((item) => {
        if (item?.type !== "image_url") return item;
        return {
          type: "text",
          text: "[Ekli görsel, kayıtlı sohbet geçmişine alınmadı]",
        };
      }),
    };
  };

  const sanitizeConversationForStorage = (conversation) => ({
    ...conversation,
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map(sanitizeMessageForStorage)
      : [],
  });

  const persistConversation = (conversation) => {
    const compactConversation = sanitizeConversationForStorage(conversation);
    try {
      saveLlmConversation(compactConversation).catch((err) => {
        console.warn("Could not save chat history to app folder:", err);
      });
    } catch (err) {
      console.warn("Could not save chat history:", err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadConversations() {
      let legacyConversations = [];
      const legacySaved = localStorage.getItem("chat_conversations");
      if (legacySaved) {
        try {
          legacyConversations = JSON.parse(legacySaved);
        } catch (_) {
          localStorage.removeItem("chat_conversations");
        }
      }

      try {
        const diskConversations = await listLlmConversations();
        const diskIds = new Set(diskConversations.map((conversation) => conversation.id));
        const missingLegacy = legacyConversations
          .map(sanitizeConversationForStorage)
          .filter((conversation) => conversation.id && !diskIds.has(conversation.id));

        if (missingLegacy.length > 0) {
          await Promise.all(missingLegacy.map((conversation) => saveLlmConversation(conversation)));
        }

        const merged = [...diskConversations, ...missingLegacy]
          .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        if (!cancelled) setConversations(merged);
        if (legacySaved) localStorage.removeItem("chat_conversations");
      } catch (err) {
        console.warn("Could not load chat history from app folder:", err);
        if (!cancelled && legacyConversations.length > 0) {
          setConversations(legacyConversations.map(sanitizeConversationForStorage));
        }
      }
    }
    loadConversations();
    return () => {
      cancelled = true;
    };
  }, []);

  // Yerel model sohbete konu başlığı verince (kayıttan birkaç saniye sonra) listedeki adlar tazelenir
  const baslikTazeleRef = useRef(null);
  const basliklariTazele = useCallback(() => {
    clearTimeout(baslikTazeleRef.current);
    const dene = async (n) => {
      try {
        const liste = await listLlmConversations();
        const harita = new Map(liste.map((c) => [c.id, c]));
        setConversations((prev) => prev.map((c) => {
          const d = harita.get(c.id);
          return d && d.baslikKaynagi && (d.title !== c.title || d.baslikKaynagi !== c.baslikKaynagi) ? { ...c, title: d.title, baslikKaynagi: d.baslikKaynagi } : c;
        }));
      } catch (_) {}
      if (n < 3) baslikTazeleRef.current = setTimeout(() => dene(n + 1), 20000);
    };
    baslikTazeleRef.current = setTimeout(() => dene(0), 15000);
  }, []);

  const saveConversationState = useCallback((id, msgs, modelName, newTitle = null) => {
    setConversations((prev) => {
      const list = [...prev];
      const idx = list.findIndex(c => c.id === id);
      let conversation;
      if (idx !== -1) {
        conversation = {
          ...list[idx],
          messages: msgs,
          timestamp: Date.now(),
          model: modelName,
          ...(newTitle ? { title: newTitle } : {})
        };
        list[idx] = conversation;
      } else {
        conversation = {
          id,
          title: newTitle || "Sohbet oturumu",
          model: modelName,
          messages: msgs,
          timestamp: Date.now()
        };
        list.unshift(conversation);
      }
      persistConversation(conversation);
      if (!conversation.baslikKaynagi && (msgs || []).some((m) => m && m.role === "assistant")) setTimeout(() => basliklariTazele(), 0);
      return list;
    });
  }, [basliklariTazele]);

  // Sohbeti elle yeniden adlandır (sunucu: baslikKaynagi "elle"; sonraki kayıtlar başlığı ezmez)
  const handleRenameConversation = useCallback(async (id, title) => {
    const baslik = String(title || "").trim();
    if (!baslik) return;
    try {
      const res = await fetch("/api/llm/rename-conversation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title: baslik }) });
      const v = await res.json().catch(() => ({}));
      if (!res.ok || v.ok === false) throw new Error(v.error || `HTTP ${res.status}`);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: v.title, baslikKaynagi: "elle" } : c)));
    } catch (err) {
      showAlert({ title: "Sohbet adlandırılamadı", message: err.message || String(err), danger: true });
    }
  }, [showAlert]);

  const handleDeleteConversation = useCallback((id, e) => {
    if (e) e.stopPropagation();
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      return filtered;
    });
    deleteLlmConversation(id).catch((err) => {
      console.warn("Could not delete chat history from app folder:", err);
    });
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }
  }, [activeConversationId]);

  const refreshSpeechTranscriptions = useCallback(async () => {
    try {
      const list = await listSpeechTranscriptions();
      setSpeechTranscriptions(list);
    } catch (err) {
      console.warn("Could not load speech transcriptions:", err);
      setSpeechTranscriptions([]);
    }
  }, []);

  const handleDeleteSpeechTranscription = useCallback(async (item, e) => {
    if (e) e.stopPropagation();
    const itemId = item.filename || item.metadata || item.textFile;
    if (!itemId) return;

    const ok = await showConfirm({
      title: "Dökümü sil",
      message: `"${item.displayName || item.sourceFilename || "bu döküm"}" silinsin mi? Bu işlem geri alınamaz.`,
      confirmLabel: "Sil",
      danger: true
    });
    if (!ok) return;

    try {
      await deleteSpeechTranscription(itemId);
      
      setSelectedSpeechTranscript((prev) => {
        if (prev) {
          const prevId = prev.filename || prev.metadata || prev.textFile;
          if (prevId === itemId) return null;
        }
        return prev;
      });

      refreshSpeechTranscriptions();
    } catch (err) {
      console.error("Failed to delete speech transcription:", err);
      showAlert({ title: "Silinemedi", message: err.message || String(err), danger: true });
    }
  }, [showConfirm, showAlert, setSelectedSpeechTranscript, refreshSpeechTranscriptions]);

  useEffect(() => {
    refreshSpeechTranscriptions();
  }, [refreshSpeechTranscriptions]);

  const refreshTtsOutputs = useCallback(async () => {
    try {
      const list = await listTtsOutputs();
      setTtsOutputs(list);
    } catch (err) {
      console.warn("Could not load TTS outputs:", err);
      setTtsOutputs([]);
    }
  }, []);

  const handleDeleteTtsOutput = useCallback(async (item, e) => {
    if (e) e.stopPropagation();
    const itemId = item.filename || item.metadata;
    if (!itemId) return;

    const ok = await showConfirm({
      title: "Ses çıktısını sil",
      message: `"${item.displayName || item.audioFile || "bu ses"}" silinsin mi? Bu işlem geri alınamaz.`,
      confirmLabel: "Sil",
      danger: true
    });
    if (!ok) return;

    try {
      await deleteTtsOutput(itemId);
      setSelectedTtsOutput((prev) => {
        if (prev) {
          const prevId = prev.filename || prev.metadata;
          if (prevId === itemId) return null;
        }
        return prev;
      });
      refreshTtsOutputs();
    } catch (err) {
      console.error("Failed to delete TTS output:", err);
      showAlert({ title: "Silinemedi", message: err.message || String(err), danger: true });
    }
  }, [showConfirm, showAlert, refreshTtsOutputs]);

  useEffect(() => {
    refreshTtsOutputs();
  }, [refreshTtsOutputs]);

  // Yukle hardware ozellikler on mount
  useEffect(() => {
    async function loadSpecs() {
      try {
        const hardware = await getHardwareSpecs();
        const backendInfo = await getBackendOptions();
        setBackendOptions(backendInfo);
        setSpecs(hardware);
        // Default CPU is parcacigi count to match physical cores
        setConstraints((prev) => ({
          ...prev,
          threads: hardware.cpu_cores_physical || 4,
          backendType: prev.backendType === "auto" ? backendInfo.defaultBackendType || "cpu" : prev.backendType,
          useGpu: (prev.backendType === "auto" ? backendInfo.defaultBackendType : prev.backendType) !== "cpu",
        }));
        setTextSettings((prev) => ({
          ...prev,
          threads: prev.threads || hardware.cpu_cores_physical || 4
        }));
      } catch (err) {
        console.error("Error fetching hardware specs:", err);
      }
    }
    loadSpecs();
  }, []);

  const refreshReadiness = useCallback(async () => {
    setIsReadinessBusy(true);
    try {
      const [healthInfo, candidates] = await Promise.all([
        getHealth(),
        getCleanupCandidates().catch(() => []),
      ]);
      setHealth(healthInfo);
      setCleanupItems(candidates);
    } finally {
      setIsReadinessBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshReadiness();
  }, [refreshReadiness]);

  const copyDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await getDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setDiagnosticsCopied(true);
      setTimeout(() => setDiagnosticsCopied(false), 1800);
    } catch (err) {
      showAlert({ title: "Tanılama bilgisi alınamadı", message: err.message || String(err), danger: true });
    }
  }, [showAlert]);

  const cleanupSafeItems = useCallback(async () => {
    if (cleanupItems.length === 0) return;
    const totalBytes = cleanupItems.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
    const ok = await showConfirm({
      title: "Güvenli dosyalar temizlensin mi?",
      message: `Toplam ${cleanupItems.length} geçici/önbellek öğesi silinip yaklaşık ${formatBytes(totalBytes)} yer açılsın mı?

Modeller ve üretilen çıktılar buna dahil değildir.`,
      confirmLabel: "Temizle",
      danger: true,
    });
    if (!ok) return;

    setIsReadinessBusy(true);
    try {
      await cleanupCandidates(cleanupItems.map((item) => item.id));
      await refreshReadiness();
    } catch (err) {
      showAlert({ title: "Temizleme başarısız", message: err.message || String(err), danger: true });
    } finally {
      setIsReadinessBusy(false);
    }
  }, [cleanupItems, refreshReadiness, showAlert, showConfirm]);

  useEffect(() => {
    async function loadSavedOutputs() {
      const outputs = await listGeneratedOutputs();
      setGeneratedImages(outputs);
    }
    loadSavedOutputs();
  }, []);

  // Kaydet aktif model configuration to localStorage for persistence across reloads
  useEffect(() => {
    if (activeModel) {
      localStorage.setItem("active-model", activeModel);
    } else {
      localStorage.removeItem("active-model");
    }
  }, [activeModel]);

  // Check if sunucu is already running on mount (handles page yenile and startup lag)
  useEffect(() => {
    let checkInterval = null;

    async function checkServerRunning() {
      const status = await getBackendStatus();
      const isRunning = Boolean(status.ready);
      if (isRunning) {
        if (checkInterval) clearInterval(checkInterval);

        const savedModel = localStorage.getItem("active-model");
        if (savedModel) {
          setActiveModel(savedModel);
          setServerRunning(true);
        } else {
          // Query the aktif model from status if possible, otherwise use fallback
          try {
            if (status && status.settings && status.settings.model) {
              const modelName = status.settings.model.split(/[\\/]/).pop();
              setActiveModel(modelName);
            }
          } catch (_) {}
          setServerRunning(true);
        }
      } else {
        // If sunucu is not running, check if they had a simulated model aktif in browser mode
        const isTauriDesktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
        if (!isTauriDesktop) {
          const savedModel = localStorage.getItem("active-model");
          if (savedModel) {
            setActiveModel(savedModel);
            setServerRunning(false);
          }
        }
      }
    }

    checkServerRunning();
    // Poll every 2 seconds to auto-detect when the arka uc becomes hazir
    checkInterval = setInterval(checkServerRunning, 2000);

    return () => {
      if (checkInterval) clearInterval(checkInterval);
    };
  }, []);

  // Poll sistem telemetry kullanim statistics on interval
  useEffect(() => {
    async function updateTelemetry() {
      try {
        const stats = await getTelemetry();
        setTelemetry((prev) => (
          prev.cpu_usage === stats.cpu_usage &&
          prev.ram_used_gb === stats.ram_used_gb &&
          prev.ram_total_gb === stats.ram_total_gb &&
          prev.gpu_name === stats.gpu_name &&
          prev.vram_used_gb === stats.vram_used_gb &&
          prev.vram_total_gb === stats.vram_total_gb
            ? prev
            : stats
        ));
      } catch (err) {
        // Telemetry errors ignored
      }
    }

    updateTelemetry();
    const interval = setInterval(updateTelemetry, 1500); // Poll every 1.5 seconds

    return () => clearInterval(interval);
  }, []);

  // Model secilince: aileyi dosya iceriginden ogren, profile gore varsayilanlari uygula
  const [modelBilgisi, setModelBilgisi] = useState(null);
  useEffect(() => {
    if (!activeModel) {
      setModelBilgisi(null);
      return undefined;
    }
    const name = activeModel.toLowerCase();
    if (name.includes("lcm-dreamshaper-v7-fp16")) {
      setModelBilgisi(null);
      setConstraints((prev) => ({
        ...prev,
        steps: 4,
        npuSteps: 4,
        cfgScale: 1.0,
        width: 512,
        height: 512,
        backendType: "openvino-npu",
        useGpu: true,
      }));
      return undefined;
    }
    let iptal = false;
    getModelDetails(activeModel)
      .catch(() => ({ filename: activeModel, family: "bilinmiyor", familyLabel: "Bilinmiyor", source: "", distilled: null }))
      .then((bilgi) => {
        if (iptal) return;
        setModelBilgisi(bilgi);
        const profil = profilOlustur(bilgi);
        setConstraints((prev) => {
          const boyutGecerli = Object.values(profil.boyutlar).some(([w, h]) => w === prev.width && h === prev.height);
          const [w, h] = boyutGecerli ? [prev.width, prev.height] : profil.boyutlar["1:1"];
          return {
            ...prev,
            steps: profil.adim.varsayilan,
            standardSteps: profil.adim.varsayilan,
            cfgScale: profil.cfg.varsayilan,
            width: w,
            height: h,
            sampler: prev.sampler || profil.ornekleyici,
            scheduler: prev.scheduler || "",
            clipSkip: profil.clipSkip ? (prev.clipSkip || 0) : 0,
          };
        });
      });
    return () => {
      iptal = true;
    };
  }, [activeModel]);

  // Tab contents are kept mounted to preserve yukleniyor/uretim state when switching tabs

  const sidebarContent = useMemo(() => (
    <Sidebar
      collapsed={!sidebarVisible}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      specs={specs}
      conversations={conversations}
      activeConversationId={activeConversationId}
      setActiveConversationId={setActiveConversationId}
      showHistory={showHistory}
      setShowHistory={setShowHistory}
      onDeleteConversation={handleDeleteConversation}
      onRenameConversation={handleRenameConversation}
      speechTranscriptions={speechTranscriptions}
      selectedSpeechTranscript={selectedSpeechTranscript}
      setSelectedSpeechTranscript={setSelectedSpeechTranscript}
      showSpeechHistory={showSpeechHistory}
      setShowSpeechHistory={setShowSpeechHistory}
      onDeleteSpeechTranscription={handleDeleteSpeechTranscription}
      ttsOutputs={ttsOutputs}
      selectedTtsOutput={selectedTtsOutput}
      setSelectedTtsOutput={setSelectedTtsOutput}
      showTtsHistory={showTtsHistory}
      setShowTtsHistory={setShowTtsHistory}
      onDeleteTtsOutput={handleDeleteTtsOutput}
    />
  ), [sidebarVisible, activeTab, specs, conversations, activeConversationId, showHistory, handleDeleteConversation, speechTranscriptions, selectedSpeechTranscript, showSpeechHistory, handleDeleteSpeechTranscription, ttsOutputs, selectedTtsOutput, showTtsHistory, handleDeleteTtsOutput]);

  const handleStopServer = useCallback(async () => {
    if (!serverRunning || isStoppingServer) return;
    setIsStoppingServer(true);
    try {
      await stopServer();
      setServerRunning(false);
      setActiveModel(null);
    } catch (err) {
      console.error("Failed to stop server:", err);
      showAlert({ title: "Sunucu durdurulamadı", message: err.message || String(err), danger: true });
    } finally {
      setIsStoppingServer(false);
    }
  }, [serverRunning, isStoppingServer, showAlert]);

  // Önceki oturumdan yarım kalan görsel işleri kendiliğinden başlamaz: girişten sonra sorulur
  useEffect(() => {
    if (!girisDurumu?.girisli) return;
    let iptal = false;
    (async () => {
      try {
        const d = await (await fetch("/api/is-kuyrugu")).json();
        const n = Array.isArray(d.yarim) ? d.yarim.length : 0;
        if (!n || iptal) return;
        const surdur = await showConfirm({ title: "Yarım kalan iş", message: `Uygulama kapanırken yarım kalan ${n} görsel işi var. Kaldığı yerden yeniden başlatılsın mı? (Başlatılmazsa iptal edilir.)`, confirmLabel: "Sürdür", cancelLabel: "İptal et" });
        await fetch("/api/is-kuyrugu/yarim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ islem: surdur ? "surdur" : "iptal" }) });
      } catch (_) {}
    })();
    return () => { iptal = true; };
  }, [girisDurumu?.girisli, showConfirm]);

  // Kullanıcı zorunlu: hiç kullanıcı yoksa önce yönetici hesabı oluşturulur; varsa giriş istenir
  if (girisDurumu === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--md-sys-color-background)", color: "var(--md-sys-color-on-background)", fontSize: "0.95rem", opacity: 0.85 }}>
        Yerel AI Stüdyosu açılıyor…
      </div>
    );
  }
  if (girisDurumu && (!girisDurumu.kurulum || !girisDurumu.girisli)) {
    return <GirisEkrani ilk={!girisDurumu.kurulum} kullanicilar={girisDurumu.kullanicilar || []} onGiris={() => window.location.reload()} />;
  }

  return (
    <div className="app-container">
      {/* Sidebar with Navigation Rail & Specs */}
      {sidebarContent}

      {/* Main Panel */}
      <div className="main-content">
        {/* Top telemetry specs chips bar */}
        <TopStatusBar
          telemetry={telemetry}
          serverRunning={serverRunning}
          activeModel={activeModel}
          isLlmLoaded={isLlmLoaded}
          onStopServer={handleStopServer}
          isStoppingServer={isStoppingServer}
          theme={theme}
          setTheme={setTheme}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => setSidebarVisible(!sidebarVisible)}
          sagEk={<AgKalkaniDurum onAc={() => setActiveTab("settings")} showConfirm={showConfirm} showAlert={showAlert} />}
        />
        {/* Kırmızı bayrak: internete çıkmaya çalışıp durdurulan motorlar; kalkan kurulu değilse uyarı */}
        <AgKalkaniUyari showAlert={showAlert} />

        {/* Dynamic Workspace Container */}
        <div style={{ display: activeTab === "generator" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <Generator
            prompt={prompt}
            setPrompt={setPrompt}
            negativePrompt={negativePrompt}
            setNegativePrompt={setNegativePrompt}
            constraints={constraints}
            setConstraints={setConstraints}
            activeModel={activeModel}
            generatedImages={generatedImages}
            setGeneratedImages={setGeneratedImages}
            isGenerating={isGenerating}
            setIsGenerating={setIsGenerating}
            generationProgress={generationProgress}
            setGenerationProgress={setGenerationProgress}
            setActiveTab={setActiveTab}
            showAlert={showAlert}
            showConfirm={showConfirm}
            specs={specs}
            textSettings={textSettings}
            setActiveModel={setActiveModel}
            modelBilgisi={modelBilgisi}
            setModelBilgisi={setModelBilgisi}
            backendOptions={backendOptions}
            setBackendOptions={setBackendOptions}
            serverRunning={serverRunning}
            setServerRunning={setServerRunning}
          />
        </div>

        <div style={{ display: activeTab === "models" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <ModelManager
            activeModel={activeModel}
            setActiveModel={setActiveModel}
            serverRunning={serverRunning}
            setServerRunning={setServerRunning}
            constraints={constraints}
            setConstraints={setConstraints}
            telemetry={telemetry}
            backendOptions={backendOptions}
            showAlert={showAlert}
            showConfirm={showConfirm}
            activeTab={activeTab}
            specs={specs}
            textSettings={textSettings}
          />
        </div>

        <div style={{ display: activeTab === "chat" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <TextChat
            specs={specs}
            showAlert={showAlert}
            showConfirm={showConfirm}
            textSettings={textSettings}
            setTextSettings={setTextSettings}
            setActiveModel={setActiveModel}
            setServerRunning={setServerRunning}
            conversations={conversations}
            setConversations={setConversations}
            activeConversationId={activeConversationId}
            setActiveConversationId={setActiveConversationId}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
            saveConversationState={saveConversationState}
            setIsLlmLoaded={setIsLlmLoaded}
            speechSettings={speechSettings}
            ttsSettings={ttsSettings}
          />
        </div>

        <div style={{ display: activeTab === "speech" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <SpeechTranscriber
            showAlert={showAlert}
            showConfirm={showConfirm}
            selectedTranscript={selectedSpeechTranscript}
            onTranscriptionsChanged={refreshSpeechTranscriptions}
            speechSettings={speechSettings}
            setSpeechSettings={setSpeechSettings}
          />
        </div>

        <div style={{ display: activeTab === "tts" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <TextToSpeech
            showAlert={showAlert}
            showConfirm={showConfirm}
            selectedOutput={selectedTtsOutput}
            onOutputsChanged={refreshTtsOutputs}
            ttsSettings={ttsSettings}
            setTtsSettings={setTtsSettings}
          />
        </div>

        <div style={{ display: activeTab === "muzik" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <MuzikStudyosu showAlert={showAlert} showConfirm={showConfirm} aktif={activeTab === "muzik"} onGoToTts={() => setActiveTab("tts")} />
        </div>

        <div style={{ display: activeTab === "video" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <VideoStudyosu showAlert={showAlert} showConfirm={showConfirm} aktif={activeTab === "video"} />
        </div>

        <div style={{ display: activeTab === "settings" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <Settings
            constraints={constraints}
            setConstraints={setConstraints}
            activeModel={activeModel}
            specs={specs}
            backendOptions={backendOptions}
            setBackendOptions={setBackendOptions}
            serverRunning={serverRunning}
            setServerRunning={setServerRunning}
            setActiveModel={setActiveModel}
            showAlert={showAlert}
            showConfirm={showConfirm}
            textSettings={textSettings}
            setTextSettings={setTextSettings}
            speechSettings={speechSettings}
            setSpeechSettings={setSpeechSettings}
            ttsSettings={ttsSettings}
            setTtsSettings={setTtsSettings}
            health={health}
            cleanupItems={cleanupItems}
            isReadinessBusy={isReadinessBusy}
            refreshReadiness={refreshReadiness}
            copyDiagnostics={copyDiagnostics}
            cleanupSafeItems={cleanupSafeItems}
            diagnosticsCopied={diagnosticsCopied}
            theme={theme}
            setTheme={setTheme}
            fontSize={fontSize}
            setFontSize={setFontSize}
            setActiveTab={setActiveTab}
          />
        </div>
      </div>

      <GuncellemeBildirimi showAlert={showAlert} showConfirm={showConfirm} />

      <IlkKurulumSihirbazi
        showConfirm={showConfirm}
        setActiveTab={setActiveTab}
        textSettings={textSettings}
        setTextSettings={setTextSettings}
      />

      {dialog && (
        <div className="app-dialog-backdrop" role="presentation">
          <div className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
            <h3 id="app-dialog-title" className="app-dialog-title">{dialog.title}</h3>
            <p className="app-dialog-message">{dialog.message}</p>
            <div className="app-dialog-actions">
              {dialog.type === "confirm" && (
                <button className="m3-btn m3-btn-outlined" onClick={() => closeDialog(false)}>
                  {dialog.cancelLabel}
                </button>
              )}
              <button
                className={`m3-btn ${dialog.danger ? "m3-btn-error" : "m3-btn-filled"}`}
                onClick={() => closeDialog(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

import React, { memo, useEffect, useState, useCallback } from "react";
import {
  Crop, Sliders, Cpu, Info, MessageSquare, SlidersHorizontal, Zap,
  ChevronDown, Image, Type, Settings2, Gauge, Brain, Sparkles,
  Monitor, HardDrive, MemoryStick, Thermometer, Hash, Layers,
  ChevronRight, Box, Wand2, Lightbulb, RotateCcw, Check, Palette, Volume2,
  DownloadCloud, RefreshCw
} from "lucide-react";
import {
  stopServer,
  formatBytes,
  getLlmBackends,
  getLlmStats,
  getLlmStatus,
  benchmarkLlm,
  startLlm,
  stopLlm,
  downloadBackend,
  getDownloadProgress,
  getBackendOptions,
} from "../services/api";
import { THEMES } from "../themes";
import KullaniciHafiza from "./KullaniciHafiza";
import UygulamaGuncelleme from "./UygulamaGuncelleme";
import { AgKalkaniKarti } from "./AgKalkani";
import AnaDirektifler from "./AnaDirektifler";

// --- Collapsible Card Component ---
function CollapsibleCard({ icon: Icon, title, subtitle, children, defaultExpanded = false, id, badge, badgeColor }) {
  const [isExpanded, setIsExpanded] = useState(() => {
    const saved = localStorage.getItem(`settings_card_${id}`);
    return saved !== null ? saved === "true" : defaultExpanded;
  });

  const toggle = useCallback(() => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    localStorage.setItem(`settings_card_${id}`, String(newState));
  }, [isExpanded, id]);

  return (
    <div className="collapsible-card">
      <button
        className="collapsible-header"
        onClick={toggle}
        aria-expanded={isExpanded}
        type="button"
      >
        <div className="collapsible-header-left">
          <div className="collapsible-header-icon">
            <Icon size={18} />
          </div>
          <div>
            <div className="collapsible-header-title">
              {title}
              {badge && (
                <span 
                  className="collapsible-header-badge" 
                  style={{ 
                    background: badgeColor || "var(--md-sys-color-primary-container)",
                    color: badgeColor ? "#fff" : "var(--md-sys-color-on-primary-container)"
                  }}
                >
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <div className="collapsible-header-subtitle">{subtitle}</div>}
          </div>
        </div>
        <div className="collapsible-header-right">
          <ChevronDown
            size={20}
            className={`collapsible-chevron ${isExpanded ? "expanded" : ""}`}
          />
        </div>
      </button>
      {isExpanded && (
        <div className="collapsible-content">
          {children}
        </div>
      )}
    </div>
  );
}

// --- Hardware Tier Badge Component ---
function HardwareTierBadge({ specs }) {
  if (!specs?.tier) return null;

  const tierConfig = {
    high: { icon: "", label: "Yüksek Performanslı PC", color: "tier-high", accent: "#22c55e" },
    mid: { icon: "", label: "Dengeli PC", color: "tier-mid", accent: "#3b82f6" },
    low: { icon: "", label: "Düşük Performanslı PC", color: "tier-low", accent: "#f59e0b" },
  };

  const tier = tierConfig[specs.tier] || tierConfig.low;
  const rec = specs.recommended_text_settings;

  return (
    <div className={`hardware-tier-badge ${tier.color}`}>
      <div className="hardware-tier-header">
        <div className="hardware-tier-icon">{tier.icon}</div>
        <div className="hardware-tier-info">
          <div className="hardware-tier-name">{tier.label}</div>
          <div className="hardware-tier-specs">
            {specs.cpu_name}  {specs.cpu_cores_physical} cores  {specs.ram_total_gb}GB RAM
            {specs.gpu_name && specs.gpu_name !== "Loading..." && `  ${specs.gpu_name}`}
            {specs.gpu_vram_gb > 0 && `  ${specs.gpu_vram_gb}GB VRAM`}
          </div>
        </div>
      </div>
      {rec && (
        <>
          <div className="hardware-tier-divider" />
          <div className="hardware-tier-chips">
            <span className="hardware-tier-chip">Bağlam: {rec.contextSize}</span>
            <span className="hardware-tier-chip">İş parçacığı: {rec.threads}</span>
            <span className="hardware-tier-chip">KV: {rec.cacheTypeK}</span>
            <span className="hardware-tier-chip">Toplu işlem: {rec.batchSize}</span>
            <span className="hardware-tier-chip">Profil: {rec.performanceProfile}</span>
          </div>
        </>
      )}
    </div>
  );
}

// --- Premium Toggle Component ---
function PremiumToggle({ checked, onChange, label, description }) {
  return (
    <label className="premium-toggle" style={{ cursor: "pointer" }}>
      <div
        className={`premium-toggle-checkbox ${checked ? "checked" : ""}`}
        onClick={() => onChange(!checked)}
        role="checkbox"
        aria-checked={checked}
      >
        {checked && <Check size={14} />}
      </div>
      <div style={{ flex: 1 }}>
        <div className="premium-toggle-label">{label}</div>
        {description && <div className="premium-toggle-desc">{description}</div>}
      </div>
    </label>
  );
}

// --- Section Header Component ---
function SectionHeader({ icon: Icon, title, count, color, isExpanded, onToggle }) {
  return (
    <div
      className="settings-section-header"
      style={{
        borderLeftColor: color,
        cursor: "pointer",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={isExpanded}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "14px", flex: 1 }}>
        <div className="settings-section-icon" style={{ background: color + "15", color }}>
          <Icon size={22} />
        </div>
        <div className="settings-section-title">{title}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {count && (
          <span className="settings-section-count">{count} ayar</span>
        )}
        <ChevronDown
          size={20}
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s var(--md-transition-easing)",
            color: isExpanded ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline)",
            flexShrink: 0
          }}
        />
      </div>
    </div>
  );
}

const getSliderStyle = (value, min, max) => {
  const v = Number(value);
  const mn = Number(min);
  const mx = Number(max);
  const pct = mx === mn ? 0 : ((v - mn) / (mx - mn)) * 100;
  return { "--value": `${pct}%` };
};

// --- Main Ayarlar Component ---
function Settings({
  constraints,
  setConstraints,
  activeModel,
  specs,
  backendOptions,
  setBackendOptions,
  serverRunning,
  setServerRunning,
  setActiveModel,
  textSettings,
  setTextSettings,
  speechSettings,
  setSpeechSettings,
  ttsSettings,
  setTtsSettings,
  showAlert = async ({ message }) => window.alert(message),
  showConfirm = async ({ message }) => window.confirm(message),
  health,
  cleanupItems,
  isReadinessBusy,
  refreshReadiness,
  copyDiagnostics,
  cleanupSafeItems,
  diagnosticsCopied,
  theme,
  setTheme,
  fontSize,
  setFontSize,
  setActiveTab,
}) {
  const [llmStatus, setLlmStatus] = useState({ ready: false, settings: {} });
  const [llmBackends, setLlmBackends] = useState({ available: [], candidates: [] });
  const [llmStats, setLlmStats] = useState({ benchmarks: [] });
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [pendingTextSettings, setPendingTextSettings] = useState(textSettings || {});

  useEffect(() => {
    if (textSettings) {
      setPendingTextSettings(textSettings);
    }
  }, [textSettings]);

  const EDITABLE_TEXT_KEYS = [
    "systemPrompt", "contextSize", "temperature", "responseTokenMode", 
    "maxTokens", "seed", "performanceProfile", "threads", 
    "gpuLayers", "batchSize", "cacheTypeK", "cacheTypeV", "preferredBackend"
  ];

  const hasPendingChanges = textSettings && pendingTextSettings && EDITABLE_TEXT_KEYS.some(key => {
    return pendingTextSettings[key] !== textSettings[key];
  });

  const handleSaveTextSettings = async () => {
    try {
      setTextSettings(pendingTextSettings);
      if (llmStatus.ready) {
        await stopLlm();
        setLlmStatus((prev) => ({ ...prev, ready: false, running: false }));
        showAlert({
          title: "Ayarlar Kaydedildi ve Uygulandı",
          message: "Metin ayarları başarıyla kaydedildi. Değişikliklerin uygulanması için çalışan metin modeli bellekten çıkarıldı."
        });
      } else {
        showAlert({
          title: "Ayarlar Kaydedildi",
          message: "Metin ayarları başarıyla kaydedildi."
        });
      }
    } catch (err) {
      showAlert({
        title: "Kayıt Başarısız",
        message: err.message || String(err),
        danger: true
      });
    }
  };

  const [expandedSections, setExpandedSections] = useState(() => {
    return {
      appearance: localStorage.getItem("settings_section_appearance") === "true",
      image: localStorage.getItem("settings_section_image") === "true",
      text: localStorage.getItem("settings_section_text") === "true",
      speech: localStorage.getItem("settings_section_speech") === "true",
      tts: localStorage.getItem("settings_section_tts") === "true",
    };
  });

  const toggleSection = (section) => {
    setExpandedSections((prev) => {
      const nextState = !prev[section];
      localStorage.setItem(`settings_section_${section}`, String(nextState));
      return { ...prev, [section]: nextState };
    });
  };

  useEffect(() => {
    let cancelled = false;
    const fetchLlmStatus = async () => {
      try {
        const status = await getLlmStatus();
        if (!cancelled) setLlmStatus(status);
      } catch (_) {}
      try {
        const [backends, stats] = await Promise.all([getLlmBackends(), getLlmStats()]);
        if (!cancelled) {
          setLlmBackends(backends);
          setLlmStats(stats);
        }
      } catch (_) {}
    };
    fetchLlmStatus();
    const interval = setInterval(fetchLlmStatus, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const supportsThinking = Boolean(llmStatus.ready && llmStatus.settings?.supportsThinking);
  const refreshBackendOptions = useCallback(async () => {
    if (typeof setBackendOptions !== "function") return;
    const nextOptions = await getBackendOptions();
    setBackendOptions(nextOptions);
  }, [setBackendOptions]);

  useEffect(() => {
    refreshBackendOptions().catch(() => {});
    const handleFocus = () => refreshBackendOptions().catch(() => {});
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshBackendOptions]);


  const updateTextSetting = (key, value) => {
    setPendingTextSettings((prev) => {
      const updated = { ...prev, [key]: value };
      
      // If the user secili a preset performance profile, apply its hardware parameters
      if (key === "performanceProfile") {
        const presets = specs?.recommended_text_settings;
        if (presets) {
          let preset = null;
          if (value === "potato") preset = presets.low;
          else if (value === "balanced") preset = presets.mid;
          else if (value === "high") preset = presets.high;
          
          if (preset) {
            Object.assign(updated, {
              contextSize: preset.contextSize,
              threads: preset.threads,
              gpuLayers: preset.gpuLayers,
              cacheTypeK: preset.cacheTypeK,
              cacheTypeV: preset.cacheTypeV,
              flashAttn: preset.flashAttn,
              mlock: preset.mlock,
              mmap: preset.mmap,
              cachePrompt: preset.cachePrompt,
              batchSize: preset.batchSize,
              ubatchSize: preset.ubatchSize,
            });
          }
        }
      } else {
        // If the user manually overrides any performance-related ayar, auto-switch profile to "custom"
        const isPerformanceKey = [
          "contextSize", "threads", "gpuLayers", "cacheTypeK", "cacheTypeV",
          "flashAttn", "mlock", "mmap", "cachePrompt", "batchSize", "ubatchSize"
        ].includes(key);
        
        if (isPerformanceKey) {
          updated.performanceProfile = "custom";
        }
      }
      
      return updated;
    });
  };

  const updateSpeechSetting = (key, value) => {
    setSpeechSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const updateTtsSetting = (key, value) => {
    setTtsSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const buildTextStartOptions = (settings) => ({
    threads: settings?.threads || specs?.cpu_cores_physical || 4,
    contextSize: settings?.contextSize ?? 0,
    gpuLayers: settings?.gpuLayers ?? -1,
    enableThinking: settings?.enableThinking === true,
    flashAttn: settings?.flashAttn,
    cacheTypeK: settings?.cacheTypeK,
    cacheTypeV: settings?.cacheTypeV,
    mlock: settings?.mlock,
    mmap: settings?.mmap,
    cachePrompt: settings?.cachePrompt,
    defragThold: settings?.defragThold,
    batchSize: settings?.batchSize,
    ubatchSize: settings?.ubatchSize,
    performanceProfile: settings?.performanceProfile,
    preferredBackend: settings?.preferredBackend,
  });

  const handleBenchmarkTextBackend = async () => {
    const model = llmStatus.settings?.model;
    if (!model) {
      showAlert({ title: "Metin Modeli Yüklü Değil", message: "Kıyaslamadan önce bir GGUF metin modeli yükleyin.", danger: true });
      return;
    }
    setBenchmarkBusy(true);
    try {
      const result = await benchmarkLlm(model, {
        contextSize: Math.min(2048, Number(pendingTextSettings?.contextSize) || 2048),
        gpuLayers: pendingTextSettings?.gpuLayers ?? -1,
        includeCpu: true,
      });
      const winner = result.winner;
      showAlert({
        title: winner ? "Kıyaslama Tamamlandı" : "Kıyaslama Bitti",
        message: winner
          ? `En hızlı motor: ${winner.backendMode}, ${Number(winner.predicted_per_second || 0).toFixed(1)} jeton/sn.`
          : "Kıyaslama bitti ancak hiçbir motor kullanılabilir zamanlama verisi döndürmedi.",
      });
      const [status, backends, stats] = await Promise.all([getLlmStatus(), getLlmBackends(true), getLlmStats()]);
      setLlmStatus(status);
      setLlmBackends(backends);
      setLlmStats(stats);
    } catch (err) {
      showAlert({ title: "Kıyaslama Başarısız", message: err.message || String(err), danger: true });
    } finally {
      setBenchmarkBusy(false);
    }
  };

  const handleThinkingToggle = async (enabled) => {
    const nextSettings = { ...pendingTextSettings, enableThinking: enabled };

    let status = null;
    try {
      status = await getLlmStatus();
    } catch (_) {}
    if (!status?.ready || !status?.settings?.model) {
      setPendingTextSettings(nextSettings);
      setTextSettings(nextSettings);
      return;
    }

    const reload = await showConfirm({
      title: enabled ? "DeepThink ile Yeniden Yüklensin mi?" : "DeepThink Olmadan Yeniden Yüklensin mi?",
      message: "DeepThink'i değiştirmek, yeni yanıtları etkilemesi için metin modelinin yeniden yüklenmesini gerektirir. Şimdi yeniden yüklensin mi, yoksa atlanıp yüklü model olduğu gibi mi kalsın?",
      confirmLabel: "Yeniden Yükle",
      cancelLabel: "Atla",
    });
    if (!reload) return;

    try {
      setPendingTextSettings(nextSettings);
      setTextSettings(nextSettings);
      await stopLlm();
      await startLlm(status.settings.model, buildTextStartOptions(nextSettings));
    } catch (err) {
      await showAlert({
        title: "Yeniden Yükleme Başarısız",
        message: err.message || String(err),
        danger: true,
      });
    }
  };

  // --- Metin Ayarlar ---
  const renderTextSettings = () => (
    <>
      <SectionHeader 
        icon={Type} 
        title="Metin Üretimi" 
        count={5}
        color="#8b5cf6"
        isExpanded={expandedSections.text}
        onToggle={() => toggleSection("text")}
      />
      
      {expandedSections.text && (
        <div className="settings-expanded-content">
          <div className="settings-two-column">
        {/* Sol Sutun */}
        <div className="settings-column">
          {/* Model ve Baglam */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <MessageSquare size={16} />
              Model ve Bağlam
            </div>
            <div className="m3-field-group">
              <div className="m3-text-field">
                <label className="m3-text-field-label">Sistem Mesajı</label>
                <textarea
                   className="m3-input"
                   value={pendingTextSettings.systemPrompt || ""}
                   onChange={(e) => updateTextSetting("systemPrompt", e.target.value)}
                   placeholder="Sistem mesajını girin..."
                   rows={3}
                   style={{ resize: "vertical", minHeight: "60px" }}
                />
                <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                  Asistanın kişiliğini ve talimatlarını tanımlar.{" "}
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent("ilk-kurulum-ac", { detail: { adim: "yapay-zeka" } }))}
                    style={{ background: "none", border: "none", padding: 0, color: "var(--md-sys-color-primary)", cursor: "pointer", font: "inherit", fontWeight: 700 }}
                  >
                    Adını değiştir / önerilen metni yükle
                  </button>
                </span>
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Bağlam Boyutu</span>
                  <span className="settings-value-badge">{pendingTextSettings.contextSize || 0}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.contextSize || 0}
                  onChange={(e) => updateTextSetting("contextSize", parseInt(e.target.value))}
                  min="0"
                  max="32768"
                  step="512"
                  style={getSliderStyle(pendingTextSettings.contextSize || 0, 0, 32768)}
                />
                <span className="settings-option-desc">
                  Model bellek sınırı. 0, varsayılan sınırı kullanır. (Önerilen: 0)
                </span>
              </div>
            </div>
          </div>

          {/* Uretim Parametreleri */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Settings2 size={16} />
              Üretim Parametreleri
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Sıcaklık</span>
                  <span className="settings-value-badge">{pendingTextSettings.temperature}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.temperature}
                  onChange={(e) => updateTextSetting("temperature", parseFloat(e.target.value))}
                  min="0"
                  max="2"
                  step="0.1"
                  style={getSliderStyle(pendingTextSettings.temperature, 0, 2)}
                />
                <span className="settings-option-desc">
                  Yaratıcılığı kontrol eder. Düşük = odaklı ve gerçekçi, Yüksek = yaratıcı ve çeşitli. (Önerilen: 0.7)
                </span>
              </div>


              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Azami Yanıt Jetonu</span>
                  <span className="settings-value-badge">
                    {(pendingTextSettings.responseTokenMode || "auto") === "auto" ? "Otomatik" : (pendingTextSettings.maxTokens || 1024)}
                  </span>
                </div>
                <div className="m3-segmented-button" style={{ marginBottom: "10px" }}>
                  {[
                    { id: "auto", label: "Otomatik" },
                    { id: "manual", label: "Manuel" },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      className={`m3-segment-item ${(pendingTextSettings.responseTokenMode || "auto") === mode.id ? "active" : ""}`}
                      onClick={() => updateTextSetting("responseTokenMode", mode.id)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                {(pendingTextSettings.responseTokenMode || "auto") === "manual" ? (
                  <>
                    <input
                      type="range"
                      className="m3-slider"
                      value={pendingTextSettings.maxTokens || 1024}
                      onChange={(e) => updateTextSetting("maxTokens", parseInt(e.target.value))}
                      min="64"
                      max="4096"
                      step="64"
                      style={getSliderStyle(pendingTextSettings.maxTokens || 1024, 64, 4096)}
                    />
                    <span className="settings-option-desc">
                      Manuel mod, kaydırıcı değerini kullanır.
                    </span>
                  </>
                ) : (
                  <span className="settings-option-desc">
                    Otomatik, uzunluğu bağlam penceresine göre dinamik olarak ayarlar. (Önerilen)
                  </span>
                )}
              </div>

              <div className="m3-text-field">
                <label className="m3-text-field-label">Seed</label>
                <input
                  type="number"
                  className="m3-input"
                  value={pendingTextSettings.seed}
                  onChange={(e) => updateTextSetting("seed", parseInt(e.target.value) || -1)}
                  placeholder="-1"
                />
                <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                  Tekrarlanabilirliği kontrol eder. Rastgele için -1, aynı yanıtlar için pozitif bir tam sayı kullanın. (Önerilen: -1)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sag Sutun */}
        <div className="settings-column">
          {/* Performans Profili */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Gauge size={16} />
              Performans Profili
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Profil</span>
                </div>
                <div className="m3-segmented-button">
                  {["potato", "balanced", "high", "custom"].map((profile) => (
                    <button
                      key={profile}
                      className={`m3-segment-item ${(pendingTextSettings.performanceProfile || "balanced") === profile ? "active" : ""}`}
                      onClick={() => updateTextSetting("performanceProfile", profile)}
                    >
                      {profile === "potato" ? "Düşük" : profile === "balanced" ? "Dengeli" : profile === "high" ? "Yüksek" : "Özel"}
                    </button>
                  ))}
                </div>
              </div>



              {llmBackends.available?.length > 1 && (
                <div className="m3-slider-group">
                  <div className="m3-slider-header">
                    <span className="m3-slider-label">Metin Motoru</span>
                  </div>
                  <div className="m3-segmented-button">
                    {llmBackends.available.map((backend) => (
                      <button
                        key={backend.key}
                        className={`m3-segment-item ${(pendingTextSettings.preferredBackend || "auto") === backend.key ? "active" : ""}`}
                        onClick={() => updateTextSetting("preferredBackend", backend.key)}
                      >
                        {backend.key === "cpu" ? "Yalnızca CPU" : backend.key.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">CPU İş Parçacığı</span>
                  <span className="settings-value-badge">{pendingTextSettings.threads || 4}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.threads || 4}
                  onChange={(e) => updateTextSetting("threads", parseInt(e.target.value))}
                  min="1"
                  max={specs?.cpu_cores_logical || 16}
                  style={getSliderStyle(pendingTextSettings.threads || 4, 1, specs?.cpu_cores_logical || 16)}
                />
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">GPU Katmanı</span>
                  <span className="settings-value-badge">{pendingTextSettings.gpuLayers === -1 ? "Tümü" : pendingTextSettings.gpuLayers}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.gpuLayers === -1 ? 50 : pendingTextSettings.gpuLayers}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    updateTextSetting("gpuLayers", val >= 50 ? -1 : val);
                  }}
                  min="0"
                  max="50"
                  style={getSliderStyle(pendingTextSettings.gpuLayers === -1 ? 50 : pendingTextSettings.gpuLayers, 0, 50)}
                />
                <span className="settings-option-desc">
                  50 = Tüm katmanlar GPU'da
                </span>
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Toplu İşlem Boyutu</span>
                  <span className="settings-value-badge">{pendingTextSettings.batchSize || 512}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.batchSize || 512}
                  onChange={(e) => updateTextSetting("batchSize", parseInt(e.target.value))}
                  min="64"
                  max="2048"
                  step="64"
                  style={getSliderStyle(pendingTextSettings.batchSize || 512, 64, 2048)}
                />
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">KV Önbelleği</span>
                </div>
                <div className="m3-segmented-button">
                  {["q4_0", "q8_0", "f16"].map((type) => (
                    <button
                      key={type}
                      className={`m3-segment-item ${(pendingTextSettings.cacheTypeK || "q8_0") === type ? "active" : ""}`}
                      onClick={() => {
                        updateTextSetting("cacheTypeK", type);
                        updateTextSetting("cacheTypeV", type);
                      }}
                    >
                      {type.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {hasPendingChanges && (
                <div className="settings-save-bar" style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 20px",
                  background: "color-mix(in srgb, var(--md-sys-color-primary) 10%, var(--bg-card))",
                  border: "1px solid color-mix(in srgb, var(--md-sys-color-primary) 30%, transparent)",
                  borderRadius: "14px",
                  marginTop: "20px",
                  gap: "16px",
                  flexWrap: "wrap",
                  animation: "fadeIn 0.2s ease",
                  width: "100%",
                  boxSizing: "border-box"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <Brain size={18} style={{ color: "var(--md-sys-color-primary)" }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Kaydedilmemiş Metin Üretimi Ayarları</div>
                      <div style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: "2px" }}>
                        {llmStatus.ready
                          ? "Kaydetmek, değişiklikleri uygulamak için etkin metin modelini bellekten çıkarır."
                          : "Değişiklikler bir sonraki model yüklemesinde uygulanır."}
                      </div>
                    </div>
                  </div>
                  <button
                    className="m3-btn m3-btn-filled"
                    onClick={handleSaveTextSettings}
                    style={{
                      background: "var(--md-sys-color-primary)",
                      color: "var(--md-sys-color-on-primary)",
                      border: "none",
                      borderRadius: "10px",
                      padding: "10px 18px",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      boxShadow: "0 2px 8px color-mix(in srgb, var(--md-sys-color-primary) 30%, transparent)",
                    }}
                  >
                    Kaydet ve Uygula
                  </button>
                </div>
              )}
            </div>
          </div>


        </div>
          </div>
        </div>
      )}
    </>
  );

  // --- Konusma Ayarlar ---
  const renderSpeechSettings = () => {
    const SPEECH_LANGUAGES = [
      { value: "auto", label: "Otomatik algıla" },
      { value: "tr", label: "Türkçe" },
      { value: "en", label: "İngilizce" },
      { value: "es", label: "İspanyolca" },
      { value: "fr", label: "Fransızca" },
      { value: "de", label: "Almanca" },
      { value: "it", label: "İtalyanca" },
      { value: "pt", label: "Portekizce" },
      { value: "hi", label: "Hintçe" },
      { value: "ja", label: "Japonca" },
      { value: "ko", label: "Korece" },
      { value: "zh", label: "Çince" },
    ];

    return (
      <>
        <SectionHeader 
          icon={Volume2} 
          title="Sesten Metne" 
          count={4}
          color="#10b981"
          isExpanded={expandedSections.speech}
          onToggle={() => toggleSection("speech")}
        />
        
        {expandedSections.speech && (
          <div className="settings-expanded-content">
            <div className="settings-two-column">
              {/* Sol Sutun */}
              <div className="settings-column">
                {/* Konusma Parametreleri */}
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Volume2 size={16} />
                    Döküm Ayarları
                  </div>
                  <div className="m3-field-group">
                    <div className="m3-text-field">
                      <label className="m3-text-field-label">Varsayılan Motor</label>
                      <select
                        className="m3-input"
                        value={speechSettings.backendPreference || "auto"}
                        onChange={(e) => updateSpeechSetting("backendPreference", e.target.value)}
                      >
                        <option value="auto">Otomatik - GPU kuruluysa</option>
                        <option value="vulkan">Vulkan GPU</option>
                        <option value="metal">Metal GPU</option>
                        <option value="cpu">CPU</option>
                      </select>
                      <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                        Otomatik, GPU'lu whisper.cpp motoru varsa onu kullanır; yoksa CPU'ya geçer.
                      </span>
                    </div>

                    <div className="m3-text-field">
                      <label className="m3-text-field-label">Varsayılan Dil</label>
                      <select 
                        className="m3-input" 
                        value={speechSettings.language || "auto"} 
                        onChange={(e) => updateSpeechSetting("language", e.target.value)}
                      >
                        {SPEECH_LANGUAGES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                        Sesi yazıya çevirirken kullanılacak varsayılan dil. (Önerilen: Türkçe. Otomatik algılama kısa kayıtlarda Türkçeyi başka dil sanabilir.)
                      </span>
                    </div>

                    <div className="m3-slider-group">
                      <div className="m3-slider-header">
                        <span className="m3-slider-label">CPU İş Parçacığı</span>
                        <span className="settings-value-badge">{speechSettings.threads || 4}</span>
                      </div>
                      <input
                        type="range"
                        className="m3-slider"
                        value={speechSettings.threads || 4}
                        onChange={(e) => updateSpeechSetting("threads", parseInt(e.target.value))}
                        min="1"
                        max={specs?.cpu_cores_logical || 16}
                        style={getSliderStyle(speechSettings.threads || 4, 1, specs?.cpu_cores_logical || 16)}
                      />
                      <span className="settings-option-desc">
                        Döküm için ayrılacak iş parçacığı sayısı. (Önerilen: 4)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sag Sutun */}
              <div className="settings-column">
                {/* Ceviri secenekleri */}
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Sparkles size={16} />
                    Çeviri Ayarları
                  </div>
                  <div className="m3-field-group">
                    <PremiumToggle
                      checked={speechSettings.translate === true}
                      onChange={(val) => updateSpeechSetting("translate", val)}
                      label="İngilizceye Çevir"
                      description="Döküm sırasında yabancı dilleri otomatik olarak İngilizceye çevir"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  // --- Appearance Ayarlar ---
  const renderTtsSettings = () => {
    const TTS_VOICES = [
      { value: "af_heart", label: "Heart - Kadın, ABD İngilizcesi" },
      { value: "af_bella", label: "Bella - Kadın, ABD İngilizcesi" },
      { value: "af_nicole", label: "Nicole - Kadın, ABD İngilizcesi" },
      { value: "af_sarah", label: "Sarah - Kadın, ABD İngilizcesi" },
      { value: "am_michael", label: "Michael - Erkek, ABD İngilizcesi" },
      { value: "am_fenrir", label: "Fenrir - Erkek, ABD İngilizcesi" },
      { value: "bf_emma", label: "Emma - Kadın, İngiliz İngilizcesi" },
      { value: "bm_george", label: "George - Erkek, İngiliz İngilizcesi" },
    ];

    return (
      <>
        <SectionHeader
          icon={Volume2}
          title="Metinden Sese"
          count={2}
          color="#8b5cf6"
          isExpanded={expandedSections.tts}
          onToggle={() => toggleSection("tts")}
        />

        {expandedSections.tts && (
          <div className="settings-expanded-content">
            <div className="settings-two-column">
              <div className="settings-column">
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Volume2 size={16} />
                    Ses Varsayılanları
                  </div>
                  <div className="m3-field-group">
                    <div className="m3-text-field">
                      <label className="m3-text-field-label">Varsayılan Ses</label>
                      <select
                        className="m3-input"
                        value={ttsSettings?.voice || "af_heart"}
                        onChange={(e) => updateTtsSetting("voice", e.target.value)}
                      >
                        {TTS_VOICES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                        Üretilen WAV dosyaları için varsayılan Kokoro sesi.
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-column">
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Gauge size={16} />
                    Konuşma Zamanlaması
                  </div>
                  <div className="m3-slider-group">
                    <div className="m3-slider-header">
                      <span className="m3-slider-label">Hız</span>
                      <span className="settings-value-badge">{(ttsSettings?.speed || 1).toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      className="m3-slider"
                      value={ttsSettings?.speed || 1}
                      onChange={(e) => updateTtsSetting("speed", parseFloat(e.target.value))}
                      min="0.5"
                      max="2"
                      step="0.05"
                      style={getSliderStyle(ttsSettings?.speed || 1, 0.5, 2)}
                    />
                    <span className="settings-option-desc">
                      1.00x doğal hızdır. Düşük değerler daha yavaş, yüksek değerler daha hızlıdır.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderAppearanceSettings = () => (
    <>
      <SectionHeader 
        icon={Palette} 
        title="Görünüm ve Temalar" 
        count={2}
        color="var(--md-sys-color-primary)"
        isExpanded={expandedSections.appearance}
        onToggle={() => toggleSection("appearance")}
      />
      
      {expandedSections.appearance && (
        <div className="settings-expanded-content">
          <div className="settings-subsection">
            {/* Renk Temalari Alt Bolumu */}
            <div className="settings-subsection-title">
              <Palette size={16} />
              Renk Temaları
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: "14px",
              marginTop: "14px"
            }}>
              {THEMES.map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`theme-card-btn ${isActive ? "active" : ""}`}
                    style={{
                      background: t.bg,
                      color: t.type === "dark" ? "#f4f4f5" : "#0f172a",
                      border: isActive ? "2px solid var(--md-sys-color-primary)" : "1px solid var(--border-color)",
                      borderRadius: "14px",
                      padding: "18px",
                      textAlign: "left",
                      cursor: "pointer",
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      gap: "14px",
                      boxShadow: isActive ? "0 4px 16px color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent)" : "none",
                      transition: "all 0.25s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.88rem", letterSpacing: "-0.01em" }}>{t.name}</span>
                      {isActive && (
                        <div style={{
                          background: "linear-gradient(135deg, var(--md-sys-color-primary), var(--md-sys-color-secondary))",
                          color: "var(--md-sys-color-on-primary)",
                          borderRadius: "50%",
                          width: "22px",
                          height: "22px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 2px 6px color-mix(in srgb, var(--md-sys-color-primary) 40%, transparent)"
                        }}>
                          <Check size={13} strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    
                    {/* Birincil ve ikincil renkler icin onizleme daireleri */}
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: t.primary, border: "2px solid rgba(255,255,255,0.25)", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }} title="Birincil" />
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: t.secondary, border: "2px solid rgba(255,255,255,0.25)", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }} title="İkincil" />
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: t.bg, border: "1.5px solid rgba(0,0,0,0.12)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.06)" }} title="Arka Plan" />
                      <span style={{ marginLeft: "auto", fontSize: "0.7rem", opacity: 0.6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {t.type === "dark" ? "Koyu" : "Açık"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Kart icindeki alt bolumleri ayiran ayrac */}
            <div style={{
              height: "1px",
              background: "var(--border-color)",
              margin: "24px 0"
            }} />

            {/* Metin ve Arayuz Boyutu Alt Bolumu */}
            <div className="settings-subsection-title">
              <Type size={16} />
              Metin ve Arayüz Boyutu
            </div>
            <div className="m3-slider-group" style={{ maxWidth: "480px", marginTop: "14px" }}>
              <div className="m3-slider-header">
                <span className="m3-slider-label">Yazı Boyutu</span>
                <span className="settings-value-badge">{fontSize || 16}px</span>
              </div>
              <input
                type="range"
                className="m3-slider"
                value={fontSize || 16}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
                min="12"
                max="24"
                step="1"
                style={getSliderStyle(fontSize || 16, 12, 24)}
              />
              <span className="settings-option-desc">
                Sohbet yanıtları ve ayar etiketleri dahil, uygulamadaki genel yazı boyutunu ayarlar. Varsayılan 16px'tir.
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="workspace-area">
      {/* Sayfa Basligi */}
      <div className="workspace-title-section">
        <h2 className="workspace-title">Ayarlar ve Parametreler</h2>
          <p className="workspace-subtitle">
            Yapay zekâ modellerinizi en iyi performans için yapılandırın.
          </p>
      </div>


      {/* Gorunum ve Temalar Bolumu */}
      {renderAppearanceSettings()}

      {/* Kullanıcı girişi ve kişisel hafıza */}
      <KullaniciHafiza showAlert={showAlert} showConfirm={showConfirm} />

      {/* Ana direktifler (yalnızca yöneticiye görünür) */}
      <AnaDirektifler showAlert={showAlert} showConfirm={showConfirm} />

      {/* Ağ kalkanı ve ağ gözcüsü */}
      <AgKalkaniKarti showAlert={showAlert} />

      {/* Uygulama güncellemesi (GitHub) */}
      <UygulamaGuncelleme showAlert={showAlert} showConfirm={showConfirm} />

      {/* İlk kurulum sihirbazı */}
      <div className="m3-card ayar-tasindi-karti">
        <div>
          <div className="m3-card-title" style={{ marginBottom: "4px" }}>
            <Wand2 size={18} style={{ color: "var(--md-sys-color-primary)" }} />
            İlk kurulum sihirbazı
          </div>
          <div className="settings-option-desc">
            Denenmiş model setini (sohbet, konuşma tanıma, Türkçe ses, görsel, müzik, ses efekti, video) önceden seçili, alternatifleriyle ve bu bilgisayara özel notlarla yeniden gösterir; isterseniz indirir.
            “Yapay zekânız” adımında asistanın adını ve sistem mesajını (önerilen metinle) ayarlayabilirsiniz.
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" className="m3-btn m3-btn-outlined" onClick={() => window.dispatchEvent(new CustomEvent("ilk-kurulum-ac", { detail: { adim: "yapay-zeka" } }))}>
            Yapay zekânızı düzenle
          </button>
          <button type="button" className="m3-btn m3-btn-tonal" onClick={() => window.dispatchEvent(new CustomEvent("ilk-kurulum-ac"))}>
            İlk kurulum sihirbazını yeniden aç
          </button>
        </div>
      </div>

      {/* Gorsel ayarlari artik Gorsel Uretici sayfasinda */}
      <div className="m3-card ayar-tasindi-karti">
        <div>
          <div className="m3-card-title" style={{ marginBottom: "4px" }}>
            <Image size={18} style={{ color: "var(--md-sys-color-primary)" }} />
            Görsel üretimi ayarları taşındı
          </div>
          <div className="settings-option-desc">
            Boyut, adım, CFG, örnekleyici, seed, bellek ve hızlandırıcı ayarları artık Görsel Stüdyo sayfasında; seçili modele göre otomatik gelir.
          </div>
        </div>
        <button type="button" className="m3-btn m3-btn-tonal" onClick={() => setActiveTab?.("generator")}>
          Görsel Stüdyo'ya git
        </button>
      </div>

      {/* Metin Ayarlari Bolumu */}
      {renderTextSettings()}

      {/* Konusma Ayarlari Bolumu */}
      {renderSpeechSettings()}

      {/* Metinden Sese Ayarlari Bolumu */}
      {renderTtsSettings()}
    </div>
  );
}

export default memo(Settings);

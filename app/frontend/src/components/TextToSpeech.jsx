import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LoaderCircle,
  Play,
  RefreshCw,
  Save,
  Square,
  Volume2,
} from "lucide-react";
import {
  getTtsStatus,
  listTtsModels,
  speakTts,
  startTts,
  stopTts,
} from "../services/api";
import KlonSesleri from "./KlonSesleri";

const FALLBACK_VOICES = [
  { id: "af_heart", name: "Heart", language: "en-us", gender: "Female" },
  { id: "af_bella", name: "Bella", language: "en-us", gender: "Female" },
  { id: "am_michael", name: "Michael", language: "en-us", gender: "Male" },
  { id: "bf_emma", name: "Emma", language: "en-gb", gender: "Female" },
  { id: "bm_george", name: "George", language: "en-gb", gender: "Male" },
];

function downloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function TextToSpeech({
  showAlert,
  showConfirm,
  selectedOutput,
  onOutputsChanged,
  ttsSettings,
  setTtsSettings,
}) {
  const [status, setStatus] = useState({ ready: false, running: false, runtimeInstalled: false, settings: {}, voices: [] });
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [text, setText] = useState("Yerel AI Stüdyosu metinden sese özelliğinden merhaba.");
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [output, setOutput] = useState(null);
  const abortRef = useRef(null);

  // Kokoro modelleri (EMA/Piper gibi motor girdileri ayrı seçeneklerle gösterilir)
  const installedModels = useMemo(() => models.filter((model) => model.installed && !model.motor), [models]);
  const sonEtkinRef = useRef("");
  const tumSesler = status.voices?.length ? status.voices : FALLBACK_VOICES;
  // Ses motorları: Kokoro modelleri + (kuruluysa) EMA Lightning ve Piper. EMA ve Piper
  // sunucuda sese göre seçildiği için "model" yerine bu özel değerler kullanılır.
  // Kurulu Türkçe ses motorları (sunucunun ses listesindeki "engine" alanından)
  const MOTOR_ETIKETLERI = { ema: "EMA Lightning (Türkçe, önerilen)", piper: "Piper (Türkçe)", antalia: "Antalia-2 Mini (Türkçe erkek)",
    supertonic: "Supertonic-3 (10 ses)", ahenk: "Ahenk Cep (Türkçe kadın, 7 ruh hali)", omnivoice: "OmniVoice (ses tasarımı ve klon)" };
  const kuruluMotorlar = useMemo(() => Object.keys(MOTOR_ETIKETLERI).filter((m) => tumSesler.some((v) => v.engine === m)), [tumSesler]);
  const motorSecenekleri = useMemo(() => [
    ...kuruluMotorlar.map((m) => ({ value: `__${m}__`, label: MOTOR_ETIKETLERI[m] })),
    ...installedModels.map((model) => ({ value: model.filename, label: `${model.name || model.filename} (Kokoro, İngilizce)` })),
  ], [kuruluMotorlar, installedModels]);
  const ozelMotor = (/^__([a-z]+)__$/.exec(selectedModel || "") || [])[1] || "";
  const voices = useMemo(() => tumSesler.filter((v) => (ozelMotor ? v.engine === ozelMotor : !v.engine || v.engine === "kokoro")), [tumSesler, ozelMotor]);
  const kayitliSes = ttsSettings?.voice || "af_heart";
  const selectedVoice = voices.some((v) => v.id === kayitliSes) ? kayitliSes : (voices[0]?.id || kayitliSes);
  const speed = ttsSettings?.speed || 1;

  const updateTtsSetting = (key, value) => {
    setTtsSettings((prev) => ({ ...prev, [key]: value }));
  };

  const refresh = useCallback(async () => {
    const [nextStatus, nextModels] = await Promise.all([
      getTtsStatus(),
      listTtsModels(),
    ]);
    setStatus(nextStatus);
    setModels(nextModels);
    setSelectedModel((current) => {
      const installed = nextModels.filter((model) => model.installed && !model.motor);
      const sesler = nextStatus.voices || [];
      // Model Yöneticisi'nde etkin ses değiştiyse bu sayfa da ona geçer
      const etkin = String(nextStatus.settings?.etkin || "");
      if (etkin && etkin !== sonEtkinRef.current) {
        sonEtkinRef.current = etkin;
        const etkinMotor = etkin.includes(":") ? etkin.split(":")[0] : "";
        if (etkinMotor && sesler.some((v) => v.engine === etkinMotor)) return `__${etkinMotor}__`;
        if (installed.some((model) => model.filename === etkin)) return etkin;
      }
      const secimMotoru = (/^__([a-z]+)__$/.exec(current || "") || [])[1];
      if (secimMotoru && sesler.some((v) => v.engine === secimMotoru)) return current;
      if (current && installed.some((model) => model.filename === current || model.id === current)) return current;
      // Seçim yoksa Türkçe için EMA öne çıkar
      if (!current && sesler.some((v) => v.engine === "ema")) return "__ema__";
      const active = nextStatus.settings?.model;
      if (active && installed.some((model) => model.filename === active)) return active;
      const preferred = ttsSettings?.model;
      if (preferred && installed.some((model) => model.filename === preferred)) return preferred;
      return installed.find((model) => model.recommended)?.filename || installed[0]?.filename || "";
    });
  }, [ttsSettings?.model]);

  useEffect(() => {
    refresh().catch((err) => showAlert?.({ title: "Metinden sese durumu alınamadı", message: err.message || String(err), danger: true }));
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 2500);
    return () => clearInterval(interval);
  }, [refresh, showAlert]);

  useEffect(() => {
    if (!selectedOutput) return;
    setOutput(selectedOutput);
    setText(selectedOutput.text || "");
    if (selectedOutput.voice) updateTtsSetting("voice", selectedOutput.voice);
    if (selectedOutput.speed) updateTtsSetting("speed", selectedOutput.speed);
    if (selectedOutput.model) setSelectedModel(selectedOutput.model);
  }, [selectedOutput]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleLoadModel = async () => {
    if (!selectedModel) return;
    setIsLoadingModel(true);
    try {
      await startTts(selectedModel, { voice: selectedVoice, speed });
      updateTtsSetting("model", selectedModel);
      await refresh();
    } catch (err) {
      showAlert?.({ title: "Metinden sese modeli yüklenemedi", message: err.message || String(err), danger: true });
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopTts();
      await refresh();
    } catch (err) {
      showAlert?.({ title: "Metinden sese motoru durdurulamadı", message: err.message || String(err), danger: true });
    }
  };

  const handleGenerate = async () => {
    if (!text.trim() || !selectedModel) return;
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (!isLoaded) {
        setIsLoadingModel(true);
        try {
          await startTts(selectedModel, { voice: selectedVoice, speed });
          updateTtsSetting("model", selectedModel);
          await refresh();
        } finally {
          setIsLoadingModel(false);
        }
      }
      const generated = await speakTts(text, {
        model: selectedModel,
        voice: selectedVoice,
        speed,
        signal: controller.signal,
      });
      setOutput(generated);
      await refresh();
      await onOutputsChanged?.();
    } catch (err) {
      if (err.name !== "AbortError") {
        showAlert?.({ title: "Ses üretilemedi", message: err.message || String(err), danger: true });
      }
    } finally {
      abortRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsGenerating(false);
  };

  const isLoaded = ozelMotor
    ? status.ready && status.settings?.voice === selectedVoice
    : status.ready && status.settings?.model === selectedModel;
  const motorKurulu = ozelMotor ? true : status.runtimeInstalled;

  return (
    <div className="workspace-area speech-workspace">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Metinden Sese</h2>
        <p className="workspace-subtitle">
          Yerel olarak WAV seslendirme üretin. Türkçe için EMA, Antalia, Ahenk, Supertonic ya da Piper; İngilizce için Kokoro.
        </p>
      </div>

      <div className="speech-grid">
        <section className="m3-card speech-panel">
          <div className="speech-panel-header">
            <h3>Çalışma ortamı</h3>
            <span className={`status-chip ${motorKurulu ? "" : "offline"}`}>
              {motorKurulu ? (isLoaded ? "Hazır" : "Kurulu") : "Çalışma ortamı kurulu değil"}
            </span>
          </div>

          {status.error && <div className="text-progress error">{status.error}</div>}

          <label className="speech-label">
            Ses motoru
            <select className="m3-input" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              {motorSecenekleri.length === 0 && <option value="">Kurulu metinden sese motoru yok</option>}
              {motorSecenekleri.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>

          <div className="speech-controls-row">
            <label className="speech-label">
              Ses
              <select className="m3-input" value={selectedVoice} onChange={(event) => updateTtsSetting("voice", event.target.value)}>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} ({voice.gender}, {voice.language})
                  </option>
                ))}
              </select>
            </label>
            <label className="speech-label">
              Hız
              <input
                className="m3-input"
                type="number"
                min="0.5"
                max="2"
                step="0.05"
                value={speed}
                onChange={(event) => updateTtsSetting("speed", Math.max(0.5, Math.min(2, Number(event.target.value) || 1)))}
              />
            </label>
          </div>

          <div className="speech-button-row">
            <button
              className="m3-btn m3-btn-filled"
              onClick={handleLoadModel}
              disabled={!selectedModel || isLoadingModel || isGenerating || isLoaded}
            >
              {isLoadingModel ? <LoaderCircle className="progress-spinner" size={14} /> : <Play size={14} />}
              <span>{isLoaded ? "Yüklü" : isLoadingModel ? "Yükleniyor" : "Yükle"}</span>
            </button>
            <button className="m3-btn m3-btn-outlined" onClick={refresh}>
              <RefreshCw size={14} />
              <span>Yenile</span>
            </button>
            {status.ready && (
              <button className="m3-btn m3-btn-error" onClick={handleStop}>
                <Square size={14} />
                <span>Çalışma ortamını durdur</span>
              </button>
            )}
          </div>

          {motorSecenekleri.length === 0 && (
            <div className="text-progress">
              Türkçe için ana klasördeki ses-motoru-kur.bat ile EMA Lightning'i kurun; İngilizce için Model Yöneticisi'nden bir Kokoro modeli indirin.
            </div>
          )}
          {ozelMotor === "omnivoice" && String(selectedVoice).startsWith("omnivoice:klon_") && (
            <div className="text-progress">
              Klon ses: işlemcide (ekran kartı olmadan) ilk kullanımda model birkaç dakikada yüklenir (sonraki 10 dakika bellekte kalır);
              ardından bir cümle yarım dakikadan birkaç dakikaya kadar sürebilir. Kısa metinlerle deneyin.
            </div>
          )}
        </section>

        <section className="m3-card speech-panel">
          <div className="speech-panel-header">
            <h3>Metin</h3>
            <span className="status-chip">{text.trim().length} chars</span>
          </div>
          <textarea
            className="m3-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            maxLength={5000}
            style={{ width: "100%", resize: "vertical", minHeight: "220px", lineHeight: 1.45 }}
            placeholder="Sese dönüştürülecek metni yazın..."
          />
          <div className="speech-button-row">
            {isGenerating ? (
              <button className="m3-btn m3-btn-error" onClick={handleCancel}>
                <Square size={14} />
                <span>İptal</span>
              </button>
            ) : (
              <button
                className="m3-btn m3-btn-filled"
                onClick={handleGenerate}
                disabled={!text.trim() || !selectedModel || !motorKurulu}
              >
                <Volume2 size={14} />
                <span>WAV üret</span>
              </button>
            )}
            {isGenerating && <span className="text-progress"><LoaderCircle className="progress-spinner" size={14} /> Yerel olarak üretiliyor...</span>}
          </div>
        </section>
      </div>

      {/* OmniVoice ses klonlama: yalnızca bu motor seçiliyken; onay penceresi olmadan klon eklenemez */}
      {ozelMotor === "omnivoice" && (
        <div className="speech-grid" style={{ gridTemplateColumns: "1fr" }}>
          <KlonSesleri
            showAlert={showAlert}
            showConfirm={showConfirm}
            onDegisti={async (sonuc) => {
              await refresh().catch(() => {});
              // Yeni eklenen ya da yeniden adlandırılan klon seçilir; silinen klon seçiliyse ilk sese dönülür
              if (sonuc?.sesKimligi && !sonuc?.silindi) updateTtsSetting("voice", sonuc.sesKimligi);
            }}
          />
        </div>
      )}

      <section className="m3-card speech-result-panel">
        <div className="speech-panel-header">
          <h3>Çıktı</h3>
          <div className="speech-button-row">
            <button className="m3-btn m3-btn-outlined" onClick={() => output?.url && downloadUrl(output.url, output.audioFile || "tts.wav")} disabled={!output?.url}>
              <Save size={14} />
              <span>WAV</span>
            </button>
          </div>
        </div>
        {output?.url ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <audio controls src={output.url} style={{ width: "100%" }} />
            <div className="text-progress">
              {output.voiceName || output.voice} &bull; {output.modelName || output.model} &bull; {new Date(output.createdAt).toLocaleString()}
            </div>
            <textarea
              className="m3-input"
              value={output.text || text}
              onChange={(event) => setOutput((prev) => ({ ...(prev || {}), text: event.target.value }))}
              rows={5}
              style={{ width: "100%", resize: "vertical", minHeight: "120px", lineHeight: 1.45 }}
            />
          </div>
        ) : (
          <div className="empty-state" style={{ padding: "32px 0" }}>
            <Volume2 size={42} />
            <p>Üretilen ses burada görünecek.</p>
          </div>
        )}
      </section>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileAudio,
  LoaderCircle,
  Mic,
  Play,
  Save,
  Square,
  Upload,
  X,
} from "lucide-react";
import {
  getSpeechStatus,
  listSpeechModels,
  startSpeech,
  stopSpeech,
  transcribeSpeech,
} from "../services/api";

const LANGUAGE_OPTIONS = [
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

function flattenFloat32(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
}

function resampleLinear(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const src = i * ratio;
    const left = Math.floor(src);
    const right = Math.min(input.length - 1, left + 1);
    const weight = src - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }
  return output;
}

function encodeWavPcm16(samples, sampleRate = 16000) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizeTimestamp(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const from = value.match(/from=([^;},]+)/)?.[1];
    const to = value.match(/to=([^;},]+)/)?.[1];
    return from && to ? `${from} - ${to}` : value;
  }
  if (typeof value === "object" && value.from && value.to) {
    return `${value.from} - ${value.to}`;
  }
  return "";
}

function formatTranscriptText(transcription, showTimestamps) {
  const segments = transcription?.raw?.transcription;
  if (!Array.isArray(segments) || segments.length === 0) {
    return transcription?.text || "";
  }
  return segments
    .map((segment) => {
      const text = String(segment.text || "").trim();
      if (!showTimestamps) return text;
      const time = normalizeTimestamp(segment.timestamps);
      return time ? `[${time}] ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

export default function SpeechTranscriber({
  showAlert,
  showConfirm,
  selectedTranscript,
  onTranscriptionsChanged,
  speechSettings,
  setSpeechSettings,
}) {
  const [status, setStatus] = useState({ ready: false, running: false, backendInstalled: false, settings: {} });
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const sonEtkinRef = useRef("");

  const language = speechSettings?.language || "auto";
  const threads = speechSettings?.threads || 4;
  const backendPreference = speechSettings?.backendPreference || "auto";
  const translate = speechSettings?.translate === true;

  const setLanguage = (val) => setSpeechSettings((prev) => ({ ...prev, language: val }));
  const setThreads = (val) => setSpeechSettings((prev) => ({ ...prev, threads: val }));
  const setBackendPreference = (val) => setSpeechSettings((prev) => ({ ...prev, backendPreference: val }));

  const [audioBlob, setAudioBlob] = useState(null);
  const [audioName, setAudioName] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [result, setResult] = useState(null);
  const [resultText, setResultText] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const recorderRef = useRef(null);
  const abortRef = useRef(null);

  const installedModels = useMemo(() => models.filter((model) => model.installed), [models]);
  const isSelectedRuntimeLoaded = status.ready &&
    status.settings?.model === selectedModel &&
    (status.settings?.backendPreference || "auto") === backendPreference;

  const isEnglishOnly = useMemo(() => {
    if (!selectedModel) return false;
    const model = models.find((m) => m.filename === selectedModel);
    return model?.language === "English" || selectedModel.toLowerCase().includes(".en");
  }, [selectedModel, models]);

  const refresh = useCallback(async () => {
    const [nextStatus, nextModels] = await Promise.all([
      getSpeechStatus(),
      listSpeechModels(),
    ]);
    setStatus(nextStatus);
    setModels(nextModels);
    setSelectedModel((current) => {
      const installed = nextModels.filter((model) => model.installed);
      const active = nextStatus.settings?.model;
      // Model Yöneticisi'nde (ya da başka yerde) etkin model değiştiyse bu sayfa da ona geçer
      if (active && active !== sonEtkinRef.current) {
        sonEtkinRef.current = active;
        if (installed.some((model) => model.filename === active)) return active;
      }
      if (current && installed.some((model) => model.filename === current || model.id === current)) return current;
      if (active && installed.some((model) => model.filename === active)) return active;
      // Varsayılan: çok dilli küçültülmüş Whisper small (q5); Seda/Duyu listeden seçilebilir
      return installed.find((model) => /small-q5/i.test(model.filename) && !/\.en\b/i.test(model.filename))?.filename ||
        installed.find((model) => model.recommended)?.filename ||
        installed[0]?.filename ||
        "";
    });
  }, []);

  useEffect(() => {
    refresh().catch((err) => showAlert?.({ title: "Konuşma motoru durumu alınamadı", message: err.message || String(err), danger: true }));
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [refresh, showAlert]);

  useEffect(() => {
    if (!selectedTranscript) return;
    setResult(selectedTranscript);
  }, [selectedTranscript]);

  useEffect(() => {
    if (!result) return;
    setResultText(formatTranscriptText(result, showTimestamps));
  }, [result, showTimestamps]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      abortRef.current?.abort();
    };
  }, [audioUrl]);

  const setCurrentAudio = useCallback((blob, name) => {
    setAudioBlob(blob);
    setAudioName(name);
    setResult(null);
    setResultText("");
    setAudioUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return URL.createObjectURL(blob);
    });
  }, []);

  const clearCurrentAudio = useCallback(() => {
    setAudioBlob(null);
    setAudioName("");
    setAudioUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return "";
    });
  }, []);

  const handleLoadSpeechModel = async () => {
    if (!selectedModel) return;
    setIsLoadingModel(true);
    try {
      if (!isSelectedRuntimeLoaded) {
        await startSpeech(selectedModel, { language, threads, backendPreference });
      }
      await refresh();
    } catch (err) {
      showAlert?.({ title: "Konuşma modeli yüklenemedi", message: err.message || String(err), danger: true });
    } finally {
      setIsLoadingModel(false);
    }
  };
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const chunks = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      recorderRef.current = { stream, audioContext, source, processor, chunks, sampleRate: audioContext.sampleRate };
      setIsRecording(true);
    } catch (err) {
      showAlert?.({ title: "Mikrofon açılamadı", message: err.message || String(err), danger: true });
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorder.processor.disconnect();
    recorder.source.disconnect();
    recorder.stream.getTracks().forEach((track) => track.stop());
    await recorder.audioContext.close();
    recorderRef.current = null;
    setIsRecording(false);
    const merged = flattenFloat32(recorder.chunks);
    const resampled = resampleLinear(merged, recorder.sampleRate, 16000);
    const wav = encodeWavPcm16(resampled, 16000);
    setCurrentAudio(wav, `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`);
  };

  const handleUploadAudio = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".wav")) {
      showAlert?.({ title: "Desteklenmeyen ses biçimi", message: "Bu sürüm yalnızca WAV dosyalarını kabul ediyor. MP3/WebM/M4A dosyalarını önce WAV biçimine dönüştürün.", danger: true });
      return;
    }
    setCurrentAudio(file, file.name);
  };

  const handleTranscribe = async () => {
    if (!audioBlob || !selectedModel) return;
    setIsTranscribing(true);
    setResult(null);
    setResultText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (!isSelectedRuntimeLoaded) {
        setIsLoadingModel(true);
        try {
          await startSpeech(selectedModel, { language, threads, backendPreference });
          await refresh();
        } finally {
          setIsLoadingModel(false);
        }
      }
      const transcription = await transcribeSpeech(audioBlob, {
        model: selectedModel,
        language,
        threads,
        backendPreference,
        translate,
        filename: audioName || "audio.wav",
        signal: controller.signal,
      });
      setResult(transcription);
      await refresh();
      await onTranscriptionsChanged?.();

      if (transcription?.text?.toLowerCase().includes("foreign language")) {
        showAlert?.({
          title: "Yabancı dil algılandı",
          message: "Yüklü model yalnızca İngilizceyi destekliyor, İngilizce dışındaki konuşmaları yazıya çeviremez. Bu sesi yazıya çevirmek için Model Yöneticisi'nden çok dilli bir model (ör. Whisper Base Multilingual) indirip yükleyin.",
          danger: false,
        });
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        showAlert?.({ title: "Yazıya çevirme başarısız", message: err.message || String(err), danger: true });
      }
    } finally {
      abortRef.current = null;
      setIsTranscribing(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsTranscribing(false);
  };

  const saveText = () => {
    if (!resultText.trim()) return;
    downloadBlob("transcription.txt", resultText, "text/plain;charset=utf-8");
  };

  const saveJson = () => {
    const payload = { ...(result || {}), text: resultText };
    downloadBlob("transcription.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  };

  return (
    <div className="workspace-area speech-workspace">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Sesten Metne</h2>
        <p className="workspace-subtitle">
          Mikrofondan ses kaydedin veya bir WAV dosyası yükleyin, ardından whisper.cpp ile yerel olarak yazıya çevirin.
        </p>
      </div>

      <div className="speech-grid">
        <section className="m3-card speech-panel">
          <div className="speech-panel-header">
            <h3>Çalışma ortamı</h3>
            <span className={`status-chip ${status.backendInstalled ? "" : "offline"}`}>
              {status.backendInstalled ? (status.ready ? "Hazır" : "Kurulu") : "Motor kurulu değil"}
            </span>
          </div>

          {status.error && <div className="text-progress error">{status.error}</div>}

          <label className="speech-label">
            Whisper modeli
            <select className="m3-input" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              {installedModels.length === 0 && <option value="">İndirilmiş sesten metne modeli yok</option>}
              {installedModels.map((model) => (
                <option key={model.id || model.filename} value={model.filename}>
                  {model.name || model.filename}
                </option>
              ))}
            </select>
          </label>

          <div className="speech-controls-row">
            <label className="speech-label">
              Motor
              <select className="m3-input" value={backendPreference} onChange={(event) => setBackendPreference(event.target.value)}>
                <option value="auto">Otomatik (kuruluysa GPU)</option>
                {(status.backends || []).map((backend) => (
                  <option key={backend.key} value={backend.key}>
                    {backend.label}{backend.installed ? " - kurulu" : " - kurulu değil"}
                  </option>
                ))}
              </select>
            </label>
            <label className="speech-label">
              Dil
              <select className="m3-input" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {LANGUAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="speech-label">
              İş parçacığı
              <input
                className="m3-input"
                type="number"
                min="1"
                max="32"
                value={threads}
                onChange={(event) => setThreads(Math.max(1, Math.min(32, Number(event.target.value) || 1)))}
              />
            </label>
          </div>
          <div style={{ marginTop: "10px", paddingLeft: "2px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.82rem", cursor: "pointer", color: "var(--md-sys-color-on-surface)" }}>
              <input
                type="checkbox"
                checked={translate}
                onChange={(event) => setSpeechSettings((prev) => ({ ...prev, translate: event.target.checked }))}
                style={{ cursor: "pointer", width: "15px", height: "15px" }}
              />
              <span>İngilizceye çevir</span>
            </label>
          </div>

          <div className="speech-button-row">
            <button
              className="m3-btn m3-btn-filled"
              onClick={handleLoadSpeechModel}
              disabled={!selectedModel || isLoadingModel || isTranscribing || isSelectedRuntimeLoaded}
            >
              {isLoadingModel ? <LoaderCircle className="progress-spinner" size={14} /> : <Play size={14} />}
              <span>{isSelectedRuntimeLoaded ? "Yüklü" : isLoadingModel ? "Yükleniyor" : "Yükle"}</span>
            </button>
            <button className="m3-btn m3-btn-outlined" onClick={refresh}>
              <Play size={14} />
              <span>Yenile</span>
            </button>
          </div>

          {installedModels.length === 0 && (
            <div className="text-progress">
              Önce Model Yöneticisi'ndeki Sesten Metne Modelleri bölümünden bir model indirin.
            </div>
          )}
        </section>

        <section className="m3-card speech-panel">
          <div className="speech-panel-header">
            <h3>Ses</h3>
            <span className="status-chip">{audioName || "Ses seçilmedi"}</span>
          </div>

          <div className="speech-capture-zone">
            <FileAudio size={42} />
            <div>
              <strong>{audioName || "Kaydedin veya WAV yükleyin"}</strong>
              <p>Mikrofon kayıtları yazıya çevrilmeden önce 16 kHz mono PCM16 WAV biçimine dönüştürülür.</p>
            </div>
          </div>

          {audioUrl && <audio controls src={audioUrl} style={{ width: "100%" }} />}

          <div className="speech-button-row">
            {isRecording ? (
              <button className="m3-btn m3-btn-error" onClick={stopRecording}>
                <Square size={14} />
                <span>Kaydı durdur</span>
              </button>
            ) : (
              <button className="m3-btn m3-btn-filled" onClick={startRecording} disabled={isTranscribing}>
                <Mic size={14} />
                <span>Kaydı başlat</span>
              </button>
            )}
            <label className="m3-btn m3-btn-outlined">
              <Upload size={14} />
              <span>WAV yükle</span>
              <input type="file" accept=".wav,audio/wav" onChange={handleUploadAudio} hidden />
            </label>
            {audioBlob && (
              <button className="m3-btn m3-btn-error" onClick={clearCurrentAudio} disabled={isTranscribing || isRecording}>
                <X size={14} />
                <span>Sesi kaldır</span>
              </button>
            )}
          </div>

          <div className="speech-button-row">
            {isTranscribing ? (
              <button className="m3-btn m3-btn-error" onClick={handleCancel}>
                <Square size={14} />
                <span>İptal</span>
              </button>
            ) : (
              <button
                className="m3-btn m3-btn-filled"
                onClick={handleTranscribe}
                disabled={!audioBlob || !selectedModel || !status.backendInstalled}
              >
                <Mic size={14} />
                <span>Yazıya çevir</span>
              </button>
            )}
            {isTranscribing && <span className="text-progress"><LoaderCircle className="progress-spinner" size={14} /> Yerel olarak yazıya çevriliyor...</span>}
          </div>
        </section>
      </div>

      <section className="m3-card speech-result-panel">
        <div className="speech-panel-header">
          <h3>Döküm</h3>
          <div className="speech-button-row">
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", cursor: "pointer", userSelect: "none", color: "var(--md-sys-color-on-surface-variant)", marginRight: "12px" }}>
              <input
                type="checkbox"
                checked={showTimestamps}
                onChange={(e) => setShowTimestamps(e.target.checked)}
                style={{ width: "14px", height: "14px", cursor: "pointer" }}
              />
              <span>Zaman damgalarını göster</span>
            </label>
            <button className="m3-btn m3-btn-outlined" onClick={saveText} disabled={!resultText.trim()}>
              <Save size={14} />
              <span>TXT</span>
            </button>
            <button className="m3-btn m3-btn-outlined" onClick={saveJson} disabled={!resultText.trim()}>
              <Save size={14} />
              <span>JSON</span>
            </button>
            {status.ready && (
              <button className="m3-btn m3-btn-error" onClick={() => stopSpeech().then(refresh)}>
                <Square size={14} />
                <span>Çalışma ortamını durdur</span>
              </button>
            )}
          </div>
        </div>
        <textarea
          className="m3-textarea speech-result-textarea"
          value={resultText}
          onChange={(event) => setResultText(event.target.value)}
          placeholder="Döküm burada görünecek."
        />
      </section>
    </div>
  );
}

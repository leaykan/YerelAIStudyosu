import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, LoaderCircle, Send, Trash2, Square, History, Paperclip, X, ChevronDown, Globe2, Plus, Mic, MicOff, Volume2, VolumeX, Power, Hand, Download, SlidersHorizontal, LogOut } from "lucide-react";
import {
  getDownloadProgress,
  getLlmStatus,
  listLlmModels,
  streamChatWithLlm,
  chatWithLlm,
  startLlm,
  stopLlm,
  transcribeSpeech,
  listSpeechModels,
  getTtsStatus,
  getSpeechStatus,
  listTtsModels,
  vegaGorselBaslat, vegaGorselDurumu, gorselModelleriniListele } from "../services/api";
import { Dinleyici, Seslendirici, dilTahmin, halusinasyonMu, wavKodla } from "../sesliSohbet";
import { Cloud } from "lucide-react";
import BulutModelEkle from "./BulutModelEkle";
import KlonEklePenceresi from "./KlonEklePenceresi";
import KlonOnayPenceresi from "./KlonOnay";
import { klonAyarlariKaydet, klonListesi, klonOrnekleriSil, klonCanli, klonDurumu } from "../services/klonApi";
import { bulutListesi, bulutEtiketi, bulutModeliMi } from "../services/bulutApi";
// Sohbet içi müzik / efekt / video kartı ve sohbet modelinin (video/görsel sonrası) geri yükleme durumu
import StudyoSohbetKarti from "./StudyoSohbetKarti";
// Müzik / efekt / video isteği: görsel akışı gibi önce model seçimi, sonra ilerleme ve sonuç kartı
import SohbetMedyaKarti from "./SohbetMedyaKarti";
import { kullaniciDurumu, cikisYap } from "../services/kullaniciApi";
import { sohbetModeliDurumu, sohbetModeliniSimdiGeriYukle, sohbetModeliniVideoyaRagmenYukle } from "../services/studyoApi";

// Klon ses süreleri: "42 sn", "2 dk 05 sn"
const klonSureYaz = (sn) => {
  const s = Math.max(0, Math.round(Number(sn) || 0));
  return s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk ${String(s % 60).padStart(2, "0")} sn`;
};

// Vega'nın görsel üretme yeteneği. Akış: kullanıcı açıkça görsel ister -> Vega <gorsel-istek/> işareti koyar
// -> sohbette model seçilir -> kullanıcı görseli tarif eder -> tarif İngilizce isteme çevrilip üretilir.
const GORSEL_TALIMATI = [
  "Yeteneklerin: kullanıcıyla yazılı ve sesli sohbet edebilirsin (konuşmasını yazıya çevirip yanıtını sesli okuyabilirsin), Web düğmesi açıkken internette arama yapabilirsin; görsel, müzik, ses efekti ve kısa video üretebilirsin. Kullanıcı neler yapabildiğini sorarsa bunların hepsini say.",
  "Görsel üretebilirsin: bu bilgisayardaki görsel modelleriyle resim, ikon, logo, çizim ve illüstrasyon üretme yeteneğin var. Ürettiğin görseller sohbet penceresinde gösterilir ve kullanıcı onları kaydedebilir.",
  "Kullanıcı yalnızca görsel üretip üretemeyeceğini soruyorsa (ör. \"görsel üretebilir misin?\") bu bir sorudur, istek değildir: evet de, ne tür görseller üretebildiğini kısaca anlat ve istediğinde hazırlayabileceğini söyle. Bu durumda işaret kullanma.",
  "Kullanıcı senden açıkça bir görsel üretmeni istiyorsa (ör. \"bir görsel üretmeni istiyorum\", \"görsel talep ediyorum\", \"şu resmi üretebilir misin\", \"bana bir ikon çiz\") tek cümlelik kısa bir Türkçe cevap ver ve cevabının en sonuna yalnızca <gorsel-istek/> yaz. Görseli sen tarif etme; model seçimi ve tarif ayrıca istenecek.",
  "Bunların dışında <gorsel-istek/> işaretini asla kullanma.",
  "Görsel, müzik, ses efekti ya da video için kullanıcıdan asla İngilizce tarif ya da model adı isteme: kullanıcı Türkçe anlatır, tarifi sen yazarsın ve İngilizceye çeviri otomatik yapılır; model seçimi sohbetteki kartta yapılır.",
].join(" ");
// Kullanıcının Türkçe tarifini görsel modeli için İngilizce isteme çeviren ayrı talimat
const ISTEM_TALIMATI = [
  "You write prompts for a Stable Diffusion image model.",
  "Convert the user's image description (usually Turkish) into ONE English prompt: comma-separated, 20 to 60 words.",
  "Describe what the image should look like: subject, shape, viewpoint, structure, colors, lighting, style, background.",
  "Do not rely on proper names; describe their appearance instead (e.g. instead of 'the Milky Way seen from afar' write 'face-on view of a large barred spiral galaxy seen from far outside, bright yellowish central bulge with a short bar, two major spiral arms, blue star clusters, dark dust lanes, black space background').",
  "Output only the prompt text, nothing else.",
].join(" ");
const GORSEL_ISTEK_ISARETI = /<gorsel-istek\s*\/?>|<gorsel>[\s\S]*?(?:<\/gorsel>|$)/i;
const gorselEtiketiniSil = (metin) => String(metin || "")
  .replace(/<gorsel-istek\s*\/?>|<gorsel>[\s\S]*?(?:<\/gorsel>|$)/gi, "")
  .replace(/<arac\b[^>]*>[\s\S]*?(?:<\/arac>|$)/gi, "") // araç etiketi sızarsa gösterme
  .replace(/\s+$/, "");
// Yalnızca http/https bağlantılarına izin ver (javascript:, data: vb. engellenir)
const guvenliBaglanti = (adres) => {
  try {
    const ham = String(adres || "").trim();
    // Göreli bağlantı (ör. /api/...) uygulamanın kendi API'sine gider: model çıktısında kabul edilmez
    if (!/^https?:\/\//i.test(ham)) return undefined;
    const u = new URL(ham);
    if (u.origin === window.location.origin) return undefined;
    // Bu bilgisayardaki / yerel ağdaki servisler (localhost, 127.x, 10.x, 192.168.x, 172.16-31.x, [::1]) bağlantı olmaz
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0" ||
      /^(127|10)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) return undefined;
    return u.href;
  } catch (_) { return undefined; }
};
const modelKisaAd = (m) => String(m || "").replace(/\.(gguf|safetensors|ckpt)$/i, "");

// Görseli bilgisayara kaydet: Chrome'da "Farklı kaydet" penceresi, olmazsa normal indirme
async function gorseliKaydet(url, istenenAd) {
  const ad = (istenenAd || "vega-gorsel").replace(/[^\w.-]+/g, "-").replace(/\.png$/i, "") + ".png";
  try {
    if (window.showSaveFilePicker) {
      const tutamac = await window.showSaveFilePicker({ suggestedName: ad, types: [{ description: "PNG görseli", accept: { "image/png": [".png"] } }] });
      const blob = await (await fetch(url)).blob();
      const yazici = await tutamac.createWritable();
      await yazici.write(blob);
      await yazici.close();
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return; // kullanıcı vazgeçti
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = ad;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Sohbette görsel için model seçimi: kurulu modeller listelenir, kullanıcı seçip "Üret"e basar
const tahminiSure = (d) => {
  if (!d) return "";
  if (d.family === "sd15") return d.distilled ? "~3 dk" : "~3–4 dk (hızlı mod)";
  if (d.family === "sdxl") return d.distilled ? "~20 dk" : "çok yavaş (1 saat+)";
  return "";
};
function GorselModelSecici({ modeller, secim, setSecim, yukle, mesgul, onSec, onVazgec }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (modeller === null) yukle(); }, [modeller]);
  if (modeller === null) {
    return <div className="vega-gorsel-bekliyor"><LoaderCircle size={16} className="progress-spinner" /><span>Görsel modelleri okunuyor…</span></div>;
  }
  if (modeller.length === 0) {
    return (
      <div className="vega-gorsel-hata">
        Görsel üretimi için bir model yüklü değil (henüz indirilmemiş). Lütfen önce Model Yöneticisi'nden bir görsel modeli indirin, sonra tekrar isteyin.
      </div>
    );
  }
  const varsayilan = modeller.find((m) => m.filename === secim)
    || modeller.find((m) => m.filename === "CyberRealistic_V8_FP16.safetensors")
    || modeller.find((m) => m.detected?.family === "sd15")
    || modeller[0];
  const secili = varsayilan?.filename || "";
  return (
    <div className="vega-model-sec">
      <div className="vega-model-sec-baslik">Hangi modelle üretilsin?</div>
      <div className="vega-model-liste" role="radiogroup" aria-label="Görsel modeli">
        {modeller.map((m) => {
          const d = m.detected || {};
          const ad = String(m.filename).replace(/\.(gguf|safetensors|ckpt)$/i, "");
          return (
            <label key={m.filename} className={`vega-model-satir ${secili === m.filename ? "secili" : ""}`}>
              <input type="radio" name="vega-model" checked={secili === m.filename} onChange={() => setSecim(m.filename)} />
              <span className="vega-model-ad" title={m.filename}>{ad}</span>
              <span className="vega-model-bilgi">
                {d.familyLabel || ""}{tahminiSure(d) ? ` · ${tahminiSure(d)}` : ""}
                {d.uncensored ? <span className="vega-model-rozet">+18</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      <div className="vega-model-dugmeler">
        <button type="button" className="vega-model-uret" disabled={!secili || mesgul} onClick={() => onSec(secili)}>Seç</button>
        <button type="button" className="vega-model-vazgec" onClick={onVazgec}>Vazgeç</button>
      </div>
    </div>
  );
}

const processMessageContent = (rawText, apiReasoning = "", enableThinking = true) => {
  if (typeof rawText !== "string") {
    return { content: rawText, reasoning: apiReasoning || "" };
  }

  const cleanReasoningControlTags = (value) => String(value || "")
    .replace(/<\|channel\|>thought/g, "")
    .replace(/<\|channel\|>model/g, "")
    .replace(/<\|turn\|>model/g, "")
    .replace(/<\|im_start\|>model/g, "")
    .replace(/<\|think\|>|<\|thought\|>|<thinking>|<thought>/g, "")
    .replace(/<\|\/think\|>|<\|\/thought\|>|<\/thinking>|<\/thought>/g, "")
    .trim();

  const startTags = ["<|channel|>thought", "<|think|>", "<|thought|>", "<thinking>", "<thought>"];
  const endTags = ["<|channel|>model", "<|turn>model", "<|im_start|>model", "</thinking>", "</thought>", "<|/think|>", "<|/thought|>"];

  if (!enableThinking) {
    return { content: cleanReasoningControlTags(rawText), reasoning: "" };
  }

  let startIdx = -1;
  let matchedStartTag = "";

  for (const tag of startTags) {
    const idx = rawText.indexOf(tag);
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
      startIdx = idx;
      matchedStartTag = tag;
    }
  }

  if (startIdx === -1) {
    return { content: cleanReasoningControlTags(rawText), reasoning: "" };
  }

  let endIdx = -1;
  for (const tag of endTags) {
    const idx = rawText.indexOf(tag, startIdx + matchedStartTag.length);
    if (idx !== -1 && (endIdx === -1 || idx < endIdx)) {
      endIdx = idx;
    }
  }

  if (endIdx === -1) {
    const rawReasoning = rawText.substring(startIdx + matchedStartTag.length);
    return { content: "", reasoning: cleanReasoningControlTags(rawReasoning) };
  }

  const rawReasoning = rawText.substring(startIdx + matchedStartTag.length, endIdx);
  const rawContent = rawText.substring(endIdx);

  return {
    content: cleanReasoningControlTags(rawContent),
    reasoning: cleanReasoningControlTags(rawReasoning)
  };
};

function ChatThinkingSection({ reasoning, timeElapsed, isComplete }) {
  const [isExpanded, setIsExpanded] = useState(true);

  const formattedTime = Number(timeElapsed) > 0 
    ? ` (${Number(timeElapsed).toFixed(timeElapsed < 10 ? 1 : 0)} sn)`
    : "";

  return (
    <div className="chat-thinking-container">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="chat-thinking-header"
      >
        <span className="chat-thinking-title">
          {isComplete ? `Düşünme süreci${formattedTime}` : `Düşünüyor...${formattedTime}`}
        </span>
        <ChevronDown
          size={14}
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        />
      </button>
      {isExpanded && (
        <div className="chat-thinking-content">
          {reasoning}
        </div>
      )}
    </div>
  );
}

const messageContainsImage = (message) => (
  Array.isArray(message?.content) &&
  message.content.some((item) => item?.type === "image_url" && item?.image_url?.url)
);

function TextChat({ 
  specs, 
  showAlert, 
  showConfirm, 
  textSettings, 
  setTextSettings, 
  setActiveModel, 
  setServerRunning,
  conversations,
  setConversations,
  activeConversationId,
  setActiveConversationId,
  showHistory,
  setShowHistory,
  saveConversationState,
  setIsLlmLoaded,
  speechSettings,
  ttsSettings,
}) {
  const formatGenerationTime = (seconds) => {
    const value = Number(seconds) || 0;
    if (value < 1) return `${Math.round(value * 1000)} ms`;
    return `${value.toFixed(value < 10 ? 2 : 1)} s`;
  };

  const [models, setModels] = useState([]);
  const [status, setStatus] = useState({ ready: false, running: false, settings: {} });
  const [selectedModel, setSelectedModel] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [webTimeFilter, setWebTimeFilter] = useState("any");
  const [loadingModel, setLoadingModel] = useState(null);
  const [tokenUsage, setTokenUsage] = useState({
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0
  });

  useEffect(() => {
    if (setIsLlmLoaded) {
      setIsLlmLoaded(status.ready ? (status.settings?.etiket || status.settings?.model || true) : false);
    }
  }, [status.ready, status.settings?.model, status.settings?.etiket, setIsLlmLoaded]);

  const [showModelMenu, setShowModelMenu] = useState(false);
  const [bulutModalAcik, setBulutModalAcik] = useState(false);
  const modelMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setShowModelMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const estimateTokens = (text) => {
    const value = String(text || "").trim();
    if (!value) return 0;
    const wordCount = value.split(/\s+/).filter(Boolean).length;
    return Math.max(wordCount, Math.ceil(value.length / 4));
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const getAutoMaxResponseTokens = (promptTokens, thinkingEnabled) => {
    const contextLimit = Number(status.settings?.contextSize || textSettings?.contextSize || 4096);
    const safetyBuffer = thinkingEnabled ? 768 : 512;
    const preferredMinimum = thinkingEnabled ? 512 : 256;
    const available = contextLimit - promptTokens - safetyBuffer;
    if (available <= 0) return 64;
    return clamp(available, Math.min(preferredMinimum, available), 4096);
  };
  
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const completedDownloadRef = useRef("");
  const loadingModelRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const prevMessagesLengthRef = useRef(0);
  const followGenerationRef = useRef(false);
  const abortControllerRef = useRef(null);
  // rAF batching: accumulate token updates and flush once per frame
  const tokenBufferRef = useRef(null);
  const rafRef = useRef(null);
  // Debounced stats: only update stats pill every 250ms
  const statsDebounceRef = useRef(null);

  const [attachments, setAttachments] = useState([]);
  // Sesli sohbet durumu
  const [sesliMod, setSesliMod] = useState(false);
  const [sesliYanit, setSesliYanit] = useState(true);
  const [sesDurumu, setSesDurumu] = useState("kapali");
  const [seviye, setSeviye] = useState({ rms: 0, esik: 1 });
  const [sonDokum, setSonDokum] = useState("");
  const [sesHata, setSesHata] = useState("");
  const [konusuyor, setKonusuyor] = useState(false);
  const [sesDili, setSesDili] = useState(() => {
    try { return localStorage.getItem("sesliSohbetDili") || "tr"; } catch (_) { return "tr"; }
  });
  const sesDiliRef = useRef(sesDili);
  // Eller serbest: konuşma bitince metin Enter beklemeden gönderilir
  const [ellerSerbest, setEllerSerbest] = useState(() => {
    try { return localStorage.getItem("sesliEllerSerbest") === "1"; } catch (_) { return false; }
  });
  const ellerSerbestRef = useRef(ellerSerbest);
  // Hoparlör düğmesiyle yeniden okunan mesajın sırası
  const [okunanIndex, setOkunanIndex] = useState(null);
  const inputRef = useRef("");
  const dinleyiciRef = useRef(null);
  const seslendiriciRef = useRef(null);
  const sesliModRef = useRef(false);
  const sesliYanitRef = useRef(true);
  const isBusyRef = useRef(false);
  const seviyeZamaniRef = useRef(0);
  const sesKaynaklariRef = useRef({});
  const assistantTextForVoiceRef = useRef("");
  const cevirmedeRef = useRef(false);
  // Konuşma parçaları sırayla yazıya çevrilir; çeviri sürerken mikrofon dinlemeye devam eder
  const ceviriKuyruguRef = useRef([]);
  const [ceviriBekleyen, setCeviriBekleyen] = useState(0);
  const otoGonderZamanlayiciRef = useRef(null);
  // Ses klonlama (OmniVoice): "Sesimi klonlama için kaydet" ve "Vega benim sesimle yanıt versin".
  // Sunucu (app/config/klon-ayarlari.json) asıl kaynaktır; localStorage yalnızca ilk açılış görüntüsü için.
  const yerelOku = (anahtar, varsayilan) => { try { const v = localStorage.getItem(anahtar); return v === null ? varsayilan : v; } catch (_) { return varsayilan; } };
  const yerelYaz = (anahtar, deger) => { try { localStorage.setItem(anahtar, String(deger)); } catch (_) { /* yok say */ } };
  const [klonVeri, setKlonVeri] = useState(null); // /api/klon/liste yanıtı; null: okunmadı ya da desteklenmiyor
  const [klonAyarAcik, setKlonAyarAcik] = useState(false);
  const [klonOnayAcik, setKlonOnayAcik] = useState(false);
  const [klonOrnekPenceresi, setKlonOrnekPenceresi] = useState(false);
  const [klonMesgul, setKlonMesgul] = useState(false);
  const [klonHata, setKlonHata] = useState("");
  const [klonUyari, setKlonUyari] = useState("");
  const [klonUretiyor, setKlonUretiyor] = useState(false);
  const [ornekToplaYerel, setOrnekToplaYerel] = useState(() => yerelOku("klonOrnekTopla", "0") === "1");
  const [vegaKlonYerel, setVegaKlonYerel] = useState(() => yerelOku("vegaKlonSesi", "0") === "1");
  const [vegaKlonDosyasiSecimi, setVegaKlonDosyasiSecimi] = useState(() => yerelOku("vegaKlonDosyasi", ""));
  const [klonZamanAsimi, setKlonZamanAsimi] = useState(() => { const v = Number(yerelOku("klonZamanAsimiSn", "0")); return Number.isFinite(v) ? v : 0; });
  const klonSecimRef = useRef({ voice: "", zamanAsimiSn: 0 });
  // Klon sesin hazırlık durumu (sunucudan): kapali | yukleniyor | hazir | mesgul | hata
  const [klonHazirlik, setKlonHazirlik] = useState(null);
  const klonAyarKutusuRef = useRef(null);
  // Vega görsel üretimi
  const gorselUretiliyorRef = useRef(false);
  const gorselUretRef = useRef(null);
  const [buyutulmusGorsel, setBuyutulmusGorsel] = useState(null);
  // Sohbet modeli durumu (GET /api/studyo/sohbet-modeli): video sürüyor mu, bekleyen / süren geri yükleme.
  // Model ağır bir iş için bellekten çıkarıldığında yazı kutusunun üstünde açıklama gösterilir.
  const [sohbetModeliBilgi, setSohbetModeliBilgi] = useState(null);
  const [geriYukleIstendi, setGeriYukleIstendi] = useState(false);
  // Model seçilip tarif beklenirken: { convId, index, model }
  const [bekleyenGorsel, setBekleyenGorsel] = useState(null);
  const bekleyenGorselRef = useRef(null);
  const [gorselModelleri, setGorselModelleri] = useState(null); // null: henüz okunmadı
  const [gorselModelSecimi, setGorselModelSecimi] = useState(() => {
    try { return localStorage.getItem("vegaGorselModeli") || ""; } catch (_) { return ""; }
  });
  useEffect(() => {
    if (!buyutulmusGorsel) return undefined;
    const tus = (e) => { if (e.key === "Escape") setBuyutulmusGorsel(null); };
    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  }, [buyutulmusGorsel]);
  const konusuyorRef = useRef(false);
  const sessizlikSonuRef = useRef(0);
  const beklemeZamanlayiciRef = useRef(null);
  const fileInputRef = useRef(null);
  const supportsVision = Boolean(status.ready && status.settings?.supportsVision);
  const supportsThinking = Boolean(status.ready && status.settings?.supportsThinking);
  const deepThinkEnabled = status.ready
    ? status.settings?.enableThinking === true
    : textSettings?.enableThinking === true;
  const visionStatus = status.settings?.visionStatus || "Görsel girişi için eşleşen bir mmproj projektör dosyası gerekir.";

  const resizeComposerInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = 104;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resizeComposerInput();
  }, [input, resizeComposerInput]);

  const isImage = (file) => {
    return /\.(jpe?g|png|webp)$/i.test(file.name) || file.type.startsWith("image/");
  };

  const isTextFile = (file) => {
    return /\.(txt|md|csv|js|jsx|ts|tsx|py|json|css|html|java|cpp|c|h|rs|go|sh|bat|xml|yaml|yml)$/i.test(file.name) || file.type.startsWith("text/");
  };

  const optimizeImageForVision = (file, maxSide = 1024, quality = 0.92) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Dosya okunamadı: ${file.name}`));
    reader.onload = () => {
      const originalDataUrl = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error(`Görsel çözümlenemedi: ${file.name}`));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const sendDataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({
          previewDataUrl: originalDataUrl,
          sendDataUrl,
          originalWidth: img.width,
          originalHeight: img.height,
          width,
          height,
        });
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  });

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    files.forEach((file) => {
      if (isImage(file)) {
        optimizeImageForVision(file)
          .then((image) => {
          setAttachments((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "image",
              name: file.name,
                dataUrl: image.previewDataUrl,
                sendDataUrl: image.sendDataUrl,
                width: image.width,
                height: image.height,
                originalWidth: image.originalWidth,
                originalHeight: image.originalHeight,
            },
          ]);
          })
          .catch((err) => {
            showAlert({ title: "Görsel Hatası", message: err.message || String(err), danger: true });
          });
      } else if (isTextFile(file)) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setAttachments((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "document",
              name: file.name,
              content: event.target.result,
            },
          ]);
        };
        reader.readAsText(file);
      } else {
        showAlert({
          title: "Desteklenmeyen Dosya",
          message: `"${file.name}" dosyası desteklenmiyor. Bir görsel (JPEG, PNG, WEBP) ya da metin/kod dosyası seçin.`,
          danger: true,
        });
      }
    });

    e.target.value = "";
  };

  useEffect(() => {
    loadingModelRef.current = loadingModel;
  }, [loadingModel]);


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

  const handleThinkingToggle = async () => {
    const enabled = !deepThinkEnabled;
    const nextSettings = { ...textSettings, enableThinking: enabled };

    if (!status.ready || !status.settings?.model) {
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

    setIsBusy(true);
    try {
      setTextSettings(nextSettings);
      await stopLlm();
      const result = await startLlm(status.settings.model, buildTextStartOptions(nextSettings));
      setStatus({ ...status, ...result, ready: true, running: true, settings: result.settings });
    } catch (err) {
      showAlert({ title: "Metin Modeli Yeniden Yüklenemedi", message: err.message || String(err), danger: true });
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (!supportsVision) {
      setAttachments((current) => current.filter((attachment) => attachment.type !== "image"));
    }
  }, [supportsVision]);

  // Yukle conversation messages when activeConversationId changes
  useEffect(() => {
    if (isBusy) return;
    if (activeConversationId) {
      const conv = conversations.find(c => c.id === activeConversationId);
      if (conv) {
        setMessages(conv.messages);
        if (conv.model && models.some(m => m.filename === conv.model)) {
          setSelectedModel(conv.model);
        }
        const total = conv.messages.reduce((sum, m) => {
          const text = Array.isArray(m.content)
            ? m.content.map(c => c.text || "").join(" ")
            : (m.content || "");
          return sum + estimateTokens(text) + estimateTokens(m.reasoning || "");
        }, 0);
        setTokenUsage({
          prompt_tokens: Math.round(total * 0.7),
          completion_tokens: Math.round(total * 0.3),
          total_tokens: total
        });
      }
    } else {
      setMessages([]);
      setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    }
  }, [activeConversationId, conversations, models, isBusy]);

  const refresh = useCallback(async () => {
    const [nextModels, nextStatus, bulutModelleri] = await Promise.all([listLlmModels(), getLlmStatus(), bulutListesi().catch(() => [])]);
    const yerelModeller = nextModels.filter((model) => !model.isProjector);
    const selectableModels = [...yerelModeller, ...bulutModelleri];
    setModels(selectableModels);
    setStatus(nextStatus);
    const active = nextStatus.settings?.model;
    setSelectedModel((current) => {
      const saved = localStorage.getItem("selectedLlmModel");
      // Bulut modeli asla kendiliğinden önerilmez/hatırlanmaz; yalnızca kullanıcı seçerse kullanılır
      const savedExists = yerelModeller.some((m) => m.filename === saved);
      return active || current || (savedExists ? saved : "") || yerelModeller[0]?.filename || "";
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const timer = setInterval(() => {
      getLlmStatus().then((nextStatus) => {
        setStatus(nextStatus);
        // If it suddenly yuklendi or became hazir externally, update selection and reset yukleniyor states
        if (nextStatus.ready && nextStatus.settings?.model) {
          setSelectedModel(nextStatus.settings.model);
          setLoadingModel(null);
        }
      }).catch(() => {});
      getDownloadProgress().then((state) => {
        if (state.kind === "text" && (state.active || state.error || state.progress === 100)) {
          const completionKey = `${state.filename || ""}:${state.downloadedBytes || 0}`;
          if (!state.active && !state.error && completedDownloadRef.current !== completionKey) {
            completedDownloadRef.current = completionKey;
            refresh().catch(() => {});
          }
        }
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  // Sohbet modeli video / görsel işi için bellekten çıkarıldıysa sunucudan durumunu oku (3 sn'de bir).
  // Eski sunucuda uç nokta yoksa sessizce null kalır.
  // Görsel Stüdyo için kapatılan sohbet modeli, kullanıcı sohbet sayfasına dönünce (görsel motoru boştaysa)
  // beklemeden geri yüklenir; "Sohbet modeli yeniden yükleniyor…" notu gösterilir. Kullanıcı arada elle bir model
  // yükleyip kapattıysa sunucu bekleyen kaydı zaten siler.
  const otoGeriYuklemeRef = useRef(0);
  useEffect(() => {
    let kapandi = false;
    const sohbetGorunur = () => {
      const el = chatMessagesRef.current;
      return Boolean(el && el.offsetParent !== null && document.visibilityState === "visible");
    };
    const oku = () => sohbetModeliDurumu()
      .then((d) => {
        if (kapandi) return;
        setSohbetModeliBilgi(d);
        if (d?.bekleyen?.kaynak === "gorsel" && !d.videoSuruyor && !d.yuklu && sohbetGorunur() && Date.now() - otoGeriYuklemeRef.current > 15000) {
          otoGeriYuklemeRef.current = Date.now();
          sohbetModeliniSimdiGeriYukle().then(() => { if (!kapandi) setGeriYukleIstendi(true); }).catch(() => {}); // görsel sürüyorsa 409: sonra yeniden denenir
        }
      })
      .catch(() => { if (!kapandi) setSohbetModeliBilgi(null); });
    oku();
    const t = setInterval(oku, 3000);
    return () => { kapandi = true; clearInterval(t); };
  }, []);
  useEffect(() => { if (status.ready) setGeriYukleIstendi(false); }, [status.ready]);

  // "Şimdi geri yükle": Görsel Stüdyo (ya da video) için kapatılan sohbet modeli beklemeden yüklenir
  const sohbetModeliniGeriYukleTiklandi = async () => {
    setGeriYukleIstendi(true);
    try {
      await sohbetModeliniSimdiGeriYukle();
      setSohbetModeliBilgi(await sohbetModeliDurumu().catch(() => null));
    } catch (err) {
      setGeriYukleIstendi(false);
      showAlert({ title: "Sohbet Modeli Yüklenemedi", message: err.message || String(err), danger: true });
    }
  };

  const handleStopGeneration = () => {
    seslendiriciRef.current?.sustur();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) return;

    const len = messages.length;
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = len;

    const lastMessage = messages[len - 1];
    const isNewUserMessage = len > prevLen && lastMessage?.role === "user";

    // scrollIntoView yalnızca sohbet kutusunu değil tüm üst kapsayıcıları (sayfayı) da kaydırıyordu;
    // bu yüzden sadece sohbet kutusunun kendisi kaydırılır.
    const enAlta = () => container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    if (isNewUserMessage || followGenerationRef.current) {
      enAlta();
    } else {
      const threshold = 150;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
      if (isNearBottom) enAlta();
    }
  }, [messages, isBusy, loadingModel]);

  const handleModelChange = async (filename) => {
    if (!filename) {
      if (status.ready) {
        setIsBusy(true);
        try {
          await stopLlm();
          setStatus((prev) => ({ ...prev, ready: false, running: false }));
          setSelectedModel("");
          setMessages([]);
          setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        } catch (err) {
          showAlert({ title: "Bellekten Çıkarılamadı", message: err.message || String(err), danger: true });
        } finally {
          setIsBusy(false);
        }
      }
      return;
    }

    // Video üretimi sürerken sohbet modeli video için bellekten çıkarılmıştır ve video bitince kendiliğinden
    // geri yüklenir. Şimdi yüklemek belleği zorlar (video çökebilir): kullanıcıdan onay alınır.
    let videoyaRagmen = false;
    if (!bulutModeliMi(filename)) {
      const d = await sohbetModeliDurumu().catch(() => null);
      if (d?.videoSuruyor) {
        const evet = await showConfirm({
          title: "Video Üretimi Sürüyor",
          message: "Sohbet modeli video üretimi için bellekten çıkarıldı ve video bitince otomatik geri yüklenecek. Şimdi yüklemek belleği zorlar; video yavaşlayabilir ya da yarıda kalabilir. Yine de şimdi yüklensin mi?",
          confirmLabel: "Yine de yükle",
          cancelLabel: "Bekle",
        });
        if (!evet) return;
        videoyaRagmen = true;
      }
    }

    setSelectedModel(filename);
    localStorage.setItem("selectedLlmModel", filename);
    setIsBusy(true);
    setLoadingModel(filename);
    try {
      // Kaldir aktif gorsel engine if running
      if (!bulutModeliMi(filename)) {
        if (setActiveModel) setActiveModel(null);
        if (setServerRunning) setServerRunning(false);
      }

      const yuklemeAyarlari = {
        threads: textSettings?.threads || specs?.cpu_cores_physical || 4,
        contextSize: textSettings?.contextSize ?? 0,
        gpuLayers: textSettings?.gpuLayers ?? -1,
        enableThinking: textSettings?.enableThinking === true,
        flashAttn: textSettings?.flashAttn,
        cacheTypeK: textSettings?.cacheTypeK,
        cacheTypeV: textSettings?.cacheTypeV,
        mlock: textSettings?.mlock,
        mmap: textSettings?.mmap,
        cachePrompt: textSettings?.cachePrompt,
        defragThold: textSettings?.defragThold,
        batchSize: textSettings?.batchSize,
        ubatchSize: textSettings?.ubatchSize,
        performanceProfile: textSettings?.performanceProfile,
        preferredBackend: textSettings?.preferredBackend,
      };
      const result = videoyaRagmen
        ? await sohbetModeliniVideoyaRagmenYukle(filename, yuklemeAyarlari)
        : await startLlm(filename, yuklemeAyarlari);
      setStatus({ ...status, ...result, ready: true, running: true, settings: result.settings });
      setMessages([]);
      setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    } catch (err) {
      if (loadingModelRef.current === filename) {
        showAlert({ title: "Metin Modeli Yüklenemedi", message: err.message, danger: true });
      }
    } finally {
      setLoadingModel(null);
      setIsBusy(false);
    }
  };

  const handleCancelLlmLoad = async () => {
    try {
      await stopLlm();
    } catch (_) {}
    setLoadingModel(null);
    setIsBusy(false);
    setSelectedModel("");
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
  };

  const sendMessage = async (metinOverride) => {
    const text = (typeof metinOverride === "string" ? metinOverride : input).trim();
    const hasAttachments = attachments.length > 0;
    if ((!text && !hasAttachments) || isBusy || !status.ready) return;

    // Model seçildi ve tarif bekleniyorsa bu mesaj görselin tarifidir
    if (bekleyenGorselRef.current && text && !hasAttachments) {
      const bekleyen = bekleyenGorselRef.current;
      bekleyenGorselRef.current = null;
      setBekleyenGorsel(null);
      await gorselTarifiniIsle(bekleyen, text);
      return;
    }

    // Sesli sohbet açıksa yeni yanıt için seslendiriciyi sıfırla
    assistantTextForVoiceRef.current = "";
    if (sesliModRef.current && sesliYanitRef.current) seslendiriciRef.current?.yeniYanit();

    let convId = activeConversationId;
    let isNew = false;
    if (!convId) {
      convId = "chat_" + Date.now();
      setActiveConversationId(convId);
      isNew = true;
    }

    // Delimited context blocks for document attachments
    let documentContext = "";
    attachments.filter(att => att.type === "document").forEach((att) => {
      documentContext += `
[Ekli Dosya: ${att.name}]\n${att.content}\n`;
    });

    const imageAttachments = attachments.filter(att => att.type === "image");
    const conversationHasImage = messages.some(messageContainsImage);
    const requestHasImage = imageAttachments.length > 0 || conversationHasImage;
    const visionInstruction = requestHasImage
      ? "For images in this conversation: answer in natural language, describe the actual image content, and read visible text carefully when relevant. If the user asks a follow-up like \"what is this\" or \"explain\", treat it as referring to the most recent image unless they say otherwise. Do not output raw JSON, arrays, bounding boxes, OCR layout objects, UI class names, or detection labels unless the user explicitly asks for that format."
      : "";
    const requestText = imageAttachments.length > 0
      ? (text && text !== "?" ? text : "Görselde görünenleri açıkla.")
      : text;
    const displayText = text || (imageAttachments.length > 0 ? "Görselde görünenleri açıkla." : "");
    const requestCombinedText = [
      requestText,
      documentContext,
    ].filter(Boolean).join("\n\n").trim();
    const displayCombinedText = documentContext
      ? [displayText, documentContext].filter(Boolean).join("\n\n").trim()
      : displayText;

    let userMessageContent;
    let requestUserMessageContent;
    if (imageAttachments.length > 0) {
      userMessageContent = [
        {
          type: "text",
          text: displayCombinedText
        },
        ...imageAttachments.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.dataUrl
          }
        }))
      ];
      requestUserMessageContent = [
        {
          type: "text",
          text: requestCombinedText
        },
        ...imageAttachments.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.sendDataUrl || img.dataUrl
          }
        }))
      ];
    } else {
      userMessageContent = displayCombinedText;
      requestUserMessageContent = requestCombinedText;
    }

    const nextMessages = [...messages, { role: "user", content: userMessageContent }];
    const requestConversationMessages = [...messages, { role: "user", content: requestUserMessageContent }];
    followGenerationRef.current = true;
    setMessages(nextMessages);
    setInput("");
    setIsBusy(true);

    const displayTitleText = text || (imageAttachments.length > 0 ? "Gönderilen Görsel" : "Gönderilen Dosya");
    const firstTitle = isNew ? (displayTitleText.slice(0, 26) + (displayTitleText.length > 26 ? "..." : "")) : null;
    saveConversationState(convId, nextMessages, selectedModel, firstTitle);

    const requestStartedAt = performance.now();
    setMessages([...nextMessages, {
      role: "assistant",
      content: "",
      generationStats: { status: "starting", tokens: 0, tokensPerSecond: 0, seconds: 0, vision: requestHasImage, web: useWebSearch },
    }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    // Bu yanıtta Vega'nın başlattığı müzik / efekt / video işleri (eski sunucu: iş araçta başlardı)
    const studyoIsleri = [];
    // Bu yanıttaki müzik / efekt / video istekleri: yanıt bitince model seçim kartı olarak gösterilir, iş "Seç"le başlar
    const medyaIsleri = [];

    try {
      const systemPrompt = textSettings?.systemPrompt || "Senin adın Vega. Bu bilgisayarda çevrimdışı çalışan, yardımsever bir yapay zekâ asistanısın. Kullanıcı hangi dilde yazarsa o dilde yanıt ver.";
      const combinedSystemPrompt = [
        systemPrompt.trim(),
        GORSEL_TALIMATI,
        visionInstruction,
      ].filter(Boolean).join("\n\n");
      const requestMessages = [
        ...(combinedSystemPrompt ? [{ role: "system", content: combinedSystemPrompt }] : []),
        ...requestConversationMessages,
      ];
      const promptTokenEstimate = requestMessages.reduce((sum, message) => {
        const messageText = Array.isArray(message.content)
          ? message.content.map((item) => item.text || "").join(" ")
          : (message.content || "");
        return sum + estimateTokens(messageText);
      }, 0);
      setTokenUsage({
        prompt_tokens: promptTokenEstimate,
        completion_tokens: 0,
        total_tokens: promptTokenEstimate,
      });

      let assistantText = "";
      let rawAssistantText = "";
      let assistantReasoning = "";
      let streamedTokens = 0;
      let firstTokenAt = null;
      let thinkingStartedAt = null;
      let thinkingEndedAt = null;
      let thinkingDuration = 0;

      const thinkingEnabled = deepThinkEnabled;
      const manualMaxTokens = textSettings?.maxTokens || 1024;
      const effectiveMaxTokens = textSettings?.responseTokenMode === "manual"
        ? (thinkingEnabled ? Math.max(manualMaxTokens, 1024) : manualMaxTokens)
        : getAutoMaxResponseTokens(promptTokenEstimate, thinkingEnabled);

      const response = await streamChatWithLlm(requestMessages, {
        temperature: textSettings?.temperature || 0.7,
        maxTokens: effectiveMaxTokens,
        topP: textSettings?.topP,
        topK: textSettings?.topK,
        minP: textSettings?.minP,
        repeatPenalty: textSettings?.repeatPenalty,
        seed: textSettings?.seed,
        enableThinking: thinkingEnabled,
        useWeb: useWebSearch,
        timeFilter: webTimeFilter,
        signal: controller.signal,
        onArac: (olay) => {
          // Stüdyo işi başladı: kart hemen (yanıt akarken) görünsün
          const yeniIs = olay.durum === "bitti" && olay.studyo?.id ? studyoKartiOlustur(olay.studyo) : null;
          if (yeniIs && !studyoIsleri.some((x) => x.id === yeniIs.id)) studyoIsleri.push(yeniIs);
          // Medya isteği: kart yanıt bitince görünür (yanıt akarken iş başlatılamaz)
          const teklif = olay.durum === "bitti" && olay.studyoTeklif?.tur ? medyaKartiOlustur(olay.studyoTeklif, medyaIsleri.length) : null;
          if (teklif) medyaIsleri.push(teklif);
          const etiket = olay.durum === "bitti"
            ? (yeniIs ? "Üretim başlatıldı, yanıt hazırlanıyor..." : teklif ? "Tarif hazır; yanıt bitince model seçimi gösterilecek..." : "Sonuçlar okunuyor, yanıt hazırlanıyor...")
            : olay.ad === "web_ara" ? `Web'de aranıyor: ${olay.girdi}`
            : olay.ad === "hesapla" ? `Hesaplanıyor: ${olay.girdi}`
            : olay.ad === "saat" ? "Saate bakılıyor..."
            : olay.ad === "muzik_uret" ? "Müzik tarifi hazırlanıyor (gerekirse İngilizceye çevriliyor)..."
            : olay.ad === "efekt_uret" ? "Ses efekti tarifi hazırlanıyor (gerekirse İngilizceye çevriliyor)..."
            : olay.ad === "video_uret" ? "Video tarifi hazırlanıyor (gerekirse İngilizceye çevriliyor)..."
            : `Araç kullanılıyor: ${olay.ad}`;
          setMessages((prev) => {
            const updated = [...prev];
            const son = updated[updated.length - 1];
            if (son?.role === "assistant") {
              updated[updated.length - 1] = {
                ...son,
                ...(studyoIsleri.length ? { studyoIsleri: [...studyoIsleri] } : {}),
                generationStats: { ...(son.generationStats || {}), aracDurumu: etiket },
              };
            }
            return updated;
          });
        },
      }, (_token, fullText, _reasoningToken, fullReasoning) => {
        const now = performance.now();
        if (streamedTokens === 0) {
          firstTokenAt = now;
        }
        streamedTokens += 1;
        const generationSeconds = firstTokenAt
          ? Math.max(0.05, (now - firstTokenAt) / 1000)
          : Math.max(0.05, (now - requestStartedAt) / 1000);
        
        rawAssistantText = fullText;
        const processed = processMessageContent(fullText, fullReasoning, deepThinkEnabled);
        assistantText = processed.content;
        assistantReasoning = processed.reasoning;
        assistantTextForVoiceRef.current = typeof processed.content === "string" ? processed.content : "";
        // Okuma yanıt bitince başlar: yazarken seslendirme işlemciyi bölüp kasılmaya yol açıyordu

        // Calculate thinking duration
        if (processed.reasoning && !thinkingStartedAt) {
          thinkingStartedAt = now;
        }
        if (processed.content && thinkingStartedAt && !thinkingEndedAt) {
          thinkingEndedAt = now;
          thinkingDuration = (thinkingEndedAt - thinkingStartedAt) / 1000;
        }
        const currentThinkingDuration = thinkingEndedAt 
          ? thinkingDuration 
          : (thinkingStartedAt ? (now - thinkingStartedAt) / 1000 : 0);

        // Debounced stats update: only update stats every 250ms for smoother UI
        // while metin still updates per-frame via rAF batching
        const currentStats = {
          status: "streaming",
          tokens: streamedTokens,
          tokensPerSecond: streamedTokens / generationSeconds,
          seconds: (now - requestStartedAt) / 1000,
        };
        // rAF batching: accumulate updates and flush once per frame (~16ms)
        // This reduces React re-renders from N per token to ~60/sec
        tokenBufferRef.current = {
          content: processed.content,
          reasoning: processed.reasoning,
          thinkingDuration: currentThinkingDuration,
          stats: currentStats,
        };

        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            const buffer = tokenBufferRef.current;
            if (buffer) {
              setMessages((prev) => {
                const updated = [...prev];
                if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: buffer.content,
                    reasoning: buffer.reasoning,
                    thinkingDuration: buffer.thinkingDuration,
                    generationStats: buffer.stats,
                  };
                }
                return updated;
              });
              tokenBufferRef.current = null;
            }
            rafRef.current = null;
          });
        }
      });

      const completedAt = performance.now();
      let finalThinkingDuration = thinkingDuration;
      if (thinkingStartedAt && !thinkingEndedAt) {
        thinkingEndedAt = completedAt;
        finalThinkingDuration = (thinkingEndedAt - thinkingStartedAt) / 1000;
      }

      const exactTokens = Number(response.timings?.predicted_n) || streamedTokens;
      const backendTotalMs = Number(response.timings?.prompt_ms || 0) + Number(response.timings?.predicted_ms || 0);
      const exactSeconds = backendTotalMs > 0
        ? backendTotalMs / 1000
        : (completedAt - requestStartedAt) / 1000;
      const exactTokensPerSecond = Number(response.timings?.predicted_per_second)
        || (exactTokens / Math.max(0.001, exactSeconds));
      const generationStats = {
        status: "complete",
        tokens: exactTokens,
        tokensPerSecond: exactTokensPerSecond,
        seconds: exactSeconds,
        finishReason: response.finishReason || null,
        truncated: response.finishReason === "length",
      };
      
      const processed = processMessageContent(response.content || rawAssistantText || assistantText, response.reasoningContent || assistantReasoning, deepThinkEnabled);
      // Görsel isteği: etiketi metinden ayır, üretimi başlat
      let gorselIstendi = typeof processed.content === "string" && GORSEL_ISTEK_ISARETI.test(processed.content);
      if (typeof processed.content === "string") processed.content = gorselEtiketiniSil(processed.content);
      // Küçük model video/müzik isteğinde bazen görsel etiketini seçiyor: kullanıcının isteğine göre doğru karta yönlendir
      if (gorselIstendi && !medyaIsleri.length) {
        const sonK = [...nextMessages].reverse().find((m) => m.role === "user");
        const kMetin = typeof sonK?.content === "string" ? sonK.content : "";
        const medyaTuru = /(video|klip|animasyon)/i.test(kMetin) ? "video"
          : /(müzik|şarkı|beste|melodi)/i.test(kMetin) ? "muzik"
          : /(ses efekti|efekt)/i.test(kMetin) ? "efekt" : "";
        if (medyaTuru) {
          medyaIsleri.push(medyaKartiOlustur({ tur: medyaTuru, istem: kMetin.slice(0, 1000), ozgunIstem: kMetin.slice(0, 400) }, 0));
          gorselIstendi = false;
          processed.content = "";
        }
      }
      const gorselIs = gorselIstendi ? { id: "", istem: "", durum: "model-sec", convId } : null;
      // Görsel isteğinde (ve Vega boş yanıt verdiyse medya isteğinde) model sorusu metne eklenir
      const modelSorusu = gorselIs || (medyaIsleri.length && !String(processed.content || "").trim());
      const sonIcerik = modelSorusu && typeof processed.content === "string"
        ? `${processed.content ? processed.content + "\n\n" : ""}Hangi modelle üreteyim? Aşağıdan seçebilirsin.`
        : processed.content;
      const finalMessages = [...nextMessages, {
        role: "assistant",
        ...(gorselIs ? { gorselIs } : {}),
        ...(studyoIsleri.length ? { studyoIsleri: studyoKartlariniBirlestir(studyoIsleri) } : {}),
        ...(medyaIsleri.length ? { medyaIsleri: [...medyaIsleri] } : {}),
        content: sonIcerik,
        reasoning: processed.reasoning,
        thinkingDuration: finalThinkingDuration,
        generationStats,
        webSources: response.webSources || [],
      }];
      setMessages(finalMessages);
      saveConversationState(convId, finalMessages, selectedModel);
      if (sesliModRef.current && sesliYanitRef.current && typeof sonIcerik === "string") {
        seslendiriciRef.current?.metinGuncelle(sonIcerik, true);
      }
      const finalCompletionEstimate = Math.max(
        exactTokens,
        estimateTokens(processed.content) + estimateTokens(processed.reasoning)
      );
      const finalUsageEstimate = {
        prompt_tokens: promptTokenEstimate,
        completion_tokens: finalCompletionEstimate,
        total_tokens: promptTokenEstimate + finalCompletionEstimate,
      };
      setTokenUsage(response.usage
        ? {
            prompt_tokens: Math.max(Number(response.usage.prompt_tokens) || 0, finalUsageEstimate.prompt_tokens),
            completion_tokens: Math.max(Number(response.usage.completion_tokens) || 0, finalUsageEstimate.completion_tokens),
            total_tokens: Math.max(Number(response.usage.total_tokens) || 0, finalUsageEstimate.total_tokens),
          }
        : finalUsageEstimate
      );
      
      // Clean up attached dosyalar on success
      setAttachments([]);
    } catch (err) {
      if (err.name === "AbortError") {
        setMessages((prev) => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
            const lastMsg = updated[updated.length - 1];
            updated[updated.length - 1] = {
              ...lastMsg,
              // Durdurulan yanıtta hazırlanmış medya isteği varsa kart yine gösterilir (iş "Seç"le başlar)
              ...(medyaIsleri.length && !lastMsg.medyaIsleri ? { medyaIsleri: [...medyaIsleri] } : {}),
              generationStats: lastMsg.generationStats ? {
                ...lastMsg.generationStats,
                status: "complete",
              } : null
            };
            saveConversationState(convId, updated, selectedModel);
          }
          return updated;
        });
      } else {
        // Bağlantı koptuysa (ör. model kapandı) ham "ECONNRESET" yerine anlaşılır Türkçe mesaj
        const hamHata = String(err?.message || err || "");
        const baglantiKoptu = /ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|network ?error|failed to fetch|terminated|aborted|load failed/i.test(hamHata);
        const hataMetni = baglantiKoptu
          ? "Yanıt yarıda kesildi: sohbet modeline bağlantı koptu (model bir iş için bellekten çıkarılmış ya da yeniden yükleniyor olabilir). Model hazır olunca mesajınızı yeniden gönderebilirsiniz."
          : `Hata: ${hamHata}`;
        // Yanıt koptu ama iş başlamışsa / istek hazırlandıysa kart korunur
        const finalMessages = [...nextMessages, {
          role: "assistant", content: hataMetni, error: true,
          ...(studyoIsleri.length ? { studyoIsleri: studyoKartlariniBirlestir(studyoIsleri) } : {}),
          ...(medyaIsleri.length ? { medyaIsleri: [...medyaIsleri] } : {}),
        }];
        setMessages(finalMessages);
        saveConversationState(convId, finalMessages, selectedModel);
      }
    } finally {
      setIsBusy(false);
      abortControllerRef.current = null;
      // Yanıt hata/iptal ile bittiyse seslendiricinin beklemesi sonlansın
      if (seslendiriciRef.current && !seslendiriciRef.current.bitti) {
        seslendiriciRef.current.metinGuncelle(assistantTextForVoiceRef.current || "", true);
      }
      setTimeout(() => {
        followGenerationRef.current = false;
      }, 250);
    }
  };

  // --- Sesli sohbet (eller serbest) ---------------------------------------
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  inputRef.current = input;
  // Son çizimdeki mesajlar (akış bitince kartların güncel durumunu korumak için)
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Vega görseli: sunucu Vega'yı bellekten çıkarır, hızlı modla üretir, sonra geri yükler.
  // Bu sürede mikrofon duraklatılır; görsel hazır olunca sohbet mesajına eklenir.
  const gorselKartiniGuncelle = (convId, index, yama, kaydet = true) => {
    setMessages((prev) => {
      const m = prev[index];
      if (!m?.gorselIs) return prev;
      const updated = [...prev];
      updated[index] = { ...m, gorselIs: { ...m.gorselIs, ...yama } };
      if (kaydet) saveConversationState(convId, updated, selectedModel);
      return updated;
    });
  };

  // --- Sohbetteki stüdyo kartları (müzik / ses efekti / video) ------------------------------
  // message.studyoIsleri: [{ id, tur, model, istem, ozgunIstem, durum, ilerleme, asama, sonuc, hata, sohbetModeli, ... }]
  // Kartın canlı durumu StudyoSohbetKarti'nda yoklanır; bitiş (ve yeniden üretim) sohbet kaydına yazılır, böylece
  // sayfa yenilense de kart sonucu (oynatıcı + indirme) gösterir.
  const studyoKartiOlustur = (s) => ({
    id: String(s.id), tur: s.tur, model: s.model || "", istem: s.istem || "", ozgunIstem: s.ozgunIstem || "",
    durum: "sirada", ilerleme: 0, asama: "", sonuc: null, hata: "", olusturma: Date.now(),
  });
  // Akış sırasında kartın kaydettiği güncel durum (ör. bitti) kaybolmasın: mesajdaki son hâl öncelikli
  const studyoKartlariniBirlestir = (yerel) => {
    const son = messagesRef.current?.[messagesRef.current.length - 1];
    const mevcut = Array.isArray(son?.studyoIsleri) ? son.studyoIsleri : [];
    return yerel.map((x) => ({ ...x, ...(mevcut.find((m) => m.id === x.id) || {}) }));
  };
  // message.medyaIsleri: [{ anahtar, tur, istem, ozgunIstem, sure, durum: "model-sec"|"baslatiliyor"|"baslatilamadi"|
  //   "vazgecildi"|"sirada"|"calisiyor"|"tamam"|"hata"|"iptal"|"kayip", id?, model?, taban?, sonuc?, hata?, sohbetModeli? }]
  // Vega'nın aracı yalnızca tarifi hazırlar; iş, kartta model seçilip "Seç"e basılınca (yanıt bittikten sonra) başlar.
  // Oturum: Çıkış düğmesi (sohbet kaydedilir, sohbet modeli bellekten çıkarılır, giriş ekranına dönülür)
  const [oturum, setOturum] = useState(null);
  const [cikisYapiliyor, setCikisYapiliyor] = useState(false);
  useEffect(() => { kullaniciDurumu().then(setOturum).catch(() => {}); }, []);
  const oturumuKapat = async () => {
    setCikisYapiliyor(true);
    try { if (activeConversationId && messages.length) await saveConversationState(activeConversationId, messages, selectedModel); } catch (_) {}
    try { if (status.ready) await fetch("/api/llm/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch (_) {}
    try { await cikisYap(); } catch (_) {}
    window.location.reload();
  };
  const medyaKartiOlustur = (t, sira) => ({
    anahtar: `medya_${Date.now()}_${sira}`, tur: t.tur, istem: String(t.istem || ""), ozgunIstem: String(t.ozgunIstem || ""),
    sure: Number(t.sure) > 0 ? Number(t.sure) : 0, durum: "model-sec", olusturma: Date.now(),
  });
  const medyaKartiniGuncelle = (convId, index, anahtar, yama, kaydet = false) => {
    setMessages((prev) => {
      const m = prev[index];
      const liste = Array.isArray(m?.medyaIsleri) ? m.medyaIsleri : null;
      const j = liste ? liste.findIndex((x) => x.anahtar === anahtar) : -1;
      if (j < 0) return prev;
      const updated = [...prev];
      const yeniListe = [...liste];
      yeniListe[j] = { ...liste[j], ...yama };
      updated[index] = { ...m, medyaIsleri: yeniListe };
      if (kaydet && convId) saveConversationState(convId, updated, selectedModel);
      return updated;
    });
  };
  // Kart güncellemesi: mesaj index + iş kimliğiyle bulunur (yeniden üretimde kimlik değişir: eskiId)
  const studyoKartiniGuncelle = (convId, index, eskiId, yama, kaydet = false) => {
    setMessages((prev) => {
      const m = prev[index];
      const liste = Array.isArray(m?.studyoIsleri) ? m.studyoIsleri : null;
      const j = liste ? liste.findIndex((x) => x.id === eskiId) : -1;
      if (j < 0) return prev;
      const updated = [...prev];
      const yeniListe = [...liste];
      yeniListe[j] = { ...liste[j], ...yama };
      updated[index] = { ...m, studyoIsleri: yeniListe };
      if (kaydet && convId) saveConversationState(convId, updated, selectedModel);
      return updated;
    });
  };

  const kisaSeslendir = (metin) => {
    if (!sesliModRef.current || !sesliYanitRef.current || !seslendiriciRef.current) return;
    seslendiriciRef.current.sustur();
    seslendiriciRef.current.metinGuncelle(metin, true);
  };

  // 1) Model seçildi: tarif beklenir
  const modelSecildi = (convId, index, model) => {
    gorselKartiniGuncelle(convId, index, { durum: "tarif-bekle", model });
    const bekleyen = { convId, index, model };
    bekleyenGorselRef.current = bekleyen;
    setBekleyenGorsel(bekleyen);
    kisaSeslendir("Görseli tarif edin lütfen.");
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // 2) Tarif geldi: İngilizce isteme çevrilir, üretim başlar
  const gorselTarifiniIsle = async (bekleyen, tarif) => {
    const { convId, index, model } = bekleyen;
    setInput("");
    inputRef.current = "";
    // Kullanıcı tarifi ve "üretiliyor" mesajı sona eklenir
    const yeniIndex = messages.length + 1;
    setMessages((prev) => {
      const updated = [...prev];
      if (updated[index]?.gorselIs) updated[index] = { ...updated[index], gorselIs: { ...updated[index].gorselIs, durum: "secildi" } };
      updated.push({ role: "user", content: tarif });
      updated.push({ role: "assistant", content: "Görsel üretiliyor…", gorselIs: { id: "", istem: "", tarif, model, durum: "baslatiliyor", asama: "Tarif İngilizceye çevriliyor", convId } });
      saveConversationState(convId, updated, selectedModel);
      return updated;
    });
    gorselUretiliyorRef.current = true;
    dinlemeyiGuncelle();
    kisaSeslendir("Görsel üretiliyor.");
    let istem = "";
    try {
      const yanit = await chatWithLlm([
        { role: "system", content: ISTEM_TALIMATI },
        { role: "user", content: tarif },
      ], { temperature: 0.4, maxTokens: 220 });
      istem = String(yanit.content || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/^\s*(prompt|istem)\s*:\s*/i, "")
        .replace(/[\r\n]+/g, ", ")
        .replace(/^["'`\s]+|["'`\s]+$/g, "")
        .trim();
    } catch (_) { /* çeviri olmazsa tarif olduğu gibi kullanılır */ }
    if (istem.split(/\s+/).length < 3) istem = tarif;
    gorselKartiniGuncelle(convId, yeniIndex, { istem }, false);
    await new Promise((r) => setTimeout(r, 0));
    await gorselUretRef.current?.(convId, yeniIndex, istem, model);
  };

  gorselUretRef.current = async (convId, index, istem, model) => {
    const guncelle = (yama, kaydet = false) => {
      setMessages((prev) => {
        const m = prev[index];
        if (!m || !m.gorselIs || m.gorselIs.istem !== istem) return prev;
        const updated = [...prev];
        updated[index] = { ...m, gorselIs: { ...m.gorselIs, ...yama } };
        if (kaydet) saveConversationState(convId, updated, selectedModel);
        return updated;
      });
    };
    const seslendir = (metin) => {
      if (!sesliModRef.current || !sesliYanitRef.current) return;
      const s = seslendiriciRef.current;
      if (!s) return;
      s.sustur();
      s.metinGuncelle(metin, true);
    };
    gorselUretiliyorRef.current = true;
    guncelle({ durum: "baslatiliyor", asama: "Başlıyor", model });
    dinlemeyiGuncelle();
    let haberVerildi = false;
    try {
      const id = await vegaGorselBaslat(istem, model);
      guncelle({ id, durum: "uretiliyor", model }, true);
      let hataSayisi = 0;
      const sonSure = Date.now() + 30 * 60 * 1000;
      while (Date.now() < sonSure) {
        await new Promise((r) => setTimeout(r, 2500));
        let d;
        try { d = await vegaGorselDurumu(id); hataSayisi = 0; }
        catch (err) { if (++hataSayisi > 20) throw err; continue; }
        if (d.durum === "bitti") {
          if (!haberVerildi) {
            guncelle({ durum: "bitti", gorsel: d.gorsel, sureSn: d.sureSn, asama: "Hazır" }, true);
            seslendir("Görsel hazır.");
            haberVerildi = true;
          }
        } else if (d.durum === "hata") {
          if (!haberVerildi) {
            guncelle({ durum: "hata", hata: d.hata }, true);
            seslendir("Görsel üretilemedi.");
            haberVerildi = true;
          }
        } else {
          guncelle({ asama: d.asama, adim: d.adim || 0, toplam: d.toplam || 0, gecenSn: d.gecenSn || 0 });
        }
        // Görsel bitti (ya da hata verdi); sunucu sohbet modelini aynı ayarlarla geri yüklüyor
        if (!d.tamam && d.vegaYukleniyor) guncelle({ sohbetYukleniyor: true });
        if (d.tamam) {
          guncelle({ sohbetYukleniyor: false, llmHata: d.llmHata || "" }, true);
          break;
        }
      }
    } catch (err) {
      if (!haberVerildi) guncelle({ durum: "hata", hata: err.message || String(err) }, true);
      guncelle({ sohbetYukleniyor: false }, true);
    } finally {
      gorselUretiliyorRef.current = false;
      refresh().catch(() => {});
      dinlemeyiGuncelle();
    }
  };

  // Türkçe için Piper, İngilizce için Kokoro sesi seçilir (bir kez okunur)
  const sesleriHazirla = useCallback(async () => {
    try {
      // Sunucu o an yanıt vermezse (ör. yeniden başlarken) birkaç kez dene; sessizce Kokoro'ya düşme
      let durum = await getTtsStatus();
      for (let deneme = 0; deneme < 4 && (durum.error || !(durum.voices || []).length); deneme += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        durum = await getTtsStatus();
      }
      const ttsModelleri = (await listTtsModels().catch(() => [])).filter((m) => !m.motor);
      const sesler = durum.voices || [];
      // Türkçe ses: Model Yöneticisi'nde etkin olan Türkçe motor (EMA, Piper, Antalia...), yoksa EMA, yoksa Piper
      const etkin = String(durum.settings?.etkin || "");
      // OmniVoice yedek ses olamaz: işlemcide çok yavaş; klon ses gecikince okumayı bu ses üstlenir
      const etkinTurkce = /^(ema|piper|antalia|supertonic|ahenk):/.test(etkin) ? sesler.find((v) => v.id === etkin) : null;
      const ema = sesler.find((v) => v.id === "ema:tr");
      const tr = etkinTurkce || ema || sesler.find((v) => String(v.id).startsWith("piper:") && /^tr/i.test(v.language || v.id.slice(6)));
      // EMA'nın ilk açılışı yavaş (PyTorch yükleniyor); sesli mod açılırken arka planda ısıt (seçimi değiştirmez)
      if (tr?.id === "ema:tr") fetch("/api/tts/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice: "ema:tr", isinma: true }) }).catch(() => {});
      const enSes = ttsSettings?.voice && !/^(piper|ema|antalia|supertonic|ahenk|omnivoice):/.test(String(ttsSettings.voice)) ? ttsSettings.voice : "af_heart";
      const etkinKokoro = etkin && ttsModelleri.some((m) => m.filename === etkin) ? etkin : "";
      const kokoroModeli = etkinKokoro || ttsSettings?.model || (ttsModelleri.find((m) => m.installed !== false) || ttsModelleri[0])?.filename || "";
      sesKaynaklariRef.current.trSes = tr?.id || "";
      sesKaynaklariRef.current.enSes = kokoroModeli ? enSes : "";
      sesKaynaklariRef.current.kokoroModeli = kokoroModeli;
      sesKaynaklariRef.current.seslerHazir = true;
    } catch (_) {}
  }, [ttsSettings]);

  const seslendiriciOlustur = useCallback(() => {
    const k = sesKaynaklariRef.current;
    seslendiriciRef.current?.sustur();
    seslendiriciRef.current = new Seslendirici({
      hiz: ttsSettings?.speed || 1,
      sesSec: (cumle) => {
        const dil = dilTahmin(cumle);
        if (dil === "en" && k.enSes) return { voice: k.enSes, model: k.kokoroModeli };
        const normal = k.trSes ? { voice: k.trSes } : k.enSes ? { voice: k.enSes, model: k.kokoroModeli } : { voice: ttsSettings?.voice };
        // "Vega benim sesimle yanıt versin": Türkçe cümleler klon sesle; hata/süre aşımında normal sese dönülür
        const klon = klonSecimRef.current;
        return klon.voice ? { ...normal, klon: { voice: klon.voice, zamanAsimiSn: klon.zamanAsimiSn } } : normal;
      },
      onKlonHata: (err) => {
        setKlonUyari(`Vega'nın klon sesi kullanılamadı: ${err?.message || err}. Bu yanıtın kalanı normal sesle okunuyor.`);
      },
      // Klon hazır değil / meşgul / süre aştı: cümle normal sesle okundu; durum yenilenir
      onKlonDurum: ({ kod }) => {
        if (kod === "KLON_ZAMAN_ASIMI") setKlonUyari("Bir cümle klon sesle süre sınırında bitmedi; o cümle normal sesle okundu. Klon ses sonraki cümlelerde yeniden denenir.");
        klonDurumYoklaRef.current?.();
      },
      onDurum: ({ aktif, klon }) => {
        setKlonUretiyor(Boolean(klon));
        const onceki = konusuyorRef.current;
        konusuyorRef.current = aktif;
        // Okuma bitince hoparlördeki son sesler mikrofona girmesin diye kısa bir ara
        if (onceki && !aktif) sessizlikSonuRef.current = Date.now() + 1200;
        setKonusuyor(aktif);
        if (!aktif) setOkunanIndex(null);
        dinlemeyiGuncelle();
      },
    });
    return seslendiriciRef.current;
  }, [ttsSettings]); // dinlemeyiGuncelle kararlı (bağımlılıksız useCallback)

  // Hoparlör düğmesi: mesajı baştan okur; aynı mesaj okunuyorsa durdurur
  const mesajiOku = useCallback(async (index, metin) => {
    if (okunanIndex === index && konusuyorRef.current) {
      seslendiriciRef.current?.sustur();
      return;
    }
    if (!sesKaynaklariRef.current.seslerHazir) await sesleriHazirla();
    const s = seslendiriciRef.current || seslendiriciOlustur();
    s.sustur();
    setOkunanIndex(index);
    s.metinGuncelle(metin, true);
  }, [okunanIndex, sesleriHazirla, seslendiriciOlustur]);

  const ellerSerbestDegistir = () => {
    const yeni = !ellerSerbestRef.current;
    ellerSerbestRef.current = yeni;
    setEllerSerbest(yeni);
    try { localStorage.setItem("sesliEllerSerbest", yeni ? "1" : "0"); } catch (_) {}
  };

  // -- Ses klonlama ayarları ---------------------------------------------------
  const klonVerisiniUygula = useCallback((v) => {
    if (!v?.ayarlar) return;
    setKlonVeri(v);
    const a = v.ayarlar;
    setOrnekToplaYerel(a.ornekTopla); yerelYaz("klonOrnekTopla", a.ornekTopla ? "1" : "0");
    setVegaKlonYerel(a.vegaKlonSesi); yerelYaz("vegaKlonSesi", a.vegaKlonSesi ? "1" : "0");
    const secili = a.vegaKlonDosyasi || (v.klonlar.find((k) => k.ad === "Benim sesim") || v.klonlar[0])?.dosya || "";
    setVegaKlonDosyasiSecimi(secili); yerelYaz("vegaKlonDosyasi", secili);
    setKlonZamanAsimi(a.zamanAsimiSn); yerelYaz("klonZamanAsimiSn", a.zamanAsimiSn);
    if (v.hazirlik) setKlonHazirlik(v.hazirlik);
    // Klon ses yalnızca sunucu onaylıysa (OmniVoice kurulu, klon ve onay kaydı var) kullanılır
    klonSecimRef.current = { voice: a.vegaKlonSesi && v.omnivoiceKurulu !== false ? a.vegaSesKimligi : "", zamanAsimiSn: a.zamanAsimiSn };
  }, []);

  const klonDurumunuYenile = useCallback(async () => {
    try { klonVerisiniUygula(await klonListesi()); } catch (_) { klonSecimRef.current = { voice: "", zamanAsimiSn: 0 }; }
  }, [klonVerisiniUygula]);

  useEffect(() => { klonDurumunuYenile(); }, [klonDurumunuYenile]);

  // Klon sesin hazırlık durumu. Sesli sohbet açıkken yoklama modeli bellekte de tutar (klonCanli).
  const klonDurumYokla = useCallback(async (govde) => {
    try {
      const r = govde || sesliModRef.current ? await klonCanli(govde || {}) : await klonDurumu();
      if (r?.hazirlik) setKlonHazirlik(r.hazirlik);
      return r?.hazirlik || null;
    } catch (_) { return null; }
  }, []);
  const klonDurumYoklaRef = useRef(null);
  klonDurumYoklaRef.current = () => klonDurumYokla();

  // Anahtar açıkken (sesli sohbet ya da ses ayarları açıksa) düzenli yoklama: yüklenirken sık, hazırken seyrek
  useEffect(() => {
    if (!vegaKlonYerel || !(sesliMod || klonAyarAcik)) return undefined;
    let bitti = false;
    let zaman = null;
    const dongu = async () => {
      const h = await klonDurumYokla();
      if (bitti) return;
      zaman = setTimeout(dongu, h && (h.durum === "yukleniyor" || h.durum === "mesgul") ? 3000 : 20000);
    };
    dongu();
    return () => { bitti = true; clearTimeout(zaman); };
  }, [vegaKlonYerel, sesliMod, klonAyarAcik, klonDurumYokla]);

  const klonAyariKaydet = async (degisiklik) => {
    setKlonMesgul(true);
    setKlonHata("");
    try {
      klonVerisiniUygula(await klonAyarlariKaydet(degisiklik));
      if (degisiklik.vegaKlonSesi !== undefined || degisiklik.vegaKlonDosyasi !== undefined) setKlonUyari("");
      // Yeni seçim bir sonraki yanıttan itibaren geçerli (önceki hata yüzünden kapandıysa yeniden denenir)
      if (seslendiriciRef.current) seslendiriciRef.current.klonKapali = false;
      return true;
    } catch (err) {
      setKlonHata(err.message || String(err));
      // Sunucu "OmniVoice kurulu değil / klon yok" dediyse ekrandaki durum tazelensin
      if (err.code === "OMNIVOICE_YOK" || err.code === "KLON_YOK") klonDurumunuYenile();
      return false;
    } finally {
      setKlonMesgul(false);
    }
  };

  const ornekToplamaDegistir = () => {
    if (klonMesgul) return;
    if (ornekToplaYerel) klonAyariKaydet({ ornekTopla: false });
    else setKlonOnayAcik(true); // açmak için kendi sesiniz için onay gerekir
  };

  const ornekleriSilTiklandi = async () => {
    const tamam = showConfirm
      ? await showConfirm({ title: "Toplanan örnekler silinsin mi?", message: "Sesli sohbetten toplanan tüm ses örnekleri ve metinleri bu bilgisayardan silinecek. Oluşturulmuş klonlar silinmez.", confirmLabel: "Sil", cancelLabel: "Vazgeç", danger: true })
      : window.confirm("Toplanan örnekler silinsin mi?");
    if (!tamam) return;
    setKlonMesgul(true);
    try { klonVerisiniUygula(await klonOrnekleriSil()); } catch (err) { setKlonHata(err.message || String(err)); }
    finally { setKlonMesgul(false); }
  };

  // Ayar kutusu dışına tıklanınca / Escape ile kapanır
  useEffect(() => {
    if (!klonAyarAcik) return undefined;
    const tikla = (e) => {
      if (klonOnayAcik || klonOrnekPenceresi) return;
      if (klonAyarKutusuRef.current && !klonAyarKutusuRef.current.contains(e.target)) setKlonAyarAcik(false);
    };
    const tus = (e) => { if (e.key === "Escape" && !klonOnayAcik && !klonOrnekPenceresi) setKlonAyarAcik(false); };
    document.addEventListener("mousedown", tikla);
    window.addEventListener("keydown", tus);
    return () => { document.removeEventListener("mousedown", tikla); window.removeEventListener("keydown", tus); };
  }, [klonAyarAcik, klonOnayAcik, klonOrnekPenceresi]);

  const sesliModunuKapat = useCallback(async () => {
    sesliModRef.current = false;
    setSesliMod(false);
    clearTimeout(beklemeZamanlayiciRef.current);
    clearTimeout(otoGonderZamanlayiciRef.current);
    ceviriKuyruguRef.current = [];
    setCeviriBekleyen(0);
    konusuyorRef.current = false;
    cevirmedeRef.current = false;
    seslendiriciRef.current?.sustur();
    // Klon ses modeli birkaç dakika daha bellekte kalır (sesli sohbet yeniden açılırsa beklenmesin), sonra kapanır
    if (klonSecimRef.current.voice) klonCanli({ kapat: true }).catch(() => {});
    const d = dinleyiciRef.current;
    dinleyiciRef.current = null;
    if (d) await d.durdur();
    setSesDurumu("kapali");
    setSeviye({ rms: 0, esik: 1 });
  }, []);

  useEffect(() => () => { sesliModunuKapat(); }, [sesliModunuKapat]);

  // Mikrofon tek bir yerden yönetilir: model yazarken, yanıt okunurken ve okuma
  // bittikten sonraki kısa sürede dinleme duraklatılır. Yazıya çevirme sırasında
  // dinleme sürer; böylece uzun konuşmalarda arada söylenenler kaybolmaz.
  // Böylece model kendi sesini kullanıcı konuşuyor sanmaz.
  const dinlemeyiGuncelle = useCallback(() => {
    const d = dinleyiciRef.current;
    if (!sesliModRef.current || !d) return;
    const kalan = sessizlikSonuRef.current - Date.now();
    const engel = isBusyRef.current || gorselUretiliyorRef.current || konusuyorRef.current || kalan > 0;
    if (engel) {
      if (!d.duraklatildi) d.duraklat();
      setSesDurumu(isBusyRef.current ? "dusunuyor" : konusuyorRef.current ? "konusuyor" : gorselUretiliyorRef.current ? "gorsel" : "konusuyor");
      if (kalan > 0 && !isBusyRef.current && !konusuyorRef.current && !gorselUretiliyorRef.current) {
        clearTimeout(beklemeZamanlayiciRef.current);
        beklemeZamanlayiciRef.current = setTimeout(() => dinlemeyiGuncelle(), kalan + 50);
      }
    } else {
      if (d.duraklatildi) d.devam();
      setSesDurumu(d.durum === "kalibre" ? "kalibre" : d.durum === "kayit" ? "kayit" : "dinliyor");
    }
  }, []);

  // Eller serbest: tüm parçalar çevrilip kullanıcı bir süre sustuğunda yazı kutusu gönderilir.
  // Kısa düşünme duraksamaları (0,8 sn) parçayı böler ama mesajı göndermez.
  const OTO_GONDER_BEKLEME_MS = 1500;
  const otoGonderPlanla = useCallback(() => {
    clearTimeout(otoGonderZamanlayiciRef.current);
    if (!sesliModRef.current || !ellerSerbestRef.current) return;
    const hazirMi = () => !cevirmedeRef.current && ceviriKuyruguRef.current.length === 0 &&
      dinleyiciRef.current?.durum !== "kayit" && !isBusyRef.current;
    if (!hazirMi()) return;
    otoGonderZamanlayiciRef.current = setTimeout(() => {
      if (!sesliModRef.current || !ellerSerbestRef.current || !hazirMi()) return;
      const metin = String(inputRef.current || "").trim();
      if (metin) sendMessageRef.current(metin);
    }, OTO_GONDER_BEKLEME_MS);
  }, []);

  const metniYaziKutusunaEkle = (metin) => {
    const onceki = String(inputRef.current || "");
    const yeni = (onceki.trim() ? onceki.replace(/\s+$/, "") + " " : "") + metin;
    inputRef.current = yeni; // sonraki parça render beklemeden doğru metnin üstüne eklensin
    setInput(yeni);
    if (ellerSerbestRef.current) return;
    setTimeout(() => {
      const t = textareaRef.current;
      if (t) {
        t.focus();
        const son = t.value.length;
        try { t.setSelectionRange(son, son); } catch (_) {}
      }
    }, 0);
  };

  const ceviriKuyrugunuIsle = async () => {
    if (cevirmedeRef.current) return;
    cevirmedeRef.current = true;
    try {
      while (ceviriKuyruguRef.current.length > 0 && sesliModRef.current) {
        const wav = ceviriKuyruguRef.current.shift();
        try {
          // Sesli mod açıkken Model Yöneticisi'nde etkin model değiştiyse bir sonraki cümleden itibaren onu kullan
          try {
            const etkin = (await getSpeechStatus())?.settings?.model;
            if (etkin) sesKaynaklariRef.current.konusmaModeli = etkin;
          } catch (_) { /* durum alınamazsa mevcut modelle devam */ }
          const sonuc = await transcribeSpeech(wav, {
            model: sesKaynaklariRef.current.konusmaModeli || undefined,
            language: sesDiliRef.current || "tr",
            threads: speechSettings?.threads,
            backendPreference: speechSettings?.backendPreference,
            filename: "sesli-sohbet.wav",
            gecici: true,
          });
          const metin = String(sonuc?.text || "").replace(/\s+/g, " ").trim();
          if (sesliModRef.current && metin && !halusinasyonMu(metin)) {
            setSonDokum(metin);
            metniYaziKutusunaEkle(metin);
          }
        } catch (err) {
          setSesHata(err.message || String(err));
        }
        setCeviriBekleyen(ceviriKuyruguRef.current.length);
      }
    } finally {
      cevirmedeRef.current = false;
      setCeviriBekleyen(0);
      otoGonderPlanla();
    }
  };
  const ceviriKuyrugunuIsleRef = useRef(ceviriKuyrugunuIsle);
  ceviriKuyrugunuIsleRef.current = ceviriKuyrugunuIsle;

  // Her konuşma parçası kuyruğa eklenir; hiçbiri atlanmaz.
  const konusmaGeldi = useCallback((wav) => {
    if (!sesliModRef.current) return;
    clearTimeout(otoGonderZamanlayiciRef.current);
    setSesHata("");
    ceviriKuyruguRef.current.push(wav);
    setCeviriBekleyen(ceviriKuyruguRef.current.length + (cevirmedeRef.current ? 1 : 0));
    ceviriKuyrugunuIsleRef.current();
  }, []);

  useEffect(() => {
    isBusyRef.current = isBusy;
    dinlemeyiGuncelle();
  }, [isBusy, sesliMod, dinlemeyiGuncelle]);

  const sesliModunuAc = useCallback(async () => {
    setSesHata("");
    // Konuşma modeli: çok dilli (".en" olmayan) kurulu model tercih edilir
    try {
      const [modeller, konusmaDurumu] = await Promise.all([listSpeechModels(), getSpeechStatus().catch(() => ({}))]);
      const kurulu = modeller.filter((m) => m.installed !== false);
      // Öncelik: Model Yöneticisi'nde etkin olan sesten metne modeli
      const etkinModel = konusmaDurumu?.settings?.model;
      const etkinKurulu = etkinModel ? kurulu.find((m) => m.filename === etkinModel || m.id === etkinModel) : null;
      // Çok dilli modeller arasında öncelik: küçültülmüş small (q5, ~1,5 kat hızlı) > small > diğerleri
      const cokDilli = kurulu.filter((m) => !/\.en\b|english/i.test(`${m.filename} ${m.language || ""}`));
      const whisperler = cokDilli.filter((m) => !m.paket);
      const secilen = etkinKurulu || whisperler.find((m) => /small-q5/i.test(m.filename))
        || whisperler.find((m) => /small/i.test(m.filename))
        || whisperler[0] || cokDilli[0] || kurulu[0];
      // Etkin model yoksa varsayılan Whisper small q5 (ilk denemelerde Seda/Duyu'dan iyi çıktı)
      if (!secilen) {
        showAlert?.({ title: "Konuşma modeli yok", message: "Sesli sohbet için bir Whisper modeli gerekli. Model Yöneticisi > Sesten Metne Modelleri'nden indirin.", danger: true });
        return;
      }
      sesKaynaklariRef.current.konusmaModeli = secilen.filename;
      // Seda/Duyu gibi Python motorları ilk cümlede açılıyor (~30 sn); sesli mod açılırken yarım saniyelik
      // sessizlikle arka planda ısıtılır, kullanıcı konuşmaya başladığında motor hazır olur
      if (secilen.paket) {
        transcribeSpeech(wavKodla(new Float32Array(8000), 16000), { model: secilen.filename, language: "tr", filename: "isinma.wav", gecici: true }).catch(() => {});
      }
    } catch (err) {
      showAlert?.({ title: "Konuşma modelleri okunamadı", message: err.message || String(err), danger: true });
      return;
    }
    await sesleriHazirla();
    await klonDurumunuYenile(); // Metinden Sese sayfasında yeni klon eklendiyse görülsün
    setKlonUyari("");
    // "Vega benim sesimle" açıksa klon ses modeli şimdiden yüklenmeye başlar; hazır olana kadar normal ses konuşur
    if (klonSecimRef.current.voice) klonDurumYokla({ isit: true });
    seslendiriciOlustur();
    const d = new Dinleyici({
      onKonusma: (wav) => konusmaGeldi(wav),
      onDurum: (durum) => {
        if (durum === "duraklatildi") return;
        // Yeni konuşma başladıysa bekleyen otomatik gönderim iptal; bittiyse yeniden planlanır
        if (durum === "kayit") clearTimeout(otoGonderZamanlayiciRef.current);
        if (durum === "dinliyor") otoGonderPlanla();
        if (durum === "dinliyor" || durum === "kalibre") { dinlemeyiGuncelle(); return; }
        setSesDurumu(durum);
      },
      onSeviye: (rms, esik) => {
        const simdi = performance.now();
        if (simdi - seviyeZamaniRef.current > 80) {
          seviyeZamaniRef.current = simdi;
          setSeviye({ rms, esik });
        }
      },
    });
    try {
      await d.baslat();
    } catch (err) {
      showAlert?.({ title: "Mikrofon açılamadı", message: `${err.message || err}. Tarayıcının mikrofon iznini kontrol edin.`, danger: true });
      return;
    }
    dinleyiciRef.current = d;
    sesliModRef.current = true;
    setSesliMod(true);
    dinlemeyiGuncelle();
  }, [konusmaGeldi, otoGonderPlanla, showAlert, sesleriHazirla, seslendiriciOlustur, dinlemeyiGuncelle, klonDurumunuYenile]);

  const sesliYanitDegistir = () => {
    const yeni = !sesliYanitRef.current;
    sesliYanitRef.current = yeni;
    setSesliYanit(yeni);
    if (!yeni) seslendiriciRef.current?.sustur();
  };

  // Yazı kutusu notu: sohbet modeli yüklü değilken sunucunun bildirdiği nedene göre (video, görsel, geri yükleme)
  const sohbetModeliNotu = (() => {
    if (status.ready || loadingModel) return null;
    const d = sohbetModeliBilgi;
    const g = d?.geriYukleme;
    const ad = (m) => (m ? ` (${modelKisaAd(m)})` : "");
    if (geriYukleIstendi || g?.durum === "yukleniyor") {
      return { donuyor: true, kisa: "Sohbet modeli yeniden yükleniyor…", metin: `Sohbet modeli yeniden yükleniyor…${ad(g?.model || d?.bekleyen?.model)} Hazır olunca yazabilirsiniz.` };
    }
    if (d?.videoSuruyor) {
      return { donuyor: true, kisa: "Video üretiliyor; sohbet modeli video bitince geri yüklenecek",
        metin: `Video üretimi sürüyor: sohbet modeli${ad(d?.bekleyen?.model)} geçici olarak bellekten çıkarıldı ve video bitince otomatik geri yüklenecek. Bu sırada mesaj gönderilemez; ilerlemeyi sohbetteki video kartından izleyebilirsiniz.` };
    }
    if (gorselUretiliyorRef.current) {
      return { donuyor: true, kisa: "Görsel üretiliyor; sohbet modeli görsel bitince geri yüklenecek",
        metin: "Görsel üretiliyor: sohbet modeli bellekten çıkarıldı ve görsel bitince otomatik geri yüklenecek." };
    }
    if (g?.durum === "bekliyor") {
      return { donuyor: true, kisa: "Sohbet modeli birazdan geri yüklenecek", metin: `Süren iş bitince sohbet modeli${ad(g.model)} otomatik geri yüklenecek.` };
    }
    if (d?.bekleyen?.kaynak === "gorsel") {
      return { simdiYukle: true, kisa: "Sohbet modeli Görsel Stüdyo için kapatıldı",
        metin: `Sohbet modeli${ad(d.bekleyen.model)} Görsel Stüdyo için kapatıldı; görsel motoru boşalınca (ya da 3 dakika boşta kalınca) otomatik geri yüklenecek.` };
    }
    if (g?.durum === "hata" && Date.now() - (g.zaman || 0) < 30 * 60 * 1000) {
      return { hata: true, kisa: "Sohbet modeli geri yüklenemedi; yukarıdan yükleyin",
        metin: `Sohbet modeli${ad(g.model)} otomatik geri yüklenemedi: ${g.hata || "bilinmeyen hata"}. Yukarıdaki model seçiciden yeniden yükleyebilirsiniz.` };
    }
    return null;
  })();

  const handleClearChat = () => {
    setMessages([]);
    setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    if (activeConversationId) {
      saveConversationState(activeConversationId, [], selectedModel);
    }
  };

  return (
    <div className="text-chat-layout" style={{ display: "flex", height: "100%", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      <section className="text-chat-main" style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
        {/* --- Header ------------------------------------------- */}
        <div className="text-chat-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>

            <div ref={modelMenuRef} style={{ position: "relative", display: "inline-block", flex: "0 1 280px", maxWidth: "280px", width: "100%" }}>
              <button
                onClick={() => !isBusy && setShowModelMenu(!showModelMenu)}
                className={`chat-model-select-trigger ${showModelMenu ? "active" : ""}`}
                disabled={isBusy}
                title="GGUF Modeli Seç"
              >
                <span className="chat-model-select-label">
                  {selectedModel ? (bulutEtiketi(selectedModel) || selectedModel) : "Model yüklü değil (GGUF seçin)"}
                </span>
                <ChevronDown size={14} className={`chat-model-select-arrow ${showModelMenu ? "open" : ""}`} />
              </button>

              {showModelMenu && (
                <div className="chat-model-dropdown-menu">
                  <button
                    className={`chat-model-dropdown-item ${!selectedModel ? "selected" : ""}`}
                    onClick={() => {
                      handleModelChange("");
                      setShowModelMenu(false);
                    }}
                  >
                    {status.ready ? "Modeli kapat (bellekten çıkar)" : "Model yüklü değil (GGUF seçin)"}
                  </button>
                  {models.map((m) => {
                    const isActive = m.filename === status.settings?.model && status.ready;
                    const isSelected = m.filename === selectedModel;
                    return (
                      <button
                        key={m.filename}
                        className={`chat-model-dropdown-item ${isSelected ? "selected" : ""} ${isActive ? "active" : ""}`}
                        onClick={() => {
                          handleModelChange(m.filename);
                          setShowModelMenu(false);
                        }}
                        title={m.filename}
                      >
                        <span className="chat-model-name-text">{m.bulut ? m.name : m.filename}</span>
                        {m.bulut && (
                          <span className="chat-model-active-badge" title="Bulut modeli: mesajlar sağlayıcıya gönderilir"
                            style={{ textTransform: "none", display: "inline-flex", alignItems: "center", gap: 3, background: "color-mix(in srgb, #0ea5e9 16%, transparent)", color: "#0ea5e9" }}>
                            <Cloud size={10} /> {m.etiket || "Bulut"}
                          </span>
                        )}
                        {isActive && <span className="chat-model-active-badge">Etkin</span>}
                      </button>
                    );
                  })}
                  <button
                    className="chat-model-dropdown-item"
                    style={{ borderTop: "1px solid var(--border-color)", marginTop: 4, paddingTop: 10, color: "var(--md-sys-color-primary)" }}
                    onClick={() => { setShowModelMenu(false); setBulutModalAcik(true); }}
                    title="OpenAI, Gemini, Claude ya da OpenRouter modelini kendi API anahtarınızla ekleyin"
                  >
                    <span className="chat-model-name-text">+ Bulut modeli ekle</span>
                    <Cloud size={14} />
                  </button>
                </div>
              )}
            </div>
            {status.ready && !loadingModel && (
              <button
                className="m3-btn m3-btn-outlined"
                onClick={() => handleModelChange("")}
                disabled={isBusy}
                title="Yüklü metin modelini durdurup belleği boşaltır"
                style={{ height: "38px", padding: "0 12px", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "6px", borderRadius: "var(--md-shape-corner-medium)" }}
              >
                <Power size={14} />
                <span>Modeli kapat</span>
              </button>
            )}
            {oturum?.girisli && (
              <button
                className="m3-btn m3-btn-outlined"
                onClick={oturumuKapat}
                disabled={cikisYapiliyor}
                title={`${oturum.kullanici?.ad || ""} hesabından çık: sohbet kaydedilir, model bellekten çıkarılır`}
                style={{ height: "38px", padding: "0 12px", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "6px", borderRadius: "var(--md-shape-corner-medium)" }}
              >
                {cikisYapiliyor ? <LoaderCircle className="progress-spinner" size={14} /> : <LogOut size={14} />}
                <span>Çıkış</span>
              </button>
            )}
            {selectedModel && (!status.ready || status.settings?.model !== selectedModel) && !loadingModel && (
              <button
                className="m3-btn m3-btn-filled"
                onClick={() => handleModelChange(selectedModel)}
                disabled={isBusy}
                style={{
                  height: "38px", padding: "0 16px", fontSize: "0.85rem",
                  borderRadius: "var(--md-shape-corner-medium)",
                  background: "var(--md-sys-color-primary)",
                  color: "var(--md-sys-color-on-primary)",
                  cursor: "pointer", border: "none", fontWeight: "600",
                  display: "flex", alignItems: "center", gap: "6px"
                }}
              >
                Modeli Yükle
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
            {/* Context gauge */}
            {(() => {
              const maxTokens = status.settings?.contextSize || 4096;
              const used = tokenUsage.total_tokens || 0;
              const percent = Math.min(100, Math.round((used / maxTokens) * 100));
              return (
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }} title={`Kullanılan bağlam: ${used} / ${maxTokens} tokens`}>
                  <div style={{ position: "relative", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="32" height="32" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" stroke="var(--border-color)" strokeWidth="3" fill="transparent" />
                      <circle cx="20" cy="20" r="16" stroke="var(--md-sys-color-primary)" strokeWidth="3" fill="transparent"
                        strokeDasharray={2 * Math.PI * 16}
                        strokeDashoffset={2 * Math.PI * 16 * (1 - percent / 100)}
                        strokeLinecap="round" transform="rotate(-90 20 20)"
                        style={{ transition: "stroke-dashoffset 0.35s" }}
                      />
                    </svg>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: "0.58rem", fontWeight: "700", lineHeight: 1 }}>{percent}%</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                    <span style={{ fontSize: "0.6rem", color: "var(--md-sys-color-outline)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Bağlam</span>
                    <span style={{ fontSize: "0.76rem", fontWeight: "600", color: "var(--md-sys-color-on-surface)" }}>{used} / {maxTokens}</span>
                  </div>
                </div>
              );
            })()}

            <button
              className="m3-btn m3-btn-outlined"
              style={{ height: "32px", padding: "0 10px", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", borderRadius: "var(--md-shape-corner-medium)" }}
              onClick={handleClearChat}
              disabled={messages.length === 0}
            >
              <Trash2 size={14} />
              <span>Temizle</span>
            </button>
          </div>
        </div>

        {/* --- Messages area ------------------------------------ */}
        <div
          ref={chatMessagesRef}
          className="chat-messages"
          onWheel={() => {
            if (isBusy) followGenerationRef.current = false;
          }}
          onTouchMove={() => {
            if (isBusy) followGenerationRef.current = false;
          }}
        >
          {loadingModel ? (
            <div className="chat-empty" style={{ maxWidth: "480px", margin: "auto", textAlign: "center", padding: "60px 20px" }}>
              <LoaderCircle className="progress-spinner" size={48} style={{ color: "var(--md-sys-color-primary)", marginBottom: "16px" }} />
              <h3 style={{ fontWeight: 600, fontSize: "1.25rem", marginBottom: "8px", color: "var(--md-sys-color-on-surface)" }}>Metin Modeli Yükleniyor</h3>
              <code style={{
                display: "block", background: "var(--md-sys-color-surface-variant)",
                color: "var(--md-sys-color-on-surface-variant)", padding: "8px 12px",
                borderRadius: "6px", fontSize: "0.85rem", marginBottom: "20px",
                wordBreak: "break-all", fontFamily: "monospace"
              }}>
                {loadingModel}
              </code>
              <p style={{ fontSize: "0.9rem", color: "var(--md-sys-color-outline)", lineHeight: 1.5, marginBottom: "24px" }}>
                llama.cpp sunucusu başlatılıyor ve model ağırlıkları belleğe yükleniyor. Model boyutuna ve donanım hızına bağlı olarak bu işlem 30 saniyeyi bulabilir.
              </p>
              <button className="m3-btn m3-btn-error" onClick={handleCancelLlmLoad}
                style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 16px", fontSize: "0.85rem", borderRadius: "var(--md-shape-corner-medium)" }}
              >
                <Square size={14} fill="currentColor" />
                <span>Yüklemeyi İptal Et</span>
              </button>
            </div>
          ) : (
            <>
              {messages.length === 0 && (
                <div className="chat-empty">
                  <div className="chat-empty-icon">
                    <Bot size={30} />
                  </div>
                  <h3>Vega</h3>
                  <p>{status.settings?.bulut
                    ? `Şu an bulut modeli seçili (${status.settings.etiket || "Bulut"}). Mesajlarınız sağlayıcıya gönderilir ve onun kuralları geçerlidir. Tamamen yerel çalışmak için yukarıdan bir GGUF modeli seçin.`
                    : "Bu bilgisayarda çalışan, çevrimdışı yapay zekâ asistanınız. Yukarıdan bir GGUF modeli seçip sohbete başlayın - her şey bilgisayarınızda kalır."}</p>
                  {status.ready && (
                    <div className="chat-suggestions">
                      {[
                        { icon: "", text: "Bir toplantıyı yeniden planlamak için profesyonel bir e-posta yaz" },
                        { icon: "", text: "Transformer'ların nasıl çalıştığını basitçe açıkla" },
                        { icon: "", text: "Bu Python kodundaki hatayı bulmama yardım et" },
                        { icon: "", text: "Bir konunun ana noktalarını özetle" },
                      ].map((s, i) => (
                        <button
                          key={i}
                          className="chat-suggestion-chip"
                          onClick={() => { setInput(s.text); }}
                        >
                          <span style={{ fontSize: "1rem", flexShrink: 0 }}>{s.icon}</span>
                          <span>{s.text}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {messages.map((message, index) => {
                const processed = processMessageContent(
                  Array.isArray(message.content) ? "" : (message.content || ""),
                  message.reasoning || "",
                  deepThinkEnabled
                );
                const displayContent = Array.isArray(message.content) ? message.content : gorselEtiketiniSil(processed.content);
                const displayReasoning = processed.reasoning;
                const hasDisplayContent = Array.isArray(displayContent)
                  ? displayContent.length > 0
                  : Boolean(String(displayContent || "").trim());

                return (
                  <div
                    key={`${message.role}-${index}`}
                    className={`chat-message-row ${message.role === "user" ? "user" : "ai"}`}
                  >
                    {/* Avatar */}
                    <div className={`chat-avatar ${message.role === "user" ? "user" : "ai"}`}>
                      {message.role === "user" ? "Siz" : "V"}
                    </div>

                    {/* Bubble + stats */}
                    <div className="chat-bubble-wrap">
                      <span className="chat-sender-label">
                        {message.role === "user" ? "Siz" : "Vega"}
                      </span>
                      {message.role === "assistant" && displayReasoning && deepThinkEnabled && (
                        <ChatThinkingSection
                          reasoning={displayReasoning}
                          timeElapsed={message.thinkingDuration}
                          isComplete={!message.generationStats || message.generationStats.status === "complete"}
                        />
                      )}
                      {(hasDisplayContent || message.error) && (
                        <div className={`chat-bubble ${message.error ? "error" : ""}`}>
                          {Array.isArray(displayContent) ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                              {displayContent.map((item, idx) => {
                                if (item.type === "text") return <MarkdownRenderer key={idx} content={item.text} />;
                                if (item.type === "image_url") return (
                                  <img key={idx} src={item.image_url.url} alt="Ekli görsel"
                                    style={{ maxWidth: "240px", maxHeight: "180px", objectFit: "contain", borderRadius: "8px", marginTop: "4px" }}
                                  />
                                );
                                return null;
                              })}
                            </div>
                          ) : (
                            <MarkdownRenderer content={displayContent} />
                          )}
                        </div>
                      )}
                      {message.role === "assistant" && Array.isArray(message.webSources) && message.webSources.length > 0 && (
                        <div style={{
                          marginTop: "8px",
                          padding: "10px 12px",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          background: "var(--md-sys-color-surface-container)",
                          fontSize: "0.8rem",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, marginBottom: "6px" }}>
                            <Globe2 size={13} />
                            <span>Kaynaklar</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                            {message.webSources.map((source, sourceIndex) => (
                              <a
                                key={`${source.url}-${sourceIndex}`}
                                href={guvenliBaglanti(source.url)}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "var(--md-sys-color-primary)", textDecoration: "none", overflowWrap: "anywhere" }}
                              >
                                [{source.index || sourceIndex + 1}] {source.title || source.url}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {message.role === "assistant" && message.gorselIs && (
                        <div className={`vega-gorsel-kart durum-${message.gorselIs.durum}`}>
                          {message.gorselIs.durum === "model-sec" ? (
                            <GorselModelSecici
                              modeller={gorselModelleri}
                              secim={gorselModelSecimi}
                              setSecim={(m) => { setGorselModelSecimi(m); try { localStorage.setItem("vegaGorselModeli", m); } catch (_) {} }}
                              yukle={() => gorselModelleriniListele().then(setGorselModelleri).catch(() => setGorselModelleri([]))}
                              mesgul={isBusy || gorselUretiliyorRef.current}
                              onSec={(m) => modelSecildi(message.gorselIs.convId || activeConversationId, index, m)}
                              onVazgec={() => {
                                setMessages((prev) => {
                                  const updated = [...prev];
                                  const m = updated[index];
                                  if (!m?.gorselIs) return prev;
                                  updated[index] = { ...m, gorselIs: { ...m.gorselIs, durum: "iptal" } };
                                  saveConversationState(message.gorselIs.convId || activeConversationId, updated, selectedModel);
                                  return updated;
                                });
                              }}
                            />
                          ) : message.gorselIs.durum === "tarif-bekle" ? (
                            <div className="vega-tarif-bekle">
                              <div><strong>{modelKisaAd(message.gorselIs.model)}</strong> seçildi.</div>
                              <div>Üretilecek görseli tarif edin lütfen; yazabilir ya da söyleyebilirsiniz.</div>
                              {bekleyenGorsel?.index === index && (
                                <button type="button" className="vega-model-vazgec" onClick={() => {
                                  bekleyenGorselRef.current = null;
                                  setBekleyenGorsel(null);
                                  gorselKartiniGuncelle(message.gorselIs.convId || activeConversationId, index, { durum: "iptal" });
                                }}>Vazgeç</button>
                              )}
                            </div>
                          ) : message.gorselIs.durum === "secildi" ? (
                            <div className="vega-tarif-bekle"><strong>{modelKisaAd(message.gorselIs.model)}</strong> seçildi, tarif alındı.</div>
                          ) : message.gorselIs.durum === "iptal" ? (
                            <div className="vega-gorsel-hata vega-gorsel-iptal">Görsel üretilmedi (vazgeçildi).</div>
                          ) : message.gorselIs.durum === "bitti" && message.gorselIs.gorsel ? (
                            <div className="vega-gorsel-cerceve">
                              <button type="button" className="vega-gorsel-resim" onClick={() => setBuyutulmusGorsel(message.gorselIs)} title="Büyütmek için tıklayın">
                                <img src={message.gorselIs.gorsel} alt={message.gorselIs.istem} loading="lazy" />
                              </button>
                              <button type="button" className="vega-gorsel-indir" title="Bilgisayara kaydet" aria-label="Görseli kaydet"
                                onClick={() => gorseliKaydet(message.gorselIs.gorsel, message.gorselIs.dosya || `vega-${message.gorselIs.id || "gorsel"}`)}>
                                <Download size={16} />
                              </button>
                            </div>
                          ) : message.gorselIs.durum === "hata" ? (
                            <div className="vega-gorsel-hata">Görsel üretilemedi: {message.gorselIs.hata}</div>
                          ) : (
                            <div className="vega-gorsel-bekliyor">
                              <LoaderCircle size={16} className="progress-spinner" />
                              <span>
                                {message.gorselIs.asama || "Görsel hazırlanıyor"}
                                {message.gorselIs.toplam > 0 ? ` · adım ${message.gorselIs.adim}/${message.gorselIs.toplam}` : ""}
                                {message.gorselIs.gecenSn ? ` · ${Math.floor(message.gorselIs.gecenSn / 60)}:${String(message.gorselIs.gecenSn % 60).padStart(2, "0")}` : ""}
                              </span>
                              {message.gorselIs.id ? (
                                <button className="m3-btn m3-btn-outlined" style={{ marginLeft: "auto", height: 28, padding: "0 10px", fontSize: "0.78rem" }}
                                  title="Görsel üretimini durdur (yeniden denenmez)"
                                  onClick={() => fetch("/api/is-kuyrugu/durdur", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: message.gorselIs.id }) }).catch(() => {})}>
                                  <Square size={12} /> Durdur
                                </button>
                              ) : null}
                            </div>
                          )}
                          {message.gorselIs.istem ? (
                            <div className="vega-gorsel-istem" title="Görsel modeline gönderilen istem">
                              {message.gorselIs.model ? `${modelKisaAd(message.gorselIs.model)} · ` : ""}{message.gorselIs.istem}
                            </div>
                          ) : null}
                          {/* Görselden sonra sohbet modeli otomatik geri yüklenir (sunucu: vegaGorselUret) */}
                          {message.gorselIs.sohbetYukleniyor && gorselUretiliyorRef.current ? (
                            <div className="vega-gorsel-bekliyor">
                              <LoaderCircle size={14} className="progress-spinner" />
                              <span>Sohbet modeli yeniden yükleniyor…</span>
                            </div>
                          ) : null}
                          {message.gorselIs.llmHata ? (
                            <div className="vega-gorsel-hata">Sohbet modeli geri yüklenemedi: {message.gorselIs.llmHata}. Yukarıdaki model seçiciden yeniden yükleyebilirsiniz.</div>
                          ) : null}
                        </div>
                      )}
                      {/* Vega'nın başlattığı müzik / ses efekti / video işleri */}
                      {message.role === "assistant" && Array.isArray(message.studyoIsleri) && message.studyoIsleri.map((studyoIs) => (
                        <StudyoSohbetKarti
                          key={studyoIs.id}
                          is={studyoIs}
                          onGuncelle={(yama, kaydet) => studyoKartiniGuncelle(activeConversationId, index, studyoIs.id, yama, kaydet)}
                          onSeslendir={kisaSeslendir}
                        />
                      ))}
                      {/* Müzik / ses efekti / video isteği: model seçimi -> ilerleme -> sonuç (yanıt bitince) */}
                      {message.role === "assistant" && Array.isArray(message.medyaIsleri) && !(isBusy && index === messages.length - 1) &&
                        message.medyaIsleri.map((medyaIs) => (
                        <SohbetMedyaKarti
                          key={medyaIs.anahtar}
                          is={medyaIs}
                          sohbetMesgul={isBusy}
                          onGuncelle={(yama, kaydet) => medyaKartiniGuncelle(activeConversationId, index, medyaIs.anahtar, yama, kaydet)}
                          onSeslendir={kisaSeslendir}
                        />
                      ))}
                      {message.role === "assistant" && !message.error && hasDisplayContent &&
                        !(isBusy && index === messages.length - 1) && (() => {
                        const okunacak = Array.isArray(displayContent)
                          ? displayContent.filter((p) => p.type === "text").map((p) => p.text).join("\n")
                          : String(displayContent || "");
                        if (!okunacak.trim()) return null;
                        const buOkunuyor = okunanIndex === index && konusuyor;
                        return (
                          <button
                            type="button"
                            className={`chat-mesaj-oku ${buOkunuyor ? "okunuyor" : ""}`}
                            onClick={() => mesajiOku(index, okunacak)}
                            title={buOkunuyor ? "Okumayı durdur" : "Bu yanıtı sesli oku"}
                            aria-label={buOkunuyor ? "Okumayı durdur" : "Bu yanıtı sesli oku"}
                          >
                            {buOkunuyor ? <Square size={11} fill="currentColor" /> : <Volume2 size={14} />}
                          </button>
                        );
                      })()}
                      {/* Generation stats pill */}
                      {message.role === "assistant" && message.generationStats && !message.error && (
                        <>
                          {message.generationStats.truncated && (
                            <div className="chat-generation-warning">
                              Yanıt jeton sınırına ulaştı. "devam et" yazın ya da daha yüksek bir sınır için Azami Yanıt Jetonu ayarını Manuel yapın.
                            </div>
                          )}
                          <div className={`chat-generation-stats ${message.generationStats.status}`}>
                          {message.generationStats.status === "starting" ? (
                            <><LoaderCircle size={11} className="progress-spinner" /> {message.generationStats.aracDurumu ? message.generationStats.aracDurumu : message.generationStats.web ? "Düşünüyor (gerekirse web'de arar)..." : message.generationStats.vision ? "Görsel işleniyor..." : "İlk jeton bekleniyor..."}</>
                          ) : message.generationStats.status === "streaming" ? (
                            <><span style={{ opacity: 0.7 }}></span> {message.generationStats.tokensPerSecond.toFixed(1)} tok/s</>
                          ) : (
                            <>{message.generationStats.tokens} tokens <span style={{ opacity: 0.5 }}></span> {formatGenerationTime(message.generationStats.seconds)}</>
                          )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* --- Composer ----------------------------------------- */}
        <div className="chat-composer">
          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingBottom: "10px" }}>
              {attachments.map((att) => (
                <div key={att.id} style={{
                  position: "relative", display: "flex", alignItems: "center", gap: "6px",
                  padding: "6px 28px 6px 8px",
                  background: "var(--md-sys-color-surface-variant)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px", fontSize: "0.8rem", maxWidth: "200px"
                }}>
                  {att.type === "image" ? (
                    <img src={att.dataUrl} alt={att.name} style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "3px" }} />
                  ) : (
                    <span style={{ fontWeight: 600 }}></span>
                  )}
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--md-sys-color-on-surface-variant)" }} title={att.name}>
                    {att.name}
                  </span>
                  <button
                    onClick={() => setAttachments(prev => prev.filter(item => item.id !== att.id))}
                    style={{
                      position: "absolute", right: "4px", top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", color: "var(--md-sys-color-error)",
                      cursor: "pointer", padding: "2px", display: "flex", alignItems: "center", justifyContent: "center"
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Tam ekran görsel: üst kapsayıcıların blur/transform etkisinden kurtulmak için body'ye taşınır */}
          {buyutulmusGorsel && createPortal(
            <div className="vega-gorsel-buyuk" role="dialog" aria-label="Görsel" onClick={() => setBuyutulmusGorsel(null)}>
              <button type="button" className="vega-gorsel-buyuk-indir" title="Bilgisayara kaydet"
                onClick={(e) => { e.stopPropagation(); gorseliKaydet(buyutulmusGorsel.gorsel, buyutulmusGorsel.dosya || `vega-${buyutulmusGorsel.id || "gorsel"}`); }}>
                <Download size={18} /> <span>Kaydet</span>
              </button>
              <img src={buyutulmusGorsel.gorsel} alt={buyutulmusGorsel.istem} />
              <div className="vega-gorsel-buyuk-alt">{buyutulmusGorsel.istem} · kapatmak için tıklayın ya da Esc</div>
            </div>,
            document.body
          )}

          <BulutModelEkle
            acik={bulutModalAcik}
            kapat={() => setBulutModalAcik(false)}
            eklendi={async (kimlik) => {
              setBulutModalAcik(false);
              await refresh().catch(() => {});
              handleModelChange(kimlik); // kullanıcının kendi seçimi: eklenen model hemen kullanılır
            }}
          />

          {/* Ses örneği toplamayı açmak için onay (yalnızca kullanıcının kendi sesi) */}
          <KlonOnayPenceresi
            acik={klonOnayAcik}
            sadeceKendim
            baslik="Sesimi klonlama için kaydet"
            aciklama="Açarsanız sesli sohbette söyledikleriniz, kendi sesinizden klon oluşturabilmeniz için yalnızca bu bilgisayarda saklanır. İstediğiniz zaman kapatıp toplananları silebilirsiniz."
            dugmeYazisi="Onaylıyorum, kaydetmeye başla"
            mesgul={klonMesgul}
            onVazgec={() => setKlonOnayAcik(false)}
            onOnay={async (onay) => { if (await klonAyariKaydet({ ornekTopla: true, onay })) setKlonOnayAcik(false); }}
          />
          <KlonEklePenceresi
            acik={klonOrnekPenceresi}
            kip="ornekler"
            kapat={() => setKlonOrnekPenceresi(false)}
            eklendi={(sonuc) => {
              if (sonuc?.klonlar) klonVerisiniUygula(sonuc); else klonDurumunuYenile();
              if (sonuc?.dosya) setVegaKlonDosyasiSecimi(sonuc.dosya);
            }}
          />

          {/* Sesli sohbet paneli */}
          {sesliMod && (
            <div className={`sesli-panel durum-${sesDurumu}`} role="status" aria-live="polite">
              <div className="sesli-panel-ust">
                <span className="sesli-nokta" />
                <span className="sesli-durum-yazi">
                  {{
                    kalibre: "Ortam sesi ölçülüyor, bir saniye sessiz kalın…",
                    dinliyor: ellerSerbest
                      ? "Dinliyorum (eller serbest). Konuşmanız bitip birkaç saniye susunca otomatik gönderilir."
                      : "Dinliyorum. Söyledikleriniz yazı kutusuna eklenir; düzeltip Enter ile gönderin.",
                    kayit: "Konuşmanız kaydediliyor…",
                    cevriliyor: "Söyledikleriniz yazıya çevriliyor…",
                    dusunuyor: "Model yanıt yazıyor… (mikrofon duraklatıldı)",
                    konusuyor: klonUretiyor
                      ? `Cümle Vega'nın klon sesiyle hazırlanıyor…${klonHazirlik?.ortalamaCumleSn ? ` (bu bilgisayarda cümle başına ~${klonSureYaz(klonHazirlik.ortalamaCumleSn)})` : " İşlemcide bir cümle bir dakikayı bulabilir."} (mikrofon duraklatıldı)`
                      : "Yanıt okunuyor… (mikrofon duraklatıldı)",
                    gorsel: "Görsel üretiliyor, Vega birkaç dakika bellekten çıkarıldı… (mikrofon duraklatıldı)",
                    duraklatildi: "Dinleme duraklatıldı",
                  }[sesDurumu] || "Hazırlanıyor…"}
                </span>
                <select
                  className="sesli-dil"
                  value={sesDili}
                  onChange={(e) => {
                    const v = e.target.value;
                    sesDiliRef.current = v;
                    setSesDili(v);
                    try { localStorage.setItem("sesliSohbetDili", v); } catch (_) {}
                  }}
                  title="Konuştuğunuz dil. Otomatik algılama kısa cümlelerde Türkçeyi başka dil sanabilir."
                  aria-label="Konuşma dili"
                >
                  <option value="tr">Türkçe</option>
                  <option value="en">İngilizce</option>
                  <option value="auto">Otomatik</option>
                </select>
                <div className="sesli-seviye" title="Mikrofon düzeyi (çizgi: konuşma eşiği)">
                  <div className="sesli-seviye-dolgu" style={{ width: `${Math.min(100, (seviye.rms / Math.max(0.0001, seviye.esik)) * 50)}%` }} />
                  <div className="sesli-seviye-esik" />
                </div>
                <button
                  type="button"
                  className={`chat-composer-deepthink-btn ${sesliYanit ? "active" : ""}`}
                  onClick={sesliYanitDegistir}
                  title={sesliYanit ? "Yanıtlar sesli okunuyor; kapatmak için tıklayın" : "Yanıtlar okunmuyor; açmak için tıklayın"}
                >
                  {sesliYanit ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  <span>{sesliYanit ? "Sesli yanıt" : "Sessiz"}</span>
                </button>
                {konusuyor && (
                  <button type="button" className="chat-composer-deepthink-btn" onClick={() => seslendiriciRef.current?.sustur()} title="Okumayı durdur">
                    <Square size={12} fill="currentColor" />
                    <span>Sustur</span>
                  </button>
                )}
              </div>
              {ceviriBekleyen > 0 && (
                <div className="sesli-dokum">Yazıya çevriliyor{ceviriBekleyen > 1 ? ` (${ceviriBekleyen} parça)` : ""}… Konuşmaya devam edebilirsiniz.</div>
              )}
              {sonDokum && <div className="sesli-dokum">Son duyulan: “{sonDokum}”</div>}
              {ornekToplaYerel && klonVeri && (
                <div className="sesli-dokum" title="Kapatmak için Ses ayarları düğmesine tıklayın">
                  ● Sesiniz klon örneği olarak kaydediliyor (yalnızca bu bilgisayarda; son {klonVeri.ornekler?.azamiAdet || 40} parça).
                </div>
              )}
              {vegaKlonYerel && klonHazirlik?.durum === "yukleniyor" && (
                <div className="sesli-dokum">
                  Klon ses hazırlanıyor ({klonSureYaz(klonHazirlik.gecenSn)}{klonHazirlik.olcum?.yuklemeSn ? `; geçen sefer ${klonSureYaz(klonHazirlik.olcum.yuklemeSn)} sürdü` : "; ilk açılış birkaç dakika sürebilir"}). Hazır olana kadar Vega normal sesle konuşuyor.
                </div>
              )}
              {vegaKlonYerel && klonHazirlik?.durum === "hazir" && (
                <div className="sesli-dokum">Klon ses hazır: Vega'nın Türkçe yanıtları sizin klon sesinizle okunuyor.</div>
              )}
              {vegaKlonYerel && klonHazirlik?.durum === "mesgul" && (
                <div className="sesli-dokum">Klon ses önceki cümleyi bitiriyor; bu arada normal sesle okunuyor.</div>
              )}
              {vegaKlonYerel && klonHazirlik?.durum === "hata" && klonHazirlik.hata && (
                <div className="sesli-hata">{klonHazirlik.hata} Vega normal sesle konuşuyor.</div>
              )}
              {klonUyari && <div className="sesli-hata">{klonUyari}</div>}
              {sesHata && <div className="sesli-hata">{sesHata}</div>}
            </div>
          )}

          {/* Sohbet modeli ağır bir iş (video / görsel) için bellekten çıkarıldıysa: neden ve ne zaman geri geleceği */}
          {sohbetModeliNotu && (
            <div role="status" aria-live="polite" style={{
              display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 8px", padding: "8px 12px",
              borderRadius: 12, fontSize: "0.8rem", lineHeight: 1.4,
              border: `1px solid ${sohbetModeliNotu.hata ? "color-mix(in srgb, #d33 45%, var(--border-color))" : "color-mix(in srgb, var(--md-sys-color-primary) 40%, var(--border-color))"}`,
              background: sohbetModeliNotu.hata ? "color-mix(in srgb, #d33 10%, transparent)" : "color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent)",
              color: "var(--md-sys-color-on-surface)",
            }}>
              {sohbetModeliNotu.donuyor && <LoaderCircle size={14} className="progress-spinner" style={{ flexShrink: 0 }} />}
              <span style={{ flex: "1 1 240px" }}>{sohbetModeliNotu.metin}</span>
              {sohbetModeliNotu.simdiYukle && (
                <button type="button" className="m3-btn m3-btn-tonal" onClick={sohbetModeliniGeriYukleTiklandi}
                  style={{ height: 30, padding: "0 12px", fontSize: "0.78rem", borderRadius: "var(--md-shape-corner-medium)" }}>
                  Şimdi geri yükle
                </button>
              )}
            </div>
          )}

          {/* Input container with vertical layout */}
          <div className="chat-composer-inner">
            <div className="chat-composer-textarea-container">
              <textarea
                ref={textareaRef}
                className="chat-composer-textarea"
                value={input}
                onChange={(event) => { clearTimeout(otoGonderZamanlayiciRef.current); setInput(event.target.value); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={bekleyenGorsel ? "Görseli tarif edin… (ör. uzaydan bakılan sarmal bir galaksi, mor ve mavi tonlarda)" : sohbetModeliNotu ? sohbetModeliNotu.kisa : status.ready ? (status.settings?.bulut ? `${status.settings.etiket || "Bulut modeli"}: mesajlarınız sağlayıcıya gönderilir (Yeni satır için Shift+Enter)` : "Yerel modelinize mesaj yazın... (Yeni satır için Shift+Enter)") : "Başlamak için yukarıdan bir GGUF modeli seçip yükleyin"}
                disabled={!status.ready || isBusy}
                rows={1}
              />
            </div>

            <div className="chat-composer-toolbar">
              <div className="chat-composer-toolbar-left">
                <input type="file" ref={fileInputRef} style={{ display: "none" }} multiple onChange={handleFileChange} />
                <button
                  className="chat-composer-attach-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!supportsVision || isBusy}
                  title={supportsVision ? "Dosya veya görsel ekle" : visionStatus}
                >
                  <Paperclip size={17} />
                </button>
                <button
                  className={`chat-composer-deepthink-btn web-search-btn ${useWebSearch ? "active" : ""}`}
                  onClick={() => setUseWebSearch((value) => !value)}
                  disabled={!status.ready || isBusy}
                  title={useWebSearch ? "Web aramasını kapat" : "Web aramasını aç"}
                >
                  <Globe2 size={14} />
                  <span>Web</span>
                </button>
                <button
                  className={`chat-composer-deepthink-btn sesli-dugme ${sesliMod ? "active" : ""}`}
                  onClick={() => (sesliMod ? sesliModunuKapat() : sesliModunuAc())}
                  disabled={!status.ready}
                  title={!status.ready ? "Önce bir metin modeli yükleyin" : sesliMod ? "Sesli sohbeti kapat" : "Sesli sohbeti aç: konuşmanız yazıya çevrilir, yanıt sesli okunur"}
                >
                  {sesliMod ? <MicOff size={14} /> : <Mic size={14} />}
                  <span>{sesliMod ? "Sesliyi kapat" : "Sesli"}</span>
                </button>
                {klonVeri && (
                  <div ref={klonAyarKutusuRef} style={{ position: "relative", display: "inline-flex" }}>
                    <button
                      type="button"
                      className={`chat-composer-deepthink-btn ${klonAyarAcik || ornekToplaYerel || vegaKlonYerel ? "active" : ""}`}
                      onClick={() => { setKlonAyarAcik((v) => !v); if (!klonAyarAcik) klonDurumunuYenile(); }}
                      aria-expanded={klonAyarAcik}
                      aria-haspopup="dialog"
                      title="Ses ayarları: ses örneği toplama ve Vega'nın klon sesi"
                    >
                      <SlidersHorizontal size={14} />
                      <span>Ses ayarları</span>
                    </button>
                    {klonAyarAcik && (
                      <div
                        className="m3-card"
                        role="dialog"
                        aria-label="Ses ayarları"
                        style={{
                          position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 60,
                          width: "min(380px, calc(100vw - 32px))", maxHeight: "70vh", overflowY: "auto",
                          padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
                          boxShadow: "0 8px 28px rgba(0,0,0,0.25)", textAlign: "left", margin: 0,
                          // Yarı saydam tema yüzeyi yerine model menüsüyle aynı (arkası okunmayan) zemin
                          background: "color-mix(in srgb, var(--md-sys-color-surface) 40%, var(--md-sys-color-background))",
                          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Ses ayarları</div>

                        <div className="m3-switch-row" style={{ gap: 12, alignItems: "flex-start" }}>
                          <div className="m3-switch-info">
                            <span className="m3-switch-title">Sesimi klonlama için kaydet</span>
                            <span className="m3-switch-description">
                              Sesli sohbette söyledikleriniz ve metinleri, klon oluşturmak için yalnızca bu bilgisayarda saklanır
                              (son {klonVeri.ornekler?.azamiAdet || 40} parça / {klonVeri.ornekler?.azamiMb || 50} MB). Varsayılan kapalı.
                            </span>
                          </div>
                          <label className="m3-switch" style={{ flexShrink: 0 }}>
                            <input type="checkbox" checked={ornekToplaYerel} disabled={klonMesgul} onChange={ornekToplamaDegistir} aria-label="Sesimi klonlama için kaydet" />
                            <span className="m3-switch-slider" />
                          </label>
                        </div>

                        {(klonVeri.ornekler?.adet > 0 || ornekToplaYerel) && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.8rem" }}>
                            <span style={{ opacity: 0.85 }}>
                              Toplanan: {klonVeri.ornekler?.adet || 0} parça, ~{klonVeri.ornekler?.uygunSn || 0} sn kullanılabilir (klon için 8-12 sn önerilir)
                            </span>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button type="button" className="m3-btn m3-btn-tonal" style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }}
                                disabled={klonMesgul || !klonVeri.ornekler?.adet} onClick={() => setKlonOrnekPenceresi(true)}>
                                Örneklerimden klon oluştur
                              </button>
                              <button type="button" className="m3-btn m3-btn-outlined" style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }}
                                disabled={klonMesgul || !klonVeri.ornekler?.adet} onClick={ornekleriSilTiklandi}>
                                Toplanan örnekleri sil
                              </button>
                            </div>
                          </div>
                        )}

                        <div style={{ borderTop: "1px solid var(--border-color)" }} />

                        <div className="m3-switch-row" style={{ gap: 12, alignItems: "flex-start" }}>
                          <div className="m3-switch-info">
                            <span className="m3-switch-title">Vega benim sesimle yanıt versin</span>
                            <span className="m3-switch-description">
                              {klonMesgul
                                ? "Kaydediliyor… (açarken OmniVoice kurulumu denetlenir; birkaç saniye sürebilir)"
                                : klonVeri.omnivoiceKurulu === false
                                ? "Kullanılamıyor: OmniVoice kurulu değil. Metinden Sese > OmniVoice bölümünden kurun."
                                : !klonVeri.klonlar?.length
                                  ? "Kullanılamıyor: önce bir klon ses oluşturun (yukarıdaki \"Örneklerimden klon oluştur\" ya da Metinden Sese > OmniVoice > Klon sesi ekle)."
                                  : klonVeri.omnivoiceKurulu === null
                                    ? "OmniVoice kurulumu denetleniyor… Anahtarı açabilirsiniz; sunucu açarken yeniden denetler."
                                    : "Vega'nın Türkçe sesli yanıtları seçtiğiniz klon sesle okunur. Klon hazır değilken ya da bir cümle gecikirse o cümle normal sesle okunur."}
                            </span>
                          </div>
                          <label className="m3-switch" style={{ flexShrink: 0 }}>
                            <input
                              type="checkbox"
                              checked={vegaKlonYerel}
                              disabled={klonMesgul || (!vegaKlonYerel && (klonVeri.omnivoiceKurulu === false || !klonVeri.klonlar?.length))}
                              onChange={() => klonAyariKaydet(vegaKlonYerel
                                ? { vegaKlonSesi: false }
                                : { vegaKlonSesi: true, vegaKlonDosyasi: vegaKlonDosyasiSecimi, zamanAsimiSn: klonZamanAsimi })}
                              aria-label="Vega benim sesimle yanıt versin"
                            />
                            <span className="m3-switch-slider" />
                          </label>
                        </div>

                        {vegaKlonYerel && (() => {
                          const h = klonHazirlik || {};
                          const renk = h.durum === "hazir" ? "34, 197, 94" : h.durum === "hata" ? "239, 68, 68" : "59, 130, 246";
                          const yazi = {
                            yukleniyor: `Klon ses hazırlanıyor (ilk açılış birkaç dakika sürebilir) · ${klonSureYaz(h.gecenSn)}${h.olcum?.yuklemeSn ? ` · geçen sefer ${klonSureYaz(h.olcum.yuklemeSn)}` : ""}. Bu sırada Vega normal sesle konuşur.`,
                            hazir: `Hazır${h.sonCumleSn ? ` · son cümle ${klonSureYaz(h.sonCumleSn)}` : h.olcum?.cumleSn ? ` · geçen sefer cümle başına ~${klonSureYaz(h.olcum.cumleSn)}` : ""}`,
                            mesgul: `Hazır · önceki cümle hâlâ işleniyor (${klonSureYaz(h.cumleSuruyorSn)}); bu arada normal ses`,
                            hata: h.hata || "Klon ses hazırlanamadı.",
                            kapali: h.not || "Beklemede: sesli sohbet açılınca hazırlanır.",
                          }[h.durum] || "Durum okunuyor…";
                          return (
                            <div role="status" style={{ fontSize: "0.78rem", lineHeight: 1.45, padding: "7px 10px", borderRadius: "var(--md-shape-corner-small, 8px)", border: `1px solid rgba(${renk}, 0.45)`, background: `rgba(${renk}, 0.1)`, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                              <span>{h.durum === "yukleniyor" && <LoaderCircle size={12} className="progress-spinner" style={{ verticalAlign: "-2px", marginRight: 4 }} />}{yazi}</span>
                              {(h.durum === "hata" || h.durum === "kapali") && (
                                <button type="button" className="m3-btn m3-btn-outlined" style={{ height: 26, padding: "0 8px", fontSize: "0.74rem", flexShrink: 0 }}
                                  onClick={() => klonDurumYokla({ isit: true })}>
                                  {h.durum === "hata" ? "Yeniden dene" : "Şimdi hazırla"}
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {klonVeri.klonlar?.length > 0 && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: "0.8rem" }}>
                            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              Klon ses
                              <select className="m3-input" style={{ height: 32, padding: "0 8px" }} value={vegaKlonDosyasiSecimi} disabled={klonMesgul}
                                onChange={(e) => { const d = e.target.value; setVegaKlonDosyasiSecimi(d); klonAyariKaydet({ vegaKlonDosyasi: d }); }}>
                                {klonVeri.klonlar.map((k) => <option key={k.dosya} value={k.dosya}>{k.ad}</option>)}
                              </select>
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: 4 }} title="Sınırsız: cümle klon sesle bitene kadar beklenir (yavaş bilgisayarda dakikalar sürebilir). Süre seçilirse o sürede bitmeyen cümle normal sesle okunur. Modelin ilk yüklenmesi bu süreye dahil değildir.">
                              Cümle başına en fazla
                              <select className="m3-input" style={{ height: 32, padding: "0 8px" }} value={klonZamanAsimi} disabled={klonMesgul}
                                onChange={(e) => { const v = Number(e.target.value); setKlonZamanAsimi(v); klonAyariKaydet({ zamanAsimiSn: v }); }}>
                                {[...new Set([0, 45, 60, 90, 120, 180, 300, klonZamanAsimi])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v === 0 ? "Sınırsız (bekle)" : v < 120 ? `${v} sn` : `${v / 60} dk`}</option>)}
                              </select>
                            </label>
                          </div>
                        )}

                        <div style={{ fontSize: "0.76rem", lineHeight: 1.45, padding: "8px 10px", borderRadius: "var(--md-shape-corner-small, 8px)", border: "1px solid rgba(245, 158, 11, 0.45)", background: "rgba(245, 158, 11, 0.1)" }}>
                          {klonHazirlik?.cihaz === "cuda"
                            ? "Klon ses ekran kartında çalışıyor. "
                            : "Bu bilgisayarda klon ses işlemcide çalışır (ekran kartı kullanılmıyor). "}
                          Klon ses modeli (~4 GB) ilk açılışta belleğe yüklenir; işlemcide bu birkaç dakika sürer ve sesli sohbet
                          açık kaldıkça bellekte tutulur. Sonra her cümle
                          {klonHazirlik?.olcum?.cumleSn ? ` bu bilgisayarda yaklaşık ${klonSureYaz(klonHazirlik.olcum.cumleSn)} ` : " işlemciye göre yarım dakikadan birkaç dakikaya kadar "}
                          sürer, bu sırada bilgisayar yavaşlar ve cümleler arasında beklemeler olur. Klon hazır değilken ya da bir cümle süre sınırını
                          aşarsa o cümle hemen normal sesle okunur; sesli sohbet hiç susmaz. Kısa (8-12 sn) bir referans kaydı klonu hızlandırır.
                        </div>
                        {klonHata && <div className="sesli-hata" role="alert">{klonHata}</div>}
                      </div>
                    )}
                  </div>
                )}
                {sesliMod && (
                  <button
                    type="button"
                    className={`chat-composer-deepthink-btn eller-serbest-dugme ${ellerSerbest ? "active" : ""}`}
                    onClick={ellerSerbestDegistir}
                    aria-pressed={ellerSerbest}
                    title={ellerSerbest
                      ? "Eller serbest açık: susunca otomatik gönderilir. Kapatınca metin yazı kutusuna eklenir, Enter ile gönderirsiniz."
                      : "Eller serbest: Enter'a basmadan, konuşmanız bitince otomatik gönderilsin"}
                  >
                    <Hand size={14} />
                    <span>Eller serbest</span>
                  </button>
                )}

                {status.ready && supportsThinking && (
                  <button
                    className={`chat-composer-deepthink-btn deepthink-btn ${deepThinkEnabled ? "active" : ""}`}
                    onClick={handleThinkingToggle}
                    title={deepThinkEnabled ? "DeepThink akıl yürütmesini kapat" : "DeepThink akıl yürütmesini aç"}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={deepThinkEnabled ? "rotate-anim" : ""}>
                      <circle cx="12" cy="12" r="3" />
                      <ellipse cx="12" cy="12" rx="3" ry="9" />
                      <ellipse cx="12" cy="12" rx="9" ry="3" />
                    </svg>
                    <span>DeepThink</span>
                  </button>
                )}
              </div>

              <div className="chat-composer-toolbar-right">
                {isBusy && status.ready ? (
                  <button className="chat-composer-stop-btn" onClick={handleStopGeneration} title="Üretimi durdur">
                    <Square size={15} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="chat-composer-send-btn"
                    onClick={sendMessage}
                    disabled={(!input.trim() && attachments.length === 0) || !status.ready}
                    title="Mesaj gönder"
                  >
                    <Send size={17} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="chat-composer-hint">Göndermek için Enter  *  Yeni satır için Shift+Enter</div>
        </div>
      </section>
    </div>
  );
}
function parseInlineMarkdown(text) {
  const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*|\[.*?\]\(.*?\))/g;
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={idx} style={{ 
        fontFamily: "monospace", 
        background: "var(--md-sys-color-surface-variant)", 
        padding: "2px 4px", 
        borderRadius: "4px",
        fontSize: "0.85rem"
      }}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={idx} style={{ fontStyle: "italic" }}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("[") && part.includes("](") && part.endsWith(")")) {
      const match = part.match(/\[(.*?)\]\((.*?)\)/);
      if (match) {
        return (
          <a key={idx} href={guvenliBaglanti(match[2])} target="_blank" rel="noopener noreferrer" style={{ color: "var(--md-sys-color-primary)", textDecoration: "underline" }}>
            {match[1]}
          </a>
        );
      }
    }
    return part;
  });
}

export function MarkdownRenderer({ content }) {
  if (typeof content !== 'string') return null;

  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="markdown-body" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {parts.map((part, index) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const match = part.match(/```(\w*)\n([\s\S]*?)```/);
          const lang = match ? match[1] : "";
          const code = match ? match[2] : part.slice(3, -3);
          return (
            <pre key={index} style={{ 
              background: "var(--md-sys-color-surface-variant)", 
              color: "var(--md-sys-color-on-surface-variant)",
              padding: "12px", 
              borderRadius: "6px", 
              fontFamily: "monospace", 
              fontSize: "0.85rem",
              overflowX: "auto",
              margin: "6px 0",
              border: "1px solid var(--border-color)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all"
            }}>
              {lang && <div style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)", marginBottom: "4px", textTransform: "uppercase", fontWeight: 600 }}>{lang}</div>}
              <code>{code.trim()}</code>
            </pre>
          );
        } else {
          const rawLines = part.split(/\r?\n/);
          const blocks = [];
          let currentBlock = null;

          for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith("### ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h4", content: trimmed.slice(4) });
            } else if (trimmed.startsWith("## ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h3", content: trimmed.slice(3) });
            } else if (trimmed.startsWith("# ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h2", content: trimmed.slice(2) });
            } else if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
              const itemContent = trimmed.slice(2);
              if (currentBlock && currentBlock.type === "ul") {
                currentBlock.items.push(itemContent);
              } else {
                if (currentBlock) { blocks.push(currentBlock); }
                currentBlock = { type: "ul", items: [itemContent] };
              }
            } else {
              const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
              if (numMatch) {
                const itemContent = numMatch[2];
                if (currentBlock && currentBlock.type === "ol") {
                  currentBlock.items.push(itemContent);
                } else {
                  if (currentBlock) { blocks.push(currentBlock); }
                  currentBlock = { type: "ol", items: [itemContent] };
                }
              } else if (trimmed === "") {
                if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
                blocks.push({ type: "spacer" });
              } else {
                if (currentBlock && currentBlock.type === "p") {
                  currentBlock.lines.push(line);
                } else {
                  if (currentBlock) { blocks.push(currentBlock); }
                  currentBlock = { type: "p", lines: [line] };
                }
              }
            }
          }
          if (currentBlock) {
            blocks.push(currentBlock);
          }

          return blocks.map((block, blockIdx) => {
            switch (block.type) {
              case "h4":
                return <h4 key={blockIdx} style={{ fontSize: "1.05rem", fontWeight: 700, margin: "10px 0 4px 0", color: "var(--md-sys-color-primary)" }}>{parseInlineMarkdown(block.content)}</h4>;
              case "h3":
                return <h3 key={blockIdx} style={{ fontSize: "1.2rem", fontWeight: 700, margin: "14px 0 6px 0", color: "var(--md-sys-color-primary)" }}>{parseInlineMarkdown(block.content)}</h3>;
              case "h2":
                return <h2 key={blockIdx} style={{ fontSize: "1.35rem", fontWeight: 700, margin: "18px 0 8px 0", color: "var(--md-sys-color-primary)" }}>{parseInlineMarkdown(block.content)}</h2>;
              case "ul":
                return (
                  <ul key={blockIdx} style={{ margin: "6px 0 6px 24px", padding: 0, listStyleType: "disc", display: "block" }}>
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx} style={{ fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "4px", display: "list-item" }}>{parseInlineMarkdown(item)}</li>
                    ))}
                  </ul>
                );
              case "ol":
                return (
                  <ol key={blockIdx} style={{ margin: "6px 0 6px 24px", padding: 0, listStyleType: "decimal", display: "block" }}>
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx} style={{ fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "4px", display: "list-item" }}>{parseInlineMarkdown(item)}</li>
                    ))}
                  </ol>
                );
              case "spacer":
                return <div key={blockIdx} style={{ height: "6px" }} />;
              case "p":
                return <p key={blockIdx} style={{ margin: "2px 0", fontSize: "0.9rem", lineHeight: 1.5 }}>{parseInlineMarkdown(block.lines.join(" "))}</p>;
              default:
                return null;
            }
          });
        }
      })}
    </div>
  );
}

export default TextChat;

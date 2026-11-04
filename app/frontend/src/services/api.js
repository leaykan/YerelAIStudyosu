// Tauri API helper for desktop mode, falling back to HTTP/Mock in browser
import { invoke } from "@tauri-apps/api/core";

// Helper to check if running inside Tauri desktop container
export const isTauri = () => {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
};

// Cached hardware specs
let cachedSpecs = null;
let cachedBackendPort = null;
export const EXPECTED_SERVER_BUILD = "text-image-v1";

export const isLocalServerMode = () => {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "http:" || window.location.protocol === "https:";
};

async function getBackendPort() {
  if (isLocalServerMode()) {
    try {
      const status = await getBackendStatus();
      const port = Number(status?.port);
      if (Number.isInteger(port) && port > 0) {
        cachedBackendPort = port;
        return port;
      }
    } catch (_) {}
  }
  if (cachedBackendPort) return cachedBackendPort;
  return 8080;
}

async function getBackendBaseUrl() {
  if (!isTauri() && isLocalServerMode()) {
    return "";
  }
  return `http://127.0.0.1:${await getBackendPort()}`;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / (1024 ** idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function normalizeModel(model) {
  if (typeof model === "string") {
    return { filename: model, sizeBytes: 0, size: "Unknown" };
  }
  return {
    filename: model?.filename || model?.name || "",
    name: model?.name || model?.filename || "",
    sizeBytes: Number(model?.sizeBytes || 0),
    size: model?.size || (model?.sizeBytes ? formatBytes(model.sizeBytes) : "Bilinmiyor"),
    format: model?.format || "Yerel ağırlık dosyası",
    backendType: model?.backendType || "",
    resolution: model?.resolution || "",
    isProjector: Boolean(model?.isProjector),
    detected: model?.detected || null,
  };
}

async function readJsonResponse(res, fallbackMessage = "The local server returned an invalid response.") {
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text || "{}");
  } catch (_) {
    const looksLikeHtml = text.trim().startsWith("<!doctype") || text.trim().startsWith("<html");
    throw new Error(looksLikeHtml ? "Yerel sunucu eski bir arayüz/API sürümü sunuyor. Görsel üreticiyi yeniden başlatın." : fallbackMessage);
  }

  if (!res.ok || data.ok === false) {
    if (data.error === "Unknown API endpoint") {
      throw new Error("Yerel sunucunun en güncel API'yi yüklemesi için görsel üreticiyi yeniden başlatın.");
    }
    throw new Error(data.error || `İstek başarısız (HTTP ${res.status})`);
  }
  return data;
}

export async function getHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Durum denetimi isteği başarısız (HTTP ${res.status})`);
    return {
      ...data,
      stale: data.build !== EXPECTED_SERVER_BUILD,
    };
  } catch (err) {
    return {
      ok: false,
      stale: true,
      build: "unknown",
      issues: [err.message || "Yerel sunucuya ulaşılamadı."],
      checks: [],
      ports: {},
    };
  }
}

export async function getDiagnostics() {
  const res = await fetch("/api/diagnostics");
  return await readJsonResponse(res, "Yerel sunucu geçersiz tanılama verisi döndürdü.");
}

export async function getCleanupCandidates() {
  const res = await fetch("/api/cleanup-candidates");
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz temizlik verisi döndürdü.");
  return data.candidates || [];
}

export async function cleanupCandidates(ids) {
  const res = await fetch("/api/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz temizlik verisi döndürdü.");
}

// Get CPU and GPU specifications
export async function getHardwareSpecs() {
  if (cachedSpecs) return cachedSpecs;

  if (isTauri()) {
    try {
      cachedSpecs = await invoke("get_hardware_specs");
      return cachedSpecs;
    } catch (e) {
      console.warn("Failed to get hardware specs via Tauri, using fallback:", e);
    }
  }

  if (isLocalServerMode()) {
    try {
      const res = await fetch("/api/hardware-specs");
      if (res.ok) {
        cachedSpecs = await res.json();
        return cachedSpecs;
      }
    } catch (e) {
      console.warn("Failed to get hardware specs from local server:", e);
    }
  }

  // Static preview fallback. Do not invent host hardware.
  cachedSpecs = {
    os_name: "Unavailable",
    cpu_name: "Unavailable",
    cpu_cores_physical: 4,
    cpu_cores_logical: 4,
    ram_total_gb: 0,
    gpu_name: "Unavailable",
  };
  return cachedSpecs;
}

// Get CPU/RAM/VRAM real-time utilization
export async function getTelemetry() {
  if (isTauri()) {
    try {
      const stats = await invoke("get_telemetry");
      return stats;
    } catch (e) {
      // Ignore and use fallback
    }
  }

  if (isLocalServerMode()) {
    try {
      const res = await fetch("/api/telemetry");
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
  }

  return {
    cpu_usage: 0,
    ram_used_gb: 0,
    ram_total_gb: 0,
    gpu_name: "Unavailable",
    vram_used_gb: 0,
    vram_total_gb: 0,
  };
}

export async function getBackendOptions() {
  if (isLocalServerMode()) {
    try {
      const res = await fetch("/api/backend-options");
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to get backend options from local server:", e);
    }
  }

  return {
    options: [{ id: "cpu", label: "CPU", available: true }],
    cudaAvailable: false,
    vulkanAvailable: false,
    defaultBackendType: "cpu",
  };
}

export async function downloadBackend(backendId) {
  const res = await fetch("/api/download-backend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend_id: backendId }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir motor indirme yanıtı döndürdü.");
}

// Get list of model files on the USB
export async function listLocalModels() {
  if (isTauri()) {
    try {
      return await invoke("list_local_models");
    } catch (e) {
      console.warn("Failed to list local models via Tauri:", e);
    }
  }

  if (isLocalServerMode()) {
    return await listModelsFromDisk();
  }

  // Static preview fallback: show only models the user imported in this browser.
  let saved = localStorage.getItem("imported-models");
  if (saved === null) {
    localStorage.setItem("imported-models", JSON.stringify([]));
    saved = "[]";
  }
  const imported = JSON.parse(saved);
  return imported.map(normalizeModel);
}

// Start (or restart) backend stable-diffusion.cpp server with correct CLI flags
// In web/portable mode this calls serve.cjs management API which restarts the
// sd-vulkan.exe process with --steps, --cfg-scale, --sampling-method flags.
export async function startServer(modelPath, constraints) {
  const backendPort = await getBackendPort();
  if (isTauri()) {
    const launchParams = {
      model_path: modelPath,
      port: backendPort,
      use_gpu: constraints.useGpu !== false,
      backend_type: constraints.backendType || (constraints.useGpu === false ? "cpu" : "auto"),
      threads: constraints.threads || 8,
    };
    return await invoke("start_server", { params: launchParams });
  }

  // Web/portable mode - call serve.cjs management API
  const backendType = constraints.backendType || (constraints.useGpu === false ? "cpu" : "auto");
  const modelName = modelPath ? modelPath.split(/[\\/]/).pop() : null;
  const isOpenVinoBackend = backendType === "openvino-npu";
  const requestModel = isOpenVinoBackend && /\.(safetensors|ckpt|gguf)$/i.test(modelName || "")
    ? null
    : modelName;
  try {
    const res = await fetch("/api/restart-backend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:    requestModel,
        steps:    constraints.steps    || 20,
        cfgScale: constraints.cfgScale || 7.0,
        sampler:  constraints.sampler  || "euler_a",
        threads:  constraints.threads  || 8,
        use_gpu:  constraints.useGpu !== false,
        backend_type: backendType,
        width: constraints.width || 512,
        height: constraints.height || 512,
        vae_tiling: constraints.vaeTiling !== false,
        vae_on_cpu: constraints.vaeOnCpu === true,
        flash_attn: constraints.useFlashAttn !== false,
      }),
    });
    const text = await res.text();
    const data = JSON.parse(text || "{}");
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Motor yeniden başlatılamadı (HTTP ${res.status})`);
    }
    if (Number.isInteger(Number(data.port)) && Number(data.port) > 0) {
      cachedBackendPort = Number(data.port);
    }
    console.log("Backend restart:", data.message);
    return data.message;
  } catch (e) {
    console.warn("Could not reach management API:", e.message);
    if (isLocalServerMode()) {
      throw e;
    }
    return "Motor yönetimi kullanılamıyor";
  }
}

// Stop backend server
export async function stopServer() {
  if (isTauri()) {
    return await invoke("stop_server");
  }
  try {
    await fetch("/api/stop-backend", { method: "POST" });
  } catch (_) {}
  return "Motor durduruldu";
}

// Get current backend status and active settings
export async function getBackendStatus() {
  try {
    const r = await fetch("/api/backend-status");
    return await r.json();
  } catch (_) {
    return { ready: false, settings: {} };
  }
}

export async function getLlmStatus() {
  try {
    const res = await fetch("/api/llm/status");
    return await readJsonResponse(res, "Yerel sunucu geçersiz metin motoru durumu döndürdü.");
  } catch (err) {
    return { ready: false, running: false, backendInstalled: false, error: err.message, settings: {} };
  }
}

export async function getLlmBackends(refresh = false) {
  const res = await fetch(`/api/llm/backends${refresh ? "?refresh=1" : ""}`);
  return await readJsonResponse(res, "Yerel sunucu geçersiz metin motoru verisi döndürdü.");
}

export async function getLlmStats() {
  const res = await fetch("/api/llm/stats");
  return await readJsonResponse(res, "Yerel sunucu geçersiz metin çalışma ortamı istatistikleri döndürdü.");
}

export async function benchmarkLlm(model, options = {}) {
  const res = await fetch("/api/llm/benchmark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      backends: options.backends,
      includeCpu: options.includeCpu,
      prompt: options.prompt,
      contextSize: options.contextSize,
      gpuLayers: options.gpuLayers,
    }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz performans testi verisi döndürdü.");
}

export async function listLlmModels() {
  const res = await fetch("/api/llm/models");
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz metin modeli verisi döndürdü.");
  return (data.models || []).map(normalizeModel);
}

export async function listLlmConversations() {
  const res = await fetch("/api/llm/conversations");
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz sohbet geçmişi döndürdü.");
  return data.conversations || [];
}

export async function saveLlmConversation(conversation) {
  const res = await fetch("/api/llm/save-conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation }),
  });
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz bir sohbet kaydetme yanıtı döndürdü.");
  return data.conversation;
}

export async function deleteLlmConversation(id) {
  const res = await fetch("/api/llm/delete-conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir sohbet silme yanıtı döndürdü.");
}

export async function searchHuggingFaceModels(query = "", filters = [], page = 1) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("query", query.trim());
  if (filters.length > 0) params.set("filters", filters.join(","));
  params.set("page", String(page));
  const res = await fetch(`/api/huggingface/models?${params.toString()}`);
  const data = await readJsonResponse(res, "Hugging Face model araması geçersiz veri döndürdü.");
  return {
    models: Array.isArray(data.models) ? data.models : [],
    source: data.source || "huggingface",
    warning: data.warning || "",
    page: Number(data.page || page),
    hasMore: Boolean(data.hasMore),
  };
}

export async function startLlm(model, options = {}) {
  const res = await fetch("/api/llm/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      threads: options.threads,
      contextSize: options.contextSize,
      gpuLayers: options.gpuLayers,
      enableThinking: options.enableThinking,
      flashAttn: options.flashAttn,
      cacheTypeK: options.cacheTypeK,
      cacheTypeV: options.cacheTypeV,
      mlock: options.mlock,
      mmap: options.mmap,
      cachePrompt: options.cachePrompt,
      defragThold: options.defragThold,
      batchSize: options.batchSize,
      ubatchSize: options.ubatchSize,
      performanceProfile: options.performanceProfile,
      // "auto" gönderilirse sunucu modele kayıtlı en iyi motoru (ör. CPU) kullanamıyordu
      preferredBackend: options.preferredBackend && options.preferredBackend !== "auto" ? options.preferredBackend : undefined,
    }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir metin motoru yanıtı döndürdü.");
}

export async function stopLlm() {
  const res = await fetch("/api/llm/stop", { method: "POST" });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir metin motoru yanıtı döndürdü.");
}

export async function chatWithLlm(messages, options = {}) {
  const res = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      // New sampling parameters
      top_p: options.topP,
      top_k: options.topK,
      min_p: options.minP,
      repeat_penalty: options.repeatPenalty,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      seed: options.seed,
      stop: options.stop,
      useWeb: options.useWeb === true,
      timeFilter: options.timeFilter || "any",
    }),
  });
  const data = await readJsonResponse(res, "Yerel metin modeli geçersiz bir yanıt döndürdü.");
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Metin modeli boş yanıt döndürdü.");
  return {
    content,
    usage: data?.usage || null
  };
}

export async function streamChatWithLlm(messages, options = {}, onToken = () => {}) {
  const fetchOpts = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
      // New sampling parameters
      top_p: options.topP,
      top_k: options.topK,
      min_p: options.minP,
      repeat_penalty: options.repeatPenalty,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      seed: options.seed,
      stop: options.stop,
      useWeb: options.useWeb === true,
      timeFilter: options.timeFilter || "any",
    }),
  };
  if (options.signal) {
    fetchOpts.signal = options.signal;
  }
  const res = await fetch("/api/llm/chat", fetchOpts);

  if (!res.ok) {
    const data = await readJsonResponse(res, `Sohbet isteği başarısız (HTTP ${res.status}).`);
    throw new Error(data.error || `Sohbet isteği başarısız (HTTP ${res.status}).`);
  }
  if (!res.body) throw new Error("Bu tarayıcı akışlı yanıtları desteklemiyor.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let usage = null;
  let timings = null;
  let finishReason = null;
  let webSources = [];

  const normalizeTextDelta = (value) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      }).join("");
    }
    if (value && typeof value === "object") {
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
    }
    return "";
  };

  const consumeEvent = (eventText) => {
    try {
      const data = eventText
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data || data === "[DONE]") return data === "[DONE]";

      const eventName = eventText
        .split(/\r?\n/)
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
      const parsed = JSON.parse(data);
      if (eventName === "web_sources") {
        webSources = parsed.sources || [];
        return false;
      }
      if (eventName === "arac_durum") {
        // Vega bir araç kullanıyor (web araması, hesap, saat): arayüze bildir
        try { options.onArac?.(parsed); } catch (_) {}
        return false;
      }
      const choice = parsed.choices?.[0];
      const token = normalizeTextDelta(
        choice?.delta?.content ??
        choice?.message?.content ??
        choice?.text ??
        parsed.content ??
        parsed.response
      );
      const reasoningToken = normalizeTextDelta(
        choice?.delta?.reasoning_content ??
        choice?.delta?.reasoning ??
        choice?.delta?.thinking ??
        choice?.message?.reasoning_content ??
        parsed.reasoning_content
      );
      if (choice?.finish_reason) finishReason = choice.finish_reason;

      if (token || reasoningToken) {
        content += token;
        reasoningContent += reasoningToken;
        onToken(token, content, reasoningToken, reasoningContent);
      }
      if (parsed.usage) usage = parsed.usage;
      if (parsed.timings) timings = parsed.timings;
      return false;
    } catch (err) {
      console.warn("Failed to parse EventStream JSON:", eventText, err);
      return false;
    }
  };

  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const eventText of events) {
      if (consumeEvent(eventText)) {
        finished = true;
        break;
      }
    }
    if (done) break;
  }

  if (!finished && buffer.trim()) consumeEvent(buffer);
  if (!content && !reasoningContent) throw new Error("Metin modeli boş bir akış yanıtı döndürdü.");
  return { content, reasoningContent, usage, timings, finishReason, webSources };
}

export async function searchWeb(query, options = {}) {
  const res = await fetch("/api/web-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      timeFilter: options.timeFilter || "any",
      resultLimit: options.resultLimit,
      fetchLimit: options.fetchLimit,
    }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir web araması yanıtı döndürdü.");
}

export async function downloadLlmModel(url, filename = null, companion = null) {
  const res = await fetch("/api/llm/download-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      filename,
      projectorUrl: companion?.url || "",
      projectorFilename: companion?.filename || "",
    }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir metin modeli indirme yanıtı döndürdü.");
}

export async function importLlmModel(file, onProgress, signal) {
  return await uploadModelFileToEndpoint(file, "/api/llm/import-model", onProgress, signal);
}

export async function deleteLlmModel(filename) {
  const res = await fetch("/api/llm/delete-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir metin modeli silme yanıtı döndürdü.");
}

export async function getSpeechStatus() {
  try {
    const res = await fetch("/api/speech/status");
    return await readJsonResponse(res, "Yerel sunucu geçersiz konuşma motoru durumu döndürdü.");
  } catch (err) {
    return { ready: false, running: false, backendInstalled: false, error: err.message, settings: {} };
  }
}

export async function listSpeechModels() {
  const res = await fetch("/api/speech/models");
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz konuşma modeli verisi döndürdü.");
  return data.models || [];
}

export async function startSpeech(model, options = {}) {
  const res = await fetch("/api/speech/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      language: options.language || "auto",
      threads: options.threads,
      backendPreference: options.backendPreference || "auto",
    }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir konuşma motoru başlatma yanıtı döndürdü.");
}

export async function stopSpeech() {
  const res = await fetch("/api/speech/stop", { method: "POST" });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir konuşma motoru durdurma yanıtı döndürdü.");
}

export async function transcribeSpeech(fileOrBlob, options = {}) {
  const params = new URLSearchParams();
  if (options.model) params.set("model", options.model);
  if (options.language) params.set("language", options.language);
  if (options.filename) params.set("filename", options.filename);
  if (options.threads) params.set("threads", String(options.threads));
  if (options.backendPreference) params.set("backendPreference", options.backendPreference);
  if (options.translate) params.set("translate", "true");
  if (options.gecici) params.set("gecici", "true");

  const res = await fetch(`/api/speech/transcribe?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: fileOrBlob,
    signal: options.signal,
  });
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz bir döküm yanıtı döndürdü.");
  return data.transcription;
}

export async function downloadSpeechModel(modelIdOrUrl, filename = null) {
  const isUrl = /^https?:\/\//i.test(String(modelIdOrUrl || ""));
  const res = await fetch("/api/speech/download-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: isUrl ? "" : modelIdOrUrl,
      url: isUrl ? modelIdOrUrl : "",
      filename,
    }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir konuşma modeli indirme yanıtı döndürdü.");
}

export async function importSpeechModel(file, onProgress, signal) {
  return await uploadModelFileToEndpoint(file, "/api/speech/import-model", onProgress, signal);
}

export async function deleteSpeechModel(filename) {
  const res = await fetch("/api/speech/delete-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir konuşma modeli silme yanıtı döndürdü.");
}

export async function listSpeechTranscriptions() {
  const res = await fetch("/api/speech/transcriptions");
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz döküm geçmişi döndürdü.");
  return data.transcriptions || [];
}

export async function deleteSpeechTranscription(filename) {
  const res = await fetch("/api/speech/delete-transcription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir döküm silme yanıtı döndürdü.");
}

export async function getTtsStatus() {
  try {
    const res = await fetch("/api/tts/status");
    return await readJsonResponse(res, "Yerel sunucu geçersiz metinden sese çalışma ortamı durumu döndürdü.");
  } catch (err) {
    return { ready: false, running: false, runtimeInstalled: false, error: err.message, settings: {}, voices: [] };
  }
}

export async function listTtsModels() {
  const res = await fetch("/api/tts/models");
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz metinden sese modeli verisi döndürdü.");
  return data.models || [];
}

export async function startTts(model, options = {}) {
  const res = await fetch("/api/tts/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice: options.voice,
      speed: options.speed,
    }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir metinden sese başlatma yanıtı döndürdü.");
}

export async function stopTts() {
  const res = await fetch("/api/tts/stop", { method: "POST" });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir metinden sese durdurma yanıtı döndürdü.");
}

export async function speakTts(text, options = {}) {
  const res = await fetch("/api/tts/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model: options.model,
      voice: options.voice,
      speed: options.speed,
      gecici: options.gecici === true,
    }),
    signal: options.signal,
  });
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz bir metinden sese yanıtı döndürdü.");
  return data.output;
}

export async function downloadTtsModel(modelIdOrUrl, filename = null) {
  const res = await fetch("/api/tts/download-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelIdOrUrl,
      filename,
    }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir metinden sese modeli indirme yanıtı döndürdü.");
}

export async function importTtsModel(file, onProgress, signal) {
  return await uploadModelFileToEndpoint(file, "/api/tts/import-model", onProgress, signal);
}

export async function deleteTtsModel(filename) {
  const res = await fetch("/api/tts/delete-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir metinden sese modeli silme yanıtı döndürdü.");
}

export async function listTtsOutputs() {
  const res = await fetch("/api/tts/outputs");
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz ses çıktısı geçmişi döndürdü.");
  return data.outputs || [];
}

export async function deleteTtsOutput(filename) {
  const res = await fetch("/api/tts/delete-output", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir ses çıktısı silme yanıtı döndürdü.");
}

export async function getLlmRecommendations(useCase = "chat", limit = 10) {
  try {
    const res = await fetch(`/api/llm/recommend?useCase=${encodeURIComponent(useCase)}&limit=${limit}`);
    const data = await res.json();
    if (!res.ok || !data.ok) return null;
    return data.recommendations;
  } catch (_) {
    return null;
  }
}

export async function listGeneratedOutputs() {
  try {
    const res = await fetch("/api/outputs");
    const data = await res.json();
    return data.outputs || [];
  } catch (_) {
    return [];
  }
}

export async function saveGeneratedOutput(image, metadata) {
  const res = await fetch("/api/save-output", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, metadata }),
  });
  const data = await readJsonResponse(res, "Yerel sunucu geçersiz bir kaydetme yanıtı döndürdü.");
  return data.output;
}

// ESRGAN ile buyutme: uretilmis bir ciktiyi x4 buyutur, yeni dosya olarak kaydeder.
// Difuzyon gecisi yoktur; bu donanimda 512 -> 2048 yaklasik 70 saniye surer.
export async function upscaleOutput(filename, repeats = 1, signal) {
  const res = await fetch("/api/upscale-output", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ filename, repeats }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) {
    throw new Error((data && data.error) || `Büyütme başarısız (HTTP ${res.status})`);
  }
  return data.output;
}

export async function deleteGeneratedOutputs(outputs) {
  const res = await fetch("/api/delete-outputs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outputs }),
  });
  return await readJsonResponse(res, "Yerel sunucu geçersiz bir silme yanıtı döndürdü.");
}

// List model files from the models folder (via management API in web mode)
export async function listModelsFromDisk() {
  try {
    const [modelRes, openvino] = await Promise.all([
      fetch("/api/models"),
      listOpenVinoModels().catch(() => ({ supported: false, models: [] })),
    ]);
    const data = await modelRes.json();
    const normalModels = (data.models || []).map(normalizeModel);
    const openvinoModels = openvino.supported
      ? (openvino.models || []).filter((model) => model.installed).map((model) => normalizeModel({
          filename: model.id,
          name: model.name,
          sizeBytes: model.sizeBytes,
          size: model.size,
          format: "OpenVINO",
          backendType: "openvino-npu",
          resolution: model.resolution,
        }))
      : [];
    return [...normalModels, ...openvinoModels];
  } catch (_) {
    return [];
  }
}

export async function listOpenVinoModels() {
  const res = await fetch("/api/openvino-models");
  return await readJsonResponse(res, "Yerel sunucu geçersiz OpenVINO model verisi döndürdü.");
}

// Generate image (T2I / I2I)
// Handles API calls to sd-server. If the server is unreachable or returns an error,
// we surface that error to the UI instead of silently returning a fake placeholder.
export async function generateImage(prompt, negativePrompt, constraints, activeModelName, inputImageBase64, onProgress, signal) {
  console.log("Initiating image generation:", { prompt, negativePrompt, constraints, activeModelName });
  const startTime = Date.now();

  // Prepare payload based on standard stable-diffusion.cpp REST endpoint schemas
  const payload = {
    prompt: prompt,
    negative_prompt: negativePrompt || "",
    width: constraints.width || 512,
    height: constraints.height || 512,
    steps: constraints.steps || 20,
    cfg_scale: constraints.cfgScale || 7.0,
    seed: constraints.seed === -1 ? Math.floor(Math.random() * 1000000) : constraints.seed,
    sampler: constraints.sampler || "euler_a",
    image: inputImageBase64 || null, // Image to image source (base64)
    denoising_strength: constraints.denoisingStrength || 0.7,
    // Yuksek cozunurluk alanlari: constraints uzerinden gelir, acikca tasinmali.
    hiresEnabled: constraints.hiresEnabled === true,
    hiresScale: constraints.hiresScale,
    hiresUpscaler: constraints.hiresUpscaler,
    hiresDenoise: constraints.hiresDenoise,
    hiresSteps: constraints.hiresSteps,
    // Zamanlayici ve CLIP atlama: bos/0 ise model varsayilani kullanilir
    scheduler: constraints.scheduler || "",
    clipSkip: Number(constraints.clipSkip) || 0,
  };

  if (constraints.backendType === "openvino-npu") {
    if (inputImageBase64) {
      throw new Error("OpenVINO NPU test modu şu anda yalnızca metinden görsel üretimini destekliyor.");
    }
    const response = await fetch("/api/openvino-generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        prompt: payload.prompt,
        negative_prompt: payload.negative_prompt,
        steps: payload.steps,
        cfg_scale: payload.cfg_scale,
        seed: payload.seed,
        width: payload.width,
        height: payload.height,
      }),
    });
    const data = await readJsonResponse(response, "Yerel sunucu geçersiz bir OpenVINO üretim yanıtı döndürdü.");
    const imgB64 = data?.data?.[0]?.b64_json;
    if (!imgB64) throw new Error("OpenVINO üretimi görsel döndürmedi.");
    const normalizedB64 = String(imgB64).replace(/^data:[^;]+;base64,/, "");
    const header = atob(normalizedB64.slice(0, 24));
    const isPng = header.charCodeAt(0) === 0x89 && header.slice(1, 4) === "PNG";
    const isJpeg = header.charCodeAt(0) === 0xff && header.charCodeAt(1) === 0xd8 && header.charCodeAt(2) === 0xff;
    const isWebp = header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP";
    if (!isPng && !isJpeg && !isWebp) {
      throw new Error("OpenVINO üretimi gerçek bir PNG/JPEG/WebP yerine geçersiz görsel verisi döndürdü.");
    }
    const durationSec = Number(data.duration_sec) || parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
    return {
      image: `data:image/png;base64,${normalizedB64}`,
      seed: data.data?.[0]?.seed ?? payload.seed,
      duration_sec: durationSec,
    };
  }

  const baseUrl = await getBackendBaseUrl();


  // Kullan the sdapi endpoints for both modes. The OpenAI-compatible endpoint
  // ignores native generation fields such as seed, steps, CFG, and sampler.
  const isImg2Img = !!payload.image;
  let endpoint = `${baseUrl}/sdapi/v1/txt2img`;

  let genBody = {
    prompt:           payload.prompt,
    negative_prompt:  payload.negative_prompt || "",
    width:            payload.width,
    height:           payload.height,
    steps:            payload.steps,
    cfg_scale:        payload.cfg_scale,
    seed:             payload.seed,
    sampler_name:     payload.sampler || "euler_a",
    batch_size:       1,
  };

  // Yuksek cozunurluk (highres fix) - yalnizca acikca istendiginde eklenir.
  // Kapaliyken istek govdesi bit bit eskisiyle ayni kalir.
  if (payload.hiresEnabled) {
    genBody.enable_hr = true;
    genBody.hr_scale = Number(payload.hiresScale) || 2;
    genBody.hr_upscaler = payload.hiresUpscaler || "Latent";
    genBody.denoising_strength = Number(payload.hiresDenoise) || 0.5;
    if (Number(payload.hiresSteps) > 0) genBody.hr_steps = Number(payload.hiresSteps);
  }

  // img2img extra fields
  if (isImg2Img) {
    const initBase64 = String(payload.image).replace(/^data:[^;]+;base64,/, "");
    endpoint = `${baseUrl}/sdapi/v1/img2img`;
    genBody = {
      init_images:        [initBase64],
      prompt:             payload.prompt,
      negative_prompt:    payload.negative_prompt || "",
      denoising_strength: payload.denoising_strength || 0.7,
      steps:              payload.steps,
      cfg_scale:          payload.cfg_scale,
      seed:               payload.seed,
      width:              payload.width,
      height:             payload.height,
      sampler_name:       payload.sampler || "euler_a",
      sample_method:      payload.sampler || "euler_a",
      batch_size:         1,
      n_iter:             1,
      send_images:        true,
      save_images:        false,
    };
  }

  if (payload.scheduler) genBody.scheduler = payload.scheduler;
  if (payload.clipSkip > 0) genBody.clip_skip = payload.clipSkip;

  // Attempt real HTTP call
  try {
    const response = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  signal,
      body:    JSON.stringify(genBody),
    });

    if (response.ok) {
      const data = await response.json();
      // Response: { data: [{ b64_json: "..." }] }
      const imgB64 = data?.data?.[0]?.b64_json ?? data?.images?.[0];
      if (imgB64) {
        const normalizedB64 = String(imgB64).replace(/^data:[^;]+;base64,/, "");
        const header = atob(normalizedB64.slice(0, 24));
        const isPng = header.charCodeAt(0) === 0x89 && header.slice(1, 4) === "PNG";
        const isJpeg = header.charCodeAt(0) === 0xff && header.charCodeAt(1) === 0xd8 && header.charCodeAt(2) === 0xff;
        const isWebp = header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP";
        if (!isPng && !isJpeg && !isWebp) {
          throw new Error("Üretim, gerçek bir PNG/JPEG/WebP yerine geçersiz görsel verisi döndürdü.");
        }
        const durationSec = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
        return {
          image:        `data:image/png;base64,${normalizedB64}`,
          seed:         data.data?.[0]?.seed ?? payload.seed,
          duration_sec: durationSec,
        };
      }
    } else {
      let errMsg = `Üretim başarısız (HTTP ${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson?.detail || errJson?.error?.message) {
          errMsg = errJson.detail || errJson.error.message;
        }
      } catch (_) {}
      const hata = new Error(errMsg);
      hata.sunucuHatasi = true;
      throw hata;
    }
  } catch (err) {
    if (err.name === "AbortError" || err.sunucuHatasi || err.message.startsWith("Üretim, gerçek")) throw err;
    console.warn("Could not reach local server.", err);
    throw new Error(
      "Görsel üretim sunucusu yanıt vermiyor veya çöktü. " +
      "Model Yöneticisi'nden motoru yeniden başlatmayı deneyin veya terminalde motor hatası olup olmadığını kontrol edin."
    );
  }
}

// Model ailesini sunucudan ogren (dosya iceriginden tespit)
export async function getModelDetails(filename) {
  const res = await fetch(`/api/model-info?filename=${encodeURIComponent(filename)}`);
  const data = await readJsonResponse(res, "Model bilgisi okunamadı.");
  return data.model;
}

// Modeli sansursuz olarak isaretle / isareti kaldir (null = otomatik)
export async function setModelLabel(filename, uncensored) {
  const res = await fetch("/api/model-label", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, uncensored }),
  });
  const data = await readJsonResponse(res, "Model etiketi kaydedilemedi.");
  return data.model;
}

// Perform model file import (copy to USB in Tauri, simulated in Web mode)
export async function importModelFile(sourcePath, onProgress, signal) {
  if (sourcePath instanceof File) {
    const file = sourcePath;
    const isLocalMode = isLocalServerMode();
    if (!isLocalMode) {
      throw new Error("Dosya içe aktarmak için yerel görsel üretici sunucusu gerekir.");
    }

    await uploadModelFile(file, onProgress, signal);
    return { response: "Model imported successfully" };
  }

  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    
    let unlisten = null;
    if (onProgress) {
      unlisten = await listen("import-progress", (event) => {
        onProgress(event.payload);
      });
    }

    try {
      const response = await invoke("import_model_file", { sourcePath });
      return { response, unlisten };
    } catch (e) {
      if (unlisten) unlisten();
      throw e;
    }
  }

  // Fallback simulation in browser
  const filename = sourcePath.split(/[\\/]/).pop() || "imported_model.gguf";
  console.log(`Web Mode: Simulating copying ${filename} to USB models folder`);
  
  const totalSteps = 40;
  const start = Date.now();

  for (let i = 1; i <= totalSteps; i++) {
    if (signal?.aborted) {
      throw new DOMException("İstek kullanıcı tarafından iptal edildi.", "AbortError");
    }
    await new Promise((r) => setTimeout(r, 150)); // ~6 seconds copy total
    const progress = (i / totalSteps) * 100;
    const elapsedSecs = (Date.now() - start) / 1000;
    const speed = 40 + Math.sin(i) * 5 + Math.random() * 2; // ~42 MB/s
    const eta = (totalSteps - i) * 0.15;

    if (onProgress) {
      onProgress({
        filename,
        progress,
        speed_mb_s: speed,
        eta_secs: eta,
        status: "Uygulama klasörüne kopyalanıyor..."
      });
    }
  }

  // Save to localStorage
  const saved = localStorage.getItem("imported-models");
  const imported = saved ? JSON.parse(saved) : [];
  if (!imported.includes(filename)) {
    imported.push({ filename, sizeBytes: 0, size: "Unknown" });
    localStorage.setItem("imported-models", JSON.stringify(imported));
  }

  return { response: "Model imported successfully" };
}

function uploadModelFile(file, onProgress, signal) {
  return uploadModelFileToEndpoint(file, "/api/import-model", onProgress, signal);
}

function uploadModelFileToEndpoint(file, endpoint, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startedAt = Date.now();
    let abortedByUser = false;

    xhr.open("POST", `${endpoint}?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    const abortUpload = () => {
      abortedByUser = true;
      xhr.abort();
    };
    if (signal) {
      if (signal.aborted) {
        abortUpload();
      } else {
        signal.addEventListener("abort", abortUpload, { once: true });
      }
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;

      const elapsedSecs = Math.max(0.1, (Date.now() - startedAt) / 1000);
      const speedBytes = event.loaded / elapsedSecs;
      const remainingBytes = Math.max(0, event.total - event.loaded);
      onProgress({
        filename: file.name,
        progress: (event.loaded / event.total) * 100,
        speed_mb_s: speedBytes / (1024 * 1024),
        eta_secs: remainingBytes / Math.max(1, speedBytes),
        status: "Modeller klasörüne kopyalanıyor..."
      });
    };

    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch (_) {}

      if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) {
        if (onProgress) {
          onProgress({
            filename: file.name,
            progress: 100,
            speed_mb_s: 0,
            eta_secs: 0,
            status: "İçe aktarma tamamlandı"
          });
        }
        resolve(data);
      } else {
        reject(new Error(data.error || `İçe aktarma başarısız (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Dosya yüklenirken içe aktarma başarısız oldu."));
    xhr.onabort = () => reject(new DOMException(abortedByUser ? "İçe aktarma kullanıcı tarafından iptal edildi." : "İçe aktarma durduruldu.", "AbortError"));
    xhr.send(file);
  });
}

// Delete model file (Tauri disk deletion or localStorage cleanup)
export async function deleteModel(filename) {
  if (isTauri()) {
    return await invoke("delete_model_file", { filename });
  }

  if (isLocalServerMode()) {
    try {
      const res = await fetch("/api/delete-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Model dosyası silinemedi");
      }
      return data;
    } catch (err) {
      console.error("Failed to delete model via local API:", err);
      throw err;
    }
  }

  // Browser Mode
  const saved = localStorage.getItem("imported-models");
  let imported = saved ? JSON.parse(saved) : [];
  imported = imported.filter((model) => normalizeModel(model).filename !== filename);
  localStorage.setItem("imported-models", JSON.stringify(imported));
  return `Benzetimli silme: ${filename} (tarayıcı oturumundan)`;
}

// Ping the server to check if it is active and responding
export async function pingServer() {
  const baseUrl = await getBackendBaseUrl();
  try {
    const response = await fetch(`${baseUrl}/v1/models`, { method: "GET" });
    return response.ok;
  } catch (e) {
    return false;
  }
}

// Wait for the server to be ready by polling
export async function waitForServerReady(maxAttempts = 30) {
  const attempts = isTauri() || isLocalServerMode() ? maxAttempts : 3;
  for (let i = 0; i < attempts; i++) {
    let ok = false;
    if (isLocalServerMode()) {
      const status = await getBackendStatus();
      ok = Boolean(status.ready);
    } else {
      ok = await pingServer();
    }
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500)); // check every 500ms
  }
  return false;
}

// Start model file download from a URL on the server
export async function downloadModel(url) {
  try {
    const res = await fetch("/api/download-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    return await res.json();
  } catch (e) {
    console.error("Failed to start model download:", e);
    return { ok: false, error: e.message };
  }
}

export async function downloadOpenVinoModel(modelId) {
  try {
    const res = await fetch("/api/download-openvino-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: modelId })
    });
    return await readJsonResponse(res, "Yerel sunucu geçersiz bir OpenVINO indirme yanıtı döndürdü.");
  } catch (e) {
    console.error("Failed to start OpenVINO model download:", e);
    return { ok: false, error: e.message };
  }
}

export async function cancelModelDownload() {
  try {
    const res = await fetch("/api/cancel-download", { method: "POST" });
    return await res.json();
  } catch (e) {
    console.error("Failed to cancel model download:", e);
    return { ok: false, error: e.message };
  }
}

// Tum varsayilan modelleri indirme kuyrugunu baslatir (gorsel + metin + konusma + tts)
export async function downloadDefaultModels() {
  try {
    const res = await fetch("/api/download-default-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    return await readJsonResponse(res, "Yerel sunucu geçersiz bir varsayılan model indirme yanıtı döndürdü.");
  } catch (e) {
    console.error("Varsayilan modeller indirmesi baslatilamadi:", e);
    return { ok: false, error: e.message };
  }
}

// Get which compatible models would be selected for this machine, and why.
export async function getCompatibleModels() {
  try {
    const res = await fetch("/api/compatible-models");
    const data = await res.json();
    if (!data || data.ok === false) {
      return { ok: false, error: data?.error || "Uyumlu modeller alınamadı." };
    }
    return { ok: true, tier: data.tier, vram: data.vram, ram: data.ram, models: data.models || [] };
  } catch (e) {
    console.error("Uyumlu modeller alinamadi:", e);
    return { ok: false, error: e.message };
  }
}

// Get the server-side model download progress
export async function getDownloadProgress() {
  try {
    const res = await fetch("/api/download-progress");
    return await res.json();
  } catch (e) {
    console.error("Failed to get download progress:", e);
    return { active: false, error: e.message };
  }
}

// Get the server-side image generation progress
// Uretim planini sunucuya bildir (ikinci gecisin adimlarini izleyebilmesi icin)
export async function setGenerationPlan(plan) {
  try {
    await fetch("/api/generation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan || {}),
    });
  } catch (_) {}
}

// Otomasyon kuyruğunun durumu (arka planda çalışan görsel işleri)
// Vega'nın sohbetten istediği görseli üretir (sunucu Vega'yı geçici olarak bellekten çıkarır)
export async function vegaGorselBaslat(istem, model, buyut = false) {
  const res = await fetch("/api/vega/gorsel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ istem, model, buyut }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `Görsel başlatılamadı (HTTP ${res.status})`);
  return data.id;
}

// Sohbetteki model seçimi için kurulu görsel modelleri (aile bilgisiyle)
export async function gorselModelleriniListele() {
  const res = await fetch("/api/models");
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.models) ? data.models : [];
}

export async function vegaGorselDurumu(id) {
  const res = await fetch(`/api/vega/gorsel?id=${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `Görsel durumu okunamadı (HTTP ${res.status})`);
  return data;
}

export async function getJobQueueStatus() {
  try {
    const res = await fetch("/api/is-kuyrugu");
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

export async function getGenerationProgress() {
  try {
    const res = await fetch("/api/generation-progress");
    return await res.json();
  } catch (e) {
    console.error("Failed to get generation progress:", e);
    return { active: false, error: e.message };
  }
}


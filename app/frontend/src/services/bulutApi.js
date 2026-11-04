// Bulut modelleri için arayüz yardımcıları (sunucu: scripts/server/bulut.cjs, /api/bulut/*)
// API anahtarı yalnızca kaydederken bir kez sunucuya gönderilir; sunucu onu asla geri döndürmez.

async function oku(res, varsayilan) {
  const metin = await res.text();
  let veri = {};
  try { veri = JSON.parse(metin || "{}"); } catch (_) { throw new Error(varsayilan); }
  if (!res.ok || veri.ok === false) throw new Error(veri.error || `${varsayilan} (HTTP ${res.status})`);
  return veri;
}

function gonder(yol, govde) {
  return fetch(yol, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde || {}) });
}

export const bulutModeliMi = (kimlik) => typeof kimlik === "string" && kimlik.startsWith("bulut:");

const KISA_ADLAR = { openai: "OpenAI", gemini: "Gemini", anthropic: "Claude", openrouter: "OpenRouter" };

// "bulut:gemini:gemini-2.5-flash" -> "Bulut · Gemini · gemini-2.5-flash"
export function bulutEtiketi(kimlik) {
  if (!bulutModeliMi(kimlik)) return "";
  const ikinci = kimlik.indexOf(":", 6);
  if (ikinci < 0) return "";
  const saglayici = kimlik.slice(6, ikinci);
  return `Bulut · ${KISA_ADLAR[saglayici] || saglayici} · ${kimlik.slice(ikinci + 1)}`;
}

export async function bulutSaglayicilari() {
  return oku(await fetch("/api/bulut/saglayicilar"), "Bulut sağlayıcıları okunamadı");
}

// Model seçicideki bulut girdileri: [{ filename: "bulut:…", name, bulut: true, saglayici, etiket }]
export async function bulutListesi() {
  const veri = await oku(await fetch("/api/bulut/liste"), "Bulut modelleri okunamadı");
  return Array.isArray(veri.modeller) ? veri.modeller : [];
}

export async function bulutAnahtarKaydet(saglayici, anahtar) {
  return oku(await gonder("/api/bulut/anahtar", { saglayici, anahtar }), "Anahtar kaydedilemedi");
}

export async function bulutAnahtarSil(saglayici) {
  return oku(await gonder("/api/bulut/anahtar-sil", { saglayici }), "Anahtar silinemedi");
}

export async function bulutSaglayiciModelleri(saglayici) {
  return oku(await fetch(`/api/bulut/modeller?saglayici=${encodeURIComponent(saglayici)}`), "Model listesi alınamadı");
}

export async function bulutModelEkle(saglayici, model) {
  return oku(await gonder("/api/bulut/model-ekle", { saglayici, model }), "Model eklenemedi");
}

export async function bulutModelSil(model) {
  return oku(await gonder("/api/bulut/model-sil", { model }), "Model kaldırılamadı");
}

export async function bulutTest(saglayici, model) {
  return oku(await gonder("/api/bulut/test", { saglayici, model }), "Bağlantı testi başarısız");
}

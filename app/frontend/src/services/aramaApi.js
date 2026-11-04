// Model arama (Hugging Face / GitHub) ve model güncelleme bildirimi için istemci yardımcıları (Yerel AI Stüdyosu)
// Sunucu tarafı: scripts/server/model-arama.cjs (/api/model-arama/*), scripts/server/guncelleme.cjs (/api/guncelleme/*)
// Tarayıcı hiçbir dış sunucuya doğrudan istek atmaz; tüm sorguları yerel sunucu yapar (önbellekli, zaman aşımlı).

async function istek(url, secenek) {
  let res;
  try {
    res = await fetch(url, secenek);
  } catch (err) {
    throw new Error("Sunucuya ulaşılamadı: " + (err.message || err));
  }
  let veri = {};
  try { veri = await res.json(); } catch (_) {}
  // 409: sunucu onay istiyor (kapılı model, belirsiz lisans, belleğe sığmama, aynı adlı dosya) — çağırana döner
  if (res.status === 409 && (veri.onayGerekli || veri.uzerineYazOnayi)) return veri;
  if (!res.ok || veri.ok === false) {
    const hata = new Error(veri.error || `İstek başarısız (HTTP ${res.status})`);
    hata.kod = res.status;
    hata.cevrimdisi = Boolean(veri.cevrimdisi);
    throw hata;
  }
  return veri;
}

const gonder = (url, govde) => istek(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(govde || {}),
});

// tur: "image" | "text" | "speech" | "tts" | "muzik" | "video"; kaynak: "hf" | "github"
export function modelAra({ tur, q = "", sayfa = 1, kaynak = "hf" }) {
  const p = new URLSearchParams({ tur, q, sayfa: String(sayfa), kaynak });
  return istek(`/api/model-arama/ara?${p.toString()}`);
}

// anahtar: seçilen sürümün (ör. GGUF nicemi) depo içindeki dosya yolu. Commit, dosya listesi ve özetler
// sunucuda yeniden alınır; istemciden gelen yol/özet kullanılmaz.
export const modelKur = ({ tur, repo, anahtar, kaynak = "hf", uyarilariOnayla = false, uzerineYaz = false }) =>
  gonder("/api/model-arama/kur", { tur, repo, anahtar, kaynak, uyarilariOnayla, uzerineYaz });

// Kurulum ve güncelleme aynı iş kuyruğunu kullanır
export const aramaIsDurumu = () => istek("/api/model-arama/durum");

// zorla: günde bir kez sınırını yok say (sunucu yine de en çok 10 dakikada bir denetler)
export const guncellemeleriGetir = (zorla = false) => istek(`/api/guncelleme/liste${zorla ? "?zorla=1" : ""}`);
export const guncellemeleriUygula = ({ idler = [], hepsi = false }) => gonder("/api/guncelleme/uygula", { idler, hepsi });
export const surumuAtla = (id, surum) => gonder("/api/guncelleme/atla", { id, surum });

export function boyutYaz(bayt) {
  const b = Number(bayt) || 0;
  if (b <= 0) return "?";
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1).replace(".", ",")} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

export function tarihYaz(iso) {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString("tr-TR", { year: "numeric", month: "short", day: "numeric" });
}

export function sayiYaz(n) {
  const x = Number(n) || 0;
  if (x >= 1e6) return `${(x / 1e6).toFixed(1).replace(".", ",")} Mn`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1).replace(".", ",")} B`;
  return String(x);
}

export const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// İş kuyruğu bitene kadar ilerlemeyi izler. onIlerleme({ ad, asama, ilerleme|null, hiz }). Bitince son iş durumunu döndürür.
export async function isBitinceyeKadarIzle(onIlerleme, iptalMi = () => false) {
  for (;;) {
    await bekle(1500);
    if (iptalMi()) return null;
    let d;
    try { d = await aramaIsDurumu(); } catch (_) { continue; }
    const is = d.is || {};
    const ind = d.indirme || {};
    onIlerleme({ ad: is.ad || "", asama: is.asama || "", ilerleme: ind.aktif && ind.ilerleme >= 0 ? ind.ilerleme : null, hiz: ind.aktif ? ind.hiz : "" });
    if (!is.aktif && (!is.sira || is.sira.length === 0)) return is;
  }
}

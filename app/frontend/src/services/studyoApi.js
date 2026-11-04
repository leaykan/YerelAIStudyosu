// Müzik, ses efekti ve video stüdyosu için istemci yardımcıları (Yerel AI Stüdyosu)
// DD:YZ Sansürsüz Lokal AI Stüdyosu V2 (MIT, Tech Jarves / DD:YZ) kaynağından uyarlanmıştır
// (services/api.js müzik/video çağrıları). Sunucu tarafı: scripts/server/studyo.cjs
// Not: Sayfa serve.cjs'in sunduğu adresten açıldığı için göreli adresler kullanılır.

async function istek(url, secenek) {
  let res;
  try {
    res = await fetch(url, secenek);
  } catch (err) {
    throw new Error("Sunucuya ulaşılamadı: " + (err.message || err));
  }
  let veri = {};
  try { veri = await res.json(); } catch (_) {}
  if (!res.ok || veri.ok === false) {
    const hata = new Error(veri.error || `İstek başarısız (HTTP ${res.status})`);
    hata.kod = res.status;
    hata.veri = veri;
    throw hata;
  }
  return veri;
}

const gonder = (url, govde) => istek(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(govde || {}),
});
const sorgu = (id) => (id ? `?id=${encodeURIComponent(id)}` : "");

// Genel
export const studyoDonanim = (yenile = false) => istek(`/api/studyo/donanim${yenile ? "?yenile=1" : ""}`);
export const studyoModelKur = (model) => gonder("/api/studyo/kur", { model });
export const studyoModelSil = (model) => gonder("/api/studyo/sil", { model });
export const studyoKurulumDurumu = () => istek("/api/studyo/kurulum");
export const studyoIptal = (id) => gonder("/api/studyo/iptal", { id });
export const studyoKlasorAc = (tur, dosya = "") => gonder("/api/studyo/klasor-ac", { tur, dosya });

// Müzik ve ses efekti
export const muzikModelleri = () => istek("/api/music/models");
export const muzikUret = (govde) => gonder("/api/audio/music", govde);
export const sesIlerleme = (id) => istek(`/api/audio/progress${sorgu(id)}`);
export const sesGecmisi = () => istek("/api/audio/history");
export const sesSil = (filename) => gonder("/api/audio/delete", { filename });

// Sohbet içi stüdyo kartı (Vega'nın başlattığı müzik / efekt / video işleri; components/StudyoSohbetKarti.jsx)
// GET /api/studyo/is/<id> -> { is: özet, ek: { sohbetModeli: { durum, model, hata }, sohbetModeliYuklu } }
export const studyoIsDurumu = (id) => istek(`/api/studyo/is/${encodeURIComponent(id)}`);
// Aynı tarifle başka bir modelle (video: AnimateDiff için SD 1.5 tabanıyla) yeniden üret -> { is: yeni özet }
export const studyoIsYeniden = (id, model, taban = "") => gonder(`/api/studyo/is/${encodeURIComponent(id)}/yeniden`, { model, taban });
// tur: muzik | efekt | video -> { modeller: [{ id, name, tier, notes }], tabanlar?: [{ dosya, ad, boyutGb, gercekci }] }
export const studyoKuruluModeller = (tur) => istek(`/api/studyo/kurulu-modeller?tur=${encodeURIComponent(tur)}`);
// Sohbetteki model seçim kartı (components/SohbetMedyaKarti.jsx): kullanıcı "Seç"e basınca, Vega'nın yanıtı
// bittikten sonra iş başlatılır. govde: { tur: muzik|efekt|video, model, istem, ozgunIstem?, sure?, taban? } -> { is: özet }
export const studyoVegaBaslat = (govde) => gonder("/api/studyo/vega-baslat", govde);

// Sol menüdeki bir sayfayı aç (App.jsx "yas-sekme-ac" olayını dinler): "muzik" | "video" | "generator" | "models"
export function sekmeAc(sekme) {
  try { window.dispatchEvent(new CustomEvent("yas-sekme-ac", { detail: { sekme } })); } catch (_) { /* yok say */ }
}

// Sohbet modeli (video / görsel işleri onu bellekten çıkarıp sonra geri yükler)
// -> { videoSuruyor, yuklu, geriYukleme: { durum: bekliyor|yukleniyor|hazir|hata|atlandi, model, hata, kaynak, zaman } | null,
//      bekleyen: { model, kaynak: "video"|"gorsel" } | null }
export const sohbetModeliDurumu = () => istek("/api/studyo/sohbet-modeli");
// Bekleyen sohbet modelini beklemeden yükle (sohbetteki "Şimdi geri yükle")
export const sohbetModeliniSimdiGeriYukle = () => gonder("/api/studyo/sohbet-modeli/geri-yukle");
// Video sürerken kullanıcı onayıyla sohbet modeli yükle (sunucu onaysız isteği 409 VIDEO_SURUYOR ile reddeder).
// ayarlar: services/api.js startLlm ile aynı alanlar (threads, contextSize, gpuLayers, enableThinking, ...)
export async function sohbetModeliniVideoyaRagmenYukle(model, ayarlar = {}) {
  const govde = { ...ayarlar, model, videoyaRagmen: true };
  if (!govde.preferredBackend || govde.preferredBackend === "auto") delete govde.preferredBackend;
  return gonder("/api/llm/start", govde);
}

// Video
export const videoModelleri = () => istek("/api/video/models");
export const videoUret = (govde) => gonder("/api/video/generate", govde);
export const videoDurumu = (id) => istek(`/api/video/status${sorgu(id)}`);
export const videoGalerisi = () => istek("/api/video/gallery");
export const videoSil = (filename) => gonder("/api/video/delete", { filename });

// Dosyayı indir (sunucu ?indir=1 ile Content-Disposition: attachment döner)
export function dosyaIndir(url, ad) {
  if (!url) return;
  const a = document.createElement("a");
  a.href = url + (url.includes("?") ? "&" : "?") + "indir=1";
  a.download = ad || "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Kurulum durumunun okunur özeti
// Yalnızca stüdyonun kendi özellik/paketlerinin hataları gösterilir (ses tanıma vb. eski hatalar değil)
const STUDYO_KIMLIKLERI = ["muzik-efekt", "video", "musicgen-small", "audioldm-s-full-v2", "animatediff-v1-5-2", "sd15-yapilandirma", "wan21-t2v-1.3b"];
// Bu model şu anda kuruluyor mu (Python özelliği, indirilen paket ya da sıradaki paket)?
export function modelKuruluyorMu(model, k) {
  if (!model || !k) return false;
  const paketler = model.paketKimlikleri || model.eksikPaketler || [];
  const eksik = model.eksikPaketler || paketler;
  if (k.aktifPaket && paketler.includes(k.aktifPaket)) return true;
  if ((k.sira || []).some((p) => eksik.includes(p))) return true;
  if (k.paket?.aktif && paketler.includes(k.paket.id)) return true;
  return Boolean(k.sonModel === model.id && k.ozellik?.aktif && k.ozellik.id === model.ozellik);
}

// "~29 GB (fp32 UMT5-XXL metin kodlayıcı dahil)" -> "~29 GB"
export const kisaBoyut = (s) => String(s || "").replace(/\s*\(.*$/, "").trim();

export function kurulumOzeti(k) {
  if (!k) return { aktif: false, metin: "" };
  const oz = k.ozellik?.id && STUDYO_KIMLIKLERI.includes(k.ozellik.id) ? k.ozellik : {};
  const pk = k.paket?.id && STUDYO_KIMLIKLERI.includes(k.paket.id) ? k.paket : {};
  if (k.paket?.aktif && !pk.aktif) return { aktif: true, yuzde: null, metin: `Başka bir model iniyor (${k.paket.etiket || k.paket.id}); sırada bekleniyor...` };
  if (pk.aktif) {
    const inen = pk.toplam ? ` — ${(pk.inen / 1073741824).toFixed(2)} / ${(pk.toplam / 1073741824).toFixed(2)} GB` : "";
    return { aktif: true, yuzde: pk.ilerleme >= 0 ? pk.ilerleme : null, metin: `${pk.etiket || pk.id} indiriliyor %${pk.ilerleme ?? 0}${inen} ${pk.hiz || ""}`.trim() };
  }
  if (oz.aktif) return { aktif: true, yuzde: null, metin: `${oz.asama || "Python paketleri kuruluyor"}...` };
  if ((k.sira || []).length) return { aktif: true, yuzde: null, metin: `Sırada: ${k.sira.join(", ")}` };
  const hata = k.hata || (pk.hata && pk.id ? `${pk.id}: ${pk.hata}` : "") || (oz.hata ? `${oz.id}: ${oz.hata}` : "");
  return { aktif: false, metin: "", hata };
}

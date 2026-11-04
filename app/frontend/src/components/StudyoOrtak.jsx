// Müzik ve Video stüdyolarının ortak parçaları (donanım rozeti, uyarılar, model kurulumu, ilerleme)
// DD:YZ Sansürsüz Lokal AI Stüdyosu V2 (MIT, Tech Jarves / DD:YZ) kaynağından uyarlanmıştır
// (AudioStudio.jsx / VideoStudio.jsx rozetleri ve ilerleme kartı).
import React, { useEffect, useRef, useState } from "react";
import { CircleCheck, Cpu, Download, Eye, EyeOff, LoaderCircle, Square, TriangleAlert, Info } from "lucide-react";
import { kisaBoyut, kurulumOzeti, modelKuruluyorMu, studyoKurulumDurumu, studyoModelKur } from "../services/studyoApi";

// Stüdyo sayfalarının taşma düzeltmeleri: ızgara/flex çocukları daralabilsin, uzun metinler kaydırılsın.
// Yalnızca .studyo-sayfa altında geçerlidir; diğer sayfaların görünümü değişmez.
const STUDYO_CSS = `
.studyo-sayfa .speech-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); }
.studyo-sayfa .speech-grid > *, .studyo-sayfa .speech-panel > *, .studyo-sayfa .speech-result-panel > * { min-width: 0; }
.studyo-sayfa .speech-panel, .studyo-sayfa .speech-result-panel { min-width: 0; overflow-wrap: anywhere; }
.studyo-sayfa .speech-label { min-width: 0; max-width: 100%; }
.studyo-sayfa select.m3-input { width: 100%; max-width: 100%; min-width: 0; text-overflow: ellipsis; }
.studyo-sayfa .m3-btn { max-width: 100%; }
.studyo-sayfa .m3-btn > span { overflow: hidden; text-overflow: ellipsis; }
.studyo-sayfa .speech-controls-row { flex-wrap: wrap; }
.studyo-sayfa .speech-controls-row > .speech-label { min-width: 150px; }
.studyo-sayfa .speech-panel-header { flex-wrap: wrap; }
.studyo-sayfa .m3-segmented-button { flex-wrap: wrap; gap: 2px; }
.studyo-sayfa .m3-segment-item { min-width: 0; white-space: normal; padding: 8px 6px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
.studyo-sayfa .studyo-ilham .m3-btn { white-space: normal; height: auto; min-height: 30px; line-height: 1.25; text-align: left; }
.studyo-sayfa .studyo-model-alt { font-size: 0.74rem; font-weight: 400; color: var(--md-sys-color-on-surface-variant); line-height: 1.4; overflow-wrap: anywhere; }
.studyo-kurulum { min-width: 0; overflow-wrap: anywhere; }
.studyo-kurulum .m3-btn { white-space: nowrap; max-width: 100%; }
`;
export function StudyoStilleri() {
  return <style>{STUDYO_CSS}</style>;
}

const kutu = (renk) => ({
  marginTop: "8px",
  padding: "10px 12px",
  borderRadius: "10px",
  fontSize: "0.8rem",
  lineHeight: 1.45,
  border: `1px solid color-mix(in srgb, ${renk} 35%, transparent)`,
  background: `color-mix(in srgb, ${renk} 10%, transparent)`,
  color: "var(--md-sys-color-on-surface)",
  display: "flex",
  gap: "8px",
  alignItems: "flex-start",
  minWidth: 0,
  overflowWrap: "anywhere",
});
// Global .progress-spinner 44 px'lik halka çizdiği için küçük dönen simge ayrı tanımlandı
export function Donen({ size = 14 }) {
  return <LoaderCircle size={size} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />;
}

export const RENK = {
  hata: "var(--md-sys-color-error, #ef4444)",
  uyari: "var(--md-sys-color-warning, #f59e0b)",
  tamam: "var(--md-sys-color-success, #10b981)",
  bilgi: "var(--md-sys-color-primary, #6366f1)",
};

export function DonanimRozeti({ donanim }) {
  if (!donanim) return <span className="status-chip"><Donen size={12} /> Donanım okunuyor...</span>;
  const gpu = donanim.cuda === true
    ? `${donanim.cudaGpu || "NVIDIA"} (${donanim.vramGb} GB VRAM)`
    : donanim.cuda === false
      ? `CUDA yok${donanim.gpuAdlari?.length ? ` — ${donanim.gpuAdlari.join(", ")}` : ""}`
      : `GPU bilinmiyor (PyTorch kurulunca denetlenir)${donanim.gpuAdlari?.length ? ` — ${donanim.gpuAdlari.join(", ")}` : ""}`;
  return (
    <span className="status-chip" title={donanim.cpuAdi} style={{ maxWidth: "100%", display: "inline-block", whiteSpace: "normal", lineHeight: 1.45, overflowWrap: "anywhere" }}>
      <Cpu size={12} style={{ verticalAlign: "-1px", marginRight: "4px" }} />{donanim.cpuCekirdek} iş parçacığı • {Math.round(donanim.ramGb)} GB RAM • {gpu}
    </span>
  );
}

// --------------------------------------------------------------------------
// "Bu bilgisayarda: …" satırı. Stüdyo modellerinde metin sunucudan gelir (model.buBilgisayarda, studyo.cjs);
// görsel / metin / konuşma / seslendirme kütüphanesi kartlarında /api/hardware bilgisinden burada hesaplanır.
// Süreler kaba tahmindir; baz: i5-7200U (4 iş parçacığı) ölçümleri — SD 1.5 512x512 ~6 sn/adım,
// Qwen2.5 3B Q4_K_M ~5 token/sn, MusicGen Small 15 sn müzik 6 dk 19 sn.
// --------------------------------------------------------------------------
const UYGUNLUK_RENGI = {
  uygun: "var(--md-sys-color-success, #10b981)",
  yavas: "var(--md-sys-color-warning, #b7791f)",
  onerilmez: "var(--md-sys-color-error, #ef4444)",
};

// Tümleşik ekran kartı mı (paylaşılan bellek ayrı VRAM sayılmaz). ModelManager / serve.cjs ile aynı kural.
export const tumlesikGpuMu = (ad) => {
  const s = String(ad || "").toLowerCase();
  if (!s) return false;
  if (/intel.*arc.*\b[ab]\d{3}/.test(s)) return false;
  return /intel.*(hd|uhd|iris)|intel\(r\) graphics|intel.*arc\(tm\) graphics|intel.*arc graphics|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|radeon\(tm\) vega|radeon r\d graphics|radeon \d{3}m|adreno|mali-/.test(s);
};

// "6.6 GB", "2,4 GB", "491 MB", "~29 GB (…)" -> GB
export function boyutGb(metin) {
  const m = String(metin || "").replace(",", ".").match(/([\d.]+)\s*(GB|MB|KB)/i);
  if (!m) return 0;
  const n = Number(m[1]) || 0;
  return m[2].toUpperCase() === "GB" ? n : m[2].toUpperCase() === "MB" ? n / 1024 : n / 1048576;
}

function donanimOzeti(specs) {
  const ram = Number(specs?.ram_total_gb) || 0;
  const gpuAdi = String(specs?.gpu_name || "");
  const tumlesik = specs?.gpu_integrated === true || tumlesikGpuMu(gpuAdi);
  const vram = tumlesik ? 0 : (Number(specs?.gpu_dedicated_vram_gb ?? specs?.gpu_vram_gb) || 0);
  const is = Number(specs?.cpu_cores_logical) || Number(specs?.cpu_cores_physical) * 2 || 4;
  const hiz = Math.max(0.6, Math.min(3, Math.pow(is / 4, 0.7))); // 4 iş parçacığına göre kaba hız katsayısı
  return { ram, vram, gpuAdi, tumlesik, hiz };
}

const sureYazi = (sn) => (sn < 90 ? `${Math.max(5, Math.round(sn / 5) * 5)} sn` : sn < 5400 ? `${Math.max(2, Math.round(sn / 60))} dk` : `${String(Math.round(sn / 1800) / 2).replace(".", ",")} saat`);
function sureAraligi(enAz, enCok) {
  const a = sureYazi(enAz), b = sureYazi(enCok);
  if (a === b) return `~${a}`;
  const [sa, ba] = a.split(" "), [sb, bb] = b.split(" ");
  return ba === bb ? `~${sa}-${sb} ${bb}` : `~${a} - ${b}`;
}
const aralik = (x, a = 0.75, b = 1.25) => {
  const lo = Math.max(1, Math.round(x * a)), hi = Math.max(lo + 1, Math.round(x * b));
  return `~${lo}-${hi}`;
};

// Kütüphane kartı için { metin, uygunluk } ya da null. tur: "image" | "text" | "speech" | "tts"
export function kutuphaneDonanimNotu(model, tur, specs) {
  if (!model || !specs || !Number(specs.ram_total_gb)) return null;
  const fmt = `${model.format || ""} ${model.filename || ""}`;
  if (/openvino|coreml/i.test(fmt)) return null; // NPU testleri ayrı donanıma bağlı
  const { ram, vram, gpuAdi, tumlesik, hiz } = donanimOzeti(specs);
  const gb = boyutGb(model.size && !/bilinmiyor|unknown/i.test(model.size) ? model.size : model.approxSize);
  const ekranYok = tumlesik ? `Ayrı ekran kartı yok (${gpuAdi.replace(/\(R\)|\(TM\)/gi, "").trim()} tümleşik)` : "Ekran kartı yok";
  const ramMetni = (gereken) => `${Math.round(ram)} GB RAM yetmeyebilir (≈${gereken} GB gerekir), bellek dolarsa işlem durdurulur.`;

  if (tur === "text") {
    if (!gb) return null;
    // Gemma 4 E2B/E4B dosyasının bir kısmı katman başı gömme tablosudur; hesap yükü dosya boyutundan küçüktür
    const e = String(model.filename || model.name || "").match(/gemma-?4.*?e(\d)b/i);
    const etkin = e ? Number(e[1]) * 0.65 : gb;
    const gerekenRam = Math.max(Number(model.minRamGb) || 0, Math.ceil(gb + 3));
    if (ram < gerekenRam * 0.9) return { metin: ramMetni(gerekenRam), uygunluk: "onerilmez" };
    if (vram >= gb + 1) return { metin: `Uygun. ${vram} GB ekran belleğine sığar, hızlı yanıt verir.`, uygunluk: "uygun" };
    const tps = (9.5 / etkin) * hiz;
    const kismen = vram > 1 ? ` (bir kısmı ${vram} GB ekran kartına taşınabilir)` : "";
    if (tps < 3) return { metin: `${vram > 1 ? "Ekran belleği yetmez" : ekranYok}; işlemcide ${aralik(tps, 0.7, 1.3)} token/sn${kismen}, yanıtlar yavaş akar.`, uygunluk: "yavas" };
    return { metin: `Uygun${vram > 1 ? "" : `, işlemcide çalışır`}: ${aralik(tps)} token/sn${kismen}.`, uygunluk: "uygun" };
  }

  if (tur === "image") {
    if (!gb) return null;
    const xl = gb > 4 || /xl/i.test(`${model.name} ${model.filename}`);
    const hizli = /lightning|turbo|lcm|hyper/i.test(`${model.name} ${model.filename}`);
    const gerekenRam = xl ? 12 : 8;
    const gerekenVram = xl ? 8 : 4;
    if (vram >= gerekenVram) return { metin: `Uygun. ${vram} GB ekran kartında bir görsel birkaç saniye-yarım dakika.`, uygunluk: "uygun" };
    if (ram < gerekenRam * 0.9) return { metin: `${ekranYok}; ${ramMetni(gerekenRam)}`, uygunluk: "onerilmez" };
    // SD 1.5 512x512 ~6,2 sn/adım (ölçüm); SDXL 1024x1024 adım başına ~10-12 kat
    const adim = hizli ? 4 : xl ? 25 : 20;
    const sn = (xl ? 70 : 6.2) * adim / hiz + (xl ? 60 : 20);
    const ayar = `${xl ? "1024x1024" : "512x512"}, ${adim} adım`;
    return { metin: `${ekranYok}; işlemcide bir görsel (${ayar}) ${sureAraligi(sn * 0.8, sn * 1.4)} sürer.`, uygunluk: xl ? "yavas" : "uygun" };
  }

  if (tur === "speech") {
    const ad = `${model.name || ""} ${model.filename || ""}`.toLowerCase();
    // 1 dakikalık sesi çözme süresi (sn), 4 iş parçacığında kaba değer
    const taban = /large.*turbo|turbo/.test(ad) ? 60 : /large/.test(ad) ? 180 : /medium/.test(ad) ? 90 : /small/.test(ad) ? 30 : /base/.test(ad) ? 10 : /tiny/.test(ad) ? 5 : gb ? Math.max(8, gb * 60) : 0;
    if (!taban) return null;
    if (ram < Math.ceil(gb * 2 + 2) * 0.9) return { metin: ramMetni(Math.ceil(gb * 2 + 2)), uygunluk: "onerilmez" };
    const sn = vram >= gb + 1 ? taban / 8 : taban / hiz;
    return { metin: `${sn > 120 ? "Yavaş" : "Uygun"}: 1 dk konuşma ${vram >= gb + 1 ? "ekran kartında" : "işlemcide"} ${sureAraligi(sn * 0.7, sn * 1.4)} içinde yazıya dökülür.`, uygunluk: sn > 120 ? "yavas" : "uygun" };
  }

  if (tur === "tts") {
    const agir = (model.recommendedTiers || []).length === 1 && model.recommendedTiers[0] === "High";
    if (agir && vram < 6) return { metin: `${ekranYok}; işlemcide çok yavaş olabilir (bir cümle dakikalar sürebilir).`, uygunluk: "yavas" };
    if (model.minRamGb && ram < model.minRamGb * 0.9) return { metin: ramMetni(model.minRamGb), uygunluk: "onerilmez" };
    return { metin: `Uygun; ${vram >= 6 ? "ekran kartında" : "işlemcide"} bir cümle birkaç saniyede seslendirilir.`, uygunluk: "uygun" };
  }
  return null;
}

// Kart içinde "Bu bilgisayarda: …" satırı
export function BuBilgisayardaSatiri({ not, style }) {
  if (!not || !not.metin) return null;
  const renk = UYGUNLUK_RENGI[not.uygunluk] || "var(--md-sys-color-on-surface-variant)";
  return (
    <p style={{ fontSize: "0.76rem", lineHeight: 1.4, margin: 0, color: "var(--md-sys-color-on-surface)", overflowWrap: "anywhere", minWidth: 0, ...style }}>
      <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: renk, marginRight: "6px", verticalAlign: "middle" }} />
      <strong>Bu bilgisayarda:</strong> {not.metin}
    </p>
  );
}

export function UyariKutusu({ uyari }) {
  if (!uyari) return null;
  const renk = uyari.seviye === "onerilmez" ? RENK.hata : RENK.uyari;
  return (
    <div style={kutu(renk)}>
      <TriangleAlert size={15} style={{ flexShrink: 0, marginTop: "2px", color: renk }} />
      <div style={{ minWidth: 0 }}>
        <strong>{uyari.baslik}:</strong> {uyari.neden}
        {uyari.tahmin && <div style={{ opacity: 0.85, marginTop: "2px" }}>{uyari.tahmin}</div>}
        {uyari.seviye === "onerilmez" && <div style={{ opacity: 0.85, marginTop: "2px" }}>Yine de deneyebilirsiniz; bellek yetmez ya da süre aşılırsa işlem güvenle durdurulur, uygulama etkilenmez.</div>}
      </div>
    </div>
  );
}

export function BilgiKutusu({ renk = RENK.bilgi, children, ikon }) {
  return (
    <div style={kutu(renk)}>
      {ikon || <Info size={15} style={{ flexShrink: 0, marginTop: "2px", color: renk }} />}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

// Ortak kurulum durumu deposu: Müzik, Video stüdyoları ve Model Yöneticisi aynı kuyruğu (/api/studyo/kurulum)
// tek bir yoklayıcıyla izler. Bir yerde başlatılan kurulumun ilerlemesi diğer sayfalarda da görünür.
const depo = { veri: null, dinleyiciler: new Set(), zamanlayici: null, hizli: 0, suruyor: false };
function depoYayinla() { for (const f of depo.dinleyiciler) { try { f(depo.veri); } catch (_) {} } }
async function depoYenile() {
  if (depo.suruyor) return;
  depo.suruyor = true;
  try {
    depo.veri = await studyoKurulumDurumu();
    depoYayinla();
  } catch (_) {}
  depo.suruyor = false;
}
function depoPlanla() {
  clearTimeout(depo.zamanlayici);
  depo.zamanlayici = null;
  if (!depo.dinleyiciler.size) return;
  const aktif = kurulumOzeti(depo.veri).aktif || Date.now() < depo.hizli;
  const gizli = typeof document !== "undefined" && document.hidden;
  depo.zamanlayici = setTimeout(async () => { await depoYenile(); depoPlanla(); }, aktif ? 1500 : gizli ? 15000 : 5000);
}
function depoAbone(f) {
  depo.dinleyiciler.add(f);
  if (depo.veri) f(depo.veri);
  if (depo.dinleyiciler.size === 1) depoYenile().then(depoPlanla);
  return () => { depo.dinleyiciler.delete(f); if (!depo.dinleyiciler.size) { clearTimeout(depo.zamanlayici); depo.zamanlayici = null; } };
}
export function kurulumDurumunuTazele() {
  depo.hizli = Date.now() + 8000; // kurulum yeni başladıysa birkaç saniye hızlı yokla
  depoYenile().then(depoPlanla);
}

// Kurulum durumunu izler; bir kurulum bitince onBitti çağrılır
export function useKurulumTakibi(onBitti) {
  const [kurulum, setKurulum] = useState(depo.veri);
  const oncekiAktif = useRef(kurulumOzeti(depo.veri).aktif);
  const bittiRef = useRef(onBitti);
  bittiRef.current = onBitti;
  useEffect(() => depoAbone((k) => {
    setKurulum(k);
    const aktif = kurulumOzeti(k).aktif;
    if (oncekiAktif.current && !aktif) bittiRef.current?.();
    oncekiAktif.current = aktif;
  }), []);
  return { kurulum, ozet: kurulumOzeti(kurulum), baslat: () => { oncekiAktif.current = true; kurulumDurumunuTazele(); } };
}

// Donanım "önerilmez" dediği modelde kurulum düğmesi yerine gösterilen kutu
export function GizliKurulumKutusu({ model, onGoster }) {
  return (
    <div className="studyo-kurulum" style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" }}>
      <div style={{ fontSize: "0.76rem", opacity: 0.9, lineHeight: 1.45 }}>
        Bu model bu bilgisayar için önerilmediğinden kurulum düğmesi gizlendi
        {model?.approxSize ? ` (indirme: ${kisaBoyut(model.approxSize)})` : ""}. Kurup denemek isterseniz düğmeyi açabilirsiniz.
      </div>
      <button type="button" className="m3-btn m3-btn-outlined" onClick={onGoster} style={{ height: "30px", padding: "0 12px", fontSize: "0.76rem" }}>
        <Eye size={13} /> <span>Yine de göster</span>
      </button>
    </div>
  );
}

// Kurulum onayı + başlatma (stüdyo sayfaları ve Model Yöneticisi ortak kullanır)
export async function studyoKurulumBaslat(model, { showAlert, showConfirm, onBasladi } = {}) {
  const uyari = model.uyari ? `\n\n${model.uyari.baslik}: ${model.uyari.neden}${model.uyari.tahmin ? `\n${model.uyari.tahmin}` : ""}` : "";
  const ok = await showConfirm?.({
    title: "Model indirilsin mi?",
    message: `"${model.name}" (${model.approxSize}) Hugging Face'ten sabit sürümüyle indirilecek, dosya özetleri doğrulanacak; gerekirse Python paketleri de kurulacak.\n\nLisans: ${model.lisans || "model sayfasına bakın"}${uyari}`,
    confirmLabel: "İndir ve kur",
    cancelLabel: "Vazgeç",
    danger: Boolean(model.uyari && model.uyari.seviye === "onerilmez"),
  });
  if (!ok) return false;
  try {
    await studyoModelKur(model.id);
    kurulumDurumunuTazele();
    onBasladi?.();
    return true;
  } catch (err) {
    showAlert?.({ title: "Kurulum başlatılamadı", message: err.message || String(err), danger: true });
    return false;
  }
}

// Model durum kutusu: hazır / kurulu değil (İndir ve kur) / bu sürümde indirilemez
// Düğme metni kısa tutulur; boyut ve ayrıntılar alt satırda, sarılarak gösterilir (dar ekranda taşmaz).
export function ModelKurulumKutusu({ model, takip, showAlert, showConfirm, ekNot }) {
  const [gosterilen, setGosterilen] = useState({}); // model kimliği -> "Yine de göster" açık mı
  if (!model) return <div className="text-progress" style={{ marginTop: "8px" }}><Donen size={14} /> Model durumu ve donanım okunuyor (ilk açılışta 10-30 sn sürebilir)...</div>;
  const { ozet, kurulum } = takip;
  if (model.installed) {
    return (
      <div className="studyo-kurulum" style={kutu(RENK.tamam)}>
        <CircleCheck size={15} style={{ flexShrink: 0, marginTop: "2px", color: RENK.tamam }} />
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <span><strong>Hazır:</strong> {model.name} kurulu ve kullanıma hazır.</span>
          <BuBilgisayardaSatiri not={model.buBilgisayarda} />
        </div>
      </div>
    );
  }
  if (!model.kurulabilir) {
    return (
      <BilgiKutusu renk={RENK.uyari}>
        <strong>Bu sürümde indirilemez.</strong> {model.notes}
        <BuBilgisayardaSatiri not={model.buBilgisayarda} style={{ marginTop: "4px" }} />
      </BilgiKutusu>
    );
  }
  const buModel = modelKuruluyorMu(model, kurulum);
  const gizli = (model.kurulumGizli ?? model.uyari?.seviye === "onerilmez") && !gosterilen[model.id] && !buModel;
  const kur = () => studyoKurulumBaslat(model, { showAlert, showConfirm, onBasladi: takip.baslat });
  return (
    <div className="studyo-kurulum" style={{ ...kutu(RENK.uyari), flexDirection: "column", gap: "6px", alignItems: "stretch" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
        <TriangleAlert size={15} style={{ color: RENK.uyari, flexShrink: 0 }} /> Model kurulu değil
      </span>
      <div style={{ fontSize: "0.76rem", opacity: 0.85 }}>
        İndirme boyutu: {model.approxSize || "-"}{model.format ? ` • ${model.format}` : ""}
      </div>
      <BuBilgisayardaSatiri not={model.buBilgisayarda} />
      {gizli ? (
        <GizliKurulumKutusu model={model} onGoster={() => setGosterilen((g) => ({ ...g, [model.id]: true }))} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" className="m3-btn m3-btn-tonal" onClick={kur} disabled={ozet.aktif} title={`${model.name} — ${model.approxSize || ""}`}>
            {ozet.aktif ? <Donen size={14} /> : <Download size={14} />}
            <span>{buModel ? "Kuruluyor..." : ozet.aktif ? "Başka kurulum sürüyor" : "İndir ve kur"}</span>
          </button>
          {gosterilen[model.id] && !ozet.aktif && (
            <button type="button" className="m3-btn m3-btn-outlined" onClick={() => setGosterilen((g) => ({ ...g, [model.id]: false }))} style={{ height: "30px", padding: "0 10px", fontSize: "0.74rem" }}>
              <EyeOff size={13} /> <span>Gizle</span>
            </button>
          )}
        </div>
      )}
      {ekNot && <div style={{ opacity: 0.85 }}>{ekNot}</div>}
      {model.ozellikKurulu === false && !ozet.aktif && !gizli && <div style={{ opacity: 0.85 }}>Python paketleri de kurulacak (yalnızca hazır paketler, sabit sürümler).</div>}
      {ozet.aktif && (
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: "0.76rem", opacity: 0.9, marginBottom: "4px" }}>{ozet.metin}</div>
          <IlerlemeCubugu yuzde={ozet.yuzde} />
        </div>
      )}
      {!ozet.aktif && ozet.hata && <div style={{ color: RENK.hata }}>Son kurulum hatası: {ozet.hata}</div>}
    </div>
  );
}

export function IlerlemeCubugu({ yuzde }) {
  const belirsiz = yuzde == null;
  return (
    <div style={{ height: "6px", width: "100%", background: "color-mix(in srgb, var(--md-sys-color-outline) 20%, transparent)", borderRadius: "99px", overflow: "hidden" }}>
      <div style={{
        height: "100%",
        width: belirsiz ? "35%" : `${Math.max(2, Math.min(100, yuzde))}%`,
        background: "linear-gradient(90deg, var(--md-sys-color-primary), #06b6d4)",
        transition: "width 0.4s ease",
        animation: belirsiz ? "studyo-kayan 1.4s ease-in-out infinite" : "none",
      }} />
      <style>{"@keyframes studyo-kayan{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    </div>
  );
}

// İş ilerleme kartı (V2'nin "Canlı İlerleme Çubuğu ve Durum Kartı")
export function IlerlemeKarti({ is, baslik, onIptal }) {
  if (!is || !["sirada", "calisiyor"].includes(is.durum)) return null;
  const gecen = is.baslangic ? Math.round((Date.now() - is.baslangic) / 1000) : 0;
  const sure = gecen >= 60 ? `${Math.floor(gecen / 60)} dk ${gecen % 60} sn` : `${gecen} sn`;
  return (
    <div className="m3-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <strong style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.88rem" }}>
          <Donen size={16} /> {baslik}
        </strong>
        <span style={{ fontWeight: 800, fontFamily: "ui-monospace, monospace", color: RENK.tamam }}>%{is.ilerleme || 0}</span>
      </div>
      <IlerlemeCubugu yuzde={is.durum === "sirada" ? null : is.ilerleme} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", fontSize: "0.76rem", color: "var(--md-sys-color-on-surface-variant)" }}>
        <span>{is.durum === "sirada" ? `Sırada bekliyor (${is.sira}.)` : is.asama}</span>
        <span>{is.durum === "calisiyor" ? `Geçen süre: ${sure}` : ""}</span>
      </div>
      {onIptal && (
        <div>
          <button type="button" className="m3-btn m3-btn-error" onClick={onIptal}>
            <Square size={13} /> <span>İptal et</span>
          </button>
        </div>
      )}
    </div>
  );
}

// İlk kurulum sihirbazı: uygulama ilk açıldığında (app/config/ilk-kurulum.json yoksa) bir kez görünür.
// Ayarlar'daki "İlk kurulum sihirbazını yeniden aç" düğmesi window'a "ilk-kurulum-ac" olayı gönderir;
// olayın detail.adim değeri "yapay-zeka" ise yalnızca "Yapay zekânız" adımı açılır (Ayarlar › "Yapay zekânızı düzenle").
// "Yapay zekânız" adımı sohbetin kullandığı ayarı yazar: textSettings.systemPrompt (+ textSettings.assistantName);
// App.jsx bunu localStorage "textSettings"e kaydeder, sohbet bir sonraki mesajda yeni metni kullanır.
// "Önerilen modeller" adımı: her kategoride denenmiş varsayılan set önceden seçili gelir (sunucunun "secili" alanı),
// alternatifler altında seçilmemiş listelenir ("Önerilen (denenmiş)" / "Alternatif" rozetleri); "Denenmiş sete dön" seçimi
// sıfırlar. Zayıf bilgisayarda yalnızca güçlü donanıma uygun ağır seçenekler (sunucunun "gizli" alanı, ör. Wan 2.1)
// "Yine de göster" düğmesinin arkasında durur. Müzik/efekt/video varsayılanları "isteğe bağlı" notuyla gelir. Toplam indirme, ortak Python/PyTorch
// bileşeni bir kez sayılarak hesaplanır. Kurulum sunucuda uygulamanın mevcut indiricileriyle yapılır.
// Sunucu tarafı: scripts/setup/ilk-kurulum-sunucu.cjs (/api/ilk-kurulum/*). Sunucu yamalanmamışsa sihirbaz sessizce görünmez.
import { SorumlulukNotu } from "./AgKalkani";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Cpu, Download, Check, X, ChevronRight, ChevronLeft, AlertTriangle, Music, Video,
  Volume2, Cloud, Mic, HardDrive, MemoryStick, Monitor, Loader2, Info, MessageSquare, Bot, RotateCcw,
  Image as ImageIcon, AudioLines, Zap, ShieldCheck,
} from "lucide-react";

const ADIMLAR = ["Hoş geldiniz", "Bilgisayarınız", "Önerilen modeller", "Kurulum", "Yapay zekânız", "İsteğe bağlı", "Hazır"];
const A = { HOS: 0, BILGISAYAR: 1, MODELLER: 2, KURULUM: 3, YAPAY_ZEKA: 4, OPSIYONEL: 5, HAZIR: 6 };

// --- Yapay zekânın adı ve sistem mesajı ---------------------------------------------------------
export const VARSAYILAN_YZ_ADI = "Vega";
// Önerilen sistem mesajı. Ad yalnızca ilk cümlede geçer ("Senin adın X."), ad alanı bu cümleyi değiştirir.
// Araçların ayrıntılı kullanımı (web araması, görsel/müzik/video, hesap, saat) sohbet ve sunucu tarafından ayrıca eklenir.
export function onerilenSistemMesaji(ad) {
  const a = adTemizle(ad) || VARSAYILAN_YZ_ADI;
  return [
    `Senin adın ${a}. Bu bilgisayarda çevrimdışı çalışan, yardımsever bir yapay zekâ asistanısın.`,
    "Kullanıcı hangi dilde yazarsa o dilde yanıt ver; Türkçeyi doğal ve doğru kullan.",
    "Yanıtlarını açık ve anlaşılır tut, gereksiz uzatma. Bilmediğin bir şeyi uydurma; emin değilsen bunu söyle.",
    "Yapabildiklerin: sohbet ve yazma; kullanıcı Web düğmesini açtığında internette arama; hesap yapma ve saati/tarihi söyleme;",
    "bu bilgisayardaki modellerle görsel, müzik, ses efekti ve kısa video üretme; sesli sohbet (kullanıcının konuşmasını yazıya",
    "çevirip yanıtlarını sesli okuyabilirsin). Bunların hepsi bu bilgisayarda çalışır; kullanıcının verileri bilgisayarından çıkmaz.",
  ].join(" ");
}
// Uygulamanın eski varsayılanları: bunlar "kullanıcının kendi metni" sayılmaz, önerilen metinle değiştirilebilir
const ESKI_VARSAYILAN_ISTEMLER = [
  "You are a helpful local AI assistant.",
  "Yardımsever bir yerel yapay zekâ asistanısın. Kullanıcı hangi dilde yazarsa o dilde yanıt ver.",
  "Senin adın Vega. Bu bilgisayarda çevrimdışı çalışan, yardımsever bir yapay zekâ asistanısın. Kullanıcı hangi dilde yazarsa o dilde yanıt ver.",
];
function adTemizle(ad) {
  // Nokta ve satır sonu ad cümlesini bozar; uzunluk sınırlı
  return String(ad || "").replace(/[.\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}
const AD_CUMLESI = /Senin adın [^.\n]{1,60}\./;
function adiIstemeYaz(istem, ad) {
  const a = adTemizle(ad) || VARSAYILAN_YZ_ADI;
  const metin = String(istem || "");
  if (AD_CUMLESI.test(metin)) return metin.replace(AD_CUMLESI, `Senin adın ${a}.`);
  return `Senin adın ${a}. ${metin}`.trim();
}
function varsayilanMi(istem, ad) {
  const s = String(istem || "").trim();
  return !s || ESKI_VARSAYILAN_ISTEMLER.includes(s) || s === onerilenSistemMesaji(ad).trim() || s === onerilenSistemMesaji(VARSAYILAN_YZ_ADI).trim();
}
const OPSIYONEL_SIMGE = { muzik: Music, video: Video, sesler: Volume2, stt: Mic, bulut: Cloud, modeller: HardDrive };
const KATEGORI_SIMGE = { sohbet: MessageSquare, stt: Mic, tts: Volume2, gorsel: ImageIcon, muzik: Music, efekt: AudioLines, video: Video };

function boyutYaz(bayt) {
  const b = Number(bayt) || 0;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.round(b / 1024))} KB`;
}

async function istek(yol, govde) {
  const r = await fetch(yol, govde === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(govde),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `İstek başarısız (${r.status})`);
  return j;
}

const STIL = `
.iks-arka { position: fixed; inset: 0; z-index: 990; display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(8, 12, 24, 0.66); backdrop-filter: blur(4px) saturate(0.86); }
.iks-pencere { width: min(760px, 100%); max-height: calc(100vh - 40px); display: flex; flex-direction: column;
  background: color-mix(in srgb, var(--md-sys-color-surface) 96%, white 4%); color: var(--md-sys-color-on-surface);
  border: 1px solid color-mix(in srgb, var(--md-sys-color-outline) 55%, transparent); border-radius: var(--md-shape-corner-large, 20px);
  box-shadow: 0 22px 60px rgba(0,0,0,.42); overflow: hidden; }
.iks-ust { display: flex; align-items: center; gap: 12px; padding: 18px 22px 10px; }
.iks-ust h2 { margin: 0; font-size: 1.15rem; font-weight: 800; flex: 1; }
.iks-kapat { background: none; border: none; color: var(--md-sys-color-on-surface-variant); cursor: pointer; padding: 6px; border-radius: 8px; }
.iks-kapat:hover { background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent); }
.iks-adimlar { display: flex; gap: 6px; padding: 0 22px 12px; flex-wrap: wrap; }
.iks-adim { font-size: .74rem; padding: 3px 9px; border-radius: 999px; color: var(--md-sys-color-on-surface-variant);
  background: color-mix(in srgb, var(--md-sys-color-surface-variant) 60%, transparent); }
.iks-adim.etkin { background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); font-weight: 700; }
.iks-adim.bitti { color: var(--md-sys-color-primary); }
.iks-govde { padding: 6px 22px 16px; overflow-y: auto; flex: 1; font-size: .92rem; line-height: 1.5; }
.iks-govde p { margin: 0 0 10px; color: var(--md-sys-color-on-surface-variant); }
.iks-alt { display: flex; align-items: center; gap: 10px; padding: 14px 22px 18px; border-top: 1px solid color-mix(in srgb, var(--md-sys-color-outline) 30%, transparent); flex-wrap: wrap; }
.iks-alt .bosluk { flex: 1; }
.iks-kart { border: 1px solid color-mix(in srgb, var(--md-sys-color-outline) 35%, transparent); border-radius: 14px; padding: 12px 14px; margin-bottom: 10px;
  background: color-mix(in srgb, var(--md-sys-color-surface-variant) 30%, transparent); }
.iks-izgara { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-bottom: 10px; }
.iks-bilgi { display: flex; gap: 10px; align-items: flex-start; }
.iks-bilgi svg { flex-shrink: 0; margin-top: 2px; color: var(--md-sys-color-primary); }
.iks-etiket { font-size: .76rem; color: var(--md-sys-color-on-surface-variant); }
.iks-deger { font-weight: 700; word-break: break-word; }
.iks-uyari { display: flex; gap: 8px; align-items: flex-start; font-size: .84rem; margin-top: 6px; color: var(--md-sys-color-warning, #c98a00); }
.iks-uyari svg { flex-shrink: 0; margin-top: 2px; }
.iks-not { display: flex; gap: 8px; align-items: flex-start; font-size: .84rem; color: var(--md-sys-color-on-surface-variant); }
.iks-grup { font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--md-sys-color-primary); margin: 14px 0 6px; }
.iks-model { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
.iks-model input { margin-top: 4px; width: 18px; height: 18px; accent-color: var(--md-sys-color-primary); flex-shrink: 0; }
.iks-model.pasif { cursor: default; opacity: .62; }
.iks-model-ust { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.iks-model-ad { font-weight: 700; }
.iks-rozet { font-size: .72rem; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--md-sys-color-primary) 14%, transparent); color: var(--md-sys-color-primary); }
.iks-rozet.yesil { background: color-mix(in srgb, var(--md-sys-color-success, #2e7d32) 16%, transparent); color: var(--md-sys-color-success, #2e7d32); }
.iks-toplam { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-weight: 700; padding: 10px 2px 0; }
.iks-cubuk { height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--md-sys-color-outline) 25%, transparent); overflow: hidden; margin-top: 8px; }
.iks-cubuk > div { height: 100%; background: var(--md-sys-color-primary); transition: width .4s ease; }
.iks-durum { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed color-mix(in srgb, var(--md-sys-color-outline) 25%, transparent); }
.iks-durum:last-child { border-bottom: none; }
.iks-durum .ad { flex: 1; }
.iks-don { animation: spin 1s linear infinite; }
.iks-hata { color: var(--md-sys-color-error); font-size: .82rem; }
.iks-baglanti { background: none; border: none; padding: 0; color: var(--md-sys-color-primary); cursor: pointer; font: inherit; font-weight: 700; }
.iks-alan { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.iks-alan label { font-size: .8rem; font-weight: 700; color: var(--md-sys-color-on-surface); }
.iks-girdi { width: 100%; box-sizing: border-box; font: inherit; font-size: .9rem; color: var(--md-sys-color-on-surface);
  background: color-mix(in srgb, var(--md-sys-color-surface-variant) 40%, transparent);
  border: 1px solid color-mix(in srgb, var(--md-sys-color-outline) 55%, transparent); border-radius: 10px; padding: 9px 11px; }
.iks-girdi:focus { outline: 2px solid color-mix(in srgb, var(--md-sys-color-primary) 70%, transparent); outline-offset: 1px; border-color: transparent; }
textarea.iks-girdi { resize: vertical; min-height: 150px; line-height: 1.45; }
.iks-satir { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.iks-kucuk-btn { display: inline-flex; align-items: center; gap: 6px; background: none; border: 1px solid color-mix(in srgb, var(--md-sys-color-outline) 45%, transparent);
  color: var(--md-sys-color-primary); border-radius: 999px; padding: 4px 11px; font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; }
.iks-kucuk-btn:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent); }
.iks-basari { color: var(--md-sys-color-success, #2e7d32); font-size: .84rem; display: inline-flex; gap: 6px; align-items: center; }
.iks-kategori { border: 1px solid color-mix(in srgb, var(--md-sys-color-outline) 35%, transparent); border-radius: 16px; padding: 10px 12px 4px; margin-bottom: 12px; }
.iks-kategori-baslik { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: .9rem; margin: 2px 0 8px; }
.iks-kategori-baslik svg { color: var(--md-sys-color-primary); flex-shrink: 0; }
.iks-kategori-baslik .iks-etiket { font-weight: 500; margin-left: auto; }
.iks-alternatifler { margin: 0 0 8px; }
.iks-alternatifler > summary { cursor: pointer; font-size: .8rem; font-weight: 700; color: var(--md-sys-color-on-surface-variant); padding: 4px 2px; list-style-position: inside; }
.iks-alternatifler[open] > summary { margin-bottom: 6px; }
.iks-kart.iks-model.alt { padding: 8px 12px; background: transparent; }
.iks-kart.iks-model.alt .iks-model-ad { font-weight: 600; }
.iks-rozet.denenmis { background: color-mix(in srgb, var(--md-sys-color-success, #2e7d32) 16%, transparent); color: var(--md-sys-color-success, #2e7d32); font-weight: 700; }
.iks-rozet.guclu { background: color-mix(in srgb, var(--md-sys-color-tertiary, #7b5ea7) 18%, transparent); color: var(--md-sys-color-tertiary, #7b5ea7); font-weight: 700; display: inline-flex; gap: 3px; align-items: center; }
.iks-rozet.alternatif { background: color-mix(in srgb, var(--md-sys-color-outline) 16%, transparent); color: var(--md-sys-color-on-surface-variant); }
.iks-rozet.istege { background: color-mix(in srgb, var(--md-sys-color-secondary, #5b6477) 14%, transparent); color: var(--md-sys-color-on-surface-variant); }
.iks-gizli-satir { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .8rem; color: var(--md-sys-color-on-surface-variant); padding: 2px 2px 8px; }
.iks-rozet.agir { background: color-mix(in srgb, var(--md-sys-color-warning, #c98a00) 18%, transparent); color: var(--md-sys-color-warning, #c98a00); }
.iks-bubilgisayar { font-size: .8rem; color: var(--md-sys-color-on-surface-variant); margin-top: 3px; }
.iks-bubilgisayar b { color: var(--md-sys-color-on-surface); font-weight: 700; }
.iks-dogrulama { display: inline-flex; gap: 4px; align-items: center; }
.iks-ozet { display: flex; gap: 10px; align-items: flex-start; border-radius: 14px; padding: 10px 14px; margin-bottom: 12px;
  background: color-mix(in srgb, var(--md-sys-color-primary) 9%, transparent); border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 30%, transparent); }
.iks-ozet svg { flex-shrink: 0; margin-top: 2px; color: var(--md-sys-color-primary); }
.iks-ozet .iks-kucuk-btn { margin-left: auto; flex-shrink: 0; }
.iks-toplam-kart { position: sticky; bottom: -16px; background: color-mix(in srgb, var(--md-sys-color-surface) 97%, white 3%);
  border-top: 1px solid color-mix(in srgb, var(--md-sys-color-outline) 30%, transparent); padding: 8px 2px 10px; margin-top: 6px; }
.iks-toplam-kart .iks-toplam { padding-top: 0; }
`;

export default function IlkKurulumSihirbazi({ showConfirm, setActiveTab, textSettings, setTextSettings }) {
  const [acik, setAcik] = useState(false);
  const [adim, setAdim] = useState(A.HOS);
  const [veri, setVeri] = useState(null);
  const [secim, setSecim] = useState({});
  const [hata, setHata] = useState("");
  const [mesgul, setMesgul] = useState(false);
  // Zayıf bilgisayarda gizlenen ağır alternatifler: kategori kimliği -> "Yine de göster" tıklandı mı
  const [gizliGoster, setGizliGoster] = useState({});
  // Ayarlar'dan yalnızca "Yapay zekânız" adımı açıldıysa: sihirbazın geri kalanı gösterilmez, kapanınca işaret dosyası yazılmaz
  const [tekAdim, setTekAdim] = useState(false);
  const [yzAd, setYzAd] = useState(VARSAYILAN_YZ_ADI);
  const [yzIstem, setYzIstem] = useState("");
  const [yzOzelMetin, setYzOzelMetin] = useState(false);
  const [yzKaydedildi, setYzKaydedildi] = useState(false);
  const yuklendi = useRef(false);
  const textSettingsRef = useRef(textSettings);
  textSettingsRef.current = textSettings;

  const dil = (typeof navigator !== "undefined" && (navigator.language || "tr")) || "tr";

  const durumuAl = useCallback(async () => {
    const j = await istek(`/api/ilk-kurulum/durum?dil=${encodeURIComponent(dil)}`);
    setVeri(j);
    return j;
  }, [dil]);

  // "Yapay zekânız" adımını mevcut ayarla doldur: kullanıcının kendi metni varsa o, yoksa önerilen metin
  const yapayZekaHazirla = useCallback(() => {
    let ayar = textSettingsRef.current;
    if (!ayar) { try { ayar = JSON.parse(localStorage.getItem("textSettings") || "null"); } catch (_) { ayar = null; } }
    const ad = adTemizle(ayar?.assistantName) || VARSAYILAN_YZ_ADI;
    const mevcut = String(ayar?.systemPrompt || "");
    const ozel = !varsayilanMi(mevcut, ad);
    setYzAd(ad);
    setYzIstem(ozel ? mevcut : onerilenSistemMesaji(ad));
    setYzOzelMetin(ozel);
    setYzKaydedildi(false);
  }, []);

  const ac = useCallback(async (zorla, baslangic) => {
    try {
      const j = await durumuAl();
      if (!zorla && !j.gosterilsin) return;
      const ilk = {};
      for (const o of j.oneriler || []) ilk[o.id] = Boolean(o.secili);
      setSecim(ilk);
      setGizliGoster({});
      setHata("");
      yapayZekaHazirla();
      const yalnizYz = baslangic === "yapay-zeka";
      setTekAdim(yalnizYz);
      setAdim(yalnizYz ? A.YAPAY_ZEKA : j.kuyruk?.aktif ? A.KURULUM : A.HOS);
      setAcik(true);
    } catch (_) {
      // Sunucu bu sürümü desteklemiyorsa (rota yok) sihirbaz gösterilmez
    }
  }, [durumuAl, yapayZekaHazirla]);

  useEffect(() => {
    if (yuklendi.current) return;
    yuklendi.current = true;
    ac(false);
  }, [ac]);

  useEffect(() => {
    const dinle = (olay) => ac(true, olay?.detail?.adim);
    window.addEventListener("ilk-kurulum-ac", dinle);
    return () => window.removeEventListener("ilk-kurulum-ac", dinle);
  }, [ac]);

  // Kurulum sürerken durumu düzenli yenile
  const kuyrukAktif = Boolean(veri?.kuyruk?.aktif);
  useEffect(() => {
    if (!acik || !kuyrukAktif) return undefined;
    const t = setInterval(() => { durumuAl().catch(() => {}); }, 1500);
    return () => clearInterval(t);
  }, [acik, kuyrukAktif, durumuAl]);

  const d = veri?.donanim || {};
  const oneriler = veri?.oneriler || [];
  const secilenler = useMemo(() => oneriler.filter((o) => secim[o.id] && !o.kurulu && !o.kullanilamaz), [oneriler, secim]);
  // Ortak bileşenler (taşınabilir Python + PyTorch) seçilenlerden en az biri gerektiriyorsa bir kez sayılır
  const ortakEk = useMemo(() => {
    const ortak = veri?.ortak || {};
    const ekler = [];
    const torch = secilenler.some((o) => o.ortak === "python-torch");
    const python = !torch && secilenler.some((o) => o.ortak === "python");
    if (torch && ortak["python-torch"] && !ortak["python-torch"].kurulu) ekler.push(ortak["python-torch"]);
    if (python && ortak.python && !ortak.python.kurulu) ekler.push(ortak.python);
    return ekler;
  }, [secilenler, veri]);
  const toplamBayt = secilenler.reduce((t, o) => t + (Number(o.bayt) || 0), 0) + ortakEk.reduce((t, o) => t + (Number(o.bayt) || 0), 0);
  const varsayilanToplam = useMemo(() => {
    const liste = oneriler.filter((o) => o.varsayilan && !o.kullanilamaz && !o.kurulu);
    const ortak = veri?.ortak || {};
    const torch = liste.some((o) => o.ortak === "python-torch") && ortak["python-torch"] && !ortak["python-torch"].kurulu ? Number(ortak["python-torch"].bayt) || 0 : 0;
    return liste.reduce((t, o) => t + (Number(o.bayt) || 0), 0) + torch;
  }, [oneriler, veri]);
  const varsayilanSecimde = useMemo(() => oneriler.every((o) => Boolean(secim[o.id]) === Boolean(o.secili)), [oneriler, secim]);
  const diskYetersiz = d.bosDisk != null && toplamBayt > 0 && toplamBayt * 1.1 > d.bosDisk;

  const kapat = useCallback(async (atlandi) => {
    if (!tekAdim) {
      try {
        await istek("/api/ilk-kurulum/tamam", {
          atlandi,
          secilenler: secilenler.map((o) => o.id),
          yapayZeka: { ad: adTemizle(yzAd) || VARSAYILAN_YZ_ADI, ozelMetin: yzKaydedildi ? !varsayilanMi(yzIstem, yzAd) : null },
        });
      } catch (_) {}
    }
    setAcik(false);
    setTekAdim(false);
  }, [secilenler, tekAdim, yzAd, yzIstem, yzKaydedildi]);

  // Sistem mesajını sohbetin kullandığı ayara yaz (App.jsx textSettings → localStorage "textSettings")
  const yapayZekaKaydet = useCallback(() => {
    const istem = String(yzIstem || "").trim() || onerilenSistemMesaji(yzAd);
    const ad = adTemizle(yzAd) || VARSAYILAN_YZ_ADI;
    if (typeof setTextSettings === "function") {
      setTextSettings((onceki) => ({ ...(onceki || {}), systemPrompt: istem, assistantName: ad }));
    } else {
      // App.jsx yamalanmamışsa: ayar doğrudan kaydedilir, uygulama yeniden yüklenince etkin olur
      try {
        const onceki = JSON.parse(localStorage.getItem("textSettings") || "{}") || {};
        localStorage.setItem("textSettings", JSON.stringify({ ...onceki, systemPrompt: istem, assistantName: ad }));
      } catch (_) {}
    }
    setYzIstem(istem);
    setYzKaydedildi(true);
    return true;
  }, [yzIstem, yzAd, setTextSettings]);

  const adDegisti = useCallback((yeni) => {
    const temiz = String(yeni || "").replace(/[.\r\n\t]/g, "").slice(0, 40);
    setYzAd(temiz);
    setYzIstem((istem) => adiIstemeYaz(istem, temiz));
    setYzKaydedildi(false);
  }, []);

  const atla = useCallback(async () => {
    const onay = showConfirm
      ? await showConfirm({
          title: "Sihirbaz atlansın mı?",
          message: "Modelleri daha sonra Model Yöneticisi'nden indirebilirsiniz. Sihirbazı Ayarlar › “İlk kurulum sihirbazını yeniden aç” ile tekrar açabilirsiniz. Kaydetmediğiniz yapay zekâ ayarları değişmez.",
          confirmLabel: "Atla",
          cancelLabel: "Vazgeç",
        })
      : true;
    if (onay) kapat(true);
  }, [showConfirm, kapat]);

  const kapatDugmesi = useCallback(() => {
    if (tekAdim || adim === A.HAZIR) kapat(false);
    else atla();
  }, [tekAdim, adim, kapat, atla]);

  const kurulumuBaslat = useCallback(async () => {
    setHata("");
    setMesgul(true);
    try {
      await istek("/api/ilk-kurulum/indir", { secimler: secilenler.map((o) => o.id) });
      await durumuAl();
      setAdim(A.KURULUM);
    } catch (err) {
      setHata(err.message || String(err));
    } finally {
      setMesgul(false);
    }
  }, [secilenler, durumuAl]);

  const varsayilanaDon = useCallback(() => {
    const ilk = {};
    for (const o of veri?.oneriler || []) ilk[o.id] = Boolean(o.secili);
    setSecim(ilk);
  }, [veri]);

  const iptalEt = useCallback(async () => {
    try { await istek("/api/ilk-kurulum/iptal", {}); await durumuAl(); } catch (err) { setHata(err.message || String(err)); }
  }, [durumuAl]);

  const sayfayaGit = useCallback((sekme) => {
    kapat(false);
    setActiveTab?.(sekme);
  }, [kapat, setActiveTab]);

  if (!acik || !veri) return null;

  // Kategoriler: önce denenmiş varsayılan(lar), altında alternatifler
  const gruplar = [];
  for (const o of oneriler) {
    const anahtar = o.kategori || o.grup;
    let g = gruplar.find((x) => x.id === anahtar);
    if (!g) {
      const kat = (veri.kategoriler || []).find((k) => k.id === anahtar);
      g = { id: anahtar, ad: kat ? kat.ad : o.grup, ogeler: [] };
      gruplar.push(g);
    }
    g.ogeler.push(o);
  }
  const kuyruk = veri.kuyruk || {};
  const kuyrukBitti = !kuyruk.aktif && (kuyruk.ogeler || []).length > 0;

  const seviyeMetni = { dusuk: "İşlemci ile çalışma (ekran kartı yok)", orta: "Ekran kartıyla çalışma", yuksek: "Güçlü ekran kartı" }[d.seviye] || "";

  return (
    <div className="iks-arka" role="presentation">
      <style>{STIL}</style>
      <div className="iks-pencere" role="dialog" aria-modal="true" aria-labelledby="iks-baslik">
        <div className="iks-ust">
          <Sparkles size={20} style={{ color: "var(--md-sys-color-primary)" }} />
          <h2 id="iks-baslik">{tekAdim ? "Yapay zekânız" : "İlk kurulum"}</h2>
          {!tekAdim && adim < A.HAZIR && (
            <button type="button" className="m3-btn m3-btn-outlined" onClick={atla} title="Sihirbazı kapat; modelleri sonra indirirsiniz">
              Atla
            </button>
          )}
          <button type="button" className="iks-kapat" aria-label="Kapat" onClick={kapatDugmesi}>
            <X size={18} />
          </button>
        </div>
        {!tekAdim && (
          <div className="iks-adimlar">
            {ADIMLAR.map((ad, i) => (
              <span key={ad} className={`iks-adim ${i === adim ? "etkin" : i < adim ? "bitti" : ""}`}>{i + 1}. {ad}</span>
            ))}
          </div>
        )}

        <div className="iks-govde">
          {adim === A.HOS && (
            <>
              <p style={{ color: "var(--md-sys-color-on-surface)", fontSize: "1rem" }}>
                <b>Yerel AI Stüdyosu'na hoş geldiniz.</b> Her şey bu bilgisayarda çalışır: sohbet asistanı Vega, konuşma tanıma,
                Türkçe seslendirme, görsel, müzik ve video üretimi. İnternet yalnızca model indirirken ve siz web aramasını açtığınızda kullanılır.
              </p>
              <p>
                Bu sihirbaz bilgisayarınızı tanır, denenmiş bir model setini önceden seçili getirir ve seçtiklerinizi indirir.
                Ne seçeceğinizi bilmiyorsanız “İleri” demeniz yeterli. Her şeyi sonradan Model Yöneticisi'nden değiştirebilirsiniz.
              </p>
              <div className="iks-kart iks-not">
                <Info size={16} />
                <span>
                  Modeller büyük dosyalardır{varsayilanToplam > 0 ? ` (denenmiş setin tamamı ~${boyutYaz(varsayilanToplam)})` : ""}. İndirme sırasında uygulamayı
                  kullanmaya devam edebilirsiniz; sihirbazı kapatsanız da indirme sürer.
                </span>
              </div>
              <SorumlulukNotu style={{ marginTop: 10 }} />
            </>
          )}

          {adim === A.BILGISAYAR && (
            <>
              <p>Model kartlarındaki “Bu bilgisayarda” notları bu bilgilere göre hazırlandı. Varsayılan seçim her bilgisayarda aynı, denenmiş settir.</p>
              <div className="iks-izgara">
                <div className="iks-kart iks-bilgi"><Cpu size={18} /><div><div className="iks-etiket">İşlemci</div><div className="iks-deger">{d.islemci || "Bilinmiyor"}</div></div></div>
                <div className="iks-kart iks-bilgi"><MemoryStick size={18} /><div><div className="iks-etiket">Bellek (RAM)</div><div className="iks-deger">{d.ram} GB</div></div></div>
                <div className="iks-kart iks-bilgi">
                  <Monitor size={18} />
                  <div>
                    <div className="iks-etiket">Ekran kartı</div>
                    <div className="iks-deger">{d.gpuAdi || "Bulunamadı"}</div>
                    <div className="iks-etiket">
                      {d.apple ? "Birleşik bellek (Apple Silicon)" : d.tumlesik ? "Tümleşik — kendi belleği yok" : `${d.vram} GB ekran kartı belleği (VRAM)`}
                    </div>
                  </div>
                </div>
                <div className="iks-kart iks-bilgi"><HardDrive size={18} /><div><div className="iks-etiket">Boş disk (uygulama sürücüsü)</div><div className="iks-deger">{d.bosDisk != null ? boyutYaz(d.bosDisk) : "Bilinmiyor"}</div></div></div>
              </div>
              {d.tumlesik && d.paylasimliBellek > 0 && (
                <div className="iks-kart iks-not">
                  <Info size={16} />
                  <span>
                    Tümleşik ekran kartı sistem belleğinden {d.paylasimliBellek} GB'a kadar <i>paylaşımlı</i> bellek kullanabilir; bu gerçek ekran kartı
                    belleği (VRAM) değildir ve hız kazandırmaz. Bu yüzden bilgisayarınız “işlemci ile çalışma” sınıfında değerlendirildi.
                  </span>
                </div>
              )}
              <div className="iks-kart">
                <div className="iks-etiket">Sınıf</div>
                <div className="iks-deger">{seviyeMetni}</div>
                {!d.gpuVar && (
                  <p style={{ margin: "6px 0 0" }}>
                    Ekran kartı olmadan her şey çalışır ama yavaştır. Örnek ölçümler (i5-7200U, 16 GB, ekran kartı yok): Gemma 4 E4B ~10–16 sn'de açılır;
                    kısa bir cümle ~2 sn'de yazıya dökülür; tek görsel ~10 dk (hızlı modda ~3 dk); 15 saniyelik müzik ~6 dk. Video için ekran kartı önerilir.
                  </p>
                )}
              </div>
            </>
          )}

          {adim === A.MODELLER && (
            <>
              <div className="iks-ozet">
                <ShieldCheck size={18} />
                <div style={{ flex: 1 }}>
                  <b>{varsayilanSecimde ? "Denenmiş set seçili." : "Seçimi değiştirdiniz."}</b>{" "}
                  Her bölümde bizim denediğimiz model önceden işaretli; “İleri — indir ve kur” derseniz bu set kurulur.
                  Alternatifler altında, seçilmemiş olarak listelenir. Kurulu olanlar atlanır.
                </div>
                {!varsayilanSecimde && (
                  <button type="button" className="iks-kucuk-btn" onClick={varsayilanaDon} title="Seçimi denenmiş varsayılan sete döndür">
                    <RotateCcw size={13} /> Denenmiş sete dön
                  </button>
                )}
              </div>
              {gruplar.map((g) => {
                const Simge = KATEGORI_SIMGE[g.id] || Sparkles;
                const varsayilanlar = g.ogeler.filter((o) => o.varsayilan);
                const tumAlternatifler = g.ogeler.filter((o) => !o.varsayilan);
                // Gizli (zayıf bilgisayar için önerilmeyen) alternatifler: "Yine de göster" ya da seçiliyse görünür
                const gizliler = tumAlternatifler.filter((o) => o.gizli && !secim[o.id]);
                const gizliAcik = Boolean(gizliGoster[g.id]);
                const alternatifler = tumAlternatifler.filter((o) => !o.gizli || gizliAcik || secim[o.id]);
                const grupBayt = g.ogeler.filter((o) => secim[o.id] && !o.kurulu && !o.kullanilamaz).reduce((t, o) => t + (Number(o.bayt) || 0), 0);
                const satir = (o, alt) => {
                  const pasif = o.kurulu || Boolean(o.kullanilamaz);
                  return (
                    <label key={o.id} className={`iks-kart iks-model ${alt ? "alt" : ""} ${pasif ? "pasif" : ""}`}>
                      <input
                        type="checkbox"
                        disabled={pasif}
                        checked={Boolean(secim[o.id]) && !pasif}
                        onChange={(e) => setSecim((s) => ({ ...s, [o.id]: e.target.checked }))}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="iks-model-ust">
                          <span className="iks-model-ad">{o.ad}</span>
                          {o.bayt > 0 && <span className="iks-etiket">{o.yaklasik ? "~" : ""}{boyutYaz(o.bayt)}</span>}
                          {o.kurulu && <span className="iks-rozet yesil">Kurulu</span>}
                          {o.varsayilan && <span className="iks-rozet denenmis">Önerilen (denenmiş)</span>}
                          {!o.varsayilan && <span className="iks-rozet alternatif">Alternatif</span>}
                          {o.istegeBagli && !o.kurulu && <span className="iks-rozet istege" title="Seçili gelir; istemiyorsanız işareti kaldırın, sonra stüdyo sayfasından da kurabilirsiniz">İsteğe bağlı</span>}
                          {o.guclu && !o.kurulu && <span className="iks-rozet guclu"><Zap size={11} /> Güçlü bilgisayarınız için</span>}
                          {o.agir && <span className="iks-rozet agir">Ağır</span>}
                        </div>
                        <div className="iks-etiket" style={{ fontSize: ".84rem" }}>{o.aciklama}</div>
                        {o.istegeBagli && !o.kurulu && !o.kullanilamaz && o.bayt > 0 && (
                          <div className="iks-bubilgisayar">
                            <b>İsteğe bağlı:</b> {o.yaklasik ? "~" : ""}{boyutYaz(o.bayt)} indirir. Şimdi istemiyorsanız işareti kaldırın; sonra ilgili stüdyo sayfasından kurabilirsiniz.
                          </div>
                        )}
                        {o.gizliSebep && !o.uyari && <div className="iks-uyari"><AlertTriangle size={14} /><span>{o.gizliSebep}</span></div>}
                        {(o.notlar || []).length > 0 && (
                          <div className="iks-bubilgisayar"><b>Bu bilgisayarda:</b> {o.notlar.join(" ")}</div>
                        )}
                        {o.uyari && <div className="iks-uyari"><AlertTriangle size={14} /><span>{o.uyari}</span></div>}
                        {o.kullanilamaz && <div className="iks-uyari"><Info size={14} /><span>{o.kullanilamaz}</span></div>}
                        {(o.sure || o.lisans || o.dogrulama) && (
                          <div className="iks-etiket">
                            {[o.sure, o.lisans ? `Lisans: ${o.lisans}` : ""].filter(Boolean).join(" · ")}
                            {o.dogrulama && <>{(o.sure || o.lisans) ? " · " : ""}<span className="iks-dogrulama" title="İndirme bütünlüğü"><ShieldCheck size={11} /> {o.dogrulama}</span></>}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                };
                return (
                  <div key={g.id} className="iks-kategori">
                    <div className="iks-kategori-baslik">
                      <Simge size={17} />
                      <span>{g.ad}</span>
                      <span className="iks-etiket">{grupBayt > 0 ? `seçilen ~${boyutYaz(grupBayt)}` : "seçim yok"}</span>
                    </div>
                    {varsayilanlar.map((o) => satir(o, false))}
                    {alternatifler.length > 0 && (
                      <details className="iks-alternatifler" open>
                        <summary>Alternatifler ({alternatifler.length}): {alternatifler.map((o) => o.ad.split(" (")[0].split(" · ")[0].replace(/ — .*$/, "")).join(", ")}</summary>
                        {alternatifler.map((o) => satir(o, true))}
                      </details>
                    )}
                    {gizliler.length > 0 && !gizliAcik && (
                      <div className="iks-gizli-satir">
                        <Info size={13} />
                        <span>
                          {gizliler.map((o) => o.ad.replace(/ — .*$/, "")).join(", ")} bu bilgisayar için önerilmediğinden gizlendi.
                        </span>
                        <button type="button" className="iks-kucuk-btn" onClick={() => setGizliGoster((s) => ({ ...s, [g.id]: true }))}>
                          Yine de göster
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="iks-toplam-kart">
                <div className="iks-toplam">
                  <span>Seçilen: {secilenler.length} öğe</span>
                  <span>Toplam indirme: ~{boyutYaz(toplamBayt)}</span>
                </div>
                {ortakEk.length > 0 && (
                  <div className="iks-etiket">Dahil: {ortakEk.map((o) => `${o.ad} (~${boyutYaz(o.bayt)})`).join(", ")}. Boyutların bir kısmı yaklaşıktır.</div>
                )}
                {d.bosDisk != null && <div className="iks-etiket">Boş disk: {boyutYaz(d.bosDisk)}</div>}
                {diskYetersiz && (
                  <div className="iks-uyari"><AlertTriangle size={14} /><span>Boş disk alanı ({boyutYaz(d.bosDisk)}) seçilenler için yetersiz görünüyor. Bazı seçimleri kaldırın.</span></div>
                )}
                {hata && <div className="iks-hata" style={{ marginTop: 8 }}>{hata}</div>}
              </div>
            </>
          )}

          {adim === A.KURULUM && (
            <>
              {(kuyruk.ogeler || []).length === 0 ? (
                <p>Şu an süren bir kurulum yok.</p>
              ) : (
                <>
                  <p>{kuyruk.aktif ? (kuyruk.asama || "Kuruluyor…") : kuyruk.iptal ? "Kurulum durduruldu." : "Kurulum bitti."}</p>
                  <div className="iks-kart">
                    {kuyruk.ogeler.map((o, i) => (
                      <div key={o.id} className="iks-durum">
                        {o.durum === "suruyor" ? <Loader2 size={16} className="iks-don" />
                          : o.durum === "tamam" || o.durum === "atlandi" ? <Check size={16} style={{ color: "var(--md-sys-color-success, #2e7d32)" }} />
                          : o.durum === "hata" ? <AlertTriangle size={16} style={{ color: "var(--md-sys-color-error)" }} />
                          : <Download size={16} style={{ opacity: 0.5 }} />}
                        <div className="ad">
                          {o.ad}
                          {o.durum === "atlandi" && <span className="iks-etiket"> — zaten kurulu</span>}
                          {o.durum === "iptal" && <span className="iks-etiket"> — iptal edildi</span>}
                          {o.hata && o.durum === "hata" && <div className="iks-hata">{o.hata}</div>}
                          {i === kuyruk.sira && kuyruk.aktif && !kuyruk.indirme && kuyruk.asama && (
                            <div className="iks-etiket">{kuyruk.asama}</div>
                          )}
                          {i === kuyruk.sira && kuyruk.indirme && (
                            <>
                              <div className="iks-cubuk"><div style={{ width: `${Math.min(100, Math.max(0, kuyruk.indirme.yuzde))}%` }} /></div>
                              <div className="iks-etiket">
                                %{Math.round(kuyruk.indirme.yuzde)}
                                {kuyruk.indirme.toplam ? ` · ${boyutYaz(kuyruk.indirme.inen)} / ${boyutYaz(kuyruk.indirme.toplam)}` : ""}
                                {kuyruk.indirme.hiz ? ` · ${kuyruk.indirme.hiz}` : ""}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {kuyruk.aktif && (
                    <div className="iks-not"><Info size={16} /><span>Sihirbazı kapatabilir ya da sonraki adıma geçebilirsiniz; indirme arka planda sürer.</span></div>
                  )}
                  {kuyrukBitti && kuyruk.ogeler.some((o) => o.durum === "hata") && (
                    <div className="iks-uyari"><AlertTriangle size={14} /><span>Bazı öğeler kurulamadı. İnternet bağlantınızı kontrol edip Model Yöneticisi'nden tekrar deneyebilirsiniz.</span></div>
                  )}
                </>
              )}
              {hata && <div className="iks-hata" style={{ marginTop: 8 }}>{hata}</div>}
            </>
          )}

          {adim === A.YAPAY_ZEKA && (
            <>
              <p>
                Sohbet asistanınızın nasıl davranacağını aşağıdaki <b>sistem mesajı</b> belirler. Önerdiğimiz metinle başlayabilir,
                dilediğiniz gibi değiştirebilir ya da bu adımı olduğu gibi geçebilirsiniz. Sonradan Ayarlar › Metin bölümünden de değiştirilebilir.
              </p>
              <div className="iks-alan">
                <label htmlFor="iks-yz-ad">Yapay zekânın adı (isteğe bağlı)</label>
                <input
                  id="iks-yz-ad"
                  className="iks-girdi"
                  type="text"
                  value={yzAd}
                  maxLength={40}
                  placeholder={VARSAYILAN_YZ_ADI}
                  onChange={(e) => adDegisti(e.target.value)}
                />
                <span className="iks-etiket">
                  Ad vermek zorunlu değildir; boş bırakırsanız “{VARSAYILAN_YZ_ADI}” kullanılır. Yazdığınız ad, metindeki “Senin adın …” cümlesine kendiliğinden yerleşir.
                </span>
              </div>
              <div className="iks-alan">
                <label htmlFor="iks-yz-istem">Sistem mesajı</label>
                <textarea
                  id="iks-yz-istem"
                  className="iks-girdi"
                  rows={8}
                  value={yzIstem}
                  onChange={(e) => { setYzIstem(e.target.value); setYzKaydedildi(false); }}
                />
                <div className="iks-satir">
                  <button
                    type="button"
                    className="iks-kucuk-btn"
                    onClick={() => { setYzIstem(onerilenSistemMesaji(yzAd)); setYzOzelMetin(false); setYzKaydedildi(false); }}
                    title="Önerilen metni, yazdığınız adla yeniden yükler"
                  >
                    <RotateCcw size={13} /> Önerilen metni yükle
                  </button>
                  {yzKaydedildi && <span className="iks-basari"><Check size={14} /> Kaydedildi — sohbet bir sonraki mesajda bu metni kullanır.</span>}
                </div>
              </div>
              {yzOzelMetin && !yzKaydedildi && (
                <div className="iks-kart iks-not">
                  <Info size={16} />
                  <span>Daha önce kendi yazdığınız sistem mesajı gösteriliyor. Değiştirmeden geçerseniz olduğu gibi kalır.</span>
                </div>
              )}
              <div className="iks-kart iks-not">
                <Bot size={16} />
                <span>
                  Web araması, görsel / müzik / video üretimi, hesap ve saat gibi araçları uygulama asistana ayrıca tanıtır;
                  bu metni kısaltsanız da araçlar çalışmaya devam eder.
                </span>
              </div>
            </>
          )}

          {adim === A.OPSIYONEL && (
            <>
              <p>Bunlar isteğe bağlıdır ve şimdi indirilmez.</p>
              {(veri.opsiyonel || []).map((o) => {
                const Simge = OPSIYONEL_SIMGE[o.id] || Sparkles;
                return (
                  <div key={o.id} className="iks-kart iks-bilgi">
                    <Simge size={18} />
                    <div style={{ flex: 1 }}>
                      <div className="iks-model-ust">
                        <span className="iks-model-ad">{o.baslik}</span>
                        {o.sekme && (
                          <button type="button" className="iks-baglanti" onClick={() => sayfayaGit(o.sekme)}>Sayfaya git ›</button>
                        )}
                      </div>
                      <div className="iks-etiket" style={{ fontSize: ".84rem" }}>{o.aciklama}</div>
                      {o.uyari && <div className="iks-uyari"><AlertTriangle size={14} /><span>{o.uyari}</span></div>}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {adim === A.HAZIR && (
            <>
              <p style={{ color: "var(--md-sys-color-on-surface)", fontSize: "1rem" }}><b>Hazırsınız.</b></p>
              <div className="iks-kart iks-bilgi">
                <MessageSquare size={18} />
                <div>
                  Sohbet sayfasında üstteki model seçiciden sohbet modelini yükleyin ve asistanınıza ({adTemizle(yzAd) || VARSAYILAN_YZ_ADI}) yazın
                  ya da mikrofona basıp konuşun. Asistan gerektiğinde web'de arar, görsel, müzik ya da video üretebilir.
                </div>
              </div>
              <div className="iks-kart iks-not">
                <Info size={16} />
                <span>Bu sihirbazı istediğiniz zaman Ayarlar › “İlk kurulum sihirbazını yeniden aç” ile tekrar açabilirsiniz.</span>
              </div>
              {kuyruk.aktif && (
                <div className="iks-not"><Loader2 size={16} className="iks-don" /><span>İndirme arka planda sürüyor: {kuyruk.asama}</span></div>
              )}
            </>
          )}
        </div>

        <div className="iks-alt">
          {tekAdim && (
            <>
              <button type="button" className="m3-btn m3-btn-outlined" onClick={() => kapat(false)}>Vazgeç</button>
              <span className="bosluk" />
              <button type="button" className="m3-btn m3-btn-filled" onClick={() => { yapayZekaKaydet(); kapat(false); }}>
                <Check size={16} /> Kaydet
              </button>
            </>
          )}
          {!tekAdim && <>
          {adim > A.HOS && adim !== A.KURULUM && (
            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              onClick={() => setAdim((a) => (a === A.YAPAY_ZEKA && !(kuyruk.ogeler || []).length ? A.MODELLER : Math.max(A.HOS, a - 1)))}
            >
              <ChevronLeft size={16} /> Geri
            </button>
          )}
          {adim === A.KURULUM && kuyruk.aktif && (
            <button type="button" className="m3-btn m3-btn-outlined" onClick={iptalEt}>Kurulumu durdur</button>
          )}
          <span className="bosluk" />
          {adim === A.HOS && <button type="button" className="m3-btn m3-btn-filled" onClick={() => setAdim(A.BILGISAYAR)}>Başla <ChevronRight size={16} /></button>}
          {adim === A.BILGISAYAR && <button type="button" className="m3-btn m3-btn-filled" onClick={() => setAdim(A.MODELLER)}>Devam <ChevronRight size={16} /></button>}
          {adim === A.MODELLER && (
            <>
              <button type="button" className="m3-btn m3-btn-outlined" onClick={() => setAdim(A.YAPAY_ZEKA)}>İndirmeden devam</button>
              <button
                type="button"
                className="m3-btn m3-btn-filled"
                disabled={mesgul || secilenler.length === 0 || diskYetersiz || kuyrukAktif}
                onClick={kurulumuBaslat}
              >
                {mesgul ? <Loader2 size={16} className="iks-don" /> : <Download size={16} />} İleri — indir ve kur
              </button>
            </>
          )}
          {adim === A.KURULUM && <button type="button" className="m3-btn m3-btn-filled" onClick={() => setAdim(A.YAPAY_ZEKA)}>Devam <ChevronRight size={16} /></button>}
          {adim === A.YAPAY_ZEKA && (
            <>
              <button type="button" className="m3-btn m3-btn-outlined" onClick={() => setAdim(A.OPSIYONEL)} title="Sistem mesajı değiştirilmez">
                Değiştirmeden geç
              </button>
              <button type="button" className="m3-btn m3-btn-filled" onClick={() => { yapayZekaKaydet(); setAdim(A.OPSIYONEL); }}>
                <Check size={16} /> Kaydet ve devam
              </button>
            </>
          )}
          {adim === A.OPSIYONEL && <button type="button" className="m3-btn m3-btn-filled" onClick={() => setAdim(A.HAZIR)}>Devam <ChevronRight size={16} /></button>}
          {adim === A.HAZIR && (
            <button type="button" className="m3-btn m3-btn-filled" onClick={() => { kapat(false); setActiveTab?.("chat"); }}>
              <Check size={16} /> Sohbete başla
            </button>
          )}
          </>}
        </div>
      </div>
    </div>
  );
}

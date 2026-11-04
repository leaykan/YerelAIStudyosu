// Sohbet içi medya kartı (müzik / ses efekti / video), Vega görsel akışının benzeri:
//   1) Model seçimi: Vega muzik_uret / efekt_uret / video_uret aracını kullanınca sunucu işi BAŞLATMAZ, bir teklif
//      döner (tür + İngilizce tarif). Kart, o türün kurulu modellerini listeler (varsayılan seçili, "Bu bilgisayarda
//      önerilmez" notları); hiç kurulu model yoksa stüdyo sayfasına gitme düğmesi gösterir.
//   2) "Seç" -> POST /api/studyo/vega-baslat. Düğme Vega'nın yanıtı akarken kapalıdır: iş her zaman yanıt bittikten
//      sonra başlar (video için sohbet modeli yanıt akarken kapatılmaz; ECONNRESET yaşanmaz).
//   3) İlerleme: aşama, %, adım, geçen süre, İptal. Video sürerken sohbet modelinin geçici olarak bellekten çıkarıldığı
//      ve video bitince "Sohbet modeli yeniden yükleniyor…" durumu gösterilir.
//   4) Sonuç: ses / video oynatıcı, İndir, "Stüdyoda aç".
// Kart durumu sohbet geçmişine kaydedilir (TextChat: message.medyaIsleri), sayfa yenilense de sonuç görünür.
// Sunucu: scripts/server/studyo.cjs (/api/music/models, /api/video/models, /api/studyo/vega-baslat, /api/studyo/is/<id>,
// /api/studyo/iptal); sohbet modeli geri yükleme durumu serve.cjs'ten gelir (ek.sohbetModeli).
import React, { useEffect, useRef, useState } from "react";
import { AudioLines, Clapperboard, Download, ExternalLink, LoaderCircle, Music, X } from "lucide-react";
import { dosyaIndir, muzikModelleri, sekmeAc, studyoIptal, studyoIsDurumu, studyoVegaBaslat, videoModelleri } from "../services/studyoApi";

const BITTI = new Set(["tamam", "hata", "iptal", "kayip"]);
const TUR_BILGI = {
  muzik: { ad: "Müzik", Simge: Music, sayfa: "Müzik Stüdyosu", sekme: "muzik", varsayilan: "musicgen-small" },
  efekt: { ad: "Ses efekti", Simge: AudioLines, sayfa: "Müzik Stüdyosu", sekme: "muzik", varsayilan: "audioldm-s" },
  video: { ad: "Video", Simge: Clapperboard, sayfa: "Video Stüdyosu", sekme: "video", varsayilan: "animatediff" },
};
const MODEL_ADLARI = {
  "musicgen-small": "MusicGen Small",
  "audioldm-s": "AudioLDM-S",
  animatediff: "AnimateDiff (SD 1.5)",
  "wan21-1.3b": "Wan 2.1 1.3B",
  "wan21-14b": "Wan 2.1 14B",
};
const modelAdi = (id) => MODEL_ADLARI[id] || id || "";
const tabanAdi = (dosya) => String(dosya || "").replace(/\.safetensors$/i, "");
const sureYaz = (sn) => {
  const s = Math.max(0, Math.round(Number(sn) || 0));
  const sa = Math.floor(s / 3600);
  const dk = Math.floor((s % 3600) / 60);
  return sa ? `${sa}:${String(dk).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${dk}:${String(s % 60).padStart(2, "0")}`;
};
const yerelOku = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
const yerelYaz = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* yok say */ } };
const kucukYazi = { fontSize: "0.76rem", color: "var(--md-sys-color-on-surface-variant)" };
const secimStili = {
  flex: 1, minWidth: 140, fontSize: "0.78rem", padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border-color)",
  background: "var(--md-sys-color-surface)", color: "var(--md-sys-color-on-surface)",
};
const ikincilDugme = {
  display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border-color)", borderRadius: 99,
  background: "transparent", color: "var(--md-sys-color-on-surface)", cursor: "pointer", padding: "5px 12px", fontSize: "0.76rem", fontWeight: 600,
};
const onerilmezMi = (m) => m?.uyari?.seviye === "onerilmez" || m?.buBilgisayarda?.uygunluk === "onerilmez";

// Bu türün modelleri: müzik / efekt -> /api/music/models, video -> /api/video/models (yalnızca metinden video)
async function turModelleri(tur) {
  if (tur === "video") {
    const v = await videoModelleri();
    const modeller = (v.models || []).filter((m) => m.supported !== false && (m.modes || []).includes("t2v"));
    return { modeller, tabanlar: Array.isArray(v.tabanlar) ? v.tabanlar : [] };
  }
  const v = await muzikModelleri();
  return { modeller: (v.models || []).filter((m) => m.supported !== false && m.tur === tur), tabanlar: [] };
}

// --- 1) Model seçimi --------------------------------------------------------------------------------
function ModelSecimi({ is, bilgi, sohbetMesgul, onSec, onVazgec }) {
  const [veri, setVeri] = useState(null); // { modeller, tabanlar } | { hata }
  const [secim, setSecim] = useState("");
  const [taban, setTaban] = useState("");
  const [yenile, setYenile] = useState(0);

  useEffect(() => {
    let iptal = false;
    setVeri(null);
    turModelleri(is.tur)
      .then((v) => {
        if (iptal) return;
        setVeri(v);
        const kurulu = v.modeller.filter((m) => m.installed);
        const hatirlanan = yerelOku(`vegaMedyaModeli_${is.tur}`);
        const ilk = kurulu.find((m) => m.id === is.model) || kurulu.find((m) => m.id === hatirlanan)
          || kurulu.find((m) => m.id === bilgi.varsayilan) || kurulu[0];
        setSecim(ilk ? ilk.id : "");
        const t = v.tabanlar.find((x) => x.dosya === (is.taban || yerelOku("vegaMedyaTabani"))) || v.tabanlar.find((x) => x.gercekci) || v.tabanlar[0];
        setTaban(t ? t.dosya : "");
      })
      .catch((err) => { if (!iptal) setVeri({ hata: err.message || String(err), modeller: [], tabanlar: [] }); });
    return () => { iptal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is.tur, yenile]);

  if (!veri) {
    return <div className="vega-gorsel-bekliyor"><LoaderCircle size={15} className="progress-spinner" /><span>{bilgi.ad} modelleri okunuyor…</span></div>;
  }
  if (veri.hata) {
    return (
      <div className="vega-gorsel-hata" style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
        <span>Modeller okunamadı: {veri.hata}</span>
        <button type="button" style={ikincilDugme} onClick={() => setYenile((x) => x + 1)}>Tekrar dene</button>
      </div>
    );
  }
  const kurulu = veri.modeller.filter((m) => m.installed);
  const kuruluDegil = veri.modeller.filter((m) => !m.installed && m.kurulabilir !== false);
  if (!kurulu.length) {
    return (
      <div className="vega-model-sec">
        <div className="vega-model-sec-baslik">{bilgi.ad} üretimi için kurulu model yok</div>
        <div style={{ ...kucukYazi, lineHeight: 1.4 }}>
          {kuruluDegil.length
            ? `Önce ${bilgi.sayfa} sayfasından bir model kurun (${kuruluDegil.map((m) => m.name).join(", ")}). Kurduktan sonra bu karttan "Tekrar bak" ile devam edebilirsiniz.`
            : `${bilgi.sayfa} sayfasında bu tür için kurulabilir model bulunamadı.`}
          {is.tur === "video" && !veri.tabanlar.length ? " AnimateDiff için app/models içinde bir SD 1.5 görsel modeli de gerekir." : ""}
        </div>
        <div className="vega-model-dugmeler" style={{ flexWrap: "wrap" }}>
          <button type="button" className="vega-model-uret" onClick={() => sekmeAc(bilgi.sekme)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ExternalLink size={13} /> {bilgi.sayfa}'na git
          </button>
          <button type="button" className="vega-model-vazgec" onClick={() => setYenile((x) => x + 1)}>Tekrar bak</button>
          <button type="button" className="vega-model-vazgec" onClick={onVazgec}>Vazgeç</button>
        </div>
      </div>
    );
  }
  const secili = kurulu.find((m) => m.id === secim);
  const tabanGoster = is.tur === "video" && secim === "animatediff" && veri.tabanlar.length > 0;
  return (
    <div className="vega-model-sec">
      <div className="vega-model-sec-baslik">Hangi modelle üretilsin?</div>
      <div className="vega-model-liste" role="radiogroup" aria-label={`${bilgi.ad} modeli`}>
        {kurulu.map((m) => {
          const onerilmez = onerilmezMi(m);
          const not = m.buBilgisayarda?.metin || m.uyari?.neden || "";
          return (
            <label key={m.id} className={`vega-model-satir ${secim === m.id ? "secili" : ""}`}>
              <input type="radio" name={`medya-model-${is.anahtar}`} checked={secim === m.id} onChange={() => setSecim(m.id)} />
              <span className="vega-model-ad" title={m.id}>{m.name}{m.id === bilgi.varsayilan ? " (önerilen)" : ""}</span>
              <span className="vega-model-bilgi" style={{ flexWrap: "wrap", lineHeight: 1.35 }}>
                {onerilmez ? <span className="vega-model-rozet">Bu bilgisayarda önerilmez</span> : null}
                <span>{[m.approxSize ? String(m.approxSize).replace(/\s*\(.*$/, "") : "", not].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          );
        })}
      </div>
      {tabanGoster && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <label style={kucukYazi} htmlFor={`medya-taban-${is.anahtar}`}>SD 1.5 tabanı:</label>
          <select id={`medya-taban-${is.anahtar}`} value={taban} onChange={(e) => setTaban(e.target.value)} style={secimStili}>
            {veri.tabanlar.map((t) => <option key={t.dosya} value={t.dosya}>{t.ad}{t.boyutGb ? ` (${t.boyutGb} GB)` : ""}{t.gercekci ? " — gerçekçi" : ""}</option>)}
          </select>
        </div>
      )}
      {kuruluDegil.length > 0 && (
        <div style={{ ...kucukYazi, fontSize: "0.72rem" }}>
          Kurulu olmayan: {kuruluDegil.map((m) => m.name).join(", ")} —{" "}
          <button type="button" onClick={() => sekmeAc(bilgi.sekme)}
            style={{ border: 0, background: "none", padding: 0, color: "var(--md-sys-color-primary)", cursor: "pointer", fontSize: "inherit", textDecoration: "underline" }}>
            {bilgi.sayfa}'ndan kurabilirsiniz
          </button>
        </div>
      )}
      {is.tur === "video" && (
        <div style={{ ...kucukYazi, fontSize: "0.72rem", lineHeight: 1.4 }}>
          Üretim başlayınca sohbet modeli geçici olarak bellekten çıkarılır ve video bitince otomatik geri yüklenir; bu sırada Vega yanıt veremez.
          {secili && onerilmezMi(secili) ? " Ekran kartı olmadan video saatler sürebilir; istediğiniz an iptal edebilirsiniz." : ""}
        </div>
      )}
      <div className="vega-model-dugmeler" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="vega-model-uret" disabled={!secim || sohbetMesgul}
          onClick={() => {
            yerelYaz(`vegaMedyaModeli_${is.tur}`, secim);
            if (tabanGoster && taban) yerelYaz("vegaMedyaTabani", taban);
            onSec(secim, tabanGoster ? taban : "");
          }}>Seç</button>
        <button type="button" className="vega-model-vazgec" onClick={onVazgec}>Vazgeç</button>
        {sohbetMesgul && <span style={{ ...kucukYazi, fontSize: "0.72rem" }}>Vega'nın yanıtı bitince seçebilirsiniz.</span>}
      </div>
    </div>
  );
}

// --- Kart -------------------------------------------------------------------------------------------
export default function SohbetMedyaKarti({ is, sohbetMesgul = false, onGuncelle, onSeslendir }) {
  const tur = TUR_BILGI[is.tur] ? is.tur : "muzik";
  const bilgi = TUR_BILGI[tur];
  const { Simge } = bilgi;
  const [canli, setCanli] = useState(null);   // sunucudaki anlık iş özeti
  const [ek, setEk] = useState(undefined);    // undefined: henüz okunmadı; { sohbetModeli, sohbetModeliYuklu }
  const [mesgul, setMesgul] = useState(false);
  const [islemHatasi, setIslemHatasi] = useState("");
  const [simdi, setSimdi] = useState(Date.now());
  const onGuncelleRef = useRef(onGuncelle);
  onGuncelleRef.current = onGuncelle;
  const onSeslendirRef = useRef(onSeslendir);
  onSeslendirRef.current = onSeslendir;
  const bildirildiRef = useRef(BITTI.has(is.durum) ? is.id : "");

  const o = canli || is;
  const isVar = Boolean(is.id);
  // Başlatma sırasında sayfa yenilendiyse (iş kimliği yok) kart yeniden model seçimine döner
  const durum = !isVar && o.durum === "baslatiliyor" && !mesgul ? "model-sec" : (o.durum || is.durum || "model-sec");
  const sohbetModeli = ek !== undefined ? (ek?.sohbetModeli || null) : (is.sohbetModeli || null);
  const sohbetModeliBekliyor = Boolean(sohbetModeli && (sohbetModeli.durum === "bekliyor" || sohbetModeli.durum === "yukleniyor"));
  const isBitti = BITTI.has(durum);
  const izlemeSuruyor = isVar && (!isBitti || (tur === "video" && sohbetModeliBekliyor && durum !== "kayip"));

  // Canlı durum: iş bitene (video için sohbet modeli geri yüklenene) kadar 2 sn'de bir
  useEffect(() => {
    if (!izlemeSuruyor) return undefined;
    let kapandi = false;
    let zamanlayici = null;
    let hataSayisi = 0;
    const yokla = async () => {
      try {
        const v = await studyoIsDurumu(is.id);
        if (kapandi) return;
        hataSayisi = 0;
        setIslemHatasi("");
        const s = v.is || {};
        setCanli(s);
        setEk(v.ek || null);
        if (BITTI.has(s.durum) && bildirildiRef.current !== is.id) {
          bildirildiRef.current = is.id;
          onGuncelleRef.current?.({
            durum: s.durum, ilerleme: s.ilerleme, asama: s.asama, hata: s.hata || "", sonuc: s.sonuc || null,
            model: s.model || is.model, istem: s.istem || is.istem, taban: s.taban || is.taban || "",
            baslangic: s.baslangic, bitis: s.bitis, sohbetModeli: v.ek?.sohbetModeli || null,
          }, true);
          onSeslendirRef.current?.(s.durum === "tamam" ? `${bilgi.ad} hazır.` : s.durum === "iptal" ? `${bilgi.ad} üretimi iptal edildi.` : `${bilgi.ad} üretilemedi.`);
        } else if (BITTI.has(s.durum)) {
          // Video sonrası geri yükleme sonucu da kaydedilir (bekliyor -> yukleniyor -> hazir / hata / atlandi)
          const sm = v.ek?.sohbetModeli || null;
          if (!sm || !["bekliyor", "yukleniyor"].includes(sm.durum)) onGuncelleRef.current?.({ sohbetModeli: sm }, true);
        } else if (s.durum === "calisiyor" && !is.baslangic && s.baslangic) {
          onGuncelleRef.current?.({ durum: "calisiyor", baslangic: s.baslangic, istem: s.istem || is.istem }, false);
        }
      } catch (err) {
        if (kapandi) return;
        if (err.kod === 404) {
          setCanli((c) => ({ ...(c || is), durum: "kayip" }));
          if (bildirildiRef.current !== is.id) {
            bildirildiRef.current = is.id;
            onGuncelleRef.current?.({ durum: "kayip", hata: `İş kaydı bulunamadı (sunucu yeniden başlamış olabilir). Sonuç oluştuysa ${bilgi.sayfa} sayfasında görünür.` }, true);
          }
          return;
        }
        hataSayisi += 1;
        if (hataSayisi > 30) setIslemHatasi("Sunucuya ulaşılamıyor; durum güncellenemiyor.");
      }
      if (!kapandi) zamanlayici = setTimeout(yokla, 2000);
    };
    yokla();
    return () => { kapandi = true; clearTimeout(zamanlayici); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is.id, izlemeSuruyor]);

  // Geçen süre göstergesi
  useEffect(() => {
    if (!isVar || isBitti) return undefined;
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isVar, isBitti]);

  // 2) "Seç": iş başlatılır (Vega'nın yanıtı bitmiştir; düğme yanıt akarken kapalı)
  const baslat = async (model, taban) => {
    setMesgul(true);
    setIslemHatasi("");
    onGuncelleRef.current?.({ durum: "baslatiliyor", model, taban: taban || "", hata: "" }, false);
    try {
      const v = await studyoVegaBaslat({ tur, model, taban, istem: is.istem, ozgunIstem: is.ozgunIstem || "", sure: is.sure || undefined });
      const y = v.is || {};
      bildirildiRef.current = "";
      setCanli(null);
      setEk(undefined);
      onGuncelleRef.current?.({ id: y.id, durum: y.durum || "sirada", model: y.model || model, taban: y.taban || taban || "", istem: y.istem || is.istem,
        ilerleme: 0, asama: y.asama || "", sonuc: null, hata: "", sohbetModeli: null, olusturma: y.olusturma || Date.now(), baslangic: 0 }, true);
      onSeslendirRef.current?.(`${bilgi.ad} üretimi başladı.`);
    } catch (err) {
      onGuncelleRef.current?.({ durum: "baslatilamadi", hata: err.message || String(err) }, true);
    } finally {
      setMesgul(false);
    }
  };

  const iptalEt = async () => {
    setMesgul(true);
    setIslemHatasi("");
    try { await studyoIptal(is.id); }
    catch (err) { setIslemHatasi(err.message || String(err)); }
    finally { setMesgul(false); }
  };

  const baslik = durum === "model-sec" ? `${bilgi.ad} isteği`
    : durum === "baslatiliyor" ? `${bilgi.ad} başlatılıyor`
    : durum === "tamam" ? `${bilgi.ad} hazır`
    : durum === "sirada" || durum === "calisiyor" ? `${bilgi.ad} üretiliyor`
    : durum === "vazgecildi" ? `${bilgi.ad} isteği`
    : bilgi.ad;
  const sonuc = o.sonuc || is.sonuc;
  const ilerleme = Math.max(0, Math.min(100, Number(o.ilerleme) || 0));
  const baslangic = o.baslangic || is.baslangic || 0;
  const gecenSn = baslangic ? ((isBitti ? (o.bitis || is.bitis || simdi) : simdi) - baslangic) / 1000 : 0;
  const durumMetni = durum === "sirada"
    ? (o.sira > 1 ? `Sırada (${o.sira}.)` : "Sırada, birazdan başlayacak")
    : durum === "calisiyor" ? (o.asama || "Üretiliyor") : "";
  const videoNotu = tur === "video" && isVar && !isBitti
    ? (sohbetModeli?.durum === "bekliyor"
      ? "Sohbet modeli video üretimi için geçici olarak bellekten çıkarıldı; video bitince otomatik geri yüklenecek. Bu sırada Vega yanıt veremez."
      : "Sohbet modeli, video başlarken geçici olarak bellekten çıkarılacak ve video bitince otomatik geri yüklenecek.")
    : "";

  return (
    <div className={`sohbet-medya-karti durum-${durum}`} data-tur={tur} style={{ marginTop: 8, maxWidth: tur === "video" ? "min(460px, 100%)" : "min(440px, 100%)" }}>
      <div style={{
        border: "1px solid var(--border-color)", borderRadius: 12, padding: "10px 12px",
        background: "var(--md-sys-color-surface-container)", display: "flex", flexDirection: "column", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)",
          }}><Simge size={16} /></span>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
            <strong style={{ fontSize: "0.86rem" }}>{baslik}</strong>
            {(isVar || durum === "baslatiliyor") && (o.model || is.model) ? (
              <span style={{ ...kucukYazi, fontSize: "0.74rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.model || is.model}>
                Model: {modelAdi(o.model || is.model)}{(o.taban || is.taban) ? ` · taban: ${tabanAdi(o.taban || is.taban)}` : ""}
              </span>
            ) : null}
          </div>
          {isVar && !isBitti && (
            <button type="button" onClick={iptalEt} disabled={mesgul} title="Üretimi iptal et" aria-label="Üretimi iptal et"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border-color)", borderRadius: 8,
                background: "transparent", color: "var(--md-sys-color-error, #d33)", cursor: "pointer", padding: "4px 8px", fontSize: "0.76rem" }}>
              <X size={13} /> İptal
            </button>
          )}
        </div>

        {(is.ozgunIstem || o.istem || is.istem) && (
          <div className="vega-gorsel-istem" style={{ margin: 0 }}>
            {is.ozgunIstem ? <div>İstek: {is.ozgunIstem}</div> : null}
            <div title="Modele gönderilen İngilizce tarif"><span style={{ fontWeight: 600 }}>Tarif: </span>{o.istem || is.istem}{is.sure ? ` · ${is.sure} sn` : ""}</div>
          </div>
        )}

        {durum === "model-sec" && (
          <ModelSecimi is={is} bilgi={bilgi} sohbetMesgul={sohbetMesgul} onSec={baslat}
            onVazgec={() => onGuncelleRef.current?.({ durum: "vazgecildi" }, true)} />
        )}
        {durum === "baslatiliyor" && (
          <div className="vega-gorsel-bekliyor" style={{ margin: 0 }}><LoaderCircle size={15} className="progress-spinner" /><span>Başlatılıyor…</span></div>
        )}
        {durum === "baslatilamadi" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
            <div className="vega-gorsel-hata" style={{ margin: 0 }}>Başlatılamadı: {is.hata || "bilinmeyen hata"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" style={ikincilDugme} onClick={() => onGuncelleRef.current?.({ durum: "model-sec", hata: "" }, true)}>Tekrar dene</button>
              <button type="button" style={ikincilDugme} onClick={() => sekmeAc(bilgi.sekme)}><ExternalLink size={12} /> {bilgi.sayfa}</button>
            </div>
          </div>
        )}
        {durum === "vazgecildi" && <div style={{ ...kucukYazi }}>Vazgeçildi.</div>}

        {isVar && !isBitti && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="vega-gorsel-bekliyor" style={{ margin: 0 }}>
              <LoaderCircle size={15} className="progress-spinner" />
              <span>
                {durumMetni}
                {o.toplam > 0 ? ` · adım ${o.adim}/${o.toplam}` : ""}
                {` · %${ilerleme}`}
                {gecenSn > 0 ? ` · ${sureYaz(gecenSn)}` : ""}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: "var(--md-sys-color-surface-variant)", overflow: "hidden" }}
              role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ilerleme}>
              <div style={{ width: `${ilerleme}%`, height: "100%", background: "var(--md-sys-color-primary)", transition: "width 0.6s ease" }} />
            </div>
          </div>
        )}
        {videoNotu && <div className="sohbet-medya-video-notu" style={{ ...kucukYazi, lineHeight: 1.4 }}>{videoNotu} Bu donanımda video uzun sürebilir.</div>}

        {durum === "tamam" && sonuc?.url && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tur === "video"
              ? <video controls preload="metadata" src={sonuc.url} style={{ width: "100%", borderRadius: 10, background: "#000" }} />
              : <audio controls preload="metadata" src={sonuc.url} style={{ width: "100%" }} />}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" className="vega-model-uret" onClick={() => dosyaIndir(sonuc.url, sonuc.filename)}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Bilgisayara kaydet">
                <Download size={13} /> İndir
              </button>
              <button type="button" style={ikincilDugme} onClick={() => sekmeAc(bilgi.sekme)} title={`${bilgi.sayfa} sayfasını aç`}>
                <ExternalLink size={12} /> Stüdyoda aç
              </button>
              <span style={{ ...kucukYazi, fontSize: "0.72rem" }}>
                {[sonuc.duration ? `${sonuc.duration} sn` : "", sonuc.genDuration ? `üretim ${sonuc.genDuration}` : ""].filter(Boolean).join(" · ")}
              </span>
            </div>
            {sonuc.warning ? <div className="vega-gorsel-hata" style={{ margin: 0 }}>{sonuc.warning}</div> : null}
          </div>
        )}
        {durum === "tamam" && !sonuc?.url && <div className="vega-gorsel-hata" style={{ margin: 0 }}>Üretim bitti ama dosya bilgisi alınamadı; {bilgi.sayfa} sayfasına bakın.</div>}
        {durum === "hata" && <div className="vega-gorsel-hata" style={{ margin: 0 }}>{bilgi.ad} üretilemedi: {o.hata || is.hata || "bilinmeyen hata"}</div>}
        {durum === "iptal" && <div className="vega-gorsel-hata vega-gorsel-iptal" style={{ margin: 0 }}>Üretim iptal edildi.</div>}
        {durum === "kayip" && <div className="vega-gorsel-hata" style={{ margin: 0 }}>{is.hata || "İş kaydı bulunamadı (sunucu yeniden başlamış olabilir)."}</div>}

        {/* Video bitti: sohbet modelinin otomatik geri yüklenmesi */}
        {tur === "video" && isBitti && sohbetModeli && (
          <div className="sohbet-medya-geri-yukleme" style={{ display: "flex", alignItems: "center", gap: 6, ...kucukYazi, color: sohbetModeli.durum === "hata" ? "var(--md-sys-color-error, #d33)" : kucukYazi.color }}>
            {sohbetModeliBekliyor && durum !== "kayip" && <LoaderCircle size={13} className="progress-spinner" />}
            <span>
              {sohbetModeli.durum === "bekliyor" || sohbetModeli.durum === "yukleniyor" ? `Sohbet modeli yeniden yükleniyor…${sohbetModeli.model ? ` (${sohbetModeli.model})` : ""}`
                : sohbetModeli.durum === "hazir" ? `Sohbet modeli geri yüklendi${sohbetModeli.model ? ` (${sohbetModeli.model})` : ""}.`
                : sohbetModeli.durum === "hata" ? `Sohbet modeli geri yüklenemedi: ${sohbetModeli.hata || "bilinmeyen hata"}. Yukarıdaki model seçiciden yeniden yükleyebilirsiniz.`
                : sohbetModeli.durum === "atlandi" ? "Sohbet modeli o arada elle yüklendiği ya da kapatıldığı için otomatik geri yükleme yapılmadı." : ""}
            </span>
          </div>
        )}
        {islemHatasi && <div className="vega-gorsel-hata" style={{ margin: 0 }}>{islemHatasi}</div>}
      </div>
    </div>
  );
}

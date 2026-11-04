// Sohbet içi stüdyo kartı: Vega müzik / ses efekti / video üretimini bir araçla (muzik_uret, efekt_uret,
// video_uret) başlattığında sohbet mesajının altında gösterilir (Vega görsel kartının benzeri).
// Kartta: kullanılan model (aynı türden birden çok model kuruluysa seçici + "Bu modelle üret"; video için
// AnimateDiff'in SD 1.5 taban modeli seçimi), modele giden İngilizce istem (ve kullanıcının Türkçe isteği),
// canlı aşama ve ilerleme, iptal, sonuç (oynatıcı + indir) ve video için sohbet modelinin bellekten çıkarılıp
// video bitince geri yüklenmesi. Kart durumu sohbet geçmişine kaydedilir (TextChat: message.studyoIsleri),
// böylece sayfa yenilense de sonuç görünür.
// Sunucu: scripts/server/studyo.cjs (GET /api/studyo/is/<id>, POST /api/studyo/is/<id>/yeniden,
// GET /api/studyo/kurulu-modeller, POST /api/studyo/iptal); sohbet modeli durumu serve.cjs'ten (ek.sohbetModeli).
import React, { useEffect, useRef, useState } from "react";
import { AudioLines, Clapperboard, Download, LoaderCircle, Music, RefreshCw, X } from "lucide-react";
import { dosyaIndir, studyoIptal, studyoIsDurumu, studyoIsYeniden, studyoKuruluModeller } from "../services/studyoApi";

const BITTI = new Set(["tamam", "hata", "iptal", "kayip"]);
const TUR_BILGI = {
  muzik: { ad: "Müzik", Simge: Music, sayfa: "Müzik Stüdyosu" },
  efekt: { ad: "Ses efekti", Simge: AudioLines, sayfa: "Müzik Stüdyosu" },
  video: { ad: "Video", Simge: Clapperboard, sayfa: "Video Stüdyosu" },
};
// Sunucu model listesi gelmeden önce okunur adlar
const MODEL_ADLARI = {
  "musicgen-small": "MusicGen Small",
  "audioldm-s": "AudioLDM-S",
  animatediff: "AnimateDiff (SD 1.5)",
  "wan21-1.3b": "Wan 2.1 1.3B",
  "wan21-14b": "Wan 2.1 14B",
};
const modelAdi = (id, liste) => (liste || []).find((m) => m.id === id)?.name || MODEL_ADLARI[id] || id || "";
const tabanAdi = (dosya) => String(dosya || "").replace(/\.safetensors$/i, "");
const sureYaz = (sn) => {
  const s = Math.max(0, Math.round(Number(sn) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const secimStili = {
  flex: 1, minWidth: 140, fontSize: "0.78rem", padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border-color)",
  background: "var(--md-sys-color-surface)", color: "var(--md-sys-color-on-surface)",
};
const kucukYazi = { fontSize: "0.76rem", color: "var(--md-sys-color-on-surface-variant)" };

export default function StudyoSohbetKarti({ is, onGuncelle, onSeslendir }) {
  const tur = TUR_BILGI[is.tur] ? is.tur : "muzik";
  const bilgi = TUR_BILGI[tur];
  const { Simge } = bilgi;
  const [canli, setCanli] = useState(null);      // sunucudaki anlık iş özeti
  const [ek, setEk] = useState(null);            // { sohbetModeli: { durum, model, hata }, sohbetModeliYuklu }
  const [modeller, setModeller] = useState(null); // aynı türden kurulu modeller
  const [tabanlar, setTabanlar] = useState([]);  // video: AnimateDiff için SD 1.5 taban modelleri
  const [secilenModel, setSecilenModel] = useState(is.model || "");
  const [secilenTaban, setSecilenTaban] = useState(is.taban || "");
  const [mesgul, setMesgul] = useState(false);
  const [islemHatasi, setIslemHatasi] = useState("");
  const [simdi, setSimdi] = useState(Date.now());
  const onGuncelleRef = useRef(onGuncelle);
  onGuncelleRef.current = onGuncelle;
  const onSeslendirRef = useRef(onSeslendir);
  onSeslendirRef.current = onSeslendir;
  // Bitiş bir kez bildirilir (kayıttan açılan bitmiş kart yeniden bildirmez)
  const bildirildiRef = useRef(BITTI.has(is.durum) ? is.id : "");

  const o = canli || is;
  const durum = o.durum || "sirada";
  const sohbetModeli = ek?.sohbetModeli || is.sohbetModeli || null;
  const sohbetModeliBekliyor = Boolean(sohbetModeli && (sohbetModeli.durum === "bekliyor" || sohbetModeli.durum === "yukleniyor"));
  const isBitti = BITTI.has(durum);
  // Video bittikten sonra da sohbet modeli geri yüklenene kadar izlenir
  const izlemeSuruyor = !isBitti || (tur === "video" && sohbetModeliBekliyor && durum !== "kayip");

  // Kurulu modeller (aynı türden birden çoksa seçici gösterilir) ve video için taban modeller
  useEffect(() => {
    let iptal = false;
    studyoKuruluModeller(tur)
      .then((v) => {
        if (iptal) return;
        setModeller(Array.isArray(v.modeller) ? v.modeller : []);
        setTabanlar(Array.isArray(v.tabanlar) ? v.tabanlar : []);
      })
      .catch(() => { if (!iptal) setModeller([]); });
    return () => { iptal = true; };
  }, [tur]);

  useEffect(() => { setSecilenModel(is.model || ""); }, [is.model]);
  useEffect(() => { if (o.taban) setSecilenTaban((t) => t || o.taban); }, [o.taban]);

  // Canlı durum: iş bitene (video için sohbet modeli geri yüklenene) kadar 2 sn'de bir
  useEffect(() => {
    if (!is.id || !izlemeSuruyor) return undefined;
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
            model: s.model || is.model, istem: s.istem || is.istem, taban: s.taban || "", baslangic: s.baslangic, bitis: s.bitis,
            sohbetModeli: v.ek?.sohbetModeli || null,
          }, true);
          const ad = bilgi.ad;
          onSeslendirRef.current?.(s.durum === "tamam" ? `${ad} hazır.` : s.durum === "iptal" ? `${ad} üretimi iptal edildi.` : `${ad} üretilemedi.`);
        } else if (BITTI.has(s.durum) && v.ek?.sohbetModeli && !["bekliyor", "yukleniyor"].includes(v.ek.sohbetModeli.durum)) {
          onGuncelleRef.current?.({ sohbetModeli: v.ek.sohbetModeli }, true); // geri yükleme sonucu da kaydedilir
        }
      } catch (err) {
        if (kapandi) return;
        if (err.kod === 404) {
          // Sunucu yeniden başladıysa iş kaydı yoktur
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
    if (isBitti) return undefined;
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isBitti]);

  const iptalEt = async () => {
    setMesgul(true);
    setIslemHatasi("");
    try { await studyoIptal(is.id); }
    catch (err) { setIslemHatasi(err.message || String(err)); }
    finally { setMesgul(false); }
  };

  // Aynı tarifle seçilen modelle (ve video tabanıyla) yeniden üret; süren iş varsa sunucu onu iptal eder
  const yenidenUret = async () => {
    if (!secilenModel) return;
    setMesgul(true);
    setIslemHatasi("");
    try {
      const v = await studyoIsYeniden(is.id, secilenModel, secilenModel === "animatediff" ? secilenTaban : "");
      const y = v.is || {};
      bildirildiRef.current = "";
      onGuncelleRef.current?.({ id: y.id, model: y.model || secilenModel, taban: y.taban || "", durum: y.durum || "sirada", ilerleme: 0,
        asama: y.asama || "", hata: "", sonuc: null, sohbetModeli: null, oncekiIs: is.id }, true);
    } catch (err) {
      setIslemHatasi(err.message || String(err));
    } finally {
      setMesgul(false);
    }
  };

  const sonuc = o.sonuc || is.sonuc;
  const ilerleme = Math.max(0, Math.min(100, Number(o.ilerleme) || 0));
  const gecenSn = o.baslangic ? ((isBitti ? (o.bitis || simdi) : simdi) - o.baslangic) / 1000 : 0;
  const modelSecilebilir = Array.isArray(modeller) && modeller.length > 1;
  const tabanSecilebilir = tur === "video" && secilenModel === "animatediff" && tabanlar.length > 1;
  const yenidenDugmesi = modelSecilebilir || tabanSecilebilir;
  const ayniAyar = secilenModel === (o.model || is.model) && (secilenModel !== "animatediff" || !secilenTaban || secilenTaban === (o.taban || is.taban));
  const durumMetni = durum === "sirada"
    ? (o.sira > 1 ? `Sırada (${o.sira}.)` : "Sırada, birazdan başlayacak")
    : durum === "calisiyor" ? (o.asama || "Üretiliyor")
    : durum === "tamam" ? "Hazır"
    : durum === "iptal" ? "İptal edildi"
    : durum === "kayip" ? "Durum bilinmiyor"
    : "Üretilemedi";
  // Video sürerken sohbet modeli notu (sunucunun bildirdiği duruma göre)
  const videoNotu = tur === "video" && !isBitti
    ? (sohbetModeli?.durum === "bekliyor"
      ? "Sohbet modeli video için bellekten çıkarıldı; video bitince otomatik geri yüklenecek. Bu sırada Vega yanıt veremez."
      : "Video başlarken sohbet modeli (Vega'nın yanıtı bittikten sonra) bellekten çıkarılacak ve video bitince otomatik geri yüklenecek.")
    : "";

  return (
    <div className={`studyo-sohbet-karti durum-${durum}`} style={{ marginTop: 8, maxWidth: tur === "video" ? "min(460px, 100%)" : "min(420px, 100%)" }}>
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
            <strong style={{ fontSize: "0.86rem" }}>
              {bilgi.ad} {durum === "tamam" ? "hazır" : durum === "calisiyor" || durum === "sirada" ? "üretiliyor" : ""}
            </strong>
            <span style={{ ...kucukYazi, fontSize: "0.74rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={o.model || is.model}>
              Model: {modelAdi(o.model || is.model, modeller)}
              {(o.taban || is.taban) ? ` · taban: ${tabanAdi(o.taban || is.taban)}` : ""}
            </span>
          </div>
          {!isBitti && (
            <button type="button" onClick={iptalEt} disabled={mesgul} title="Üretimi iptal et" aria-label="Üretimi iptal et"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border-color)", borderRadius: 8,
                background: "transparent", color: "var(--md-sys-color-error, #d33)", cursor: "pointer", padding: "4px 8px", fontSize: "0.76rem" }}>
              <X size={13} /> İptal
            </button>
          )}
        </div>

        {(o.istem || is.istem) && (
          <div className="vega-gorsel-istem" title="Modele gönderilen İngilizce istem" style={{ margin: 0 }}>
            <span style={{ fontWeight: 600 }}>İstem: </span>{o.istem || is.istem}
            {(is.ozgunIstem || o.ozgunIstem) ? <div style={{ marginTop: 2 }}>Türkçe istek: {is.ozgunIstem || o.ozgunIstem}</div> : null}
          </div>
        )}

        {/* Model seçici (görsel akışındaki gibi): aynı türden birden çok kurulu model ya da video tabanı varsa */}
        {yenidenDugmesi && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {modelSecilebilir && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <label style={kucukYazi} htmlFor={`studyo-model-${is.id}`}>Model:</label>
                <select id={`studyo-model-${is.id}`} value={secilenModel} onChange={(e) => setSecilenModel(e.target.value)} disabled={mesgul} style={secimStili}>
                  {modeller.map((m) => <option key={m.id} value={m.id}>{m.name}{m.tier ? ` (${m.tier})` : ""}</option>)}
                </select>
              </div>
            )}
            {tabanSecilebilir && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <label style={kucukYazi} htmlFor={`studyo-taban-${is.id}`}>SD 1.5 tabanı:</label>
                <select id={`studyo-taban-${is.id}`} value={secilenTaban || o.taban || tabanlar[0]?.dosya || ""} onChange={(e) => setSecilenTaban(e.target.value)}
                  disabled={mesgul} style={secimStili}>
                  {tabanlar.map((t) => <option key={t.dosya} value={t.dosya}>{t.ad} ({t.boyutGb} GB){t.gercekci ? " — gerçekçi" : ""}</option>)}
                </select>
              </div>
            )}
            <div>
              <button type="button" className="vega-model-uret" disabled={mesgul || !secilenModel || (ayniAyar && !isBitti)}
                onClick={yenidenUret} title={isBitti ? "Aynı tarifle seçilen modelle yeniden üret" : "Süren üretimi iptal edip seçilen modelle yeniden başlat"}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <RefreshCw size={12} /> {isBitti ? "Bu modelle yeniden üret" : "Bu modelle üret"}
              </button>
            </div>
          </div>
        )}

        {!isBitti && (
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

        {videoNotu && <div style={{ ...kucukYazi, lineHeight: 1.4 }}>{videoNotu} Bu donanımda video uzun sürebilir.</div>}

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
              <span style={{ ...kucukYazi, fontSize: "0.72rem" }}>
                {[sonuc.duration ? `${sonuc.duration} sn` : "", sonuc.genDuration ? `üretim ${sonuc.genDuration}` : "",
                  `${bilgi.sayfa} sayfasında da görünür`].filter(Boolean).join(" · ")}
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
          <div style={{ display: "flex", alignItems: "center", gap: 6, ...kucukYazi, color: sohbetModeli.durum === "hata" ? "var(--md-sys-color-error, #d33)" : kucukYazi.color }}>
            {sohbetModeliBekliyor && durum !== "kayip" && <LoaderCircle size={13} className="progress-spinner" />}
            <span>
              {sohbetModeli.durum === "bekliyor" ? "Sohbet modeli yeniden yüklenecek…"
                : sohbetModeli.durum === "yukleniyor" ? `Sohbet modeli yeniden yükleniyor (${sohbetModeli.model})…`
                : sohbetModeli.durum === "hazir" ? `Sohbet modeli geri yüklendi (${sohbetModeli.model}).`
                : sohbetModeli.durum === "hata" ? `Sohbet modeli geri yüklenemedi: ${sohbetModeli.hata || "bilinmeyen hata"}. Model seçiciden yeniden yükleyebilirsiniz.`
                : sohbetModeli.durum === "atlandi" ? "Sohbet modeli o arada elle yüklendiği için otomatik geri yükleme atlandı." : ""}
            </span>
          </div>
        )}
        {islemHatasi && <div className="vega-gorsel-hata" style={{ margin: 0 }}>{islemHatasi}</div>}
      </div>
    </div>
  );
}

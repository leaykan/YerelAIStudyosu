// Video Stüdyosu (Yerel AI Stüdyosu)
// DD:YZ Sansürsüz Lokal AI Stüdyosu V2 (MIT, Tech Jarves / DD:YZ) kaynağından uyarlanmıştır
// (components/VideoStudio.jsx: metinden/görselden video modları, hızlı ilham şablonları, motor seçimi,
//  süre/çözünürlük ayarları, donanım rozetleri, oynatıcı, bilgi kartı ve galeri). V2'deki bulut (MiniMax)
// seçenekleri bu sürüme alınmadı; bulut anahtarları ayrı bir onay akışıyla eklenecek.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Film, FolderOpen, RefreshCw, Trash2, Upload } from "lucide-react";
import {
  dosyaIndir, kisaBoyut, studyoIptal, studyoKlasorAc, videoDurumu, videoGalerisi, videoModelleri, videoSil, videoUret,
} from "../services/studyoApi";
import { BilgiKutusu, DonanimRozeti, IlerlemeKarti, ModelKurulumKutusu, RENK, StudyoStilleri, UyariKutusu, useKurulumTakibi, Donen } from "./StudyoOrtak";

const ILHAM = [
  ["Okyanus ve gün batımı", "Dramatic cinematic drone shot of huge ocean waves crashing against rocky cliffs at golden hour sunset, slow motion, photorealistic"],
  ["Kozmik uzay gemisi", "Sleek futuristic spacecraft flying through a glowing colorful nebula in deep space, stardust particles, cinematic sci-fi scene, smooth camera panning"],
  ["Sarmal galaksi", "Slow rotating spiral galaxy with glowing core and dust lanes, stars twinkling, deep space, cinematic, photorealistic astronomy"],
  ["Kiraz çiçekleri", "Gentle pink cherry blossom petals falling across a peaceful Japanese garden path, sunlight streaming through trees, atmospheric, smooth motion"],
  ["Siberpunk gece", "Camera gliding through a neon-lit futuristic city with glowing holographic signs at night, rain reflections, cinematic"],
  ["Vahşi doğa (ağır çekim)", "Majestic lion walking through golden savanna grass, wind blowing mane, dramatic cinematic lighting, slow motion"],
];

// Motor başına seçenekler (işlemci için küçük ayarlar en üstte önerilir)
const AYARLAR = {
  animatediff: {
    cozunurluk: [["384x384", "384 x 384 (işlemci için önerilen)"], ["512x512", "512 x 512 (standart)"], ["512x320", "512 x 320 (yatay)"], ["320x512", "320 x 512 (dikey)"], ["256x256", "256 x 256 (çok hızlı, düşük kalite)"]],
    kare: [[8, "8 kare (≈1 sn @8 FPS)"], [12, "12 kare (≈1,5 sn)"], [16, "16 kare (≈2 sn, modelin eğitildiği uzunluk)"]],
    cpu: { cozunurluk: "384x384", kare: 8, adim: 10, cfg: 7.5 }, gpu: { cozunurluk: "512x512", kare: 16, adim: 20, cfg: 7.5 },
    adimAraligi: [4, 30], cfgAraligi: [1, 12],
  },
  "wan21-1.3b": {
    cozunurluk: [["416x240", "416 x 240 (işlemci denemesi, düşük kalite)"], ["832x480", "832 x 480 (480p, önerilen)"], ["480x832", "480 x 832 (dikey)"], ["624x624", "624 x 624 (kare)"]],
    kare: [[17, "17 kare (≈1 sn @16 FPS)"], [33, "33 kare (≈2 sn)"], [49, "49 kare (≈3 sn)"], [81, "81 kare (≈5 sn, en fazla)"]],
    cpu: { cozunurluk: "416x240", kare: 17, adim: 10, cfg: 5 }, gpu: { cozunurluk: "832x480", kare: 33, adim: 30, cfg: 5 },
    adimAraligi: [4, 50], cfgAraligi: [1, 10],
  },
  "wan21-14b": {
    cozunurluk: [["1280x720", "1280 x 720 (720p)"], ["720x1280", "720 x 1280 (dikey)"], ["960x960", "960 x 960 (kare)"]],
    kare: [[33, "33 kare (≈2 sn)"], [49, "49 kare (≈3 sn)"], [81, "81 kare (≈5 sn)"]],
    cpu: { cozunurluk: "1280x720", kare: 33, adim: 20, cfg: 5 }, gpu: { cozunurluk: "1280x720", kare: 49, adim: 30, cfg: 5 },
    adimAraligi: [4, 50], cfgAraligi: [1, 10],
  },
  "svd-xt": {
    cozunurluk: [["1024x576", "1024 x 576 (görselin yönüne göre otomatik)"]], kare: [[25, "25 kare (≈3 sn @8 FPS)"]],
    cpu: { cozunurluk: "1024x576", kare: 25, adim: 15, cfg: 1 }, gpu: { cozunurluk: "1024x576", kare: 25, adim: 25, cfg: 1 },
    adimAraligi: [4, 50], cfgAraligi: [1, 1],
  },
};

export default function VideoStudyosu({ showAlert, showConfirm, aktif = true }) {
  const [modeller, setModeller] = useState([]);
  const [tabanlar, setTabanlar] = useState([]);
  const [donanim, setDonanim] = useState(null);
  const [cevirmen, setCevirmen] = useState(false);
  const [mod, setMod] = useState("t2v");
  const [motor, setMotor] = useState("animatediff");
  const [taban, setTaban] = useState("");
  const [istem, setIstem] = useState("");
  const [negatif, setNegatif] = useState("");
  const [cozunurluk, setCozunurluk] = useState("384x384");
  const [kare, setKare] = useState(8);
  const [adim, setAdim] = useState(10);
  const [cfg, setCfg] = useState(7.5);
  const [fps, setFps] = useState(8);
  const [gorsel, setGorsel] = useState(null); // { veri: dataURL, ad }
  const [is, setIs] = useState(null);
  const [videolar, setVideolar] = useState([]);
  const [aktifVideo, setAktifVideo] = useState(null);
  const videoRef = useRef(null);
  const isIdRef = useRef("");
  const varsayilanUygulandi = useRef("");

  const gpuVar = donanim?.cuda === true;
  const secili = modeller.find((m) => m.id === motor);
  const ayar = AYARLAR[motor] || AYARLAR.animatediff;
  const calisiyor = Boolean(is && ["sirada", "calisiyor"].includes(is.durum));

  const modelleriYenile = useCallback(async () => {
    try {
      const v = await videoModelleri();
      setModeller(v.models || []);
      setTabanlar(v.tabanlar || []);
      setDonanim(v.donanim || null);
      setCevirmen(Boolean(v.cevirmen));
      setTaban((t) => (t && (v.tabanlar || []).some((x) => x.dosya === t) ? t : (v.tabanlar?.[0]?.dosya || "")));
    } catch (_) {}
  }, []);
  const galeriyiYenile = useCallback(async () => {
    try {
      const v = await videoGalerisi();
      setVideolar(v.videos || []);
      setAktifVideo((a) => a || v.videos?.[0] || null);
    } catch (_) {}
  }, []);
  const takip = useKurulumTakibi(modelleriYenile);

  useEffect(() => { if (aktif) { modelleriYenile(); galeriyiYenile(); } }, [aktif, modelleriYenile, galeriyiYenile]);

  // Motor ya da donanım değişince donanıma uygun varsayılan ayarlar (V2'deki "donanım koruması")
  useEffect(() => {
    const anahtar = `${motor}:${gpuVar}`;
    if (!donanim || varsayilanUygulandi.current === anahtar) return;
    varsayilanUygulandi.current = anahtar;
    const v = gpuVar ? ayar.gpu : ayar.cpu;
    setCozunurluk(v.cozunurluk); setKare(v.kare); setAdim(v.adim); setCfg(v.cfg);
  }, [motor, gpuVar, donanim, ayar]);

  // Süren video işini yakala (sayfa yeniden açıldıysa ya da Vega başlattıysa)
  useEffect(() => {
    if (!aktif || isIdRef.current) return;
    videoDurumu().then((v) => { if (v.active && v.job) { isIdRef.current = v.job.id; setIs(v.job); } }).catch(() => {});
  }, [aktif]);

  useEffect(() => {
    if (!is || !["sirada", "calisiyor"].includes(is.durum)) return undefined;
    const t = setInterval(async () => {
      try {
        const v = await videoDurumu(is.id);
        const j = v.job;
        if (!j) return;
        setIs(j);
        if (j.durum === "tamam" && j.sonuc) {
          isIdRef.current = "";
          setAktifVideo(j.sonuc);
          galeriyiYenile();
        } else if (j.durum === "hata") {
          isIdRef.current = "";
          showAlert?.({ title: "Video üretilemedi", message: j.hata || "Bilinmeyen hata", danger: true });
        } else if (j.durum === "iptal") {
          isIdRef.current = "";
        }
      } catch (_) {}
    }, 2000);
    return () => clearInterval(t);
  }, [is?.id, is?.durum, galeriyiYenile, showAlert]);

  const t2vModeller = useMemo(() => modeller.filter((m) => (m.modes || []).includes("t2v")), [modeller]);
  const i2vModeller = useMemo(() => modeller.filter((m) => (m.modes || []).includes("i2v")), [modeller]);

  const modDegistir = (yeni) => {
    setMod(yeni);
    const liste = yeni === "i2v" ? i2vModeller : t2vModeller;
    if (!liste.some((m) => m.id === motor)) setMotor(liste[0]?.id || (yeni === "i2v" ? "svd-xt" : "animatediff"));
  };

  const gorselYukle = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { showAlert?.({ title: "Görsel çok büyük", message: "En fazla 12 MB bir görsel seçin." }); return; }
    const r = new FileReader();
    r.onload = () => setGorsel({ veri: r.result, ad: f.name });
    r.readAsDataURL(f);
  };

  const uret = async () => {
    if (mod === "t2v" && !istem.trim()) { showAlert?.({ title: "Uyarı", message: "Lütfen bir video istemi girin." }); return; }
    if (mod === "i2v" && !gorsel) { showAlert?.({ title: "Başlangıç görseli gerekli", message: "Görselden video için önce bir görsel yükleyin." }); return; }
    if (!secili?.installed) { showAlert?.({ title: "Model kurulu değil", message: secili?.kurulabilir ? "Önce \"İndir ve kur\" düğmesiyle modeli kurun." : (secili?.notes || "Bu model bu sürümde indirilemez.") }); return; }
    if (motor === "animatediff" && !taban) { showAlert?.({ title: "Taban model gerekli", message: "app/models içinde bir SD 1.5 .safetensors model bulunamadı." }); return; }
    if (secili.uyari) {
      const ok = await showConfirm?.({
        title: secili.uyari.baslik,
        message: `${secili.uyari.neden}\n\n${secili.uyari.tahmin || ""}\n\nSeçilen ayarlar: ${cozunurluk}, ${kare} kare, ${adim} adım.\nÜretim sırasında bilgisayar yavaşlayabilir. Yine de denemek istiyor musunuz? Bellek yetmezse ya da süre aşılırsa işlem güvenle durdurulur.`,
        confirmLabel: "Yine de dene",
        cancelLabel: "Vazgeç",
        danger: secili.uyari.seviye === "onerilmez",
      });
      if (!ok) return;
    }
    try {
      const v = await videoUret({
        prompt: istem, negative_prompt: negatif, engine: motor, mode: mod, resolution: cozunurluk,
        frames: kare, steps: adim, guidance: cfg, fps, base: taban, inputImageBase64: mod === "i2v" ? gorsel?.veri : undefined,
      });
      isIdRef.current = v.job.id;
      setIs(v.job);
    } catch (err) {
      showAlert?.({ title: "Video üretimi başlatılamadı", message: err.message || String(err), danger: true });
    }
  };

  const iptal = async () => { try { if (is) await studyoIptal(is.id); } catch (_) {} };
  const klasoruAc = async (dosya = "") => {
    try { await studyoKlasorAc("video", dosya); } catch (err) { showAlert?.({ title: "Klasör açılamadı", message: err.message, danger: true }); }
  };
  const sil = async (v) => {
    const ok = await showConfirm?.({ title: "Video silinsin mi?", message: `"${v.prompt || v.filename}" kalıcı olarak silinecek.`, confirmLabel: "Sil", cancelLabel: "Vazgeç", danger: true });
    if (!ok) return;
    try {
      await videoSil(v.filename);
      if (aktifVideo?.filename === v.filename) setAktifVideo(null);
      galeriyiYenile();
    } catch (err) { showAlert?.({ title: "Silinemedi", message: err.message, danger: true }); }
  };

  const motorAdi = (id) => modeller.find((m) => m.id === id)?.name || id;

  return (
    <div className="workspace-area speech-workspace studyo-sayfa">
      <StudyoStilleri />
      <div className="workspace-title-section">
        <h2 className="workspace-title">Video Stüdyosu</h2>
        <p className="workspace-subtitle">Metinden (ya da görselden) kısa video klipleri yerel olarak üretin.</p>
        <div style={{ marginTop: "10px" }}><DonanimRozeti donanim={donanim} /></div>
      </div>

      {donanim && !gpuVar && (
        <BilgiKutusu renk={RENK.hata}>
          <strong>Ekran kartı (NVIDIA CUDA) bulunamadı:</strong> yerel video üretimi güçlü bir ekran kartı için tasarlanmıştır. İşlemciyle çalışır ama çok uzun sürer
          (küçük ayarlarla onlarca dakika, büyük ayarlarla saatler). Önce en küçük çözünürlük, az kare ve az adımla deneyin.
        </BilgiKutusu>
      )}

      <div className="speech-grid">
        {/* Sol panel: parametreler */}
        <section className="m3-card speech-panel">
          <div className="m3-segmented-button">
            <button type="button" className={`m3-segment-item ${mod === "t2v" ? "active" : ""}`} onClick={() => modDegistir("t2v")}>Metinden video</button>
            <button type="button" className={`m3-segment-item ${mod === "i2v" ? "active" : ""}`} onClick={() => modDegistir("i2v")}>Görselden video</button>
          </div>

          {mod === "i2v" && (
            <div>
              <div className="speech-label" style={{ marginBottom: "6px" }}>Başlangıç görseli</div>
              <label className="speech-capture-zone" style={{ cursor: "pointer", justifyContent: "center" }}>
                {gorsel ? (
                  <img src={gorsel.veri} alt="Başlangıç görseli" style={{ maxHeight: "140px", maxWidth: "100%", borderRadius: "8px" }} />
                ) : (
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><Upload size={18} /> Görsel seçmek için tıklayın</span>
                )}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={gorselYukle} style={{ display: "none" }} />
              </label>
              {gorsel && <button type="button" className="m3-btn m3-btn-outlined" style={{ marginTop: "6px" }} onClick={() => setGorsel(null)}>Görseli kaldır</button>}
            </div>
          )}

          <label className="speech-label">
            Video istemi
            <textarea className="m3-textarea" rows={3} value={istem} onChange={(e) => setIstem(e.target.value)} maxLength={1500}
              placeholder="Örn: Dramatic cinematic drone shot of huge ocean waves crashing against rocky cliffs at golden hour sunset, slow motion..."
              style={{ width: "100%", resize: "vertical", lineHeight: 1.45, minHeight: "90px" }} />
          </label>
          <div className="text-progress">
            {cevirmen ? "Türkçe istemler üretimden önce otomatik olarak İngilizceye çevrilir." : "Video modelleri İngilizce anlar: istemi İngilizce yazın (Türkçe yazılırsa sonuç tarife uymayabilir)."}
          </div>
          <div>
            <div className="speech-label" style={{ marginBottom: "6px" }}>Hızlı ilham (hazır şablonlar)</div>
            <div className="studyo-ilham" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {ILHAM.map(([ad, metin]) => (
                <button key={ad} type="button" className="m3-btn m3-btn-outlined" style={{ fontSize: "0.74rem", padding: "4px 10px" }} onClick={() => setIstem(metin)} title={metin}>{ad}</button>
              ))}
            </div>
          </div>

          <label className="speech-label">
            Video modeli / motoru
            <select className="m3-input" value={motor} onChange={(e) => setMotor(e.target.value)} title={secili ? `${secili.name} — ${secili.tierLabel || ""}` : ""}>
              {(mod === "i2v" ? i2vModeller : t2vModeller).map((m) => (
                <option key={m.id} value={m.id} title={`${m.name} — ${m.tierLabel || ""}`}>
                  {m.name} — {m.installed ? "hazır" : m.kurulabilir ? kisaBoyut(m.approxSize) : "indirme kapalı"}{m.uyari?.seviye === "onerilmez" && !m.installed ? " (önerilmez)" : ""}
                </option>
              ))}
              {!modeller.length && <option value="animatediff">AnimateDiff v1.5 v2 + SD 1.5</option>}
            </select>
            {secili && (
              <span className="studyo-model-alt">
                {[secili.tierLabel, secili.resolution, secili.approxSize && `boyut ${secili.approxSize}`].filter(Boolean).join(" • ")}
              </span>
            )}
          </label>
          <ModelKurulumKutusu model={secili} takip={takip} showAlert={showAlert} showConfirm={showConfirm}
            ekNot={motor === "animatediff" ? (tabanlar.length ? `Taban model olarak bilgisayarınızdaki SD 1.5 modellerinden biri kullanılır (${tabanlar.length} adet bulundu).` : "Ayrıca app/models içinde bir SD 1.5 .safetensors görsel modeli gerekir.") : ""} />
          <UyariKutusu uyari={secili?.uyari} />

          {motor === "animatediff" && (
            <label className="speech-label">
              Taban görsel modeli (SD 1.5)
              <select className="m3-input" value={taban} onChange={(e) => setTaban(e.target.value)}>
                {tabanlar.map((t) => <option key={t.dosya} value={t.dosya}>{t.ad} ({t.boyutGb} GB){t.gercekci ? " — gerçekçi" : ""}</option>)}
                {!tabanlar.length && <option value="">app/models içinde SD 1.5 model bulunamadı</option>}
              </select>
            </label>
          )}

          <div className="speech-controls-row">
            <label className="speech-label">
              Çözünürlük
              <select className="m3-input" value={cozunurluk} onChange={(e) => setCozunurluk(e.target.value)}>
                {ayar.cozunurluk.map(([d, ad]) => <option key={d} value={d}>{ad}</option>)}
              </select>
            </label>
            <label className="speech-label">
              Uzunluk
              <select className="m3-input" value={kare} onChange={(e) => setKare(Number(e.target.value))}>
                {ayar.kare.map(([d, ad]) => <option key={d} value={d}>{ad}</option>)}
              </select>
            </label>
          </div>

          <details>
            <summary style={{ cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Gelişmiş ayarlar (adım, CFG, FPS, negatif istem)</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <label className="speech-label">
                Adım sayısı: {adim} <span style={{ fontWeight: 400 }}>(az adım = hızlı ama daha kaba)</span>
                <input className="m3-slider" type="range" min={ayar.adimAraligi[0]} max={ayar.adimAraligi[1]} value={adim} onChange={(e) => setAdim(Number(e.target.value))} />
              </label>
              {ayar.cfgAraligi[1] > 1 && (
                <label className="speech-label">
                  İstem bağlılığı (CFG): {cfg}
                  <input className="m3-slider" type="range" min={ayar.cfgAraligi[0]} max={ayar.cfgAraligi[1]} step={0.5} value={cfg} onChange={(e) => setCfg(Number(e.target.value))} />
                </label>
              )}
              {motor === "animatediff" && (
                <label className="speech-label">
                  Kare hızı (FPS): {fps}
                  <input className="m3-slider" type="range" min={4} max={16} value={fps} onChange={(e) => setFps(Number(e.target.value))} />
                </label>
              )}
              {mod === "t2v" && (
                <label className="speech-label">
                  Negatif istem (boş bırakılırsa modelin varsayılanı)
                  <textarea className="m3-textarea" rows={2} value={negatif} onChange={(e) => setNegatif(e.target.value)} maxLength={1000} style={{ width: "100%", resize: "vertical" }} />
                </label>
              )}
            </div>
          </details>

          <button type="button" className="m3-btn m3-btn-filled" onClick={uret} disabled={calisiyor || !secili?.installed} style={{ justifyContent: "center", height: "46px" }}>
            {calisiyor ? <Donen size={16} /> : <Film size={16} />}
            <span>{calisiyor ? `Video üretiliyor... %${is.ilerleme || 0}` : "Videoyu üret"}</span>
          </button>
          {secili?.lisans && <div className="text-progress">Lisans: {secili.lisans}</div>}
        </section>

        {/* Sağ panel: oynatıcı */}
        <section className="m3-card speech-result-panel">
          <div className="speech-panel-header">
            <h3>Önizleme ve oynatıcı</h3>
            {aktifVideo && (
              <div className="speech-button-row">
                <button type="button" className="m3-btn m3-btn-outlined" onClick={() => dosyaIndir(aktifVideo.url, aktifVideo.filename)}><Download size={14} /><span>MP4</span></button>
                <button type="button" className="m3-btn m3-btn-outlined" onClick={() => klasoruAc(aktifVideo.filename)}><FolderOpen size={14} /><span>Klasöre git</span></button>
              </div>
            )}
          </div>
          <IlerlemeKarti is={is} baslik={`Video üretimi — ${motorAdi(is?.model)}`} onIptal={iptal} />
          {aktifVideo ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--md-sys-color-outline-variant)", background: "var(--md-sys-color-surface-variant)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  <span className="status-chip">VİDEO MODELİ • {aktifVideo.engineName || motorAdi(aktifVideo.engine) || "Bilinmiyor"}</span>
                  {aktifVideo.genDuration && <strong style={{ color: "var(--md-sys-color-success, #10b981)", fontSize: "0.8rem" }}>{aktifVideo.genDuration} üretim süresi</strong>}
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-on-surface-variant)", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {aktifVideo.resolution && <span><strong>Ölçek ve hız:</strong> {aktifVideo.resolution}{aktifVideo.fps ? ` @ ${aktifVideo.fps} FPS` : ""}</span>}
                  {aktifVideo.frames ? <span><strong>Kare:</strong> {aktifVideo.frames} (≈{aktifVideo.duration} sn)</span> : null}
                  {aktifVideo.steps ? <span><strong>Adım:</strong> {aktifVideo.steps}</span> : null}
                  {aktifVideo.base ? <span><strong>Taban:</strong> {aktifVideo.base}</span> : null}
                  {aktifVideo.mode && <span style={{ color: "var(--md-sys-color-primary)", fontWeight: 600 }}>{aktifVideo.mode === "i2v" ? "Görselden video" : "Metinden video"}</span>}
                  {aktifVideo.device ? <span><strong>Cihaz:</strong> {aktifVideo.device === "cuda" ? "Ekran kartı" : "İşlemci"}</span> : null}
                </div>
                {aktifVideo.prompt && <div style={{ fontSize: "0.8rem", fontStyle: "italic" }}>"{aktifVideo.prompt}"</div>}
                {aktifVideo.effectivePrompt && aktifVideo.effectivePrompt !== aktifVideo.prompt && <div style={{ fontSize: "0.74rem", color: "var(--md-sys-color-on-surface-variant)" }}>Modele giden İngilizce istem: {aktifVideo.effectivePrompt}</div>}
              </div>
              <div style={{ background: "#000", borderRadius: "10px", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "260px", overflow: "hidden" }}>
                <video key={aktifVideo.url} ref={videoRef} src={aktifVideo.url} controls loop autoPlay muted playsInline style={{ maxWidth: "100%", maxHeight: "460px" }} />
              </div>
            </>
          ) : (
            !calisiyor && (
              <div className="empty-state" style={{ padding: "32px 0" }}>
                <Film size={42} />
                <p>Henüz bir video üretilmedi. İstemi yazıp "Videoyu üret"e basın.</p>
              </div>
            )
          )}
        </section>
      </div>

      {/* Galeri */}
      <section className="m3-card speech-result-panel">
        <div className="speech-panel-header">
          <h3>Üretilen videolar ({videolar.length})</h3>
          <div className="speech-button-row">
            <button type="button" className="m3-btn m3-btn-outlined" onClick={() => klasoruAc("")}><FolderOpen size={14} /><span>Klasöre git</span></button>
            <button type="button" className="m3-btn m3-btn-outlined" onClick={galeriyiYenile}><RefreshCw size={14} /><span>Yenile</span></button>
          </div>
        </div>
        {videolar.length === 0 ? (
          <div className="text-progress">Galeri boş.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "12px" }}>
            {videolar.map((v) => (
              <div key={v.url} style={{ border: `1px solid ${aktifVideo?.url === v.url ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline-variant)"}`, borderRadius: "10px", overflow: "hidden", background: "var(--md-sys-color-surface-variant)" }}>
                <div onClick={() => setAktifVideo(v)} style={{ cursor: "pointer" }} title={v.prompt || v.filename}>
                  <video src={v.url} muted playsInline preload="metadata" style={{ width: "100%", height: "100px", objectFit: "cover", display: "block", background: "#000" }} />
                  <div style={{ padding: "6px 8px", fontSize: "0.74rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.prompt || v.filename}</div>
                  <div style={{ padding: "0 8px 4px", fontSize: "0.68rem", color: "var(--md-sys-color-on-surface-variant)" }}>{[v.engineName || v.engine, v.size].filter(Boolean).join(" • ")}</div>
                </div>
                <div style={{ display: "flex", gap: "4px", padding: "0 6px 6px" }}>
                  <button type="button" className="m3-btn m3-btn-outlined" style={{ padding: "6px", flex: 1, justifyContent: "center" }} onClick={() => dosyaIndir(v.url, v.filename)} title="İndir"><Download size={13} /></button>
                  <button type="button" className="m3-btn m3-btn-outlined" style={{ padding: "6px", flex: 1, justifyContent: "center" }} onClick={() => klasoruAc(v.filename)} title="Klasörde göster"><FolderOpen size={13} /></button>
                  <button type="button" className="m3-btn m3-btn-error" style={{ padding: "6px", flex: 1, justifyContent: "center" }} onClick={() => sil(v)} title="Sil"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

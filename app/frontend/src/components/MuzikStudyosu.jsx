// Müzik ve Ses Efekti Stüdyosu (Yerel AI Stüdyosu)
// DD:YZ Sansürsüz Lokal AI Stüdyosu V2 (MIT, Tech Jarves / DD:YZ) kaynağından uyarlanmıştır
// (components/AudioStudio.jsx: Müzik Üretimi ve Ses Efekti sekmeleri, ilham şablonları, süre seçici,
//  oynatıcı, üretim bilgi kartı ve geçmiş listesi). Seslendirme (TTS) sekmesi yerine mevcut
// "Metinden Sese" sayfasına bağlantı verilir.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, FolderOpen, Music, Pause, Play, RefreshCw, Trash2, Volume2, Wand2, ExternalLink } from "lucide-react";
import {
  dosyaIndir, kisaBoyut, muzikModelleri, muzikUret, sesGecmisi, sesIlerleme, sesSil, studyoIptal, studyoKlasorAc,
} from "../services/studyoApi";
import { BilgiKutusu, DonanimRozeti, IlerlemeKarti, ModelKurulumKutusu, StudyoStilleri, UyariKutusu, useKurulumTakibi, Donen } from "./StudyoOrtak";

const MUZIK_ILHAM = [
  ["Lofi Hip-Hop (çalışma ve odaklanma)", "Chill lofi hip-hop beat, soft vintage electric piano chords, warm vinyl crackle, mellow bassline, relaxed study music, 85 bpm"],
  ["Synthwave 80'ler (gece sürüşü)", "80s synthwave electronic track with punchy analog synthesizer, retro drum machine, driving bassline, neon night drive vibe, 120 bpm"],
  ["Sinematik epik orkestra (film müziği)", "Epic cinematic orchestral music, powerful brass and strings crescendo, dramatic percussion, adventure movie soundtrack"],
  ["Akustik kafe cazı (huzurlu melodi)", "Warm acoustic guitar and smooth upright double bass jazz melody, cozy coffee shop ambience, peaceful and uplifting"],
  ["Anadolu bağlama ve ney (duygusal)", "Emotional Anatolian folk instrumental music, warm acoustic baglama lute and mystical ney reed flute melody, calm atmospheric studio recording"],
];
const EFEKT_ILHAM = [
  ["Gök gürültüsü ve sağanak fırtına", "Loud thunderclap rumble, lightning strike, heavy rain downpour and howling storm wind, realistic field recording"],
  ["Spor araba motoru ve patinaj", "Powerful V8 sports car engine roaring, aggressive revving, tires screeching and skidding on asphalt, high quality foley"],
  ["Sinematik büyük patlama", "Massive cinematic explosion boom, deep sub-bass shockwave blast, falling debris and fire crackle"],
  ["Kırılan cam ve çarpma", "Heavy impact crash followed by large glass window shattering and glass shards hitting the floor, crisp foley sound effect"],
  ["Bilim kurgu lazer ve uzay", "Futuristic sci-fi plasma laser gun firing zaps, energy shield hum and deep space cockpit mechanical whoosh"],
  ["Doğa: kuş sesleri ve dere", "Peaceful forest nature ambience, birds chirping and singing in trees, gentle wind and clear flowing water stream"],
  ["Korku: kapı gıcırtısı ve ayak sesi", "Slow footsteps walking on wooden floor, creepy old wooden door creaking open, dark horror suspense atmosphere"],
  ["Orta Çağ kılıç ve zırh", "Sharp metallic sword clash, steel blade slash and heavy knight armor impact, realistic combat foley"],
];
const SURELER = [[5, "5 sn (hızlı önizleme)"], [10, "10 sn (kısa jingle)"], [15, "15 sn (story)"], [20, "20 sn (tanıtım)"], [30, "30 sn (standart klip)"],
  [45, "45 sn"], [60, "60 sn (1 dk)"], [90, "90 sn"], [120, "120 sn (2 dk)"], [180, "180 sn (3 dk)"], [240, "240 sn (4 dk)"], [300, "300 sn (5 dk)"]];

// Seçim kutusunda kısa ad (uzun boyut açıklamaları alt satırda gösterilir)
const secenekAdi = (m) => `${m.name} — ${m.installed ? "hazır" : kisaBoyut(m.approxSize) || "kurulu değil"}`;
const modelAltBilgi = (m) => (m ? [m.resolution, m.format, m.approxSize && `boyut ${m.approxSize}`].filter(Boolean).join(" • ") : "");

const sureYazi = (s) => (s >= 60 ? `${Math.floor(s / 60)} dk${s % 60 ? ` ${s % 60} sn` : ""}` : `${s} sn`);

export default function MuzikStudyosu({ showAlert, showConfirm, aktif = true, onGoToTts }) {
  const [altSekme, setAltSekme] = useState("muzik"); // muzik | efekt
  const [modeller, setModeller] = useState([]);
  const [donanim, setDonanim] = useState(null);
  const [muzikModeli, setMuzikModeli] = useState("musicgen-small");
  const [efektModeli, setEfektModeli] = useState("audioldm-s");
  const [muzikIstemi, setMuzikIstemi] = useState("");
  const [muzikSuresi, setMuzikSuresi] = useState(15);
  const [efektIstemi, setEfektIstemi] = useState("");
  const [efektSuresi, setEfektSuresi] = useState(6);
  const [is, setIs] = useState(null);
  const [secili, setSecili] = useState(null); // oynatıcıdaki kayıt
  const [gecmis, setGecmis] = useState([]);
  const [caliyor, setCaliyor] = useState(false);
  const sesRef = useRef(null);
  const isIdRef = useRef("");

  const modelleriYenile = useCallback(async () => {
    try {
      const v = await muzikModelleri();
      setModeller(v.models || []);
      setDonanim(v.donanim || null);
    } catch (_) {}
  }, []);
  const gecmisiYenile = useCallback(async () => {
    try { setGecmis((await sesGecmisi()).items || []); } catch (_) {}
  }, []);
  const takip = useKurulumTakibi(modelleriYenile);

  useEffect(() => { if (aktif) { modelleriYenile(); gecmisiYenile(); } }, [aktif, modelleriYenile, gecmisiYenile]);

  // Açılışta (ya da Vega bir iş başlattıysa) süren müzik/efekt işini yakala
  useEffect(() => {
    if (!aktif || isIdRef.current) return;
    sesIlerleme().then((v) => { if (v.active && v.job) { isIdRef.current = v.job.id; setIs(v.job); } }).catch(() => {});
  }, [aktif]);

  // İş ilerlemesini izle
  useEffect(() => {
    if (!is || !["sirada", "calisiyor"].includes(is.durum)) return undefined;
    const t = setInterval(async () => {
      try {
        const v = await sesIlerleme(is.id);
        const j = v.job;
        if (!j) return;
        setIs(j);
        if (j.durum === "tamam" && j.sonuc) {
          isIdRef.current = "";
          setSecili(j.sonuc);
          gecmisiYenile();
          setTimeout(() => sesRef.current?.play().catch(() => {}), 150);
        } else if (j.durum === "hata") {
          isIdRef.current = "";
          showAlert?.({ title: j.tur === "efekt" ? "Ses efekti üretilemedi" : "Müzik üretilemedi", message: j.hata || "Bilinmeyen hata", danger: true });
        } else if (j.durum === "iptal") {
          isIdRef.current = "";
        }
      } catch (_) {}
    }, 1000);
    return () => clearInterval(t);
  }, [is?.id, is?.durum, gecmisiYenile, showAlert]);

  const muzikListesi = modeller.filter((m) => m.tur === "muzik");
  const efektListesi = modeller.filter((m) => m.tur === "efekt");
  const seciliModel = modeller.find((m) => m.id === (altSekme === "muzik" ? muzikModeli : efektModeli));
  const calisiyor = Boolean(is && ["sirada", "calisiyor"].includes(is.durum));
  const desteksiz = modeller.filter((m) => !m.supported && m.tur === (altSekme === "muzik" ? "muzik" : "efekt"));

  const uret = async () => {
    const efekt = altSekme === "efekt";
    const istem = (efekt ? efektIstemi : muzikIstemi).trim();
    if (!istem) {
      showAlert?.({ title: "Uyarı", message: efekt ? "Lütfen üretmek istediğiniz ses efektini tarif edin (Türkçe veya İngilizce)." : "Lütfen bir müzik istemi girin." });
      return;
    }
    if (!seciliModel?.installed) {
      showAlert?.({ title: "Model kurulu değil", message: "Önce yukarıdaki \"İndir ve kur\" düğmesiyle modeli kurun." });
      return;
    }
    if (seciliModel.uyari?.seviye === "onerilmez") {
      const ok = await showConfirm?.({
        title: seciliModel.uyari.baslik,
        message: `${seciliModel.uyari.neden}\n\n${seciliModel.uyari.tahmin || ""}\n\nYine de denemek istiyor musunuz? Bellek yetmezse ya da süre aşılırsa işlem güvenle durdurulur.`,
        confirmLabel: "Yine de dene",
        cancelLabel: "Vazgeç",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const sure = efekt ? efektSuresi : Math.min(muzikSuresi, seciliModel.maxDuration || 300);
      const v = await muzikUret({ prompt: istem, duration: sure, model: seciliModel.id, mode: efekt ? "sfx" : "music" });
      isIdRef.current = v.job.id;
      setIs(v.job);
    } catch (err) {
      showAlert?.({ title: "Üretim başlatılamadı", message: err.message || String(err), danger: true });
    }
  };

  const iptal = async () => { try { if (is) await studyoIptal(is.id); } catch (_) {} };
  const klasoruAc = async (dosya = "") => {
    try { await studyoKlasorAc("muzik", dosya); } catch (err) { showAlert?.({ title: "Klasör açılamadı", message: err.message, danger: true }); }
  };
  const sil = async (kayit) => {
    const ok = await showConfirm?.({ title: "Kayıt silinsin mi?", message: `"${kayit.prompt || kayit.filename}" kalıcı olarak silinecek.`, confirmLabel: "Sil", cancelLabel: "Vazgeç", danger: true });
    if (!ok) return;
    try {
      await sesSil(kayit.filename);
      if (secili?.filename === kayit.filename) setSecili(null);
      gecmisiYenile();
    } catch (err) { showAlert?.({ title: "Silinemedi", message: err.message, danger: true }); }
  };
  const sec = (kayit) => {
    if (secili?.url === kayit.url && sesRef.current) {
      if (caliyor) sesRef.current.pause(); else sesRef.current.play().catch(() => {});
      return;
    }
    setSecili(kayit);
    setTimeout(() => sesRef.current?.play().catch(() => {}), 120);
  };

  const sekmeDugmesi = (id, etiket, ikon) => (
    <button type="button" className={`m3-segment-item ${altSekme === id ? "active" : ""}`} onClick={() => setAltSekme(id)}>
      {ikon} {etiket}
    </button>
  );

  return (
    <div className="workspace-area speech-workspace studyo-sayfa">
      <StudyoStilleri />
      <div className="workspace-title-section">
        <h2 className="workspace-title">Müzik ve Ses Efekti Stüdyosu</h2>
        <p className="workspace-subtitle">
          Yazdığınız tarife göre yerel olarak enstrümantal müzik ve ses efekti üretin. Türkçe ya da İngilizce yazabilirsiniz.
        </p>
        <div style={{ marginTop: "10px" }}><DonanimRozeti donanim={donanim} /></div>
      </div>

      <div className="speech-grid">
        {/* Sol panel: kontroller */}
        <section className="m3-card speech-panel">
          <div className="m3-segmented-button">
            {sekmeDugmesi("muzik", "Müzik Üretimi", <Music size={14} />)}
            {sekmeDugmesi("efekt", "Ses Efekti (SFX)", <Wand2 size={14} />)}
            <button type="button" className="m3-segment-item" onClick={() => onGoToTts?.()} title="Seslendirme için Metinden Sese sayfasını aç">
              <Volume2 size={14} /> Seslendirme <ExternalLink size={12} />
            </button>
          </div>

          {altSekme === "muzik" ? (
            <>
              <BilgiKutusu>
                <strong>Meta MusicGen:</strong> Türkçe veya İngilizce tarifinize göre enstrümantal fon müziği, melodi ve ritim üretir (şarkı sözü/vokal üretmez).
              </BilgiKutusu>
              <label className="speech-label">
                Müzik modeli
                <select className="m3-input" value={muzikModeli} onChange={(e) => setMuzikModeli(e.target.value)} title={seciliModel?.name || ""}>
                  {muzikListesi.filter((m) => m.supported).map((m) => (
                    <option key={m.id} value={m.id} title={m.name}>{secenekAdi(m)}</option>
                  ))}
                  {!muzikListesi.length && <option value="musicgen-small">Meta MusicGen Small (300M)</option>}
                </select>
                {seciliModel && <span className="studyo-model-alt">{modelAltBilgi(seciliModel)}</span>}
              </label>
              <ModelKurulumKutusu model={seciliModel} takip={takip} showAlert={showAlert} showConfirm={showConfirm} />
              <UyariKutusu uyari={seciliModel?.uyari} />

              <label className="speech-label">
                Müzik istemi (Türkçe veya İngilizce)
                <textarea className="m3-textarea" rows={4} value={muzikIstemi} onChange={(e) => setMuzikIstemi(e.target.value)} maxLength={1000}
                  placeholder="Örn: Epik sinematik orkestra müziği, keman ve davullar... ya da Chill lofi hip-hop beat, soft electric piano, 85 bpm"
                  style={{ width: "100%", resize: "vertical", lineHeight: 1.45, minHeight: "90px" }} />
              </label>
              <div>
                <div className="speech-label" style={{ marginBottom: "6px" }}>Müzik ilhamı</div>
                <div className="studyo-ilham" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {MUZIK_ILHAM.map(([ad, metin]) => (
                    <button key={ad} type="button" className="m3-btn m3-btn-outlined" style={{ fontSize: "0.74rem", padding: "4px 10px" }} onClick={() => setMuzikIstemi(metin)} title={metin}>{ad}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span className="speech-label" style={{ flex: "none" }}>Parça uzunluğu</span>
                  <strong style={{ color: "var(--md-sys-color-primary)", fontSize: "0.85rem" }}>{sureYazi(muzikSuresi)}</strong>
                </div>
                <div className="speech-controls-row">
                  <select className="m3-input" style={{ flex: "1 1 160px" }} value={SURELER.some(([s]) => s === muzikSuresi) ? muzikSuresi : "ozel"}
                    onChange={(e) => e.target.value !== "ozel" && setMuzikSuresi(Number(e.target.value))}>
                    {SURELER.filter(([s]) => s <= (seciliModel?.maxDuration || 300)).map(([s, ad]) => <option key={s} value={s}>{ad}</option>)}
                    <option value="ozel">Özel süre...</option>
                  </select>
                  <input className="m3-input" type="number" min={3} max={seciliModel?.maxDuration || 300} value={muzikSuresi} style={{ width: "80px" }}
                    onChange={(e) => setMuzikSuresi(Math.max(3, Math.min(seciliModel?.maxDuration || 300, Number(e.target.value) || 15)))} title="Özel süre (saniye)" />
                </div>
                <input className="m3-slider" type="range" min={3} max={seciliModel?.maxDuration || 300} step={1} value={muzikSuresi}
                  onChange={(e) => setMuzikSuresi(Number(e.target.value))} style={{ width: "100%", marginTop: "8px" }} />
                {muzikSuresi > 30 && <div className="text-progress" style={{ marginTop: "4px" }}>30 sn'den uzun parçalar 25 sn'lik bölümlerin yumuşak geçişle birleştirilmesiyle üretilir; süre uzadıkça üretim süresi de doğrusal artar.</div>}
              </div>
            </>
          ) : (
            <>
              <BilgiKutusu>
                <strong>AudioLDM-S (foley ve ses efekti motoru):</strong> Müzik karıştırmadan, tarifinize göre ses efekti, ambiyans ve foley sesleri üretir. Türkçe terimler (gök gürültüsü, yağmur, patlama, ayak sesi...) otomatik çevrilir.
              </BilgiKutusu>
              <label className="speech-label">
                Ses efekti modeli
                <select className="m3-input" value={efektModeli} onChange={(e) => setEfektModeli(e.target.value)} title={seciliModel?.name || ""}>
                  {efektListesi.filter((m) => m.supported).map((m) => (
                    <option key={m.id} value={m.id} title={m.name}>{secenekAdi(m)}</option>
                  ))}
                  {!efektListesi.length && <option value="audioldm-s">AudioLDM-S Full v2</option>}
                </select>
                {seciliModel && <span className="studyo-model-alt">{modelAltBilgi(seciliModel)}</span>}
              </label>
              <ModelKurulumKutusu model={seciliModel} takip={takip} showAlert={showAlert} showConfirm={showConfirm} />
              <UyariKutusu uyari={seciliModel?.uyari} />

              <label className="speech-label">
                Ses efekti tarifi (Türkçe veya İngilizce)
                <textarea className="m3-textarea" rows={4} value={efektIstemi} onChange={(e) => setEfektIstemi(e.target.value)} maxLength={1000}
                  placeholder="Örn: Şiddetli gök gürültüsü ve sağanak yağmur, araba motoru ve patinaj sesi, kırılan cam..."
                  style={{ width: "100%", resize: "vertical", lineHeight: 1.45, minHeight: "90px" }} />
              </label>
              <div>
                <div className="speech-label" style={{ marginBottom: "6px" }}>Hazır ses efekti şablonları</div>
                <div className="studyo-ilham" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {EFEKT_ILHAM.map(([ad, metin]) => (
                    <button key={ad} type="button" className="m3-btn m3-btn-outlined" style={{ fontSize: "0.74rem", padding: "4px 10px" }} onClick={() => setEfektIstemi(metin)} title={metin}>{ad}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span className="speech-label" style={{ flex: "none" }}>Efekt süresi</span>
                  <strong style={{ color: "var(--md-sys-color-primary)", fontSize: "0.85rem" }}>{efektSuresi} sn</strong>
                </div>
                <input className="m3-slider" type="range" min={2} max={20} step={1} value={efektSuresi} onChange={(e) => setEfektSuresi(Number(e.target.value))} style={{ width: "100%" }} />
              </div>
            </>
          )}

          {desteksiz.length > 0 && (
            <details style={{ fontSize: "0.78rem", color: "var(--md-sys-color-on-surface-variant)" }}>
              <summary style={{ cursor: "pointer" }}>V2'deki diğer modeller neden yok?</summary>
              {desteksiz.map((m) => <p key={m.id} style={{ margin: "6px 0" }}><strong>{m.name}:</strong> {m.notes}</p>)}
            </details>
          )}

          <div className="speech-button-row">
            <button type="button" className="m3-btn m3-btn-filled" onClick={uret} disabled={calisiyor || !seciliModel?.installed} style={{ flex: 1, justifyContent: "center", height: "44px" }}>
              {calisiyor ? <Donen size={16} /> : altSekme === "muzik" ? <Music size={16} /> : <Wand2 size={16} />}
              <span>{calisiyor ? `Üretiliyor... %${is.ilerleme || 0}` : altSekme === "muzik" ? "Müziği üret" : "Ses efektini üret"}</span>
            </button>
          </div>
          {seciliModel?.lisans && <div className="text-progress">Lisans: {seciliModel.lisans}</div>}
        </section>

        {/* Sağ panel: ilerleme, oynatıcı ve bilgi kartı */}
        <section className="m3-card speech-result-panel">
          <div className="speech-panel-header">
            <h3>Ses oynatıcı ve çıktı</h3>
            {secili && (
              <div className="speech-button-row">
                <button type="button" className="m3-btn m3-btn-outlined" onClick={() => dosyaIndir(secili.url, secili.filename)}><Download size={14} /><span>WAV</span></button>
                <button type="button" className="m3-btn m3-btn-outlined" onClick={() => klasoruAc(secili.filename)}><FolderOpen size={14} /><span>Klasöre git</span></button>
              </div>
            )}
          </div>
          <IlerlemeKarti is={is} baslik={is?.tur === "efekt" ? "Ses efekti üretimi" : "Yapay zekâ müzik üretimi"} onIptal={iptal} />
          {secili ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--md-sys-color-outline-variant)", background: "var(--md-sys-color-surface-variant)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  <span className="status-chip">{secili.isSfx ? "SES EFEKTİ" : "MÜZİK"} • {secili.modelName || secili.model}</span>
                  {secili.genDuration && <strong style={{ color: "var(--md-sys-color-success, #10b981)", fontSize: "0.8rem" }}>{secili.genDuration} üretim süresi</strong>}
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-on-surface-variant)", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <span><strong>Biçim:</strong> {secili.sampleRate || (secili.isSfx ? 16000 : 32000)} Hz • 16-bit PCM WAV • {(secili.channels || 1) > 1 ? "Stereo" : "Mono"}</span>
                  {secili.duration ? <span><strong>Süre:</strong> {secili.duration} sn</span> : null}
                  {secili.seed ? <span><strong>Tohum:</strong> {secili.seed}</span> : null}
                  {secili.device ? <span><strong>Cihaz:</strong> {secili.device === "cuda" ? "Ekran kartı" : "İşlemci"}</span> : null}
                </div>
                <div style={{ fontSize: "0.8rem", fontStyle: "italic" }}>"{secili.prompt}"</div>
                {secili.effectivePrompt && secili.effectivePrompt !== secili.prompt && (
                  <div style={{ fontSize: "0.74rem", color: "var(--md-sys-color-on-surface-variant)" }}>Modele giden İngilizce istem: {secili.effectivePrompt}</div>
                )}
                {!secili.warning && secili.silenceRepairs > 0 && (
                  <div style={{ fontSize: "0.74rem", color: "var(--md-sys-color-on-surface-variant)" }}>Model bir noktada sessizliğe düştü; müzik o noktadan devam ettirilerek istenen süreye tamamlandı.</div>
                )}
              </div>
              {secili.warning && <UyariKutusu uyari={{ baslik: "Sessizlik uyarısı", neden: secili.warning }} />}
              <audio ref={sesRef} src={secili.url} controls style={{ width: "100%" }} onPlay={() => setCaliyor(true)} onPause={() => setCaliyor(false)} onEnded={() => setCaliyor(false)} />
            </>
          ) : (
            !calisiyor && (
              <div className="empty-state" style={{ padding: "32px 0" }}>
                <Volume2 size={42} />
                <p>Henüz seçili bir ses yok. Üretilen ses burada çalınır.</p>
              </div>
            )
          )}
        </section>
      </div>

      {/* Geçmiş */}
      <section className="m3-card speech-result-panel">
        <div className="speech-panel-header">
          <h3>Geçmiş müzik ve ses efekti üretimleri ({gecmis.length})</h3>
          <div className="speech-button-row">
            <button type="button" className="m3-btn m3-btn-outlined" onClick={() => klasoruAc("")}><FolderOpen size={14} /><span>Klasöre git</span></button>
            <button type="button" className="m3-btn m3-btn-outlined" onClick={gecmisiYenile}><RefreshCw size={14} /><span>Yenile</span></button>
          </div>
        </div>
        {gecmis.length === 0 ? (
          <div className="text-progress">Henüz kaydedilmiş bir müzik veya efekt yok.</div>
        ) : (
          <div className="speech-history-list">
            {gecmis.map((k) => {
              const buMu = secili?.url === k.url;
              return (
                <div key={k.url} className="speech-history-item" style={buMu ? { borderColor: "var(--md-sys-color-primary)" } : undefined}>
                  <button type="button" className="m3-btn m3-btn-tonal" onClick={() => sec(k)} title={buMu && caliyor ? "Durdur" : "Çal"} style={{ padding: "8px" }}>
                    {buMu && caliyor ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <div style={{ flex: 1, cursor: "pointer" }} onClick={() => sec(k)}>
                    <strong>
                      <span className="status-chip" style={{ padding: "1px 8px", marginRight: "6px", fontSize: "0.66rem" }}>{k.isSfx ? "SFX" : "MÜZİK"}</span>
                      {k.prompt || k.filename}
                    </strong>
                    <span>
                      {[k.duration ? `${k.duration} sn` : "", k.warning ? `istenen ${k.requestedDuration || "?"} sn, sonu sessizdi` : "", k.modelName || k.model, k.createdAt ? new Date(k.createdAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "", k.size].filter(Boolean).join(" • ")}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexDirection: "row" }}>
                    <button type="button" className="m3-btn m3-btn-outlined" onClick={() => dosyaIndir(k.url, k.filename)} title="İndir" style={{ padding: "8px" }}><Download size={14} /></button>
                    <button type="button" className="m3-btn m3-btn-outlined" onClick={() => klasoruAc(k.filename)} title="Klasörde göster" style={{ padding: "8px" }}><FolderOpen size={14} /></button>
                    <button type="button" className="m3-btn m3-btn-error" onClick={() => sil(k)} title="Sil" style={{ padding: "8px" }}><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

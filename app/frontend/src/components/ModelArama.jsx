// Model arama: Hugging Face (ve uygun türlerde GitHub sürümleri) içinde, BU bilgisayara uyum tahminiyle
// Sunucu: scripts/server/model-arama.cjs. Kurulum sunucuda commit'e sabitlenir ve SHA256 ile doğrulanır.
//
// Kullanım (ModelManager.jsx içinde, {/* MODEL_ARAMA_YERI */} yer tutucusunun olduğu yerde):
//   <ModelArama tur="text" onInstalled={(bilgi) => yenile()} showAlert={showAlert} showConfirm={showConfirm} />
// Özellikler:
//   tur          "image" | "text" | "speech" | "tts" | "muzik" | "video"  (zorunlu)
//   onInstalled  (bilgi) => void   Kurulum bitince çağrılır: { tur, repo, dosyalar?, studyo?, model? }
//                Kitaplık listesini yenilemek için. Ayrıca window'da "yas-modeller-degisti" olayı yayınlanır.
//   showAlert / showConfirm   App.jsx'teki diyalog yardımcıları (yoksa tarayıcı pencereleri kullanılır)
//   baslangicSorgusu (isteğe bağlı) ilk açılışta kutuda duracak metin; arama kullanıcı "Ara" deyince yapılır
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Search, Download, Heart, Calendar, HardDrive, AlertTriangle, ExternalLink, ShieldAlert, Cpu, RefreshCw, X, GitBranch } from "lucide-react";
import { modelAra, modelKur, boyutYaz, tarihYaz, sayiYaz, isBitinceyeKadarIzle } from "../services/aramaApi";

const TUR_BILGI = {
  text: { baslik: "Hugging Face'te metin modeli ara", ornek: "ör. gemma, qwen 3b, turkish", github: true },
  image: { baslik: "Hugging Face'te görsel modeli ara", ornek: "ör. dreamshaper, realistic vision, sdxl", github: true },
  speech: { baslik: "Konuşma tanıma (whisper.cpp) modeli ara", ornek: "ör. whisper, whisper turkish", github: true },
  tts: { baslik: "Piper sesi ara", ornek: "ör. türkçe, tr_TR, en_US", github: true },
  muzik: { baslik: "Müzik / ses efekti modeli ara", ornek: "ör. musicgen, audioldm", github: false },
  video: { baslik: "Video modeli ara", ornek: "ör. animatediff, wan", github: false },
};

const SEVIYE_RENK = { rahat: "#10b981", sigar: "#d97706", sigmaz: "var(--md-sys-color-error)", bilinmiyor: "var(--md-sys-color-outline)" };
// Uyum etiketleri (gerekçe — ayrık VRAM, RAM, işlemci — sunucudan "neden" alanında gelir; paylaşımlı bellek VRAM sayılmaz)
const UYUM_AD = { rahat: "Uyumlu", sigar: "Ağır olabilir", sigmaz: "Bu bilgisayarda önerilmez", bilinmiyor: "Tahmin edilemedi" };
const uyumAdi = (u) => (u ? UYUM_AD[u.seviye] || u.etiket || "" : "");

const st = {
  izgara: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" },
  kart: { display: "flex", flexDirection: "column", gap: "8px", padding: "14px", background: "var(--md-sys-color-surface-variant)", border: "1px solid var(--md-sys-color-outline-variant)", borderRadius: "var(--md-shape-corner-medium)", minWidth: 0 },
  kucuk: { fontSize: "0.75rem", color: "var(--md-sys-color-outline)" },
  meta: { display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", color: "var(--md-sys-color-on-surface-variant)" },
  satir: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  uyari: { display: "flex", gap: "6px", alignItems: "flex-start", fontSize: "0.75rem", color: "var(--md-sys-color-on-surface-variant)" },
  engel: { display: "flex", gap: "6px", alignItems: "flex-start", fontSize: "0.75rem", color: "var(--md-sys-color-error)", fontWeight: 600 },
  secim: { width: "100%", height: "40px", fontSize: "0.8rem", padding: "0 10px", lineHeight: "normal" },
};

function ModelKarti({ m, mesgul, onKur, onDepoAc }) {
  const ilk = m.onerilen || (m.secenekler[0] && m.secenekler[0].anahtar) || "";
  const [secili, setSecili] = useState(ilk);
  useEffect(() => { setSecili(ilk); }, [m.repo, ilk]);
  const secenek = m.secenekler.find((s) => s.anahtar === secili) || null;
  const uyum = (secenek && secenek.uyum) || m.uyum;
  const seviye = (uyum && uyum.seviye) || "bilinmiyor";
  const pythonTuru = m.tur === "muzik" || m.tur === "video";
  return (
    <div style={st.kart}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{m.ad}</div>
          <div style={st.kucuk}>{m.sahip}{m.etiketSurum ? ` · sürüm ${m.etiketSurum}` : ""}</div>
        </div>
        <a href={m.sayfa} target="_blank" rel="noopener noreferrer" title="Model sayfasını aç" style={{ color: "var(--md-sys-color-primary)", flexShrink: 0 }}><ExternalLink size={15} /></a>
      </div>

      {m.aciklama && <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.35 }}>{m.aciklama}</div>}

      <div style={st.satir}>
        {!m.githubDepo && (
          <span className="status-chip" style={{ borderColor: SEVIYE_RENK[seviye], color: SEVIYE_RENK[seviye], padding: "3px 10px" }} title={uyum ? uyum.neden : ""}>
            <Cpu size={12} />{uyumAdi(uyum) || "Tahmin yok"}
          </span>
        )}
        <span className="status-chip" style={{ padding: "3px 10px" }} title="Lisans">{m.lisans}</span>
        {m.kaynak === "hf" && (m.gated
          ? <span className="status-chip" style={{ padding: "3px 10px", borderColor: "#d97706", color: "#d97706" }} title="Hugging Face'te lisans onayı ve anahtar gerekir">Kapılı</span>
          : <span className="status-chip" style={{ padding: "3px 10px" }} title="Herkese açık indirme">Açık erişim</span>)}
      </div>

      <div style={{ ...st.satir, gap: "12px" }}>
        {!m.githubDepo && <span style={st.meta} title="Seçilen sürümün boyutu"><HardDrive size={12} />{secenek ? secenek.boyutMetni : m.boyutMetni}</span>}
        {m.kaynak === "hf" && <span style={st.meta} title="İndirme sayısı (son 30 gün)"><Download size={12} />{sayiYaz(m.indirme)}</span>}
        <span style={st.meta} title={m.kaynak === "github" ? "Yıldız" : "Beğeni"}><Heart size={12} />{sayiYaz(m.begeni)}</span>
        {m.guncelleme && <span style={st.meta} title="Son güncelleme"><Calendar size={12} />{tarihYaz(m.guncelleme)}</span>}
      </div>

      {m.oneri && <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--md-sys-color-primary)" }}>{m.secenekler.length > 1 ? "En uygun sürüm — " : ""}{m.oneri}</div>}
      {uyum && (uyum.neden || uyum.hizMetni) && (
        <div style={st.kucuk}>{[uyum.neden, uyum.hizMetni ? `Tahmini hız: ${uyum.hizMetni}.` : ""].filter(Boolean).join(" ")}</div>
      )}

      {m.secenekler.length > 1 && (
        <select className="m3-input" style={st.secim} value={secili} onChange={(e) => setSecili(e.target.value)} disabled={mesgul} aria-label="Dosya sürümü">
          {m.secenekler.map((s) => (
            <option key={s.anahtar} value={s.anahtar}>
              {`${s.etiket} · ${s.boyutMetni}${s.uyum ? ` · ${uyumAdi(s.uyum)}` : ""}${s.anahtar === m.onerilen ? " (en uygun)" : ""}`}
            </option>
          ))}
        </select>
      )}

      {m.uyarilar.map((u) => (
        <div key={u.kod} style={st.uyari}><AlertTriangle size={13} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} /><span>{u.metin}</span></div>
      ))}
      {m.engel && <div style={st.engel}><ShieldAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} /><span>{m.engel}</span></div>}

      <div style={{ marginTop: "auto" }}>
        {m.githubDepo ? (
          <button type="button" className="m3-btn m3-btn-tonal" style={{ height: "36px", width: "100%" }} disabled={mesgul} onClick={() => onDepoAc(m.githubDepo)}>
            <GitBranch size={14} /><span>Sürüm dosyalarını göster</span>
          </button>
        ) : (
          <button
            type="button"
            className="m3-btn m3-btn-filled"
            style={{ height: "36px", width: "100%" }}
            disabled={mesgul || !m.kurulabilir || (!secenek && !pythonTuru)}
            onClick={() => onKur(m, secenek)}
            title={m.kurulabilir ? "Belirli bir sürüme (commit) sabitlenir, dosya özeti doğrulanarak kurulur" : m.engel}
          >
            <Download size={14} /><span>{m.studyoModeli ? "Stüdyoya kur" : "İndir ve kur"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ModelArama({ tur = "text", onInstalled, showAlert, showConfirm, baslangicSorgusu = "" }) {
  const bilgi = TUR_BILGI[tur] || TUR_BILGI.text;
  const [sorgu, setSorgu] = useState(baslangicSorgusu);
  const [kaynak, setKaynak] = useState("hf");
  const [sonuc, setSonuc] = useState(null); // { modeller, dahaVar, sayfa, donanim, bilgi }
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [kurulum, setKurulum] = useState(null); // { ad, asama, ilerleme, hiz }
  const istekNo = useRef(0);
  const bagli = useRef(true);
  useEffect(() => { bagli.current = true; return () => { bagli.current = false; }; }, []);

  const uyar = useCallback((baslik, mesaj, tehlike = false) => {
    if (showAlert) return showAlert({ title: baslik, message: mesaj, confirmLabel: "Tamam", danger: tehlike });
    window.alert(`${baslik}\n\n${mesaj}`);
    return Promise.resolve(true);
  }, [showAlert]);
  const sor = useCallback((baslik, mesaj, onay, tehlike = false) => {
    if (showConfirm) return showConfirm({ title: baslik, message: mesaj, confirmLabel: onay, cancelLabel: "Vazgeç", danger: tehlike });
    return Promise.resolve(window.confirm(`${baslik}\n\n${mesaj}`));
  }, [showConfirm]);

  // Tür değişince sonuçları temizle
  useEffect(() => { setSonuc(null); setHata(""); setKaynak("hf"); }, [tur]);

  const ara = useCallback(async (sayfa = 1, ozelSorgu = null, ozelKaynak = null) => {
    const no = ++istekNo.current;
    setYukleniyor(true);
    setHata("");
    try {
      const r = await modelAra({ tur, q: (ozelSorgu ?? sorgu).trim(), sayfa, kaynak: ozelKaynak || kaynak });
      if (no !== istekNo.current || !bagli.current) return;
      setSonuc((onceki) => (sayfa > 1 && onceki ? { ...r, modeller: [...onceki.modeller, ...r.modeller] } : r));
    } catch (err) {
      if (no !== istekNo.current || !bagli.current) return;
      setHata(err.cevrimdisi ? "İnternet bağlantısı yok; arama yapılamadı. Kurulu modelleriniz çalışmaya devam eder." : (err.message || String(err)));
    } finally {
      if (no === istekNo.current && bagli.current) setYukleniyor(false);
    }
  }, [tur, sorgu, kaynak]);

  const depoAc = useCallback((depo) => { setSorgu(depo); setKaynak("github"); ara(1, depo, "github"); }, [ara]);

  const kur = useCallback(async (m, secenek) => {
    if (kurulum) return;
    let govde = { tur, repo: m.repo, anahtar: secenek ? secenek.anahtar : "*", kaynak: m.kaynak };
    // Ticari kullanıma kapalı lisans: sunucu yalnızca uyarı verir; kullanıcı lisansı görüp onaylamadan kurulmaz
    if ((m.uyarilar || []).some((u) => u.kod === "ticari")
      && !(await sor("Lisansı okuyun", `${m.ad}\n\nLisans: ${m.lisans}\nBu lisans ticari kullanıma izin vermiyor olabilir. Koşullar: ${m.sayfa}\n\nKişisel / ticari olmayan kullanım için kurulsun mu?`, "Okudum, kur"))) return;
    try {
      for (let deneme = 0; deneme < 3; deneme += 1) {
        const r = await modelKur(govde);
        if (r.onayGerekli) {
          const metin = r.uyarilar.map((u) => "• " + u.metin).join("\n");
          if (!(await sor("Kurmadan önce onay gerekli", `${m.ad}\n\n${metin}\n\nYine de kurulsun mu?`, "Okudum, kur"))) return;
          govde = { ...govde, uyarilariOnayla: true };
          continue;
        }
        if (r.uzerineYazOnayi) {
          if (!(await sor("Aynı adlı dosya var", `Şu dosya zaten var: ${r.dosyalar.join(", ")}\n\nYeni dosya indirilip doğrulandıktan sonra eskisinin yerine geçsin mi? (Doğrulama başarısız olursa eskisi korunur.)`, "Yerine koy", true))) return;
          govde = { ...govde, uzerineYaz: true };
          continue;
        }
        if (r.studyo) {
          await uyar("Kurulum başladı", `${m.ad} stüdyonun kendi kurucusuyla (sabit sürüm, dosya özeti doğrulamalı) kuruluyor. İlerlemeyi ilgili stüdyo sayfasında görebilirsiniz.`);
          if (onInstalled) onInstalled({ tur, repo: m.repo, studyo: true, model: r.model });
          return;
        }
        setKurulum({ ad: r.ad || m.ad, asama: r.sirada ? "Sırada bekliyor" : "Başlıyor", ilerleme: null, hiz: "" });
        const is = await isBitinceyeKadarIzle((d) => { if (bagli.current) setKurulum({ ...d, ad: d.ad || r.ad || m.ad }); }, () => !bagli.current);
        if (!bagli.current || !is) return;
        setKurulum(null);
        if (is.hata) { await uyar("Kurulum başarısız", `${is.hata}\n\nÖnceki dosyalar (varsa) korundu.`, true); return; }
        try { window.dispatchEvent(new CustomEvent("yas-modeller-degisti", { detail: { tur } })); } catch (_) {}
        if (onInstalled) onInstalled({ tur, repo: m.repo, ...(is.sonuc || {}) });
        await uyar("Model kuruldu", `${r.ad || m.ad} indirildi, dosya özeti (SHA256) doğrulandı ve sürümü kaydedildi. Yeni sürüm çıkarsa açılışta haber verilir.`);
        return;
      }
    } catch (err) {
      if (bagli.current) setKurulum(null);
      await uyar("Kurulum başlatılamadı", err.message || String(err), true);
    }
  }, [kurulum, tur, sor, uyar, onInstalled]);

  return (
    <div className="model-discovery-controls">
      <div style={{ ...st.satir, justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}><Search size={16} />{bilgi.baslik}</div>
        {bilgi.github && (
          <div className="model-filter-row" role="radiogroup" aria-label="Kaynak">
            {[["hf", "Hugging Face"], ["github", "GitHub"]].map(([k, ad]) => (
              <button key={k} type="button" className={`model-filter-chip ${kaynak === k ? "selected" : ""}`} role="radio" aria-checked={kaynak === k}
                onClick={() => { setKaynak(k); setSonuc(null); setHata(""); }}>{ad}</button>
            ))}
          </div>
        )}
      </div>

      <form style={st.satir} onSubmit={(e) => { e.preventDefault(); ara(1); }}>
        <div className="model-search-box" style={{ flex: "1 1 240px" }}>
          <Search size={18} />
          <input type="search" value={sorgu} maxLength={100} onChange={(e) => setSorgu(e.target.value)}
            placeholder={kaynak === "github" ? "Depo adı ya da sahip/depo (ör. ggml-org/whisper.cpp)" : bilgi.ornek} aria-label="Model ara" />
          {sorgu && <button type="button" onClick={() => setSorgu("")} title="Temizle" aria-label="Aramayı temizle"><X size={16} /></button>}
        </div>
        <button type="submit" className="m3-btn m3-btn-filled" style={{ height: "44px" }} disabled={yukleniyor}>
          {yukleniyor ? <RefreshCw className="progress-spinner" size={14} /> : <Search size={14} />}<span>Ara</span>
        </button>
        {sonuc && <button type="button" className="m3-btn m3-btn-outlined" style={{ height: "44px" }} onClick={() => { setSonuc(null); setHata(""); }} title="Sonuçları kapat"><X size={14} /></button>}
      </form>

      {sonuc && sonuc.donanim && <div style={st.kucuk}>Uyum tahmini bu bilgisayara göre yapılır: {sonuc.donanim}.</div>}

      {kurulum && (
        <div className="model-progress-section">
          <div className="model-progress-label">
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><span className="loading-dot"></span>{kurulum.ad} — {kurulum.asama}</span>
            <span>{kurulum.ilerleme != null && kurulum.ilerleme > 0 ? `${kurulum.ilerleme}%` : ""}</span>
          </div>
          <div className="model-progress-bar">
            <div className="model-progress-fill" style={{ width: `${kurulum.ilerleme == null ? 100 : Math.min(100, Math.max(0, kurulum.ilerleme))}%`, opacity: kurulum.ilerleme == null ? 0.35 : 1, transition: "width 0.2s ease" }}></div>
          </div>
          {kurulum.hiz && <div style={{ fontSize: "0.7rem", color: "var(--md-sys-color-outline)", marginTop: "4px" }}>{kurulum.hiz}</div>}
        </div>
      )}

      {yukleniyor && !sonuc && (
        <div className="model-discovery-loading"><RefreshCw className="progress-spinner" size={16} /><span>{kaynak === "github" ? "GitHub'da aranıyor..." : "Hugging Face'te aranıyor ve bu bilgisayara uyum hesaplanıyor..."}</span></div>
      )}
      {hata && <div className="model-search-warning">{hata}</div>}
      {sonuc && sonuc.bilgi && <div style={st.kucuk}>{sonuc.bilgi}</div>}
      {sonuc && !sonuc.modeller.length && !sonuc.bilgi && <div className="m3-card model-search-empty" style={{ margin: 0 }}>Bu türde çalıştırılabilir dosyası olan model bulunamadı.</div>}

      {sonuc && sonuc.modeller.length > 0 && (
        <div style={st.izgara}>
          {sonuc.modeller.map((m) => <ModelKarti key={`${m.kaynak}:${m.repo}`} m={m} mesgul={Boolean(kurulum)} onKur={kur} onDepoAc={depoAc} />)}
        </div>
      )}
      {sonuc && sonuc.dahaVar && (
        <button type="button" className="m3-btn m3-btn-tonal model-load-more" disabled={yukleniyor} onClick={() => ara((sonuc.sayfa || 1) + 1)}>
          {yukleniyor && <RefreshCw className="progress-spinner" size={16} />}<span>Daha fazla göster</span>
        </button>
      )}
      <div style={st.kucuk}>
        Yalnızca bu uygulamanın çalıştırabildiği güvenli biçimler kurulur (GGUF, safetensors, whisper.cpp ggml, Piper ONNX). Her dosya belirli bir sürüme (commit) sabitlenir ve SHA256 özetiyle doğrulanır; pickle (.ckpt/.pt) ve çalıştırılabilir dosyalar reddedilir.
      </div>
    </div>
  );
}

export default memo(ModelArama);

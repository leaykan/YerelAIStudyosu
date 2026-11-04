import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Cloud, KeyRound, Trash2, ExternalLink, LoaderCircle, X, ArrowLeft } from "lucide-react";
import {
  bulutSaglayicilari,
  bulutAnahtarKaydet,
  bulutAnahtarSil,
  bulutSaglayiciModelleri,
  bulutModelEkle,
  bulutModelSil,
  bulutTest,
} from "../services/bulutApi";

// Bulut modeli ekleme penceresi: sağlayıcı seç -> (gerekirse) API anahtarı gir -> model seç -> ekle.
// Anahtar yalnızca "Doğrula ve kaydet" anında sunucuya bir kez gider ve hemen bu pencerenin belleğinden silinir.

const NOT_MADDELERI = [
  "Mesajlarınız seçtiğiniz sağlayıcının sunucularına gönderilir ve o sağlayıcının kullanım politikaları geçerlidir. Uygulamanın kısıtsız (sansürsüz) yapısı yalnızca bu bilgisayarda çalışan yerel modeller içindir.",
  "Bağlantı yalnızca sağlayıcının resmî API'si ve sizin kendi API anahtarınızla kurulur; abonelik girişi, çerez ya da tarayıcı oturumu kullanılmaz.",
  "İstekler sağlayıcının fiyatlandırmasına göre ücretlendirilebilir. Kullanım sınırlarını sağlayıcı panelinden takip edin.",
  "Anahtar yalnızca bu bilgisayarda, Windows kullanıcı hesabınıza bağlı şifreleme (DPAPI) ile saklanır; başka bir yere gönderilmez ve arayüzde bir daha gösterilmez.",
  "Vega kendi kendine bulut modeline geçmez; bulut modelleri listede \"Bulut\" etiketiyle görünür ve yalnızca siz seçtiğinizde kullanılır.",
];

const kutuStili = {
  border: "1px solid var(--border-color)",
  borderRadius: "var(--md-shape-corner-medium)",
  padding: "12px 14px",
  background: "var(--md-sys-color-surface-variant)",
};

export default function BulutModelEkle({ acik, kapat, eklendi }) {
  const [adim, setAdim] = useState("saglayici"); // saglayici | anahtar | model
  const [saglayicilar, setSaglayicilar] = useState([]);
  const [depolama, setDepolama] = useState("");
  const [secili, setSecili] = useState(null);
  const [anahtar, setAnahtar] = useState("");
  const [onay, setOnay] = useState(false);
  const [modeller, setModeller] = useState([]);
  const [kaynak, setKaynak] = useState("");
  const [arama, setArama] = useState("");
  const [seciliModel, setSeciliModel] = useState("");
  const [ozelModel, setOzelModel] = useState("");
  const [mesgul, setMesgul] = useState("");
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");

  const yukle = async () => {
    try {
      const v = await bulutSaglayicilari();
      setSaglayicilar(v.saglayicilar || []);
      setDepolama(v.depolama || "");
      return v.saglayicilar || [];
    } catch (err) {
      setHata(err.message);
      return [];
    }
  };

  useEffect(() => {
    if (!acik) return;
    setAdim("saglayici"); setSecili(null); setAnahtar(""); setOnay(false); setModeller([]);
    setArama(""); setSeciliModel(""); setOzelModel(""); setHata(""); setBilgi(""); setMesgul("");
    yukle();
  }, [acik]);

  useEffect(() => {
    if (!acik) return undefined;
    const tus = (e) => { if (e.key === "Escape" && !mesgul) kapat(); };
    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  }, [acik, mesgul, kapat]);

  const modelleriGetir = async (s) => {
    setMesgul("Model listesi alınıyor…"); setHata("");
    try {
      const v = await bulutSaglayiciModelleri(s.id);
      setModeller(v.modeller || []);
      setKaynak(v.kaynak || "");
      if (v.hata) setBilgi(`Canlı liste alınamadı, varsayılan liste gösteriliyor: ${v.hata}`);
    } catch (err) {
      setHata(err.message);
    } finally {
      setMesgul("");
    }
  };

  const saglayiciSec = (s) => {
    setSecili(s); setHata(""); setBilgi(""); setSeciliModel(""); setOzelModel(""); setArama("");
    if (s.kayitli) { setAdim("model"); modelleriGetir(s); }
    else { setAnahtar(""); setOnay(false); setAdim("anahtar"); }
  };

  const anahtariKaydet = async () => {
    const gonderilecek = anahtar.trim();
    setAnahtar(""); // anahtar bu pencerenin belleğinde tutulmaz
    setMesgul("Anahtar sağlayıcıyla doğrulanıyor…"); setHata(""); setBilgi("");
    try {
      const v = await bulutAnahtarKaydet(secili.id, gonderilecek);
      setModeller(v.modeller || []);
      setKaynak(v.kaynak || "");
      if (v.uyari) setBilgi(v.uyari);
      const liste = await yukle();
      setSecili(liste.find((x) => x.id === secili.id) || { ...secili, kayitli: true, maske: v.maske });
      setAdim("model");
    } catch (err) {
      setHata(err.message);
    } finally {
      setMesgul("");
    }
  };

  const anahtariSil = async (s) => {
    if (!window.confirm(`${s.ad} anahtarı ve bu sağlayıcıya ait bulut modelleri bu bilgisayardan silinsin mi?`)) return;
    setMesgul("Siliniyor…"); setHata("");
    try {
      await bulutAnahtarSil(s.id);
      await yukle();
      setAdim("saglayici"); setSecili(null);
    } catch (err) { setHata(err.message); } finally { setMesgul(""); }
  };

  const eklenecek = (ozelModel.trim() || seciliModel).replace(/^models\//, "");

  const ekle = async () => {
    setMesgul("Ekleniyor…"); setHata("");
    try {
      const v = await bulutModelEkle(secili.id, eklenecek);
      eklendi?.(v.model);
    } catch (err) { setHata(err.message); } finally { setMesgul(""); }
  };

  const dene = async () => {
    setMesgul("Bağlantı deneniyor (küçük bir ücretli istek olabilir)…"); setHata(""); setBilgi("");
    try {
      const v = await bulutTest(secili.id, eklenecek);
      setBilgi(`Bağlantı çalışıyor (${Math.round(v.sureMs / 100) / 10} sn). Yanıt: "${v.yanit}"`);
    } catch (err) { setHata(err.message); } finally { setMesgul(""); }
  };

  const ekliModeliKaldir = async (m) => {
    setMesgul("Kaldırılıyor…"); setHata("");
    try { await bulutModelSil(`bulut:${secili.id}:${m}`); const l = await yukle(); setSecili(l.find((x) => x.id === secili.id) || secili); }
    catch (err) { setHata(err.message); } finally { setMesgul(""); }
  };

  const suzulmus = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    const l = q ? modeller.filter((m) => `${m.id} ${m.ad}`.toLocaleLowerCase("tr-TR").includes(q)) : modeller;
    return l.slice(0, 300);
  }, [modeller, arama]);

  if (!acik) return null;

  return createPortal(
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !mesgul) kapat(); }}>
      <div className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="bulut-baslik"
        style={{ width: "min(580px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {adim !== "saglayici" && (
            <button type="button" className="m3-btn m3-btn-outlined" style={{ height: 32, width: 32, padding: 0 }} title="Geri"
              disabled={Boolean(mesgul)} onClick={() => { setAdim("saglayici"); setHata(""); setBilgi(""); }}>
              <ArrowLeft size={16} />
            </button>
          )}
          <h3 id="bulut-baslik" className="app-dialog-title" style={{ margin: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
            <Cloud size={20} /> {adim === "saglayici" ? "Bulut modeli ekle" : secili?.ad}
          </h3>
          <button type="button" className="m3-btn m3-btn-outlined" style={{ height: 32, width: 32, padding: 0 }} title="Kapat"
            disabled={Boolean(mesgul)} onClick={kapat}>
            <X size={16} />
          </button>
        </div>

        {adim === "saglayici" && (
          <>
            <p className="app-dialog-message" style={{ margin: 0 }}>
              Bulut modelleri yerel modellerin yanında model seçicide "Bulut" etiketiyle görünür. Bir sağlayıcı seçin:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
              {saglayicilar.map((s) => (
                <div key={s.id} style={{ ...kutuStili, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>{s.ad}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)" }}>
                    {s.kayitli ? <>Anahtar kayıtlı: <code>{s.maske}</code>{s.modeller.length ? ` · ${s.modeller.length} model` : ""}</> : "Anahtar girilmemiş"}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="m3-btn m3-btn-tonal" style={{ height: 32, padding: "0 12px", fontSize: "0.82rem" }}
                      disabled={Boolean(mesgul)} onClick={() => saglayiciSec(s)}>
                      {s.kayitli ? "Model seç" : <><KeyRound size={14} /> Anahtar gir</>}
                    </button>
                    {s.kayitli && (
                      <>
                        <button type="button" className="m3-btn m3-btn-outlined" style={{ height: 32, padding: "0 10px", fontSize: "0.78rem" }}
                          disabled={Boolean(mesgul)} onClick={() => { setSecili(s); setAnahtar(""); setOnay(false); setHata(""); setAdim("anahtar"); }}>
                          Değiştir
                        </button>
                        <button type="button" className="m3-btn m3-btn-error" style={{ height: 32, padding: "0 10px" }} title="Anahtarı sil"
                          disabled={Boolean(mesgul)} onClick={() => anahtariSil(s)}>
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {depolama === "dosya" && (
              <div style={{ ...kutuStili, fontSize: "0.8rem" }}>
                Bu sistemde Windows DPAPI yok: anahtarlar yalnızca bu kullanıcının okuyabildiği bir dosyada, şifrelenmeden saklanır.
              </div>
            )}
          </>
        )}

        {adim === "anahtar" && secili && (
          <>
            <div style={{ ...kutuStili, fontSize: "0.84rem", lineHeight: 1.45 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Bulut modeli kullanmadan önce</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                {NOT_MADDELERI.map((n) => <li key={n}>{n}</li>)}
                {secili.not && <li>{secili.not}</li>}
              </ul>
            </div>
            <div className="m3-text-field">
              <label className="m3-text-field-label" htmlFor="bulut-anahtar">{secili.ad} API anahtarı</label>
              <input id="bulut-anahtar" className="m3-input" type="password" autoComplete="off" spellCheck={false}
                value={anahtar} onChange={(e) => setAnahtar(e.target.value)} placeholder="Anahtarı buraya yapıştırın"
                onKeyDown={(e) => { if (e.key === "Enter" && onay && anahtar.trim() && !mesgul) anahtariKaydet(); }} />
              <a href={secili.anahtarSayfasi} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: "0.8rem", color: "var(--md-sys-color-primary)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                Anahtarı nereden alırım? <ExternalLink size={12} />
              </a>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.84rem", cursor: "pointer" }}>
              <input type="checkbox" checked={onay} onChange={(e) => setOnay(e.target.checked)} style={{ marginTop: 3 }} />
              <span>Okudum: istekler {secili.ad} sunucularına gidecek, onların kuralları geçerli ve ücretlendirilebilir.</span>
            </label>
            <div className="app-dialog-actions" style={{ marginTop: 0 }}>
              <button type="button" className="m3-btn m3-btn-filled" disabled={!onay || !anahtar.trim() || Boolean(mesgul)} onClick={anahtariKaydet}>
                Doğrula ve kaydet
              </button>
            </div>
          </>
        )}

        {adim === "model" && secili && (
          <>
            <div style={{ fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)" }}>
              İstekler {secili.ad} sunucularına gider ve ücretlendirilebilir. Anahtar: <code>{secili.maske || "kayıtlı"}</code>
            </div>
            {secili.modeller?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {secili.modeller.map((m) => (
                  <span key={m} className="chat-model-active-badge" style={{ textTransform: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {m}
                    <button type="button" title="Listeden kaldır" disabled={Boolean(mesgul)} onClick={() => ekliModeliKaldir(m)}
                      style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 0, display: "inline-flex" }}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input className="m3-input" type="search" placeholder="Modellerde ara…" value={arama} onChange={(e) => setArama(e.target.value)} />
            <div style={{ ...kutuStili, padding: 6, maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {suzulmus.length === 0 && <div style={{ padding: 8, fontSize: "0.82rem", opacity: 0.8 }}>{mesgul ? "Yükleniyor…" : "Model bulunamadı."}</div>}
              {suzulmus.map((m) => (
                <button key={m.id} type="button" title={m.id}
                  className={`chat-model-dropdown-item ${seciliModel === m.id && !ozelModel.trim() ? "selected" : ""}`}
                  onClick={() => { setSeciliModel(m.id); setOzelModel(""); }}>
                  <span className="chat-model-name-text">{m.ad || m.id}</span>
                  {secili.modeller?.includes(m.id) && <span className="chat-model-active-badge">Ekli</span>}
                </button>
              ))}
            </div>
            {kaynak === "varsayilan" && <div style={{ fontSize: "0.78rem", opacity: 0.8 }}>Bu varsayılan bir listedir; güncel olmayabilir. Gerekirse model kimliğini aşağıya yazın.</div>}
            <div className="m3-text-field">
              <label className="m3-text-field-label" htmlFor="bulut-ozel">Listede yoksa model kimliği</label>
              <input id="bulut-ozel" className="m3-input" type="text" spellCheck={false} placeholder="ör. gemini-2.5-flash"
                value={ozelModel} onChange={(e) => setOzelModel(e.target.value)} />
            </div>
            <div className="app-dialog-actions" style={{ marginTop: 0 }}>
              <button type="button" className="m3-btn m3-btn-outlined" disabled={!eklenecek || Boolean(mesgul)} onClick={dene}>Bağlantıyı dene</button>
              <button type="button" className="m3-btn m3-btn-filled" disabled={!eklenecek || Boolean(mesgul)} onClick={ekle}>
                Ekle ve kullan
              </button>
            </div>
          </>
        )}

        {mesgul && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem" }}>
            <LoaderCircle size={16} className="spin" style={{ animation: "spin 1s linear infinite" }} /> {mesgul}
          </div>
        )}
        {bilgi && !mesgul && <div style={{ ...kutuStili, fontSize: "0.82rem" }}>{bilgi}</div>}
        {hata && (
          <div role="alert" style={{ ...kutuStili, fontSize: "0.84rem", color: "#e11d48", borderColor: "rgba(244, 63, 94, 0.35)", background: "rgba(244, 63, 94, 0.08)" }}>
            {hata}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

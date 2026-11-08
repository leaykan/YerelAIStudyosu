// Ayarlar > Uygulama güncellemesi: GitHub'daki son sürümle karşılaştırır; yönetici tek tıkla günceller
import React, { useCallback, useEffect, useState } from "react";
import { DownloadCloud, RefreshCw, ExternalLink, LoaderCircle } from "lucide-react";
import { kullaniciDurumu } from "../services/kullaniciApi";

async function istek(url, govde) {
  const res = await fetch(url, govde === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde) });
  let v = {};
  try { v = await res.json(); } catch (_) {}
  if (!res.ok || v.ok === false) throw new Error(v.error || `İstek başarısız (HTTP ${res.status})`);
  return v;
}

export default function UygulamaGuncelleme({ showAlert, showConfirm }) {
  const [d, setD] = useState(null);
  const [yonetici, setYonetici] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [basladi, setBasladi] = useState(false);

  const denetle = useCallback(async (yenile) => {
    setMesgul(true);
    try { setD(await istek(`/api/uygulama/surum${yenile ? "?yenile=1" : ""}`)); }
    catch (err) { setD({ hata: err.message || String(err) }); }
    finally { setMesgul(false); }
  }, []);
  useEffect(() => {
    denetle(false);
    kullaniciDurumu().then((k) => setYonetici(!k.kurulum || !!(k.kullanici && k.kullanici.yonetici))).catch(() => {});
  }, [denetle]);

  const guncelle = async () => {
    const ok = await showConfirm?.({
      title: `Sürüm ${d.son.surum} kurulsun mu?`,
      message: "Uygulama kapanır; doğrulanmış kurulum dosyası bu klasörü günceller ve uygulamayı yeniden açar (1-2 dakika). "
        + "Modelleriniz, sohbetleriniz, kullanıcılar ve ayarlar korunur. Süren bir üretim varsa önce bitmesini bekleyin.",
      confirmLabel: "Güncelle",
    });
    if (!ok) return;
    setMesgul(true);
    try {
      await istek("/api/uygulama/guncelle", {});
      setBasladi(true);
    } catch (err) {
      showAlert?.({ title: "Güncelleme başlatılamadı", message: err.message || String(err), danger: true });
    } finally { setMesgul(false); }
  };

  const yazi = { fontSize: "0.85rem", margin: 0 };
  return (
    <div className="m3-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="m3-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><DownloadCloud size={18} /> Uygulama güncellemesi</div>
      {basladi ? (
        <p style={yazi}>
          Güncelleme başladı. Uygulama kapandı; açılan pencerede güncelleme sürüyor ve bitince uygulama kendiliğinden yeniden açılır.
          Bu sekmeyi 1-2 dakika sonra yenileyebilir ya da kapatabilirsiniz.
        </p>
      ) : !d ? (
        <p style={yazi}>Denetleniyor…</p>
      ) : (
        <>
          <p style={yazi}>
            Kurulu sürüm: <b>{d.kurulu || "geliştirme kopyası"}</b>
            {d.son ? <> · GitHub'daki son sürüm: <b>{d.son.surum}</b>{d.son.tarih ? ` (${new Date(d.son.tarih).toLocaleDateString("tr-TR")})` : ""}</> : null}
          </p>
          {d.hata && <p style={{ ...yazi, color: "var(--md-sys-color-error)" }}>{d.hata}</p>}
          {d.gelistirme && <p style={{ ...yazi, opacity: 0.8 }}>Bu bir geliştirme kopyası (sürüm dosyası yok); uygulama içinden güncellenmez.</p>}
          {d.yeniVar && d.son && d.son.notlar && (
            <div style={{ fontSize: "0.8rem", whiteSpace: "pre-wrap", maxHeight: 160, overflowY: "auto", padding: "8px 10px", borderRadius: 8, background: "var(--md-sys-color-surface-variant)" }}>{d.son.notlar}</div>
          )}
          {!d.gelistirme && d.son && !d.yeniVar && !d.hata && <p style={{ ...yazi, opacity: 0.8 }}>Uygulama güncel.</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="m3-btn m3-btn-outlined" disabled={mesgul} onClick={() => denetle(true)}>
              {mesgul ? <LoaderCircle className="progress-spinner" size={14} /> : <RefreshCw size={14} />} Şimdi denetle
            </button>
            {d.yeniVar && (yonetici ? (
              <button type="button" className="m3-btn m3-btn-filled" disabled={mesgul || !d.windows} onClick={guncelle}
                title={d.windows ? "" : "Uygulama içinden güncelleme yalnızca Windows'ta"}>
                <DownloadCloud size={14} /> {d.son.surum} sürümüne güncelle
              </button>
            ) : <span style={{ fontSize: "0.8rem", opacity: 0.8 }}>Güncellemeyi yönetici yapabilir.</span>)}
            {d.son && d.son.sayfa && <a href={d.son.sayfa} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: 3, color: "var(--md-sys-color-primary)" }}>Sürüm sayfası <ExternalLink size={11} /></a>}
          </div>
        </>
      )}
    </div>
  );
}

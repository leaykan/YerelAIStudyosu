import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldAlert, X } from "lucide-react";
import { klonOnayMetni, YEDEK_ONAY_METNI } from "../services/klonApi";

export const kutuStili = {
  border: "1px solid var(--border-color)",
  borderRadius: "var(--md-shape-corner-medium)",
  padding: "12px 14px",
  background: "var(--md-sys-color-surface-variant)",
};

export const hataStili = {
  ...kutuStili,
  fontSize: "0.84rem",
  color: "#e11d48",
  borderColor: "rgba(244, 63, 94, 0.35)",
  background: "rgba(244, 63, 94, 0.08)",
};

const yerelTarih = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Ses klonlama yasal uyarısı ve onay formu. onOnay(onay) yalnızca "Bu ses bana ait" ya da "Ses sahibinin
// açık onayını aldım" (+ ad ve izin tarihi) ve kötüye kullanmama taahhüdü işaretliyse çağrılır.
// Onay sunucuya gönderilir; sunucu da ayrıca denetler.
export function KlonOnayIcerigi({ sadeceKendim = false, dugmeYazisi = "Onaylıyorum, devam et", onOnay, onVazgec, mesgul = false }) {
  const [metin, setMetin] = useState(YEDEK_ONAY_METNI);
  const [sahip, setSahip] = useState("");
  const [sahipAdi, setSahipAdi] = useState("");
  const [izinTarihi, setIzinTarihi] = useState("");
  const [taahhut, setTaahhut] = useState(false);

  useEffect(() => {
    let iptal = false;
    klonOnayMetni().then((m) => { if (!iptal && m?.surum) setMetin(m); }).catch(() => {});
    return () => { iptal = true; };
  }, []);

  const adGerekli = sahip === "baskasi";
  const bugun = yerelTarih(new Date());
  const tarihGecerli = /^\d{4}-\d{2}-\d{2}$/.test(izinTarihi) && izinTarihi <= bugun && izinTarihi >= "1990-01-01";
  const gecerli = taahhut && (sahip === "kendim" || (adGerekli && sahipAdi.trim().length >= 2 && tarihGecerli));
  const beyanlar = metin.beyanlar || YEDEK_ONAY_METNI.beyanlar;
  const taahhutMetni = metin.taahhut || YEDEK_ONAY_METNI.taahhut;
  const kutuYazisi = { display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.88rem", cursor: "pointer", fontWeight: 600 };

  const onayla = () => {
    if (!gecerli || mesgul) return;
    onOnay?.({
      kabul: true,
      surum: metin.surum,
      beyan: beyanlar[sahip],
      taahhut: taahhutMetni,
      sesSahibi: sahip,
      sesSahibiAdi: adGerekli ? sahipAdi.trim() : "",
      izinTarihi: adGerekli ? izinTarihi : "",
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...kutuStili, fontSize: "0.84rem", lineHeight: 1.5 }}>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {metin.maddeler.map((m) => <li key={m}>{m}</li>)}
        </ul>
      </div>

      <div role="group" aria-label="Bu ses kime ait?" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={kutuYazisi}>
          <input type="checkbox" checked={sahip === "kendim"}
            onChange={(e) => setSahip(e.target.checked ? "kendim" : "")} style={{ marginTop: 3 }} />
          <span>{beyanlar.kendim}</span>
        </label>
        {!sadeceKendim && (
          <>
            <label style={kutuYazisi}>
              <input type="checkbox" checked={sahip === "baskasi"} onChange={(e) => setSahip(e.target.checked ? "baskasi" : "")} style={{ marginTop: 3 }} />
              <span>{beyanlar.baskasi}</span>
            </label>
            {adGerekli && (
              <div style={{ marginLeft: 26, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                <div className="m3-text-field">
                  <label className="m3-text-field-label" htmlFor="klon-sahip-adi">Ses sahibinin adı soyadı</label>
                  <input id="klon-sahip-adi" className="m3-input" type="text" maxLength={120} autoComplete="off"
                    value={sahipAdi} onChange={(e) => setSahipAdi(e.target.value)} placeholder="ör. Ayşe Yılmaz" />
                </div>
                <div className="m3-text-field">
                  <label className="m3-text-field-label" htmlFor="klon-izin-tarihi">İzin tarihi</label>
                  <input id="klon-izin-tarihi" className="m3-input" type="date" min="1990-01-01" max={bugun}
                    value={izinTarihi} onChange={(e) => setIzinTarihi(e.target.value)} />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <label style={kutuYazisi}>
        <input type="checkbox" checked={taahhut} onChange={(e) => setTaahhut(e.target.checked)} style={{ marginTop: 3 }} />
        <span>{taahhutMetni}</span>
      </label>

      <div className="app-dialog-actions" style={{ marginTop: 0 }}>
        {onVazgec && <button type="button" className="m3-btn m3-btn-outlined" onClick={onVazgec} disabled={mesgul}>Vazgeç</button>}
        <button type="button" className="m3-btn m3-btn-filled" onClick={onayla} disabled={!gecerli || mesgul}>{dugmeYazisi}</button>
      </div>
    </div>
  );
}

// Yalnızca onay için ayrı pencere (ör. "Sesimi klonlama için kaydet" açılırken)
export default function KlonOnayPenceresi({ acik, baslik = "Ses klonlama: yasal uyarı", aciklama, sadeceKendim = false, dugmeYazisi, onOnay, onVazgec, mesgul = false }) {
  useEffect(() => {
    if (!acik) return undefined;
    const tus = (e) => { if (e.key === "Escape" && !mesgul) onVazgec?.(); };
    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  }, [acik, mesgul, onVazgec]);
  if (!acik) return null;
  return createPortal(
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !mesgul) onVazgec?.(); }}>
      <div className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="klon-onay-baslik"
        style={{ width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 id="klon-onay-baslik" className="app-dialog-title" style={{ margin: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldAlert size={20} /> {baslik}
          </h3>
          <button type="button" className="m3-btn m3-btn-outlined" style={{ height: 32, width: 32, padding: 0 }} title="Kapat" onClick={onVazgec} disabled={mesgul}>
            <X size={16} />
          </button>
        </div>
        {aciklama && <p className="app-dialog-message" style={{ margin: 0 }}>{aciklama}</p>}
        <KlonOnayIcerigi sadeceKendim={sadeceKendim} dugmeYazisi={dugmeYazisi} onOnay={onOnay} onVazgec={onVazgec} mesgul={mesgul} />
      </div>
    </div>,
    document.body,
  );
}

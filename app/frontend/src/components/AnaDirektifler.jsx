// Ayarlar > Ana direktifler (yalnızca yönetici görür): her sohbette sistem mesajının başına eklenen temel kurallar
import React, { useEffect, useState } from "react";
import { ShieldCheck, RotateCcw, Save } from "lucide-react";

async function istek(url, govde) {
  const res = await fetch(url, govde === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde) });
  let v = {};
  try { v = await res.json(); } catch (_) {}
  if (!res.ok || v.ok === false) throw Object.assign(new Error(v.error || `HTTP ${res.status}`), { kod: res.status });
  return v;
}

export default function AnaDirektifler({ showAlert, showConfirm }) {
  const [d, setD] = useState(null);
  const [metin, setMetin] = useState("");
  const [mesgul, setMesgul] = useState(false);
  useEffect(() => { istek("/api/ana-direktifler").then((v) => { setD(v); setMetin(v.metin); }).catch(() => setD(false)); }, []);
  if (!d || typeof d.metin !== "string") return null; // yönetici değilse hiç görünmez
  return (
    <div className="m3-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="m3-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><ShieldCheck size={18} /> Ana direktifler (yönetici)</div>
      <p style={{ margin: 0, fontSize: "0.84rem" }}>
        Her sohbette, kullanıcının kendi tercihlerinden (asistanın adı, karakteri, sistem mesajı) önce modele verilen temel kurallar.
        Kullanıcılar bunları görmez ve değiştiremez; tercihleri bu kuralları geçersiz kılamaz.
      </p>
      <textarea className="m3-input" value={metin} onChange={(e) => setMetin(e.target.value)} rows={12} maxLength={8000}
        style={{ fontFamily: "inherit", fontSize: "0.82rem", lineHeight: 1.45, resize: "vertical", minHeight: 160 }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="m3-btn m3-btn-filled" disabled={mesgul || metin.trim() === d.metin.trim()} onClick={async () => {
          setMesgul(true);
          try { const v = await istek("/api/ana-direktifler", { metin }); setD({ ...d, metin: v.metin, ozel: true }); showAlert?.({ title: "Kaydedildi", message: "Ana direktifler bir sonraki mesajdan itibaren geçerli." }); }
          catch (err) { showAlert?.({ title: "Kaydedilemedi", message: err.message, danger: true }); }
          finally { setMesgul(false); }
        }}><Save size={14} /> Kaydet</button>
        <button type="button" className="m3-btn m3-btn-outlined" disabled={mesgul || !d.ozel} onClick={async () => {
          if (!(await showConfirm?.({ title: "Varsayılana dönülsün mü?", message: "Ana direktifler uygulamanın varsayılan metnine döner.", confirmLabel: "Varsayılana dön" }))) return;
          setMesgul(true);
          try { const v = await istek("/api/ana-direktifler/sifirla", {}); setD({ ...d, metin: v.metin, ozel: false }); setMetin(v.metin); }
          catch (err) { showAlert?.({ title: "Yapılamadı", message: err.message, danger: true }); }
          finally { setMesgul(false); }
        }}><RotateCcw size={14} /> Varsayılana dön</button>
      </div>
    </div>
  );
}

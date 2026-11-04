// Ayarlar > Kullanıcı ve kişisel hafıza
import React, { useCallback, useEffect, useState } from "react";
import { UserRound, Brain, Trash2, Plus, LogOut, RefreshCw, ShieldCheck, KeyRound } from "lucide-react";
import { kullaniciDurumu, kullaniciOlustur, cikisYap, sifreDegistir, hafizaGetir, hafizaAyar, hafizaNot, hafizaTemizle, hafizaTara, kullaniciListesi, kullaniciYonet } from "../services/kullaniciApi";

const kutu = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.82rem" };

export default function KullaniciHafiza({ showAlert, showConfirm }) {
  const [durum, setDurum] = useState(null);
  const [hafiza, setHafiza] = useState(null);
  const [form, setForm] = useState({ ad: "", sifre: "", sifre2: "" });
  const [sifreForm, setSifreForm] = useState(null);
  const [yeniNot, setYeniNot] = useState({ baslik: "Kişisel bilgiler", metin: "" });
  const [mesgul, setMesgul] = useState(false);
  const [liste, setListe] = useState([]);
  const [sifirlama, setSifirlama] = useState(null); // { id, ad, sifre }

  const uyar = (title, message, danger = false) => showAlert?.({ title, message, danger });
  const yenile = useCallback(async () => {
    try {
      const d = await kullaniciDurumu();
      setDurum(d);
      if (d.girisli) setHafiza(await hafizaGetir()); else setHafiza(null);
      if (d.girisli && d.kullanici?.yonetici) setListe((await kullaniciListesi()).kullanicilar || []); else setListe([]);
    } catch (err) { setDurum({ hata: err.message }); }
  }, []);
  useEffect(() => { yenile(); }, [yenile]);

  const calistir = async (is, basari) => {
    setMesgul(true);
    try { await is(); if (basari) uyar("Tamam", basari); await yenile(); }
    catch (err) { uyar("İşlem yapılamadı", err.message || String(err), true); }
    finally { setMesgul(false); }
  };

  const olustur = () => {
    if (form.sifre !== form.sifre2) { uyar("Şifreler aynı değil", "Şifreyi iki kez aynı yazın.", true); return; }
    calistir(async () => { await kullaniciOlustur(form.ad.trim(), form.sifre); setForm({ ad: "", sifre: "", sifre2: "" }); },
      durum?.kurulum ? "Kullanıcı eklendi. Kendi şifresiyle giriş yapabilir; sohbetleri, hafızası ve üretimleri ona özel tutulur."
        : "Kullanıcı oluşturuldu. Bundan sonra uygulama açılırken giriş istenecek; sohbetleriniz ve hafızanız size özel klasörde tutulacak.");
  };

  if (!durum) return null;
  const girisli = durum.girisli;

  return (
    <div className="m3-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="m3-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><UserRound size={18} /> Kullanıcı ve kişisel hafıza</div>

      {!durum.kurulum && (
        <>
          <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.9 }}>
            Bir kullanıcı oluşturursanız sohbet geçmişiniz şifreyle korunur ve Vega önceki sohbetlerinizden kısa notlar tutarak sizi tanır (kişisel hafıza).
            Mevcut sohbet geçmişiniz ilk kullanıcıya aktarılır. Her şey yalnızca bu bilgisayarda kalır.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <label style={kutu}>Kullanıcı adı<input className="m3-input" value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} /></label>
            <label style={kutu}>Şifre (en az 6)<input className="m3-input" type="password" value={form.sifre} onChange={(e) => setForm({ ...form, sifre: e.target.value })} autoComplete="new-password" /></label>
            <label style={kutu}>Şifre (tekrar)<input className="m3-input" type="password" value={form.sifre2} onChange={(e) => setForm({ ...form, sifre2: e.target.value })} autoComplete="new-password" /></label>
          </div>
          <div><button className="m3-btn m3-btn-filled" disabled={mesgul || !form.ad || !form.sifre} onClick={olustur}><Plus size={14} /> Kullanıcı oluştur</button></div>
        </>
      )}

      {durum.kurulum && girisli && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.9rem" }}>Giriş yapan: <b>{durum.kullanici.ad}</b>{durum.kullanici.yonetici ? " (yönetici)" : ""}</span>
            <button className="m3-btn m3-btn-outlined" disabled={mesgul} onClick={() => setSifreForm(sifreForm ? null : { eski: "", yeni: "" })}>Şifre değiştir</button>
            <button className="m3-btn m3-btn-outlined" disabled={mesgul} onClick={() => calistir(async () => { await cikisYap(); window.location.reload(); })}><LogOut size={14} /> Çıkış yap</button>
          </div>
          {sifreForm && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={kutu}>Mevcut şifre<input className="m3-input" type="password" value={sifreForm.eski} onChange={(e) => setSifreForm({ ...sifreForm, eski: e.target.value })} /></label>
              <label style={kutu}>Yeni şifre<input className="m3-input" type="password" value={sifreForm.yeni} onChange={(e) => setSifreForm({ ...sifreForm, yeni: e.target.value })} /></label>
              <button className="m3-btn m3-btn-filled" disabled={mesgul} onClick={() => calistir(async () => { await sifreDegistir(sifreForm.eski, sifreForm.yeni); setSifreForm(null); }, "Şifre değiştirildi.")}>Kaydet</button>
            </div>
          )}
          {durum.kullanici?.yonetici && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--md-sys-color-outline-variant)", paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><ShieldCheck size={16} /> <b>Kullanıcılar (yönetici)</b></div>
              {liste.map((u) => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "0.84rem" }}>
                  <span style={{ flex: 1, minWidth: 140 }}><b>{u.ad}</b>{u.yonetici ? " · yönetici" : ""}{u.ben ? " · siz" : ""} <span style={{ opacity: 0.7 }}>· {u.sohbet} sohbet</span></span>
                  <button className="m3-btn m3-btn-outlined" disabled={mesgul} onClick={() => setSifirlama({ id: u.id, ad: u.ad, sifre: "" })}><KeyRound size={13} /> Şifre sıfırla</button>
                  {!u.ben && (
                    <button className="m3-btn m3-btn-outlined" disabled={mesgul} onClick={() => calistir(() => kullaniciYonet(u.id, u.yonetici ? "yonetici-kaldir" : "yonetici"))}>
                      {u.yonetici ? "Yöneticiliği kaldır" : "Yönetici yap"}
                    </button>
                  )}
                  {!u.ben && (
                    <button className="m3-btn m3-btn-error" disabled={mesgul} onClick={async () => {
                      if (await showConfirm?.({ title: `${u.ad} silinsin mi?`, message: `${u.ad} hesabı, tüm sohbet geçmişi, kişisel hafızası ve üretimleriyle birlikte kalıcı olarak silinir. Bu işlem geri alınamaz.`, confirmLabel: "Kalıcı olarak sil", danger: true }))
                        calistir(() => kullaniciYonet(u.id, "sil"), `${u.ad} silindi.`);
                    }}><Trash2 size={13} /> Sil</button>
                  )}
                </div>
              ))}
              {sifirlama && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label style={kutu}>{sifirlama.ad} için yeni şifre<input className="m3-input" type="password" autoComplete="new-password" value={sifirlama.sifre} onChange={(e) => setSifirlama({ ...sifirlama, sifre: e.target.value })} /></label>
                  <button className="m3-btn m3-btn-filled" disabled={mesgul || sifirlama.sifre.length < 6} onClick={() => calistir(async () => { await kullaniciYonet(sifirlama.id, "sifirla", sifirlama.sifre); setSifirlama(null); }, "Şifre sıfırlandı.")}>Kaydet</button>
                  <button className="m3-btn m3-btn-outlined" onClick={() => setSifirlama(null)}>Vazgeç</button>
                </div>
              )}
              <details>
                <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Başka bir kullanıcı ekle</summary>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
                  <label style={kutu}>Kullanıcı adı<input className="m3-input" value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} /></label>
                  <label style={kutu}>Şifre<input className="m3-input" type="password" value={form.sifre} onChange={(e) => setForm({ ...form, sifre: e.target.value })} /></label>
                  <label style={kutu}>Şifre (tekrar)<input className="m3-input" type="password" value={form.sifre2} onChange={(e) => setForm({ ...form, sifre2: e.target.value })} /></label>
                  <button className="m3-btn m3-btn-outlined" disabled={mesgul || !form.ad || !form.sifre} onClick={olustur}><Plus size={14} /> Ekle</button>
                </div>
              </details>
            </div>
          )}

          {hafiza && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--md-sys-color-outline-variant)", paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Brain size={16} /> <b>Kişisel hafıza</b></div>
              <p style={{ margin: 0, fontSize: "0.8rem", opacity: 0.85 }}>
                Adınızı ya da "unutma / hatırla" dediğiniz bilgileri Vega anında not eder. Ayrıca bir sohbet bittiğinde (yaklaşık 1,5 dk sonra) yerel model sohbeti kısa notlara özetler. Yeni sohbette Vega bu notlarla başlar.
                Notları buradan düzeltebilir ya da silebilirsiniz.
              </p>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.85rem" }}>
                <input type="checkbox" checked={hafiza.acik} disabled={mesgul} onChange={(e) => calistir(() => hafizaAyar({ acik: e.target.checked }))} /> Hafıza açık
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.85rem" }}>
                <input type="checkbox" checked={hafiza.bulutta} disabled={mesgul} onChange={(e) => calistir(() => hafizaAyar({ bulutta: e.target.checked }))} /> Bulut modellerine de gönder (kapalıyken notlar yalnızca yerel modele verilir)
              </label>
              {hafiza.basliklar.map((b) => {
                const n = hafiza.notlar.filter((x) => x.baslik === b);
                if (!n.length) return null;
                return (
                  <div key={b}>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 4 }}>{b}</div>
                    {n.map((x) => (
                      <div key={x.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.82rem", padding: "3px 0" }}>
                        <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>• {x.metin}</span>
                        <button title="Notu sil" className="m3-btn" style={{ background: "transparent", border: 0, padding: 2 }} disabled={mesgul}
                          onClick={() => calistir(() => hafizaNot({ id: x.id, sil: true }))}><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                );
              })}
              {!hafiza.notlar.length && <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>Henüz not yok.</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <select className="m3-input" style={{ minWidth: 160, lineHeight: 1.4, paddingTop: 6, paddingBottom: 6 }} value={yeniNot.baslik} onChange={(e) => setYeniNot({ ...yeniNot, baslik: e.target.value })}>
                  {hafiza.basliklar.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <input className="m3-input" style={{ flex: 1, minWidth: 160 }} placeholder="Elle not ekle…" value={yeniNot.metin} onChange={(e) => setYeniNot({ ...yeniNot, metin: e.target.value })} />
                <button className="m3-btn m3-btn-outlined" disabled={mesgul || !yeniNot.metin.trim()} onClick={() => calistir(async () => { await hafizaNot(yeniNot); setYeniNot({ ...yeniNot, metin: "" }); })}><Plus size={14} /> Ekle</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="m3-btn m3-btn-outlined" disabled={mesgul} onClick={() => calistir(() => hafizaTara(), "Geçmiş sohbetler arka planda taranıyor. Yerel model yüklü olmalı; sohbet sayısına göre uzun sürebilir.")}><RefreshCw size={14} /> Geçmiş sohbetleri tara</button>
                <button className="m3-btn m3-btn-error" disabled={mesgul || !hafiza.notlar.length} onClick={async () => {
                  if (await showConfirm?.({ title: "Tüm notlar silinsin mi?", message: "Kişisel hafızadaki bütün notlar silinir. Sohbet arşiviniz silinmez.", confirmLabel: "Sil", danger: true })) calistir(() => hafizaTemizle());
                }}><Trash2 size={14} /> Tümünü sil</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

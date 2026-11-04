// Giriş ekranı. ilk=true: henüz kullanıcı yok, yönetici hesabı oluşturulur (uygulama kullanıcısız kullanılamaz)
import React, { useState } from "react";
import { LockKeyhole, LoaderCircle, ShieldCheck } from "lucide-react";
import { girisYap, kullaniciOlustur } from "../services/kullaniciApi";

const etiket = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" };

export default function GirisEkrani({ ilk = false, kullanicilar = [], onGiris }) {
  const [ad, setAd] = useState(!ilk && kullanicilar.length === 1 ? kullanicilar[0] : "");
  const [sifre, setSifre] = useState("");
  const [sifre2, setSifre2] = useState("");
  const [hata, setHata] = useState("");
  const [mesgul, setMesgul] = useState(false);

  const gonder = async (e) => {
    e.preventDefault();
    setHata("");
    if (ilk && sifre !== sifre2) { setHata("Şifreler aynı değil."); return; }
    setMesgul(true);
    try {
      const r = ilk ? await kullaniciOlustur(ad.trim(), sifre) : await girisYap(ad.trim(), sifre);
      onGiris?.(r.kullanici);
    } catch (err) { setHata(err.message || String(err)); }
    finally { setMesgul(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--md-sys-color-background)" }}>
      <form onSubmit={gonder} className="m3-card" style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {ilk ? <ShieldCheck size={22} /> : <LockKeyhole size={22} />}
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{ilk ? "Yönetici hesabı oluştur" : "Yerel AI Stüdyosu"}</h2>
        </div>
        {ilk ? (
          <>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.9 }}>
              Uygulamayı kullanmak için önce bir kullanıcı oluşturun. Sohbet geçmişiniz, kişisel hafızanız ve üretimleriniz şifreyle korunur; her şey yalnızca bu bilgisayarda kalır.
            </p>
            <div style={{ fontSize: "0.82rem", padding: "10px 12px", borderRadius: 10, background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)" }}>
              <b>Uyarı:</b> Oluşturacağınız bu ilk kullanıcı <b>yönetici (admin)</b> yetkisine sahip olacaktır: diğer kullanıcıları ekleyebilir, silebilir ve şifrelerini sıfırlayabilir. Şifrenizi unutmayın.
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.85 }}>Sohbet geçmişiniz ve kişisel hafızanız giriş korumalı. Devam etmek için giriş yapın.</p>
        )}
        <label style={etiket}>
          Kullanıcı adı
          {!ilk && kullanicilar.length > 1 ? (
            <select className="m3-input" value={ad} onChange={(e) => setAd(e.target.value)} required>
              <option value="">Seçin…</option>
              {kullanicilar.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          ) : (
            <input className="m3-input" value={ad} onChange={(e) => setAd(e.target.value)} autoComplete="username" required autoFocus={!ad} />
          )}
        </label>
        <label style={etiket}>
          {ilk ? "Şifre (en az 6 karakter)" : "Şifre"}
          <input className="m3-input" type="password" value={sifre} onChange={(e) => setSifre(e.target.value)} autoComplete={ilk ? "new-password" : "current-password"} required autoFocus={!!ad} />
        </label>
        {ilk && (
          <label style={etiket}>
            Şifre (tekrar)
            <input className="m3-input" type="password" value={sifre2} onChange={(e) => setSifre2(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {hata && <div style={{ color: "var(--md-sys-color-error)", fontSize: "0.85rem" }}>{hata}</div>}
        <button type="submit" className="m3-btn m3-btn-filled" disabled={mesgul} style={{ height: 40 }}>
          {mesgul ? <LoaderCircle className="progress-spinner" size={16} /> : null} {ilk ? "Yönetici hesabını oluştur" : "Giriş yap"}
        </button>
        {!ilk && (
          <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.7 }}>
            Şifrenizi unuttuysanız yönetici sıfırlayabilir. Yönetici şifresi unutulduysa: uygulama klasöründeki app/kullanicilar klasörünü silerek sıfırlayabilirsiniz (tüm hesaplar, sohbet arşivleri ve hafızalar da silinir; önce yedekleyin).
          </p>
        )}
      </form>
    </div>
  );
}

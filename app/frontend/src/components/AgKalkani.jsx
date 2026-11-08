// Ağ kalkanı ve ağ gözcüsü arayüzü (Yerel AI Stüdyosu)
//  - AgKalkaniUyari: üst bilgi çubuğunun altında kırmızı bayrak (internete çıkmaya çalışıp durdurulan motorlar) ve
//    kalkan kurulu değilse uyarı. Sohbet modelinin web araması bu kapsamda değildir (sunucu üzerinden, "Web" düğmesiyle).
//  - AgKalkaniKarti: Ayarlar'daki ayrıntı kartı.
//  - SorumlulukNotu: üçüncü taraf modeller için sorumluluk bilgisi (sihirbaz ve Model Yöneticisi).
import React, { useCallback, useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck, Flag, LoaderCircle, X, Info } from "lucide-react";

async function istek(url, govde) {
  const res = await fetch(url, govde === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde) });
  let v = {};
  try { v = await res.json(); } catch (_) {}
  if (!res.ok || v.ok === false) throw new Error(v.error || `İstek başarısız (HTTP ${res.status})`);
  return v;
}

export const SORUMLULUK_METNI = "Bu uygulama ek yetenekler için açık kaynaklı, üçüncü taraflarca geliştirilmiş yapay zekâ modelleri ve yazılım paketleri kullanır. "
  + "Bunlar uygulamanın geliştiricileri tarafından denetlenemez. Olası riskler nedeniyle model ve paket yükleme ile model seçimlerinde sorumluluk kullanıcıya aittir. "
  + "Ağ kalkanı ve ağ gözcüsü riski azaltır ama tamamen ortadan kaldırmaz.";

export function SorumlulukNotu({ style }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.8rem", padding: "10px 12px", borderRadius: 10,
      background: "color-mix(in srgb, #b45309 12%, transparent)", border: "1px solid color-mix(in srgb, #b45309 40%, transparent)", ...style }}>
      <Info size={16} style={{ flexShrink: 0, marginTop: 1, color: "#b45309" }} />
      <span>{SORUMLULUK_METNI}</span>
    </div>
  );
}

// Tek ortak durum: üst çubuk, uyarı şeridi ve Ayarlar kartı aynı veriyi paylaşır
let ortak = null;
const dinleyiciler = new Set();
const yay = (v) => { ortak = v; dinleyiciler.forEach((f) => f(v)); };
let zamanlayici = null;
async function ortakYenile(denetle = false) {
  try { const v = await istek(`/api/ag-kalkani${denetle ? "?denetle=1" : ""}`); yay(v); return v; } catch (_) { return null; }
}
function useAgKalkani() {
  const [d, setD] = useState(ortak);
  useEffect(() => {
    dinleyiciler.add(setD);
    if (!zamanlayici) { ortakYenile(false); zamanlayici = setInterval(() => ortakYenile(false), 15000); }
    return () => { dinleyiciler.delete(setD); if (!dinleyiciler.size && zamanlayici) { clearInterval(zamanlayici); zamanlayici = null; } };
  }, []);
  const set = useCallback((v) => yay(v), []);
  return [d, set, ortakYenile];
}

async function kalkaniKur(showAlert, setD) {
  try {
    const v = await istek("/api/ag-kalkani/kur", {});
    setD(v);
    showAlert?.({ title: "Ağ kalkanı kuruldu", message: "Motorların internete çıkışı kapatıldı. Bundan sonra inen yeni motorlar da kendiliğinden korunacak." });
  } catch (err) {
    showAlert?.({ title: "Ağ kalkanı kurulamadı", message: err.message || String(err), danger: true });
  }
}

export function AgKalkaniUyari({ showAlert }) {
  const [d, setD] = useAgKalkani();
  const [kuruluyor, setKuruluyor] = useState(false);
  if (!d || !d.windows) return null;
  const yonetici = window.__yasYonetici !== false;
  const k = d.kalkan || {};
  const kalkanEksik = (k.denetlendi > 0 || k.sonEsitleme) && !k.kapali && (!k.aktif || k.guvenlikDuvariAcik === false);
  const uyarilar = d.uyarilar || [];
  if (!uyarilar.length && !kalkanEksik) return null;
  const kapat = async (id) => { try { setD(await istek("/api/ag-kalkani/uyari-kapat", { id })); } catch (_) {} };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 16px 0" }}>
      {uyarilar.map((u) => (
        <div key={u.id} role="alert" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10,
          background: "color-mix(in srgb, var(--md-sys-color-error) 16%, transparent)", border: "1px solid var(--md-sys-color-error)", fontSize: "0.84rem" }}>
          <Flag size={18} style={{ color: "var(--md-sys-color-error)", flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
            <b>Güvenlik uyarısı:</b> <b>{u.program}</b> internete bağlanmaya çalıştı ({u.adres}{u.port ? `:${u.port}` : ""}) ve durduruldu.
            <div style={{ fontSize: "0.76rem", opacity: 0.85, marginTop: 2 }}>
              {new Date(u.zaman).toLocaleString("tr-TR")} · {u.yol}. Modeller ve motorlar internete çıkmamalıdır; bu motoru ya da en son kurduğunuz modeli/paketi kaldırmayı düşünün.
            </div>
          </div>
          <button type="button" title="Uyarıyı kapat" onClick={() => kapat(u.id)} style={{ background: "none", border: 0, cursor: "pointer", color: "inherit", padding: 2 }}><X size={15} /></button>
        </div>
      ))}
      {kalkanEksik && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", borderRadius: 10,
          background: "color-mix(in srgb, #b45309 14%, transparent)", border: "1px solid color-mix(in srgb, #b45309 45%, transparent)", fontSize: "0.82rem" }}>
          <ShieldAlert size={17} style={{ color: "#b45309", flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 200 }}>
            {k.guvenlikDuvariAcik === false
              ? "Windows Güvenlik Duvarı kapalı görünüyor: ağ kalkanı çalışamaz. Ağ gözcüsü yine izliyor. Güvenlik duvarı açıksa \"Kalkanı kur / onar\" durumu yeniden denetler."
              : "Ağ kalkanı kurulu değil: motorlar internete çıkabilir. Ağ gözcüsü izliyor ama kalkan önerilir."}
          </span>
          {(yonetici ? (
            <button type="button" className="m3-btn m3-btn-filled" style={{ height: 30, padding: "0 12px", fontSize: "0.8rem" }} disabled={kuruluyor}
              onClick={async () => { setKuruluyor(true); await kalkaniKur(showAlert, setD); setKuruluyor(false); }}>
              {kuruluyor ? <LoaderCircle className="progress-spinner" size={14} /> : <ShieldCheck size={14} />} Kalkanı kur / onar (yönetici izni)
            </button>
          ) : <span style={{ fontSize: "0.78rem", opacity: 0.85 }}>Yöneticinin kalkanı kurması gerekiyor.</span>)}
        </div>
      )}
    </div>
  );
}

// Üst çubuk (CPU'nun yanında): yeşil KALKAN (devrede) / KALKAN KAPALI; durdurulan bağlantı varsa solunda kırmızı uyarı.
// Yönetici göstergeye basınca kalkanı kapatır/açar (onay + her seferinde Windows yönetici izni); diğer kullanıcılar Ayarlar'a gider.
export function AgKalkaniDurum({ onAc, showConfirm, showAlert }) {
  const [d, setD] = useAgKalkani();
  const [mesgul, setMesgul] = useState(false);
  if (!d || !d.windows) return null;
  const k = d.kalkan || {};
  const uyariSayisi = (d.uyarilar || []).length;
  const yonetici = window.__yasYonetici !== false;
  const renk = k.aktif ? "#16a34a" : k.kapali ? "var(--md-sys-color-error)" : "#b45309";
  const tikla = async () => {
    if (!yonetici || (!k.aktif && !k.kapali)) { onAc?.(); return; }
    const kapat = k.aktif;
    const ok = await showConfirm?.(kapat
      ? { title: "Ağ kalkanı kapatılsın mı?", message: "Motorların ve modellerin internete çıkışı yeniden mümkün olur. Ağ gözcüsü izlemeye ve internete bağlanan motoru durdurmaya devam eder. Windows yönetici izni istenecek.", confirmLabel: "Kalkanı kapat", cancelLabel: "Vazgeç", danger: true }
      : { title: "Ağ kalkanı açılsın mı?", message: "Motorların ve modellerin internete çıkışı yeniden kapatılır. Windows yönetici izni istenecek.", confirmLabel: "Kalkanı aç", cancelLabel: "Vazgeç" });
    if (!ok) return;
    setMesgul(true);
    try {
      const res = await fetch(kapat ? "/api/ag-kalkani/kapat" : "/api/ag-kalkani/ac", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const v = await res.json().catch(() => ({}));
      if (!res.ok || v.ok === false) throw new Error(v.error || `HTTP ${res.status}`);
      setD(v);
    } catch (err) { showAlert?.({ title: "Kalkan değiştirilemedi", message: err.message || String(err), danger: true }); }
    finally { setMesgul(false); }
  };
  const baslik = k.aktif ? `Ağ kalkanı devrede: ${k.kuralSayisi} motorun internet çıkışı kapalı; ağ gözcüsü izliyor.${yonetici ? " Kapatmak için tıklayın (yönetici izni)." : ""}`
    : k.kapali ? `Ağ kalkanı yönetici tarafından kapatıldı; ağ gözcüsü izliyor.${yonetici ? " Açmak için tıklayın (yönetici izni)." : ""}`
    : "Ağ kalkanı kurulu değil. Ayrıntılar: Ayarlar";
  return (
    <>
      {uyariSayisi > 0 && (
        <span role="alert" style={{ color: "var(--md-sys-color-error)", fontWeight: 800, fontSize: "0.74rem", letterSpacing: "0.04em", whiteSpace: "nowrap", alignSelf: "center" }}>
          {uyariSayisi === 1 ? "İNTERNET DENEMESİ ENGELLENDİ" : `${uyariSayisi} İNTERNET DENEMESİ ENGELLENDİ`}
        </span>
      )}
      <button type="button" onClick={tikla} disabled={mesgul} title={baslik}
        className="telemetry-chip" style={{ cursor: "pointer", borderColor: renk, color: renk, fontWeight: 700, gap: 5, background: "transparent" }}>
        {mesgul ? <LoaderCircle className="progress-spinner" size={13} /> : k.aktif ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />} {k.aktif ? "KALKAN" : "KALKAN KAPALI"}
      </button>
    </>
  );
}

export function AgKalkaniKarti({ showAlert }) {
  const [d, setD, yenile] = useAgKalkani();
  const [kuruluyor, setKuruluyor] = useState(false);
  useEffect(() => { yenile(true); }, [yenile]);
  const yonetici = window.__yasYonetici !== false;
  const k = (d && d.kalkan) || {};
  return (
    <div className="m3-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="m3-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><ShieldCheck size={18} /> Ağ kalkanı ve ağ gözcüsü</div>
      <p style={{ margin: 0, fontSize: "0.84rem" }}>
        Modelleri çalıştıran motorlar (Python, metin, görsel, ses motorları) internete çıkamaz: kalkan Windows Güvenlik Duvarı ile engeller,
        gözcü internete bağlanmaya çalışan motoru durdurup sizi uyarır. Sohbetin web araması ve model indirme uygulamanın kendi sunucusundan,
        kontrollü olarak yapılır. Kalkanı yalnızca yönetici, üst çubuktaki KALKAN göstergesinden ve Windows yönetici izniyle kapatıp açabilir;
        gözcü her zaman çalışır.
      </p>
      {!d ? <p style={{ margin: 0, fontSize: "0.84rem" }}>Denetleniyor…</p> : !d.windows ? (
        <p style={{ margin: 0, fontSize: "0.84rem", opacity: 0.85 }}>Ağ kalkanı ve gözcü yalnızca Windows'ta çalışır.</p>
      ) : (
        <>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.84rem", display: "flex", flexDirection: "column", gap: 3 }}>
            <li>Windows Güvenlik Duvarı: <b>{k.guvenlikDuvariAcik === false ? "kapalı (kalkan çalışamaz)" : k.guvenlikDuvariAcik ? "açık" : "bilinmiyor (kalkan görevi denetleyecek)"}</b></li>
            <li>Kalkan: <b style={{ color: k.aktif ? "#16a34a" : k.kapali ? "var(--md-sys-color-error)" : undefined }}>{k.aktif ? "DEVREDE" : k.kapali ? "YÖNETİCİ TARAFINDAN KAPATILDI" : "kurulu değil"}</b>{k.aktif ? ` · ${k.kuralSayisi} motor kuralı · yeni motorlar kendiliğinden korunur` : ""}{k.sonEsitleme ? ` · son otomatik denetim: ${new Date(k.sonEsitleme).toLocaleString("tr-TR")}` : ""}{k.gorevGecikti ? " (otomatik görev uzun süredir çalışmadı)" : ""}</li>
            <li>Gözcü: <b>{d.gozcu && d.gozcu.calisiyor ? "çalışıyor (20 saniyede bir)" : "kapalı"}</b>{(d.uyarilar || []).length ? ` · ${(d.uyarilar || []).length} uyarı` : " · uyarı yok"}</li>
          </ul>
          {k.hata && <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--md-sys-color-error)" }}>{k.hata}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="m3-btn m3-btn-outlined" disabled={kuruluyor} onClick={() => yenile(true)}>Yeniden denetle</button>
            {yonetici ? (
              <button type="button" className={`m3-btn ${k.aktif ? "m3-btn-outlined" : "m3-btn-filled"}`} disabled={kuruluyor}
                onClick={async () => { setKuruluyor(true); await kalkaniKur(showAlert, setD); setKuruluyor(false); }}
                title="Kuralları ve otomatik görevi yeniden kurar (Windows yönetici izni istenir)">
                {kuruluyor ? <LoaderCircle className="progress-spinner" size={14} /> : <ShieldCheck size={14} />} {k.aktif ? "Kalkanı onar" : "Kalkanı kur (Windows yönetici izni istenir)"}
              </button>
            ) : <span style={{ fontSize: "0.8rem", alignSelf: "center" }}>Kalkanı yönetici kurabilir.</span>}
          </div>
        </>
      )}
      <SorumlulukNotu />
    </div>
  );
}

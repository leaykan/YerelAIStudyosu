import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Pencil, Play, Plus, ShieldCheck, Square, Trash2, UserRound, X } from "lucide-react";
import KlonEklePenceresi from "./KlonEklePenceresi";
import KlonOnayPenceresi, { kutuStili, hataStili } from "./KlonOnay";
import {
  klonDinlemeAdresi,
  klonDuzenle,
  klonListesi,
  klonMevcutSesiOnayla,
  klonOrnekleriSil,
  klonSil,
} from "../services/klonApi";

const kucukDugme = { height: 30, padding: "0 10px", fontSize: "0.8rem" };
const ikonDugme = { height: 30, width: 30, padding: 0 };

const tarihYaz = (t) => { try { return new Date(t).toLocaleDateString("tr-TR"); } catch (_) { return ""; } };

// Metinden Sese sayfasında OmniVoice seçiliyken görünen "Klon sesleri" bölümü
export default function KlonSesleri({ showAlert, showConfirm, onDegisti }) {
  const [veri, setVeri] = useState(null);
  const [hata, setHata] = useState("");
  const [ekleKipi, setEkleKipi] = useState(null); // "yukleme" | "ornekler" | null
  const [duzenlenen, setDuzenlenen] = useState(null); // { dosya, ad, metin }
  const [onaylanacak, setOnaylanacak] = useState(null);
  const [mesgul, setMesgul] = useState(false);
  const [calan, setCalan] = useState("");
  const sesRef = useRef(null);

  const yenile = useCallback(async () => {
    try {
      const v = await klonListesi();
      setVeri(v);
      setHata("");
      return v;
    } catch (err) {
      setHata(err.message || String(err));
      return null;
    }
  }, []);

  useEffect(() => { yenile(); }, [yenile]);
  useEffect(() => () => { try { sesRef.current?.pause(); } catch (_) { /* yok say */ } }, []);

  const degisti = async (sonuc) => {
    if (sonuc?.klonlar) setVeri(sonuc); else await yenile();
    onDegisti?.(sonuc);
  };

  const cal = (dosya) => {
    try { sesRef.current?.pause(); } catch (_) { /* yok say */ }
    if (calan === dosya) { setCalan(""); return; }
    const a = new Audio(klonDinlemeAdresi(dosya));
    sesRef.current = a;
    setCalan(dosya);
    a.onended = () => setCalan("");
    a.onerror = () => setCalan("");
    a.play().catch(() => setCalan(""));
  };

  const sil = async (k) => {
    const tamam = showConfirm
      ? await showConfirm({ title: "Klon ses silinsin mi?", message: `"${k.ad}" klonunun ses kaydı, metni ve onay kaydı bu bilgisayardan kalıcı olarak silinecek.`, confirmLabel: "Sil", cancelLabel: "Vazgeç", danger: true })
      : window.confirm(`"${k.ad}" silinsin mi?`);
    if (!tamam) return;
    setMesgul(true);
    try { await degisti(await klonSil(k.dosya)); } catch (err) { showAlert?.({ title: "Silinemedi", message: err.message, danger: true }); }
    finally { setMesgul(false); }
  };

  const duzenlemeyiKaydet = async () => {
    const d = duzenlenen;
    if (!d) return;
    const k = veri?.klonlar?.find((x) => x.dosya === d.dosya);
    const degisiklik = {};
    if (k && d.ad.trim() !== k.ad) degisiklik.yeniAd = d.ad.trim();
    if (k && d.metin.trim() !== (k.metin || "")) degisiklik.metin = d.metin.trim();
    if (!Object.keys(degisiklik).length) { setDuzenlenen(null); return; }
    setMesgul(true);
    try { await degisti(await klonDuzenle(d.dosya, degisiklik)); setDuzenlenen(null); }
    catch (err) { showAlert?.({ title: "Kaydedilemedi", message: err.message, danger: true }); }
    finally { setMesgul(false); }
  };

  const ornekleriSil = async () => {
    const tamam = showConfirm
      ? await showConfirm({ title: "Toplanan örnekler silinsin mi?", message: "Sesli sohbetten toplanan tüm ses örnekleri ve metinleri silinecek. Oluşturulmuş klonlar silinmez.", confirmLabel: "Sil", cancelLabel: "Vazgeç", danger: true })
      : window.confirm("Toplanan örnekler silinsin mi?");
    if (!tamam) return;
    try { setVeri(await klonOrnekleriSil()); } catch (err) { showAlert?.({ title: "Silinemedi", message: err.message, danger: true }); }
  };

  const ornek = veri?.ornekler;
  const vegaDosyasi = veri?.ayarlar?.vegaKlonSesi ? veri.ayarlar.vegaKlonDosyasi : "";

  return (
    <section className="m3-card speech-panel" style={{ gridColumn: "1 / -1" }}>
      <div className="speech-panel-header">
        <h3>Klon sesleri</h3>
        <button type="button" className="m3-btn m3-btn-filled" style={{ height: 34 }} onClick={() => setEkleKipi("yukleme")}>
          <Plus size={14} /> <span>Klon sesi ekle</span>
        </button>
      </div>
      <div style={{ fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.45 }}>
        Yalnızca sahibinin açık onayı olan sesleri klonlayın. Kayıtlar ve onay kayıtları yalnızca bu bilgisayarda (app/reference-voices) durur.
        İşlemcide (ekran kartı olmadan) klonla seslendirme yavaştır: model ilk açılışta birkaç dakikada yüklenir, sonra
        her cümle yarım dakikadan birkaç dakikaya kadar sürebilir. 8-12 sn'lik kısa bir referans kaydı daha hızlıdır.
      </div>

      {hata && <div style={hataStili}>{hata}</div>}

      {veri && veri.klonlar.length === 0 && (
        <div style={{ ...kutuStili, fontSize: "0.84rem" }}>Henüz klon ses yok. "Klon sesi ekle" ile bir kayıt yükleyin.</div>
      )}

      {veri?.klonlar?.map((k) => {
        const duzenleniyor = duzenlenen?.dosya === k.dosya;
        return (
          <div key={k.dosya} style={{ ...kutuStili, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="m3-btn m3-btn-tonal" style={ikonDugme} title={calan === k.dosya ? "Durdur" : "Referans kaydı dinle"} onClick={() => cal(k.dosya)}>
                {calan === k.dosya ? <Square size={12} fill="currentColor" /> : <Play size={14} />}
              </button>
              {duzenleniyor ? (
                <input className="m3-input" style={{ flex: 1, minWidth: 160, height: 32 }} maxLength={60} value={duzenlenen.ad}
                  onChange={(e) => setDuzenlenen({ ...duzenlenen, ad: e.target.value })} aria-label="Klon adı" />
              ) : (
                <span style={{ fontWeight: 700, flex: 1, minWidth: 120 }}>{k.ad}</span>
              )}
              {vegaDosyasi === k.dosya && <span className="status-chip">Vega'nın sesi</span>}
              <span style={{ fontSize: "0.76rem", opacity: 0.8, display: "inline-flex", alignItems: "center", gap: 4 }}
                title={`Onay kaydı: ${tarihYaz(k.onay?.tarih)}${k.onay?.izinTarihi ? ` · izin tarihi: ${tarihYaz(k.onay.izinTarihi)}` : ""} · ${k.onay?.surum || ""}`}>
                <ShieldCheck size={13} /> {k.onay?.sesSahibi === "baskasi" ? `Ses sahibi: ${k.onay.sesSahibiAdi}` : "Kendi sesim"}
                {k.sure ? ` · ${String(k.sure).replace(".", ",")} sn` : ""}
                {k.sure > 15 ? <span title="Referans kayıt uzun: klonla her cümle işlemcide daha yavaş üretilir. 8-12 sn'lik yeni bir klon oluşturmak hızlandırır." style={{ color: "rgb(217, 119, 6)" }}>· uzun (yavaşlatır)</span> : null}
              </span>
              {duzenleniyor ? (
                <>
                  <button type="button" className="m3-btn m3-btn-filled" style={ikonDugme} title="Kaydet" disabled={mesgul} onClick={duzenlemeyiKaydet}><Check size={14} /></button>
                  <button type="button" className="m3-btn m3-btn-outlined" style={ikonDugme} title="Vazgeç" disabled={mesgul} onClick={() => setDuzenlenen(null)}><X size={14} /></button>
                </>
              ) : (
                <>
                  <button type="button" className="m3-btn m3-btn-outlined" style={ikonDugme} title="Adı ve metni düzenle" disabled={mesgul}
                    onClick={() => setDuzenlenen({ dosya: k.dosya, ad: k.ad, metin: k.metin || "" })}><Pencil size={14} /></button>
                  <button type="button" className="m3-btn m3-btn-error" style={ikonDugme} title="Sil (ses, metin ve onay kaydı)" disabled={mesgul}
                    onClick={() => sil(k)}><Trash2 size={14} /></button>
                </>
              )}
            </div>
            {duzenleniyor ? (
              <textarea className="m3-input" rows={3} maxLength={1000} value={duzenlenen.metin} aria-label="Kayıtta söylenenler"
                onChange={(e) => setDuzenlenen({ ...duzenlenen, metin: e.target.value })} style={{ width: "100%", height: "auto", minHeight: 80, padding: "8px 12px", resize: "vertical", lineHeight: 1.4 }} />
            ) : (
              <div style={{ fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.4 }}>
                {k.metin ? `“${k.metin.length > 220 ? `${k.metin.slice(0, 220)}…` : k.metin}”` : "Metin yok: düzenleyip kayıtta söylenenleri yazın."}
              </div>
            )}
          </div>
        );
      })}

      {veri?.onaysiz?.length > 0 && (
        <div style={{ ...kutuStili, display: "flex", flexDirection: "column", gap: 8, fontSize: "0.82rem" }}>
          <div style={{ fontWeight: 600 }}>Onay kaydı olmayan sesler (kullanılmıyor)</div>
          <div style={{ opacity: 0.85 }}>Bu dosyalar app/reference-voices klasörüne elle konmuş. Kullanmak için ses sahibinin onayını beyan edin ya da dosyayı silin.</div>
          {veri.onaysiz.map((k) => (
            <div key={k.dosya} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 120, wordBreak: "break-all" }}>{k.dosya}</span>
              <button type="button" className="m3-btn m3-btn-tonal" style={kucukDugme} onClick={() => setOnaylanacak(k)}>Onay ver</button>
              <button type="button" className="m3-btn m3-btn-error" style={ikonDugme} title="Sil" onClick={() => sil(k)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {ornek && (ornek.adet > 0 || veri?.ayarlar?.ornekTopla) && (
        <div style={{ ...kutuStili, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "0.82rem" }}>
          <UserRound size={16} />
          <span style={{ flex: 1, minWidth: 180 }}>
            Sesli sohbetten toplanan örnekler: {ornek.adet} parça, ~{ornek.uygunSn} sn kullanılabilir
            {veri?.ayarlar?.ornekTopla ? " (toplama açık)" : " (toplama kapalı)"}
          </span>
          <button type="button" className="m3-btn m3-btn-tonal" style={kucukDugme} disabled={!ornek.adet} onClick={() => setEkleKipi("ornekler")}>
            Örneklerimden klon oluştur
          </button>
          <button type="button" className="m3-btn m3-btn-outlined" style={kucukDugme} disabled={!ornek.adet} onClick={ornekleriSil}>
            Toplanan örnekleri sil
          </button>
        </div>
      )}

      <KlonEklePenceresi acik={Boolean(ekleKipi)} kip={ekleKipi || "yukleme"} kapat={() => setEkleKipi(null)} eklendi={degisti} />
      <KlonOnayPenceresi
        acik={Boolean(onaylanacak)}
        aciklama={onaylanacak ? `"${onaylanacak.dosya}" dosyası klon ses olarak kullanılacak.` : ""}
        mesgul={mesgul}
        onVazgec={() => setOnaylanacak(null)}
        onOnay={async (onay) => {
          setMesgul(true);
          try { await degisti(await klonMevcutSesiOnayla(onaylanacak.dosya, onay)); setOnaylanacak(null); }
          catch (err) { showAlert?.({ title: "Onay kaydedilemedi", message: err.message, danger: true }); }
          finally { setMesgul(false); }
        }}
      />
    </section>
  );
}

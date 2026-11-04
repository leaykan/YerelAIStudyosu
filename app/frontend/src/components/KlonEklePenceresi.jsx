import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, FileAudio, Lightbulb, LoaderCircle, ShieldAlert, Upload, UserRound, X } from "lucide-react";
import { KlonOnayIcerigi, kutuStili, hataStili } from "./KlonOnay";
import {
  aralikMonoYap,
  klonGeciciDinlemeAdresi,
  klonKaydet,
  klonOrnektenHazirla,
  klonSesYukle,
  sesDosyasiCoz,
} from "../services/klonApi";
import { wavKodla } from "../sesliSohbet";

const AZAMI_DOSYA_MB = 100;
const AZAMI_SN = 30;

const sn = (v) => `${(Number(v) || 0).toFixed(1).replace(".", ",")} sn`;
// Klon ekleme penceresinde gösterilen kayıt ipucu (klon, kaydın tınısıyla birlikte gürültüsünü ve yankısını da taklit eder)
const KAYIT_IPUCU = "En iyi sonuç için: sessiz bir odada, mikrofona yakın, 8–12 saniye net ve doğal konuşun; arka plan sesi, yankı ve müzik klonu bozar.";
const ORNEK_GURULTU_NOTU = "Sesli sohbetten toplanan örnekler, konuşurken odadaki sesleri (fan, klima, televizyon, yankı) de içerebilir. Klon kötü çıkarsa sessiz bir odada 8–12 saniyelik yeni bir kayıt yapıp Metinden Sese › OmniVoice › Klon sesleri › \"Klon sesi ekle\" ile yükleyin.";

// Kayıt ipucu kutusu: referans kaydın kalitesi klonun kalitesini doğrudan belirler
function KayitIpucu({ ornekler = false }) {
  return (
    <div role="note" className="klon-kayit-ipucu" style={{ ...kutuStili, display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.84rem", lineHeight: 1.5 }}>
      <Lightbulb size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--md-sys-color-primary)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span><b>Kayıt ipucu.</b> {KAYIT_IPUCU}</span>
        {ornekler && <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>{ORNEK_GURULTU_NOTU}</span>}
      </div>
    </div>
  );
}

// Klon ses ekleme sihirbazı: (1) yasal uyarı + onay, (2) dosya seçimi (yalnızca yüklemede),
// (3) gözden geçirme: dinle, adı ve yazıya dökülen metni düzelt, kaydet.
// kip: "yukleme" (ses dosyası) | "ornekler" (sesli sohbetten toplanan örnekler → "Benim sesim")
export default function KlonEklePenceresi({ acik, kip = "yukleme", varsayilanAd = "", kapat, eklendi }) {
  const [adim, setAdim] = useState("onay");
  const [onay, setOnay] = useState(null);
  const [mesgul, setMesgul] = useState("");
  const [hata, setHata] = useState("");
  const [dosya, setDosya] = useState(null);
  const [cozulmus, setCozulmus] = useState(null);
  const [basSn, setBasSn] = useState(0);
  const [sureSn, setSureSn] = useState(20);
  const [dil, setDil] = useState("tr");
  const [hazir, setHazir] = useState(null); // { belirtec, sure, metin, uyarilar, kullanilan }
  const [ad, setAd] = useState("");
  const [metin, setMetin] = useState("");
  const dosyaRef = useRef(null);
  const onizlemeRef = useRef(null);

  useEffect(() => {
    if (!acik) return;
    setAdim("onay"); setOnay(null); setMesgul(""); setHata(""); setDosya(null); setCozulmus(null);
    setBasSn(0); setSureSn(20); setHazir(null); setMetin("");
    setAd(varsayilanAd || (kip === "ornekler" ? "Benim sesim" : ""));
  }, [acik, kip, varsayilanAd]);

  useEffect(() => () => { if (onizlemeRef.current) URL.revokeObjectURL(onizlemeRef.current); }, []);

  if (!acik) return null;

  const pencereyiKapat = () => { if (!mesgul) kapat?.(); };

  const onayVerildi = async (o) => {
    setOnay(o);
    setHata("");
    if (kip !== "ornekler") { setAdim("dosya"); return; }
    setMesgul("Örnekleriniz seçiliyor ve birleştiriliyor…");
    try {
      const r = await klonOrnektenHazirla(o);
      setHazir(r);
      setMetin(r.metin || "");
      setAdim("gozden");
    } catch (err) {
      setHata(err.message || String(err));
    } finally {
      setMesgul("");
    }
  };

  const dosyaSecildi = async (f) => {
    setHata(""); setCozulmus(null); setDosya(f || null);
    if (!f) return;
    if (f.size > AZAMI_DOSYA_MB * 1024 * 1024) { setHata(`Dosya çok büyük (en fazla ${AZAMI_DOSYA_MB} MB). Kaydın kısa bir bölümünü kullanın.`); return; }
    if (f.type && !/^(audio|video)\//.test(f.type)) { setHata("Yalnızca ses dosyaları seçilebilir (WAV, MP3, M4A, OGG, FLAC, WEBM…)."); return; }
    setMesgul("Ses dosyası okunuyor…");
    try {
      const b = await sesDosyasiCoz(f);
      setCozulmus(b);
      setBasSn(0);
      // Varsayılan 12 sn: OmniVoice 3-10 sn öneriyor; kısa referans işlemcide her cümleyi hızlandırır
      setSureSn(Math.min(AZAMI_SN, Math.max(3, Math.floor(b.duration)), 12));
      if (!ad.trim()) setAd(f.name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N} ._'()-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60));
      if (b.duration < 3) setHata("Kayıt 3 saniyeden kısa. En az 3 sn (önerilen 8-12 sn) net konuşma gerekir.");
    } catch (_) {
      setHata("Bu dosya çözülemedi. WAV, MP3, M4A, OGG ya da FLAC deneyin.");
    } finally {
      setMesgul("");
    }
  };

  const toplamSn = cozulmus?.duration || 0;
  const azamiBas = Math.max(0, toplamSn - 3);
  const gercekSure = Math.max(0, Math.min(sureSn, AZAMI_SN, toplamSn - basSn));

  const onizle = async () => {
    if (!cozulmus) return;
    try {
      const mono = await aralikMonoYap(cozulmus, basSn, gercekSure);
      if (onizlemeRef.current) URL.revokeObjectURL(onizlemeRef.current);
      onizlemeRef.current = URL.createObjectURL(wavKodla(mono, 24000));
      const a = new Audio(onizlemeRef.current);
      a.play().catch(() => {});
    } catch (err) {
      setHata(err.message || String(err));
    }
  };

  const yukle = async () => {
    if (!cozulmus || gercekSure < 3) return;
    setHata("");
    setMesgul("Ses hazırlanıyor ve yazıya dökülüyor… (konuşma modeli ilk açılışta biraz sürebilir)");
    try {
      const mono = await aralikMonoYap(cozulmus, basSn, gercekSure);
      const r = await klonSesYukle(wavKodla(mono, 24000), onay, { dil });
      setHazir(r);
      setMetin(r.metin || "");
      setAdim("gozden");
    } catch (err) {
      setHata(err.message || String(err));
    } finally {
      setMesgul("");
    }
  };

  const kaydet = async () => {
    if (!hazir || !ad.trim() || metin.trim().length < 2) return;
    setHata("");
    setMesgul("Klon ses kaydediliyor…");
    try {
      const r = await klonKaydet(hazir.belirtec, ad.trim(), metin.trim(), onay);
      setMesgul("");
      eklendi?.(r);
      kapat?.();
    } catch (err) {
      setMesgul("");
      setHata(err.message || String(err));
      // Onay metni değiştiyse ya da onay reddedildiyse uyarı yeniden gösterilir (ad çakışmasında değil)
      if (err.status === 403 || (err.status === 409 && err.code !== "AD_CAKISMASI")) { setAdim("onay"); setOnay(null); }
    }
  };

  const baslik = adim === "onay" ? "Ses klonlama: yasal uyarı" : kip === "ornekler" ? "Örneklerimden klon oluştur" : "Klon sesi ekle";

  return createPortal(
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) pencereyiKapat(); }}>
      <div className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="klon-ekle-baslik"
        style={{ width: "min(600px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {adim === "gozden" && kip === "yukleme" && (
            <button type="button" className="m3-btn m3-btn-outlined" style={{ height: 32, width: 32, padding: 0 }} title="Geri"
              disabled={Boolean(mesgul)} onClick={() => { setAdim("dosya"); setHata(""); }}>
              <ArrowLeft size={16} />
            </button>
          )}
          <h3 id="klon-ekle-baslik" className="app-dialog-title" style={{ margin: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
            {adim === "onay" ? <ShieldAlert size={20} /> : kip === "ornekler" ? <UserRound size={20} /> : <FileAudio size={20} />} {baslik}
          </h3>
          <button type="button" className="m3-btn m3-btn-outlined" style={{ height: 32, width: 32, padding: 0 }} title="Kapat"
            disabled={Boolean(mesgul)} onClick={pencereyiKapat}>
            <X size={16} />
          </button>
        </div>

        {adim === "onay" && (
          <>
            <p className="app-dialog-message" style={{ margin: 0 }}>
              {kip === "ornekler"
                ? "Sesli sohbette toplanan kendi ses örneklerinizden bir klon (\"Benim sesim\") oluşturulacak. Devam etmeden önce okuyun:"
                : "Bir ses kaydından OmniVoice klon sesi oluşturulacak. Devam etmeden önce okuyun:"}
            </p>
            {kip === "ornekler" && <KayitIpucu ornekler />}
            <KlonOnayIcerigi sadeceKendim={kip === "ornekler"} onOnay={onayVerildi} onVazgec={pencereyiKapat} mesgul={Boolean(mesgul)} />
          </>
        )}

        {adim === "dosya" && (
          <>
            <p className="app-dialog-message" style={{ margin: 0 }}>
              Tek kişinin konuştuğu, müziksiz ve gürültüsüz 8-12 saniyelik bir kayıt yeterlidir (en az 3, en fazla 30 sn).
              Kayıt uzadıkça klonla her cümle (özellikle ekran kartı olmayan bilgisayarlarda) daha yavaş üretilir.
              Dosya bu bilgisayarda WAV'a çevrilir; hiçbir yere gönderilmez.
            </p>
            <KayitIpucu />
            <input ref={dosyaRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.oga,.opus,.flac,.webm,.aac" style={{ display: "none" }}
              onChange={(e) => { dosyaSecildi(e.target.files?.[0]); e.target.value = ""; }} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="m3-btn m3-btn-tonal" disabled={Boolean(mesgul)} onClick={() => dosyaRef.current?.click()}>
                <Upload size={14} /> <span>{dosya ? "Başka dosya seç" : "Ses dosyası seç"}</span>
              </button>
              {dosya && <span style={{ fontSize: "0.84rem", wordBreak: "break-all" }}>{dosya.name}{cozulmus ? ` · ${sn(toplamSn)}` : ""}</span>}
            </div>

            {cozulmus && toplamSn >= 3 && (
              <div style={{ ...kutuStili, display: "flex", flexDirection: "column", gap: 10, fontSize: "0.84rem" }}>
                {toplamSn > AZAMI_SN ? (
                  <>
                    <div>Kayıt {sn(toplamSn)}; en fazla {AZAMI_SN} sn kullanılabilir. Kullanılacak bölümü seçin:</div>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span>Başlangıç: {sn(basSn)}</span>
                      <input type="range" min={0} max={azamiBas} step={0.5} value={Math.min(basSn, azamiBas)}
                        onChange={(e) => setBasSn(Number(e.target.value))} />
                    </label>
                  </>
                ) : null}
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>Uzunluk: {sn(gercekSure)} (önerilen 8-12 sn{gercekSure > 15 ? "; uzun kayıt işlemcide klonu yavaşlatır" : ""})</span>
                  <input type="range" min={3} max={Math.max(3, Math.min(AZAMI_SN, Math.floor(toplamSn)))} step={0.5} value={Math.min(sureSn, AZAMI_SN)}
                    onChange={(e) => setSureSn(Number(e.target.value))} />
                </label>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" className="m3-btn m3-btn-outlined" style={{ height: 32 }} onClick={onizle} disabled={Boolean(mesgul)}>Seçili bölümü dinle</button>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    Kayıttaki dil
                    <select className="m3-input" style={{ height: 32, padding: "0 8px" }} value={dil} onChange={(e) => setDil(e.target.value)}>
                      <option value="tr">Türkçe</option>
                      <option value="en">İngilizce</option>
                      <option value="auto">Otomatik</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            <div className="app-dialog-actions" style={{ marginTop: 0 }}>
              <button type="button" className="m3-btn m3-btn-filled" disabled={!cozulmus || gercekSure < 3 || Boolean(mesgul)} onClick={yukle}>
                Hazırla ve yazıya dök
              </button>
            </div>
          </>
        )}

        {adim === "gozden" && hazir && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <audio controls src={klonGeciciDinlemeAdresi(hazir.belirtec)} style={{ width: "100%" }} />
              <div style={{ fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)" }}>
                Referans kayıt: {sn(hazir.sure)}{hazir.kullanilan ? ` · ${hazir.kullanilan} örnekten birleştirildi` : ""}
              </div>
            </div>
            {kip === "ornekler" && <KayitIpucu ornekler />}
            {(hazir.uyarilar || []).length > 0 && (
              <div style={{ ...kutuStili, fontSize: "0.82rem" }}>
                {hazir.uyarilar.map((u) => <div key={u}>• {u}</div>)}
              </div>
            )}
            <div className="m3-text-field">
              <label className="m3-text-field-label" htmlFor="klon-ad">Klon sesin adı</label>
              <input id="klon-ad" className="m3-input" type="text" maxLength={60} value={ad} onChange={(e) => setAd(e.target.value)} placeholder="ör. Anlatıcı sesim" />
            </div>
            <div className="m3-text-field">
              <label className="m3-text-field-label" htmlFor="klon-metin">Kayıtta söylenenler (birebir aynı olmalı; gerekirse düzeltin)</label>
              <textarea id="klon-metin" className="m3-input" rows={4} maxLength={1000} value={metin} onChange={(e) => setMetin(e.target.value)}
                style={{ width: "100%", height: "auto", minHeight: 104, padding: "10px 12px", resize: "vertical", lineHeight: 1.45 }} placeholder="Kayıtta söylenen cümleleri yazın…" />
            </div>
            <div className="app-dialog-actions" style={{ marginTop: 0 }}>
              <button type="button" className="m3-btn m3-btn-outlined" disabled={Boolean(mesgul)} onClick={pencereyiKapat}>Vazgeç</button>
              <button type="button" className="m3-btn m3-btn-filled" disabled={!ad.trim() || metin.trim().length < 2 || Boolean(mesgul)} onClick={kaydet}>
                Klonu kaydet
              </button>
            </div>
          </>
        )}

        {mesgul && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem" }}>
            <LoaderCircle size={16} className="progress-spinner" /> {mesgul}
          </div>
        )}
        {hata && <div role="alert" style={hataStili}>{hata}</div>}
      </div>
    </div>,
    document.body,
  );
}

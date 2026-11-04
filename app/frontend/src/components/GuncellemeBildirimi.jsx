// Açılışta model güncellemesi bildirimi (Yerel AI Stüdyosu)
// App.jsx'te bir kez bağlanır: <GuncellemeBildirimi showAlert={showAlert} showConfirm={showConfirm} />
// Sunucu (scripts/server/guncelleme.cjs) denetimi açılıştan ~1 dk sonra, günde en çok bir kez yapar; internet
// yoksa sessizce atlar. Bu bileşen sonucu birkaç kez seyrek yoklar ve güncelleme varsa pencereyi açar.
// Hiçbir güncelleme kullanıcı onaylamadan uygulanmaz. Kod ya da pickle içeren paketler ve sürümü Python kodunda
// sabit motor ağırlıkları "Elle inceleme gerekiyor" olarak gösterilir ve buradan güncellenemez.
// Python (pip) paketleri "test edilmeden önerilmez" olarak listelenir, "Tümünü güncelle"ye girmez ve ayrı bir
// onay penceresiyle (ikinci onay) güncellenir. "Bu sürümü atla" / "Bir daha sorma" app/config/guncelleme.json'a yazılır.
// Güncelleme bitince window'da "yas-modeller-degisti" olayı yayınlanır (model listeleri yenilensin diye).
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, ShieldAlert, ShieldCheck, ExternalLink, RefreshCw, AlertTriangle } from "lucide-react";
import { guncellemeleriGetir, guncellemeleriUygula, surumuAtla, birDahaSorma, sorulmayanlariSifirla, boyutYaz, tarihYaz, bekle, isBitinceyeKadarIzle } from "../services/guncellemeApi";

const TUR_AD = { text: "Metin", image: "Görsel", speech: "Sesten metne", tts: "Metinden sese", paket: "Model paketi", muzik: "Müzik / efekt", video: "Video", pip: "Python paketi" };
const DURUM_AD = { degisti: "değişti", eklendi: "eklendi", silindi: "kaldırıldı" };

const st = {
  pencere: { width: "min(760px, 100%)", maxHeight: "min(86vh, 900px)", display: "flex", flexDirection: "column", gap: "12px", textAlign: "left" },
  liste: { overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" },
  oge: { border: "1px solid var(--md-sys-color-outline-variant)", borderRadius: "var(--md-shape-corner-medium)", padding: "12px", display: "flex", flexDirection: "column", gap: "6px", background: "var(--md-sys-color-surface-variant)" },
  kucuk: { fontSize: "0.75rem", color: "var(--md-sys-color-outline)" },
  kod: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: "0.72rem", overflowWrap: "anywhere" },
  elle: { display: "flex", gap: "6px", alignItems: "flex-start", fontSize: "0.78rem", color: "var(--md-sys-color-error)", fontWeight: 600 },
  testsiz: { display: "flex", gap: "6px", alignItems: "flex-start", fontSize: "0.78rem", color: "#b45309", fontWeight: 600 },
  bag: { color: "var(--md-sys-color-primary)", fontWeight: 600, fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "3px" },
  satir: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  dugme: { height: "32px", padding: "0 12px", fontSize: "0.8rem" },
};

// 40 haneli commit → ilk 7 hane; "yerel" (sürümü bilinmeyen yerel dosya) olduğu gibi
const kisa = (s) => (/^[0-9a-f]{40}$/.test(String(s)) ? String(s).slice(0, 7) : s === "yerel" ? "yerel dosya" : String(s || ""));

export default function GuncellemeBildirimi({ showAlert, showConfirm }) {
  const [veri, setVeri] = useState(null); // { guncellemeler }
  const [acik, setAcik] = useState(false);
  const [mesgul, setMesgul] = useState(null); // ilerleme metni
  const kapatildi = useRef(false); // "Daha sonra": bu oturumda yeniden açılmaz
  const bagli = useRef(true);
  useEffect(() => { bagli.current = true; return () => { bagli.current = false; }; }, []);

  const uyar = useCallback((title, message, danger = false) => (showAlert
    ? showAlert({ title, message, confirmLabel: "Tamam", danger })
    : Promise.resolve(window.alert(`${title}\n\n${message}`))), [showAlert]);
  const sor = useCallback((title, message, confirmLabel, danger = false) => (showConfirm
    ? showConfirm({ title, message, confirmLabel, cancelLabel: "Vazgeç", danger })
    : Promise.resolve(window.confirm(`${title}\n\n${message}`))), [showConfirm]);

  const getir = useCallback(async () => {
    const r = await guncellemeleriGetir(false);
    if (!bagli.current) return r;
    setVeri(r);
    if (!kapatildi.current && r.guncellemeler && r.guncellemeler.length > 0) setAcik(true);
    return r;
  }, []);

  // Açılış: sunucu denetimi bitene kadar seyrek yokla (en çok ~8 dk); hata/çevrimdışı ise sessizce vazgeç
  useEffect(() => {
    let iptal = false;
    (async () => {
      for (let i = 0; i < 22 && !iptal; i += 1) {
        try {
          const r = await getir();
          const bugunDenetlendi = !r.denetleniyor && r.sonDenetim && Date.now() - r.sonDenetim < 25 * 60 * 60 * 1000;
          if (bugunDenetlendi || (r.guncellemeler && r.guncellemeler.length)) return;
        } catch (_) { return; }
        await bekle(i === 0 ? 75000 : 20000);
      }
    })();
    return () => { iptal = true; };
  }, [getir]);

  const uygula = useCallback(async (govde) => {
    setMesgul("Güncelleme başlıyor…");
    try {
      const r = await guncellemeleriUygula(govde);
      if (r.ikinciOnayGerekli) { await uyar("Onay gerekli", r.error || "Bu güncelleme ikinci bir onay gerektiriyor.", true); return; }
      const is = await isBitinceyeKadarIzle((d) => {
        if (bagli.current) setMesgul(`${d.ad}: ${d.asama}${d.ilerleme != null ? ` %${d.ilerleme}` : ""}${d.hiz ? ` · ${d.hiz}` : ""}`);
      }, () => !bagli.current);
      if (!is) return;
      const sonuclar = (is.sonuc && is.sonuc.sonuclar) || [];
      const basarisiz = sonuclar.filter((s) => !s.ok);
      if (is.hata) await uyar("Güncelleme yapılamadı", `${is.hata}\n\nÖnceki sürüm korundu; model çalışmaya devam eder.`, true);
      else if (basarisiz.length) await uyar("Bazı güncellemeler yapılamadı", basarisiz.map((s) => `• ${s.ad || s.id}: ${s.hata}`).join("\n") + "\n\nBunların önceki sürümü korundu.", true);
      else await uyar("Güncelleme tamamlandı", sonuclar.map((s) => `• ${s.ad || s.id}`).join("\n") + "\n\nYeni sürüm doğrulandı ve kaydedildi.");
      if (r.reddedilen && r.reddedilen.length) await uyar("Elle inceleme gerekiyor", "Şunlar otomatik güncellenmedi:\n" + r.reddedilen.join("\n"));
      try { window.dispatchEvent(new CustomEvent("yas-modeller-degisti", { detail: { guncelleme: true } })); } catch (_) {}
    } catch (err) {
      await uyar("Güncelleme başlatılamadı", err.message || String(err), true);
    } finally {
      if (bagli.current) setMesgul(null);
    }
    try {
      const yeni = await guncellemeleriGetir(false);
      if (bagli.current) { setVeri(yeni); if (!yeni.guncellemeler.length) setAcik(false); }
    } catch (_) {}
  }, [uyar]);

  // Python paketi: düğmeye basmak birinci, bu pencere ikinci onaydır
  const pipGuncelle = useCallback(async (g) => {
    const ok = await sor(
      "Test edilmeden önerilmez",
      `${g.ad}: ${g.eskiSurum} → ${g.yeniSurum}\nEtkilenen özellikler: ${(g.etkilenen || []).join(", ") || "?"}\n\n`
      + "Bu sürüm uygulamayla denenmedi; paket tüm Python özellikleri arasında ortaktır. Yalnızca PyPI'nın yayımladığı SHA256 özetine uyan hazır paket (wheel) kurulur, bağımlılıklara dokunulmaz; "
      + "modüller ya da bağımlılıklar doğrulanamazsa önceki sürüm geri kurulur. Ayarlar'dan özelliği yeniden kurmak da sabit sürüme döndürür.\n\nYine de güncellensin mi?",
      "Riski anladım, güncelle", true);
    if (ok) await uygula({ idler: [g.id], ikinciOnay: true });
  }, [sor, uygula]);

  const listedenCikar = useCallback((id) => setVeri((v) => {
    const yeni = { ...v, guncellemeler: v.guncellemeler.filter((x) => x.id !== id) };
    if (!yeni.guncellemeler.length) setAcik(false);
    return yeni;
  }), []);

  const sorma = useCallback(async (g) => {
    try {
      await birDahaSorma(g.id, true);
      listedenCikar(g.id);
      setVeri((v) => (v ? { ...v, sorulmayan: (v.sorulmayan || 0) + 1 } : v));
    } catch (err) {
      uyar("Kaydedilemedi", err.message || String(err), true);
    }
  }, [uyar, listedenCikar]);

  const sifirla = useCallback(async () => {
    try {
      await sorulmayanlariSifirla();
      const yeni = await guncellemeleriGetir(false);
      if (bagli.current) setVeri(yeni);
    } catch (err) {
      uyar("Kaydedilemedi", err.message || String(err), true);
    }
  }, [uyar]);

  const atla = useCallback(async (g) => {
    try {
      await surumuAtla(g.id, g.yeniSurum);
      setVeri((v) => {
        const yeni = { ...v, guncellemeler: v.guncellemeler.filter((x) => x.id !== g.id) };
        if (!yeni.guncellemeler.length) setAcik(false);
        return yeni;
      });
    } catch (err) {
      uyar("Kaydedilemedi", err.message || String(err), true);
    }
  }, [uyar]);

  if (!acik || !veri || !veri.guncellemeler || !veri.guncellemeler.length) return null;
  const otomatikler = veri.guncellemeler.filter((g) => g.otomatik && !g.elleInceleme && g.cesit !== "pip");
  // "Tümünü güncelle": elle inceleme gerektirenler hariç hepsi. Python paketleri varsa tek bir ikinci onay sorulur.
  const pipler = veri.guncellemeler.filter((g) => g.cesit === "pip" && !g.elleInceleme);
  const guncellenebilir = [...otomatikler, ...pipler];
  const elleler = veri.guncellemeler.filter((g) => g.elleInceleme);
  const toplamBoyut = guncellenebilir.reduce((t, g) => t + (g.indirilecekBayt || 0), 0);
  const tumunuGuncelle = async () => {
    if (!pipler.length) { await uygula({ hepsi: true }); return; }
    const ok = await sor(
      "Python paketleri de güncellensin mi?",
      `Listede ${pipler.length} Python paketi var; bunlar uygulamayla test edilmeden önerilmez:\n`
      + pipler.map((g) => `• ${g.ad}: ${g.eskiSurum} → ${g.yeniSurum}`).join("\n")
      + "\n\nYalnızca PyPI'nın yayımladığı SHA256 özetine uyan hazır paketler kurulur; doğrulanamazsa önceki sürüm geri kurulur."
      + (elleler.length ? `\n\nElle inceleme gerektiren ${elleler.length} öğe güncellenmeyecek.` : "")
      + (otomatikler.length ? "\n\nVazgeçerseniz yalnızca doğrulanabilir model güncellemeleri uygulanır." : ""),
      "Python paketleri dahil güncelle", true);
    if (ok) await uygula({ idler: guncellenebilir.map((g) => g.id), ikinciOnay: true });
    else if (otomatikler.length) await uygula({ hepsi: true });
  };

  return (
    <div className="app-dialog-backdrop" role="presentation">
      <div className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="guncelleme-baslik" style={st.pencere}>
        <h3 id="guncelleme-baslik" className="app-dialog-title" style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
          <BellRing size={18} /> Şu modellerde güncelleme var
        </h3>
        <p className="app-dialog-message" style={{ margin: 0 }}>
          Güncelleme, modeli yeni sürüme (commit) yeniden sabitler ve her dosyanın özetini doğrular. Yeni sürüm tamamen inip doğrulanana kadar mevcut sürüm yerinde kalır; bir sorun olursa hiçbir şey değişmez.
        </p>

        <div style={st.liste}>
          {veri.guncellemeler.map((g) => (
            <div key={g.id} style={st.oge}>
              <div style={{ ...st.satir, justifyContent: "space-between", flexWrap: "nowrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{g.ad}</div>
                  <div style={st.kucuk}>{TUR_AD[g.tur] || g.tur} · {g.repo}</div>
                </div>
                {g.sayfa && <a href={g.sayfa} target="_blank" rel="noopener noreferrer" title="Depo sayfasını aç" style={{ color: "var(--md-sys-color-primary)", flexShrink: 0 }}><ExternalLink size={15} /></a>}
              </div>
              <div style={{ fontSize: "0.78rem" }}>
                Kurulu: <b>{kisa(g.eskiSurum)}</b>{g.eskiTarih ? ` (${tarihYaz(g.eskiTarih)})` : ""} → Yeni: <b>{kisa(g.yeniSurum)}</b>{g.tarih ? ` (${tarihYaz(g.tarih)})` : ""}
              </div>
              {(g.baslik || g.degisiklikAdresi) && (
                <div style={{ fontSize: "0.78rem" }}>
                  {g.baslik && <>Değişiklik notu: <i>{g.baslik}</i> </>}
                  {g.degisiklikAdresi && <a href={g.degisiklikAdresi} target="_blank" rel="noopener noreferrer" style={st.bag}>Değişiklikler <ExternalLink size={11} /></a>}
                </div>
              )}
              {g.cesit === "pip" && g.etkilenen && g.etkilenen.length > 0 && <div style={st.kucuk}>Etkilenen özellikler: {g.etkilenen.join(", ")}</div>}
              {g.degisenler.length > 0 && <div style={st.kucuk}>
                Değişen dosyalar ({g.degisenler.length}) · indirilecek {boyutYaz(g.indirilecekBayt)}
                <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                  {g.degisenler.slice(0, 6).map((d) => (
                    <li key={d.yol} style={st.kod}>
                      {d.yol} — {DURUM_AD[d.durum] || d.durum}{d.durum === "degisti" ? ` (${boyutYaz(d.eskiBoyut)} → ${boyutYaz(d.yeniBoyut)})` : d.durum === "eklendi" ? ` (${boyutYaz(d.yeniBoyut)})` : ""}
                    </li>
                  ))}
                  {g.degisenler.length > 6 && <li>… ve {g.degisenler.length - 6} dosya daha</li>}
                </ul>
              </div>}
              {g.elleInceleme && (
                <div style={st.elle}>
                  <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    Elle inceleme gerekiyor — <span style={{ fontWeight: 400 }}>{g.neden}</span>
                    {g.sayfa && <> <a href={g.sayfa} target="_blank" rel="noopener noreferrer" style={st.bag}>İncele <ExternalLink size={11} /></a></>}
                  </div>
                </div>
              )}
              {!g.elleInceleme && g.cesit === "pip" && (
                <div style={st.testsiz}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>Test edilmeden önerilmez — <span style={{ fontWeight: 400 }}>{g.neden.replace(/^Test edilmeden önerilmez:\s*/, "")}</span></div>
                </div>
              )}
              {!g.elleInceleme && !g.otomatik && g.cesit !== "pip" && g.neden && <div style={st.kucuk}>{g.neden}</div>}
              <div style={{ ...st.satir, justifyContent: "flex-end" }}>
                <button type="button" className="m3-btn" style={{ ...st.dugme, background: "transparent", border: 0, color: "var(--md-sys-color-on-surface-variant)" }} disabled={Boolean(mesgul)} onClick={() => sorma(g)} title="Bu öğe için bir daha güncelleme bildirimi gösterme">Bir daha sorma</button>
                <button type="button" className="m3-btn m3-btn-outlined" style={st.dugme} disabled={Boolean(mesgul)} onClick={() => atla(g)}>Bu sürümü atla</button>
                {g.cesit === "pip" ? (
                  <button type="button" className="m3-btn m3-btn-outlined" style={st.dugme} disabled={Boolean(mesgul) || g.elleInceleme} onClick={() => pipGuncelle(g)}
                    title={g.elleInceleme ? "Bu paket uygulama içinden güncellenmez (gerekçesi yukarıda)" : "İkinci onay istenir"}>
                    Güncelle…
                  </button>
                ) : (
                  <button type="button" className="m3-btn m3-btn-tonal" style={st.dugme} disabled={Boolean(mesgul) || g.elleInceleme || !g.otomatik} onClick={() => uygula({ idler: [g.id] })}
                    title={g.elleInceleme ? "Bu öğe uygulama içinden güncellenmez (gerekçesi yukarıda)" : ""}>
                    Güncelle
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {mesgul && <div style={{ ...st.satir, fontSize: "0.8rem" }}><RefreshCw className="progress-spinner" size={14} /> {mesgul}</div>}

        {veri.sorulmayan > 0 && (
          <div style={st.kucuk}>
            {veri.sorulmayan} öğe için bildirim kapalı (“Bir daha sorma”).{" "}
            <button type="button" onClick={sifirla} disabled={Boolean(mesgul)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", ...st.bag }}>Yeniden sor</button>
          </div>
        )}

        <div className="app-dialog-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="m3-btn m3-btn-outlined" disabled={Boolean(mesgul)} onClick={() => { kapatildi.current = true; setAcik(false); }}>Daha sonra</button>
          <button type="button" className="m3-btn m3-btn-filled" disabled={Boolean(mesgul) || guncellenebilir.length === 0} onClick={tumunuGuncelle}
            title={guncellenebilir.length === 0 ? "Listedeki öğelerin hepsi elle inceleme gerektiriyor" : "Elle inceleme gerektirenler hariç hepsi; Python paketleri için bir kez ek onay sorulur"}>
            <ShieldCheck size={14} /> Tümünü güncelle{guncellenebilir.length ? ` (${guncellenebilir.length}${toplamBoyut ? " · " + boyutYaz(toplamBoyut) : ""})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

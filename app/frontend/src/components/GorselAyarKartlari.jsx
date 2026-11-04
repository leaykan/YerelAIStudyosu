// Görsel Üretici sayfasındaki ayar kartları. Tüm değerler seçili modelin
// profilinden (modelProfilleri.js) gelir; desteklenmeyen kontroller soluk
// gösterilir ve nedeni yazılır.
import React, { memo, useCallback, useEffect, useState } from "react";
import {
  Box, Crop, Sliders, Maximize2, Cpu, Check, ChevronDown, ArrowLeftRight,
  Shuffle, Info, DownloadCloud, RefreshCw, ShieldAlert, Clock,
} from "lucide-react";
import {
  ORANLAR, ORNEKLEYICILER, ZAMANLAYICILAR, aktifOran, boyutDegerlendir,
  yuvarla, adimYorumu, sureTahmini, sureYaz,
} from "../modelProfilleri";
import { downloadBackend, getBackendOptions, getDownloadProgress, setModelLabel, stopServer } from "../services/api";

export const kaydiriciStili = (value, min, max) => {
  const v = Number(value);
  const mn = Number(min);
  const mx = Number(max);
  const pct = mx === mn ? 0 : ((v - mn) / (mx - mn)) * 100;
  return { "--value": `${Math.max(0, Math.min(100, pct))}%` };
};

function Anahtar({ checked, onChange, label, description, disabled }) {
  return (
    <label className={`premium-toggle ${disabled ? "kontrol-soluk" : ""}`} style={{ cursor: disabled ? "not-allowed" : "pointer" }}>
      <div
        className={`premium-toggle-checkbox ${checked ? "checked" : ""}`}
        onClick={() => !disabled && onChange(!checked)}
        role="checkbox"
        aria-checked={checked}
        aria-disabled={disabled}
      >
        {checked && <Check size={14} />}
      </div>
      <div style={{ flex: 1 }}>
        <div className="premium-toggle-label">{label}</div>
        {description && <div className="premium-toggle-desc">{description}</div>}
      </div>
    </label>
  );
}

function SolukNeden({ children }) {
  if (!children) return null;
  return (
    <div className="soluk-neden">
      <Info size={12} />
      <span>{children}</span>
    </div>
  );
}

function KartBasligi({ icon: Icon, children, sag }) {
  return (
    <h3 className="m3-card-title" style={{ justifyContent: "space-between" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Icon size={18} style={{ color: "var(--md-sys-color-primary)" }} />
        {children}
      </span>
      {sag}
    </h3>
  );
}

const MP = (w, h) => ((w * h) / 1e6).toFixed(2).replace(".", ",");

// ---------------------------------------------------------------------------
// MODEL KARTI
// ---------------------------------------------------------------------------
export const ModelKarti = memo(function ModelKarti({
  modeller, activeModel, setActiveModel, profil, modelBilgisi, setModelBilgisi,
  yukluModel, isGenerating, showAlert, setActiveTab,
}) {
  const [etiketMesgul, setEtiketMesgul] = useState(false);
  const yuklu = yukluModel && activeModel && yukluModel === activeModel;

  const sansursuzDegistir = async () => {
    if (!activeModel || etiketMesgul) return;
    setEtiketMesgul(true);
    try {
      const yeni = await setModelLabel(activeModel, !profil?.sansursuz);
      setModelBilgisi(yeni);
    } catch (err) {
      showAlert?.({ title: "Etiket kaydedilemedi", message: err.message || String(err), danger: true });
    } finally {
      setEtiketMesgul(false);
    }
  };

  const neg = profil ? (profil.negatif ? (profil.damitilmis ? "zayıf (düşük CFG)" : "etkili") : "kullanılmaz") : "";

  return (
    <div className="m3-card">
      <KartBasligi
        icon={Box}
        sag={profil && (
          <span className="settings-value-badge">{profil.ad}</span>
        )}
      >
        Model
      </KartBasligi>

      <div className="m3-field-group">
        <div className="m3-text-field">
          <label className="m3-text-field-label" htmlFor="gorsel-model-secimi">Görsel modeli</label>
          {modeller.length === 0 ? (
            <div className="settings-option-desc">
              Yüklü görsel modeli bulunamadı.{" "}
              <button type="button" className="metin-dugme" onClick={() => setActiveTab?.("models")}>Model Yöneticisi'ne git</button>
            </div>
          ) : (
            <select
              id="gorsel-model-secimi"
              className="m3-input"
              value={activeModel || ""}
              onChange={(e) => setActiveModel(e.target.value || null)}
              disabled={isGenerating}
            >
              {!activeModel && <option value="">Model seçin…</option>}
              {modeller.map((m) => {
                const t = m.detected;
                const etiket = t ? ` · ${t.familyLabel}${t.distilled ? " " + t.distilled[0].toUpperCase() + t.distilled.slice(1) : ""}` : "";
                return (
                  <option key={m.filename} value={m.filename}>
                    {m.filename}{etiket}{t?.uncensored ? " · sansürsüz" : ""}
                  </option>
                );
              })}
            </select>
          )}
          {activeModel && (
            <div className="settings-option-desc" style={{ marginTop: "6px" }}>
              {yuklu
                ? "Model bellekte, üretime hazır."
                : "Model henüz yüklenmedi. \"Görsel Üret\"e bastığınızda yüklenir; bu donanımda birkaç dakika sürebilir."}
            </div>
          )}
        </div>

        {profil && (
          <>
            <div className="chips-container" style={{ marginTop: 0 }}>
              <span className="status-chip">Eğitim boyutu {profil.dogal}×{profil.dogal}</span>
              <span className="status-chip">Adım {profil.adim.min}–{profil.adim.max} (önerilen {profil.adim.onerilen[0]}–{profil.adim.onerilen[1]})</span>
              <span className="status-chip">
                CFG {profil.cfg.min === profil.cfg.max ? profil.cfg.min : `${profil.cfg.min}–${profil.cfg.max}`}
              </span>
              <span className="status-chip">Negatif prompt: {neg}</span>
              {profil.sansursuz && (
                <span className="status-chip chip-uyari" title={profil.sansursuzKaynak === "kullanici" ? "Sizin işaretinizle" : "Dosya adından tahmin edildi"}>
                  <ShieldAlert size={13} /> Sansürsüz
                </span>
              )}
              {profil.inpaint && <span className="status-chip chip-uyari">Inpainting modeli</span>}
            </div>

            <ul className="profil-notlari">
              {profil.notlar.map((n) => <li key={n}>{n}</li>)}
              {profil.inpaint && <li>Bu bir inpainting (boyama) modeli; normal üretimde beklenmedik sonuç verebilir.</li>}
            </ul>

            <div className="profil-alt-satir">
              <span>
                {profil.kaynak === "dosya-icerigi"
                  ? "Model türü dosyanın içinden tanındı."
                  : profil.kaynak === "dosya-adi"
                    ? "Model türü dosya adından tahmin edildi; yanlış olabilir."
                    : "Model türü tanınamadı."}
                {profil.damitilmis && " Az adımlı sürüm (Lightning vb.) dosya adından anlaşıldı."}
              </span>
              <button type="button" className="metin-dugme" onClick={sansursuzDegistir} disabled={etiketMesgul || !activeModel}>
                {profil.sansursuz ? "Sansürsüz işaretini kaldır" : "Sansürsüz olarak işaretle"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// BOYUT KARTI
// ---------------------------------------------------------------------------
export const BoyutKarti = memo(function BoyutKarti({ profil, constraints, setConstraints, isGenerating }) {
  const w = constraints.width;
  const h = constraints.height;
  const [taslakW, setTaslakW] = useState(String(w));
  const [taslakH, setTaslakH] = useState(String(h));
  useEffect(() => setTaslakW(String(w)), [w]);
  useEffect(() => setTaslakH(String(h)), [h]);

  if (!profil) return null;
  const secili = aktifOran(profil, w, h);
  const degerlendirme = boyutDegerlendir(profil, w, h);

  const boyutAyarla = (nw, nh) => setConstraints((prev) => ({ ...prev, width: nw, height: nh }));
  const onayla = () => {
    const nw = yuvarla(profil, taslakW);
    const nh = yuvarla(profil, taslakH);
    setTaslakW(String(nw));
    setTaslakH(String(nh));
    if (nw !== w || nh !== h) boyutAyarla(nw, nh);
  };

  return (
    <div className="m3-card">
      <KartBasligi icon={Crop} sag={<span className="settings-value-badge">{w}×{h} · {MP(w, h)} MP</span>}>
        Boyut ve Şekil
      </KartBasligi>

      <div className="m3-field-group">
        <div className="m3-slider-group">
          <div className="m3-slider-header">
            <span className="m3-slider-label">En-boy oranı</span>
          </div>
          <div className="oran-izgarasi">
            {ORANLAR.map((oran) => {
              const boyut = profil.boyutlar[oran.id];
              if (!boyut) return null;
              const [bw, bh] = boyut;
              const d = boyutDegerlendir(profil, bw, bh);
              const olcek = 22 / Math.max(bw, bh);
              return (
                <button
                  key={oran.id}
                  type="button"
                  className={`m3-btn aspect-ratio-btn oran-dugmesi ${secili === oran.id ? "active" : "m3-btn-outlined"} ${d.durum !== "onerilen" ? "oran-riskli" : ""}`}
                  onClick={() => boyutAyarla(bw, bh)}
                  disabled={isGenerating}
                  title={d.mesaj || `${oran.ad}: ${bw}×${bh}`}
                >
                  <span className="aspect-ratio-preview" style={{ width: `${Math.round(bw * olcek)}px`, height: `${Math.round(bh * olcek)}px` }} />
                  <span style={{ fontWeight: 700 }}>{oran.id}</span>
                  <span className="oran-piksel">{bw}×{bh}</span>
                </button>
              );
            })}
          </div>
          <span className="settings-option-desc">
            Boyutlar modelin eğitildiği ölçülerdir ({profil.ad}). Kenarlar {profil.kat}'ün katı olmalı; elle girilen değer buna yuvarlanır.
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "8px", alignItems: "end" }}>
          <div className="m3-text-field">
            <label className="m3-text-field-label" htmlFor="gorsel-genislik">Genişlik (px)</label>
            <input
              id="gorsel-genislik"
              type="number"
              className="m3-input"
              value={taslakW}
              step={profil.kat}
              min={profil.kenarMin}
              max={profil.kenarMax}
              onChange={(e) => setTaslakW(e.target.value)}
              onBlur={onayla}
              onKeyDown={(e) => e.key === "Enter" && onayla()}
              disabled={isGenerating}
            />
          </div>
          <button
            type="button"
            className="m3-btn m3-btn-tonal"
            style={{ height: "42px", padding: "0 12px" }}
            onClick={() => boyutAyarla(h, w)}
            disabled={isGenerating}
            title="Genişlik ile yüksekliği değiştir"
            aria-label="Genişlik ile yüksekliği değiştir"
          >
            <ArrowLeftRight size={16} />
          </button>
          <div className="m3-text-field">
            <label className="m3-text-field-label" htmlFor="gorsel-yukseklik">Yükseklik (px)</label>
            <input
              id="gorsel-yukseklik"
              type="number"
              className="m3-input"
              value={taslakH}
              step={profil.kat}
              min={profil.kenarMin}
              max={profil.kenarMax}
              onChange={(e) => setTaslakH(e.target.value)}
              onBlur={onayla}
              onKeyDown={(e) => e.key === "Enter" && onayla()}
              disabled={isGenerating}
            />
          </div>
        </div>
        <span className="settings-option-desc">
          İzin verilen aralık: {profil.kenarMin}–{profil.kenarMax} px.
        </span>

        {degerlendirme.durum !== "onerilen" && (
          <div className={`bilgi-kutusu ${degerlendirme.durum === "riskli" ? "bilgi-kutusu-uyari" : ""}`}>
            {degerlendirme.mesaj} Daha büyük sonuç için önerilen yol: eğitim boyutunda üretip galeriden "Büyüt 4x" kullanmak.
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// KALİTE KARTI
// ---------------------------------------------------------------------------
export const KaliteKarti = memo(function KaliteKarti({ profil, constraints, setConstraints, isGenerating, activeModel, sonSeed }) {
  const [acikla, setAcikla] = useState(false);
  if (!profil) return null;

  const guncelle = (anahtar, deger) => setConstraints((prev) => ({
    ...prev,
    [anahtar]: deger,
    ...(anahtar === "steps" ? { standardSteps: deger } : {}),
  }));

  const adim = constraints.steps;
  const tahmin = sureTahmini(activeModel, constraints.width, constraints.height, adim);
  const karsilastirma = [...new Set([profil.adim.onerilen[0], profil.adim.onerilen[1], adim])]
    .filter((n) => n >= profil.adim.min && n <= profil.adim.max)
    .sort((a, b) => a - b);

  const cfgSabit = profil.cfg.min === profil.cfg.max;
  const cfgAdim = profil.cfg.max - profil.cfg.min <= 3 ? 0.1 : 0.5;
  const ornekleyici = ORNEKLEYICILER.find((o) => o.id === constraints.sampler) || ORNEKLEYICILER[0];
  const zamanlayici = ZAMANLAYICILAR.find((z) => z.id === (constraints.scheduler || "")) || ZAMANLAYICILAR[0];
  const adimDisarida = adim < profil.adim.min || adim > profil.adim.max;

  return (
    <div className="m3-card">
      <KartBasligi icon={Sliders}>Kalite ve Hız</KartBasligi>

      <div className="m3-field-group">
        {/* Adım sayısı */}
        <div className="m3-slider-group">
          <div className="m3-slider-header">
            <label className="m3-slider-label" htmlFor="gorsel-adim">Adım sayısı</label>
            <span className="settings-value-badge">{adim}</span>
          </div>
          <input
            id="gorsel-adim"
            type="range"
            className="m3-slider"
            value={Math.max(profil.adim.min, Math.min(profil.adim.max, adim))}
            min={profil.adim.min}
            max={profil.adim.max}
            step={1}
            onChange={(e) => guncelle("steps", parseInt(e.target.value, 10))}
            style={kaydiriciStili(adim, profil.adim.min, profil.adim.max)}
            disabled={isGenerating}
          />
          <div className="kaydirici-olcek">
            <span>{profil.adim.min}</span>
            <span>önerilen {profil.adim.onerilen[0]}–{profil.adim.onerilen[1]}</span>
            <span>{profil.adim.max}</span>
          </div>
          <span className="settings-option-desc">
            {adimDisarida ? `Seçili değer bu modelin aralığı dışında; ${profil.adim.varsayilan} önerilir. ` : ""}
            {adimYorumu(profil, adim)}
          </span>

          <div className="sure-satiri">
            <Clock size={14} />
            {tahmin ? (
              <span>
                Tahmini süre: <strong>{sureYaz(tahmin.toplam)}</strong>{" "}
                <span style={{ opacity: 0.75 }}>({tahmin.olculen ? "bu boyutta ölçülen hıza göre" : "başka bir boyuttaki ölçümden hesaplandı"}, adım başına ≈ {sureYaz(tahmin.snAdim)})</span>
              </span>
            ) : (
              <span style={{ opacity: 0.8 }}>Süre tahmini ilk üretimden sonra görünür; bu model için hız ölçülür.</span>
            )}
          </div>
          {tahmin && karsilastirma.length > 1 && (
            <div className="chips-container" style={{ marginTop: "4px" }}>
              {karsilastirma.map((n) => {
                const t = sureTahmini(activeModel, constraints.width, constraints.height, n);
                return (
                  <button
                    key={n}
                    type="button"
                    className={`status-chip chip-dugme ${n === adim ? "chip-secili" : ""}`}
                    onClick={() => guncelle("steps", n)}
                    disabled={isGenerating}
                  >
                    {n} adım ≈ {sureYaz(t?.toplam)}
                  </button>
                );
              })}
            </div>
          )}

          <button type="button" className="acilir-baslik" onClick={() => setAcikla((v) => !v)} aria-expanded={acikla}>
            <ChevronDown size={14} className={`collapsible-chevron ${acikla ? "expanded" : ""}`} />
            Adım sayısı neyi değiştirir?
          </button>
          {acikla && (
            <div className="bilgi-kutusu">
              <p>Model tamamen gürültüden başlar ve her adımda bu gürültünün bir kısmını temizler:</p>
              <ul>
                <li><strong>İlk adımlar:</strong> genellikle genel yerleşim, ışık ve renk dağılımı oluşur.</li>
                <li><strong>Orta adımlar:</strong> şekiller, yüzler ve büyük nesneler netleşir.</li>
                <li><strong>Son adımlar:</strong> doku, keskinlik ve küçük ayrıntılar eklenir.</li>
              </ul>
              <p>
                Adım sayısı az olursa temizlik yarım kalır: bulanıklık ve eksik detay görülür. Fazla olursa belli bir noktadan
                sonra kalite neredeyse değişmez ama süre adım sayısıyla doğru orantılı uzar.
                {profil.damitilmis && " Bu model az adımda bitirecek şekilde eğitildiği için önerilenden fazla adım genellikle görüntüyü bozar."}
              </p>
              <p style={{ opacity: 0.8 }}>Bu ayrım genel bir kuraldır; her görüntüde aşamalar biraz farklı dağılır.</p>
            </div>
          )}
        </div>

        {/* CFG */}
        <div className={`m3-slider-group ${cfgSabit ? "kontrol-soluk" : ""}`}>
          <div className="m3-slider-header">
            <label className="m3-slider-label" htmlFor="gorsel-cfg">Prompt'a bağlılık (CFG)</label>
            <span className="settings-value-badge">{Number(constraints.cfgScale).toFixed(1)}</span>
          </div>
          <input
            id="gorsel-cfg"
            type="range"
            className="m3-slider"
            value={constraints.cfgScale}
            min={profil.cfg.min}
            max={profil.cfg.max}
            step={cfgAdim}
            onChange={(e) => guncelle("cfgScale", parseFloat(e.target.value))}
            style={kaydiriciStili(constraints.cfgScale, profil.cfg.min, profil.cfg.max)}
            disabled={isGenerating || cfgSabit}
          />
          <div className="kaydirici-olcek">
            <span>{profil.cfg.min}</span>
            <span>önerilen {profil.cfg.onerilen[0]}–{profil.cfg.onerilen[1]}</span>
            <span>{profil.cfg.max}</span>
          </div>
          {cfgSabit ? (
            <SolukNeden>Bu model CFG kullanmaz; değer sabittir.</SolukNeden>
          ) : (
            <span className="settings-option-desc">
              Düşük değer modele serbestlik tanır, görüntü yumuşak olur. Yüksek değer prompt'a sıkı uyar; aşırısı yanık renk ve sert kontrast üretir. 1'de negatif prompt devre dışı kalır.
            </span>
          )}
        </div>

        {/* Örnekleyici ve zamanlayıcı */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div className="m3-text-field">
            <label className="m3-text-field-label" htmlFor="gorsel-ornekleyici">Örnekleyici</label>
            <select
              id="gorsel-ornekleyici"
              className="m3-input"
              value={constraints.sampler}
              onChange={(e) => guncelle("sampler", e.target.value)}
              disabled={isGenerating}
            >
              {ORNEKLEYICILER.map((o) => <option key={o.id} value={o.id}>{o.ad}</option>)}
            </select>
          </div>
          <div className="m3-text-field">
            <label className="m3-text-field-label" htmlFor="gorsel-zamanlayici">Zamanlayıcı</label>
            <select
              id="gorsel-zamanlayici"
              className="m3-input"
              value={constraints.scheduler || ""}
              onChange={(e) => guncelle("scheduler", e.target.value)}
              disabled={isGenerating}
            >
              {ZAMANLAYICILAR.map((z) => <option key={z.id || "varsayilan"} value={z.id}>{z.ad}</option>)}
            </select>
          </div>
        </div>
        <span className="settings-option-desc" style={{ marginTop: "-8px" }}>
          <strong>Örnekleyici</strong> gürültünün her adımda nasıl temizleneceğini seçer: {ornekleyici.not}{" "}
          <strong>Zamanlayıcı</strong> temizliğin adımlara nasıl dağıtılacağını belirler: {zamanlayici.not}
          {profil.ornekleyiciOneri && ` Bu model için önerilen: ${profil.ornekleyiciOneri}.`}
        </span>

        {/* CLIP atlama */}
        <div className={`m3-slider-group ${!profil.clipSkip ? "kontrol-soluk" : ""}`}>
          <div className="m3-slider-header">
            <span className="m3-slider-label">CLIP atlama</span>
          </div>
          <div className="m3-segmented-button">
            {[{ v: 0, ad: "Model varsayılanı" }, { v: 1, ad: "1" }, { v: 2, ad: "2" }].map((s) => (
              <button
                key={s.v}
                type="button"
                className={`m3-segment-item ${(Number(constraints.clipSkip) || 0) === s.v ? "active" : ""}`}
                onClick={() => guncelle("clipSkip", s.v)}
                disabled={isGenerating || !profil.clipSkip}
              >
                {s.ad}
              </button>
            ))}
          </div>
          {profil.clipSkip ? (
            <span className="settings-option-desc">
              Prompt'u çözümleyen katmanlardan sonuncuyu atlar. Anime ve çizim modelleri (ör. ReV Animated) çoğunlukla 2 ile daha iyi sonuç verir.
            </span>
          ) : (
            <SolukNeden>Bu model ailesinde CLIP atlama kullanılmaz.</SolukNeden>
          )}
        </div>

        {/* Seed */}
        <div className="m3-text-field">
          <label className="m3-text-field-label" htmlFor="gorsel-seed">Seed (tekrarlanabilirlik)</label>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <input
              id="gorsel-seed"
              type="number"
              className="m3-input"
              value={constraints.seed}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                guncelle("seed", Number.isFinite(v) ? v : -1);
              }}
              placeholder="-1 = rastgele"
              style={{ flex: "1 1 140px" }}
              disabled={isGenerating}
            />
            <button type="button" className="m3-btn m3-btn-tonal" onClick={() => guncelle("seed", -1)} disabled={isGenerating}>
              <Shuffle size={14} />
              <span>Rastgele</span>
            </button>
            {sonSeed !== null && sonSeed !== undefined && (
              <button type="button" className="m3-btn m3-btn-outlined" onClick={() => guncelle("seed", Number(sonSeed))} disabled={isGenerating}>
                Son seed ({sonSeed})
              </button>
            )}
          </div>
          <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
            Aynı seed, aynı ayarlar ve aynı prompt aynı görüntüyü verir. -1 her seferinde yeni bir görüntü üretir.
          </span>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// YÜKSEK ÇÖZÜNÜRLÜK KARTI
// ---------------------------------------------------------------------------
const HIRES_OLCEKLERI = [1.5, 2, 3, 4];

export const YuksekCozunurlukKarti = memo(function YuksekCozunurlukKarti({ profil, constraints, hires, setHires, isGenerating, activeModel }) {
  if (!profil) return null;
  const w = constraints.width;
  const h = constraints.height;
  const dogalPx = profil.dogal * profil.dogal;
  const hedef = (olcek) => {
    const hw = Math.round((w * olcek) / 8) * 8;
    const hh = Math.round((h * olcek) / 8) * 8;
    return { hw, hh, oran: (hw * hh) / dogalPx };
  };
  const secili = hedef(hires.scale);
  const ikinciAdim = hires.steps || Math.max(1, Math.round(constraints.steps / 2));
  const t1 = sureTahmini(activeModel, w, h, constraints.steps);
  const t2 = sureTahmini(activeModel, secili.hw, secili.hh, ikinciAdim);
  const ayarla = (anahtar, deger) => setHires((prev) => ({ ...prev, [anahtar]: deger }));

  return (
    <div className="m3-card">
      <KartBasligi
        icon={Maximize2}
        sag={<span className="settings-value-badge">{hires.enabled ? `${secili.hw}×${secili.hh}` : "Kapalı"}</span>}
      >
        Yüksek Çözünürlük
      </KartBasligi>

      <div className="m3-field-group">
        <Anahtar
          checked={hires.enabled}
          onChange={(v) => ayarla("enabled", v)}
          disabled={isGenerating}
          label="İkinci geçişle büyüt (highres fix)"
          description={`Önce ${w}×${h} üretilir, sonra büyütülüp daha büyük boyutta tekrar işlenir. Detay ekler ama ikinci geçiş çok yavaştır.`}
        />

        <div className="bilgi-kutusu">
          Daha hızlı yol: üretimden sonra galeride görseli seçip <strong>Büyüt 4x</strong>'e basın. Yeniden çizim yapmaz,
          512'lik bir görsel için yaklaşık 70 saniye sürer.
        </div>

        {hires.enabled && (
          <>
            <div className="m3-slider-group">
              <div className="m3-slider-header">
                <span className="m3-slider-label">Ölçek</span>
              </div>
              <div className="m3-segmented-button">
                {HIRES_OLCEKLERI.map((o) => {
                  const hd = hedef(o);
                  const cokBuyuk = hd.oran > 4.5 || hd.hw > 2048 || hd.hh > 2048;
                  return (
                    <button
                      key={o}
                      type="button"
                      className={`m3-segment-item ${hires.scale === o ? "active" : ""} ${cokBuyuk ? "disabled" : ""}`}
                      onClick={() => !cokBuyuk && ayarla("scale", o)}
                      disabled={isGenerating || cokBuyuk}
                      title={cokBuyuk ? `${hd.hw}×${hd.hh}: bu model için çok büyük` : `${hd.hw}×${hd.hh}`}
                    >
                      {String(o).replace(".", ",")}x
                    </button>
                  );
                })}
              </div>
              <span className="settings-option-desc">
                Hedef: {secili.hw}×{secili.hh} ({MP(secili.hw, secili.hh)} MP). Soluk seçenekler bu model için eğitim boyutunun 4,5 katını aşıyor.
                {secili.oran > 2.3 && " Seçili hedef eğitim boyutunun çok üzerinde; ikinci geçiş uzun sürer."}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div className="m3-text-field">
                <label className="m3-text-field-label" htmlFor="hires-buyutucu">Büyütücü</label>
                <select
                  id="hires-buyutucu"
                  className="m3-input"
                  value={hires.upscaler}
                  onChange={(e) => ayarla("upscaler", e.target.value)}
                  disabled={isGenerating}
                >
                  <option value="RealESRGAN_x4plus_anime_6B">RealESRGAN x4 (en iyi)</option>
                  <option value="Latent">Latent (hızlı, yumuşak)</option>
                  <option value="Lanczos">Lanczos</option>
                  <option value="Nearest">En yakın komşu</option>
                </select>
              </div>
              <div className="m3-text-field">
                <label className="m3-text-field-label" htmlFor="hires-adim">İkinci geçiş adımı</label>
                <input
                  id="hires-adim"
                  type="number"
                  className="m3-input"
                  value={ikinciAdim}
                  min={1}
                  max={profil.adim.max}
                  onChange={(e) => ayarla("steps", Math.max(1, Math.min(profil.adim.max, parseInt(e.target.value, 10) || 1)))}
                  disabled={isGenerating}
                />
              </div>
            </div>

            <div className="m3-slider-group">
              <div className="m3-slider-header">
                <label className="m3-slider-label" htmlFor="hires-denoise">Yeniden çizim gücü</label>
                <span className="settings-value-badge">{hires.denoise.toFixed(2)}</span>
              </div>
              <input
                id="hires-denoise"
                type="range"
                className="m3-slider"
                min="0.1"
                max="0.9"
                step="0.05"
                value={hires.denoise}
                onChange={(e) => ayarla("denoise", Number(e.target.value))}
                style={kaydiriciStili(hires.denoise, 0.1, 0.9)}
                disabled={isGenerating}
              />
              <span className="settings-option-desc">
                Düşük değer ilk görüntüye sadık kalır, yüksek değer detayı yeniden kurar. 0,4–0,6 arası güvenli.
              </span>
            </div>

            <div className="sure-satiri">
              <Clock size={14} />
              {t1 && t2 ? (
                <span>Tahmini toplam: <strong>{sureYaz(t1.toplam + t2.toplam)}</strong> (ilk geçiş {sureYaz(t1.toplam)} + ikinci geçiş {sureYaz(t2.toplam)})</span>
              ) : (
                <span style={{ opacity: 0.8 }}>Süre tahmini için önce bu modelle bir normal üretim yapın.</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// BELLEK VE HIZLANDIRICI KARTI
// ---------------------------------------------------------------------------
export const BellekKarti = memo(function BellekKarti({
  constraints, setConstraints, backendOptions, setBackendOptions, serverRunning, setServerRunning,
  setActiveModel, showAlert, showConfirm, isGenerating, specs,
}) {
  const [acik, setAcik] = useState(() => {
    try { return localStorage.getItem("gorsel_bellek_karti") === "true"; } catch (_) { return false; }
  });
  const [indirme, setIndirme] = useState({ active: false, backendId: "", progress: 0, speed: "", error: null });

  const toggle = () => setAcik((v) => {
    try { localStorage.setItem("gorsel_bellek_karti", String(!v)); } catch (_) {}
    return !v;
  });

  const secenekleriYenile = useCallback(async () => {
    if (typeof setBackendOptions !== "function") return;
    setBackendOptions(await getBackendOptions());
  }, [setBackendOptions]);

  useEffect(() => {
    if (!indirme.active) return undefined;
    let iptal = false;
    const yokla = async () => {
      try {
        const p = await getDownloadProgress();
        if (iptal) return;
        setIndirme((prev) => ({ ...prev, active: Boolean(p.active), progress: Number(p.progress ?? prev.progress ?? 0), speed: p.speed || "", error: p.error || null }));
        if (!p.active && !p.error) await secenekleriYenile();
      } catch (err) {
        if (!iptal) setIndirme((prev) => ({ ...prev, active: false, error: err.message || "İndirme başarısız" }));
      }
    };
    yokla();
    const id = setInterval(yokla, 700);
    return () => { iptal = true; clearInterval(id); };
  }, [indirme.active, secenekleriYenile]);

  const mevcut = backendOptions?.options?.length ? backendOptions.options : [{ id: "cpu", label: "CPU", available: true }];
  const olmayanlar = Array.isArray(backendOptions?.unavailable)
    ? backendOptions.unavailable.filter((b) => !mevcut.some((m) => m.id === b.id))
    : [];
  const hepsi = [...mevcut, ...olmayanlar.map((b) => ({ ...b, available: false }))];
  const etiket = (b) => (b.id === "vulkan" ? "Vulkan GPU" : b.id === "cpu" ? "CPU" : b.label);
  const aktifEtiket = etiket(hepsi.find((b) => b.id === constraints.backendType) || { id: constraints.backendType, label: constraints.backendType });

  const guncelle = (anahtar, deger) => setConstraints((prev) => ({ ...prev, [anahtar]: deger }));

  const hizlandiriciDegistir = async (tip) => {
    const onceki = constraints.backendType || "cpu";
    if (tip === onceki) return;
    const npuGecisi = (onceki === "openvino-npu") !== (tip === "openvino-npu");
    if (serverRunning && npuGecisi) {
      const onay = await showConfirm?.({
        title: "Model bellekten çıkarılsın mı?",
        message: "NPU ile diğer hızlandırıcılar arasında geçmeden önce yüklü model çıkarılmalı.",
        confirmLabel: "Çıkar",
        cancelLabel: "Vazgeç",
        danger: true,
      });
      if (!onay) return;
      try {
        await stopServer();
        setServerRunning(false);
        setActiveModel(null);
      } catch (err) {
        await showAlert?.({ title: "Çıkarma başarısız", message: err.message || String(err), danger: true });
        return;
      }
    }
    setConstraints((prev) => ({ ...prev, backendType: tip, useGpu: tip !== "cpu" }));
  };

  const motorIndir = async (b) => {
    if (!b?.id || indirme.active) return;
    try {
      setIndirme({ active: true, backendId: b.id, progress: 0, speed: "Başlıyor", error: null });
      await downloadBackend(b.id);
    } catch (err) {
      setIndirme({ active: false, backendId: b.id, progress: 0, speed: "", error: err.message || "İndirme başarısız" });
    }
  };

  const cekirdek = specs?.cpu_cores_logical || navigator.hardwareConcurrency || 4;
  const gpu = constraints.backendType !== "cpu";

  return (
    <div className="collapsible-card" style={{ marginBottom: "24px" }}>
      <button className="collapsible-header" onClick={toggle} aria-expanded={acik} type="button">
        <div className="collapsible-header-left">
          <div className="collapsible-header-icon"><Cpu size={18} /></div>
          <div>
            <div className="collapsible-header-title">Gelişmiş: Bellek ve Hızlandırıcı</div>
            <div className="collapsible-header-subtitle">
              {aktifEtiket} · VAE döşeme {constraints.vaeTiling ? "açık" : "kapalı"} · Flash Attention {constraints.useFlashAttn ? "açık" : "kapalı"}
            </div>
          </div>
        </div>
        <div className="collapsible-header-right">
          <ChevronDown size={20} className={`collapsible-chevron ${acik ? "expanded" : ""}`} />
        </div>
      </button>
      {acik && (
        <div className="collapsible-content">
          <div className="m3-field-group">
            <div className="bilgi-kutusu">
              Bu bölümdeki ayarlardan biri değişirse model bir sonraki üretimde yeniden yüklenir (birkaç dakika sürebilir).
            </div>

            <div className="m3-slider-group">
              <div className="m3-slider-header">
                <span className="m3-slider-label">Hızlandırıcı</span>
              </div>
              <div className="m3-segmented-button" style={{ flexWrap: "wrap" }}>
                {hepsi.map((b) => {
                  const var_ = b.available !== false;
                  const indiriliyor = indirme.active && indirme.backendId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`m3-segment-item ${constraints.backendType === b.id ? "active" : ""} ${!var_ ? "disabled" : ""}`}
                      onClick={() => var_ && hizlandiriciDegistir(b.id)}
                      disabled={!var_ || isGenerating}
                      title={!var_ ? b.reason : undefined}
                      style={{ flex: "1 1 auto", minWidth: "80px" }}
                    >
                      {indiriliyor ? `${Math.round(indirme.progress)}%` : etiket(b)}
                    </button>
                  );
                })}
              </div>
              <span className="settings-option-desc">
                GPU (Vulkan) genellikle çok daha hızlıdır. CPU yalnızca GPU sürücüsü sorun çıkarırsa seçilmeli.
              </span>
              {olmayanlar.map((b) => {
                const indiriliyor = indirme.active && indirme.backendId === b.id;
                return (
                  <div key={`indir-${b.id}`} className="motor-indirme-satiri">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{etiket(b)}</div>
                      <div className="settings-option-desc">
                        {indiriliyor ? `${Math.round(indirme.progress)}% ${indirme.speed || ""}` : (indirme.error && indirme.backendId === b.id ? indirme.error : b.reason)}
                      </div>
                    </div>
                    <button type="button" className="m3-btn m3-btn-tonal" onClick={() => motorIndir(b)} disabled={indirme.active}>
                      {indiriliyor ? <RefreshCw className="progress-spinner" size={14} /> : <DownloadCloud size={14} />}
                      <span>{indiriliyor ? "İndiriliyor" : "İndir"}</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <Anahtar
              checked={constraints.vaeTiling}
              onChange={(v) => guncelle("vaeTiling", v)}
              disabled={isGenerating}
              label="VAE döşeme"
              description="Son aşamada (latent → piksel) görüntüyü parçalara bölerek işler. Bellek kullanımını düşürür; büyük boyutlarda açık kalmalı."
            />
            <Anahtar
              checked={constraints.vaeOnCpu}
              onChange={(v) => guncelle("vaeOnCpu", v)}
              disabled={isGenerating}
              label="VAE işlemini CPU'da yap"
              description="GPU belleği yetmediğinde (bellek hatası) son aşamayı işlemciye taşır. Daha yavaştır."
            />
            <Anahtar
              checked={constraints.useFlashAttn}
              onChange={(v) => guncelle("useFlashAttn", v)}
              disabled={isGenerating}
              label="Flash Attention"
              description="Dikkat hesaplamasını daha az bellekle yapar. Genellikle hızlandırır."
            />

            <div className={`m3-slider-group ${gpu ? "kontrol-soluk" : ""}`}>
              <div className="m3-slider-header">
                <label className="m3-slider-label" htmlFor="gorsel-thread">İşlemci iş parçacığı</label>
                <span className="settings-value-badge">{constraints.threads}</span>
              </div>
              <input
                id="gorsel-thread"
                type="range"
                className="m3-slider"
                min={1}
                max={cekirdek}
                step={1}
                value={Math.min(cekirdek, constraints.threads || 1)}
                onChange={(e) => guncelle("threads", parseInt(e.target.value, 10))}
                style={kaydiriciStili(constraints.threads, 1, cekirdek)}
                disabled={isGenerating || gpu}
              />
              {gpu
                ? <SolukNeden>GPU seçiliyken işi ekran kartı yapar; iş parçacığı en fazla 4 ile sınırlanır.</SolukNeden>
                : <span className="settings-option-desc">CPU'da üretimde kullanılacak çekirdek sayısı. Fiziksel çekirdek sayısı genellikle en iyisidir.</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

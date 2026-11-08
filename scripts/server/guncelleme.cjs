// ============================================================================
// MODEL GÜNCELLEME BİLDİRİMİ (Yerel AI Stüdyosu)
//
// Açılıştan ~1 dk sonra (günde en çok bir kez, sonuç önbellekte) sürümü bilinen modellerin kaynağında yeni
// sürüm var mı bakar ve arayüze "Şu modellerde güncelleme var" listesini verir. Denetlenenler:
//   - Model arama ekranından kurulan modeller (app/config/model-surumleri.json: depo + commit + dosya özetleri)
//   - Sabit commit'li model paketleri (ozellikler.cjs / studyo.cjs PAKETLER: Seda, Duyu, MusicGen, AudioLDM,
//     AnimateDiff, Wan ...)
//   - Seslendirme motorlarının ağırlıkları (scripts/workers/tts_*.py içindeki AGIRLIKLAR sabitlemeleri)
//   - Konuşma tanıma klasöründeki whisper.cpp ggml dosyaları (ggerganov/whisper.cpp deposunda aynı adla
//     bulunanlar; ilk denetimde yerel dosyanın SHA256'sı bir kez hesaplanıp kaydedilir)
//
// GÜVENLİK:
//   - Hiçbir şey sessizce güncellenmez; her güncelleme kullanıcının onayıyla başlar.
//   - Güncelleme = yeni commit'e yeniden sabitleme + her dosyanın özetini yeniden doğrulama.
//   - Çalıştırılabilir kod (.py/.js/.exe/.dll ...) ya da pickle (.pt/.ckpt/.bin torch) içeren paketler ve
//     sürümü Python kodunda sabitlenmiş motor ağırlıkları uygulama içinden GÜNCELLENEMEZ: "Elle inceleme
//     gerekli" olarak gösterilir. Kodun yeni sürümü incelenmeden çalıştırılmamalıdır.
//   - Önceki sürüm, yenisi tamamen inip doğrulanana kadar yerinde kalır. Paketlerde yeni sürüm ayrı bir
//     klasörde hazırlanır (değişmeyen dosyalar sabit bağlantı/kopya ile alınıp yeniden doğrulanır), sonra
//     klasör tek hamlede yer değiştirir; tek dosyalı modellerde dosya doğrulanınca yerine taşınır. Başarısız
//     ya da yarım kalan güncelleme çalışan modeli bozmaz.
//   - Uygulamanın kendisini güncellemez (kendi kendini güncelleyen bir bileşen yoktur).
//
// PYTHON (pip) PAKETLERİ: kurulu özelliklerin (OZELLIKLER, studyo dahil) "ad==sürüm" sabitlemeleri PyPI'daki son
// kararlı sürümle karşılaştırılır. Bunlar "test edilmeden önerilmez" olarak listelenir, "Tümünü güncelle"ye
// girmez ve yalnızca ikinci bir onayla (istekte ikinciOnay:true) uygulanır. Uygulama: PyPI'nın yayımladığı
// wheel SHA256 özetleriyle --require-hashes --no-deps --only-binary=:all: kurulum (kaynak koddan derleme/kurulum
// betiği yok), ardından sürüm + modül içe aktarma + "pip check" doğrulaması; başarısızsa eski sürüm yine özetle
// doğrulanarak geri kurulur. Kendi dizininden (--index-url) ya da URL'den kurulanlar ve kilit dosyalı (-r)
// adımlar uygulama içinden güncellenmez.
//
// Ağ: yalnızca https://huggingface.co ve https://api.github.com (model-arama.cjs kuralları) ve
// https://pypi.org/pypi/<paket>/json. PyPI'ya hiçbir anahtar gönderilmez.
// Kullanıcı kararları ("bu sürümü atla", "bir daha sorma", uygulanan pip sürümleri): app/config/guncelleme.json
// ============================================================================
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { SABIT } = require("./model-arama.cjs");

const { SHA40, REPO_DESENI, KOD_UZANTISI, PICKLE_UZANTISI, GUN_MS } = SABIT;
const WHISPER_DEPO = "ggerganov/whisper.cpp";
const PIP_SABIT = /^([A-Za-z0-9][A-Za-z0-9._-]{0,100})==([0-9][0-9A-Za-z.+!-]{0,40})$/;
const KARARLI_SURUM = /^\d+(\.\d+){0,5}(\.post\d+)?$/;

// PEP 503 adı: küçük harf, [-_.] dizileri tek "-"
const pipAdi = (ad) => String(ad || "").toLowerCase().replace(/[-_.]+/g, "-");

// Kararlı sürümleri karşılaştır (1.10 > 1.9; .postN en sonda). Kararlı değilse NaN.
function surumKarsilastir(a, b) {
  if (!KARARLI_SURUM.test(a) || !KARARLI_SURUM.test(b)) return NaN;
  const parca = (s) => { const [ana, post] = s.split(".post"); return { ana: ana.split(".").map(Number), post: post === undefined ? -1 : Number(post) }; };
  const x = parca(a);
  const y = parca(b);
  for (let i = 0; i < Math.max(x.ana.length, y.ana.length); i += 1) {
    const d = (x.ana[i] || 0) - (y.ana[i] || 0);
    if (d) return Math.sign(d);
  }
  return Math.sign(x.post - y.post);
}

// OZELLIKLER adımlarından pip sabitlemelerini çıkar: { ad(PEP503) -> { ad, surum, ozellikler[], elle } }
function pipSabitlemeleri(ozellikler, kuruluMu = () => true) {
  const sonuc = new Map();
  for (const [id, oz] of Object.entries(ozellikler || {})) {
    if (!oz || !Array.isArray(oz.adimlar) || !kuruluMu(id)) continue;
    for (const adim of oz.adimlar) {
      if (!Array.isArray(adim)) continue;
      const kilitli = adim.includes("-r") || adim.includes("--requirement");
      const ozelDizin = adim.some((a) => /^--(extra-)?index-url$|^--find-links$|^-f$/.test(String(a)));
      if (kilitli) continue; // kilit dosyası: geliştirici tümünü birlikte yeniden üretir
      for (const arg of adim) {
        const m = PIP_SABIT.exec(String(arg));
        if (!m) continue;
        const ad = pipAdi(m[1]);
        const k = sonuc.get(ad) || { ad, gosterim: m[1], surum: m[2], ozellikler: [], elle: "" };
        if (k.surum !== m[2]) k.elle = `Özellikler bu paketi farklı sürümlere sabitlemiş (${k.surum} / ${m[2]}); geliştiricinin birleştirmesi gerekir.`;
        if (ozelDizin && !k.elle) k.elle = "Bu paket PyPI dışındaki kendi dizininden (ör. PyTorch CPU deposu) kurulur; uygulama içinden güncellenmez.";
        if (!k.ozellikler.includes(id)) k.ozellikler.push(id);
        sonuc.set(ad, k);
      }
    }
  }
  return sonuc;
}

// "onnx/*", "voice_styles/*.json" gibi huggingface_hub allow_patterns kalıplarını düzenli ifadeye çevir
function kaliptanDesen(kalip) {
  const kacisli = String(kalip).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${kacisli}$`);
}

// scripts/workers/tts_*.py içindeki AGIRLIKLAR = { "ad": { "repo": ..., "revision": ..., "allow_patterns": [...] } }
function pythonAgirliklariniOku(metin) {
  const sonuc = [];
  // (satır içi "# yorum"lara izin verilir: gerçek dosyada repo ile revision arasında yorum satırı var)
  const desen = /"([A-Za-z0-9_-]+)"\s*:\s*\{(?:\s|#[^\n]*)*"repo"\s*:\s*"([^"]+)"\s*,(?:\s|#[^\n]*)*"revision"\s*:\s*"([0-9a-f]{40})"[^\n]*(?:\s|#[^\n]*)*"allow_patterns"\s*:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = desen.exec(String(metin || "")))) {
    const kaliplar = [...m[4].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (REPO_DESENI.test(m[2])) sonuc.push({ anahtar: m[1], repo: m[2], surum: m[3], kaliplar });
  }
  return sonuc;
}

module.exports = function modelGuncelleme(ctx) {
  const A = ctx.arama; // model-arama.cjs dönüşündeki "ortak"
  const { OZ, ROOT, json, readJsonBody, pathInside, log, simdi } = A;
  // Güncelleme sonuçları uygulama günlüğüne de yazılır (hata ayrıntısı sonradan bulunabilsin)
  const mesgulMu = () => { try { return typeof ctx.mesgulMu === "function" && !!ctx.mesgulMu(); } catch (_) { return false; } };
  const gunluk = (s) => { try { if (typeof ctx.motorGunlugu === "function") ctx.motorGunlugu(`[güncelleme] ${s}`); } catch (_) {} };
  const klasorler = ctx.klasorler || {};
  const ISCI_KLASORU = ctx.isciKlasoru || path.join(ROOT, "scripts", "workers");
  const TTS_DOSYALARI = ctx.ttsAgirlikDosyalari || ["tts_antalia_supertonic.py", "tts_ahenk_omnivoice.py"];

  const ONBELLEK = path.join(ROOT, "app", "cache", "model-guncellemeleri.json");
  const YEREL_OZET = path.join(ROOT, "app", "cache", "yerel-dosya-ozetleri.json");
  const TERCIHLER = path.join(ROOT, "app", "config", "guncelleme.json");
  const ESKI_TERCIHLER = path.join(ROOT, "app", "config", "model-guncelleme-tercihleri.json"); // önceki sürümün dosyası
  const fetchImpl = ctx.fetch || globalThis.fetch;
  const PIP_ONBELLEK = path.join(ROOT, "app", "cache", "pip");
  const pythonCalistir = ctx.pythonCalistir || varsayilanPythonCalistir;

  const nesne = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  function tercihOku() {
    const t = A.jsonOku(TERCIHLER, null) || A.jsonOku(ESKI_TERCIHLER, {});
    return { atlanan: nesne(t.atlanan), sorma: nesne(t.sorma), pipUygulanan: nesne(t.pipUygulanan) };
  }
  function tercihYaz(t) { A.jsonYaz(TERCIHLER, { surum: 1, atlanan: t.atlanan, sorma: t.sorma, pipUygulanan: t.pipUygulanan }); }
  function onbellekOku() { return A.jsonOku(ONBELLEK, null); }

  // --------------------------------------------------------------------------
  // Yeniden sabitlenmiş paket sürümleri: kod içindeki sabitleme değişmediyse (geliştirici başka bir sürüme
  // geçmediyse) kullanıcının onaylayıp doğruladığı commit kullanılır. Geliştirici sabitlemeyi değiştirirse
  // kod kazanır (kayıt yok sayılır).
  // --------------------------------------------------------------------------
  function paketSurumleriniUygula() {
    if (!OZ || !OZ.PAKETLER) return;
    const m = A.manifestOku();
    for (const [id, kayit] of Object.entries(m.paketler)) {
      const p = OZ.PAKETLER[id];
      if (!p || !kayit || !SHA40.test(String(kayit.surum || "")) || !SHA40.test(String(kayit.kodSurumu || ""))) continue;
      if (p.surum === kayit.kodSurumu && !p._kodSurumu) { p._kodSurumu = p.surum; p.surum = kayit.surum; }
    }
  }
  const kodSurumu = (p) => p._kodSurumu || p.surum;
  const ozet = (f) => f.sha256 || f.gitOid;
  const kodDosyalari = (liste) => liste.filter((f) => KOD_UZANTISI.test(f.yol)).map((f) => f.yol);

  // --------------------------------------------------------------------------
  // Denetleyiciler (her biri ya null = güncel, ya da bir "güncelleme" nesnesi döndürür)
  // --------------------------------------------------------------------------
  async function hfModelDenetle(kimlik, kayit) {
    const klasor = klasorler[kayit.klasor || kayit.tur];
    if (!klasor) return null;
    const dosyalarVar = (kayit.dosyalar || []).every((f) => A.guvenliAd(f.ad) === f.ad && fs.existsSync(path.join(klasor, f.ad)));
    if (!dosyalarVar) return { kaldirildi: true };
    const detay = await A.hfDetay(kayit.repo, { taze: true });
    if (!SHA40.test(String(detay.sha || "")) || detay.sha === kayit.surum) return null;
    const yeni = new Map(A.hfDosyalari(detay).map((f) => [f.yol, f]));
    const degisenler = [];
    let eksik = false;
    for (const f of kayit.dosyalar || []) {
      const y = yeni.get(f.yol);
      if (!y) { eksik = true; degisenler.push({ yol: f.yol, durum: "silindi", eskiBoyut: f.boyut, yeniBoyut: 0 }); continue; }
      const ayni = (f.sha256 && y.sha256 === f.sha256) || (f.gitOid && y.gitOid === f.gitOid);
      if (!ayni) degisenler.push({ yol: f.yol, durum: "degisti", eskiBoyut: f.boyut, yeniBoyut: y.boyut });
    }
    if (!degisenler.length) return null; // depo değişti ama bu modelin dosyaları aynı (ör. yalnızca README)
    return {
      id: kimlik, cesit: "model", tur: kayit.tur, ad: kayit.ad || kayit.repo, kaynak: "hf", repo: kayit.repo, sayfa: `https://huggingface.co/${kayit.repo}`,
      eskiSurum: kayit.surum, yeniSurum: detay.sha, eskiTarih: kayit.guncellendi || kayit.kuruldu || "", tarih: detay.lastModified || "", degisenler,
      indirilecekBayt: degisenler.reduce((t, x) => t + (x.yeniBoyut || 0), 0), kodDosyalari: [],
      otomatik: !eksik, elleInceleme: false,
      neden: eksik ? "Dosya yeni sürümde kaldırılmış ya da adı değişmiş; model arama ekranından yeni sürümü seçip kurun." : "",
    };
  }

  async function ghModelDenetle(kimlik, kayit) {
    const klasor = klasorler[kayit.klasor || kayit.tur];
    if (!klasor || !(kayit.dosyalar || []).every((f) => A.guvenliAd(f.ad) === f.ad && fs.existsSync(path.join(klasor, f.ad)))) return { kaldirildi: true };
    const surum = await A.ghSonSurum(kayit.repo);
    if (!surum || String(surum.tag_name) === kayit.surum) return null;
    const secenek = A.ghSecenekleri(kayit.tur, surum, A.donanim()).find((s) => s.anahtar === kayit.anahtar);
    const degisenler = [];
    if (secenek) {
      for (const f of kayit.dosyalar) {
        const y = secenek.dosyalar.find((x) => x.yol === f.yol);
        if (!y) degisenler.push({ yol: f.yol, durum: "silindi", eskiBoyut: f.boyut, yeniBoyut: 0 });
        else if (y.sha256 !== f.sha256) degisenler.push({ yol: f.yol, durum: "degisti", eskiBoyut: f.boyut, yeniBoyut: y.boyut });
      }
      if (!degisenler.length) return null;
    }
    const tamam = secenek && secenek.dosyalar.every((f) => f.sha256) && !degisenler.some((x) => x.durum === "silindi");
    return {
      id: kimlik, cesit: "model", tur: kayit.tur, ad: kayit.ad || kayit.repo, kaynak: "github", repo: kayit.repo, sayfa: `https://github.com/${kayit.repo}/releases`,
      eskiSurum: kayit.surum, yeniSurum: String(surum.tag_name || ""), eskiTarih: kayit.guncellendi || "", tarih: surum.published_at || "", baslik: String(surum.name || "").slice(0, 200),
      degisenler, indirilecekBayt: degisenler.reduce((t, x) => t + (x.yeniBoyut || 0), 0), kodDosyalari: [],
      otomatik: Boolean(tamam), elleInceleme: false,
      neden: tamam ? "" : "Yeni sürümde aynı dosya yok ya da SHA256 özeti yayımlanmamış; model arama ekranından inceleyip kurun.",
    };
  }

  async function paketFarki(p) {
    const detay = await A.hfDetay(p.repo, { taze: true });
    if (!SHA40.test(String(detay.sha || "")) || detay.sha === p.surum) return null;
    const secilen = (liste) => liste.filter((f) => (p.dahil || []).some((k) => k.test(f.yol)));
    const eski = secilen(A.hfAgacDosyalari(await A.guvenliJson(`https://huggingface.co/api/models/${p.repo}/tree/${p.surum}?recursive=true`)));
    const yeni = secilen(A.hfDosyalari(detay));
    const eskiMap = new Map(eski.map((f) => [f.yol, f]));
    const yeniMap = new Map(yeni.map((f) => [f.yol, f]));
    const degisenler = [];
    for (const f of yeni) {
      const e = eskiMap.get(f.yol);
      if (!e) degisenler.push({ yol: f.yol, durum: "eklendi", eskiBoyut: 0, yeniBoyut: f.boyut });
      else if (ozet(e) !== ozet(f)) degisenler.push({ yol: f.yol, durum: "degisti", eskiBoyut: e.boyut, yeniBoyut: f.boyut });
    }
    for (const f of eski) if (!yeniMap.has(f.yol)) degisenler.push({ yol: f.yol, durum: "silindi", eskiBoyut: f.boyut, yeniBoyut: 0 });
    return { detay, eski, yeni, eskiMap, degisenler };
  }

  async function paketDenetle(id, p) {
    if (!OZ.paketKuruluMu(id) || !SHA40.test(String(p.surum || "")) || !REPO_DESENI.test(String(p.repo || ""))) return null;
    const fark = await paketFarki(p);
    if (!fark || !fark.degisenler.length) return null;
    const { detay, eski, yeni, degisenler } = fark;
    const kodlu = kodDosyalari([...eski, ...yeni]);
    const degisenKod = degisenler.filter((x) => KOD_UZANTISI.test(x.yol)).map((x) => x.yol);
    const pickle = yeni.filter((f) => PICKLE_UZANTISI.test(f.yol)).map((f) => f.yol);
    const ozetsiz = yeni.filter((f) => !ozet(f)).map((f) => f.yol);
    const elle = kodlu.length > 0 || pickle.length > 0 || ozetsiz.length > 0;
    let neden = "";
    if (kodlu.length) neden = "Bu paket çalıştırılabilir kod içeriyor (" + (degisenKod.length ? degisenKod : kodlu).slice(0, 6).join(", ") + "). Uygulama yeni kodu incelemeden çalıştırmaz; kod incelendikten sonra geliştirici sabit sürümü (commit) değiştirmelidir.";
    else if (pickle.length) neden = "Yeni sürümde pickle biçimli dosya var (" + pickle.slice(0, 6).join(", ") + "); bu biçim yüklenirken kod çalıştırabildiği için otomatik güncellenmez.";
    else if (ozetsiz.length) neden = "Bazı dosyaların özeti yayımlanmamış; doğrulanamayan dosya indirilmez.";
    return {
      id: `paket:${id}`, cesit: "paket", paket: id, tur: "paket", ad: p.etiket || id, kaynak: "hf", repo: p.repo, sayfa: `https://huggingface.co/${p.repo}`,
      eskiSurum: p.surum, yeniSurum: detay.sha, tarih: detay.lastModified || "", degisenler,
      indirilecekBayt: degisenler.reduce((t, x) => t + (x.yeniBoyut || 0), 0),
      kodDosyalari: degisenKod.length ? degisenKod : kodlu, otomatik: !elle, elleInceleme: elle, neden,
    };
  }

  // Seslendirme motorlarının ağırlıkları: sürüm Python kodunda sabit, pip paketinin sürümüne bağlı.
  // Yalnızca bilgi verilir; güncelleme her zaman geliştiricinin elle incelemesini gerektirir.
  function ttsSabitlemeleri() {
    const liste = [];
    for (const ad of TTS_DOSYALARI) {
      try {
        for (const a of pythonAgirliklariniOku(fs.readFileSync(path.join(ISCI_KLASORU, ad), "utf8"))) liste.push({ ...a, dosya: ad });
      } catch (_) {}
    }
    return liste;
  }
  async function ttsDenetle(a) {
    const ozellik = `tts-${a.anahtar}`;
    if (!OZ || !OZ.OZELLIKLER || !OZ.OZELLIKLER[ozellik]) return null;
    if (typeof OZ.kuruluBiliniyorMu === "function" && !OZ.kuruluBiliniyorMu(ozellik)) return null;
    const desenler = a.kaliplar.map(kaliptanDesen);
    const fark = await paketFarki({ repo: a.repo, surum: a.surum, dahil: desenler });
    if (!fark || !fark.degisenler.length) return null; // depo değişti ama motorun kullandığı dosyalar aynı
    const pickle = fark.yeni.concat(fark.eski).filter((f) => PICKLE_UZANTISI.test(f.yol)).map((f) => f.yol);
    return {
      id: `tts:${a.anahtar}`, cesit: "tts", tur: "tts", ad: (OZ.OZELLIKLER[ozellik].etiket || a.anahtar) + " — model ağırlıkları",
      kaynak: "hf", repo: a.repo, sayfa: `https://huggingface.co/${a.repo}`, eskiSurum: a.surum, yeniSurum: fark.detay.sha,
      tarih: fark.detay.lastModified || "", degisenler: fark.degisenler,
      indirilecekBayt: fark.degisenler.reduce((t, x) => t + (x.yeniBoyut || 0), 0), kodDosyalari: [], otomatik: false, elleInceleme: true,
      neden: `Bu motorun ağırlık sürümü Python kodunda (scripts/workers/${a.dosya}) ve pip paketinin sürümüyle birlikte sabitlenmiştir; yeni ağırlıklar eski kodla uyumsuz olabilir, uygulama içinden değiştirilmez.`
        + (pickle.length ? ` Ayrıca ${[...new Set(pickle)].slice(0, 4).join(", ")} pickle biçiminde: yüklenirken kod çalıştırabilir, önce incelenmelidir.` : ""),
    };
  }

  // Konuşma tanıma klasöründeki whisper.cpp dosyalarını bir kez sürüm kaydına al
  async function yerelSha256(dosya) {
    const st = fs.statSync(dosya);
    const kayit = A.jsonOku(YEREL_OZET, {});
    const k = kayit[dosya];
    if (k && k.boyut === st.size && k.mtime === st.mtimeMs && /^[0-9a-f]{64}$/.test(k.sha256)) return k.sha256;
    const sha256 = await A.dosyaSha256(dosya);
    const yeni = A.jsonOku(YEREL_OZET, {});
    yeni[dosya] = { boyut: st.size, mtime: st.mtimeMs, sha256 };
    try { A.jsonYaz(YEREL_OZET, yeni); } catch (_) {}
    return sha256;
  }
  async function whisperDosyalariniKaydet(m) {
    const klasor = klasorler.speech;
    if (!klasor || !fs.existsSync(klasor)) return false;
    const kayitli = new Set(Object.values(m.modeller).filter((k) => (k.klasor || k.tur) === "speech").flatMap((k) => (k.dosyalar || []).map((f) => f.ad)));
    const adaylar = fs.readdirSync(klasor).filter((ad) => /^ggml-[A-Za-z0-9._-]+\.bin$/.test(ad) && !kayitli.has(ad));
    if (!adaylar.length) return false;
    const detay = await A.hfDetay(WHISPER_DEPO, { taze: true });
    if (!SHA40.test(String(detay.sha || ""))) return false;
    const uzak = new Map(A.hfDosyalari(detay).filter((f) => !f.yol.includes("/")).map((f) => [f.yol, f]));
    let degisti = false;
    for (const ad of adaylar) {
      const f = uzak.get(ad);
      if (!f || !f.sha256) continue; // depoda yok: kullanıcının kendi dosyası, dokunulmaz
      const yerel = path.join(klasor, ad);
      if (!pathInside(yerel, klasor)) continue;
      const sha256 = await yerelSha256(yerel);
      const ayni = sha256 === f.sha256;
      m.modeller[`speech:hf:${WHISPER_DEPO}:${ad}`] = {
        kaynak: "hf", repo: WHISPER_DEPO, surum: ayni ? detay.sha : "yerel", tur: "speech", klasor: "speech", anahtar: ad,
        ad: `Whisper ${ad.replace(/^ggml-|\.bin$/g, "")}`, lisans: "mit",
        dosyalar: [{ yol: ad, ad, boyut: fs.statSync(yerel).size, sha256, gitOid: "" }],
        kuruldu: new Date(fs.statSync(yerel).mtimeMs).toISOString(), guncellendi: "", benimsendi: true,
      };
      degisti = true;
    }
    return degisti;
  }

  // --------------------------------------------------------------------------
  // Python (pip) paketleri: PyPI'daki son kararlı sürüm
  // --------------------------------------------------------------------------
  async function pypiJson(ad, surum = "") {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(ad) || (surum && !/^[0-9][0-9A-Za-z.+!-]{0,40}$/.test(surum))) throw new Error("Geçersiz paket adı");
    let u = new URL(`https://pypi.org/pypi/${ad}${surum ? `/${surum}` : ""}/json`);
    for (let yonlendirme = 0; yonlendirme < 4; yonlendirme += 1) {
      if (u.protocol !== "https:" || u.hostname !== "pypi.org" || u.username || u.password || (u.port && u.port !== "443") || !u.pathname.startsWith("/pypi/")) {
        throw new Error("İzin verilmeyen adres: " + u.origin + u.pathname);
      }
      // Anahtar/çerez yok: PyPI'ya yalnızca paket adı gider
      const yanit = await fetchImpl(u.toString(), { headers: { "User-Agent": "Yerel-AI-Studyosu/1.0", Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(15000) });
      if ([301, 302, 303, 307, 308].includes(yanit.status)) {
        const konum = yanit.headers.get("location");
        if (!konum) throw new Error("Yönlendirme adresi yok");
        u = new URL(konum, u);
        continue;
      }
      const tampon = Buffer.from(await yanit.arrayBuffer());
      if (tampon.length > 30 * 1024 * 1024) throw new Error("Yanıt çok büyük");
      if (!yanit.ok) throw Object.assign(new Error(`PyPI HTTP ${yanit.status}`), { status: yanit.status });
      const veri = JSON.parse(tampon.toString("utf8"));
      if (!veri || typeof veri !== "object" || !veri.info) throw new Error("PyPI yanıtı beklenen biçimde değil");
      return veri;
    }
    throw new Error("Çok fazla yönlendirme");
  }
  // Yalnızca hazır paketler (wheel), geri çekilmemiş, SHA256 özeti yayımlanmış
  function wheelOzetleri(veri) {
    return (Array.isArray(veri && veri.urls) ? veri.urls : [])
      .filter((u) => u && u.packagetype === "bdist_wheel" && !u.yanked && /\.whl$/.test(String(u.filename || "")) && /^[0-9a-f]{64}$/.test(String((u.digests && u.digests.sha256) || "")))
      .map((u) => ({ ad: String(u.filename), sha256: String(u.digests.sha256), boyut: Number(u.size) || 0, tarih: String(u.upload_time_iso_8601 || "") }));
  }
  function buPlatformunWheeli(tekerler) {
    const desen = process.platform === "win32" ? /win_amd64|none-any/ : process.platform === "darwin" ? /macosx|none-any/ : /manylinux.*x86_64|none-any/;
    return tekerler.find((w) => /cp312/.test(w.ad) && desen.test(w.ad)) || tekerler.find((w) => desen.test(w.ad)) || null;
  }
  const bagimliliklar = (veri) => (Array.isArray(veri && veri.info && veri.info.requires_dist) ? [...veri.info.requires_dist].map(String).sort() : []);

  async function pipDenetle(k, t) {
    const kayit = t.pipUygulanan[k.ad];
    // Uygulama içinden onaylanıp doğrulanan sürüm, kod içindeki sabitleme değişmediyse geçerlidir
    const mevcut = kayit && kayit.kodSurumu === k.surum && kayit.surum ? String(kayit.surum) : k.surum;
    const veri = await pypiJson(k.ad);
    const son = String(veri.info.version || "");
    if (!(surumKarsilastir(son, mevcut) > 0)) return null; // güncel, ya da son sürüm kararlı değil
    const yeni = await pypiJson(k.ad, son);
    if (yeni.info.yanked) return null;
    let eski = null;
    try { eski = await pypiJson(k.ad, mevcut); } catch (err) { if (A.agHatasiMi(err)) throw err; }
    const tekerler = wheelOzetleri(yeni);
    const teker = buPlatformunWheeli(tekerler);
    const eskiDosyalar = (veri.releases && Array.isArray(veri.releases[mevcut])) ? veri.releases[mevcut] : [];
    const proje = nesne(veri.info.project_urls);
    const notAdresi = Object.entries(proje).find(([a, v]) => /change|release|news|history/i.test(a) && /^https:\/\//.test(String(v)));
    const etkilenen = k.ozellikler.map((id) => (OZ.OZELLIKLER[id] && OZ.OZELLIKLER[id].etiket) || id);
    const bagimlilikDegisti = Boolean(eski) && JSON.stringify(bagimliliklar(eski)) !== JSON.stringify(bagimliliklar(yeni));
    let elle = k.elle;
    if (!elle && !tekerler.length) elle = "Yeni sürümün hazır paketi (wheel) ya da SHA256 özeti yok; kaynak koddan kurulum betiği çalıştırılmaz.";
    if (!elle && !teker) elle = "Yeni sürümün bu işletim sistemi için hazır paketi (wheel) yok.";
    return {
      id: `pip:${k.ad}`, cesit: "pip", tur: "pip", paketAdi: k.ad, ad: `${k.gosterim} (Python paketi)`, kaynak: "pypi", repo: k.gosterim,
      sayfa: `https://pypi.org/project/${k.ad}/${son}/`, degisiklikAdresi: notAdresi ? String(notAdresi[1]) : `https://pypi.org/project/${k.ad}/#history`,
      eskiSurum: mevcut, yeniSurum: son, eskiTarih: String((eskiDosyalar[0] && eskiDosyalar[0].upload_time_iso_8601) || ""),
      tarih: (teker && teker.tarih) || (tekerler[0] && tekerler[0].tarih) || "", degisenler: [], indirilecekBayt: teker ? teker.boyut : 0,
      kodDosyalari: [], etkilenen, otomatik: false, elleInceleme: Boolean(elle), testEdilmedi: true, ikinciOnayGerekir: !elle,
      neden: elle || (`Test edilmeden önerilmez: ${etkilenen.join(", ")} bu sürümle denenmedi.`
        + (bagimlilikDegisti ? " Yeni sürümün bağımlılık listesi değişmiş; eksik bağımlılık varsa doğrulama başarısız olur." : "")
        + " Kurulumdan sonra modüller ve bağımlılıklar denetlenir; sorun çıkarsa önceki sürüm geri kurulur."),
    };
  }

  async function pipDenetimleri(sonuc) {
    if (!OZ || !OZ.OZELLIKLER) return;
    const kurulu = new Set();
    for (const [id, oz] of Object.entries(OZ.OZELLIKLER)) {
      if (!oz || !Array.isArray(oz.adimlar)) continue;
      try {
        const var_ = typeof OZ.ozellikKuruluMu === "function" ? await OZ.ozellikKuruluMu(id) : (typeof OZ.kuruluBiliniyorMu === "function" && OZ.kuruluBiliniyorMu(id));
        if (var_) kurulu.add(id);
      } catch (_) {}
    }
    const t = tercihOku();
    for (const k of pipSabitlemeleri(OZ.OZELLIKLER, (id) => kurulu.has(id)).values()) {
      try {
        const r = await pipDenetle(k, t);
        if (r) sonuc.guncellemeler.push(r);
      } catch (err) {
        if (A.agHatasiMi(err)) return; // PyPI'ya ulaşılamıyor: pip denetimi sessizce atlanır, modeller etkilenmez
        sonuc.hatalar.push({ id: `pip:${k.ad}`, hata: err.message || String(err) });
      }
    }
  }

  function varsayilanPythonCalistir(argumanlar, { zamanAsimiMs = 30 * 60 * 1000, kurulum = false } = {}) {
    return new Promise((resolve) => {
      // Ağ kalkanı: internete çıkan pip yalnızca kurulum kopyasıyla çalışır
      const py = kurulum && OZ && typeof OZ.kurulumPython === "function" ? OZ.kurulumPython() : OZ && OZ.PYTHON;
      if (!py || (process.platform === "win32" && !fs.existsSync(py))) { resolve({ kod: -1, cikti: "Taşınabilir Python kurulu değil." }); return; }
      let cikti = "";
      let p;
      try {
        p = spawn(py, argumanlar, { windowsHide: true, cwd: ROOT, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PIP_DISABLE_PIP_VERSION_CHECK: "1" } });
      } catch (err) { resolve({ kod: -1, cikti: String(err.message || err) }); return; }
      const zaman = setTimeout(() => { try { p.kill(); } catch (_) {} }, zamanAsimiMs);
      const ekle = (d) => { cikti = (cikti + d.toString()).slice(-20000); };
      p.stdout.on("data", ekle);
      p.stderr.on("data", ekle);
      p.on("error", (err) => { clearTimeout(zaman); resolve({ kod: -1, cikti: cikti + String(err.message || err) }); });
      p.on("close", (kod) => { clearTimeout(zaman); resolve({ kod, cikti }); });
    });
  }
  const sonSatirlar = (s, n = 3) => String(s || "").trim().split(/\r?\n/).slice(-n).join(" | ").slice(0, 500);

  // Tam olarak bu sürüm, yalnızca verilen SHA256 özetlerinden birine uyan wheel ile, bağımlılıklara dokunmadan
  async function pipOzetliKur(ad, surum, tekerler) {
    const dosya = path.join(ROOT, "app", "cache", `guncelleme-pip-${crypto.randomBytes(4).toString("hex")}.txt`);
    fs.mkdirSync(path.dirname(dosya), { recursive: true });
    fs.writeFileSync(dosya, `${ad}==${surum} ${tekerler.map((w) => `--hash=sha256:${w.sha256}`).join(" ")}\n`, "utf8");
    try {
      return await pythonCalistir(["-m", "pip", "install", "--isolated", "--no-warn-script-location", "--disable-pip-version-check",
        "--cache-dir", PIP_ONBELLEK, "--index-url", "https://pypi.org/simple", "--no-deps", "--only-binary=:all:", "--require-hashes", "-r", dosya], { kurulum: true });
    } finally { try { fs.unlinkSync(dosya); } catch (_) {} }
  }
  async function pipSurumu(ad) {
    const r = await pythonCalistir(["-c", `import importlib.metadata as m; print(m.version(${JSON.stringify(ad)}))`], { zamanAsimiMs: 120000 });
    return r.kod === 0 ? String(r.cikti).trim().split(/\r?\n/).pop().trim() : "";
  }
  async function pipSorunlari() {
    const r = await pythonCalistir(["-m", "pip", "check", "--disable-pip-version-check"], { zamanAsimiMs: 120000 });
    return r.kod === 0 ? [] : String(r.cikti).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^no broken/i.test(s));
  }
  async function pipDogrula(ad, surum, ozellikIdleri, oncekiSorunlar) {
    const kurulan = await pipSurumu(ad);
    if (kurulan !== surum) return `Kurulu sürüm doğrulanamadı (${kurulan || "okunamadı"} ≠ ${surum}).`;
    const moduller = [...new Set(ozellikIdleri.flatMap((id) => (OZ.OZELLIKLER[id] && OZ.OZELLIKLER[id].moduller) || []))].filter((m) => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(m));
    if (moduller.length) {
      const kod = `import sys\nsys.path.insert(0, ${JSON.stringify(ISCI_KLASORU)})\nimport importlib\nfor m in ${JSON.stringify(moduller)}:\n    importlib.import_module(m)\nprint("tamam")`;
      const r = await pythonCalistir(["-c", kod], { zamanAsimiMs: 10 * 60 * 1000 });
      if (r.kod !== 0) return `Modüller yeni sürümle içe aktarılamadı: ${sonSatirlar(r.cikti)}`;
    }
    const yeniSorun = (await pipSorunlari()).filter((s) => !oncekiSorunlar.has(s));
    if (yeniSorun.length) return `Bağımlılık uyumsuzluğu: ${yeniSorun.slice(0, 3).join(" | ")}`;
    return "";
  }

  async function pipGuncelle(g) {
    // Bir özellik kurulumu sürüyorsa reddetmek yerine bitmesi beklenir (ilk kurulum sihirbazı indirirken olur)
    if (OZ.kurulumDurumu && OZ.kurulumDurumu().aktif) {
      const bekleyenIs = A.aktifIs();
      if (bekleyenIs) bekleyenIs.asama = "Bir özellik kurulumu sürüyor; bitmesi bekleniyor";
      gunluk(`${g.ad}: özellik kurulumu bitene kadar bekleniyor`);
      while (OZ.kurulumDurumu().aktif) await new Promise((r) => setTimeout(r, 5000));
    }
    // Doğrulama yalnızca bu bilgisayarda KURULU özelliklerin modülleriyle yapılır (kurulu olmayan bir özelliğin
    // modülü — ör. Antalia kurulmamışken antalia_mini — içe aktarılamaz ve güncellemeyi boşuna geri aldırırdı)
    const kurulu = new Set();
    for (const id of Object.keys((OZ && OZ.OZELLIKLER) || {})) {
      try { if (typeof OZ.ozellikKuruluMu === "function" ? await OZ.ozellikKuruluMu(id) : OZ.kuruluBiliniyorMu(id)) kurulu.add(id); } catch (_) {}
    }
    const sabit = pipSabitlemeleri(OZ && OZ.OZELLIKLER, (id) => kurulu.has(id)).get(String(g.paketAdi || ""));
    if (!sabit) throw new Error("Bu paketi kullanan kurulu bir özellik yok; güncellemeye gerek yok.");
    const r = await pipDenetle(sabit, tercihOku()); // taze yeniden denetim
    if (!r) return { id: g.id, guncel: true };
    if (r.elleInceleme) throw new Error(`${r.ad}: elle inceleme gerekiyor. ${r.neden}`);
    if (r.yeniSurum !== g.yeniSurum) throw new Error(`PyPI'daki son sürüm değişti (${r.yeniSurum}); listeyi yenileyip yeniden onaylayın.`);
    const yeniTeker = wheelOzetleri(await pypiJson(sabit.ad, r.yeniSurum));
    let eskiTeker = [];
    try { eskiTeker = wheelOzetleri(await pypiJson(sabit.ad, r.eskiSurum)); } catch (_) {}
    if (!yeniTeker.length) throw new Error("Yeni sürümün özetli hazır paketi yok.");
    const is = A.aktifIs();
    try { if (OZ.hepsiniKapat) OZ.hepsiniKapat(); } catch (_) {} // Python çalışanları DLL'leri kilitlemesin
    if (is) is.asama = "Mevcut bağımlılıklar denetleniyor";
    const onceki = new Set(await pipSorunlari());
    if (is) is.asama = `${sabit.gosterim} ${r.yeniSurum} kuruluyor (SHA256 doğrulamalı)`;
    const k = await pipOzetliKur(sabit.ad, r.yeniSurum, yeniTeker);
    let hata = k.kod !== 0 ? `pip hatası: ${sonSatirlar(k.cikti)}` : "";
    if (!hata) {
      if (is) is.asama = "Yeni sürüm doğrulanıyor (modüller + bağımlılıklar)";
      hata = await pipDogrula(sabit.ad, r.yeniSurum, sabit.ozellikler, onceki);
    }
    if (hata) {
      if (is) is.asama = "Doğrulama başarısız; önceki sürüm geri kuruluyor";
      let geri = "Önceki sürümün özetli paketi bulunamadı; özelliği Ayarlar'dan yeniden kurun.";
      if (eskiTeker.length) {
        const gk = await pipOzetliKur(sabit.ad, r.eskiSurum, eskiTeker);
        const tamam = gk.kod === 0 && (await pipSurumu(sabit.ad)) === r.eskiSurum;
        geri = tamam ? `Önceki sürüm (${r.eskiSurum}) geri kuruldu.` : `ÖNCEKİ SÜRÜM GERİ KURULAMADI; özelliği Ayarlar'dan yeniden kurun. (${sonSatirlar(gk.cikti, 2)})`;
      }
      throw new Error(`${hata} ${geri}`);
    }
    const t = tercihOku();
    t.pipUygulanan[sabit.ad] = { surum: r.yeniSurum, kodSurumu: sabit.surum, oncekiSurum: r.eskiSurum, guncellendi: new Date(simdi()).toISOString() };
    tercihYaz(t);
    for (const id of sabit.ozellikler) { try { const p = OZ.ozellikKuruluMu && OZ.ozellikKuruluMu(id, true); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
    return { id: g.id, surum: r.yeniSurum };
  }

  // --------------------------------------------------------------------------
  // Denetim (günde en çok bir kez; çevrimdışıysa sessizce vazgeçer)
  // --------------------------------------------------------------------------
  let denetim = { suruyor: false, promise: null, sonZorla: 0 };

  async function denetimYap() {
    const sonuc = { sonDenetim: simdi(), guncellemeler: [], hatalar: [] };
    try { await A.guvenliJson("https://huggingface.co/api/models?limit=1", { zamanAsimiMs: 8000 }); }
    catch (err) { if (A.agHatasiMi(err)) return { cevrimdisi: true }; }
    const adim = async (id, fn) => {
      try { const r = await fn(); if (r && !r.kaldirildi) sonuc.guncellemeler.push(r); return r; }
      catch (err) { if (A.agHatasiMi(err)) throw err; sonuc.hatalar.push({ id, hata: err.message || String(err) }); return null; }
    };
    try {
      const m = A.manifestOku();
      let manifestDegisti = false;
      try { manifestDegisti = await whisperDosyalariniKaydet(m); }
      catch (err) { if (A.agHatasiMi(err)) throw err; sonuc.hatalar.push({ id: "whisper", hata: err.message }); }
      for (const [kimlik, kayit] of Object.entries(m.modeller)) {
        const r = await adim(kimlik, () => (kayit.kaynak === "github" ? ghModelDenetle(kimlik, kayit) : hfModelDenetle(kimlik, kayit)));
        if (r && r.kaldirildi) { delete m.modeller[kimlik]; manifestDegisti = true; }
      }
      if (manifestDegisti) { try { A.manifestYaz(m); } catch (_) {} }
      if (OZ && OZ.PAKETLER) for (const [id, p] of Object.entries(OZ.PAKETLER)) await adim(`paket:${id}`, () => paketDenetle(id, p));
      for (const a of ttsSabitlemeleri()) await adim(`tts:${a.anahtar}`, () => ttsDenetle(a));
    } catch (err) {
      if (A.agHatasiMi(err)) return { cevrimdisi: true };
      throw err;
    }
    await pipDenetimleri(sonuc);
    // Değişiklik notu: son commit başlığı (yalnızca güncelleme bulunan HF depoları için) + değişiklik sayfası bağlantısı
    for (const g of sonuc.guncellemeler) {
      if (!g.degisiklikAdresi) g.degisiklikAdresi = g.kaynak === "hf" ? `https://huggingface.co/${g.repo}/commits/main` : g.sayfa || "";
      if (g.kaynak !== "hf" || g.baslik || !REPO_DESENI.test(String(g.repo || ""))) continue;
      try {
        const c = await A.guvenliJson(`https://huggingface.co/api/models/${g.repo}/commits/main`);
        if (Array.isArray(c) && c[0]) g.baslik = String(c[0].title || "").slice(0, 200);
      } catch (_) {}
    }
    A.jsonYaz(ONBELLEK, sonuc);
    return sonuc;
  }

  function denetimBaslat(zorla = false) {
    if (denetim.suruyor) return denetim.promise;
    const onceki = onbellekOku();
    if (!zorla && onceki && onceki.sonDenetim && simdi() - onceki.sonDenetim < GUN_MS) return Promise.resolve(onceki);
    // Elle "şimdi denetle" bile en çok 10 dakikada bir (istek sınırlarına saygı)
    if (zorla && simdi() - denetim.sonZorla < 10 * 60 * 1000 && onceki) return Promise.resolve(onceki);
    if (zorla) denetim.sonZorla = simdi();
    denetim.suruyor = true;
    denetim.promise = denetimYap().catch((err) => {
      log(`  [guncelleme] denetim başarısız: ${err.message || err}`);
      return null;
    }).finally(() => { denetim.suruyor = false; });
    return denetim.promise;
  }

  function guncellemeOzeti() {
    const o = onbellekOku();
    const t = tercihOku();
    const m = A.manifestOku();
    const sorulmayan = Object.keys(t.sorma).filter((k) => t.sorma[k]).length;
    if (!o || !Array.isArray(o.guncellemeler)) return { ok: true, denetleniyor: denetim.suruyor, guncellemeler: [], sonDenetim: 0, sorulmayan, mesgul: mesgulMu() };
    const guncellemeler = o.guncellemeler.filter((g) => {
      if (t.sorma[g.id]) return false; // "bir daha sorma"
      if (t.atlanan[g.id] && t.atlanan[g.id] === g.yeniSurum) return false;
      if (g.cesit === "pip" && t.pipUygulanan[g.paketAdi] && t.pipUygulanan[g.paketAdi].surum === g.yeniSurum) return false; // uygulandı
      if (g.cesit === "model" && m.modeller[g.id] && m.modeller[g.id].surum === g.yeniSurum) return false; // uygulandı
      if (g.cesit === "model" && !m.modeller[g.id]) return false; // model kaldırıldı
      if (g.cesit === "paket" && OZ && OZ.PAKETLER && OZ.PAKETLER[g.paket] && OZ.PAKETLER[g.paket].surum === g.yeniSurum) return false;
      return true;
    });
    return { ok: true, denetleniyor: denetim.suruyor, sonDenetim: o.sonDenetim, guncellemeler, sorulmayan, mesgul: mesgulMu() };
  }

  // --------------------------------------------------------------------------
  // Güncelleme uygulama
  // --------------------------------------------------------------------------
  async function modelGuncelle(g) {
    const m = A.manifestOku();
    const kayit = m.modeller[g.id];
    if (!kayit) throw new Error("Model kaydı bulunamadı");
    const klasor = A.hedefKlasor(kayit.klasor || kayit.tur);
    let dosyalar;
    let yeniSurum;
    if (kayit.kaynak === "github") {
      const surum = await A.ghSonSurum(kayit.repo);
      if (!surum) throw new Error("Sürüm bulunamadı");
      const secenek = A.ghSecenekleri(kayit.tur, surum, A.donanim()).find((s) => s.anahtar === kayit.anahtar);
      if (!secenek) throw new Error("Yeni sürümde aynı dosya yok");
      const onEk = `https://github.com/${kayit.repo}/releases/download/`;
      dosyalar = kayit.dosyalar.map((f) => {
        const y = secenek.dosyalar.find((x) => x.yol === f.yol);
        if (!y || !y.sha256 || !y.url.startsWith(onEk)) throw new Error(`${f.yol}: yeni sürümde doğrulanabilir dosya yok`);
        return { yol: f.yol, url: y.url, hedefKlasor: klasor, ad: f.ad, boyut: y.boyut, sha256: y.sha256, gitOid: "", gosterim: f.yol };
      });
      yeniSurum = String(surum.tag_name || "");
    } else {
      const detay = await A.hfDetay(kayit.repo, { taze: true });
      if (!SHA40.test(String(detay.sha || ""))) throw new Error("Commit kimliği alınamadı");
      const yeni = new Map(A.hfDosyalari(detay).map((f) => [f.yol, f]));
      dosyalar = kayit.dosyalar.map((f) => {
        const y = yeni.get(f.yol);
        if (!y) throw new Error(`${f.yol}: yeni sürümde yok`);
        if (A.guvenliAd(f.ad) !== f.ad) throw new Error("Geçersiz yerel dosya adı");
        return { yol: f.yol, url: A.hfUrl(kayit.repo, detay.sha, f.yol), hedefKlasor: klasor, ad: f.ad, boyut: y.boyut, sha256: y.sha256, gitOid: y.gitOid, gosterim: path.basename(f.yol) };
      });
      yeniSurum = detay.sha;
    }
    // Değişmeyen dosyalar yeniden indirilmez; değişenler geçici adla iner, doğrulanınca eskisinin yerine geçer
    const degisen = dosyalar.filter((f) => {
      const e = kayit.dosyalar.find((x) => x.yol === f.yol);
      return !e || !((e.sha256 && e.sha256 === f.sha256) || (e.gitOid && e.gitOid === f.gitOid));
    });
    if (degisen.length) await A.indirDogrulaYerlestir(kayit.tur, degisen, kayit.tur);
    const m2 = A.manifestOku();
    m2.modeller[g.id] = {
      ...kayit, surum: yeniSurum, oncekiSurum: kayit.surum, guncellendi: new Date(simdi()).toISOString(),
      dosyalar: dosyalar.map((f) => ({ yol: f.yol, ad: f.ad, boyut: f.boyut, sha256: f.sha256 || "", gitOid: f.gitOid || "" })),
    };
    A.manifestYaz(m2);
    return { id: g.id, surum: yeniSurum, indirilen: degisen.length };
  }

  function bagla(kaynak, hedef) {
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    try { fs.linkSync(kaynak, hedef); } catch (_) { fs.copyFileSync(kaynak, hedef); }
  }

  // Paket: yeni sürüm "<ad>.guncelleme-xxxx" klasöründe hazırlanır, tamamı doğrulanınca klasör yer değiştirir
  async function paketGuncelle(g) {
    const p = OZ && OZ.PAKETLER && OZ.PAKETLER[g.paket];
    if (!p) throw new Error("Paket bulunamadı");
    const r = await paketDenetle(g.paket, p); // taze yeniden denetim: kurallar bugünkü duruma göre uygulanır
    if (!r) return { id: g.id, guncel: true };
    if (r.elleInceleme || !r.otomatik) throw new Error(`${r.ad}: elle inceleme gerekiyor. ${r.neden}`);
    const fark = await paketFarki(p);
    if (!fark) return { id: g.id, guncel: true };
    const { detay, yeni, eskiMap } = fark;
    const kok = path.join(p.klasor, p.ad);
    const ek = crypto.randomBytes(3).toString("hex");
    const yeniKok = `${kok}.guncelleme-${ek}`;
    const oncekiKok = `${kok}.onceki-${ek}`;
    const is = A.aktifIs();
    try {
      fs.mkdirSync(yeniKok, { recursive: true });
      const indirilecek = [];
      const korunan = [];
      for (const f of yeni) {
        const hedef = path.join(yeniKok, ...f.yol.split("/"));
        const eskiYol = path.join(kok, ...f.yol.split("/"));
        if (!pathInside(hedef, yeniKok) || !pathInside(eskiYol, kok)) throw new Error("Geçersiz paket yolu: " + f.yol);
        const e = eskiMap.get(f.yol);
        if (e && ozet(e) === ozet(f) && fs.existsSync(eskiYol)) { korunan.push({ f, eskiYol, hedef }); continue; }
        fs.mkdirSync(path.dirname(hedef), { recursive: true });
        indirilecek.push({ yol: f.yol, url: A.hfUrl(p.repo, detay.sha, f.yol), hedefKlasor: path.dirname(hedef), ad: path.basename(hedef), boyut: f.boyut, sha256: f.sha256, gitOid: f.gitOid, gosterim: f.yol });
      }
      // Değişmeyen dosyalar: sabit bağlantı (aynı diskte yer kaplamaz) ya da kopya, sonra yeniden doğrulama
      for (let i = 0; i < korunan.length; i += 1) {
        const { f, eskiYol, hedef } = korunan[i];
        if (is) is.asama = `Mevcut dosyalar doğrulanıyor ${i + 1}/${korunan.length}: ${f.yol}`;
        bagla(eskiYol, hedef);
        if (f.boyut && fs.statSync(hedef).size !== f.boyut) throw new Error(`${f.yol}: mevcut dosyanın boyutu beklenenden farklı`);
        if (f.sha256 && (await A.dosyaSha256(hedef)) !== f.sha256) throw new Error(`${f.yol}: mevcut dosyanın özeti uyuşmuyor (dosya bozulmuş olabilir)`);
      }
      if (indirilecek.length) await A.indirDogrulaYerlestir("paket", indirilecek, "paket");
      fs.writeFileSync(path.join(yeniKok, ".download-complete"), new Date(simdi()).toISOString(), "utf8");
      // Yer değiştirme: önce eski klasör kenara, sonra yeni klasör yerine; ikinci adım başarısızsa geri al
      if (is) is.asama = "Yeni sürüm yerine konuyor";
      try { fs.renameSync(kok, oncekiKok); }
      catch (err) {
        if (/EBUSY|EPERM|EACCES/.test(String(err.code || err.message))) throw new Error("Model şu an kullanımda (açık bir dosyası var); ilgili sayfayı kapatıp ya da motoru durdurup tekrar deneyin. Önceki sürüm korundu.");
        throw err;
      }
      try { fs.renameSync(yeniKok, kok); }
      catch (err) { try { fs.renameSync(oncekiKok, kok); } catch (_) {} throw err; }
      try { fs.rmSync(oncekiKok, { recursive: true, force: true }); } catch (e) { log(`  [guncelleme] eski sürüm klasörü silinemedi (${oncekiKok}): ${e.message}`); }
    } catch (err) {
      try { fs.rmSync(yeniKok, { recursive: true, force: true }); } catch (_) {}
      throw err;
    }
    const m = A.manifestOku();
    m.paketler[g.paket] = { surum: detay.sha, kodSurumu: kodSurumu(p), oncekiSurum: p.surum, guncellendi: new Date(simdi()).toISOString() };
    A.manifestYaz(m);
    if (!p._kodSurumu) p._kodSurumu = p.surum;
    p.surum = detay.sha;
    return { id: g.id, surum: detay.sha };
  }

  function guncellemeBaslat(govde) {
    const ozetler = guncellemeOzeti();
    const hepsi = govde.hepsi === true;
    const istenen = new Set((Array.isArray(govde.idler) ? govde.idler : []).map(String));
    // "Tümünü güncelle" yalnızca otomatik (doğrulanabilir, kodsuz) model güncellemelerini alır; pip asla
    const secilen = ozetler.guncellemeler.filter((g) => (hepsi ? g.otomatik && !g.elleInceleme && g.cesit !== "pip" : istenen.has(g.id)));
    const ikinciOnay = govde.ikinciOnay === true && !hepsi;
    const onaysizPip = secilen.filter((g) => g.cesit === "pip" && !g.elleInceleme && !ikinciOnay);
    if (onaysizPip.length) {
      return { ok: false, ikinciOnayGerekli: true, idler: onaysizPip.map((g) => g.id), status: 409,
        error: "Python paketi güncellemesi test edilmeden önerilmez; ikinci bir onay gerekiyor." };
    }
    const reddedilen = secilen.filter((g) => g.elleInceleme || (!g.otomatik && !(g.cesit === "pip" && ikinciOnay)));
    const uygulanacak = secilen.filter((g) => !reddedilen.includes(g));
    if (!uygulanacak.length) return { ok: false, error: reddedilen.length ? "Seçilen güncellemeler elle inceleme gerektiriyor." : "Uygulanacak güncelleme yok.", reddedilen: reddedilen.map((g) => g.id), status: 400 };
    const r = A.isEkle({
      kimlik: `guncelle:${uygulanacak.map((g) => g.id).join(",")}`, tur: "guncelleme", ad: `${uygulanacak.length} model güncellemesi`,
      gorev: async () => {
        const sonuclar = [];
        for (const g of uygulanacak) {
          const is = A.aktifIs();
          if (is) is.ad = g.ad;
          try {
            const r = g.cesit === "paket" ? await paketGuncelle(g) : g.cesit === "pip" ? await pipGuncelle(g) : await modelGuncelle(g);
            sonuclar.push({ ...r, ad: g.ad, ok: true });
            gunluk(`${g.ad}: güncellendi${r && r.surum ? ` (${r.surum})` : ""}`);
          } catch (err) {
            sonuclar.push({ id: g.id, ad: g.ad, ok: false, hata: err.message || String(err) });
            gunluk(`${g.ad}: BAŞARISIZ — ${String(err.message || err).replace(/\s+/g, " ").slice(0, 600)}`);
          }
        }
        const basarisiz = sonuclar.filter((s) => !s.ok);
        if (basarisiz.length === sonuclar.length) throw new Error(basarisiz.map((s) => `${s.ad}: ${s.hata}`).join(" | "));
        return { sonuclar };
      },
    });
    return { ok: true, ...r, uygulanacak: uygulanacak.map((g) => g.id), reddedilen: reddedilen.map((g) => g.id) };
  }

  function surumuAtla(govde) {
    const id = String(govde.id || "").slice(0, 500);
    const surum = String(govde.surum || "").slice(0, 200);
    if (!id || !surum) throw Object.assign(new Error("id ve surum gerekli"), { status: 400 });
    const t = tercihOku();
    t.atlanan[id] = surum;
    tercihYaz(t);
    return { ok: true };
  }

  // "Bir daha sorma": bu öğe için hiçbir sürümde bildirim gösterilmez. { id, sorma:false } geri alır; { hepsi:true, sorma:false } hepsini
  function sormaAyarla(govde) {
    const t = tercihOku();
    if (govde.hepsi === true && govde.sorma === false) { t.sorma = {}; tercihYaz(t); return { ok: true }; }
    const id = String(govde.id || "").slice(0, 500);
    if (!id || !/^[A-Za-z0-9:._/@+-]+$/.test(id)) throw Object.assign(new Error("Geçersiz id"), { status: 400 });
    if (govde.sorma === false) delete t.sorma[id];
    else t.sorma[id] = new Date(simdi()).toISOString();
    tercihYaz(t);
    return { ok: true };
  }

  // --------------------------------------------------------------------------
  // HTTP uç noktaları: /api/guncelleme/*
  //   GET  /api/guncelleme/liste[?zorla=1]   bekleyen güncellemeler (zorla: günlük sınırı yok say, en çok 10 dk'da bir)
  //   POST /api/guncelleme/uygula { idler:[...] } | { hepsi:true }
  //   POST /api/guncelleme/atla   { id, surum }                 "bu sürümü atla"
  //   POST /api/guncelleme/sorma  { id, sorma? } | { hepsi:true, sorma:false }   "bir daha sorma" / geri al
  //   (pip öğeleri: /uygula { idler:["pip:<ad>"], ikinciOnay:true } — onaysız istek 409 ikinciOnayGerekli döner)
  //   İlerleme: GET /api/model-arama/durum (kurulum ile aynı iş kuyruğu)
  // --------------------------------------------------------------------------
  async function handle(req, res) {
    if (!req.url.startsWith("/api/guncelleme/")) return false;
    const u = new URL(req.url, "http://127.0.0.1");
    const yol = u.pathname;
    try {
      if (yol === "/api/guncelleme/liste" && req.method === "GET") {
        if (u.searchParams.get("zorla") === "1") denetimBaslat(true);
        json(res, 200, guncellemeOzeti());
        return true;
      }
      if (yol === "/api/guncelleme/uygula" && req.method === "POST") {
        const govde = await readJsonBody(req, res);
        if (!govde) return true;
        const r = guncellemeBaslat(govde);
        json(res, r.status || 200, r);
        return true;
      }
      if (yol === "/api/guncelleme/atla" && req.method === "POST") {
        const govde = await readJsonBody(req, res);
        if (!govde) return true;
        json(res, 200, surumuAtla(govde));
        return true;
      }
      if (yol === "/api/guncelleme/sorma" && req.method === "POST") {
        const govde = await readJsonBody(req, res);
        if (!govde) return true;
        json(res, 200, sormaAyarla(govde));
        return true;
      }
      json(res, 404, { ok: false, error: "Bilinmeyen uç nokta" });
      return true;
    } catch (err) {
      json(res, err.status || 500, { ok: false, error: err.message || String(err) });
      return true;
    }
  }

  paketSurumleriniUygula();
  if (ctx.otomatikDenetim !== false) {
    const zaman = setTimeout(() => { denetimBaslat(false); }, ctx.denetimGecikmesiMs ?? 60000);
    if (zaman.unref) zaman.unref();
  }

  return {
    handle, denetimBaslat, guncellemeOzeti, guncellemeBaslat, surumuAtla, sormaAyarla,
    _ic: { denetimYap, paketDenetle, ttsSabitlemeleri, pythonAgirliklariniOku, kaliptanDesen, pipDenetle, pipGuncelle, pypiJson, tercihOku },
  };
};
module.exports.pythonAgirliklariniOku = pythonAgirliklariniOku;
module.exports.pipSabitlemeleri = pipSabitlemeleri;
module.exports.surumKarsilastir = surumKarsilastir;

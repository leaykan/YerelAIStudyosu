// klon.cjs - OmniVoice ses klonlama: onay kaydı, klon ekleme/yeniden adlandırma/silme,
// sesli sohbetten isteğe bağlı örnek toplama ve "Vega benim sesimle yanıt versin" ayarı.
//
// İlkeler:
//  - Hiçbir klon, kullanıcı yasal uyarıyı okuyup "Bu ses bana ait" ya da "Ses sahibinin açık onayını aldım"
//    (+ ses sahibinin adı ve izin tarihi) kutusunu ve "Klon sesi yanıltıcı ya da izinsiz amaçlarla
//    kullanmayacağım" taahhüdünü işaretlemeden oluşturulamaz (sunucu da denetler). Onay, klonun yanına
//    <ad>.onay.json olarak yazılır; onay kaydı olmayan klonlar seslendirmede kullanılmaz.
//  - Ses kayıtları, metinler ve onay kayıtları yalnızca bu bilgisayarda (app/reference-voices) durur.
//    Bu modül ağa hiçbir şey göndermez.
//  - Sesli sohbet örnekleri yalnızca kullanıcı "Sesimi klonlama için kaydet"i açtıysa saklanır
//    (varsayılan KAPALI; açmak için de onay gerekir). Son 40 parça / 50 MB tutulur.
//
// Kullanım (serve.cjs):
//   const KLON = require("./klon.cjs")({ ROOT, json, readJsonBody, motorGunlugu, pathInside,
//     transcribeWavBuffer: (b, o) => runExclusiveSpeechOperation(() => transcribeWavBuffer(b, o)),
//     speechAyari: () => speechSettings, omnivoiceKurulu: () => ..., isciDurdur: () => ..., log,
//     // Sesli sohbette klon sesin ısıtılması (yoksa eski davranış: ısıtma yok):
//     omnivoiceKuruluDenetle: (yenile) => Promise<bool>,   // kurulum denetimi (önbellekli)
//     omnivoiceIsit: (referansYolu) => Promise<{cihaz, yuklemeSn}>, // modeli yükler + klon istemini hazırlar
//     omnivoiceDurumu: () => ({ calisiyor, hazir, yukleniyor }),
//     omnivoiceCanliTut: (ms) => void });                   // boşta kapanma süresini uzatır
//   if (req.url.startsWith("/api/klon/") && await KLON.handle(req, res)) return;
//
// Sesli sohbette klon ses (işlemcide yavaş):
//  - Model yükleme (ilk açılış, işlemcide dakikalar sürebilir) cümle süresinden AYRIDIR: anahtar açılınca ve
//    sesli sohbet açılınca model arka planda yüklenir ("yukleniyor"). Bu sırada gelen cümleler hemen
//    KLON_HAZIR_DEGIL (503) alır ve normal sesle okunur; model hazır olunca klon ses devreye girer.
//  - Hazırken cümle başına süre sınırı (varsayılan 90 sn) aşılırsa o cümle normal sesle okunur (504), çalışan
//    DURDURULMAZ (yüklenmiş model korunur); OmniVoice o cümleyi bitirene kadar sonraki cümleler KLON_MESGUL
//    (503) ile normal sese gider. Cümle çok uzun süre bitmezse (takılma) çalışan durdurulup yeniden yüklenir.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// Onay metni: istemci bunu sunucudan okur ve aynen gösterir; onay kaydına sürümü ve özeti yazılır.
// Metin değişirse ONAY_SURUMU artırılmalı (eski kayıtlar geçerli kalır, yeni onaylar yeni sürümle alınır).
const ONAY_SURUMU = "klon-onay-2";   // 2: sahiplik beyanı + ayrı kötüye kullanmama taahhüdü
const ONAY_BASLIK = "Ses klonlama: yasal uyarı";
const ONAY_MADDELERI = [
  "Bir sesi yalnızca sesin sahibi açıkça izin verdiyse klonlayın. Ses kişisel veridir (biyometrik veri de sayılabilir): izinsiz klonlamak Türkiye'de KVKK'ya ve kişilik haklarına (başka ülkelerde de benzer yasalara) aykırı olabilir ve suç oluşturabilir.",
  "Klon sesi kimseyi yanıltmak, birinin yerine geçmek (taklit), dolandırıcılık ya da karalama için kullanmayın. Klonla üretilen sesin tüm sorumluluğu kullanıcıya aittir.",
  "Ses kaydı, yazılı metni ve onay kaydı yalnızca bu bilgisayarda (app/reference-voices klasöründe) saklanır; hiçbir yere gönderilmez.",
  "Onay kaydı (ses sahibi, onay tarihi, bu uyarının sürümü) klon sesin yanına yazılır. Klonu sildiğinizde ses, metin ve onay kaydı birlikte silinir.",
];
const ONAY_BEYANLARI = { kendim: "Bu ses bana ait.", baskasi: "Ses sahibinin açık onayını aldım." };
const ONAY_TAAHHUDU = "Klon sesi yanıltıcı ya da izinsiz amaçlarla (taklit, dolandırıcılık, aldatma) kullanmayacağım.";
const ONAY_OZETI = crypto.createHash("sha256")
  .update([ONAY_SURUMU, ...ONAY_MADDELERI, ONAY_BEYANLARI.kendim, ONAY_BEYANLARI.baskasi, ONAY_TAAHHUDU].join("\n")).digest("hex").slice(0, 16);

const REF_AZAMI_SN = 30;          // OmniVoice çalışanının üst sınırı (tts_ahenk_omnivoice.py _REF_AZAMI_SN)
const REF_ASGARI_SN = 3;
const YUKLEME_AZAMI_BAYT = 8 * 1024 * 1024;   // istemci 24 kHz mono WAV gönderir (30 sn ≈ 1,4 MB)
const ORNEK_AZAMI_ADET = 40;
const ORNEK_AZAMI_BAYT = 50 * 1024 * 1024;
const ORNEK_PARCA_AZAMI_SN = 15;
const GECICI_OMUR_MS = 60 * 60 * 1000;
// Örneklerden üretilen referansın hedef uzunluğu: OmniVoice 3-10 sn öneriyor; referans kısaldıkça
// her cümlede işlenen dizi kısalır (işlemcide belirgin hızlanma). 8-12 sn ses benzerliği için yeterli.
const ORNEK_REF_HEDEF_SN = 10;
const ORNEK_REF_AZAMI_SN = 12.5;
const ORNEK_REF_ASGARI_SN = 6;
// Sesli sohbet klon seslendirmesi
const VARSAYILAN_ZAMAN_ASIMI_SN = 0;    // hazır modelle cümle başına (yükleme hariç); 0 = sınırsız (cümle klonla bitene kadar beklenir)
const TAKILMA_GUVENLIK_SN = 1800;       // sınırsızda bile takılan çalışan 30 dk sonra yeniden başlatılır
// 0 = sınırsız; aksi halde 30-900 sn
const zamanAsimiNorm = (v, alt = 30) => { const n = Math.round(Number(v)); if (n === 0) return 0; return Number.isFinite(n) ? Math.max(alt, Math.min(900, n)) : VARSAYILAN_ZAMAN_ASIMI_SN; };
const CPU_ADIM = 8;                     // OmniVoice num_step: her adım modelin tam bir ileri geçişi (süre adımla doğru orantılı)
const CANLI_TUT_MS = 4 * 60 * 1000;     // sesli sohbet açıkken her yoklamada çalışanın boşta kapanma süresi
const KAPANIS_CANLI_MS = 5 * 60 * 1000; // sesli sohbet kapanınca model bu kadar daha bellekte kalır
const SES_UZANTI = /\.(wav|flac|ogg)$/i;
const DOSYA_DESENI = /^[\w .()-]+\.(wav|flac|ogg)$/i;   // serve.cjs referansSesleri() ile aynı
const WINDOWS_AYRILMIS = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

// Whisper'ın sessizlikte uydurduğu tipik metinler (sesliSohbet.js ile aynı)
const HALUSINASYON = [
  /altyaz[ıi]/i, /izledi[gğ]iniz i[cç]in te[sş]ekk[uü]r/i, /abone ol/i, /beğenmeyi unutmay/i,
  /thanks? for watching/i, /subscribe/i, /^\s*[\[(][^\])]*[\])]\s*$/, /^[\s.…,!?-]*$/,
];

function hataOlustur(mesaj, kod = 400) {
  const e = new Error(mesaj);
  e.statusCode = kod;
  return e;
}

// ---------------------------------------------------------------------------
// WAV yardımcıları (bağımlılıksız). PCM 8/16/24/32 bit ve 32 bit kayan nokta okunur, mono'ya indirilir.
// ---------------------------------------------------------------------------
function wavCoz(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw hataOlustur("Ses WAV biçiminde değil.");
  }
  let o = 12, fmt = null, veri = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4);
    const boy = buf.readUInt32LE(o + 4);
    const bas = o + 8;
    const son = Math.min(buf.length, bas + boy);
    if (id === "fmt " && boy >= 16) {
      let bicim = buf.readUInt16LE(bas);
      if (bicim === 0xfffe && boy >= 26) bicim = buf.readUInt16LE(bas + 24); // WAVE_FORMAT_EXTENSIBLE alt biçimi
      fmt = { bicim, kanal: buf.readUInt16LE(bas + 2), hiz: buf.readUInt32LE(bas + 4), bit: buf.readUInt16LE(bas + 14) };
    } else if (id === "data") {
      veri = { bas, son };
      break;
    }
    o = bas + boy + (boy % 2);
  }
  if (!fmt || !veri) throw hataOlustur("WAV dosyası bozuk (fmt/data bölümü yok).");
  const { bicim, kanal, hiz, bit } = fmt;
  if (kanal < 1 || kanal > 8) throw hataOlustur("Desteklenmeyen kanal sayısı.");
  if (hiz < 8000 || hiz > 96000) throw hataOlustur("Desteklenmeyen örnekleme hızı.");
  const tamsayi = bicim === 1 && [8, 16, 24, 32].includes(bit);
  const kayan = bicim === 3 && bit === 32;
  if (!tamsayi && !kayan) throw hataOlustur("Desteklenmeyen WAV kodlaması (PCM ya da 32 bit kayan nokta olmalı).");
  const bayt = bit / 8;
  const kare = bayt * kanal;
  const adet = Math.floor((veri.son - veri.bas) / kare);
  const ornekler = new Float32Array(adet);
  for (let i = 0; i < adet; i++) {
    let t = 0;
    for (let k = 0; k < kanal; k++) {
      const p = veri.bas + i * kare + k * bayt;
      let v;
      if (kayan) v = buf.readFloatLE(p);
      else if (bit === 16) v = buf.readInt16LE(p) / 32768;
      else if (bit === 24) v = buf.readIntLE(p, 3) / 8388608;
      else if (bit === 32) v = buf.readInt32LE(p) / 2147483648;
      else v = (buf.readUInt8(p) - 128) / 128;
      t += Number.isFinite(v) ? v : 0;
    }
    ornekler[i] = t / kanal;
  }
  return { hiz, ornekler };
}

function wavKodla(ornekler, hiz) {
  const b = Buffer.alloc(44 + ornekler.length * 2);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + ornekler.length * 2, 4); b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(hiz, 24); b.writeUInt32LE(hiz * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(ornekler.length * 2, 40);
  for (let i = 0; i < ornekler.length; i++) {
    const v = Math.max(-1, Math.min(1, ornekler[i]));
    b.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2);
  }
  return b;
}

function yenidenOrnekle(girdi, kaynak, hedef) {
  if (kaynak === hedef) return girdi;
  const oran = kaynak / hedef;
  const uzunluk = Math.max(1, Math.round(girdi.length / oran));
  const cikti = new Float32Array(uzunluk);
  if (oran > 1) {
    // Küçültme: aralığın ortalaması (basit alçak geçiren)
    for (let i = 0; i < uzunluk; i++) {
      const bas = Math.floor(i * oran);
      const son = Math.min(girdi.length, Math.max(bas + 1, Math.floor((i + 1) * oran)));
      let t = 0;
      for (let k = bas; k < son; k++) t += girdi[k];
      cikti[i] = t / (son - bas);
    }
  } else {
    for (let i = 0; i < uzunluk; i++) {
      const x = i * oran;
      const a = Math.floor(x);
      const b = Math.min(girdi.length - 1, a + 1);
      const f = x - a;
      cikti[i] = (girdi[a] || 0) * (1 - f) + (girdi[b] || 0) * f;
    }
  }
  return cikti;
}

// 20 ms'lik çerçevelerin ses düzeyi; konuşma olan bölgenin sınırları ve basit bir kalite puanı
function sesCozumle(ornekler, hiz) {
  const cerceve = Math.max(1, Math.round(hiz * 0.02));
  const rmsler = [];
  let tepe = 0, kirpik = 0;
  for (let i = 0; i < ornekler.length; i += cerceve) {
    let t = 0;
    const son = Math.min(ornekler.length, i + cerceve);
    for (let k = i; k < son; k++) {
      const v = ornekler[k];
      t += v * v;
      const m = Math.abs(v);
      if (m > tepe) tepe = m;
      if (m >= 0.99) kirpik++;
    }
    rmsler.push(Math.sqrt(t / Math.max(1, son - i)));
  }
  const sirali = [...rmsler].sort((a, b) => a - b);
  const taban = Math.max(0.0005, sirali[Math.floor(sirali.length * 0.1)] || 0);
  const esik = Math.max(0.008, taban * 3);
  let ilk = -1, sonCerceve = -1, sesli = 0, sesliToplam = 0;
  rmsler.forEach((r, i) => {
    if (r > esik) { if (ilk < 0) ilk = i; sonCerceve = i; sesli++; sesliToplam += r; }
  });
  const sesliRms = sesli ? sesliToplam / sesli : 0;
  return {
    cerceve, ilk, son: sonCerceve, tepe,
    sesliSn: (sesli * cerceve) / hiz,
    snr: sesliRms / taban,
    kirpikOrani: kirpik / Math.max(1, ornekler.length),
    sesliRms,
  };
}

// Baştaki/sondaki sessizliği kırpar (0,15 sn pay bırakır)
function sessizligiKirp(ornekler, hiz, analiz = sesCozumle(ornekler, hiz)) {
  if (analiz.ilk < 0) return ornekler.subarray(0, 0);
  const pay = Math.round(hiz * 0.15);
  const bas = Math.max(0, analiz.ilk * analiz.cerceve - pay);
  const son = Math.min(ornekler.length, (analiz.son + 1) * analiz.cerceve + pay);
  return ornekler.subarray(bas, son);
}

// Tepe değeri -1 dBFS'e yakın olacak kadar yükseltir/indirir (en çok 4 kat yükseltme)
function seviyele(ornekler) {
  let tepe = 0;
  for (let i = 0; i < ornekler.length; i++) tepe = Math.max(tepe, Math.abs(ornekler[i]));
  if (tepe < 1e-4) return ornekler;
  const kazanc = Math.min(4, 0.89 / tepe);
  if (Math.abs(kazanc - 1) < 0.05) return ornekler;
  const c = new Float32Array(ornekler.length);
  for (let i = 0; i < ornekler.length; i++) c[i] = ornekler[i] * kazanc;
  return c;
}

function halusinasyonMu(metin) {
  const s = String(metin || "").trim();
  if (s.length < 2) return true;
  return HALUSINASYON.some((r) => r.test(s));
}

function metniTemizle(metin, azami = 1000) {
  return String(metin || "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, azami);
}

// Görünen ad: harf, rakam, boşluk ve - _ . ' ( ) ; 1-60 karakter
function adDogrula(ad) {
  const s = metniTemizle(ad, 200);
  if (!s) throw hataOlustur("Klon sese bir ad verin.");
  if (s.length > 60) throw hataOlustur("Ad en fazla 60 karakter olabilir.");
  if (!/^[\p{L}\p{N} ._'()-]+$/u.test(s)) throw hataOlustur("Adda yalnızca harf, rakam, boşluk ve - _ . ' ( ) kullanılabilir.");
  return s;
}

// Görünen addan güvenli dosya adı (ASCII; serve.cjs'in klon listesi /^[\w .()-]+$/ bekler)
function guvenliTaban(ad) {
  const tr = { ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U", â: "a", Â: "A", î: "i", Î: "I", û: "u", Û: "U" };
  let s = String(ad || "").replace(/[çÇğĞıİöÖşŞüÜâÂîÎûÛ]/g, (h) => tr[h] || h);
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[^A-Za-z0-9 ._()-]/g, "_").replace(/_+/g, "_").replace(/\s+/g, " ").trim();
  s = s.replace(/^[._\s-]+/, "").replace(/[.\s]+$/, "").slice(0, 50).trim();
  if (!s) s = "klon";
  if (WINDOWS_AYRILMIS.test(s)) s += "_ses";
  return s;
}

module.exports = function klonAltyapisi(ctx) {
  const { ROOT, json, readJsonBody, pathInside } = ctx;
  const log = ctx.log || ((...a) => console.log(...a));
  const gunluk = (s) => { try { ctx.motorGunlugu && ctx.motorGunlugu(`[klon] ${s}`); } catch (_) {} };

  const REF = path.join(ROOT, "app", "reference-voices");
  const ORNEKLER = path.join(REF, "_ornekler");
  // -- Kullanıcıya özel klon sesleri ---------------------------------------------
  // Ses biyometrik veridir: her klon (ve sesli sohbetten toplanan örnekler, klon ayarları) onu ekleyen kullanıcıya
  // aittir. Başka kullanıcı listeleyemez, dinleyemez, düzenleyemez, silemez, Vega'nın sesi olarak seçemez.
  // Sahibi kaydedilmemiş eski sesler yalnızca yöneticiye görünür.
  const kim = () => { try { return (typeof ctx.aktifKullanici === "function" && ctx.aktifKullanici()) || {}; } catch (_) { return {}; } };
  const kurulumVar = () => { try { return typeof ctx.kurulumVar === "function" && !!ctx.kurulumVar(); } catch (_) { return false; } };
  function sahibiMi(dosya) {
    if (!kurulumVar()) return true;
    const k = kim();
    if (!k.id) return false;
    const o = onayOku(String(dosya || ""));
    return o && o.sahip ? o.sahip === k.id : !!k.yonetici;
  }
  // -- Ses kayıtları diskte şifreli -------------------------------------------------
  // Klon referansları, sesli sohbet örnekleri ve geçici yüklemeler sahibinin (giriş yapan kullanıcının) şifreden türetilen
  // anahtarıyla şifrelenir: USB/disk ele geçirilse de ses alınamaz. Ses motoru açık WAV okuduğu için kullanım anında
  // BU BİLGİSAYARIN geçici klasörüne (taşınabilir diske değil) açık kopya yazılır; çıkışta, kapanışta ve açılışta silinir.
  const SES_ISARETI = Buffer.from("YASK1");
  const ACIK = path.join(require("os").tmpdir(), "yerel-ai-klon");
  try { fs.rmSync(ACIK, { recursive: true, force: true }); } catch (_) {}
  try { fs.mkdirSync(ACIK, { recursive: true }); } catch (_) {}
  process.on("exit", () => { try { fs.rmSync(ACIK, { recursive: true, force: true }); } catch (_) {} });
  const sesSifreliMi = (b) => Buffer.isBuffer(b) && b.length > 33 && b.subarray(0, 5).equals(SES_ISARETI);
  const sifrelemeVar = () => kurulumVar() && typeof ctx.ikiliSifrele === "function";
  function sesYaz(tam, buf, sahip) {
    const icerik = sifrelemeVar() && sahip ? Buffer.concat([SES_ISARETI, ctx.ikiliSifrele(sahip, buf)]) : buf;
    const tmp = tam + ".tmp";
    fs.writeFileSync(tmp, icerik);
    fs.renameSync(tmp, tam);
  }
  function sesOku(tam, sahip) {
    const b = fs.readFileSync(tam);
    if (!sesSifreliMi(b)) return b;
    const o = sahip ? null : onayOku(path.basename(tam));
    const id = sahip || (o && o.sahip) || kim().id;
    if (!id) throw hataOlustur("Ses kaydının sahibi bulunamadı.", 403);
    return ctx.ikiliCoz(id, b.subarray(5));
  }
  const acikOnek = (sahip, dosya) => `${String(sahip || "genel").replace(/[^a-z0-9]/gi, "")}-${tabanAdi(dosya).replace(/[^\w.-]/g, "_")}`;
  // Ses motoru için açık kopya (yalnızca sahibi giriş yapmışken açılabilir)
  function motorYolu(dosya, { denetle = true } = {}) {
    const d = path.basename(String(dosya || ""));
    const tam = denetle ? dosyaDogrula(d) : path.join(REF, d);
    const o = onayOku(d);
    const sahip = (o && o.sahip) || "";
    const hedef = path.join(ACIK, acikOnek(sahip, d) + path.extname(d).toLowerCase());
    if (!fs.existsSync(hedef)) {
      fs.mkdirSync(ACIK, { recursive: true });
      fs.writeFileSync(hedef, sesOku(tam, sahip || undefined));
      const m = metinOku(d);
      if (m) fs.writeFileSync(hedef.replace(/\.[^.]+$/, ".txt"), m + "\n", "utf8");
    }
    return hedef;
  }
  function acikTemizle({ sahip, dosya } = {}) {
    let liste = [];
    try { liste = fs.readdirSync(ACIK); } catch (_) { return; }
    const onek = dosya ? acikOnek(sahip, dosya) + "." : sahip ? String(sahip).replace(/[^a-z0-9]/gi, "") + "-" : "";
    for (const f of liste) if (!onek || f.startsWith(onek)) { try { fs.unlinkSync(path.join(ACIK, f)); } catch (_) {} }
  }
  // Eski (açık) kayıt: sahibi giriş yapmışken şifrelenir; sahipsiz eski kayıt yöneticiye geçer
  function sesiKoru(d) {
    if (!sifrelemeVar()) return;
    const k = kim();
    if (!k.id) return;
    const tam = path.join(REF, d);
    const o = onayOku(d);
    if (!o) return;
    if (!o.sahip && k.yonetici) { o.sahip = k.id; fs.writeFileSync(onayYolu(d), JSON.stringify(o, null, 2), "utf8"); }
    if (o.sahip !== k.id) return;
    try {
      const b = fs.readFileSync(tam);
      if (sesSifreliMi(b)) return;
      if (!o.sureSn) { const sn = wavSuresi(tam); if (sn) { o.sureSn = sn; fs.writeFileSync(onayYolu(d), JSON.stringify(o, null, 2), "utf8"); } }
      sesYaz(tam, b, k.id);
      gunluk(`klon kaydı şifrelendi: ${d}`);
    } catch (err) { gunluk(`klon kaydı şifrelenemedi: ${err.message}`); }
  }
  let eskiOrneklerTasindi = false;
  function ornekKlasoru() {
    const k = kim();
    if (!kurulumVar() || !k.id) return ORNEKLER;
    const d = path.join(ORNEKLER, String(k.id).replace(/[^a-z0-9]/gi, ""));
    // Kullanıcı girişinden önce toplanmış örnekler ilk yöneticiye taşınır
    if (k.yonetici && !eskiOrneklerTasindi) {
      eskiOrneklerTasindi = true;
      try {
        const eski = fs.readdirSync(ORNEKLER).filter((f) => /^\d{13}-[a-f0-9]{6}\.(wav|json)$/.test(f));
        if (eski.length) { fs.mkdirSync(d, { recursive: true }); for (const f of eski) { try { fs.renameSync(path.join(ORNEKLER, f), path.join(d, f)); } catch (_) {} } }
      } catch (_) {}
    }
    return d;
  }
  const GECICI = path.join(REF, "_gecici");
  const AYAR_DOSYASI = path.join(ROOT, "app", "config", "klon-ayarlari.json");
  for (const k of [REF, path.dirname(AYAR_DOSYASI)]) { try { fs.mkdirSync(k, { recursive: true }); } catch (_) {} }

  // -- Ayarlar ---------------------------------------------------------------
  const VARSAYILAN = { ornekTopla: false, ornekOnay: null, vegaKlonSesi: false, vegaKlonDosyasi: "", zamanAsimiSn: VARSAYILAN_ZAMAN_ASIMI_SN, zamanAsimiSurum: 3, olcum: null };
  const KISISEL = ["ornekTopla", "ornekOnay", "vegaKlonSesi", "vegaKlonDosyasi"];
  function ayarlariOku() {
    try {
      const v = JSON.parse(fs.readFileSync(AYAR_DOSYASI, "utf8"));
      const a = { ...VARSAYILAN, ...(v && typeof v === "object" ? v : {}) };
      // Kullanıcı varsa kişisel alanlar o kullanıcının kaydından gelir (eski genel değerler yalnızca yöneticiye)
      const k = kim();
      if (kurulumVar()) {
        const kendi = k.id && v && v.kullanicilar && v.kullanicilar[k.id];
        for (const alan of KISISEL) a[alan] = kendi ? (kendi[alan] ?? VARSAYILAN[alan]) : (k.yonetici ? a[alan] : VARSAYILAN[alan]);
      }
      delete a.kullanicilar;
      // Eski sürümde süre sınırı model yüklemesini de kapsıyordu (varsayılan 180 sn). Artık yükleme ayrı
      // sayıldığı için kullanıcının değiştirmediği eski varsayılan yeni varsayılana (90 sn) çekilir.
      if (!(v && v.zamanAsimiSurum >= 2) && Number(a.zamanAsimiSn) === 180) a.zamanAsimiSn = VARSAYILAN_ZAMAN_ASIMI_SN;
      // Sürüm 3: varsayılan artık sınırsız; eski varsayılanlar (90/180 sn) sınırsıza çekilir
      if (!(v && v.zamanAsimiSurum >= 3) && [90, 180].includes(Number(a.zamanAsimiSn))) a.zamanAsimiSn = VARSAYILAN_ZAMAN_ASIMI_SN;
      return a;
    } catch (_) { return { ...VARSAYILAN }; }
  }
  function ayarlariYaz(v) {
    const tmp = AYAR_DOSYASI + ".tmp";
    let disk = {};
    try { disk = JSON.parse(fs.readFileSync(AYAR_DOSYASI, "utf8")) || {}; } catch (_) {}
    const k = kim();
    if (kurulumVar()) {
      if (!k.id) throw hataOlustur("Giriş yapmanız gerekiyor.", 401);
      const kisisel = {}; for (const alan of KISISEL) kisisel[alan] = v[alan];
      const genel = { ...v }; for (const alan of KISISEL) genel[alan] = disk[alan] ?? VARSAYILAN[alan];
      v = { ...genel, kullanicilar: { ...(disk.kullanicilar || {}), [k.id]: kisisel } };
    } else if (disk.kullanicilar) v = { ...v, kullanicilar: disk.kullanicilar };
    fs.writeFileSync(tmp, JSON.stringify({ ...v, zamanAsimiSurum: 3 }, null, 2), "utf8");
    fs.renameSync(tmp, AYAR_DOSYASI);
  }
  function ayarOzeti(a = ayarlariOku()) {
    const vegaGecerli = a.vegaKlonSesi && dosyaGecerliMi(a.vegaKlonDosyasi) && onayliMi(a.vegaKlonDosyasi) && sahibiMi(a.vegaKlonDosyasi);
    const o = a.olcum && typeof a.olcum === "object" ? a.olcum : {};
    const sayi = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x) * 10) / 10 : null);
    return {
      ornekTopla: !!a.ornekTopla,
      vegaKlonSesi: !!vegaGecerli,
      vegaKlonDosyasi: vegaGecerli ? a.vegaKlonDosyasi : (dosyaGecerliMi(a.vegaKlonDosyasi) ? a.vegaKlonDosyasi : ""),
      vegaSesKimligi: vegaGecerli ? `omnivoice:klon_${a.vegaKlonDosyasi}` : "",
      zamanAsimiSn: zamanAsimiNorm(a.zamanAsimiSn),
      // Bu bilgisayarda ölçülen son süreler (arayüz dürüst tahmin göstersin diye)
      olcum: { yuklemeSn: sayi(o.yuklemeSn), cumleSn: sayi(o.cumleSn), cihaz: typeof o.cihaz === "string" ? o.cihaz.slice(0, 10) : "" },
    };
  }
  function olcumKaydet(degisiklik) {
    try {
      const a = ayarlariOku();
      ayarlariYaz({ ...a, olcum: { ...(a.olcum && typeof a.olcum === "object" ? a.olcum : {}), ...degisiklik } });
    } catch (_) {}
  }
  function sinirla(v, alt, ust, varsayilan) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(alt, Math.min(ust, n)) : varsayilan;
  }

  // -- Onay ------------------------------------------------------------------
  function onayMetni() {
    return { surum: ONAY_SURUMU, baslik: ONAY_BASLIK, maddeler: ONAY_MADDELERI, beyanlar: ONAY_BEYANLARI, taahhut: ONAY_TAAHHUDU, ozet: ONAY_OZETI };
  }

  // İstemciden gelen onayı doğrular ve diske yazılacak kaydı üretir. sadeceKendim: örnek toplama / "Benim sesim"
  function onayKaydiUret(onay, { kaynak, sadeceKendim = false } = {}) {
    if (!onay || typeof onay !== "object") throw hataOlustur("Ses klonlama için yasal uyarıyı onaylamanız gerekir.", 403);
    if (onay.kabul !== true) throw hataOlustur("Onay kutusu işaretlenmeden klon oluşturulamaz.", 403);
    if (onay.surum !== ONAY_SURUMU) throw hataOlustur("Onay metni güncellendi; lütfen uyarıyı yeniden okuyup onaylayın.", 409);
    const sesSahibi = onay.sesSahibi === "baskasi" ? "baskasi" : onay.sesSahibi === "kendim" ? "kendim" : "";
    if (!sesSahibi) throw hataOlustur("Sesin kime ait olduğunu seçin.", 400);
    if (metniTemizle(onay.beyan, 300) !== ONAY_BEYANLARI[sesSahibi]) throw hataOlustur("Sahiplik beyanı eksik ya da değiştirilmiş.", 403);
    if (metniTemizle(onay.taahhut, 300) !== ONAY_TAAHHUDU) throw hataOlustur("Klon sesi yanıltıcı ya da izinsiz amaçlarla kullanmayacağınızı onaylamanız gerekir.", 403);
    if (sadeceKendim && sesSahibi !== "kendim") throw hataOlustur("Sesli sohbet örnekleri yalnızca sizin kendi sesiniz için toplanabilir.", 400);
    let sesSahibiAdi = "", izinTarihi = "";
    if (sesSahibi === "baskasi") {
      sesSahibiAdi = metniTemizle(onay.sesSahibiAdi, 120);
      if (sesSahibiAdi.length < 2) throw hataOlustur("Ses başka birine aitse ses sahibinin adını yazın.", 400);
      izinTarihi = String(onay.izinTarihi || "").trim();
      const t = /^\d{4}-\d{2}-\d{2}$/.test(izinTarihi) ? new Date(izinTarihi + "T00:00:00Z") : null;
      if (!t || Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== izinTarihi) throw hataOlustur("Ses sahibinin izin verdiği tarihi girin.", 400);
      if (t.getTime() > Date.now() + 36 * 3600 * 1000) throw hataOlustur("İzin tarihi gelecekte olamaz.", 400);
      if (t.getUTCFullYear() < 1990) throw hataOlustur("İzin tarihi geçersiz.", 400);
    }
    const onaylayan = metniTemizle(onay.onaylayan, 120);
    let bilgisayarKullanicisi = "";
    try { bilgisayarKullanicisi = os.userInfo().username || ""; } catch (_) {}
    return {
      surum: ONAY_SURUMU,
      metinOzeti: ONAY_OZETI,
      beyan: ONAY_BEYANLARI[sesSahibi],
      taahhut: ONAY_TAAHHUDU,
      kabul: true,
      sesSahibi,
      sesSahibiAdi,
      izinTarihi,
      izniVeren: sesSahibi === "kendim" ? "Ses sahibi (kullanıcının kendisi)" : sesSahibiAdi,
      onaylayan,
      bilgisayarKullanicisi,
      tarih: new Date().toISOString(),
      kaynak: kaynak || "yukleme",
      not: "Bu kayıt yalnızca bu bilgisayarda tutulur.",
    };
  }

  // -- Dosya adları ------------------------------------------------------------
  function dosyaGecerliMi(dosya) {
    const d = String(dosya || "");
    return !!d && d === path.basename(d) && DOSYA_DESENI.test(d) && !/^[._]/.test(d) && pathInside(path.join(REF, d), REF);
  }
  function dosyaDogrula(dosya) {
    const d = String(dosya || "");
    if (!dosyaGecerliMi(d)) throw hataOlustur("Geçersiz klon dosyası.");
    const tam = path.join(REF, d);
    if (!fs.existsSync(tam) || !fs.statSync(tam).isFile()) throw hataOlustur("Klon ses bulunamadı.", 404);
    if (!sahibiMi(d)) throw hataOlustur("Bu klon ses size ait değil.", 403);
    return tam;
  }
  const tabanAdi = (d) => d.replace(SES_UZANTI, "");
  const onayYolu = (d) => path.join(REF, tabanAdi(d) + ".onay.json");
  const metinYollari = (d) => [path.join(REF, tabanAdi(d) + ".txt"), path.join(REF, d + ".txt")];

  function onayOku(d) {
    try {
      const v = JSON.parse(fs.readFileSync(onayYolu(d), "utf8"));
      return v && typeof v === "object" ? v : null;
    } catch (_) { return null; }
  }
  function onayliMi(dosya) {
    if (!dosyaGecerliMi(dosya)) return false;
    const o = onayOku(dosya);
    return !!(o && o.kabul === true && /^klon-onay-/.test(String(o.surum || "")));
  }
  function gorunenAd(dosya) {
    const o = dosyaGecerliMi(dosya) ? onayOku(dosya) : null;
    const ad = o && typeof o.ad === "string" ? metniTemizle(o.ad, 60) : "";
    return ad || tabanAdi(String(dosya || ""));
  }
  function metinOku(d) {
    for (const p of metinYollari(d)) {
      try { const m = fs.readFileSync(p, "utf8").trim(); if (m) return m; } catch (_) {}
    }
    return "";
  }
  // Aynı görünen adla ikinci klon olmasın (seçicilerde ayırt edilemez)
  function adCakisiyorMu(ad, haric = "") {
    const k = ad.toLocaleLowerCase("tr");
    let dosyalar = [];
    try { dosyalar = fs.readdirSync(REF).filter((f) => DOSYA_DESENI.test(f) && !/^[._]/.test(f) && f !== haric); } catch (_) {}
    return dosyalar.some((f) => gorunenAd(f).toLocaleLowerCase("tr") === k);
  }

  function adCakismasi(ad) {
    const e = hataOlustur(`"${ad}" adında bir klon ses zaten var. Başka bir ad verin.`, 409);
    e.code = "AD_CAKISMASI";
    return e;
  }

  function bosTabanBul(ad, haric = "") {
    const taban = guvenliTaban(ad);
    for (let i = 1; i < 1000; i++) {
      const aday = i === 1 ? taban : `${taban} (${i})`;
      const cakisma = [".wav", ".flac", ".ogg", ".txt", ".onay.json"].some((u) => fs.existsSync(path.join(REF, aday + u)));
      if (!cakisma || aday + ".wav" === haric) return aday;
    }
    throw hataOlustur("Uygun bir dosya adı bulunamadı.");
  }

  function wavSuresi(tam) {
    try {
      const fd = fs.openSync(tam, "r");
      try {
        const b = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 4096));
        fs.readSync(fd, b, 0, b.length, 0);
        if (b.toString("ascii", 0, 4) !== "RIFF") return null;
        let o = 12, hizBayt = 0;
        while (o + 8 <= b.length) {
          const id = b.toString("ascii", o, o + 4);
          const boy = b.readUInt32LE(o + 4);
          if (id === "fmt ") hizBayt = b.readUInt32LE(o + 16);
          if (id === "data") return hizBayt ? Math.round((boy / hizBayt) * 10) / 10 : null;
          o += 8 + boy + (boy % 2);
        }
      } finally { fs.closeSync(fd); }
    } catch (_) {}
    return null;
  }

  function klonListesi() {
    let dosyalar = [];
    try { dosyalar = fs.readdirSync(REF).filter((f) => DOSYA_DESENI.test(f) && !/^[._]/.test(f)); } catch (_) {}
    const klonlar = [], onaysiz = [];
    for (const d of dosyalar) {
      const tam = path.join(REF, d);
      let st;
      try { st = fs.statSync(tam); if (!st.isFile()) continue; } catch (_) { continue; }
      if (!sahibiMi(d)) continue;
      sesiKoru(d);
      const o = onayOku(d);
      const kayit = {
        dosya: d,
        sesKimligi: `omnivoice:klon_${d}`,
        ad: gorunenAd(d),
        metin: metinOku(d),
        sure: /\.wav$/i.test(d) ? (wavSuresi(tam) ?? (o && o.sureSn) ?? null) : null,
        boyut: st.size,
        olusturma: (o && o.tarih) || st.mtime.toISOString(),
      };
      if (onayliMi(d)) {
        kayit.onay = { sesSahibi: o.sesSahibi, sesSahibiAdi: o.sesSahibiAdi || "", izinTarihi: o.izinTarihi || "", tarih: o.tarih, surum: o.surum, kaynak: o.kaynak || "" };
        klonlar.push(kayit);
      } else onaysiz.push(kayit);
    }
    const sirala = (a, b) => String(b.olusturma).localeCompare(String(a.olusturma));
    return { klonlar: klonlar.sort(sirala), onaysiz: onaysiz.sort(sirala) };
  }

  // -- Geçici yüklemeler ---------------------------------------------------------
  function geciciTemizle() {
    try {
      const simdi = Date.now();
      for (const f of fs.readdirSync(GECICI)) {
        const p = path.join(GECICI, f);
        try { if (simdi - fs.statSync(p).mtimeMs > GECICI_OMUR_MS) fs.unlinkSync(p); } catch (_) {}
      }
    } catch (_) {}
  }
  function geciciYolu(belirtec) {
    const b = String(belirtec || "");
    if (!/^[a-f0-9]{24}$/.test(b)) throw hataOlustur("Geçersiz yükleme belirteci.");
    return { wav: path.join(GECICI, b + ".wav"), bilgi: path.join(GECICI, b + ".json") };
  }
  function geciciKaydet(wavBuf, bilgi) {
    fs.mkdirSync(GECICI, { recursive: true });
    geciciTemizle();
    const belirtec = crypto.randomBytes(12).toString("hex");
    const y = geciciYolu(belirtec);
    sesYaz(y.wav, wavBuf, kim().id);
    fs.writeFileSync(y.bilgi, JSON.stringify(bilgi), "utf8");
    return belirtec;
  }

  // Yazıya dökme: etkin konuşma modeli, 16 kHz mono WAV. Hata olursa boş metin + uyarı döner (kullanıcı kendisi yazar).
  async function yaziyaDok(ornekler, hiz, dil) {
    if (typeof ctx.transcribeWavBuffer !== "function") return { metin: "", uyari: "Konuşma tanıma kullanılamıyor; metni kendiniz yazın." };
    let model;
    try {
      const ayarOku = ctx.speechAyari || ctx.getSpeechSettings;
      model = (typeof ayarOku === "function" && (ayarOku() || {}).model) || undefined;
    } catch (_) {}
    if (!model) {
      try { model = JSON.parse(fs.readFileSync(path.join(ROOT, "app", "etkin-modeller.json"), "utf8")).konusma || undefined; } catch (_) {}
    }
    try {
      const wav16 = wavKodla(yenidenOrnekle(ornekler, hiz, 16000), 16000);
      const r = await ctx.transcribeWavBuffer(wav16, { model, language: dil, filename: "klon-referans.wav", gecici: true });
      const metin = metniTemizle(r && r.text);
      if (!metin || halusinasyonMu(metin)) return { metin: "", uyari: "Konuşma tanıma bu kayıttan metin çıkaramadı; söylenenleri kendiniz yazın." };
      return { metin };
    } catch (err) {
      return { metin: "", uyari: `Konuşma tanıma başarısız (${String(err.message || err).slice(0, 200)}). Söylenenleri kendiniz yazın.` };
    }
  }

  // Yüklenen sesi referansa çevirir: mono, ≤24 kHz, sessizlik kırpılmış, ≤30 sn, seviyelenmiş
  function referansHazirla(buf) {
    const { hiz, ornekler } = wavCoz(buf);
    const hedefHiz = hiz > 24000 ? 24000 : hiz;
    let s = yenidenOrnekle(ornekler, hiz, hedefHiz);
    const analiz = sesCozumle(s, hedefHiz);
    s = sessizligiKirp(s, hedefHiz, analiz);
    if (s.length > REF_AZAMI_SN * hedefHiz) s = s.subarray(0, REF_AZAMI_SN * hedefHiz);
    const sure = s.length / hedefHiz;
    if (sure < REF_ASGARI_SN) throw hataOlustur(`Kayıtta yeterince konuşma yok (${sure.toFixed(1)} sn). En az ${REF_ASGARI_SN} sn net konuşma gerekir; 10-20 sn önerilir.`);
    const son = sesCozumle(s, hedefHiz);
    const uyarilar = [];
    if (son.kirpikOrani > 0.001) uyarilar.push("Kayıtta patlama/kırpılma var; klon sesi bozuk çıkabilir.");
    if (son.snr < 4) uyarilar.push("Arka plan gürültüsü yüksek; daha sessiz bir kayıt daha iyi sonuç verir.");
    if (son.sesliSn < sure * 0.4) uyarilar.push("Kayıtta uzun sessizlikler var.");
    s = seviyele(s);
    return { hiz: hedefHiz, ornekler: s, sure: Math.round(sure * 10) / 10, uyarilar };
  }

  // -- Sesli sohbet örnekleri ----------------------------------------------------
  function ornekleriListele() {
    let ad = [];
    try { ad = fs.readdirSync(ornekKlasoru()).filter((f) => /^\d{13}-[a-f0-9]{6}\.wav$/.test(f)).sort(); } catch (_) {}
    return ad.map((f) => {
      const tam = path.join(ornekKlasoru(), f);
      // Eski açık örnek: giriş yapan sahibin anahtarıyla şifrelenir
      try { if (sifrelemeVar() && kim().id) { const b = fs.readFileSync(tam); if (!sesSifreliMi(b)) sesYaz(tam, b, kim().id); } } catch (_) {}
      let boyut = 0, bilgi = {};
      try { boyut = fs.statSync(tam).size; } catch (_) {}
      try { bilgi = JSON.parse(fs.readFileSync(tam.replace(/\.wav$/, ".json"), "utf8")) || {}; } catch (_) {}
      return { dosya: f, tam, boyut, ...bilgi };
    });
  }
  function ornekleriBuda() {
    const l = ornekleriListele();
    let toplam = l.reduce((s, o) => s + o.boyut, 0);
    let fazla = Math.max(0, l.length - ORNEK_AZAMI_ADET);
    for (const o of l) {
      if (fazla <= 0 && toplam <= ORNEK_AZAMI_BAYT) break;
      try { fs.unlinkSync(o.tam); } catch (_) {}
      try { fs.unlinkSync(o.tam.replace(/\.wav$/, ".json")); } catch (_) {}
      toplam -= o.boyut; fazla--;
    }
  }
  function ornekOzeti() {
    const l = ornekleriListele();
    return {
      adet: l.length,
      boyut: l.reduce((s, o) => s + o.boyut, 0),
      toplamSn: Math.round(l.reduce((s, o) => s + (Number(o.sure) || 0), 0)),
      uygunSn: Math.round(l.filter((o) => o.uygun).reduce((s, o) => s + (Number(o.kirpikSn) || 0), 0)),
      azamiAdet: ORNEK_AZAMI_ADET,
      azamiMb: ORNEK_AZAMI_BAYT / (1024 * 1024),
    };
  }
  function ornekleriSil() {
    let silinen = 0;
    try {
      for (const f of fs.readdirSync(ornekKlasoru())) {
        if (!/^\d{13}-[a-f0-9]{6}\.(wav|json)$/.test(f)) continue;
        try { fs.unlinkSync(path.join(ornekKlasoru(), f)); if (f.endsWith(".wav")) silinen++; } catch (_) {}
      }
    } catch (_) {}
    try { fs.rmdirSync(ornekKlasoru()); } catch (_) {}
    return silinen;
  }

  // serve.cjs'in /api/speech/transcribe rotası sesli sohbet parçası yazıya döküldükten sonra çağırır.
  // Ayar kapalıysa hiçbir şey yapmaz. Hata fırlatmaz (sohbeti asla etkilemez).
  function ornekKaydet(buf, metin) {
    try {
      const a = ayarlariOku();
      if (!a.ornekTopla || !a.ornekOnay) return false;
      const temiz = metniTemizle(metin, 600);
      if (!temiz || halusinasyonMu(temiz)) return false;
      if (!Buffer.isBuffer(buf) || buf.length > 4 * 1024 * 1024) return false;
      const { hiz, ornekler } = wavCoz(buf);
      const sure = ornekler.length / hiz;
      if (sure < 0.8 || sure > ORNEK_PARCA_AZAMI_SN) return false;
      const analiz = sesCozumle(ornekler, hiz);
      const kirpik = sessizligiKirp(ornekler, hiz, analiz);
      const kirpikSn = kirpik.length / hiz;
      const kps = temiz.length / Math.max(0.5, kirpikSn);    // saniyede karakter: uydurma metni ayıklar
      const uygun = kirpikSn >= 3 && kirpikSn <= 12 && kps >= 4 && kps <= 30 && analiz.snr >= 4 && analiz.kirpikOrani < 0.001;
      fs.mkdirSync(ornekKlasoru(), { recursive: true });
      const ad = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      sesYaz(path.join(ornekKlasoru(), ad + ".wav"), wavKodla(ornekler, hiz), kim().id);
      fs.writeFileSync(path.join(ornekKlasoru(), ad + ".json"), JSON.stringify({
        metin: temiz, sure: Math.round(sure * 100) / 100, kirpikSn: Math.round(kirpikSn * 100) / 100,
        snr: Math.round(analiz.snr * 10) / 10, uygun, tarih: new Date().toISOString(),
      }), "utf8");
      ornekleriBuda();
      return true;
    } catch (err) {
      gunluk(`örnek kaydedilemedi: ${err.message}`);
      return false;
    }
  }

  // Temiz 3-12 sn'lik parçaları seçip ~8-12 sn'lik referans ve eşleşen metni üretir
  function orneklerdenReferans() {
    const adaylar = [];
    for (const o of ornekleriListele()) {
      if (!o.metin || halusinasyonMu(o.metin)) continue;
      try {
        const { hiz, ornekler } = wavCoz(sesOku(o.tam, kim().id));
        const analiz = sesCozumle(ornekler, hiz);
        const k = sessizligiKirp(ornekler, hiz, analiz);
        const sn = k.length / hiz;
        const kps = o.metin.length / Math.max(0.5, sn);
        if (sn < 3 || sn > 12 || kps < 4 || kps > 30 || analiz.snr < 4 || analiz.kirpikOrani >= 0.001) continue;
        adaylar.push({ ...o, hiz, ses: k, sn, puan: Math.min(analiz.snr, 40) - Math.abs(kps - 14) * 0.3 });
      } catch (_) {}
    }
    if (!adaylar.length) throw hataOlustur("Henüz temiz bir örnek yok. Sesli sohbette sessiz bir ortamda 3-12 saniyelik cümlelerle biraz daha konuşun.", 409);
    const secilen = [];
    let toplam = 0;
    for (const a of [...adaylar].sort((x, y) => y.puan - x.puan)) {
      if (toplam >= ORNEK_REF_HEDEF_SN) break;
      if (toplam + a.sn > ORNEK_REF_AZAMI_SN) continue;
      secilen.push(a);
      toplam += a.sn + 0.3;
    }
    if (toplam < ORNEK_REF_ASGARI_SN) throw hataOlustur(`Temiz örneklerin toplamı ${toplam.toFixed(1)} sn; en az ${ORNEK_REF_ASGARI_SN} sn (önerilen 8-12 sn) gerekir. Sesli sohbette biraz daha konuşun.`, 409);
    secilen.sort((x, y) => x.dosya.localeCompare(y.dosya)); // konuşma sırasıyla
    const hiz = 16000;
    const bosluk = new Float32Array(Math.round(hiz * 0.3));
    const parcalar = [];
    for (const s of secilen) {
      parcalar.push(seviyele(yenidenOrnekle(s.ses, s.hiz, hiz)));
      parcalar.push(bosluk);
    }
    parcalar.pop();
    const uzunluk = parcalar.reduce((t, p) => t + p.length, 0);
    const birlesik = new Float32Array(Math.min(uzunluk, REF_AZAMI_SN * hiz));
    let o = 0;
    for (const p of parcalar) { if (o >= birlesik.length) break; birlesik.set(p.subarray(0, birlesik.length - o), o); o += p.length; }
    const metin = secilen.map((s) => {
      const m = s.metin.trim();
      return /[.!?…]$/.test(m) ? m : m + ".";
    }).join(" ");
    return { hiz, ornekler: birlesik, sure: Math.round((birlesik.length / hiz) * 10) / 10, metin, kullanilan: secilen.length };
  }

  // -- Klonu kaydet / adlandır / sil ----------------------------------------------
  function klonKaydet({ belirtec, ad, metin, onay }) {
    const y = geciciYolu(belirtec);
    if (!fs.existsSync(y.wav) || !fs.existsSync(y.bilgi)) throw hataOlustur("Yüklenen ses bulunamadı ya da süresi doldu (1 saat). Yeniden yükleyin.", 410);
    let bilgi = {};
    try { bilgi = JSON.parse(fs.readFileSync(y.bilgi, "utf8")) || {}; } catch (_) {}
    const kaynak = bilgi.kaynak === "ornekler" ? "ornekler" : "yukleme";
    const kayit = onayKaydiUret(onay, { kaynak, sadeceKendim: kaynak === "ornekler" });
    const gorunen = adDogrula(ad);
    if (adCakisiyorMu(gorunen)) throw adCakismasi(gorunen);
    const temizMetin = metniTemizle(metin, 1000);
    if (temizMetin.length < 2) throw hataOlustur("Kayıtta söylenenleri yazın (klonun doğru çıkması için metin kayıtla birebir aynı olmalı).");
    const taban = bosTabanBul(gorunen);
    const dosya = taban + ".wav";
    const hedef = path.join(REF, dosya);
    if (!pathInside(hedef, REF)) throw hataOlustur("Geçersiz dosya adı.");
    const wav = sesOku(y.wav, kim().id);
    fs.writeFileSync(path.join(REF, taban + ".txt"), temizMetin + "\n", "utf8");
    fs.writeFileSync(onayYolu(dosya), JSON.stringify({
      ...kayit, ad: gorunen, dosya, sesSha256: crypto.createHash("sha256").update(wav).digest("hex"), sureSn: bilgi.sure || null,
      sahip: kim().id || undefined,
    }, null, 2), "utf8");
    // Ses en son yazılır: liste, onay kaydı hazır olmadan bu sesi göremez (sahibinin anahtarıyla şifreli)
    sesYaz(hedef, wav, kim().id);
    try { fs.unlinkSync(y.wav); } catch (_) {}
    try { fs.unlinkSync(y.bilgi); } catch (_) {}
    gunluk(`klon eklendi: ${dosya} (kaynak: ${kaynak}, ses sahibi: ${kayit.sesSahibi}, ${bilgi.sure || "?"} sn)`);
    return { dosya, ad: gorunen, sesKimligi: `omnivoice:klon_${dosya}` };
  }

  function klonDuzenle({ dosya, yeniAd, metin }) {
    const tam = dosyaDogrula(dosya);
    acikTemizle({ sahip: (onayOku(dosya) || {}).sahip, dosya });
    if (!onayliMi(dosya)) throw hataOlustur("Bu ses için onay kaydı yok; önce onay verin.", 403);
    let sonuc = { dosya, ad: gorunenAd(dosya) };
    if (metin !== undefined) {
      const m = metniTemizle(metin, 1000);
      if (m.length < 2) throw hataOlustur("Metin boş olamaz.");
      for (const p of metinYollari(dosya)) { try { if (p !== metinYollari(dosya)[0]) fs.unlinkSync(p); } catch (_) {} }
      fs.writeFileSync(metinYollari(dosya)[0], m + "\n", "utf8");
    }
    if (yeniAd !== undefined) {
      const gorunen = adDogrula(yeniAd);
      if (adCakisiyorMu(gorunen, dosya)) throw adCakismasi(gorunen);
      const uzanti = path.extname(dosya).toLowerCase();
      const eskiTaban = tabanAdi(dosya);
      let yeniTaban = guvenliTaban(gorunen);
      if (yeniTaban.toLowerCase() !== eskiTaban.toLowerCase()) yeniTaban = bosTabanBul(gorunen);
      else yeniTaban = eskiTaban;
      const yeniDosya = yeniTaban + uzanti;
      const onay = onayOku(dosya) || {};
      if (yeniTaban !== eskiTaban) {
        const tasima = [[path.join(REF, eskiTaban + ".txt"), path.join(REF, yeniTaban + ".txt")], [path.join(REF, dosya + ".txt"), path.join(REF, yeniTaban + ".txt")]];
        for (const [a, b] of tasima) { try { if (fs.existsSync(a) && !fs.existsSync(b)) fs.renameSync(a, b); } catch (_) {} }
        fs.writeFileSync(onayYolu(yeniDosya), JSON.stringify({ ...onay, ad: gorunen, dosya: yeniDosya }, null, 2), "utf8");
        fs.renameSync(tam, path.join(REF, yeniDosya));
        try { fs.unlinkSync(onayYolu(dosya)); } catch (_) {}
        const a = ayarlariOku();
        if (a.vegaKlonDosyasi === dosya) ayarlariYaz({ ...a, vegaKlonDosyasi: yeniDosya });
      } else {
        fs.writeFileSync(onayYolu(dosya), JSON.stringify({ ...onay, ad: gorunen }, null, 2), "utf8");
      }
      sonuc = { dosya: yeniDosya, ad: gorunen };
    }
    return { ...sonuc, sesKimligi: `omnivoice:klon_${sonuc.dosya}` };
  }

  function klonSil({ dosya }) {
    const tam = dosyaDogrula(dosya);
    acikTemizle({ sahip: (onayOku(dosya) || {}).sahip, dosya });
    fs.unlinkSync(tam);
    for (const p of [...metinYollari(dosya), onayYolu(dosya)]) { try { fs.unlinkSync(p); } catch (_) {} }
    const a = ayarlariOku();
    if (a.vegaKlonDosyasi === dosya) ayarlariYaz({ ...a, vegaKlonSesi: false, vegaKlonDosyasi: "" });
    gunluk(`klon silindi: ${dosya}`);
    return { dosya };
  }

  // Elle app/reference-voices'a konmuş (onay kaydı olmayan) bir ses için onay verilir
  function mevcutSesiOnayla({ dosya, onay }) {
    const tam = dosyaDogrula(dosya);
    const kayit = onayKaydiUret(onay, { kaynak: "elle-eklenen" });
    const sesVerisi = sesOku(tam);
    const sha = crypto.createHash("sha256").update(sesVerisi).digest("hex");
    const eskiOnay = onayOku(dosya);
    const sahipId = (eskiOnay && eskiOnay.sahip) || kim().id || undefined;
    fs.writeFileSync(onayYolu(dosya), JSON.stringify({ ...kayit, ad: tabanAdi(dosya), dosya, sesSha256: sha, sahip: sahipId, sureSn: wavSuresi(tam) || undefined }, null, 2), "utf8");
    if (sahipId && !sesSifreliMi(fs.readFileSync(tam))) sesYaz(tam, sesVerisi, sahipId);
    gunluk(`elle eklenen sese onay verildi: ${dosya}`);
    return { dosya, sesKimligi: `omnivoice:klon_${dosya}` };
  }

  // OmniVoice kurulu mu? Önbellekli denetim (sunucu yeni açıldığında eşzamanlı önbellek henüz boş
  // olabiliyordu ve anahtar yanlışlıkla "OmniVoice kurulu değil" diyordu). Kesin karar için beklenir.
  async function omnivoiceKuruluMu() {
    if (omnivoiceBiliniyor() === true) return true; // önbellekte "kurulu" varsa beklemeye gerek yok
    if (typeof ctx.omnivoiceKuruluDenetle === "function") {
      let k = await ctx.omnivoiceKuruluDenetle(false);
      if (!k) k = await ctx.omnivoiceKuruluDenetle(true); // yeni kurulduysa önbellekteki "hayır" tazelensin
      return !!k;
    }
    return typeof ctx.omnivoiceKurulu === "function" ? !!ctx.omnivoiceKurulu() : true;
  }
  function omnivoiceBiliniyor() {
    try { return typeof ctx.omnivoiceKurulu === "function" ? !!ctx.omnivoiceKurulu() : null; } catch (_) { return null; }
  }
  // Liste için hızlı yanıt: denetim birkaç saniyede bitmezse null ("denetleniyor") döner
  async function omnivoiceKuruluHizli(beklemeMs = 2500) {
    try {
      if (omnivoiceBiliniyor() === true) return true;
      if (typeof ctx.omnivoiceKuruluDenetle === "function") {
        let zaman;
        const sinir = new Promise((r) => { zaman = setTimeout(() => r(null), beklemeMs); });
        const sonuc = await Promise.race([Promise.resolve(ctx.omnivoiceKuruluDenetle(false)).then((k) => !!k, () => null), sinir]);
        clearTimeout(zaman);
        return sonuc;
      }
      return typeof ctx.omnivoiceKurulu === "function" ? !!ctx.omnivoiceKurulu() : null;
    } catch (_) { return null; }
  }

  async function ayarlariGuncelle(govde) {
    const a = ayarlariOku();
    const yeni = { ...a };
    if (govde.ornekTopla !== undefined) {
      const ac = govde.ornekTopla === true;
      if (ac && !a.ornekTopla) yeni.ornekOnay = onayKaydiUret(govde.onay, { kaynak: "sesli-sohbet-ornekleri", sadeceKendim: true });
      yeni.ornekTopla = ac;
      gunluk(`örnek toplama ${ac ? "açıldı" : "kapatıldı"}`);
    }
    if (govde.zamanAsimiSn !== undefined) yeni.zamanAsimiSn = zamanAsimiNorm(govde.zamanAsimiSn);
    if (govde.vegaKlonDosyasi !== undefined) {
      const d = String(govde.vegaKlonDosyasi || "");
      if (d && (!onayliMi(d) || !sahibiMi(d))) throw hataOlustur("Seçilen klon ses bulunamadı ya da onay kaydı yok.", 404);
      yeni.vegaKlonDosyasi = d;
    }
    if (govde.vegaKlonSesi !== undefined) {
      const ac = govde.vegaKlonSesi === true;
      if (ac) {
        if (!yeni.vegaKlonDosyasi || !onayliMi(yeni.vegaKlonDosyasi) || !sahibiMi(yeni.vegaKlonDosyasi) || !fs.existsSync(path.join(REF, yeni.vegaKlonDosyasi))) {
          const e = hataOlustur("Önce bir klon ses oluşturun ve seçin.", 409);
          e.code = "KLON_YOK";
          throw e;
        }
        if (!(await omnivoiceKuruluMu())) {
          const e = hataOlustur("OmniVoice kurulu değil. Metinden Sese > OmniVoice bölümünden kurun.", 409);
          e.code = "OMNIVOICE_YOK";
          throw e;
        }
      }
      if (ac !== !!a.vegaKlonSesi) gunluk(`"Vega benim sesimle yanıt versin" ${ac ? "açıldı" : "kapatıldı"}`);
      yeni.vegaKlonSesi = ac;
    }
    ayarlariYaz(yeni);
    // Anahtar açıldıysa ya da klon değiştiyse model hemen arka planda hazırlanmaya başlar
    hazirlikAyarDegisti({ isitilsin: govde.vegaKlonSesi === true || govde.vegaKlonDosyasi !== undefined });
    return ayarOzeti(yeni);
  }

  // -- Sesli sohbette klon ses: ısıtma (model yükleme) ve süre sınırlı seslendirme ---------------------
  const isitDestegi = typeof ctx.omnivoiceIsit === "function";
  let isitNesli = 0;
  let klonSentezSayaci = 0;
  let surenCumle = null;   // { no, baslangic, istemciVazgecti }
  const hz = { durum: "kapali", dosya: "", baslangic: 0, yuklemeSn: null, cihaz: "", hata: "", not: "", sonCumleSn: null, sureler: [], ardisikSorun: 0 };

  function calisanCalisiyorMu() {
    try {
      const d = typeof ctx.omnivoiceDurumu === "function" ? ctx.omnivoiceDurumu() : null;
      return d ? !!d.calisiyor : null;
    } catch (_) { return null; }
  }

  function hazirlikDurumu() {
    // Hazır sanılan çalışan boşta kaldığı için kapandıysa ya da başka bir yoldan durdurulduysa
    // (Yükleme sırasında çalışan kapanırsa ısıtma isteği hata ile döner; orada ayrıca ele alınır.)
    if (hz.durum === "hazir" && calisanCalisiyorMu() === false && !surenCumle) {
      hz.not = "Klon ses modeli bir süre kullanılmadığı için bellekten çıkarıldı; gerektiğinde yeniden hazırlanır.";
      hz.durum = "kapali";
    }
    const a = ayarOzeti();
    const ortalama = hz.sureler.length ? Math.round((hz.sureler.reduce((t, s) => t + s, 0) / hz.sureler.length) * 10) / 10 : null;
    let durum = hz.durum;
    if (durum === "hazir" && surenCumle && surenCumle.istemciVazgecti) durum = "mesgul";
    return {
      durum, // kapali | yukleniyor | hazir | mesgul | hata
      dosya: hz.dosya,
      gecenSn: hz.durum === "yukleniyor" ? Math.round((Date.now() - hz.baslangic) / 1000) : null,
      yuklemeSn: hz.yuklemeSn,
      cihaz: hz.cihaz || a.olcum.cihaz || "",
      hata: hz.durum === "hata" ? hz.hata : "",
      not: hz.not,
      sonCumleSn: hz.sonCumleSn,
      ortalamaCumleSn: ortalama,
      cumleSuruyorSn: surenCumle ? Math.round((Date.now() - surenCumle.baslangic) / 1000) : null,
      vegaKlonSesi: a.vegaKlonSesi,
      zamanAsimiSn: a.zamanAsimiSn,
      olcum: a.olcum,
      isitDestegi,
    };
  }

  // Modeli arka planda yükler ve klon istemini (referansın belirteçlenmesi) önbelleğe alır.
  // zorla: önceki hatadan sonra yeniden dene (kullanıcı anahtarı açtı / sesli sohbeti açtı / "Yeniden dene").
  async function isit({ zorla = false, neden = "" } = {}) {
    if (!isitDestegi) return hazirlikDurumu();
    const a = ayarOzeti();
    if (!a.vegaKlonSesi || !a.vegaKlonDosyasi) return hazirlikDurumu();
    hazirlikDurumu();
    const dosya = a.vegaKlonDosyasi;
    if (hz.dosya === dosya && ["yukleniyor", "hazir"].includes(hz.durum)) return hazirlikDurumu();
    if (hz.durum === "hata" && !zorla) return hazirlikDurumu();
    const nesil = ++isitNesli;
    Object.assign(hz, { durum: "yukleniyor", dosya, baslangic: Date.now(), hata: "", not: "" });
    if (zorla) hz.ardisikSorun = 0;
    if (!(await omnivoiceKuruluMu())) {
      if (nesil === isitNesli) Object.assign(hz, { durum: "hata", hata: "OmniVoice kurulu değil. Metinden Sese > OmniVoice bölümünden kurun." });
      return hazirlikDurumu();
    }
    if (nesil !== isitNesli) return hazirlikDurumu();
    const calisanAcikti = calisanCalisiyorMu() === true;
    gunluk(`klon ses hazırlanıyor${neden ? ` (${neden})` : ""}: ${dosya}${calisanAcikti ? " — model zaten bellekte" : " — model yükleniyor, işlemcide birkaç dakika sürebilir"}`);
    Promise.resolve()
      .then(() => ctx.omnivoiceIsit(motorYolu(dosya, { denetle: false })))
      .then((r) => {
        if (nesil !== isitNesli) return;
        const sn = Math.round((Date.now() - hz.baslangic) / 100) / 10;
        Object.assign(hz, { durum: "hazir", yuklemeSn: sn, cihaz: (r && r.cihaz) || hz.cihaz || "", hata: "", ardisikSorun: 0 });
        gunluk(`klon ses hazır: ${sn} sn (${hz.cihaz || "?"})`);
        if (!calisanAcikti) olcumKaydet({ yuklemeSn: sn, cihaz: hz.cihaz });
      }, (err) => {
        if (nesil !== isitNesli) return;
        const mesaj = String((err && err.message) || err).slice(0, 400);
        Object.assign(hz, { durum: "hata", hata: `Klon ses hazırlanamadı: ${mesaj}` });
        gunluk(`klon ses hazırlanamadı: ${mesaj}`);
      });
    return hazirlikDurumu();
  }

  // Ayar değişince (anahtar, seçilen klon, silme/yeniden adlandırma) hazırlık güncellenir
  function hazirlikAyarDegisti({ isitilsin = false } = {}) {
    if (!isitDestegi) return;
    const a = ayarOzeti();
    if (!a.vegaKlonSesi) {
      if (hz.durum === "kapali" && !hz.dosya) return;
      isitNesli++;
      const yukleniyordu = hz.durum === "yukleniyor";
      Object.assign(hz, { durum: "kapali", dosya: "", hata: "", not: "" });
      // Yarım yükleme durdurulur (işlemci ve bellek boşalsın); yüklü model kısa süre sonra kapanır
      if (yukleniyordu && !surenCumle) { try { ctx.isciDurdur && ctx.isciDurdur(); } catch (_) {} }
      else { try { ctx.omnivoiceCanliTut && ctx.omnivoiceCanliTut(60 * 1000); } catch (_) {} }
      return;
    }
    const etkin = ["yukleniyor", "hazir"].includes(hz.durum);
    if (isitilsin ? (a.vegaKlonDosyasi !== hz.dosya || !etkin) : (etkin && a.vegaKlonDosyasi !== hz.dosya)) {
      isit({ zorla: true, neden: isitilsin ? "anahtar açıldı" : "klon değişti" }).catch(() => {});
    }
  }

  // Sesli sohbet açıkken arayüz düzenli yoklar: model bellekte tutulur, kapandıysa yeniden hazırlanır
  async function canli({ isit: isitIstegi = false, kapat = false } = {}) {
    if (kapat) {
      if (["hazir", "mesgul"].includes(hazirlikDurumu().durum)) { try { ctx.omnivoiceCanliTut && ctx.omnivoiceCanliTut(KAPANIS_CANLI_MS); } catch (_) {} }
      return hazirlikDurumu();
    }
    const a = ayarOzeti();
    if (!a.vegaKlonSesi) return hazirlikDurumu();
    const d = hazirlikDurumu();
    if (isitIstegi) await isit({ zorla: true, neden: "sesli sohbet açıldı" });
    else if (d.durum === "kapali") await isit({ neden: "sesli sohbet sürüyor" });
    if (["hazir", "mesgul"].includes(hazirlikDurumu().durum)) { try { ctx.omnivoiceCanliTut && ctx.omnivoiceCanliTut(CANLI_TUT_MS); } catch (_) {} }
    return hazirlikDurumu();
  }

  function hazirDegilHatasi(d) {
    const mesgul = d.durum === "mesgul" || (d.durum === "hazir" && surenCumle);
    const e = hataOlustur(
      d.durum === "yukleniyor" ? "Klon ses hazırlanıyor (model yükleniyor); bu cümle normal sesle okunuyor."
        : mesgul ? "Klon ses önceki cümleyi bitirmedi; bu cümle normal sesle okunuyor."
          : d.durum === "hata" ? (d.hata || "Klon ses kullanılamıyor.")
            : "Klon ses hazır değil; hazırlanıyor. Bu cümle normal sesle okunuyor.", 503);
    e.code = mesgul ? "KLON_MESGUL" : "KLON_HAZIR_DEGIL";
    return e;
  }

  // Takılma sınırı: süre sınırının iki katı, en az 3 dk (çok uzun ama gerçek bir cümleyi öldürmemek için)
  const takilmaSiniriSn = (sn) => (sn === 0 ? TAKILMA_GUVENLIK_SN : Math.min(1200, Math.max(180, sn * 2)));

  // is(ek): seslendirmeyi yapan işlev; ek = { adim } (işlemcide daha az difüzyon adımı)
  function sureliSentez(is, zamanAsimiSn) {
    const sn = zamanAsimiNorm(zamanAsimiSn, 15);
    if (!isitDestegi) return eskiSureliSentez(is, sn || TAKILMA_GUVENLIK_SN);
    const d = hazirlikDurumu();
    if (d.durum !== "hazir" || surenCumle) {
      if (d.durum === "kapali" && d.vegaKlonSesi) isit({ neden: "ilk cümle" }).catch(() => {});
      return Promise.reject(hazirDegilHatasi(d));
    }
    const no = ++klonSentezSayaci;
    const baslangic = Date.now();
    const kayit = { no, baslangic, istemciVazgecti: false };
    surenCumle = kayit;
    const ek = hz.cihaz === "cuda" ? {} : { adim: CPU_ADIM };
    const p = Promise.resolve().then(() => is(ek));
    const takilma = setTimeout(() => {
      if (surenCumle !== kayit) return;
      surenCumle = null;
      hz.ardisikSorun += 1;
      gunluk(`klon cümle #${no} ${takilmaSiniriSn(sn)} sn'dir bitmedi; OmniVoice takıldı sayılıp çalışan durduruluyor`);
      isitNesli++;
      try { ctx.isciDurdur && ctx.isciDurdur(); } catch (_) {}
      if (hz.ardisikSorun >= 2) {
        Object.assign(hz, { durum: "hata", hata: "OmniVoice art arda yanıt vermedi; klon ses bu oturumda durduruldu. Vega normal sesle konuşuyor. Ses ayarlarından yeniden deneyebilirsiniz." });
      } else {
        Object.assign(hz, { durum: "kapali", not: "OmniVoice takıldı; klon ses yeniden hazırlanıyor." });
        isit({ neden: "takılma sonrası" }).catch(() => {});
      }
    }, takilmaSiniriSn(sn) * 1000);
    p.then(() => {
      const gecen = Math.round((Date.now() - baslangic) / 100) / 10;
      hz.sonCumleSn = gecen;
      hz.sureler.push(gecen);
      if (hz.sureler.length > 10) hz.sureler.shift();
      hz.ardisikSorun = 0;
      gunluk(`klon cümle #${no}: ${gecen} sn${kayit.istemciVazgecti ? " (beklenmedi: süre aşıldı ya da susturuldu; cümle normal sesle okunmuştu)" : ""}`);
      olcumKaydet({ cumleSn: gecen });
    }, (err) => {
      gunluk(`klon cümle #${no} başarısız: ${String((err && err.message) || err).slice(0, 300)}`);
      if (surenCumle === kayit && calisanCalisiyorMu() === false) {
        // Çalışan çöktü: bir kez yeniden hazırlanır, tekrarlarsa durur
        hz.ardisikSorun += 1;
        isitNesli++;
        if (hz.ardisikSorun >= 2) Object.assign(hz, { durum: "hata", hata: `OmniVoice çalışanı kapandı: ${String((err && err.message) || err).slice(0, 200)}` });
        else Object.assign(hz, { durum: "kapali", not: "OmniVoice çalışanı kapandı; klon ses yeniden hazırlanacak." });
      }
    }).finally(() => {
      clearTimeout(takilma);
      if (surenCumle === kayit) surenCumle = null;
    });
    if (sn === 0) return p; // sınırsız: cümle klonla bitene kadar beklenir (yalnızca takılma güvenliği çalışır)
    let zaman;
    const sure = new Promise((_, reddet) => {
      zaman = setTimeout(() => {
        kayit.istemciVazgecti = true;
        gunluk(`klon cümle #${no} ${sn} sn'de bitmedi; bu cümle normal sesle okunacak (model bellekte kalıyor)`);
        const e = hataOlustur(`Klon ses bu cümleyi ${sn} sn içinde bitiremedi; cümle normal sesle okundu.`, 504);
        e.code = "KLON_ZAMAN_ASIMI";
        reddet(e);
      }, sn * 1000);
    });
    return Promise.race([p, sure]).finally(() => clearTimeout(zaman));
  }

  // serve.cjs ısıtma desteği vermiyorsa eski davranış (süre aşılınca çalışan durdurulur)
  function eskiSureliSentez(is, sn) {
    const no = ++klonSentezSayaci;
    let zaman;
    const sure = new Promise((_, reddet) => {
      zaman = setTimeout(() => {
        gunluk(`sesli sohbet klon seslendirmesi ${sn} sn'de bitmedi; çalışan durduruluyor (normal sese dönülecek)`);
        try { ctx.isciDurdur && ctx.isciDurdur(); } catch (_) {}
        const e = hataOlustur(`Klon ses ${sn} sn içinde hazır olmadı; normal sese geçildi.`, 504);
        e.code = "KLON_ZAMAN_ASIMI";
        reddet(e);
      }, sn * 1000);
    });
    const baslangic = Date.now();
    const p = Promise.resolve().then(() => is({}));
    p.then(() => gunluk(`klon cümle #${no}: ${((Date.now() - baslangic) / 1000).toFixed(1)} sn`), () => {});
    return Promise.race([p, sure]).finally(() => clearTimeout(zaman));
  }

  // -- HTTP -------------------------------------------------------------------------
  function ikiliGovdeOku(req, sinir) {
    return new Promise((resolve, reject) => {
      const uzunluk = Number(req.headers["content-length"] || 0);
      if (uzunluk > sinir) { reject(hataOlustur(`Dosya çok büyük (sınır ${Math.round(sinir / 1048576)} MB).`, 413)); req.resume(); return; }
      const parcalar = [];
      let bayt = 0, bitti = false;
      req.on("data", (p) => {
        if (bitti) return;
        bayt += p.length;
        if (bayt > sinir) { bitti = true; reject(hataOlustur(`Dosya çok büyük (sınır ${Math.round(sinir / 1048576)} MB).`, 413)); req.resume(); return; }
        parcalar.push(p);
      });
      req.on("end", () => { if (!bitti) { bitti = true; resolve(Buffer.concat(parcalar)); } });
      req.on("error", (e) => { if (!bitti) { bitti = true; reject(e); } });
    });
  }

  function sesGonder(res, tam, sahip) {
    const b = sesOku(tam, sahip);
    res.writeHead(200, { "Content-Type": /\.flac$/i.test(tam) ? "audio/flac" : /\.ogg$/i.test(tam) ? "audio/ogg" : "audio/wav", "Content-Length": b.length, "Cache-Control": "no-store" });
    res.end(b);
  }

  // omnivoiceKurulu: true | false | null (denetim sürüyor; anahtar açılırken sunucu kesin denetler)
  async function ozet() {
    const { klonlar, onaysiz } = klonListesi();
    const omnivoice = await omnivoiceKuruluHizli();
    return { ok: true, klonlar, onaysiz, ayarlar: ayarOzeti(), ornekler: ornekOzeti(), omnivoiceKurulu: omnivoice, hazirlik: hazirlikDurumu(), onayMetni: onayMetni() };
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const yol = url.pathname;
    if (!yol.startsWith("/api/klon/")) return false;
    const m = req.method;
    try {
      if (yol === "/api/klon/liste" && m === "GET") { json(res, 200, await ozet()); return true; }
      // Sesli sohbet / ses ayarları yoklaması: klon sesin hazırlık durumu (hafif; dosya listesi yok)
      if (yol === "/api/klon/durum" && m === "GET") { json(res, 200, { ok: true, hazirlik: hazirlikDurumu(), ayarlar: ayarOzeti() }); return true; }
      if (yol === "/api/klon/onay-metni" && m === "GET") { json(res, 200, { ok: true, ...onayMetni() }); return true; }

      if (yol === "/api/klon/dinle" && m === "GET") {
        const gecici = url.searchParams.get("gecici");
        if (gecici) {
          const y = geciciYolu(gecici);
          if (!fs.existsSync(y.wav)) throw hataOlustur("Ses bulunamadı.", 404);
          sesGonder(res, y.wav, kim().id);
        } else {
          sesGonder(res, dosyaDogrula(url.searchParams.get("dosya")));
        }
        return true;
      }

      // Ses yükle → (onay şart) → sessizlik kırp, ≤30 sn, yazıya dök → geçici belirteç
      if (yol === "/api/klon/yukle" && m === "POST") {
        let onay = null;
        try { onay = JSON.parse(decodeURIComponent(String(req.headers["x-klon-onay"] || ""))); } catch (_) {}
        onayKaydiUret(onay, { kaynak: "yukleme" }); // yalnızca doğrulama; kayıt klon kaydedilirken yazılır
        const tur = String(req.headers["content-type"] || "").toLowerCase();
        if (tur && !/^audio\/(wav|x-wav|wave|vnd\.wave)\b/.test(tur) && tur !== "application/octet-stream") {
          throw hataOlustur("Yalnızca ses (WAV) kabul edilir. Arayüz diğer biçimleri yüklemeden önce WAV'a çevirir.", 415);
        }
        const buf = await ikiliGovdeOku(req, YUKLEME_AZAMI_BAYT);
        const ref = referansHazirla(buf);
        const dil = ["tr", "en", "auto"].includes(url.searchParams.get("dil")) ? url.searchParams.get("dil") : "tr";
        const dokum = await yaziyaDok(ref.ornekler, ref.hiz, dil);
        const belirtec = geciciKaydet(wavKodla(ref.ornekler, ref.hiz), { kaynak: "yukleme", sure: ref.sure, tarih: new Date().toISOString() });
        json(res, 200, { ok: true, belirtec, sure: ref.sure, metin: dokum.metin, uyarilar: [...ref.uyarilar, ...(dokum.uyari ? [dokum.uyari] : [])] });
        return true;
      }

      if (m !== "POST") return false;
      const govde = await readJsonBody(req, res);
      if (!govde) return true; // readJsonBody yanıtı zaten gönderdi
      if (typeof govde !== "object" || Array.isArray(govde)) throw hataOlustur("Geçersiz istek.");

      if (yol === "/api/klon/ornekten-hazirla") {
        onayKaydiUret(govde.onay, { kaynak: "ornekler", sadeceKendim: true });
        const ref = orneklerdenReferans();
        const belirtec = geciciKaydet(wavKodla(ref.ornekler, ref.hiz), { kaynak: "ornekler", sure: ref.sure, tarih: new Date().toISOString() });
        json(res, 200, { ok: true, belirtec, sure: ref.sure, metin: ref.metin, kullanilan: ref.kullanilan, uyarilar: [] });
        return true;
      }
      if (yol === "/api/klon/kaydet") { const r = klonKaydet(govde); json(res, 200, { ok: true, ...r, ...(await ozet()) }); return true; }
      if (yol === "/api/klon/duzenle") { const r = klonDuzenle(govde); hazirlikAyarDegisti(); json(res, 200, { ok: true, ...r, ...(await ozet()) }); return true; }
      if (yol === "/api/klon/sil") { const r = klonSil(govde); hazirlikAyarDegisti(); json(res, 200, { ok: true, ...r, ...(await ozet()) }); return true; }
      if (yol === "/api/klon/onayla") { const r = mevcutSesiOnayla(govde); json(res, 200, { ok: true, ...r, ...(await ozet()) }); return true; }
      if (yol === "/api/klon/ayarlar") { await ayarlariGuncelle(govde); json(res, 200, await ozet()); return true; }
      if (yol === "/api/klon/ornekleri-sil") {
        const silinen = ornekleriSil();
        gunluk(`toplanan örnekler silindi (${silinen})`);
        json(res, 200, { ...(await ozet()), silinen });
        return true;
      }
      // Sesli sohbet açıkken yoklama: { isit: true } sesli sohbet açılırken (önceki hatadan sonra da yeniden dener),
      // { kapat: true } sesli sohbet kapanırken (model birkaç dakika daha bellekte kalır, sonra kapanır)
      if (yol === "/api/klon/canli") { json(res, 200, { ok: true, hazirlik: await canli({ isit: govde.isit === true, kapat: govde.kapat === true }) }); return true; }
      if (yol === "/api/klon/iptal") {
        // Sesli sohbette "Sustur": yüklenmiş model artık DURDURULMAZ (yeniden yüklemek işlemcide dakikalar sürer).
        // Süren cümle arka planda biter; o sırada gelen cümleler normal sesle okunur.
        if (surenCumle) surenCumle.istemciVazgecti = true;
        json(res, 200, { ok: true, hazirlik: hazirlikDurumu() });
        return true;
      }
      json(res, 404, { ok: false, error: "Bilinmeyen klon işlemi." });
      return true;
    } catch (err) {
      const kod = Number(err.statusCode) || 500;
      if (kod >= 500) log("  [klon] hata:", err.message);
      if (!res.headersSent) json(res, kod, { ok: false, error: err.message || String(err), code: err.code || "" });
      return true;
    }
  }

  return {
    handle,
    ornekKaydet,
    onayliMi,
    sahibiMi,
    motorYolu,
    acikKlasoru: ACIK,
    acikTemizle,
    gorunenAd,
    sureliSentez,
    isit,
    hazirlik: hazirlikDurumu,
    ayarlar: ayarOzeti,
    // testler için
    _ic: { wavCoz, wavKodla, guvenliTaban, adDogrula, orneklerdenReferans, ONAY_SURUMU, ONAY_BEYANLARI, ONAY_TAAHHUDU },
  };
};

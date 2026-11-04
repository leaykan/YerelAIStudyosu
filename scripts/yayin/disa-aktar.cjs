#!/usr/bin/env node
// Yerel AI Stüdyosu — yayın için temiz kopya çıkarır (bağımlılık yok, yalnızca Node.js).
//
//   node scripts/yayin/disa-aktar.cjs <hedef-klasör> [--paket <paket-klasörü>] [--surum 1.0.0] [--zip <dosya.zip>]
//                                    [--depo sahip/YerelAIStudyosu] [--deneme] [--kaynak <proje-kökü>]
//                                    [--isim Ad]... [--isimler-dosyasi <dosya>] [--zorla]
//
// GitHub deposu: Kurulum.bat'taki TEK yer tutucu satırdan okunur:  $Repo = 'HESAP/YerelAIStudyosu'
//   ("HESAP" = depo sahibi henüz belirlenmedi; yayından önce doldurulacak). Yer tutucu dururken bu betik
//   YAYIN PAKETİ (--paket / --zip) ÜRETMEZ; yalnızca --deneme ile yerel deneme paketi üretir. --depo sahip/ad
//   verilirse yer tutucu yalnızca kopyada (Kurulum.bat) bu depoyla değiştirilir; çalışma kopyası değişmez.
//   README.md depoya göreli bağlantılarla (../../releases) bağlanır, depo adını içermez.
//
// Yerel kurulum denemesi (GitHub'a koymadan):
//   node scripts/yayin/disa-aktar.cjs ../yayin-kopyasi --paket ../yerel-paket --surum 1.0.0 --deneme
//   → ../yerel-paket/ içinde YerelAIStudyosu-1.0.0.zip + SHA256SUMS.txt + Kurulum.bat oluşur.
//     Kurulum.bat çift tıklanınca yanındaki zip'i SHA256 ile doğrulayıp "Yerel paketten kuruluyor" der, internete çıkmaz.
//     Deneme paketi GitHub'a yüklenmez (depo adresi yer tutucu olabilir; internetten kurulum çalışmaz).
// Yayın paketi (depo sahibi belli olunca):
//   node scripts/yayin/disa-aktar.cjs ../yayin-kopyasi --paket ../surum --surum 1.0.0 --depo <sahip>/YerelAIStudyosu
//
// Ne yapar:
//   1. Projeyi hedef klasöre kopyalar; yalnızca izin listesindeki dosyalar gider. Modeller, motorlar ve taşınabilir
//      çalışma zamanları (app/tools…), önbellekler, sohbet geçmişi, çıktılar, günlükler, ayarlar/anahtarlar (app/config),
//      kullanıcı verileri (app/kullanicilar…), ses klonu kayıtları ve onayları, etkin model listesi, yedekler (yedek*, *.yedek*),
//      yama/entegrasyon klasörleri, geliştirici/asistan not klasörleri ("… outputs", test notları), _to_delete, .git vb. DIŞARIDA kalır.
//   2. Kopyada yayın dönüşümlerini uygular (kişisel ad içeren varsayılan istem → genel metin, geliştiricinin yerel
//      model dosya adları → sihirbazın indirdiği denenmiş model, iş kuyruğu metinleri → "otomasyon kuyruğu").
//      Kullanıcının Ayarlar'da kaydettiği kendi istemi tarayıcıda (localStorage) durur, zaten kopyaya girmez.
//   3. Sonucu tarar: anahtar/jeton kalıpları (hf_, sk-, AIza, ghp_, özel anahtar…), sürücü harfli ya da kullanıcı klasörlü mutlak yollar,
//      izinsiz e-posta adresleri, kişisel adlar, kopyalanmış çalışma zamanı/kişisel veri dosyaları ve yapay zekâ
//      asistanına özel kalıntılar (izinli atıf satırları dışında). Dosya ve klasör ADLARI da taranır; ikili dosyalarda
//      (görseller vb.) kişisel adlar aranır. Bulgu varsa yüksek sesle başarısız olur (çıkış kodu 1), zip üretmez.
//   4. --paket verilirse temiz kopyadan sürüm zip'i (YerelAIStudyosu-<sürüm>.zip), SHA256SUMS.txt üretir ve Kurulum.bat'ı
//      yanlarına kopyalar. Sürüm: --surum, yoksa kökteki VERSION dosyası, o da yoksa bugünün tarihi (YYYY.AA.GG).
//      Sürüm, kopyaya VERSION dosyası olarak yazılır (Kurulum.bat güncellemede "kurulu → yeni sürüm" gösterir).
//      --zip <dosya.zip> eski kullanım: yalnızca zip + SHA256SUMS.txt (Kurulum.bat kopyalanmaz).
//
// Çalışma kopyası hiç değiştirilmez (yalnızca okunur).
// Kişisel adlar betiğe YAZILMAZ (betik de yayımlanır). Taranacak adlar çalışma anında toplanır:
//   - Kurulum.bat'taki $Repo satırının sahibi (GitHub kullanıcı adı; "HESAP" yer tutucusu değilse); tam "sahip/depo"
//     dizisine yalnızca DEPO_ADI_IZINLI_DOSYALAR içinde izin verilir, başka her geçişi bulgudur
//   - git uzak deposunun (remote) sahibi ve git user.email'in @ öncesi kısmı (çoğu zaman GitHub kullanıcı adıdır)
//   - bu bilgisayardaki ses klonu onay kayıtlarında yazan bilgisayar kullanıcısı adı (app/config, app/reference-voices)
//   - işletim sistemi kullanıcı adı ve git user.name (genel adlar hariç)
//   - --isim ile verilenler, --isimler-dosyasi <dosya> (proje dışında tutulabilir), YAS_OZEL_ISIMLER ortam değişkeni
//     (";" ya da "," ile ayrılmış) ve scripts/yayin/ozel-isimler.txt (her satıra bir ad; "#" yorum; dışa aktarılmaz, git'e girmez)
//   Tam adlardan ("Ad İkinci SOYAD") kullanıcı adı biçimleri de türetilir: adsoyad, ad.soyad, ad_soyad, baş harfler+soyad
//   (ör. "a"+"i"+"soyad"), ilk harf+soyad; Türkçe harfler ASCII'ye çevrilmiş halleri de taranır.
//   Yayın paketi (--paket / --zip, --deneme olmadan) için ad listesi BOŞ OLAMAZ: hiçbir kaynaktan ad bulunamazsa betik durur.
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Argümanlar
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function argAl(ad) {
  const i = argv.indexOf(ad);
  if (i < 0) return null;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}
const ekIsimler = [];
for (let i = argv.indexOf("--isim"); i >= 0; i = argv.indexOf("--isim")) { ekIsimler.push(argv[i + 1]); argv.splice(i, 2); }
const zipYolu = argAl("--zip");
const paketArg = argAl("--paket");
const surumArg = argAl("--surum");
const kaynakArg = argAl("--kaynak");
const depoArg = argAl("--depo");
const isimDosyasiArg = argAl("--isimler-dosyasi");
const zorla = argv.includes("--zorla");
const deneme = argv.includes("--deneme");
const konumsal = argv.filter((a) => !a.startsWith("--"));
if (konumsal.length !== 1) {
  console.error("Kullanım: node scripts/yayin/disa-aktar.cjs <hedef-klasör> [--paket <paket-klasörü>] [--surum 1.0.0] [--zip <dosya.zip>] [--depo sahip/ad] [--deneme] [--kaynak <kök>] [--isim Ad] [--isimler-dosyasi <dosya>] [--zorla]");
  process.exit(2);
}
if (isimDosyasiArg !== null && !fs.existsSync(path.resolve(isimDosyasiArg))) {
  console.error(`--isimler-dosyasi bulunamadı: ${isimDosyasiArg}`);
  process.exit(2);
}
if (zipYolu && paketArg) {
  console.error("--zip ve --paket birlikte kullanılamaz (--paket zip'i paket klasörüne kendisi yazar).");
  process.exit(2);
}
const KAYNAK = path.resolve(kaynakArg || path.join(__dirname, "..", ".."));
const HEDEF = path.resolve(konumsal[0]);
const ISARET_DOSYASI = ".disa-aktarim";

const kirmizi = (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const yesil = (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const sari = (s) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s);
function dur(mesaj) { console.error(kirmizi("\n  HATA: " + mesaj + "\n")); process.exit(1); }

// ---------------------------------------------------------------------------
// Güvenlik denetimleri: hedef kaynağın içinde/üstünde olamaz; dolu klasöre yazılmaz
// ---------------------------------------------------------------------------
const icinde = (ust, alt) => { const r = path.relative(ust, alt); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };
if (!fs.existsSync(path.join(KAYNAK, "scripts", "server", "serve.cjs"))) dur(`Kaynak proje kökü değil: ${KAYNAK}`);
if (icinde(KAYNAK, HEDEF)) dur("Hedef klasör projenin içinde olamaz (kopya kendini içerirdi). Proje dışında bir klasör verin.");
if (icinde(HEDEF, KAYNAK)) dur("Hedef klasör projeyi içeren bir üst klasör olamaz.");
if (path.parse(HEDEF).root === HEDEF) dur("Hedef bir sürücü kökü olamaz.");

// GitHub deposu: Kurulum.bat'taki $Repo satırı tek kaynaktır. "HESAP" yer tutucusu dururken yayın paketi üretilmez.
const YER_TUTUCU_SAHIP = "HESAP";
const DEPO_DESENI = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})$/;
const DEPO_KAYNAK = depoAdiOku(KAYNAK);
let DEPO_HEDEF = null;
if (depoArg) {
  const m = String(depoArg).trim().match(DEPO_DESENI);
  if (!m) dur(`Geçersiz --depo değeri: "${depoArg}" (biçim: sahip/YerelAIStudyosu).`);
  if (m[1].toUpperCase() === YER_TUTUCU_SAHIP) dur("--depo için gerçek bir GitHub hesabı verin (HESAP yer tutucudur).");
  DEPO_HEDEF = { tam: `${m[1]}/${m[2]}`, sahip: m[1], depo: m[2] };
}
const YER_TUTUCU = !DEPO_HEDEF && (!DEPO_KAYNAK || DEPO_KAYNAK.sahip.toUpperCase() === YER_TUTUCU_SAHIP);
if ((paketArg || zipYolu) && YER_TUTUCU && !deneme) {
  dur("GitHub deposu henüz belirlenmedi (Kurulum.bat: $Repo = 'HESAP/YerelAIStudyosu', yayından önce doldurulacak).\n" +
    "  Yayın paketi üretilmedi. Seçenekler:\n" +
    "    --depo <sahip>/YerelAIStudyosu   yer tutucuyu kopyada doldurur (Kurulum.bat) ve yayın paketi üretir\n" +
    "    --deneme                         yalnızca yerel deneme paketi (zip'in yanındaki Kurulum.bat yerel paketten kurar; GitHub'a yüklemeyin)");
}
if (fs.existsSync(HEDEF)) {
  const icerik = fs.readdirSync(HEDEF);
  if (icerik.length) {
    if (!zorla || !icerik.includes(ISARET_DOSYASI)) {
      dur(`Hedef klasör boş değil: ${HEDEF}\n  Yalnızca daha önce bu betiğin oluşturduğu bir klasör --zorla ile yeniden yazılabilir.`);
    }
    fs.rmSync(HEDEF, { recursive: true, force: true });
  }
}

// Sürüm ve paket klasörü (kopyalamaya başlamadan önce denetlenir; hata varsa hiçbir şey yazılmaz)
const SURUM_DESENI = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,40}$/;
function surumBul() {
  if (surumArg) return { surum: surumArg.trim(), kaynak: "--surum" };
  try {
    const v = fs.readFileSync(path.join(KAYNAK, "VERSION"), "utf8").trim();
    if (v) return { surum: v, kaynak: "VERSION dosyası" };
  } catch (_) {}
  const t = new Date();
  const iki = (n) => String(n).padStart(2, "0");
  return { surum: `${t.getFullYear()}.${iki(t.getMonth() + 1)}.${iki(t.getDate())}`, kaynak: "bugünün tarihi" };
}
const SURUM = paketArg || surumArg ? surumBul() : null;
if (SURUM && !SURUM_DESENI.test(SURUM.surum)) dur(`Geçersiz sürüm: "${SURUM.surum}" (harf, rakam, . _ + - kullanın; ör. 1.0.0).`);
const PAKET_ONEKI = "YerelAIStudyosu";
const PAKET = paketArg ? path.resolve(paketArg) : null;
const PAKET_ISARETI = ".disa-aktarim-paketi";
if (PAKET) {
  if (icinde(KAYNAK, PAKET)) dur("Paket klasörü projenin içinde olamaz.");
  if (icinde(PAKET, KAYNAK)) dur("Paket klasörü projeyi içeren bir üst klasör olamaz.");
  if (icinde(HEDEF, PAKET) || icinde(PAKET, HEDEF)) dur("Paket klasörü ile dışa aktarma klasörü iç içe olamaz.");
  if (path.parse(PAKET).root === PAKET) dur("Paket klasörü bir sürücü kökü olamaz.");
  if (fs.existsSync(PAKET)) {
    // Yalnızca bu betiğin daha önce oluşturduğu paket klasörü yeniden yazılır (başka dosyalar silinmez)
    const bizim = (ad) => ad === PAKET_ISARETI || ad === "Kurulum.bat" || ad === "SHA256SUMS.txt" || (ad.startsWith(PAKET_ONEKI) && ad.endsWith(".zip"));
    const icerik = fs.readdirSync(PAKET);
    const yabanci = icerik.filter((ad) => !bizim(ad));
    if (yabanci.length) dur(`Paket klasöründe başka dosyalar var: ${yabanci.slice(0, 5).join(", ")}\n  Boş ya da yeni bir klasör verin.`);
    const eskiZipler = icerik.filter((ad) => ad.startsWith(PAKET_ONEKI) && ad.endsWith(".zip") && ad !== `${PAKET_ONEKI}-${SURUM.surum}.zip`);
    if (eskiZipler.length && !zorla) dur(`Paket klasöründe eski paket(ler) var: ${eskiZipler.join(", ")}\n  Kurulum.bat yanlış zip'i seçmesin diye --zorla ile silinmeleri gerekir.`);
  }
}

// ---------------------------------------------------------------------------
// Kurallar
// ---------------------------------------------------------------------------
// Kökte yalnızca bunlar dışa aktarılır (geri kalan her şey — geliştirici not klasörleri, _to_delete, .git, yedekler,
// YAYIN-DENETIMI.md gibi bakımcı belgeleri — dışarıda kalır)
const KOK_IZINLI = new Set([
  ".gitattributes", ".gitignore", "README.md", "LICENSE", "ATIFLAR.md", "DEGISIKLIKLER.md",
  "Kurulum.bat", "windows.bat", "windows-dev.bat", "linux.sh", "mac.sh", "ses-motoru-kur.bat",
  "logo.png", "logo.txt", "scripts", "app", "VERSION",
]);
// app/ altında yalnızca kaynak kod ve belgeler
const APP_IZINLI = new Set(["frontend", "is-kuyrugu"]);
const IS_KUYRUGU_IZINLI = new Set(["BENIOKU.md", "stiller.json"]);
// Her yerde dışarıda kalan adlar
const AD_YASAK = [
  /^node_modules$/i, /^\.git$/i, /^__pycache__$/i, /^_to_delete$/i, /^.+ outputs$/i,
  // yedekler: yedek-1103/, yedek_eski.js, serve.cjs.yedek-0224, Generator.jsx.yedek, x-yedek.md, backup/
  /^yedek(?:$|[-_ .\d])/i, /\.yedek/i, /[-_ ]yedek(\b|[-_.]|$)/i, /^backups?([-_ .]|$)/i, /[-_.]backup([-_.]|$)/i, /~$/,
  // yama / entegrasyon çalışma klasörleri ve yama dosyaları
  /^(entegrasyon|yamalar|yama|patches)([-_ ].*)?$/i, /\.(patch|diff|rej)$/i,
  // geliştirici / yapay zekâ asistanı notları ve klasörleri (adı asistanla başlayan her şey: .claude, CLAUDE.md, claude-isleri…)
  /^(test-?notlari|test-notes|yol-haritasi|yayin-mesajlari|notlar|notes|todo)(\..*)?$/i, /notlari\.(md|txt)$/i,
  /^\.?claude/i, /^agents\.md$/i,
  // çalışma zamanı verisi ve kullanıcı verisi (app/ izin listesine ek emniyet; kaynak kodda bu adlarla klasör yok)
  /^(outputs|cache|\.cache|logs?|gunlukler|kullanicilar|kullanıcılar|users|oturumlar|sessions)$/i,
  /^(kullanicilar|users|oturumlar|sessions|hafiza)\.json$/i,
  /^dist(-.*)?$/i, /^cikti$/i, /^\.agents$/i, /^\.active_modules_os$/i, /^\.vscode$/i, /^\.idea$/i,
  /^\.env(\..*)?$/i, /^\.ds_store$/i, /^thumbs\.db$/i, /^desktop\.ini$/i, /^ISARET$/,
  /^bulut-anahtarlari\.json/i, /^ilk-kurulum\.json$/i, /^etkin-modeller\.json$/i, /^model-etiketleri\.json$/i,
  /^llm-model-settings\.json$/i, /^motor-gunlugu\.txt$/i, /^durum\.json$/i, /^ozel-isimler\.txt$/i, /^\.disa-aktarim/i,
  // kişisel veri ve anahtarlar (normalde app/ altında zaten dışarıda; başka yere düşmüşse de alınmaz)
  /\.onay\.json$/i, /^hf-token\.txt$/i, /^uzak-erisim-anahtari\.txt$/i, /^klon-ayarlari\.json$/i, /^model-surumleri\.json$/i,
  /^guncelleme\.json$/i, /^chat_\d+\.json$/i, /^(chat-history|reference-voices|transcriptions|tts-outputs|tts-cache)$/i,
  /\.(pem|key|p12|pfx|kdbx)$/i,
  /\.(bak|orig|old|tmp|part|log|pyc|pyo|swp)$/i,
  // ağır / ikili / lisanslı dosyalar: kurulum ve sihirbaz indirir
  /\.(gguf|safetensors|ckpt|pt|pth|bin|onnx|npz|h5|tflite|mlmodel|coreml|zip|7z|rar|tar|gz|tgz|xz|exe|dll|so|dylib|msi|wav|mp3|flac|ogg|m4a|mp4|webm|mkv|avi)$/i,
];
// Belirli yollar (eğik çizgili göreli yol)
const YOL_YASAK = [
  "scripts/ddyz_watchdog.sh",          // orijinal geliştiricinin makinesine özgü mutlak yol içerir
  "scripts/_localize_all.cjs",         // bir kerelik yerelleştirme aracı; orijinal geliştiricinin kullanıcı klasörü yolunu içerir
];
const AZAMI_BOYUT = 2 * 1024 * 1024;   // tek dosya üst sınırı (logo.png ~0,85 MB)
// GitHub depo adı ("sahip/depo", Kurulum.bat'taki $Repo) yalnızca bu dosyalarda ve yalnızca tam haliyle geçebilir.
// Sahibin adı tek başına (ya da başka dosyalarda) kişisel ad olarak işaretlenir. README.md göreli bağlantı kullanır
// (../../releases); eski bir README depo adını içeriyorsa --depo onu da günceller.
const DEPO_ADI_IZINLI_DOSYALAR = new Set(["Kurulum.bat", "README.md"]);
// Geliştirici atfı: depo sahibinin GitHub kullanıcı adı (kişisel ad değil, geliştiricinin kendi seçimi) atıf belgelerinde serbesttir
const GELISTIRICI_ATIF_DOSYALARI = new Set(["README.md", "ATIFLAR.md", "DEGISIKLIKLER.md"]);
const DEPO_ADI_ZORUNLU_DOSYA = "Kurulum.bat";

function disaridaMi(rel, ad, ust) {
  if (AD_YASAK.some((r) => r.test(ad))) return "yasak ad/uzantı";
  if (YOL_YASAK.includes(rel)) return "makineye özgü dosya";
  const parcalar = rel.split("/");
  if (parcalar.length === 1 && !KOK_IZINLI.has(ad)) return "kök izin listesinde değil";
  if (parcalar[0] === "app") {
    if (parcalar.length === 2 && !APP_IZINLI.has(parcalar[1])) return "app/ altında çalışma zamanı verisi";
    if (parcalar[1] === "is-kuyrugu" && parcalar.length >= 3 && !(parcalar.length === 3 && IS_KUYRUGU_IZINLI.has(parcalar[2]))) return "iş kuyruğu kayıtları";
  }
  if (rel === "scripts/yayin/ozel-isimler.txt") return "özel ad listesi";
  return null;
}

// Yayın dönüşümleri: kopyada yapılır. Bulunamayan dönüşüm uyarı verir (kaynak zaten genelleştirilmiş olabilir).
// Kaynakta genelleştirilemeyen (başka çalışmanın sürdüğü) dosyalardaki geliştiriciye özgü kalıntılar burada temizlenir;
// kalan her şeyi aşağıdaki "ASİSTAN" taraması yakalar ve yayını durdurur.
const VARSAYILAN_GORSEL_MODELI = "CyberRealistic_V8_FP16.safetensors"; // ilk kurulum sihirbazının denenmiş görsel modeli
const DONUSUMLER = [
  // Kaynakta yamayla düzeltilenler (yamalar/*-bagimsiz.cjs) burada "zaten genel" görünür; yama uygulanmamışsa kopyada düzeltilir.
  { dosya: "app/frontend/src/components/TextChat.jsx", eski: "\"claude-DreamShaper_8-q8_0.gguf\"", yeni: `"${VARSAYILAN_GORSEL_MODELI}"`, hepsi: true, ad: "Sohbetten görsel: geliştiricinin yerel model adı → denenmiş varsayılan" },
  { dosya: "scripts/server/serve.cjs", eski: "const VEGA_GORSEL_MODELI = \"claude-DreamShaper_8-q8_0.gguf\";", yeni: `const VEGA_GORSEL_MODELI = "${VARSAYILAN_GORSEL_MODELI}"; // istemci model göndermezse: ilk kurulum sihirbazının denenmiş görsel modeli`, ad: "Sohbetten görsel: sunucu varsayılan modeli" },
  { dosya: "app/frontend/src/components/Generator.jsx", eski: "Arka planda Claude'un bir görsel işi çalışıyor:", yeni: "Arka planda bir görsel işi çalışıyor (sohbetten istenen görsel ya da otomasyon kuyruğu):", ad: "Kuyruk uyarısı (arayüz)" },
  { dosya: "app/frontend/src/components/Generator.jsx", eski: "Model değiştirirseniz Claude'un işi durup", yeni: "Model değiştirirseniz bu iş durup", ad: "Kuyruk uyarısı (arayüz 2)" },
  { dosya: "app/frontend/src/services/api.js", eski: "// Claude iş kuyruğunun durumu", yeni: "// Otomasyon kuyruğunun durumu", ad: "Kuyruk durumu (yorum)" },
  { dosya: "ses-motoru-kur.bat", eski: "Yukaridaki hatayi Claude'a iletin.", yeni: "Yukaridaki hatayi GitHub'da sorun (issue) olarak bildirin.", ad: "Kurulum hata metni" },
];

// Tarama kalıpları
const GIZLI_KALIPLAR = [
  { ad: "Hugging Face jetonu", r: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { ad: "OpenAI/Anthropic anahtarı", r: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
  { ad: "Google API anahtarı", r: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { ad: "GitHub jetonu", r: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/g },
  { ad: "OpenRouter anahtarı", r: /\bsk-or-v1-[a-f0-9]{40,}/g },
  { ad: "AWS erişim anahtarı", r: /\bAKIA[0-9A-Z]{16}\b/g },
  { ad: "Slack jetonu", r: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { ad: "Özel anahtar", r: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { ad: "Gömülü Bearer jetonu", r: /Bearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}/g },
  { ad: "Anahtar ataması", r: /\b(?:api[_-]?key|apikey|secret|token|password|parola|sifre)\s*[:=]\s*["'][A-Za-z0-9_\-.]{16,}["']/gi },
];
const YOL_KALIPLARI = [
  // Sürücü harfli mutlak yollar; sistem klasörleri (C:\Windows, C:\Program Files…), "C:\Users\<...>" yer tutucusu ve
  // sürücü kökündeki genel uygulama klasörü (D:\YerelAIStudyosu) hariç
  { ad: "Mutlak Windows yolu", r: /\b[A-Za-z]:\\{1,2}(?!Windows\b|Program Files|\.\.\.|ProgramData\b|Users\\{1,2}(?:Public\b|<)|YerelAIStudyosu\b)[A-Za-z0-9 _.-]{2,}(?:\\{1,2}[^\\\s"'`<>|]+)*/g },
  { ad: "Mutlak Windows yolu (/)", r: /\b[A-Za-z]:\/(?!Windows\/|Program Files|\.\.\.)[A-Za-z0-9 _.-]{2,}\//g },
  { ad: "Kullanıcı klasörü yolu", r: /(?:\/home\/|\/Users\/)(?!runner\b|user\b|\$|<|\{)[A-Za-z0-9._-]+\//g },
];
// Yapay zekâ asistanına özgü kalıntılar: uygulama hiçbir asistan olmadan çalışmalı. Yalnızca atıf satırları
// ("Claude (Anthropic) ile geliştiriliyor") ve bulut sağlayıcı kataloğu (Anthropic API, model kimlikleri) serbesttir.
const ASISTAN = /claude/gi;
const ASISTAN_IZINLI_SATIR = [
  /Claude \(Anthropic\)/, /Anthropic \(Claude\)/, /developed with Claude/i,
  /\bclaude-(?:sonnet|haiku|opus)[\w.-]*/, /anthropic\/claude-/, /\bkisa: "Claude"/, /\banthropic: "Claude"/,
  /Claude Pro\/Max/, /OpenAI, Gemini, Claude ya da OpenRouter/,
];
// Bu betik dönüştürdüğü ve aradığı kalıpları adıyla anmak zorunda; asistan taramasından muaftır (diğer taramalar geçerli)
const ASISTAN_TARAMA_MUAF = new Set(["scripts/yayin/disa-aktar.cjs"]);
// Kopyaya hiç girmemesi gereken çalışma zamanı / kişisel veri yolları (ikinci emniyet)
const KISISEL_VERI_YOLU = [
  /^app\/(?!frontend\/|is-kuyrugu\/(?:BENIOKU\.md|stiller\.json)$)/,
  /(^|\/)(chat-history|reference-voices|transcriptions|tts-outputs|tts-cache|kullanicilar|users|oturumlar|sessions|outputs|cache)\//,
  /(^|\/)(yedek[^/]*|[^/]* outputs|_to_delete|entegrasyon[^/]*|yamalar)\//i, /\.yedek/i,
  /(^|\/)(etkin-modeller|model-etiketleri|llm-model-settings|bulut-anahtarlari|ilk-kurulum|klon-ayarlari|model-surumleri|guncelleme|durum)\.json$/,
  /\.onay\.json$/, /(^|\/)(hf-token|uzak-erisim-anahtari|motor-gunlugu|ozel-isimler)\.txt$/, /(^|\/)chat_\d+\.json$/,
];
const EPOSTA = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EPOSTA_IZINLI = new Set(["noreply@anthropic.com"]);
const EPOSTA_IZINLI_ALAN = /@(example\.(com|org)|localhost|users\.noreply\.github\.com)$/i;

// Kurulum.bat'taki GitHub deposu: $Repo = 'sahip/depo'
function depoAdiOku(kok) {
  try {
    const m = fs.readFileSync(path.join(kok, "Kurulum.bat"), "utf8").match(/^\s*\$Repo\s*=\s*'([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)'/m);
    if (m) return { tam: `${m[1]}/${m[2]}`, sahip: m[1], depo: m[2] };
  } catch (_) {}
  return null;
}
// Kopyadaki depo (--depo verildiyse o). Yer tutucu kalmışsa sahip adı kişisel ad taramasına eklenmez.
const DEPO = DEPO_HEDEF || DEPO_KAYNAK;
const DEPO_YER_TUTUCU = !DEPO || DEPO.sahip.toUpperCase() === YER_TUTUCU_SAHIP;
// Atıf adları (orijinal geliştirici ve depoları): kişisel ad taramasına eklenmez, README/ATIFLAR'da geçmesi gerekir
const ATIF_ADLARI = /^(DDYapayZeka|DD:?YZ|DDYZ|Tech ?Jarves|Anthropic|Claude)$/i;

const GENEL_KULLANICI_ADLARI = /^(noreply|no-reply|user|users|kullanici|kullanıcı|admin|administrator|yonetici|yönetici|root|runner|owner|pc|guest|misafir|default|public|claude|node|ubuntu|vagrant|test)$/i;
// Türkçe harfleri ASCII'ye çevirir (kullanıcı adları ve e-posta önekleri çoğu zaman ASCII'dir): "Gökçe Şahin" → "Gokce Sahin"
function asciiKatla(s) {
  return String(s).replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
// Tam addan kullanıcı adı biçimleri: adsoyad, ad.soyad, ad_soyad, ad-soyad, baş harfler+soyad, ilk harf+soyad, soyadad.
// Yalnızca 5+ karakterliler eklenir (kısa birleşimler sıradan sözcüklerle çakışabilir).
function adVaryantlari(tam) {
  const p = asciiKatla(tam).toLowerCase().split(/\s+/).map((x) => x.replace(/[^a-z0-9]/g, "")).filter((x) => x.length >= 2);
  if (p.length < 2) return [];
  const ilk = p[0];
  const son = p[p.length - 1];
  const bas = p.slice(0, -1).map((x) => x[0]).join("");
  return [ilk + son, `${ilk}.${son}`, `${ilk}_${son}`, `${ilk}-${son}`, bas + son, ilk[0] + son, son + ilk, p.join("")]
    .filter((v) => v.replace(/[._-]/g, "").length >= 5);
}
function adEkle(liste, ham, tamAd) {
  const s = String(ham || "").trim();
  if (!s || ATIF_ADLARI.test(s)) return;
  const ekle = (x) => { liste.push(x); const k = asciiKatla(x); if (k !== x) liste.push(k); };
  if (tamAd) {
    // "Ad İkinci SOYAD": tamamı + ilk ve son sözcük + kullanıcı adı biçimleri. Ortadaki adlar Türkçede sık kelime
    // olabilir (ör. "Emin"); tek başına eklenmez, yalnızca birleşimlerde kullanılır.
    const parcalar = s.split(/\s+/).filter((p) => p.length >= 3 && !GENEL_KULLANICI_ADLARI.test(p));
    if (parcalar.length > 1) ekle(s);
    if (parcalar.length) { ekle(parcalar[0]); ekle(parcalar[parcalar.length - 1]); }
    for (const v of adVaryantlari(s)) liste.push(v);
    return;
  }
  if (s.length >= 3 && !GENEL_KULLANICI_ADLARI.test(s)) ekle(s);
}
// Yalnızca depo sahibinden gelmeyen adlar "verilmiş ad" sayılır (yayın paketi için en az bir tane gerekir)
function isimListesi(depoSahipleriHaric) {
  const liste = [];
  for (const ad of ekIsimler) { if (/\s/.test(String(ad || "").trim())) adEkle(liste, ad, true); else if (ad) liste.push(String(ad).trim()); }
  if (!depoSahipleriHaric) {
    if (DEPO && !DEPO_YER_TUTUCU) adEkle(liste, DEPO.sahip);
    if (DEPO_KAYNAK && DEPO_KAYNAK.sahip.toUpperCase() !== YER_TUTUCU_SAHIP) adEkle(liste, DEPO_KAYNAK.sahip);
  }
  // Bu bilgisayarın kullanıcısının adı: ses klonu onay kayıtlarında yazar (bu dosyalar zaten dışa aktarılmaz)
  const onayDosyalari = [path.join(KAYNAK, "app", "config", "klon-ayarlari.json")];
  try {
    const rv = path.join(KAYNAK, "app", "reference-voices");
    for (const ad of fs.readdirSync(rv)) if (ad.endsWith(".onay.json")) onayDosyalari.push(path.join(rv, ad));
  } catch (_) {}
  for (const dosya of onayDosyalari) {
    try {
      const metin = fs.readFileSync(dosya, "utf8");
      for (const m of metin.matchAll(/"bilgisayarKullanicisi"\s*:\s*"([^"]{3,80})"/g)) adEkle(liste, m[1], true);
    } catch (_) {}
  }
  try { adEkle(liste, require("os").userInfo().username); } catch (_) {}
  adEkle(liste, process.env.USERNAME);
  const git = (...a) => {
    try { return require("child_process").execFileSync("git", a, { cwd: KAYNAK, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim(); } catch (_) { return ""; }
  };
  const gitAdi = git("config", "user.name");
  if (gitAdi) adEkle(liste, gitAdi, true);
  // git user.email'in @ öncesi (ör. "12345+kullanici@users.noreply.github.com" → "kullanici") ve uzak depo sahipleri
  const eposta = git("config", "user.email");
  if (eposta.includes("@")) adEkle(liste, eposta.split("@")[0].replace(/^\d+\+/, ""));
  for (const satir of git("remote", "-v").split(/\r?\n/)) {
    const m = satir.match(/github\.com[:/]([A-Za-z0-9-]+)\//i);
    if (m) adEkle(liste, m[1]);
  }
  // Çalışma anında verilen ad listeleri: ozel-isimler.txt (dışa aktarılmaz), --isimler-dosyasi, YAS_OZEL_ISIMLER.
  // Boşluk içeren satır tam ad sayılır (ilk/son sözcük ve kullanıcı adı biçimleri de taranır).
  const satirEkle = (satir) => {
    const s = String(satir || "").trim();
    if (!s || s.startsWith("#")) return;
    if (/\s/.test(s)) adEkle(liste, s, true);
    else { liste.push(s); const k = asciiKatla(s); if (k !== s) liste.push(k); }
  };
  const dosyalar = [path.join(KAYNAK, "scripts", "yayin", "ozel-isimler.txt")];
  if (isimDosyasiArg) dosyalar.push(path.resolve(isimDosyasiArg));
  for (const dosya of dosyalar) {
    try { for (const satir of fs.readFileSync(dosya, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) satirEkle(satir); } catch (_) {}
  }
  for (const parca of String(process.env.YAS_OZEL_ISIMLER || "").split(/[;,]/)) satirEkle(parca);
  const temiz = liste.map((s) => String(s || "").trim()).filter((s) => s.length >= 3 && !ATIF_ADLARI.test(s));
  // Büyük/küçük harf duyarsız tekilleştirme
  const gorulen = new Set();
  return temiz.filter((s) => { const k = s.toLocaleLowerCase("tr"); if (gorulen.has(k)) return false; gorulen.add(k); return true; });
}

const METIN_UZANTI = /\.(js|cjs|mjs|jsx|ts|tsx|json|md|txt|bat|cmd|ps1|psm1|sh|py|html|htm|css|svg|yml|yaml|toml|ini|cfg|gitignore|gitattributes|xml|csv)$/i;
function metinMi(yol, tampon) {
  if (METIN_UZANTI.test(yol) || !path.extname(yol)) return !tampon.subarray(0, 8192).includes(0);
  return false;
}

// ---------------------------------------------------------------------------
// 1) Kopyala
// ---------------------------------------------------------------------------
const kopyalanan = [];
const disarida = new Map(); // sebep -> örnek yollar
function disariyaEkle(sebep, rel) {
  if (!disarida.has(sebep)) disarida.set(sebep, []);
  disarida.get(sebep).push(rel);
}

function gez(mutlak, rel) {
  let girdiler;
  try { girdiler = fs.readdirSync(mutlak, { withFileTypes: true }); } catch (err) { dur(`Okunamadı: ${mutlak} (${err.message})`); }
  girdiler.sort((a, b) => a.name.localeCompare(b.name));
  for (const g of girdiler) {
    const r = rel ? `${rel}/${g.name}` : g.name;
    const m = path.join(mutlak, g.name);
    const sebep = disaridaMi(r, g.name);
    if (sebep) { disariyaEkle(sebep, r + (g.isDirectory() ? "/" : "")); continue; }
    if (g.isSymbolicLink()) { disariyaEkle("sembolik bağlantı", r); continue; }
    if (g.isDirectory()) { gez(m, r); continue; }
    if (!g.isFile()) continue;
    const boyut = fs.statSync(m).size;
    if (boyut > AZAMI_BOYUT) { disariyaEkle("çok büyük (>2 MB)", r); continue; }
    const hedefYol = path.join(HEDEF, ...r.split("/"));
    fs.mkdirSync(path.dirname(hedefYol), { recursive: true });
    fs.copyFileSync(m, hedefYol);
    try { const st = fs.statSync(m); fs.utimesSync(hedefYol, st.atime, st.mtime); } catch (_) {}
    kopyalanan.push(r);
  }
}

// Kişisel ad listesi kopyalamadan ÖNCE toplanır: yayın paketi için boş olamaz (adlar betiğe yazılmaz, çalışma anında verilir)
const isimler = isimListesi(false);
const verilenAdSayisi = isimListesi(true).length;
const YAYIN_PAKETI = Boolean(paketArg || zipYolu) && !deneme;
if (!verilenAdSayisi && YAYIN_PAKETI) {
  dur("Taranacak kişisel ad bulunamadı; yayın paketi kişisel ad taraması olmadan üretilmez.\n" +
    "  Adları çalışma anında verin (hiçbiri dışa aktarılmaz):\n" +
    "    --isim \"Ad Soyad\" --isim kullaniciadi        (birden çok kez verilebilir)\n" +
    "    --isimler-dosyasi <proje dışındaki bir dosya>  (her satıra bir ad)\n" +
    "    YAS_OZEL_ISIMLER=\"Ad Soyad;kullaniciadi\"      (ortam değişkeni)\n" +
    "    scripts/yayin/ozel-isimler.txt                (git'e girmez)");
}

console.log(`\n  Yerel AI Stüdyosu — yayın kopyası`);
console.log(`  Kaynak : ${KAYNAK}`);
console.log(`  Hedef  : ${HEDEF}\n`);
fs.mkdirSync(HEDEF, { recursive: true });
gez(KAYNAK, "");
fs.writeFileSync(path.join(HEDEF, ISARET_DOSYASI), JSON.stringify({ olusturan: "scripts/yayin/disa-aktar.cjs", tarih: new Date().toISOString() }, null, 2));

// ---------------------------------------------------------------------------
// 2) Dönüşümler
// ---------------------------------------------------------------------------
const donusumRaporu = [];
const kacis = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Kişisel adlı eski varsayılanlar (ör. "<Ad>'in bilgisayarında") ad betiğe yazılmadan genelleştirilir
for (const ad of isimler.filter((s) => !/\s/.test(s))) {
  for (const dosya of ["app/frontend/src/App.jsx", "app/frontend/src/components/TextChat.jsx"]) {
    const yol = path.join(HEDEF, ...dosya.split("/"));
    if (!fs.existsSync(yol)) continue;
    const metin = fs.readFileSync(yol, "utf8");
    const yeni = metin
      .replace(new RegExp(`${kacis(ad)}'(?:in|ın|un|ün|nin|nın|nun|nün) bilgisayarında`, "g"), "Bu bilgisayarda")
      .replace(new RegExp(`\\(${kacis(ad)}'(?:in|ın|un|ün|nin|nın|nun|nün) denemesinde`, "g"), "(ilk denemelerde");
    if (yeni !== metin) {
      fs.writeFileSync(yol, yeni, "utf8");
      donusumRaporu.push({ d: { ad: `Kişisel adlı varsayılan metin genelleştirildi (${dosya})` }, sonuc: "uygulandı" });
    }
  }
}
for (const d of DONUSUMLER) {
  const yol = path.join(HEDEF, ...d.dosya.split("/"));
  if (!fs.existsSync(yol)) { donusumRaporu.push({ d, sonuc: "dosya yok" }); continue; }
  const metin = fs.readFileSync(yol, "utf8");
  const adet = metin.split(d.eski).length - 1;
  if (!adet) { donusumRaporu.push({ d, sonuc: metin.includes(d.yeni) ? "zaten genel" : "bulunamadı" }); continue; }
  const yeni = d.hepsi ? metin.split(d.eski).join(d.yeni) : metin.replace(d.eski, () => d.yeni);
  fs.writeFileSync(yol, yeni, "utf8");
  donusumRaporu.push({ d, sonuc: `uygulandı (${d.hepsi ? adet : 1})` });
}
// --depo: yer tutucu (ya da Kurulum.bat'taki eski depo) yalnızca kopyada gerçek depoyla değiştirilir
if (DEPO_HEDEF && DEPO_KAYNAK && DEPO_HEDEF.tam !== DEPO_KAYNAK.tam) {
  for (const dosya of DEPO_ADI_IZINLI_DOSYALAR) {
    const yol = path.join(HEDEF, ...dosya.split("/"));
    const d = { ad: `GitHub deposu ${DEPO_KAYNAK.tam} → ${DEPO_HEDEF.tam} (${dosya})` };
    if (!fs.existsSync(yol)) { donusumRaporu.push({ d, sonuc: "dosya yok" }); continue; }
    const metin = fs.readFileSync(yol, "utf8");
    const adet = metin.split(DEPO_KAYNAK.tam).length - 1;
    if (adet) fs.writeFileSync(yol, metin.split(DEPO_KAYNAK.tam).join(DEPO_HEDEF.tam), "utf8");
    donusumRaporu.push({ d, sonuc: adet ? `uygulandı (${adet})` : dosya === DEPO_ADI_ZORUNLU_DOSYA ? "bulunamadı" : "zaten genel" });
  }
  if ((depoAdiOku(HEDEF) || {}).tam !== DEPO_HEDEF.tam) dur("Kopyadaki Kurulum.bat'ta $Repo satırı --depo ile güncellenemedi.");
}

// ---------------------------------------------------------------------------
// 3) Tarama
// ---------------------------------------------------------------------------
const bulgular = [];
// Sözcük sınırıyla eşleşir (Türkçe harfler dahil): "Ada" adı "Adana"yı işaretlemez
const isimKalibi = new RegExp(`(?<![\\p{L}\\p{N}_])(${(isimler.length ? isimler : ["\\u0000yok"]).map(kacis).join("|")})(?![\\p{L}\\p{N}_])`, "giu");

function satirNo(metin, indeks) { return metin.slice(0, indeks).split("\n").length; }
function ozetle(s) { return s.length > 12 ? s.slice(0, 6) + "…" + "(" + s.length + " karakter)" : s; }

// İkili dosyalarda (görsel meta verisi vb.) yalnızca 5+ karakterli adlar aranır; kısa adlar rastgele baytlarla çakışabilir
const uzunIsimler = isimler.filter((s) => s.length >= 5);
const ikiliIsimKalibi = uzunIsimler.length ? new RegExp(`(${uzunIsimler.map(kacis).join("|")})`, "gi") : null;

for (const rel of kopyalanan) {
  // Dosya ve klasör adları: kişisel ad, asistan adı, e-posta
  for (const m of rel.matchAll(isimKalibi)) bulgular.push({ tur: "İSİM", ad: "Kişisel ad (dosya/klasör adında)", rel, satir: 0, ornek: m[0][0] + "…" });
  if (!ASISTAN_TARAMA_MUAF.has(rel) && /claude/i.test(rel)) bulgular.push({ tur: "ASİSTAN", ad: "Asistan adı dosya/klasör adında", rel, satir: 0, ornek: "" });
  if (EPOSTA.test(rel)) bulgular.push({ tur: "E-POSTA", ad: "E-posta dosya/klasör adında", rel, satir: 0, ornek: "" });
  EPOSTA.lastIndex = 0;
  const yol = path.join(HEDEF, ...rel.split("/"));
  const tampon = fs.readFileSync(yol);
  if (!metinMi(rel, tampon)) {
    if (ikiliIsimKalibi) {
      const ham = tampon.toString("latin1") + "\n" + tampon.toString("utf16le");
      for (const m of ham.matchAll(ikiliIsimKalibi)) bulgular.push({ tur: "İSİM", ad: "Kişisel ad (ikili dosyada, ör. görsel meta verisi)", rel, satir: 0, ornek: m[0][0] + "…" });
    }
    continue;
  }
  const metin = tampon.toString("utf8");
  for (const k of GIZLI_KALIPLAR) {
    for (const m of metin.matchAll(k.r)) {
      // Kod içindeki şablon/değişken (ör. `Bearer ${anahtar}`) gizli değer değildir
      if (/\$\{|process\.env|<[A-Z_]+>|\.\.\.|xxxx|YOUR_|ANAHTAR/i.test(m[0])) continue;
      bulgular.push({ tur: "GİZLİ", ad: k.ad, rel, satir: satirNo(metin, m.index), ornek: ozetle(m[0]) });
    }
  }
  for (const k of YOL_KALIPLARI) {
    for (const m of metin.matchAll(k.r)) {
      bulgular.push({ tur: "YOL", ad: k.ad, rel, satir: satirNo(metin, m.index), ornek: m[0].slice(0, 60) });
    }
  }
  for (const m of metin.matchAll(EPOSTA)) {
    const e = m[0].toLowerCase();
    if (EPOSTA_IZINLI.has(e) || EPOSTA_IZINLI_ALAN.test(e)) continue;
    if (/\.(png|jpe?g|svg|webp|gif)$/i.test(e) || /^[a-z0-9.-]+@\d/.test(e)) continue; // dosya adı / paket@sürüm
    if (rel.endsWith("package-lock.json")) continue;
    bulgular.push({ tur: "E-POSTA", ad: "Bilinmeyen e-posta", rel, satir: satirNo(metin, m.index), ornek: e.replace(/^(.).*@/, "$1…@") });
  }
  if (!ASISTAN_TARAMA_MUAF.has(rel)) {
    const satirlar = metin.split("\n");
    for (const m of metin.matchAll(ASISTAN)) {
      const no = satirNo(metin, m.index);
      const satir = satirlar[no - 1] || "";
      if (ASISTAN_IZINLI_SATIR.some((r) => r.test(satir))) continue;
      bulgular.push({ tur: "ASİSTAN", ad: "Yapay zekâ asistanına özgü kalıntı (genelleştirin ya da çıkarın)", rel, satir: no, ornek: satir.trim().slice(0, 90) });
    }
  }
  if (isimler.length) {
    // İzinli dosyalarda tam depo adı ("sahip/depo") aynı uzunlukta boşlukla örtülür; satır numaraları değişmez
    let taranan = DEPO && DEPO_ADI_IZINLI_DOSYALAR.has(rel) ? metin.split(DEPO.tam).join(" ".repeat(DEPO.tam.length)) : metin;
    if (DEPO && !DEPO_YER_TUTUCU && GELISTIRICI_ATIF_DOSYALARI.has(rel)) taranan = taranan.split(DEPO.sahip).join(" ".repeat(DEPO.sahip.length));
    for (const m of taranan.matchAll(isimKalibi)) {
      bulgular.push({ tur: "İSİM", ad: "Kişisel ad", rel, satir: satirNo(metin, m.index), ornek: metin.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).replace(/\s+/g, " ").replace(m[0], m[0][0] + "…") });
    }
  }
}
// Yasak dosyalar gerçekten dışarıda mı? (çift denetim)
for (const rel of kopyalanan) {
  if (KISISEL_VERI_YOLU.some((r) => r.test(rel))) {
    bulgular.push({ tur: "DOSYA", ad: "Çalışma zamanı / kişisel veri dosyası kopyalanmış", rel, satir: 0, ornek: "" });
  }
}

// ---------------------------------------------------------------------------
// Rapor
// ---------------------------------------------------------------------------
console.log(`  Kopyalanan dosya: ${kopyalanan.length}`);
console.log(`  Dışarıda bırakılanlar:`);
for (const [sebep, liste] of disarida) {
  const ornek = liste.slice(0, 6).join(", ") + (liste.length > 6 ? ` … (+${liste.length - 6})` : "");
  console.log(`    - ${sebep}: ${ornek}`);
}
console.log(`\n  Yayın dönüşümleri:`);
for (const { d, sonuc } of donusumRaporu) {
  const renk = sonuc.startsWith("uygulandı") || sonuc === "zaten genel" ? yesil : sari;
  console.log(`    ${renk(sonuc.padEnd(16))} ${d.ad}`);
}

if (bulgular.length) {
  console.log(kirmizi(`\n  ==========================================================`));
  console.log(kirmizi(`   YAYIN DURDURULDU: ${bulgular.length} bulgu var. Kopya güvenli değil.`));
  console.log(kirmizi(`  ==========================================================`));
  for (const b of bulgular.slice(0, 200)) {
    console.log(kirmizi(`   [${b.tur}] ${b.ad}: ${b.rel}${b.satir ? ":" + b.satir : ""}  ${b.ornek}`));
  }
  if (bulgular.length > 200) console.log(kirmizi(`   … ve ${bulgular.length - 200} bulgu daha`));
  console.log(kirmizi(`\n  Bulguları kaynakta düzeltin (ya da gerçekten zararsızsa kuralı güncelleyin) ve yeniden çalıştırın.`));
  console.log(kirmizi(`  Hedef klasör inceleme için bırakıldı: ${HEDEF}\n`));
  // Başarısız kopya yanlışlıkla yayımlanmasın: işaret dosyasına durum yazılır (--zorla ile yeniden yazılabilir)
  try { fs.writeFileSync(path.join(HEDEF, ISARET_DOSYASI), JSON.stringify({ olusturan: "scripts/yayin/disa-aktar.cjs", durum: "BASARISIZ - YAYIMLAMAYIN", bulgu: bulgular.length, tarih: new Date().toISOString() }, null, 2)); } catch (_) {}
  process.exit(1);
}
console.log(yesil(`\n  Tarama temiz: anahtar, kişisel yol, izinsiz e-posta, kişisel ad, kişisel veri dosyası ya da asistana özgü kalıntı bulunamadı.`));
console.log(`  Taranan kişisel ad sayısı: ${isimler.length}${DEPO && !DEPO_YER_TUTUCU ? ` (depo adı ${DEPO.tam} yalnızca ${[...DEPO_ADI_IZINLI_DOSYALAR].join(", ")} içinde serbest)` : ""}`);
if (verilenAdSayisi === 0) console.log(sari("  Uyarı: taranacak kişisel ad bulunamadı (yayın paketi bu durumda üretilmez). Adları --isim, --isimler-dosyasi, YAS_OZEL_ISIMLER ya da scripts/yayin/ozel-isimler.txt ile verin."));
if (!DEPO) console.log(sari("  Uyarı: Kurulum.bat'ta $Repo satırı bulunamadı; depo adı denetimi yapılmadı."));
else if (DEPO_YER_TUTUCU) {
  console.log(sari(`  Uyarı: GitHub deposu yer tutucu (${DEPO.tam}); yayından önce doldurulacak. Bu kopya ${deneme ? "yalnızca yerel deneme içindir" : "yayımlanmamalı"}.`));
  console.log(sari("         Yayın: --depo <sahip>/YerelAIStudyosu (yalnızca kopyadaki Kurulum.bat güncellenir)."));
}
else {
  // README'deki GitHub bağlantıları Kurulum.bat'taki depoyu göstermeli
  try {
    const readme = fs.readFileSync(path.join(HEDEF, "README.md"), "utf8");
    const farkli = [...new Set([...readme.matchAll(/github\.com\/([A-Za-z0-9_.-]+\/YerelAIStudyosu)\b/g)].map((m) => m[1]))].filter((d) => d !== DEPO.tam);
    if (farkli.length) {
      const mesaj = `README.md farklı depo(lar)a bağlanıyor: ${farkli.join(", ")} (Kurulum.bat: ${DEPO.tam}).`;
      if ((paketArg || zipYolu) && !deneme) dur(mesaj + " Yayın paketi üretilmedi.");
      console.log(sari("  Uyarı: " + mesaj));
    }
  } catch (_) {}
}
if (SURUM) {
  fs.writeFileSync(path.join(HEDEF, "VERSION"), SURUM.surum + "\n", "utf8");
  if (!kopyalanan.includes("VERSION")) kopyalanan.push("VERSION");
  console.log(`  Sürüm : ${SURUM.surum} (${SURUM.kaynak}) → VERSION`);
}

// ---------------------------------------------------------------------------
// 4) Zip + SHA256SUMS.txt (isteğe bağlı)
// ---------------------------------------------------------------------------
const CRC_TABLO = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLO[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosZamani(tarih) {
  const t = new Date(Math.max(tarih.getTime(), new Date(1980, 0, 1).getTime()));
  return {
    zaman: ((t.getHours() << 11) | (t.getMinutes() << 5) | Math.floor(t.getSeconds() / 2)) & 0xffff,
    tarih: (((t.getFullYear() - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate()) & 0xffff,
  };
}
function zipYaz(cikis, kokAdi, dosyalar) {
  const parcalar = [];
  const merkez = [];
  let ofset = 0;
  for (const rel of dosyalar) {
    const yol = path.join(HEDEF, ...rel.split("/"));
    const veri = fs.readFileSync(yol);
    const sik = zlib.deflateRawSync(veri, { level: 9 });
    const kullan = sik.length < veri.length ? sik : veri;
    const yontem = kullan === sik ? 8 : 0;
    const ad = Buffer.from(`${kokAdi}/${rel}`, "utf8");
    const { zaman, tarih } = dosZamani(fs.statSync(yol).mtime);
    const crc = crc32(veri);
    const yerel = Buffer.alloc(30);
    yerel.writeUInt32LE(0x04034b50, 0); yerel.writeUInt16LE(20, 4); yerel.writeUInt16LE(0x0800, 6); yerel.writeUInt16LE(yontem, 8);
    yerel.writeUInt16LE(zaman, 10); yerel.writeUInt16LE(tarih, 12); yerel.writeUInt32LE(crc, 14);
    yerel.writeUInt32LE(kullan.length, 18); yerel.writeUInt32LE(veri.length, 22); yerel.writeUInt16LE(ad.length, 26); yerel.writeUInt16LE(0, 28);
    parcalar.push(yerel, ad, kullan);
    const m = Buffer.alloc(46);
    m.writeUInt32LE(0x02014b50, 0); m.writeUInt16LE(0x031e, 4); m.writeUInt16LE(20, 6); m.writeUInt16LE(0x0800, 8); m.writeUInt16LE(yontem, 10);
    m.writeUInt16LE(zaman, 12); m.writeUInt16LE(tarih, 14); m.writeUInt32LE(crc, 16); m.writeUInt32LE(kullan.length, 20); m.writeUInt32LE(veri.length, 24);
    m.writeUInt16LE(ad.length, 28); m.writeUInt16LE(0, 30); m.writeUInt16LE(0, 32); m.writeUInt16LE(0, 34); m.writeUInt16LE(0, 36);
    m.writeUInt32LE(((/\.(sh)$/.test(rel) ? 0o100755 : 0o100644) << 16) >>> 0, 38); m.writeUInt32LE(ofset, 42);
    merkez.push(m, ad);
    ofset += 30 + ad.length + kullan.length;
  }
  const merkezBoyut = merkez.reduce((t, b) => t + b.length, 0);
  const son = Buffer.alloc(22);
  son.writeUInt32LE(0x06054b50, 0); son.writeUInt16LE(0, 4); son.writeUInt16LE(0, 6);
  son.writeUInt16LE(dosyalar.length, 8); son.writeUInt16LE(dosyalar.length, 10);
  son.writeUInt32LE(merkezBoyut, 12); son.writeUInt32LE(ofset, 16); son.writeUInt16LE(0, 20);
  if (dosyalar.length > 0xffff || ofset > 0xffffffff) dur("Zip çok büyük (ZIP64 desteklenmiyor).");
  fs.writeFileSync(cikis, Buffer.concat([...parcalar, ...merkez, son]));
}

function sha256(dosya) { return crypto.createHash("sha256").update(fs.readFileSync(dosya)).digest("hex"); }

if (PAKET) {
  fs.mkdirSync(PAKET, { recursive: true });
  for (const ad of fs.readdirSync(PAKET)) {
    // Eski zip'ler (yukarıda --zorla ile onaylandı) ve önceki dosyalar temizlenir; yabancı dosya olmadığı denetlendi
    if (ad.startsWith(PAKET_ONEKI) && ad.endsWith(".zip")) fs.rmSync(path.join(PAKET, ad), { force: true });
  }
  const zipAdi = `${PAKET_ONEKI}-${SURUM.surum}.zip`;
  const cikis = path.join(PAKET, zipAdi);
  zipYaz(cikis, "YerelAIStudyosu", kopyalanan);
  const kurulumKaynak = path.join(HEDEF, "Kurulum.bat");
  if (!fs.existsSync(kurulumKaynak)) dur("Dışa aktarılan kopyada Kurulum.bat yok.");
  fs.rmSync(path.join(PAKET, "Kurulum.bat"), { force: true }); // salt okunur eski kopya üzerine yazmayı engellemesin
  fs.copyFileSync(kurulumKaynak, path.join(PAKET, "Kurulum.bat"));
  const ozetZip = sha256(cikis);
  const ozetBat = sha256(path.join(PAKET, "Kurulum.bat"));
  fs.writeFileSync(path.join(PAKET, "SHA256SUMS.txt"), `${ozetZip}  ${zipAdi}\n${ozetBat}  Kurulum.bat\n`, "utf8");
  fs.writeFileSync(path.join(PAKET, PAKET_ISARETI), JSON.stringify({ olusturan: "scripts/yayin/disa-aktar.cjs", surum: SURUM.surum, depo: DEPO ? DEPO.tam : null, deneme: Boolean(deneme || DEPO_YER_TUTUCU), tarih: new Date().toISOString() }, null, 2));
  console.log(yesil(`\n  Paket hazır: ${PAKET}`));
  console.log(yesil(`    ${zipAdi}  (${(fs.statSync(cikis).size / 1024 / 1024).toFixed(2)} MB, ${kopyalanan.length} dosya)`));
  console.log(yesil(`    SHA256SUMS.txt  (zip: ${ozetZip})`));
  console.log(yesil(`    Kurulum.bat`));
  console.log(`\n  Yerel deneme: bu klasördeki Kurulum.bat'ı çift tıklayın; "Yerel paketten kuruluyor" yazmalı ve SHA256 doğrulanmalı.`);
  if (deneme || DEPO_YER_TUTUCU) console.log(sari(`  DENEME PAKETİ: GitHub'a yüklemeyin${DEPO_YER_TUTUCU ? " (depo yer tutucu; internetten kurulum çalışmaz)" : ""}.`));
  else console.log(`  GitHub sürümü (${DEPO.tam}): bu üç dosyayı (zip, SHA256SUMS.txt, Kurulum.bat) sürüme ekleyin.`);
}

if (zipYolu) {
  const cikis = path.resolve(zipYolu);
  if (icinde(KAYNAK, cikis)) dur("Zip dosyası projenin içine yazılamaz.");
  if (icinde(HEDEF, cikis)) dur("Zip dosyası dışa aktarılan klasörün içine yazılamaz.");
  fs.mkdirSync(path.dirname(cikis), { recursive: true });
  zipYaz(cikis, "YerelAIStudyosu", kopyalanan);
  const ozet = sha256(cikis);
  const sums = path.join(path.dirname(cikis), "SHA256SUMS.txt");
  fs.writeFileSync(sums, `${ozet}  ${path.basename(cikis)}\n`, "utf8");
  console.log(yesil(`  Zip   : ${cikis} (${(fs.statSync(cikis).size / 1024 / 1024).toFixed(2)} MB)`));
  console.log(yesil(`  SHA256: ${ozet}  → ${sums}`));
  if (deneme || DEPO_YER_TUTUCU) console.log(sari("  DENEME ZIP'İ: GitHub'a yüklemeyin."));
  else console.log(`  GitHub sürümüne bu iki dosyayı ekleyin (Kurulum.bat zip'i bu özetle doğrular).`);
}
console.log("");

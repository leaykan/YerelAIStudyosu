// Sesli sohbet: eller serbest dinleme (konuşma algılama) ve yanıtları cümle
// cümle seslendirme. Tarayıcı dışında bağımlılık yok.
import { speakTts } from "./services/api";
import { klonIptal } from "./services/klonApi";

// Sesli sohbette klon sesle (OmniVoice) tek cümle. Sunucu yanıtları:
//  - 503 KLON_HAZIR_DEGIL: model henüz yükleniyor (ilk açılış işlemcide dakikalar sürer)
//  - 503 KLON_MESGUL: önceki cümle hâlâ işleniyor
//  - 504 KLON_ZAMAN_ASIMI: cümle süre sınırını aştı (model bellekte kalır)
// Üçünde de çağıran aynı cümleyi HEMEN normal sesle okur ve sonraki cümlelerde klonu yeniden dener.
async function klonlaSeslendir(cumle, klon, hiz, signal) {
  const res = await fetch("/api/tts/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: cumle, voice: klon.voice, speed: hiz, gecici: true, zamanAsimiSn: klon.zamanAsimiSn }),
    signal,
  });
  let veri = null;
  try { veri = await res.json(); } catch (_) { /* geçersiz yanıt */ }
  if (!res.ok || !veri?.ok || !veri.output?.url) {
    const e = new Error(veri?.error || `Klon ses üretilemedi (${res.status}).`);
    e.code = veri?.code || "";
    e.status = res.status;
    throw e;
  }
  return veri.output;
}

const KLON_GECICI_KODLAR = new Set(["KLON_HAZIR_DEGIL", "KLON_MESGUL", "KLON_ZAMAN_ASIMI"]);
// Seslendirici: çalınan cümlenin ardından en fazla bu kadar cümle önceden sentezlenip hazır bekletilir
const ONDE_AZAMI = 2;

// ---------------------------------------------------------------------------
// Ses yardımcıları
// ---------------------------------------------------------------------------
function birlestir(parcalar) {
  const toplam = parcalar.reduce((s, p) => s + p.length, 0);
  const cikti = new Float32Array(toplam);
  let o = 0;
  for (const p of parcalar) { cikti.set(p, o); o += p.length; }
  return cikti;
}

function yenidenOrnekle(girdi, kaynak, hedef) {
  if (kaynak === hedef) return girdi;
  const oran = kaynak / hedef;
  const uzunluk = Math.max(1, Math.round(girdi.length / oran));
  const cikti = new Float32Array(uzunluk);
  for (let i = 0; i < uzunluk; i++) {
    // Basit alçak geçiren: oran kadar örneğin ortalaması (örtüşmeyi azaltır)
    const bas = Math.floor(i * oran);
    const son = Math.min(girdi.length, Math.max(bas + 1, Math.floor((i + 1) * oran)));
    let t = 0;
    for (let k = bas; k < son; k++) t += girdi[k];
    cikti[i] = t / (son - bas);
  }
  return cikti;
}

export function wavKodla(ornekler, hiz = 16000) {
  const tampon = new ArrayBuffer(44 + ornekler.length * 2);
  const g = new DataView(tampon);
  const yaz = (o, s) => { for (let i = 0; i < s.length; i++) g.setUint8(o + i, s.charCodeAt(i)); };
  yaz(0, "RIFF"); g.setUint32(4, 36 + ornekler.length * 2, true); yaz(8, "WAVE");
  yaz(12, "fmt "); g.setUint32(16, 16, true); g.setUint16(20, 1, true); g.setUint16(22, 1, true);
  g.setUint32(24, hiz, true); g.setUint32(28, hiz * 2, true); g.setUint16(32, 2, true); g.setUint16(34, 16, true);
  yaz(36, "data"); g.setUint32(40, ornekler.length * 2, true);
  let o = 44;
  for (let i = 0; i < ornekler.length; i++, o += 2) {
    const v = Math.max(-1, Math.min(1, ornekler[i]));
    g.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([g], { type: "audio/wav" });
}

// ---------------------------------------------------------------------------
// Eller serbest dinleyici
// Mikrofon sürekli açık kalır; ses düzeyi gürültü tabanının üzerine çıkınca
// kayıt başlar, belirli bir süre sessizlik olunca kayıt WAV olarak teslim edilir.
// Model düşünürken ve konuşurken dinleme duraklatılır (kendi sesini duymasın).
// ---------------------------------------------------------------------------
export class Dinleyici {
  constructor({ onKonusma, onDurum, onSeviye, sessizlikSn = 0.8, enKisaSn = 0.5, enUzunSn = 12 } = {}) {
    this.onKonusma = onKonusma || (() => {});
    this.onDurum = onDurum || (() => {});
    this.onSeviye = onSeviye || (() => {});
    this.sessizlikSn = sessizlikSn;
    this.enKisaSn = enKisaSn;
    this.enUzunSn = enUzunSn;
    this.durum = "kapali";
    this.duraklatildi = false;
  }

  async baslat() {
    this.akis = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.baglam = new AudioContext();
    this.kaynak = this.baglam.createMediaStreamSource(this.akis);
    this.islemci = this.baglam.createScriptProcessor(2048, 1, 1);
    this.hiz = this.baglam.sampleRate;
    this.parcaSn = 2048 / this.hiz;
    this.onKayit = [];           // konuşma başlamadan önceki ~0,5 sn
    this.kayit = null;
    this.gurultu = 0.01;
    this.kalibrasyon = [];
    this.sessizSure = 0;
    this.sesliArdisik = 0;
    this.islemci.onaudioprocess = (e) => this._isle(new Float32Array(e.inputBuffer.getChannelData(0)));
    this.kaynak.connect(this.islemci);
    // ScriptProcessor ancak bir çıkışa bağlıyken çalışır; sessiz kazanç üzerinden bağlanır
    this.sessiz = this.baglam.createGain();
    this.sessiz.gain.value = 0;
    this.islemci.connect(this.sessiz);
    this.sessiz.connect(this.baglam.destination);
    this._durumAyarla("kalibre");
  }

  _durumAyarla(d) {
    if (this.durum === d) return;
    this.durum = d;
    this.onDurum(d);
  }

  _esik() {
    return Math.max(0.015, this.gurultu * 3.2);
  }

  _isle(parca) {
    let t = 0;
    for (let i = 0; i < parca.length; i++) t += parca[i] * parca[i];
    const rms = Math.sqrt(t / parca.length);
    this.onSeviye(rms, this._esik());

    if (this.durum === "kalibre") {
      this.kalibrasyon.push(rms);
      if (this.kalibrasyon.length * this.parcaSn >= 1) {
        const sirali = [...this.kalibrasyon].sort((a, b) => a - b);
        this.gurultu = Math.max(0.003, sirali[Math.floor(sirali.length * 0.6)]);
        this._durumAyarla(this.duraklatildi ? "duraklatildi" : "dinliyor");
      }
      return;
    }
    if (this.duraklatildi) return;

    const esik = this._esik();
    if (this.durum === "dinliyor") {
      this.onKayit.push(parca);
      while (this.onKayit.length * this.parcaSn > 0.5) this.onKayit.shift();
      if (rms > esik) {
        this.sesliArdisik++;
        if (this.sesliArdisik >= 2) {
          this.kayit = [...this.onKayit];
          this.onKayit = [];
          this.sessizSure = 0;
          this.tepe = rms;
          this.sonRmsler = [];
          this._durumAyarla("kayit");
        }
      } else {
        this.sesliArdisik = 0;
        // Gürültü tabanını yavaşça izle
        this.gurultu = this.gurultu * 0.97 + Math.min(rms, esik) * 0.03;
      }
      return;
    }
    if (this.durum === "kayit") {
      this.kayit.push(parca);
      const sure = this.kayit.length * this.parcaSn;
      // Sessizlik iki yoldan anlaşılır: (1) ses eşiğin altına iner, ya da (2) ortamda sürekli bir
      // ses varken (fan, klima, mikrofonun otomatik kazancının büyüttüğü gürültü) ses düzeyi
      // konuşmanın tepesine göre belirgin biçimde düşer ve son 2 sn'nin taban düzeyinde kalır.
      this.tepe = Math.max((this.tepe || 0) * 0.999, rms);
      this.sonRmsler.push(rms);
      const pencere = Math.max(8, Math.round(2 / this.parcaSn));
      while (this.sonRmsler.length > pencere) this.sonRmsler.shift();
      const sirali = [...this.sonRmsler].sort((a, b) => a - b);
      const taban = sirali[Math.floor(sirali.length * 0.25)] || 0;
      const sessiz = rms < esik * 0.75 || (rms < this.tepe * 0.35 && rms < taban * 1.6);
      if (sessiz) this.sessizSure += this.parcaSn;
      else this.sessizSure = 0;
      if (this.sessizSure >= this.sessizlikSn || sure >= this.enUzunSn) {
        const konusmaSn = sure - this.sessizSure;
        // Ortam gürültüsü yükseldiyse başlama eşiği de ona uysun (bir sonraki cümle gürültüyle başlamasın)
        const yeniTaban = Math.min(taban, this.tepe * 0.3);
        if (yeniTaban > this.gurultu) this.gurultu = this.gurultu * 0.5 + yeniTaban * 0.5;
        const parcalar = this.kayit;
        this.kayit = null;
        this.sesliArdisik = 0;
        this._durumAyarla("dinliyor");
        if (konusmaSn >= this.enKisaSn) {
          const ses = yenidenOrnekle(birlestir(parcalar), this.hiz, 16000);
          this.onKonusma(wavKodla(ses, 16000), konusmaSn);
        }
      }
    }
  }

  duraklat() {
    this.duraklatildi = true;
    this.kayit = null;
    this.onKayit = [];
    this.sesliArdisik = 0;
    if (this.durum !== "kapali" && this.durum !== "kalibre") this._durumAyarla("duraklatildi");
  }

  devam() {
    this.duraklatildi = false;
    this.sessizSure = 0;
    if (this.durum !== "kapali" && this.durum !== "kalibre") this._durumAyarla("dinliyor");
  }

  async durdur() {
    try { this.islemci && this.islemci.disconnect(); } catch (_) {}
    try { this.kaynak && this.kaynak.disconnect(); } catch (_) {}
    try { this.sessiz && this.sessiz.disconnect(); } catch (_) {}
    try { this.akis && this.akis.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { this.baglam && (await this.baglam.close()); } catch (_) {}
    this._durumAyarla("kapali");
  }
}

// ---------------------------------------------------------------------------
// Metin yardımcıları
// ---------------------------------------------------------------------------
const TR_KELIMELER = new Set(["ve", "bir", "bu", "için", "ile", "değil", "mi", "mı", "ne", "ben", "sen", "o", "da", "de", "çok", "var", "yok", "gibi", "daha", "olan", "olarak", "ama", "evet", "hayır", "nasıl", "neden", "şu", "her", "kadar", "sonra", "önce", "bana", "sana", "merhaba"]);
const EN_KELIMELER = new Set(["the", "and", "is", "are", "you", "of", "to", "in", "it", "that", "this", "for", "with", "was", "on", "be", "have", "not", "what", "how", "can", "your", "i", "hello", "yes", "no", "will", "would", "there", "they"]);

export function dilTahmin(metin) {
  const s = String(metin || "").toLowerCase();
  let tr = (s.match(/[çğıöşü]/g) || []).length * 2;
  let en = 0;
  for (const k of s.split(/[^a-zçğıöşü']+/)) {
    if (TR_KELIMELER.has(k)) tr += 1;
    if (EN_KELIMELER.has(k)) en += 1;
  }
  return en > tr ? "en" : "tr";
}

// Seslendirmeden önce markdown, kod ve bağlantıları temizler.
export function seslendirmeIcinTemizle(metin) {
  return String(metin || "")
    .replace(/```[\s\S]*?```/g, " (kod bloğu) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " bağlantı ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\*\*|__|\*|_|~~|>/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Whisper'ın sessizlikte uydurduğu tipik metinler
const HALUSINASYON = [
  /altyaz[ıi]/i, /izledi[gğ]iniz i[cç]in te[sş]ekk[uü]r/i, /abone ol/i, /beğenmeyi unutmay/i,
  /thanks? for watching/i, /subscribe/i, /^\s*[\[(][^\])]*[\])]\s*$/, /^[\s.…,!?-]*$/,
];

export function halusinasyonMu(metin) {
  const s = String(metin || "").trim();
  if (s.length < 2) return true;
  return HALUSINASYON.some((r) => r.test(s));
}

// ---------------------------------------------------------------------------
// Seslendirici: akan yanıtı cümlelere böler, sırayla sentezleyip çalar.
// Ön üretim (boru hattı): bir cümle çalarken sonraki cümleler önceden sentezlenir ve ses dosyası
// tarayıcıda önceden yüklenir; böylece cümle aralarındaki bekleme kısalır. Kurallar:
//  - Sunucuda aynı anda tek sentez: n+1. cümle, n. cümlenin SENTEZİ biter bitmez istenir (çalması beklenmez).
//    Klon çalışanı (OmniVoice) tek iş parçacıklıdır; aynı anda iki istek KLON_MESGUL döndürürdü.
//  - En fazla ONDE_AZAMI (2) cümle önde: çalınmayı bekleyen hazır ses sayısı 2'ye ulaşınca yeni sentez
//    beklenir (susturulursa boşa giden iş az olur; işlemci de okunan sesle yarışmaz).
//  - Sıra korunur: sesler metindeki sırayla çalınır (sentez tek hat olduğu için sıra hiç bozulmaz).
//  - sustur() / yeniYanit(): süren istek (klon ya da normal ses) iptal edilir, klon çalışanına iptal bildirilir,
//    önceden yüklenmiş sesler boşaltılır, bekleyen döngü uyanıp çıkar. Eski nesilden geç gelen yanıt atılır.
// ---------------------------------------------------------------------------
// sesSec(cumle) şunu döndürür: { voice, model } ya da klon sesle okunacaksa
// { voice, model, klon: { voice: "omnivoice:klon_<dosya>", zamanAsimiSn } } (voice/model = yedek normal ses).
// Klon ses hazır değilse, meşgulse ya da cümle süreyi aşarsa o cümle hemen normal sesle okunur ve sonraki
// cümlelerde klon yeniden denenir (onKlonDurum). Gerçek bir hata olursa (ör. klon dosyası yok) bu seslendirici
// kapanana kadar normal sesle devam edilir (onKlonHata).
export class Seslendirici {
  constructor({ sesSec, hiz = 1, onDurum, onKlonHata, onKlonDurum } = {}) {
    this.sesSec = sesSec || (() => ({ voice: "piper:tr_TR-dfki-medium" }));
    this.hiz = hiz;
    this.onDurum = onDurum || (() => {});
    this.onKlonHata = onKlonHata || (() => {});
    this.onKlonDurum = onKlonDurum || (() => {});
    this.klonKapali = false;
    this.klonSuruyor = false;
    this._istek = null;      // süren sentez isteğinin AbortController'ı (klon ya da normal ses)
    this._sifirla();
  }

  // Bir cümleyi sentezler. Susturulduysa (nesil değiştiyse) "SUSTURULDU" koduyla reddeder.
  async _cumleSeslendir(cumle, secim, nesil) {
    const { klon, ...normal } = secim || {};
    const susturulduHatasi = () => Object.assign(new Error("Seslendirme susturuldu."), { code: "SUSTURULDU" });
    if (klon?.voice && !this.klonKapali) {
      const iptal = new AbortController();
      iptal.klon = true;
      this._istek = iptal;
      // "Klon sesle cümle hazırlanıyor" durumu yalnızca istek gerçekten sürüyorsa gösterilir
      // (model hazır değilse sunucu anında yanıt verir; ekranda boşuna yanıp sönmesin)
      const bayrak = setTimeout(() => {
        if (nesil !== this.nesil) return;
        this.klonSuruyor = true;
        this._durum();
      }, 400);
      // Sunucu süreyi zaten denetler; bu yalnızca sunucu hiç yanıt vermezse diye ikinci emniyet
      const sinirSn = Number(klon.zamanAsimiSn);
      // 0 = sınırsız: yalnızca sunucunun 30 dk'lık takılma güvenliğinden biraz uzun bir emniyet
      const zaman = setTimeout(() => { iptal.zamanAsimi = true; iptal.abort(); }, (sinirSn === 0 ? 1830 : (sinirSn || 90) + 20) * 1000);
      try {
        return await klonlaSeslendir(cumle, klon, this.hiz, iptal.signal);
      } catch (err) {
        // Kullanıcı susturdu: normal sese geçmeden çık
        if (iptal.susturuldu || nesil !== this.nesil) throw susturulduHatasi();
        const kod = iptal.zamanAsimi ? "KLON_ZAMAN_ASIMI" : String(err?.code || "");
        if (KLON_GECICI_KODLAR.has(kod)) {
          // Geçici durum: bu cümle hemen normal sesle; sonraki cümlede klon yeniden denenir
          try { this.onKlonDurum({ kod, mesaj: err?.message || "" }); } catch (_) { /* yok say */ }
        } else {
          this.klonKapali = true;
          try { this.onKlonHata(err); } catch (_) { /* yok say */ }
        }
      } finally {
        clearTimeout(bayrak);
        clearTimeout(zaman);
        if (this._istek === iptal) this._istek = null;
        // Eski nesil, yeni yanıtın klon durumunu silmesin
        if (nesil === this.nesil) {
          this.klonSuruyor = false;
          this._durum();
        }
      }
    }
    if (nesil !== this.nesil) throw susturulduHatasi();
    const iptal = new AbortController();
    this._istek = iptal;
    try {
      return await speakTts(cumle, { ...normal, speed: this.hiz, gecici: true, signal: iptal.signal });
    } catch (err) {
      if (iptal.susturuldu || nesil !== this.nesil) throw susturulduHatasi();
      throw err;
    } finally {
      if (this._istek === iptal) this._istek = null;
    }
  }

  _sifirla() {
    // Önceden yüklenmiş ama çalınmamış sesler bırakılır (indirme/çözme iptal edilir)
    for (const h of this.calinacak || []) this._sesiBirak(h.ses);
    // Yer bekleyen sentez döngüsü uyandırılır; nesil değiştiği için çıkar
    const uyandir = this._yerAcildi;
    this._yerAcildi = null;
    this.islenen = 0;
    this.kuyruk = [];         // sentezlenecek cümleler
    this.calinacak = [];      // hazır sesler: { url, ses: önceden yüklenen Audio }
    this.sentezleniyor = false;
    this.caliyor = false;
    this.bitti = false;
    this.ses = null;
    this.klonSuruyor = false;
    this.nesil = (this.nesil || 0) + 1;
    this._bekleyenler = [];
    if (uyandir) uyandir();
  }

  _sesiBirak(ses) {
    if (!ses) return;
    try { ses.onended = null; ses.onerror = null; ses.pause(); ses.removeAttribute("src"); ses.load(); } catch (_) { /* yok say */ }
  }

  // Çalınmayı bekleyen hazır ses sayısı sınırdaysa, biri çalmaya başlayana (ya da susturulana) kadar bekler
  async _yerBekle(nesil) {
    while (nesil === this.nesil && this.calinacak.length >= ONDE_AZAMI) {
      await new Promise((r) => { this._yerAcildi = r; });
    }
  }

  // Akan metnin tamamı verilir; yeni tamamlanan cümleler kuyruğa eklenir.
  metinGuncelle(tumMetin, son = false) {
    const metin = String(tumMetin || "");
    let kalan = metin.slice(this.islenen);
    for (;;) {
      // Cümle sonu: . ! ? … veya satır sonu, ardından boşluk. Çok kısa parçalar birleştirilir.
      const m = kalan.match(/^([\s\S]*?[.!?…:;](?=\s)|[\s\S]*?\n+)/);
      if (!m) break;
      let parca = m[1];
      if (parca.trim().length < 25 && !son) {
        const m2 = kalan.slice(parca.length).match(/^([\s\S]*?[.!?…:;](?=\s)|[\s\S]*?\n+)/);
        if (!m2) break;
        parca += m2[1];
      }
      this.islenen += parca.length;
      kalan = kalan.slice(parca.length);
      this._ekle(parca);
    }
    if (son) {
      if (kalan.trim()) this._ekle(kalan);
      this.islenen = metin.length;
      this.bitti = true;
      this._kontrol();
    }
  }

  _ekle(parca) {
    const temiz = seslendirmeIcinTemizle(parca);
    if (!temiz || !/[\p{L}\p{N}]/u.test(temiz)) return;
    this.kuyruk.push(temiz);
    this._sentezle();
  }

  // Tek sentez hattı: cümleler sırayla sentezlenir; her biri biter bitmez (çalması beklenmeden) sıradaki istenir.
  async _sentezle() {
    if (this.sentezleniyor) return;
    const nesil = this.nesil;
    this.sentezleniyor = true;
    this._durum();
    try {
      while (this.kuyruk.length > 0 && nesil === this.nesil) {
        // En fazla ONDE_AZAMI cümle önden hazırlanır
        await this._yerBekle(nesil);
        if (nesil !== this.nesil || this.kuyruk.length === 0) break;
        const cumle = this.kuyruk.shift();
        const secim = this.sesSec(cumle);
        try {
          const cikti = await this._cumleSeslendir(cumle, secim, nesil);
          if (nesil !== this.nesil) return;
          if (cikti?.url) {
            // Ses hemen önceden yüklenir: sıradaki cümleye geçişte indirme/çözme beklemesi olmaz
            let ses = null;
            try { ses = new Audio(); ses.preload = "auto"; ses.src = cikti.url; ses.load(); } catch (_) { ses = null; }
            this.calinacak.push({ url: cikti.url, ses });
            this._cal();
          }
        } catch (err) {
          if (nesil !== this.nesil || err?.code === "SUSTURULDU") return;
          // Bu cümle atlanır, sıradakiyle devam edilir
          console.warn("Seslendirme başarısız:", err);
        }
      }
    } finally {
      if (nesil === this.nesil) {
        this.sentezleniyor = false;
        this._durum();
        this._kontrol();
      }
    }
  }

  _cal() {
    if (this.caliyor || this.calinacak.length === 0) return;
    const nesil = this.nesil;
    const hazir = this.calinacak.shift();
    // Önde yer açıldı: bekleyen sentez döngüsü sıradaki cümleye geçebilir
    const uyandir = this._yerAcildi;
    this._yerAcildi = null;
    if (uyandir) uyandir();
    this.caliyor = true;
    this._durum();
    const ses = hazir.ses || new Audio(hazir.url);
    this.ses = ses;
    let bitti = false;
    const bitir = () => {
      if (bitti || nesil !== this.nesil) return;
      bitti = true;
      this.caliyor = false;
      this.ses = null;
      this._durum();
      this._cal();
      this._kontrol();
    };
    ses.onended = bitir;
    ses.onerror = bitir;
    try {
      const p = ses.play();
      if (p && typeof p.catch === "function") p.catch(bitir);
    } catch (_) {
      bitir();
    }
  }

  _durum() {
    this.onDurum({ konusuyor: this.caliyor, aktif: !this._bosMu(), klon: this.klonSuruyor });
  }

  _bosMu() {
    return !this.caliyor && !this.sentezleniyor && this.kuyruk.length === 0 && this.calinacak.length === 0;
  }

  _kontrol() {
    if (this.bitti && this._bosMu()) {
      const b = this._bekleyenler;
      this._bekleyenler = [];
      b.forEach((f) => f());
    }
  }

  // Yanıtın tamamı seslendirilene kadar bekler
  bekle() {
    if (this.bitti && this._bosMu()) return Promise.resolve();
    return new Promise((r) => this._bekleyenler.push(r));
  }

  yeniYanit() {
    this.sustur();
  }

  sustur() {
    try { this.ses && this.ses.pause(); } catch (_) {}
    // Süren sentez isteği bırakılır (önceden üretilen cümle dahil). Klon isteğiyse çalışana da iptal bildirilir
    // (sunucu yüklü modeli korur); normal ses isteği yalnızca tarayıcıda iptal edilir, yanıtı atılır.
    const istek = this._istek;
    this._istek = null;
    if (istek) {
      istek.susturuldu = true;
      try { istek.abort(); } catch (_) {}
      if (istek.klon) klonIptal();
    }
    const b = this._bekleyenler || [];
    this._sifirla();
    this._durum();
    b.forEach((f) => f());
  }
}

// Ses klonlama (OmniVoice) uç noktaları: /api/klon/*. Her şey yerel sunucuda kalır.

async function yanitOku(res) {
  let veri = null;
  try { veri = await res.json(); } catch (_) { /* boş/geçersiz yanıt */ }
  if (!res.ok || !veri || veri.ok === false) {
    const e = new Error(veri?.error || `Yerel sunucu hata döndürdü (${res.status}).`);
    e.status = res.status;
    e.code = veri?.code || "";
    throw e;
  }
  return veri;
}

const postJson = (yol, govde, signal) => fetch(yol, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(govde || {}),
  signal,
}).then(yanitOku);

export const klonListesi = () => fetch("/api/klon/liste").then(yanitOku);
export const klonOnayMetni = () => fetch("/api/klon/onay-metni").then(yanitOku);

// wavBlob: arayüzde WAV'a çevrilmiş (24 kHz mono) kayıt. Onay başlıkta gider (ASCII için URI kodlu).
export function klonSesYukle(wavBlob, onay, { dil = "tr", signal } = {}) {
  return fetch(`/api/klon/yukle?dil=${encodeURIComponent(dil)}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav", "X-Klon-Onay": encodeURIComponent(JSON.stringify(onay || {})) },
    body: wavBlob,
    signal,
  }).then(yanitOku);
}

export const klonOrnektenHazirla = (onay) => postJson("/api/klon/ornekten-hazirla", { onay });
export const klonKaydet = (belirtec, ad, metin, onay) => postJson("/api/klon/kaydet", { belirtec, ad, metin, onay });
export const klonDuzenle = (dosya, degisiklik) => postJson("/api/klon/duzenle", { dosya, ...degisiklik });
export const klonSil = (dosya) => postJson("/api/klon/sil", { dosya });
export const klonMevcutSesiOnayla = (dosya, onay) => postJson("/api/klon/onayla", { dosya, onay });
export const klonAyarlariKaydet = (ayarlar) => postJson("/api/klon/ayarlar", ayarlar);
export const klonOrnekleriSil = () => postJson("/api/klon/ornekleri-sil", {});
export const klonIptal = () => postJson("/api/klon/iptal", {}).catch(() => {});
// Sesli sohbette klon sesin hazırlık durumu: { durum: kapali|yukleniyor|hazir|mesgul|hata, gecenSn, sonCumleSn, cihaz, ... }
export const klonDurumu = () => fetch("/api/klon/durum").then(yanitOku);
// Sesli sohbet açıkken yoklama (modeli bellekte tutar). { isit: true } açılışta, { kapat: true } kapanışta.
export const klonCanli = (govde = {}) => postJson("/api/klon/canli", govde);

export const klonDinlemeAdresi = (dosya) => `/api/klon/dinle?dosya=${encodeURIComponent(dosya)}`;
export const klonGeciciDinlemeAdresi = (belirtec) => `/api/klon/dinle?gecici=${encodeURIComponent(belirtec)}`;

// Sunucu ulaşılamazsa gösterilecek yedek metin (sunucudaki klon.cjs ile aynı tutulmalı)
export const YEDEK_ONAY_METNI = {
  surum: "klon-onay-2",
  baslik: "Ses klonlama: yasal uyarı",
  maddeler: [
    "Bir sesi yalnızca sesin sahibi açıkça izin verdiyse klonlayın. Ses kişisel veridir (biyometrik veri de sayılabilir): izinsiz klonlamak Türkiye'de KVKK'ya ve kişilik haklarına (başka ülkelerde de benzer yasalara) aykırı olabilir ve suç oluşturabilir.",
    "Klon sesi kimseyi yanıltmak, birinin yerine geçmek (taklit), dolandırıcılık ya da karalama için kullanmayın. Klonla üretilen sesin tüm sorumluluğu kullanıcıya aittir.",
    "Ses kaydı, yazılı metni ve onay kaydı yalnızca bu bilgisayarda (app/reference-voices klasöründe) saklanır; hiçbir yere gönderilmez.",
    "Onay kaydı (ses sahibi, onay tarihi, bu uyarının sürümü) klon sesin yanına yazılır. Klonu sildiğinizde ses, metin ve onay kaydı birlikte silinir.",
  ],
  beyanlar: { kendim: "Bu ses bana ait.", baskasi: "Ses sahibinin açık onayını aldım." },
  taahhut: "Klon sesi yanıltıcı ya da izinsiz amaçlarla (taklit, dolandırıcılık, aldatma) kullanmayacağım.",
};

// Tarayıcının çözebildiği her ses dosyasını (MP3, M4A, OGG, WAV, WEBM...) çözer
export async function sesDosyasiCoz(dosya) {
  const veri = await dosya.arrayBuffer();
  const Baglam = window.AudioContext || window.webkitAudioContext;
  const baglam = new Baglam();
  try {
    return await baglam.decodeAudioData(veri);
  } finally {
    try { await baglam.close(); } catch (_) { /* yok say */ }
  }
}

// Çözülmüş sesin [basSn, basSn+sureSn) aralığını 24 kHz mono Float32Array'e çevirir
export async function aralikMonoYap(audioBuffer, basSn, sureSn, hedefHiz = 24000) {
  const kaynakHiz = audioBuffer.sampleRate;
  const bas = Math.max(0, Math.floor(basSn * kaynakHiz));
  const son = Math.min(audioBuffer.length, bas + Math.floor(sureSn * kaynakHiz));
  const uzunluk = Math.max(1, son - bas);
  const Cevrimdisi = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const hedefUzunluk = Math.max(1, Math.ceil((uzunluk / kaynakHiz) * hedefHiz));
  const cevrim = new Cevrimdisi(1, hedefUzunluk, hedefHiz);
  const parca = cevrim.createBuffer(audioBuffer.numberOfChannels, uzunluk, kaynakHiz);
  for (let k = 0; k < audioBuffer.numberOfChannels; k++) {
    parca.copyToChannel(audioBuffer.getChannelData(k).subarray(bas, son), k);
  }
  const kaynak = cevrim.createBufferSource();
  kaynak.buffer = parca;
  kaynak.connect(cevrim.destination); // tek kanallı hedef: kanallar ortalanarak mono'ya indirilir
  kaynak.start();
  const sonuc = await cevrim.startRendering();
  return sonuc.getChannelData(0);
}

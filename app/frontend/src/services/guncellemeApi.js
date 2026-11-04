// Model / paket güncelleme bildirimi için istemci yardımcıları (Yerel AI Stüdyosu)
// Sunucu: scripts/server/guncelleme.cjs (/api/guncelleme/*). Tarayıcı dış sunuculara doğrudan istek atmaz.
// Biçim yardımcıları ve iş izleme aramaApi.js'ten gelir (kurulum ve güncelleme aynı iş kuyruğunu kullanır).
export { boyutYaz, tarihYaz, bekle, isBitinceyeKadarIzle } from "./aramaApi";

async function istek(url, secenek) {
  let res;
  try {
    res = await fetch(url, secenek);
  } catch (err) {
    throw new Error("Sunucuya ulaşılamadı: " + (err.message || err));
  }
  let veri = {};
  try { veri = await res.json(); } catch (_) {}
  // 409 + ikinciOnayGerekli: Python paketi güncellemesi için ikinci onay istenir — çağırana döner
  if (res.status === 409 && veri.ikinciOnayGerekli) return veri;
  if (!res.ok || veri.ok === false) {
    const hata = new Error(veri.error || `İstek başarısız (HTTP ${res.status})`);
    hata.kod = res.status;
    throw hata;
  }
  return veri;
}

const gonder = (url, govde) => istek(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(govde || {}),
});

// zorla: günde bir kez sınırını yok say (sunucu yine de en çok 10 dakikada bir denetler)
// Yanıt: { guncellemeler: [...], sonDenetim, denetleniyor, sorulmayan }
export const guncellemeleriGetir = (zorla = false) => istek(`/api/guncelleme/liste${zorla ? "?zorla=1" : ""}`);

// hepsi: yalnızca otomatik (kodsuz, özetle doğrulanabilir) model güncellemeleri; Python paketleri asla.
// ikinciOnay: Python (pip) paketi için kullanıcının ikinci onayı ("test edilmeden önerilmez")
export const guncellemeleriUygula = ({ idler = [], hepsi = false, ikinciOnay = false }) =>
  gonder("/api/guncelleme/uygula", { idler, hepsi, ikinciOnay });

// "Bu sürümü atla": yalnızca bu sürüm için bir daha gösterme
export const surumuAtla = (id, surum) => gonder("/api/guncelleme/atla", { id, surum });

// "Bir daha sorma": bu öğe için hiçbir sürümde bildirim gösterme (sorma=false geri alır)
export const birDahaSorma = (id, sorma = true) => gonder("/api/guncelleme/sorma", { id, sorma });
export const sorulmayanlariSifirla = () => gonder("/api/guncelleme/sorma", { hepsi: true, sorma: false });

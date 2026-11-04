// Kullanıcı girişi ve kişisel hafıza istekleri
async function istek(url, govde) {
  const res = await fetch(url, govde === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde || {}),
  });
  let veri = {};
  try { veri = await res.json(); } catch (_) {}
  if (!res.ok || veri.ok === false) throw new Error(veri.error || `İstek başarısız (HTTP ${res.status})`);
  return veri;
}

export const kullaniciDurumu = () => istek("/api/kullanici/durum");
export const kullaniciOlustur = (ad, sifre) => istek("/api/kullanici/olustur", { ad, sifre });
export const girisYap = (ad, sifre) => istek("/api/kullanici/giris", { ad, sifre });
export const cikisYap = () => istek("/api/kullanici/cikis", {});
export const sifreDegistir = (eski, yeni) => istek("/api/kullanici/sifre", { eski, yeni });
export const hafizaGetir = () => istek("/api/hafiza");
export const hafizaAyar = (ayar) => istek("/api/hafiza/ayar", ayar);
export const hafizaNot = (not) => istek("/api/hafiza/not", not);
export const hafizaTemizle = () => istek("/api/hafiza/temizle", {});
export const hafizaTara = () => istek("/api/hafiza/tara", {});
export const kullaniciListesi = () => istek("/api/kullanici/liste");
export const kullaniciYonet = (id, islem, sifre) => istek("/api/kullanici/yonet", { id, islem, sifre });

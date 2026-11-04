// Kullanıcı girişi ve kişisel hafıza (Yerel AI Stüdyosu)
//
// - İsteğe bağlı: hiç kullanıcı oluşturulmadıysa uygulama eskisi gibi girişsiz çalışır (sohbetler app/chat-history).
// - İlk kullanıcı oluşturulunca giriş zorunlu olur; sohbet geçmişi ve hafıza kullanıcıya özel klasörde tutulur:
//     app/kullanicilar/<id>/sohbetler/*.json   (sohbet arşivi)
//     app/kullanicilar/<id>/hafiza.json         (kişisel notlar)
// - Şifreler scrypt ile özetlenir (düz metin saklanmaz). Oturum: HttpOnly, SameSite=Strict çerez; sunucuda yalnızca
//   belirtecin SHA-256 özeti tutulur (app/kullanicilar/oturumlar.json, 30 gün).
// - Hafıza: sohbetler bittiğinde (son kayıttan ~90 sn sonra, model boştayken) yerel model sohbeti kısa notlara
//   özetler; yeni sohbette bu notlar sistem mesajına eklenir. Notlar kullanıcıya görünür, düzenlenir, silinir.
//   Bulut modellerine hafıza varsayılan olarak GÖNDERİLMEZ (ayarla açılabilir).
// Her şey yalnızca bu bilgisayarda kalır.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

module.exports = function kullaniciAltyapisi(ctx) {
  const { ROOT, json, readJsonBody, motorGunlugu = () => {}, ESKI_SOHBETLER } = ctx;
  const KOK = path.join(ROOT, "app", "kullanicilar");
  const LISTE = path.join(KOK, "kullanicilar.json");
  const OTURUMLAR = path.join(KOK, "oturumlar.json");
  const CEREZ = "yas_oturum";
  const OTURUM_MS = 12 * 3600 * 1000; // en çok 12 saat; çerez tarayıcı oturumluk (tarayıcı kapanınca düşer)
  try { fs.mkdirSync(KOK, { recursive: true }); } catch (_) {}
  // Güvenlik: uygulama her açılışta yeniden giriş ister (önceki oturumlar geçersiz)
  try { if (fs.existsSync(OTURUMLAR)) fs.writeFileSync(OTURUMLAR, "{}", "utf8"); } catch (_) {}
  let sonKullaniciId = null;

  const jsonOku = (dosya, yedek) => { try { return JSON.parse(fs.readFileSync(dosya, "utf8")); } catch (_) { return yedek; } };
  const jsonYaz = (dosya, veri) => { const tmp = dosya + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(veri, null, 2), "utf8"); fs.renameSync(tmp, dosya); };
  const kullanicilar = () => {
    const v = jsonOku(LISTE, { kullanicilar: [] });
    const l = Array.isArray(v.kullanicilar) ? v.kullanicilar : [];
    if (l.length && !l.some((x) => x.yonetici)) l[0].yonetici = true; // eski kurulum: ilk kullanıcı yönetici
    return l;
  };
  const yoneticiSayisi = (l) => l.filter((x) => x.yonetici).length;
  const kurulumVar = () => kullanicilar().length > 0;
  const kullaniciKlasoru = (id) => path.join(KOK, String(id).replace(/[^a-z0-9]/gi, ""));
  const ozet = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

  function sifreOzeti(sifre, tuz) {
    return crypto.scryptSync(String(sifre).normalize("NFC"), Buffer.from(tuz, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
  }
  function adGecerli(ad) { return /^[\p{L}\p{N}._ -]{2,40}$/u.test(ad); }

  // -- Oturumlar ---------------------------------------------------------------
  function oturumlar() {
    const v = jsonOku(OTURUMLAR, {});
    const simdi = Date.now();
    let degisti = false;
    for (const [k, o] of Object.entries(v)) if (!o || o.bitis < simdi) { delete v[k]; degisti = true; }
    if (degisti) try { jsonYaz(OTURUMLAR, v); } catch (_) {}
    return v;
  }
  function cerezOku(req) {
    const c = String(req.headers.cookie || "");
    const m = c.match(new RegExp("(?:^|;\\s*)" + CEREZ + "=([a-f0-9]{64})"));
    return m ? m[1] : "";
  }
  function oturumKullanicisi(req) {
    const belirtec = cerezOku(req);
    if (!belirtec) return null;
    const o = oturumlar()[ozet(belirtec)];
    if (!o) return null;
    const k = kullanicilar().find((x) => x.id === o.id) || null;
    if (k) sonKullaniciId = k.id;
    return k;
  }
  function oturumAc(res, kullanici) {
    const belirtec = crypto.randomBytes(32).toString("hex");
    const v = oturumlar();
    v[ozet(belirtec)] = { id: kullanici.id, bitis: Date.now() + OTURUM_MS };
    jsonYaz(OTURUMLAR, v);
    sonKullaniciId = kullanici.id;
    res.setHeader("Set-Cookie", `${CEREZ}=${belirtec}; HttpOnly; SameSite=Strict; Path=/`);
  }
  function oturumKapat(req, res) {
    const belirtec = cerezOku(req);
    if (belirtec) { const v = oturumlar(); delete v[ozet(belirtec)]; try { jsonYaz(OTURUMLAR, v); } catch (_) {} }
    res.setHeader("Set-Cookie", `${CEREZ}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }

  // Kaba kuvvete karşı: dakikada en çok 5 hatalı giriş
  const hatalar = [];
  const cokDeneme = () => { const s = Date.now(); while (hatalar.length && s - hatalar[0] > 60000) hatalar.shift(); return hatalar.length >= 5; };

  // -- Üretim sahipliği (görsel, müzik, video, ses çıktıları) ---------------------
  // Yeni üretimlere üretimi başlatan kullanıcının kimliği yazılır; sahipsiz (eski) üretimleri yalnızca yönetici görür.
  const aktifSahip = () => (kurulumVar() ? sonKullaniciId : null);
  function gorebilirMi(req, sahip, sahipsizHerkes = false) {
    if (!kurulumVar()) return true;
    const k = oturumKullanicisi(req);
    if (!k) return false;
    if (!sahip) return sahipsizHerkes || !!k.yonetici;
    return sahip === k.id;
  }

  // -- Sohbet klasörü (serve.cjs sohbet geçmişi uç noktaları kullanır) -----------
  // null: giriş gerekli (kullanıcı var ama oturum yok)
  function sohbetKlasoru(req) {
    if (!kurulumVar()) return ESKI_SOHBETLER;
    const k = oturumKullanicisi(req);
    if (!k) return null;
    const d = path.join(kullaniciKlasoru(k.id), "sohbetler");
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
    return d;
  }

  // -- Hafıza -------------------------------------------------------------------
  const BASLIKLAR = ["Kişisel bilgiler", "Tercihler", "Projeler", "Devam eden işler", "Önemli kararlar"];
  const hafizaYolu = (id) => path.join(kullaniciKlasoru(id), "hafiza.json");
  function hafizaOku(id) {
    const v = jsonOku(hafizaYolu(id), null) || {};
    return { acik: v.acik !== false, bulutta: v.bulutta === true, notlar: Array.isArray(v.notlar) ? v.notlar : [], ozetlenen: v.ozetlenen || {} };
  }
  function hafizaYaz(id, h) { fs.mkdirSync(kullaniciKlasoru(id), { recursive: true }); jsonYaz(hafizaYolu(id), h); }

  function hafizaMetni(id) {
    const h = hafizaOku(id);
    if (!h.acik || !h.notlar.length) return "";
    const satirlar = [];
    for (const b of BASLIKLAR) {
      const n = h.notlar.filter((x) => x.baslik === b && !x.tur);
      if (!n.length) continue;
      satirlar.push(b + ":");
      for (const x of n.slice(-25)) satirlar.push("- " + x.metin);
    }
    let metin = satirlar.join("\n");
    if (metin.length > 3500) metin = metin.slice(0, 3500) + "\n…";
    return metin;
  }

  // -- Ad / hitap ve "unutma" notları (LLM'e bırakılmadan, anında) ---------------
  const yeniId = () => crypto.randomBytes(6).toString("hex");
  function kimlikAyarla(h, tur, deger) {
    const kucuk = (x) => String(x || "").toLocaleLowerCase("tr");
    const eski = h.notlar.find((x) => x.tur === tur);
    if (eski && kucuk(eski.deger) === kucuk(deger)) return false;
    if (tur === "hitap") {
      h.notlar = h.notlar.filter((x) => !(x.tur === "eski_hitap" && kucuk(x.deger) === kucuk(deger)));
      if (eski) { eski.tur = "eski_hitap"; eski.metin = `Önceki hitap: ${eski.deger}`; }
    } else if (eski) h.notlar = h.notlar.filter((x) => x !== eski);
    h.notlar.push({ id: yeniId(), baslik: "Kişisel bilgiler", tur, deger, metin: tur === "tam_ad" ? `Tam adı: ${deger}` : `Hitap: ${deger}`, tarih: new Date().toISOString(), kaynak: "anında" });
    return true;
  }
  function sonKullaniciMetni(messages) {
    const m = [...messages].reverse().find((x) => x && x.role === "user");
    if (!m) return "";
    const c = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p && p.text) || "").join(" ") : "";
    return c.replace(/\s+/g, " ").trim();
  }
  function anindaNotAl(id, h, messages) {
    const t = sonKullaniciMetni(messages);
    if (!t || t.length > 600) return false;
    let degisti = false;
    const temiz = (x) => String(x).replace(/["“”'’]+/g, "").replace(/\s+/g, " ").trim().replace(/[.,!?;:]+$/, "");
    // "bana X diye hitap et", "bundan sonra bana X de"
    const mh = t.match(/(?:bana|beni)\s+(?:bundan\s+sonra\s+|artık\s+)?["“']?([\p{L}][\p{L} .'-]{0,38}?)["”']?\s+(diye\s+(?:hitap\s+et|seslen|çağır)|diyebilirsin|de(?:yin)?(?=[\s.,!]|$))/u);
    if (mh && /^\p{Lu}/u.test(mh[1].trim()) && mh[1].trim().split(/\s+/).length <= 3) degisti = kimlikAyarla(h, "hitap", temiz(mh[1])) || degisti;
    // "benim adım X", "adım X", "ismim X" (büyük harfle başlayan adlar)
    const ma = t.match(/(?:^|[\s,.!])(?:[Bb]enim\s+)?(?:[Aa]d[ıi]m|[İi]smim)\s+(?!ne\b|nedir)["“']?(\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*){0,4})/u);
    if (ma) {
      const ad = temiz(ma[1]);
      const tam = h.notlar.find((x) => x.tur === "tam_ad");
      const tekKelime = ad.split(/\s+/).length === 1;
      if (!(tekKelime && tam && tam.deger.toLocaleLowerCase("tr").startsWith(ad.toLocaleLowerCase("tr")))) degisti = kimlikAyarla(h, "tam_ad", ad) || degisti;
      else degisti = true; // zaten biliniyor
    }
    // "… unutma / hatırla / aklında tut / notlarına ekle" (soru cümleleri hariç)
    if (!degisti && /(unutma|hatırla|aklında tut|notlarına ekle|not al)/iu.test(t) && !/\?|\s(m[ıiuü])(\s|$)/u.test(t)) {
      let metin = t.replace(/[,.]?\s*(bunu\s+)?(unutma|hatırla|aklında tut|notlarına ekle|not al)[\p{L}]*[.!]*/giu, " ").replace(/\s+/g, " ").trim();
      if (metin.length < 4) { const onceki = messages.filter((x) => x && x.role === "user").slice(-2, -1)[0]; metin = onceki && typeof onceki.content === "string" ? onceki.content.trim() : ""; }
      metin = metin.slice(0, 300);
      if (metin.length >= 4 && !h.notlar.some((x) => x.metin === metin)) {
        h.notlar.push({ id: yeniId(), baslik: "Kişisel bilgiler", metin, tarih: new Date().toISOString(), kaynak: "anında" });
        degisti = true;
      }
    }
    if (degisti) { hafizaYaz(id, h); motorGunlugu("[hafıza] anında not alındı"); }
    return degisti;
  }
  function kimlikSatiri(k, h) {
    const tam = h.notlar.find((x) => x.tur === "tam_ad");
    const hit = h.notlar.find((x) => x.tur === "hitap");
    const eski = h.notlar.filter((x) => x.tur === "eski_hitap").map((x) => x.deger).slice(-3);
    let s = `Şu an konuşan kullanıcının giriş (hesap) adı: ${k.ad}.`;
    if (tam) s += ` Tam adı: ${tam.deger}.`;
    if (hit) s += ` Ona "${hit.deger}" diye hitap et${eski.length ? ` (önceki hitaplar: ${eski.join(", ")}; artık kullanma)` : ""}.`;
    else if (tam) s += ` Ona "${tam.deger}" diye hitap edebilirsin.`;
    return s;
  }

  // Sohbet isteğine kimlik + hafızayı ekler (yalnızca giriş yapılmışsa)
  function mesajlaraHafizaEkle(req, messages, bulutMu) {
    if (!kurulumVar() || !Array.isArray(messages)) return messages;
    const k = oturumKullanicisi(req);
    if (!k) return messages;
    let h = hafizaOku(k.id);
    if (h.acik) { try { if (anindaNotAl(k.id, h, messages)) h = hafizaOku(k.id); } catch (_) {} }
    if (bulutMu && !h.bulutta) return messages;
    const parcalar = [kimlikSatiri(k, h.acik ? h : { notlar: [] })];
    const metin = h.acik ? hafizaMetni(k.id) : "";
    if (metin) parcalar.push(`KULLANICI HAKKINDA NOTLARIN (önceki sohbetlerden, yalnızca bu bilgisayarda tutulur). Gerektiğinde kullan, her yanıtta tekrarlama:\n${metin}`);
    const ek = parcalar.join("\n\n");
    const kopya = messages.map((m) => ({ ...m }));
    const i = kopya.findIndex((m) => m.role === "system" && typeof m.content === "string");
    if (i >= 0) kopya[i].content += "\n\n" + ek; else kopya.unshift({ role: "system", content: ek });
    return kopya;
  }

  // -- Isınma: model yüklenince / giriş yapılınca son sistem istemi önceden işlenir (ilk yanıt hızlanır) --
  const isinmaYolu = (id) => (id ? path.join(kullaniciKlasoru(id), "isinma.json") : path.join(KOK, "isinma.json"));
  function isinmaKaydet(req, sistem) {
    if (typeof sistem !== "string" || !sistem) return;
    const k = kurulumVar() ? oturumKullanicisi(req) : null;
    if (kurulumVar() && !k) return;
    const yol = isinmaYolu(k && k.id);
    const eski = jsonOku(yol, {});
    if (eski.sistem === sistem) return;
    try { fs.mkdirSync(path.dirname(yol), { recursive: true }); jsonYaz(yol, { sistem }); } catch (_) {}
  }
  let isiniyor = false;
  async function isit(id) {
    if (isiniyor || typeof ctx.llmIsit !== "function") return;
    const v = jsonOku(isinmaYolu(id), null);
    if (!v || !v.sistem) return;
    isiniyor = true;
    try { await ctx.llmIsit(v.sistem); motorGunlugu("[ısınma] sistem istemi önceden işlendi"); }
    catch (err) { motorGunlugu(`[ısınma] yapılamadı: ${String(err.message || err).slice(0, 120)}`); }
    finally { isiniyor = false; }
  }
  const isitSon = () => { if (!kurulumVar()) return isit(null); if (sonKullaniciId) return isit(sonKullaniciId); };

  // Bir sohbeti yerel modelle notlara özetler
  async function sohbetiOzetle(kullaniciId, sohbet) {
    if (typeof ctx.llmHazirMi === "function" && !ctx.llmHazirMi()) throw new Error("Özet için bir yerel sohbet modeli yüklü olmalı.");
    const mesajlar = (Array.isArray(sohbet.messages) ? sohbet.messages : [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => `${m.role === "user" ? "Kullanıcı" : "Asistan"}: ${m.content.replace(/\s+/g, " ").slice(0, 1200)}`);
    if (mesajlar.length < 2) return 0;
    let metin = mesajlar.join("\n");
    if (metin.length > 9000) metin = metin.slice(-9000);
    const h = hafizaOku(kullaniciId);
    const mevcut = h.notlar.map((n) => `- [${n.baslik}] ${n.metin}`).join("\n").slice(0, 3000);
    const istem = [
      { role: "system", content: "Bir sohbetten kullanıcı hakkında KALICI ve işe yarar bilgileri çıkaran bir not tutucusun. Yalnızca kullanıcının kendisinin söylediği, ileride de geçerli olacak bilgileri yaz (kim olduğu, tercihleri, projeleri, devam eden işleri, aldığı kararlar). Geçici şeyleri, asistanın önerilerini, tahminleri, sağlık/finans gibi hassas ayrıntıları yazma. Zaten bilinenleri (benzer anlamda olanlar dahil) tekrar etme. Tek seferlik istekleri YAZMA: bir görsel/video/müzik üretme isteği, tek bir soru, deneme/test mesajları kalıcı bilgi değildir. Kullanıcının adı ve hitap şekli ayrıca tutulur; bilinen notlarda varsa ad notu yazma. Örnekler: 'Bana uçan fil videosu yap' → yazma. 'Makine mühendisiyim' → {\"baslik\":\"Kişisel bilgiler\",\"metin\":\"Makine mühendisi.\"}. 'Kısa ve net yanıtları severim' → {\"baslik\":\"Tercihler\",\"metin\":\"Kısa ve net yanıtları sever.\"}. 'Bir galaksi simülasyonu uygulaması yapıyorum' → {\"baslik\":\"Projeler\",\"metin\":\"Galaksi simülasyonu uygulaması geliştiriyor.\"}. Yanıtın YALNIZCA JSON olsun: {\"notlar\":[{\"baslik\":\"" + BASLIKLAR.join("|") + "\",\"metin\":\"kısa Türkçe cümle\"}]} . Yeni bilgi yoksa {\"notlar\":[]}." },
      { role: "user", content: `Bilinen notlar:\n${mevcut || "(yok)"}\n\nSohbet:\n${metin}` },
    ];
    const yanit = await ctx.llmTekYanit(istem, 600);
    const m = String(yanit || "").match(/\{[\s\S]*\}/);
    if (!m) return 0;
    let veri;
    try { veri = JSON.parse(m[0]); } catch (_) { return 0; }
    const yeni = (Array.isArray(veri.notlar) ? veri.notlar : [])
      .map((n) => ({ baslik: BASLIKLAR.includes(n && n.baslik) ? n.baslik : "Kişisel bilgiler", metin: String((n && n.metin) || "").trim().slice(0, 300) }))
      .filter((n) => n.metin.length > 3);
    const norm = (x) => String(x).toLocaleLowerCase("tr").replace(/kullanıcının|kullanıcı/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
    const varolan = new Set(h.notlar.map((n) => norm(n.metin)));
    const kimlikVar = h.notlar.some((n) => n.tur);
    let eklenen = 0;
    for (const n of yeni) {
      const nn = norm(n.metin);
      if (!nn || varolan.has(nn) || [...varolan].some((v) => v.length > 8 && (v.includes(nn) || nn.includes(v)))) continue;
      if (kimlikVar && /(^|\s)(ad[ıi]|ism[ıi]|hitap)(\s|$)/u.test(nn)) continue;
      h.notlar.push({ id: crypto.randomBytes(6).toString("hex"), ...n, tarih: new Date().toISOString(), kaynak: sohbet.id || "" });
      varolan.add(nn);
      eklenen += 1;
    }
    if (h.notlar.length > 300) h.notlar = h.notlar.slice(-300);
    h.ozetlenen[sohbet.id || ""] = (sohbet.messages || []).length;
    hafizaYaz(kullaniciId, h);
    if (eklenen) motorGunlugu(`[hafıza] ${eklenen} yeni not eklendi`);
    return eklenen;
  }

  // Sohbet kaydedilince: 90 sn sessizlikten sonra (model boştaysa) özetle
  const zamanlayicilar = new Map();
  function sohbetKaydedildi(req, sohbet) {
    if (!kurulumVar() || !sohbet || !sohbet.id) return;
    const k = oturumKullanicisi(req);
    if (!k) return;
    const h = hafizaOku(k.id);
    if (!h.acik) return;
    const uzunluk = (sohbet.messages || []).length;
    if (uzunluk < 4 || (h.ozetlenen[sohbet.id] || 0) >= uzunluk) return;
    const anahtar = k.id + ":" + sohbet.id;
    clearTimeout(zamanlayicilar.get(anahtar));
    zamanlayicilar.set(anahtar, setTimeout(async function dene(tekrar = 0) {
      zamanlayicilar.delete(anahtar);
      if (typeof ctx.modelMesgulMu === "function" && ctx.modelMesgulMu()) {
        if (tekrar < 10) zamanlayicilar.set(anahtar, setTimeout(() => dene(tekrar + 1), 60000));
        return;
      }
      try {
        const dosya = path.join(kullaniciKlasoru(k.id), "sohbetler", `${String(sohbet.id).replace(/[^\w.-]/g, "")}.json`);
        const guncel = jsonOku(dosya, sohbet);
        await sohbetiOzetle(k.id, guncel);
      } catch (err) { motorGunlugu(`[hafıza] özet alınamadı: ${String(err.message || err).slice(0, 200)}`); }
    }, 90000));
  }

  // -- Uç noktalar ---------------------------------------------------------------
  async function handle(req, res) {
    const url = req.url.split("?")[0];
    if (!url.startsWith("/api/kullanici") && !url.startsWith("/api/hafiza")) return false;

    if (url === "/api/kullanici/durum" && req.method === "GET") {
      const k = oturumKullanicisi(req);
      json(res, 200, { ok: true, kurulum: kurulumVar(), girisli: !!k, kullanici: k ? { id: k.id, ad: k.ad, yonetici: !!k.yonetici } : null,
        kullanicilar: kurulumVar() ? kullanicilar().map((x) => x.ad) : [] });
      return true;
    }

    if (url === "/api/kullanici/olustur" && req.method === "POST") {
      const govde = await readJsonBody(req, res); if (!govde) return true;
      const mevcut = oturumKullanicisi(req);
      if (kurulumVar() && !mevcut) { json(res, 401, { ok: false, error: "Yeni kullanıcı eklemek için önce giriş yapın." }); return true; }
      if (kurulumVar() && !mevcut.yonetici) { json(res, 403, { ok: false, error: "Yeni kullanıcıyı yalnızca yönetici ekleyebilir." }); return true; }
      const ad = String(govde.ad || "").trim();
      const sifre = String(govde.sifre || "");
      if (!adGecerli(ad)) { json(res, 400, { ok: false, error: "Kullanıcı adı 2-40 karakter olmalı (harf, rakam, boşluk, . _ -)." }); return true; }
      if (sifre.length < 6) { json(res, 400, { ok: false, error: "Şifre en az 6 karakter olmalı." }); return true; }
      const liste = kullanicilar();
      if (liste.some((x) => x.ad.toLocaleLowerCase("tr") === ad.toLocaleLowerCase("tr"))) { json(res, 409, { ok: false, error: "Bu kullanıcı adı zaten var." }); return true; }
      const tuz = crypto.randomBytes(16).toString("hex");
      const k = { id: crypto.randomBytes(8).toString("hex"), ad, tuz, sifre: sifreOzeti(sifre, tuz), olusturma: new Date().toISOString(), yonetici: liste.length === 0 };
      liste.push(k);
      jsonYaz(LISTE, { kullanicilar: liste });
      // İlk kullanıcı: mevcut (girişsiz) sohbet geçmişi onun arşivine kopyalanır
      if (liste.length === 1 && ESKI_SOHBETLER) {
        const hedef = path.join(kullaniciKlasoru(k.id), "sohbetler");
        fs.mkdirSync(hedef, { recursive: true });
        try { for (const f of fs.readdirSync(ESKI_SOHBETLER)) if (f.endsWith(".json")) fs.copyFileSync(path.join(ESKI_SOHBETLER, f), path.join(hedef, f)); } catch (_) {}
      }
      if (!mevcut) oturumAc(res, k); // ilk kullanıcı: doğrudan giriş; yönetici başkasını eklediyse oturum değişmez
      motorGunlugu(`[kullanıcı] yeni kullanıcı oluşturuldu`);
      json(res, 200, { ok: true, kullanici: { id: k.id, ad: k.ad, yonetici: !!k.yonetici } });
      return true;
    }

    if (url === "/api/kullanici/giris" && req.method === "POST") {
      const govde = await readJsonBody(req, res); if (!govde) return true;
      if (cokDeneme()) { json(res, 429, { ok: false, error: "Çok fazla hatalı deneme. Bir dakika sonra tekrar deneyin." }); return true; }
      const ad = String(govde.ad || "").trim().toLocaleLowerCase("tr");
      const k = kullanicilar().find((x) => x.ad.toLocaleLowerCase("tr") === ad);
      const dogru = k && crypto.timingSafeEqual(Buffer.from(sifreOzeti(String(govde.sifre || ""), k.tuz), "hex"), Buffer.from(k.sifre, "hex"));
      if (!dogru) { hatalar.push(Date.now()); json(res, 401, { ok: false, error: "Kullanıcı adı ya da şifre hatalı." }); return true; }
      oturumAc(res, k);
      setTimeout(() => { isit(k.id); }, 500);
      json(res, 200, { ok: true, kullanici: { id: k.id, ad: k.ad, yonetici: !!k.yonetici } });
      return true;
    }

    if (url === "/api/kullanici/cikis" && req.method === "POST") {
      oturumKapat(req, res);
      json(res, 200, { ok: true });
      return true;
    }

    // Buradan sonrası giriş gerektirir
    const k = oturumKullanicisi(req);
    if (!k) { json(res, 401, { ok: false, error: "Giriş yapmanız gerekiyor." }); return true; }

    if (url === "/api/kullanici/sifre" && req.method === "POST") {
      const govde = await readJsonBody(req, res); if (!govde) return true;
      const liste = kullanicilar();
      const x = liste.find((y) => y.id === k.id);
      if (!crypto.timingSafeEqual(Buffer.from(sifreOzeti(String(govde.eski || ""), x.tuz), "hex"), Buffer.from(x.sifre, "hex"))) { json(res, 401, { ok: false, error: "Mevcut şifre hatalı." }); return true; }
      if (String(govde.yeni || "").length < 6) { json(res, 400, { ok: false, error: "Yeni şifre en az 6 karakter olmalı." }); return true; }
      x.tuz = crypto.randomBytes(16).toString("hex");
      x.sifre = sifreOzeti(String(govde.yeni), x.tuz);
      jsonYaz(LISTE, { kullanicilar: liste });
      json(res, 200, { ok: true });
      return true;
    }

    // -- Yönetici: kullanıcıları listele / sil / şifre sıfırla / yönetici yap ------
    if (url === "/api/kullanici/liste" && req.method === "GET") {
      if (!k.yonetici) { json(res, 403, { ok: false, error: "Bu işlem için yönetici olmalısınız." }); return true; }
      const l = kullanicilar().map((x) => {
        let sohbet = 0; try { sohbet = fs.readdirSync(path.join(kullaniciKlasoru(x.id), "sohbetler")).filter((f) => f.endsWith(".json")).length; } catch (_) {}
        return { id: x.id, ad: x.ad, yonetici: !!x.yonetici, olusturma: x.olusturma || "", sohbet, ben: x.id === k.id };
      });
      json(res, 200, { ok: true, kullanicilar: l });
      return true;
    }
    if (url === "/api/kullanici/yonet" && req.method === "POST") {
      if (!k.yonetici) { json(res, 403, { ok: false, error: "Bu işlem için yönetici olmalısınız." }); return true; }
      const govde = await readJsonBody(req, res); if (!govde) return true;
      const liste = kullanicilar();
      const x = liste.find((y) => y.id === govde.id);
      if (!x) { json(res, 404, { ok: false, error: "Kullanıcı bulunamadı." }); return true; }
      const islem = String(govde.islem || "");
      if (islem === "sil") {
        if (x.id === k.id) { json(res, 400, { ok: false, error: "Kendi hesabınızı silemezsiniz." }); return true; }
        if (x.yonetici && yoneticiSayisi(liste) <= 1) { json(res, 400, { ok: false, error: "Son yönetici silinemez." }); return true; }
        jsonYaz(LISTE, { kullanicilar: liste.filter((y) => y.id !== x.id) });
        const v = oturumlar(); for (const [a, o] of Object.entries(v)) if (o.id === x.id) delete v[a]; try { jsonYaz(OTURUMLAR, v); } catch (_) {}
        try { if (/^[a-f0-9]{8,32}$/.test(String(x.id))) fs.rmSync(kullaniciKlasoru(x.id), { recursive: true, force: true }); } catch (err) { motorGunlugu(`[kullanıcı] klasör silinemedi: ${err.message}`); }
        motorGunlugu("[kullanıcı] bir kullanıcı silindi (sohbetleri ve hafızasıyla)");
      } else if (islem === "sifirla") {
        const yeni = String(govde.sifre || "");
        if (yeni.length < 6) { json(res, 400, { ok: false, error: "Yeni şifre en az 6 karakter olmalı." }); return true; }
        x.tuz = crypto.randomBytes(16).toString("hex"); x.sifre = sifreOzeti(yeni, x.tuz);
        jsonYaz(LISTE, { kullanicilar: liste });
        const v = oturumlar(); for (const [a, o] of Object.entries(v)) if (o.id === x.id && x.id !== k.id) delete v[a]; try { jsonYaz(OTURUMLAR, v); } catch (_) {}
      } else if (islem === "yonetici" || islem === "yonetici-kaldir") {
        const ol = islem === "yonetici";
        if (!ol && x.yonetici && yoneticiSayisi(liste) <= 1) { json(res, 400, { ok: false, error: "En az bir yönetici kalmalı." }); return true; }
        x.yonetici = ol;
        jsonYaz(LISTE, { kullanicilar: liste });
      } else { json(res, 400, { ok: false, error: "Bilinmeyen işlem." }); return true; }
      json(res, 200, { ok: true });
      return true;
    }

    if (url === "/api/hafiza" && req.method === "GET") {
      const h = hafizaOku(k.id);
      json(res, 200, { ok: true, acik: h.acik, bulutta: h.bulutta, basliklar: BASLIKLAR, notlar: h.notlar });
      return true;
    }
    if (url === "/api/hafiza/ayar" && req.method === "POST") {
      const govde = await readJsonBody(req, res); if (!govde) return true;
      const h = hafizaOku(k.id);
      if (typeof govde.acik === "boolean") h.acik = govde.acik;
      if (typeof govde.bulutta === "boolean") h.bulutta = govde.bulutta;
      hafizaYaz(k.id, h);
      json(res, 200, { ok: true, acik: h.acik, bulutta: h.bulutta });
      return true;
    }
    if (url === "/api/hafiza/not" && req.method === "POST") {
      const govde = await readJsonBody(req, res); if (!govde) return true;
      const h = hafizaOku(k.id);
      const metin = String(govde.metin || "").trim().slice(0, 300);
      const baslik = BASLIKLAR.includes(govde.baslik) ? govde.baslik : "Kişisel bilgiler";
      if (govde.id) {
        const n = h.notlar.find((x) => x.id === govde.id);
        if (!n) { json(res, 404, { ok: false, error: "Not bulunamadı." }); return true; }
        if (govde.sil) h.notlar = h.notlar.filter((x) => x.id !== govde.id);
        else { if (metin) n.metin = metin; n.baslik = baslik; }
      } else if (metin) {
        h.notlar.push({ id: crypto.randomBytes(6).toString("hex"), baslik, metin, tarih: new Date().toISOString(), kaynak: "elle" });
      }
      hafizaYaz(k.id, h);
      json(res, 200, { ok: true, notlar: h.notlar });
      return true;
    }
    if (url === "/api/hafiza/temizle" && req.method === "POST") {
      const h = hafizaOku(k.id);
      h.notlar = []; h.ozetlenen = {};
      hafizaYaz(k.id, h);
      json(res, 200, { ok: true });
      return true;
    }
    if (url === "/api/hafiza/tara" && req.method === "POST") {
      // Tüm arşivlenmiş sohbetleri sırayla özetler (arka planda)
      const d = path.join(kullaniciKlasoru(k.id), "sohbetler");
      let dosyalar = [];
      try { dosyalar = fs.readdirSync(d).filter((f) => f.endsWith(".json")); } catch (_) {}
      json(res, 200, { ok: true, sohbet: dosyalar.length });
      (async () => {
        let toplam = 0;
        for (const f of dosyalar) {
          const s = jsonOku(path.join(d, f), null);
          if (!s || (hafizaOku(k.id).ozetlenen[s.id] || 0) >= (s.messages || []).length) continue;
          try { toplam += await sohbetiOzetle(k.id, s); } catch (err) { motorGunlugu(`[hafıza] tarama durdu: ${String(err.message || err).slice(0, 160)}`); break; }
        }
        motorGunlugu(`[hafıza] tarama bitti: ${toplam} yeni not`);
      })();
      return true;
    }

    json(res, 404, { ok: false, error: "Bilinmeyen uç nokta" });
    return true;
  }

  return { handle, sohbetKlasoru, mesajlaraHafizaEkle, sohbetKaydedildi, kurulumVar, oturumKullanicisi, isinmaKaydet, isit, isitSon, kullaniciKlasoru, aktifSahip, gorebilirMi };
};

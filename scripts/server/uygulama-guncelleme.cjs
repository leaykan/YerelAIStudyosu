// Uygulama güncellemesi (Yerel AI Stüdyosu)
//
// Ayarlar > "Uygulama güncellemesi": GitHub'daki son sürümü (Kurulum.bat'taki $Repo deposu) kurulu sürümle
// (kökteki VERSION) karşılaştırır. Güncelleme yalnızca yönetici tarafından başlatılır (serve.cjs giriş kapısı):
//   1. Sürümdeki Kurulum.bat ve SHA256SUMS.txt indirilir; Kurulum.bat'ın özeti SHA256SUMS ile doğrulanır.
//   2. Uygulama kapanır; Kurulum.bat soru sormayan güncelleme kipinde (YAS_GUNCELLE_HEDEF) bu klasörün üzerine çalışır.
//      Sürüm zip'i Kurulum.bat tarafından SHA256 ile doğrulanır. Modeller, sohbetler, kullanıcılar ve ayarlar korunur.
//   3. Güncelleme bitince uygulama kendiliğinden yeniden açılır.
// VERSION dosyası olmayan kopya (geliştirme kopyası) bu yolla güncellenmez.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

module.exports = function uygulamaGuncelleme(ctx) {
  const { ROOT, json, motorGunlugu = () => {}, kapatVeCalistir } = ctx;
  const fetchImpl = ctx.fetch || globalThis.fetch;
  const BASLIK = { "User-Agent": "YerelAIStudyosu-Guncelleme", Accept: "application/vnd.github+json" };

  function depo() {
    try {
      const m = fs.readFileSync(path.join(ROOT, "Kurulum.bat"), "utf8").match(/^\$Repo\s*=\s*'([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)'/m);
      return m && !/^HESAP\//.test(m[1]) ? m[1] : null;
    } catch (_) { return null; }
  }
  function kuruluSurum() {
    try { return fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim().slice(0, 40); } catch (_) { return ""; }
  }
  function surumKarsilastir(a, b) {
    const p = (s) => String(s || "").replace(/^v/i, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    const x = p(a), y = p(b);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); }
    return 0;
  }

  let onbellek = null; // { zaman, veri }
  async function sonSurum(yenile = false) {
    // "Şimdi denetle" bile en çok dakikada bir GitHub'a gider (GitHub'ın istek sınırı aşılmasın)
    if (onbellek && Date.now() - onbellek.zaman < (yenile ? 60 * 1000 : 10 * 60 * 1000)) return onbellek.veri;
    const d = depo();
    if (!d) throw new Error("GitHub deposu tanımlı değil.");
    const r = await fetchImpl(`https://api.github.com/repos/${d}/releases/latest`, { headers: BASLIK });
    if (!r.ok) throw new Error(`GitHub sürüm bilgisi alınamadı (HTTP ${r.status}).`);
    const s = await r.json();
    const varlik = (ad) => (Array.isArray(s.assets) ? s.assets : []).find((a) => a && a.name === ad);
    const veri = {
      depo: d,
      etiket: String(s.tag_name || ""),
      surum: String(s.tag_name || "").replace(/^v/i, ""),
      ad: String(s.name || ""),
      notlar: String(s.body || "").slice(0, 3000),
      tarih: s.published_at || "",
      // Bağlantı yalnızca GitHub'a gidebilir (arayüzde href olarak kullanılır)
      sayfa: /^https:\/\/github\.com\//.test(String(s.html_url || "")) ? s.html_url : `https://github.com/${d}/releases`,
      kurulum: varlik("Kurulum.bat") ? varlik("Kurulum.bat").browser_download_url : "",
      ozetler: varlik("SHA256SUMS.txt") ? varlik("SHA256SUMS.txt").browser_download_url : "",
    };
    onbellek = { zaman: Date.now(), veri };
    return veri;
  }

  async function indir(url, azamiBayt) {
    if (!/^https:\/\/github\.com\//.test(url)) throw new Error("Güvensiz indirme adresi (yalnızca github.com).");
    const r = await fetchImpl(url, { headers: { "User-Agent": BASLIK["User-Agent"] }, redirect: "follow" });
    if (!r.ok) throw new Error(`İndirilemedi (HTTP ${r.status}).`);
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > azamiBayt) throw new Error("İndirilen dosya beklenenden büyük.");
    return b;
  }

  let suruyor = false;
  async function guncelle() {
    if (process.platform !== "win32") throw Object.assign(new Error("Uygulama içinden güncelleme yalnızca Windows'ta. Diğer sistemlerde yeni sürümü elle kurun."), { status: 400 });
    const kurulu = kuruluSurum();
    if (!kurulu) throw Object.assign(new Error("Bu bir geliştirme kopyası (VERSION dosyası yok); uygulama içinden güncellenmez."), { status: 400 });
    if (suruyor) throw Object.assign(new Error("Güncelleme zaten başlatıldı."), { status: 409 });
    // Komut dosyasına yazılacak yol: komut istemi için özel karakter içeremez (% ! " ^ & < > |)
    if (/[%!"^&<>|\r\n]/.test(ROOT)) throw Object.assign(new Error("Kurulum klasörünün yolunda özel karakter var; uygulama içinden güncellenemez. Kurulum.bat ile güncelleyin."), { status: 400 });
    const s = await sonSurum(true);
    if (surumKarsilastir(s.surum, kurulu) <= 0) throw Object.assign(new Error("Uygulama zaten güncel."), { status: 400 });
    if (!s.kurulum || !s.ozetler) throw Object.assign(new Error("Sürümde Kurulum.bat ya da SHA256SUMS.txt yok; güncelleme yapılamaz."), { status: 400 });
    suruyor = true;
    try {
      const ozetler = (await indir(s.ozetler, 64 * 1024)).toString("utf8");
      const bat = await indir(s.kurulum, 2 * 1024 * 1024);
      const m = ozetler.match(/^([a-f0-9]{64})\s+\*?Kurulum\.bat\s*$/im);
      if (!m) throw new Error("SHA256SUMS.txt içinde Kurulum.bat özeti yok.");
      const ozet = crypto.createHash("sha256").update(bat).digest("hex");
      if (ozet !== m[1].toLowerCase()) throw new Error("Kurulum.bat özeti tutmuyor; güncelleme durduruldu (dosya bozuk ya da değiştirilmiş).");
      const klasor = fs.mkdtempSync(path.join(os.tmpdir(), "yas-guncelleme-"));
      const batYolu = path.join(klasor, "Kurulum.bat");
      fs.writeFileSync(batYolu, bat);
      const baslatici = path.join(klasor, "guncelle.cmd");
      fs.writeFileSync(baslatici, [
        "@echo off",
        `set "YAS_GUNCELLE_HEDEF=${ROOT}"`,
        "set \"YAS_SESSIZ=1\"",
        `set "YAS_BEKLE_PID=${process.pid}"`,
        `call "${batYolu}"`,
        "",
      ].join("\r\n"), "utf8");
      motorGunlugu(`[uygulama] ${kurulu} → ${s.surum} güncellemesi başlatıldı (Kurulum.bat özeti doğrulandı)`);
      return { kurulu, yeni: s.surum, calistir: () => {
        spawn("cmd.exe", ["/d", "/s", "/c", `start "Yerel AI Studyosu - Guncelleme" cmd /c "${baslatici}"`], {
          detached: true, stdio: "ignore", cwd: klasor, windowsVerbatimArguments: true,
        }).unref();
      } };
    } catch (err) { suruyor = false; throw err; }
  }

  async function handle(req, res) {
    const yol = req.url.split("?")[0];
    if (!yol.startsWith("/api/uygulama/")) return false;
    try {
      if (yol === "/api/uygulama/surum" && req.method === "GET") {
        const yenile = /[?&]yenile=1/.test(req.url);
        const kurulu = kuruluSurum();
        let son = null, hata = "";
        try { son = await sonSurum(yenile); } catch (err) { hata = err.message || String(err); }
        json(res, 200, { ok: true, kurulu, gelistirme: !kurulu, son, yeniVar: Boolean(kurulu && son && surumKarsilastir(son.surum, kurulu) > 0), hata, windows: process.platform === "win32" });
        return true;
      }
      if (yol === "/api/uygulama/guncelle" && req.method === "POST") {
        const r = await guncelle();
        json(res, 200, { ok: true, kurulu: r.kurulu, yeni: r.yeni });
        // Yanıt gittikten sonra: motorlar kapanır, sunucu kapanır, Kurulum.bat güncelleme kipinde çalışır
        setTimeout(() => { kapatVeCalistir(r.calistir).catch(() => {}); }, 1000);
        return true;
      }
      json(res, 404, { ok: false, error: "Bilinmeyen uç nokta" });
      return true;
    } catch (err) {
      json(res, err.status || 500, { ok: false, error: err.message || String(err) });
      return true;
    }
  }

  return { handle, kuruluSurum, surumKarsilastir };
};

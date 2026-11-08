// Ağ kalkanı ve ağ gözcüsü (Yerel AI Stüdyosu, Windows)
//
// Modeller ve onları çalıştıran motorlar (Python, llama.cpp, stable-diffusion.cpp, whisper.cpp, Piper...) internete
// ihtiyaç duymaz. Bir model ya da Python paketi kötü niyetli olsa (bugün ya da aylar sonra gelen bir sürümde) bile
// kullanıcının verisini dışarı gönderemesin diye iki katman vardır:
//
// 1. KALKAN (engelleme): app/ altındaki bütün .exe dosyaları için Windows Güvenlik Duvarı'nda "dışarı çıkış yasak" kuralı.
//    Yalnızca iki program hariç: uygulamanın sunucusu (node.exe; web araması, model indirme, güncelleme bu kontrollü
//    kanaldan yapılır) ve yalnızca paket kurulumunda kullanılan Python kopyası (python-kurulum.exe).
//    Kuralları eklemek bir kez Windows yönetici izni (UAC) ister.
// 2. GÖZCÜ (izleme): birkaç saniyede bir, uygulamanın başlattığı bütün süreçlerin (ve onların alt süreçlerinin) internet
//    bağlantılarına bakar. Sunucu dışında bağlantı kuran süreç durdurulur, günlüğe yazılır ve arayüzde kırmızı uyarı
//    gösterilir. Kalkanı başka bir programla (ör. powershell, curl) aşma denemesi de böyle yakalanır. Kurulum/indirme
//    sürerken yalnızca kurulum araçlarına (python-kurulum.exe, powershell.exe) izin verilir. Yönetici izni gerekmez.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

module.exports = function agKalkani(ctx) {
  const { ROOT, json, readJsonBody, motorGunlugu = () => {}, kurulumSuruyor = () => false } = ctx;
  const WIN = process.platform === "win32";
  const APP = path.join(ROOT, "app");
  const AYAR = path.join(APP, "config", "ag-kalkani.json");
  // Kural grubu ve görev bu kuruluma özel (aynı bilgisayarda birden çok kurulum olabilir); ag-kalkani.ps1 ile aynı hesap
  const KIMLIK = crypto.createHash("sha256").update(path.resolve(ROOT).replace(/[\\/]+$/, "").toLowerCase(), "utf8").digest("hex").slice(0, 8);
  const GRUP = `YerelAIStudyosuKalkani-${KIMLIK}`;
  const GOREV = `YerelAIStudyosu Ag Kalkani ${KIMLIK}`;
  const BETIK = path.join(ROOT, "scripts", "setup", "ag-kalkani.ps1");
  // Kalkan betiğinin korumalı klasöre yazdığı durum işareti (kullanıcılar yalnızca okuyabilir)
  const ISARET = path.join(process.env.ProgramData || "C:\\ProgramData", "YerelAIStudyosu", `kalkan-${KIMLIK}.json`);
  const isaretOku = () => { try { return JSON.parse(fs.readFileSync(ISARET, "utf8").replace(/^\ufeff/, "")) || null; } catch (_) { return null; } };
  const NODE_EXE = path.resolve(process.execPath).toLowerCase();
  const KURULUM_PY = path.join(APP, "tools", "python-win", "python-kurulum.exe").toLowerCase();
  const KURULUM_ARACLARI = new Set(["python-kurulum.exe", "powershell.exe", "pwsh.exe"]);

  const ayarOku = () => { try { return JSON.parse(fs.readFileSync(AYAR, "utf8")) || {}; } catch (_) { return {}; } };
  const ayarYaz = (a) => { try { fs.mkdirSync(path.dirname(AYAR), { recursive: true }); fs.writeFileSync(AYAR, JSON.stringify(a, null, 2), "utf8"); } catch (_) {} };

  function ps(komut, zamanAsimiMs = 60000) {
    return new Promise((resolve) => {
      let cikti = "", p;
      try { p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", komut], { windowsHide: true }); }
      catch (err) { resolve({ kod: -1, cikti: String(err.message || err) }); return; }
      const t = setTimeout(() => { try { p.kill(); } catch (_) {} }, zamanAsimiMs);
      p.stdout.on("data", (d) => { cikti += d; if (cikti.length > 8e6) cikti = cikti.slice(-8e6); });
      p.stderr.on("data", () => {});
      p.on("error", (e) => { clearTimeout(t); resolve({ kod: -1, cikti: String(e.message || e) }); });
      p.on("close", (kod) => { clearTimeout(t); resolve({ kod, cikti }); });
    });
  }

  // Korunacak programlar: app/ altındaki tüm .exe'ler (sunucu ve kurulum kopyası hariç)
  function programlar() {
    const sonuc = [];
    const gez = (d, derinlik) => {
      if (derinlik > 12) return;
      let girdiler = [];
      try { girdiler = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const g of girdiler) {
        const tam = path.join(d, g.name);
        if (g.isDirectory()) { if (!/^(node_modules|cache|kullanicilar|outputs|tts-outputs|chat-history|frontend|dist)$/i.test(g.name)) gez(tam, derinlik + 1); }
        else if (/\.exe$/i.test(g.name)) {
          const k = path.resolve(tam).toLowerCase();
          if (k !== NODE_EXE && k !== KURULUM_PY && !/[\\/]tools[\\/]node-win[\\/]/i.test(k)) sonuc.push(path.resolve(tam));
        }
      }
    };
    gez(APP, 0);
    return sonuc;
  }

  // -- Kalkan durumu (yönetici izni gerekmez) ---------------------------------------
  let durum = { denetlendi: 0, korunan: [], korumasiz: [], guvenlikDuvariAcik: null, hata: "" };
  let denetleniyor = null;
  async function kalkanDenetle() {
    if (!WIN) return durum;
    if (denetleniyor) return denetleniyor;
    denetleniyor = (async () => {
      const r = await ps(`$ErrorActionPreference='SilentlyContinue'; $k = @(Get-NetFirewallRule -Group '${GRUP}' | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Outbound' -and $_.Action -eq 'Block' } | Get-NetFirewallApplicationFilter | ForEach-Object { $_.Program }); $pr = @(Get-NetFirewallProfile); $a = @($pr | Where-Object { "$($_.Enabled)" -eq 'True' }).Count; $t = $pr.Count; $g = [bool](Get-ScheduledTask -TaskName '${GOREV}' -ErrorAction SilentlyContinue); @{ k = $k; a = $a; t = $t; g = $g } | ConvertTo-Json -Compress`);
      try {
        const v = JSON.parse(String(r.cikti).trim() || "{}");
        const kurallar = new Set((Array.isArray(v.k) ? v.k : v.k ? [v.k] : []).map((x) => String(x).toLowerCase()));
        const liste = programlar();
        durum = {
          denetlendi: Date.now(),
          korunan: liste.filter((p) => kurallar.has(p.toLowerCase())),
          korumasiz: liste.filter((p) => !kurallar.has(p.toLowerCase())),
          // Profiller okunamadıysa (yetki) "bilinmiyor"; kalkan görevinin yazdığı işaret daha güvenilirdir
          guvenlikDuvariAcik: Number(v.t) > 0 ? Number(v.a) > 0 : null,
          gorev: Boolean(v.g),
          hata: "",
        };
      } catch (_) { durum = { ...durum, denetlendi: Date.now(), hata: "Güvenlik duvarı kuralları okunamadı." }; }
      denetleniyor = null;
      return durum;
    })();
    return denetleniyor;
  }

  // -- Kalkanı kur / kaldır (Windows yönetici izni ister: UAC penceresi bu bilgisayarda açılır) ---
  let kuruluyor = false;
  async function kalkaniKur() { return yonetimIslemi("Kur"); }
  async function yonetimIslemi(islem) {
    if (!WIN) throw Object.assign(new Error("Ağ kalkanı yalnızca Windows'ta."), { status: 400 });
    if (kuruluyor) throw Object.assign(new Error("Kalkan zaten kuruluyor."), { status: 409 });
    if (!fs.existsSync(BETIK)) throw Object.assign(new Error("ag-kalkani.ps1 bulunamadı."), { status: 500 });
    kuruluyor = true;
    try {
      const klasor = fs.mkdtempSync(path.join(os.tmpdir(), "yas-kalkan-"));
      const sonucYolu = path.join(klasor, "sonuc.txt");
      const q = (x) => String(x).replace(/'/g, "''");
      // Windows yönetici izni (UAC) penceresi bu bilgisayarda açılır
      const r = await ps(`try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${q(BETIK)}"','-Islem','${islem}','-Kok','"${q(ROOT)}"','-Sonuc','"${q(sonucYolu)}"'; 'ok' } catch { 'iptal' }`, 10 * 60 * 1000);
      let sonuc = "";
      try { sonuc = fs.readFileSync(sonucYolu, "utf8").replace(/^\ufeff/, "").trim(); } catch (_) {}
      try { fs.rmSync(klasor, { recursive: true, force: true }); } catch (_) {}
      if (!sonuc) throw Object.assign(new Error(/iptal/.test(r.cikti) ? "Yönetici izni verilmedi; kalkan değişmedi." : "Kalkan betiği çalışmadı."), { status: 400 });
      if (sonuc.startsWith("hata")) throw Object.assign(new Error("Kalkan işlemi yapılamadı: " + sonuc.slice(5)), { status: 500 });
      motorGunlugu(islem === "Kapat" ? "[ağ kalkanı] YÖNETİCİ TARAFINDAN KAPATILDI (kurallar devre dışı; gözcü çalışmaya devam ediyor)"
        : islem === "Ac" ? "[ağ kalkanı] yönetici tarafından yeniden açıldı"
        : `[ağ kalkanı] kuruldu (${sonuc.replace("tamam ", "")} yeni kural; otomatik güncelleme görevi etkin)`);
      await kalkanDenetle();
      return durum;
    } finally { kuruluyor = false; }
  }

  // -- Gözcü ----------------------------------------------------------------------------
  const uyarilar = []; // { id, zaman, program, yol, adres, port, durduruldu }
  let gozcuCalisiyor = false;
  async function gozle() {
    if (!WIN || gozcuCalisiyor) return;
    gozcuCalisiyor = true;
    try {
      const r = await ps("$ErrorActionPreference='SilentlyContinue'; $p = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath); $c = @(Get-NetTCPConnection -State Established,SynSent | Where-Object { $_.RemoteAddress -notmatch '^(127\\.|::1$|0\\.0\\.0\\.0$|::$|::ffff:127\\.)' } | Select-Object OwningProcess,RemoteAddress,RemotePort); @{ p = $p; c = $c } | ConvertTo-Json -Compress -Depth 3", 45000);
      let v;
      try { v = JSON.parse(String(r.cikti).trim()); } catch (_) { return; }
      const surecler = Array.isArray(v.p) ? v.p : v.p ? [v.p] : [];
      const baglantilar = Array.isArray(v.c) ? v.c : v.c ? [v.c] : [];
      if (!baglantilar.length) return;
      const cocuklar = new Map();
      for (const s of surecler) { const k = Number(s.ParentProcessId); if (!cocuklar.has(k)) cocuklar.set(k, []); cocuklar.get(k).push(s); }
      const soy = new Map(); // pid -> süreç (sunucunun tüm torunları)
      const yigin = [process.pid];
      while (yigin.length) {
        const pid = yigin.pop();
        for (const s of cocuklar.get(pid) || []) { if (!soy.has(Number(s.ProcessId))) { soy.set(Number(s.ProcessId), s); yigin.push(Number(s.ProcessId)); } }
      }
      const kurulumda = (() => { try { return !!kurulumSuruyor(); } catch (_) { return false; } })();
      for (const b of baglantilar) {
        const s = soy.get(Number(b.OwningProcess));
        if (!s) continue; // uygulamaya ait değil (ya da sunucunun kendisi)
        const ad = String(s.Name || "").toLowerCase();
        if (kurulumda && KURULUM_ARACLARI.has(ad)) continue;
        const yol = String(s.ExecutablePath || "");
        const anahtar = `${s.ProcessId}:${b.RemoteAddress}:${b.RemotePort}`;
        if (uyarilar.some((u) => u.anahtar === anahtar)) continue;
        await new Promise((ok) => { const k = spawn("taskkill", ["/PID", String(s.ProcessId), "/T", "/F"], { windowsHide: true }); k.on("close", ok); k.on("error", ok); });
        const goreli = yol && path.resolve(yol).toLowerCase().startsWith(path.resolve(ROOT).toLowerCase()) ? path.relative(ROOT, yol) : yol;
        const u = { id: crypto.randomBytes(5).toString("hex"), anahtar, zaman: new Date().toISOString(), program: s.Name || "?", yol: goreli, adres: String(b.RemoteAddress), port: Number(b.RemotePort) || 0, durduruldu: true, okundu: false };
        uyarilar.push(u);
        if (uyarilar.length > 50) uyarilar.shift();
        motorGunlugu(`[ağ gözcüsü] UYARI: ${u.program} (${u.yol}) internete bağlanmaya çalıştı → ${u.adres}:${u.port}; süreç durduruldu`);
      }
    } finally { gozcuCalisiyor = false; }
  }
  if (WIN) {
    const z = setInterval(() => { gozle().catch(() => {}); }, 20000);
    if (z.unref) z.unref();
    const d = setTimeout(() => { kalkanDenetle().catch(() => {}); }, 15000);
    if (d.unref) d.unref();
    const d2 = setInterval(() => { kalkanDenetle().catch(() => {}); }, 10 * 60 * 1000);
    if (d2.unref) d2.unref();
  }

  function ozet() {
    return {
      ok: true,
      windows: WIN,
      kuruluyor,
      kalkan: { ...(() => {
          const i = isaretOku();
          const kural = i && i.kapali ? 0 : Math.max(durum.korunan.length, Number(i && i.kural) || 0);
          const son = i && i.sonEsitleme ? Date.parse(i.sonEsitleme) : 0;
          const duvar = i && typeof i.duvarAcik === "boolean" ? i.duvarAcik : durum.guvenlikDuvariAcik;
          return { aktif: Boolean(i && !i.kapali && kural > 0 && duvar !== false), kapali: Boolean(i && i.kapali), guvenlikDuvariAcik: duvar, sonEsitleme: i ? i.sonEsitleme : null,
            gorevGecikti: Boolean(i && son && Date.now() - son > 6 * 60 * 60 * 1000), kuralSayisi: kural };
        })(),
        denetlendi: durum.denetlendi, gorev: Boolean(durum.gorev || (isaretOku() || {}).gorev), korunanSayi: durum.korunan.length, korumasizSayi: durum.korumasiz.length,
        korumasiz: durum.korumasiz.slice(0, 30).map((p) => path.relative(ROOT, p)), hata: durum.hata },
      gozcu: { calisiyor: WIN },
      uyarilar: uyarilar.filter((u) => !u.okundu).map(({ anahtar, ...u }) => u),
    };
  }

  async function handle(req, res) {
    const yol = req.url.split("?")[0];
    if (!yol.startsWith("/api/ag-kalkani")) return false;
    try {
      if (yol === "/api/ag-kalkani" && req.method === "GET") {
        if (/[?&]denetle=1/.test(req.url)) await kalkanDenetle();
        json(res, 200, ozet());
        return true;
      }
      // Tamamen kaldırma yalnızca uygulamayı silerken (yönetici olarak ag-kalkani.ps1 -Islem Kaldir)
      if (yol === "/api/ag-kalkani/kur" && req.method === "POST") { await kalkaniKur(); json(res, 200, ozet()); return true; }
      // Kapatma/açma: yalnızca yönetici (serve.cjs giriş kapısı) ve her seferinde Windows yönetici izni (UAC)
      if (yol === "/api/ag-kalkani/kapat" && req.method === "POST") { await yonetimIslemi("Kapat"); json(res, 200, ozet()); return true; }
      if (yol === "/api/ag-kalkani/ac" && req.method === "POST") { await yonetimIslemi("Ac"); json(res, 200, ozet()); return true; }
      if (yol === "/api/ag-kalkani/uyari-kapat" && req.method === "POST") {
        const g = await readJsonBody(req, res); if (!g) return true;
        for (const u of uyarilar) if (!g.id || u.id === g.id) u.okundu = true;
        json(res, 200, ozet());
        return true;
      }
      json(res, 404, { ok: false, error: "Bilinmeyen uç nokta" });
      return true;
    } catch (err) {
      json(res, err.status || 500, { ok: false, error: err.message || String(err) });
      return true;
    }
  }

  return { handle, kalkanDenetle, gozle, programlar, ozet };
};

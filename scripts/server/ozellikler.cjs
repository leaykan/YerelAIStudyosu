// ============================================================================
// ÖZELLİK ALTYAPISI (Yerel AI Stüdyosu)
// - Taşınabilir Python (app/tools/python-win) ve özellik başına pip kurulumu
// - Hugging Face'ten çok dosyalı model paketi indirme
// - Kalıcı Python çalışanları (model bir kez yüklenir, boşta kalınca kapanır)
// Parçaların bir kısmı DD:YZ "Sansürsüz Lokal AI Stüdyosu V2" (MIT) projesinden uyarlanmıştır.
// ============================================================================
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

module.exports = function ozellikAltyapisi({ ROOT, pathInside, log = console.log }) {
  const osPlatform = process.platform;
  const APP = path.join(ROOT, "app");
  const PY_DIR = path.join(APP, "tools", "python-win");
  const PYTHON = osPlatform === "win32" ? path.join(PY_DIR, "python.exe") : (process.env.PYTHON_BIN || "python3");
  const PIP_CACHE = path.join(APP, "cache", "pip");
  // python.org'un 3.12.10 gömülü sürüm sayfasında yayımladığı MD5 özeti (indirme bütünlüğü; python.org bu sürüm için SHA256 yayımlamıyor)
  const PYTHON_EMBED_MD5 = "FE8EF205F2E9C3BA44D0CF9954E1ABD3";
  const HF_CACHE = path.join(APP, "cache", "hf");
  const KALICI_CALISAN = path.join(ROOT, "scripts", "workers", "kalici_calisan.py");
  const CALISAN_KLASORU = path.dirname(KALICI_CALISAN);
  const KLASORLER = {
    konusma: path.join(APP, "speech-models"),
    ses: path.join(APP, "tts-models"),
    muzik: path.join(APP, "music-models"),
    video: path.join(APP, "video-models"),
  };
  for (const k of Object.values(KLASORLER)) { try { fs.mkdirSync(k, { recursive: true }); } catch (_) {} }

  // --------------------------------------------------------------------------
  // Özellikler: her biri bir ya da birkaç pip adımı ve doğrulama için içe aktarılacak modüller
  // --------------------------------------------------------------------------
  const OZELLIKLER = {
    "speech-seda": {
      etiket: "Seda Türkçe ses tanıma",
      moduller: ["sedalib", "sherpa_onnx", "onnxruntime", "tokenizers", "numpy"],
      // Sürümler sabit, yalnızca hazır paket (wheel): kaynak koddan derleme/kurulum betiği çalışmaz
      adimlar: [["--only-binary=:all:", "numpy==2.5.4", "onnxruntime==1.31.1", "tokenizers==0.23.3", "sherpa-onnx==2.0.1", "sherpa-onnx-core==2.0.1"],
        ["--only-binary=:all:", "--no-deps", "sedalib==1.0.0"]],
      boyut: "~120 MB",
    },
    // --- Türkçe seslendirme motorları (V2'den uyarlandı; sürümler ve ağırlık commit'leri sabit) ---
    "tts-antalia": {
      etiket: "Antalia-2 Mini (Türkçe erkek sesi)",
      moduller: ["antalia_mini", "soundfile", "safetensors", "cmudict"],
      adimlar: [["--only-binary=:all:", "--index-url", "https://download.pytorch.org/whl/cpu", "torch==2.14.1"],
        ["--only-binary=:all:", "numpy==2.5.4", "safetensors==0.8.0", "soundfile==0.14.0", "cmudict==1.1.3", "huggingface_hub==2.3.0"],
        ["--only-binary=:all:", "--no-deps", "antalia-mini==1.0.1"]],
      agirlik: { modul: "tts_antalia_supertonic", anahtar: "antalia" },
      dogrulama: "import tts_antalia_supertonic as t; t.model_klasoru('antalia')",
      boyut: "~40 MB", motor: "antalia",
    },
    "tts-supertonic": {
      etiket: "Supertonic-3 (10 ses, kadın ve erkek)",
      moduller: ["supertonic", "soundfile", "onnxruntime"],
      adimlar: [["--only-binary=:all:", "numpy==2.5.4", "onnxruntime==1.31.1", "soundfile==0.14.0", "huggingface_hub==2.3.0"], ["--only-binary=:all:", "--no-deps", "supertonic==1.3.1"]],
      agirlik: { modul: "tts_antalia_supertonic", anahtar: "supertonic" },
      dogrulama: "import tts_antalia_supertonic as t; t.model_klasoru('supertonic')",
      boyut: "~400 MB", motor: "supertonic",
    },
    "tts-ahenk": {
      etiket: "Ahenk Cep (Türkçe kadın sesi, 7 ruh hali)",
      moduller: ["ema_lightning", "trnorm", "soundfile"],
      // trnorm PyPI'da yok: Ahenk deposunun belirli bir commit'inden kurulur (Apache-2.0)
      adimlar: [["--only-binary=:all:", "--index-url", "https://download.pytorch.org/whl/cpu", "torch==2.14.1"], ["--only-binary=:all:", "ema-lightning==1.1.2", "soundfile==0.14.0", "huggingface_hub==2.3.0"],
        ["--no-deps", "--no-build-isolation", "trnorm @ https://github.com/ozguradmin/ahenk-turkish-tts/archive/14ec3660fffb3086530dc6dc65d4cfbac901887f.zip"]],
      agirlik: { modul: "tts_ahenk_omnivoice", anahtar: "ahenk" },
      dogrulama: "import tts_ahenk_omnivoice as t; t._model_klasoru('ahenk', {})",
      boyut: "~40 MB", motor: "ahenk",
    },
    "tts-omnivoice": {
      etiket: "OmniVoice (ses klonlama; ekran kartı önerilir, ticari olmayan lisans)",
      moduller: ["omnivoice", "transformers", "torchaudio", "soundfile"],
      adimlar: [["--require-hashes", "--only-binary=:all:", "-r", "@gereksinimler/requirements-tts.txt"],
        ["--no-deps", "--require-hashes", "-r", "@gereksinimler/requirements-tts-nodeps.txt"]],
      agirlik: { modul: "tts_ahenk_omnivoice", anahtar: "omnivoice" },
      dogrulama: "import tts_ahenk_omnivoice as t; t._model_klasoru('omnivoice', {})",
      boyut: "~3,5 GB", motor: "omnivoice", gpuOnerilir: true,
    },
    "speech-duyu": {
      etiket: "Duyu Türkçe ses tanıma",
      moduller: ["onnxruntime", "sentencepiece", "numpy"],
      adimlar: [["--only-binary=:all:", "numpy==2.5.4", "onnxruntime==1.31.1", "sentencepiece==0.2.2"]],
      boyut: "~60 MB",
    },
  };

  function pipEnv() {
    return { ...process.env, PIP_CACHE_DIR: PIP_CACHE, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PIP_DISABLE_PIP_VERSION_CHECK: "1" };
  }

  function calistir(komut, argumanlar, secenekler = {}) {
    return new Promise((resolve) => {
      let cikti = "";
      let proc;
      try {
        proc = spawn(komut, argumanlar, { windowsHide: true, env: secenekler.env || process.env, cwd: secenekler.cwd || ROOT });
      } catch (err) { resolve({ kod: -1, cikti: String(err.message || err) }); return; }
      const ekle = (d) => {
        const metin = d.toString();
        cikti = (cikti + metin).slice(-20000);
        if (secenekler.satir) for (const s of metin.split(/\r?\n/)) if (s.trim()) secenekler.satir(s.trim());
      };
      proc.stdout.on("data", ekle);
      proc.stderr.on("data", ekle);
      const zaman = secenekler.zamanAsimiMs ? setTimeout(() => { try { proc.kill(); } catch (_) {} }, secenekler.zamanAsimiMs) : null;
      proc.on("error", (err) => { if (zaman) clearTimeout(zaman); resolve({ kod: -1, cikti: cikti + String(err.message || err) }); });
      proc.on("exit", (kod) => { if (zaman) clearTimeout(zaman); resolve({ kod, cikti }); });
    });
  }

  // --------------------------------------------------------------------------
  // Taşınabilir Python: yoksa python.org'un gömülü sürümü indirilir, pip kurulur
  // --------------------------------------------------------------------------
  async function pythonHazirla(satir = () => {}) {
    if (osPlatform !== "win32") {
      const r = await calistir(PYTHON, ["--version"]);
      if (r.kod !== 0) throw new Error("Python 3 bulunamadı. Sisteminize Python 3.11+ kurun.");
      return PYTHON;
    }
    if (!fs.existsSync(PYTHON)) {
      satir("Taşınabilir Python indiriliyor (~10 MB)...");
      fs.mkdirSync(PY_DIR, { recursive: true });
      // Yollar komut metnine gömülmez, ortam değişkeniyle verilir (klasör adında ' olsa da bozulmaz)
      const ps = [
        "$ProgressPreference='SilentlyContinue'",
        "$zip=Join-Path $env:YAS_PY_DIR 'python.zip'",
        "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile $zip",
        "if ((Get-FileHash $zip -Algorithm MD5).Hash -ne $env:YAS_PY_SHA) { Remove-Item $zip; throw 'Python arsivinin ozeti uyusmuyor' }",
        "Expand-Archive -Path $zip -DestinationPath $env:YAS_PY_DIR -Force",
        "Remove-Item $zip",
        "$pth=Join-Path $env:YAS_PY_DIR 'python312._pth'",
        "(Get-Content $pth) -replace '^#\\s*import site','import site' | Set-Content -Encoding ASCII $pth",
      ].join("; ");
      const r = await calistir("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        { satir, zamanAsimiMs: 10 * 60 * 1000, env: { ...process.env, YAS_PY_DIR: PY_DIR, YAS_PY_SHA: PYTHON_EMBED_MD5 } });
      if (!fs.existsSync(PYTHON)) throw new Error("Python indirilemedi: " + r.cikti.slice(-400));
    }
    const pipVar = await calistir(PYTHON, ["-m", "pip", "--version"], { env: pipEnv() });
    if (pipVar.kod !== 0) {
      satir("pip kuruluyor...");
      // Sabit sürümlü pip wheel'i (PyPI), SHA256 doğrulanarak; sabitlenmemiş get-pip.py betiği çalıştırılmaz
      const PIP_TEKER = { ad: "pip-26.2.1-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/f3/6e/1736e5b4ae2b778ef2f81c47d797de9f891d4d8acb047a24ca37a60294dd/pip-26.2.1-py3-none-any.whl", sha256: "71138adf1f4ca900cdb7d289c21b7494329f2332b6d85f0e1c42108c0384ed3e" };
      const teker = path.join(PY_DIR, PIP_TEKER.ad);
      const ps = "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri $env:YAS_PIP_URL -OutFile $env:YAS_PIP_WHL; if ((Get-FileHash $env:YAS_PIP_WHL -Algorithm SHA256).Hash -ne $env:YAS_PIP_SHA) { Remove-Item $env:YAS_PIP_WHL; throw 'pip paketinin ozeti uyusmuyor' }";
      await calistir("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        { satir, zamanAsimiMs: 5 * 60 * 1000, env: { ...process.env, YAS_PIP_URL: PIP_TEKER.url, YAS_PIP_WHL: teker, YAS_PIP_SHA: PIP_TEKER.sha256 } });
      if (!fs.existsSync(teker)) throw new Error("pip paketi indirilemedi ya da SHA256 özeti uyuşmadı.");
      const kurucu = "import sys; w=sys.argv[1]; sys.path.insert(0, w); from pip._internal.cli.main import main; sys.exit(main(['install', '--no-index', '--no-warn-script-location', w]))";
      const r = await calistir(PYTHON, ["-c", kurucu, teker], { env: pipEnv(), satir, zamanAsimiMs: 10 * 60 * 1000 });
      try { fs.unlinkSync(teker); } catch (_) {}
      if (r.kod !== 0) throw new Error("pip kurulamadı: " + r.cikti.slice(-400));
    }
    return PYTHON;
  }

  // --------------------------------------------------------------------------
  // Kurulu mu? (modüller gerçekten içe aktarılır; yarım kurulumlar yakalanır)
  // --------------------------------------------------------------------------
  const durumOnbellegi = new Map(); // id -> { kurulu, zaman }
  // Aynı özellik için aynı anda tek denetim; denetimler sırayla (torch/transformers içe aktarmak ağır:
  // eşzamanlı onlarca Python süreci işlemciyi ve belleği tüketip sohbet modelinin yüklenmesini kilitliyordu)
  const surenDenetimler = new Map(); // id -> Promise
  let denetimZinciri = Promise.resolve();
  function ozellikKuruluMu(id, yenile = false) {
    const oz = OZELLIKLER[id];
    if (!oz) return Promise.resolve(false);
    const onceki = durumOnbellegi.get(id);
    if (!yenile && onceki && Date.now() - onceki.zaman < 10 * 60 * 1000) return Promise.resolve(onceki.kurulu);
    if (surenDenetimler.has(id)) return surenDenetimler.get(id);
    const is = denetimZinciri.catch(() => {}).then(() => ozellikDenetle(id, oz));
    denetimZinciri = is.catch(() => {});
    surenDenetimler.set(id, is);
    is.finally(() => surenDenetimler.delete(id)).catch(() => {});
    return is;
  }
  async function ozellikDenetle(id, oz) {
    if (osPlatform === "win32" && !fs.existsSync(PYTHON)) { durumOnbellegi.set(id, { kurulu: false, zaman: Date.now() }); return false; }
    const ek = oz.dogrulama ? `\n    ${oz.dogrulama}` : "";
    // Gömülü Python (._pth dosyası) çalışma klasörünü sys.path'e eklemez; işçi klasörü elle eklenir
    const kod = `import importlib, sys\nsys.path.insert(0, ${JSON.stringify(CALISAN_KLASORU)})\ntry:\n    import importlib.util\n    eksik = [m for m in ${JSON.stringify(oz.moduller)} if importlib.util.find_spec(m) is None]\n    if eksik: sys.exit(3)${ek}\nexcept SystemExit:\n    raise\nexcept Exception:\n    sys.exit(3)`;
    // Not: modüller içe AKTARILMAZ (find_spec yalnızca varlığını denetler); torch/transformers yüklemek
    // bu işlemcide onlarca saniye sürüyordu. Bozuk kurulum, motor ilk kullanıldığında hata olarak görünür.
    const r = await calistir(PYTHON, ["-c", kod], { env: { ...pipEnv(), HF_HOME: HF_CACHE, HF_HUB_OFFLINE: "1" }, cwd: CALISAN_KLASORU, zamanAsimiMs: 120000 });
    const kurulu = r.kod === 0;
    durumOnbellegi.set(id, { kurulu, zaman: Date.now() });
    return kurulu;
  }

  // Eşzamanlı (sync) yerlerde kullanmak için: son bilinen durum; gerekirse arka planda tazelenir
  function kuruluBiliniyorMu(id) {
    const onceki = durumOnbellegi.get(id);
    if (!onceki || Date.now() - onceki.zaman > 10 * 60 * 1000) ozellikKuruluMu(id, true).catch(() => {});
    return Boolean(onceki && onceki.kurulu);
  }

  let kurulum = { aktif: false, id: "", asama: "", gunluk: [], hata: null, bitti: null };
  const kurulumSirasi = [];
  async function ozellikKur(id) {
    const oz = OZELLIKLER[id];
    if (!oz) throw new Error("Bilinmeyen özellik: " + id);
    if (kurulum.aktif) {
      if (kurulum.id !== id && !kurulumSirasi.includes(id)) kurulumSirasi.push(id);
      return { sirada: true };
    }
    kurulum = { aktif: true, id, asama: "Hazırlanıyor", gunluk: [], hata: null, bitti: null, baslangic: Date.now() };
    const satir = (s) => { kurulum.gunluk.push(s); if (kurulum.gunluk.length > 60) kurulum.gunluk.shift(); };
    (async () => {
      try {
        kurulum.asama = "Python hazırlanıyor";
        await pythonHazirla(satir);
        for (let i = 0; i < oz.adimlar.length; i += 1) {
          kurulum.asama = `${oz.etiket}: paketler kuruluyor (${i + 1}/${oz.adimlar.length})`;
          const argumanlar = oz.adimlar[i].map((a) => (a.startsWith("@gereksinimler/") ? path.join(CALISAN_KLASORU, "gereksinimler", a.slice(15)) : a));
          log(`  [ozellik] ${id}: pip install ${argumanlar.join(" ")}`);
          const r = await calistir(PYTHON, ["-m", "pip", "install", "--no-warn-script-location", ...argumanlar], { env: pipEnv(), satir, zamanAsimiMs: 60 * 60 * 1000 });
          if (r.kod !== 0) throw new Error("pip hatası: " + r.cikti.trim().split(/\r?\n/).slice(-4).join(" | ").slice(0, 600));
        }
        if (oz.agirlik) {
          // Model ağırlıkları: sabit commit'ten, huggingface_hub ile uygulamanın kendi önbelleğine
          kurulum.asama = `${oz.etiket}: model dosyaları indiriliyor (${oz.boyut})`;
          const py = [
            `import sys; sys.path.insert(0, ${JSON.stringify(CALISAN_KLASORU)})`,
            `import ${oz.agirlik.modul} as t`,
            "from huggingface_hub import snapshot_download",
            `b = t.AGIRLIKLAR[${JSON.stringify(oz.agirlik.anahtar)}]`,
            "print(snapshot_download(b['repo'], revision=b['revision'], allow_patterns=b['allow_patterns']))",
          ].join("; ");
          const r = await calistir(PYTHON, ["-c", py], { env: { ...pipEnv(), HF_HOME: HF_CACHE, HF_HUB_DISABLE_TELEMETRY: "1" }, cwd: CALISAN_KLASORU, satir, zamanAsimiMs: 3 * 60 * 60 * 1000 });
          if (r.kod !== 0) throw new Error("Model dosyaları indirilemedi: " + r.cikti.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 600));
        }
        kurulum.asama = "Doğrulanıyor";
        if (!(await ozellikKuruluMu(id, true))) throw new Error("Paketler kuruldu ama içe aktarılamadı (" + oz.moduller.join(", ") + ")");
        kurulum = { ...kurulum, aktif: false, asama: "Tamamlandı", bitti: Date.now() };
        log(`  [ozellik] ${id} kuruldu`);
      } catch (err) {
        kurulum = { ...kurulum, aktif: false, asama: "Hata", hata: err.message || String(err), bitti: Date.now() };
        log(`  [ozellik] ${id} kurulamadı: ${kurulum.hata}`);
      }
      const sonraki = kurulumSirasi.shift();
      if (sonraki) ozellikKur(sonraki).catch(() => {});
    })();
    return { basladi: true };
  }

  // --------------------------------------------------------------------------
  // Hugging Face'ten çok dosyalı model paketi
  // --------------------------------------------------------------------------
  const PAKETLER = {
    "seda-v0.2": {
      repo: "atasoglu/seda-v0.2", surum: "62e2cc1615a63c433b6956214a548267ada5a774", klasor: KLASORLER.konusma, ad: "seda-v0.2", ozellik: "speech-seda",
      dahil: [/^c32\//i, /^final\//i, /^lm\//i, /^formatter\//i, /^vad\//i, /^tokens\.txt$/i, /^README\.md$/i],
      etiket: "Seda-v0.2 (int8 ONNX)",
    },
    "duyu-small": {
      // Sürüm sabit: bu sürümdeki Python kodu (duyu_small/*.py) incelendi; ağ erişimi, eval/exec yok.
      // cli.py indirilmez. Lisans: Apache-2.0.
      repo: "KaanAydinli/Duyu-small", surum: "a9aa79751ea6e99c1e035fcb056318d5c1b67f13", klasor: KLASORLER.konusma, ad: "duyu-small", ozellik: "speech-duyu",
      dahil: [/^int8\//i, /^duyu_small\/(__init__|audio|decode|features|model)\.py$/i, /^(config|engine)\.json$/i, /\.npz$/i, /^spm\.model$/i, /^LICENSE$/i],
      etiket: "Duyu-small (int8 ONNX)",
    },
  };

  function hfAnahtari() {
    try {
      const t = fs.readFileSync(path.join(APP, "config", "hf-token.txt"), "utf8").trim();
      if (t) return t;
    } catch (_) {}
    return process.env.HF_TOKEN || "";
  }

  // Hugging Face ağacındaki özetle karşılaştır: LFS dosyalarında SHA256, diğerlerinde git blob SHA1
  function dosyaOzetiDogruMu(dosya, d) {
    try {
      if (d.sha256) {
        const h = crypto.createHash("sha256");
        const fd = fs.openSync(dosya, "r");
        const tampon = Buffer.allocUnsafe(4 * 1024 * 1024);
        let n;
        while ((n = fs.readSync(fd, tampon, 0, tampon.length, null)) > 0) h.update(tampon.subarray(0, n));
        fs.closeSync(fd);
        return h.digest("hex") === d.sha256.toLowerCase();
      }
      if (d.gitOid) {
        const icerik = fs.readFileSync(dosya);
        const h = crypto.createHash("sha1").update(`blob ${icerik.length}\0`).update(icerik).digest("hex");
        return h === d.gitOid.toLowerCase();
      }
      return true;
    } catch (_) { return false; }
  }

  function paketKuruluMu(id) {
    const p = PAKETLER[id];
    return Boolean(p && fs.existsSync(path.join(p.klasor, p.ad, ".download-complete")));
  }

  let paketDurumu = { aktif: false, id: "", ilerleme: 0, hiz: "", hata: null, bitti: null };
  async function paketIndir(id) {
    const p = PAKETLER[id];
    if (!p) throw new Error("Bilinmeyen model paketi: " + id);
    if (paketDurumu.aktif) throw new Error("Başka bir model paketi iniyor: " + paketDurumu.id);
    const hedef = path.join(p.klasor, p.ad);
    paketDurumu = { aktif: true, id, etiket: p.etiket, ilerleme: 0, hiz: "Dosya listesi alınıyor", hata: null, bitti: null, toplam: 0, inen: 0 };
    // Gerekli Python paketleri arka planda birlikte kurulsun
    if (p.ozellik) ozellikKuruluMu(p.ozellik).then((k) => { if (!k) ozellikKur(p.ozellik).catch(() => {}); });
    (async () => {
      const basliklar = { "User-Agent": "Yerel-AI-Studyosu/1.0" };
      const anahtar = hfAnahtari();
      if (anahtar) basliklar.Authorization = `Bearer ${anahtar}`;
      // Belirli bir sürüm (commit) indirilir; içerik sonradan değiştirilemez
      const surum = p.surum || "main";
      const liste = await fetch(`https://huggingface.co/api/models/${p.repo}/tree/${surum}?recursive=true`, { headers: basliklar });
      if (!liste.ok) throw new Error(`Hugging Face dosya listesi alınamadı (${p.repo}, HTTP ${liste.status})`);
      const dosyalar = (await liste.json())
        .filter((x) => x.type === "file" && p.dahil.some((k) => k.test(x.path)))
        .map((x) => ({ yol: x.path, boyut: Number(x.lfs?.size || x.size || 0), sha256: x.lfs?.oid || "", gitOid: x.lfs ? "" : (x.oid || "") }));
      if (!dosyalar.length) throw new Error(p.repo + " deposunda indirilecek dosya bulunamadı");
      const toplam = dosyalar.reduce((t, d) => t + d.boyut, 0);
      paketDurumu.toplam = toplam;
      let inen = 0, pencere = Date.now(), pencereBayt = 0;
      for (const d of dosyalar) {
        const hedefDosya = path.join(hedef, ...d.yol.split("/"));
        if (!pathInside(hedefDosya, hedef)) continue;
        if (fs.existsSync(hedefDosya) && d.boyut > 0 && fs.statSync(hedefDosya).size === d.boyut && dosyaOzetiDogruMu(hedefDosya, d)) { inen += d.boyut; continue; }
        fs.mkdirSync(path.dirname(hedefDosya), { recursive: true });
        const url = `https://huggingface.co/${p.repo}/resolve/${surum}/${d.yol.split("/").map(encodeURIComponent).join("/")}`;
        const yanit = await fetch(url, { headers: basliklar });
        if (!yanit.ok || !yanit.body) throw new Error(`${d.yol} indirilemedi (HTTP ${yanit.status})` + (yanit.status === 401 || yanit.status === 403 ? " — bu model lisans onayı ve Hugging Face anahtarı gerektiriyor olabilir" : ""));
        const gecici = hedefDosya + ".part";
        const yaz = fs.createWriteStream(gecici);
        try {
          for await (const parca of yanit.body) {
            if (!yaz.write(parca)) await new Promise((r) => yaz.once("drain", r));
            inen += parca.length; pencereBayt += parca.length;
            const simdi = Date.now();
            if (simdi - pencere >= 500) {
              paketDurumu.hiz = `${(pencereBayt / ((simdi - pencere) / 1000) / 1048576).toFixed(1)} MB/s`;
              pencere = simdi; pencereBayt = 0;
            }
            paketDurumu.inen = inen;
            paketDurumu.ilerleme = toplam > 0 ? Math.min(99, Math.round((inen / toplam) * 100)) : -1;
          }
          await new Promise((r, j) => yaz.end((e) => (e ? j(e) : r())));
        } catch (err) {
          yaz.destroy();
          try { fs.unlinkSync(gecici); } catch (_) {}
          throw err;
        }
        if (!dosyaOzetiDogruMu(gecici, d)) {
          try { fs.unlinkSync(gecici); } catch (_) {}
          throw new Error(`${d.yol}: dosya özeti (hash) uyuşmuyor, indirme reddedildi`);
        }
        try { fs.unlinkSync(hedefDosya); } catch (_) {}
        fs.renameSync(gecici, hedefDosya);
      }
      fs.writeFileSync(path.join(hedef, ".download-complete"), new Date().toISOString(), "utf8");
    })().then(() => {
      paketDurumu = { ...paketDurumu, aktif: false, ilerleme: 100, hiz: "Tamamlandı", bitti: Date.now() };
      log(`  [paket] ${id} indirildi`);
    }).catch((err) => {
      paketDurumu = { ...paketDurumu, aktif: false, hata: err.message || String(err), bitti: Date.now() };
      log(`  [paket] ${id} indirilemedi: ${paketDurumu.hata}`);
    });
    return { basladi: true };
  }

  // --------------------------------------------------------------------------
  // Kalıcı Python çalışanları
  // --------------------------------------------------------------------------
  const calisanlar = new Map(); // anahtar -> çalışan durumu

  function calisanAl(anahtar, tur, ayar, bostaDakika = 10, baslatmaMs = 5 * 60000) {
    let c = calisanlar.get(anahtar);
    if (c && c.proc) { c.baslatmaMs = Math.max(c.baslatmaMs || 0, baslatmaMs); return c; }
    c = { anahtar, tur, ayar, proc: null, hazir: false, baslatma: null, bekleyen: new Map(), sayac: 0, zamanlayici: null, bostaMs: bostaDakika * 60000, baslatmaMs, baslatmaZamani: 0 };
    calisanlar.set(anahtar, c);
    return c;
  }

  function calisanKapat(c) {
    clearTimeout(c.zamanlayici);
    if (c.proc) { try { c.proc.kill(); } catch (_) {} }
    c.proc = null; c.hazir = false; c.baslatma = null;
  }

  function calisanBaslat(c) {
    if (c.hazir && c.proc) return Promise.resolve();
    if (c.baslatma) return c.baslatma;
    const p = new Promise((resolve, reject) => {
      const env = { ...process.env, HF_HOME: HF_CACHE, HF_HUB_DISABLE_TELEMETRY: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
      // Hugging Face anahtarı çalışanlara verilmez; çalışanlar ağdan bir şey indirmez
      env.HF_HUB_OFFLINE = "1";
      delete env.HF_TOKEN; delete env.HUGGING_FACE_HUB_TOKEN; // yorumdaki kural ortam değişkeni için de geçerli olsun
      const proc = spawn(PYTHON, ["-u", KALICI_CALISAN, c.tur, JSON.stringify(c.ayar || {})], { cwd: path.dirname(KALICI_CALISAN), env, stdio: "pipe", windowsHide: true });
      c.proc = proc;
      let tampon = "", stderr = "";
      c.baslatmaZamani = Date.now();
      const baslatmaMs = c.baslatmaMs || 5 * 60000;
      const zaman = setTimeout(() => { reject(new Error(`${c.tur} çalışanı ${Math.round(baslatmaMs / 60000)} dakikada açılamadı`)); try { proc.kill(); } catch (_) {} }, baslatmaMs);
      proc.stdout.on("data", (veri) => {
        tampon += veri.toString("utf8");
        let i;
        while ((i = tampon.indexOf("\n")) >= 0) {
          const s = tampon.slice(0, i).trim();
          tampon = tampon.slice(i + 1);
          if (!s.startsWith("{")) continue;
          let m;
          try { m = JSON.parse(s); } catch (_) { continue; }
          if (Object.prototype.hasOwnProperty.call(m, "hazir")) {
            clearTimeout(zaman);
            if (m.hazir) { c.hazir = true; log(`  [calisan] ${c.anahtar} hazır (${m.yuklemeSn} sn)`); resolve(); }
            else reject(new Error(`${c.tur} açılamadı: ${m.hata || "bilinmeyen hata"}`));
            continue;
          }
          const b = c.bekleyen.get(m.id);
          if (b) { c.bekleyen.delete(m.id); if (m.ok) b.resolve(m); else b.reject(new Error(m.hata || "işlem başarısız")); }
        }
      });
      proc.stderr.on("data", (veri) => { stderr = (stderr + veri.toString()).slice(-4000); });
      proc.on("error", (err) => { clearTimeout(zaman); reject(err); });
      proc.on("exit", (kod) => {
        clearTimeout(zaman);
        if (c.proc === proc) { c.proc = null; c.hazir = false; c.baslatma = null; }
        const hata = new Error(`${c.tur} çalışanı kapandı (kod ${kod})` + (stderr.trim() ? ": " + stderr.trim().slice(-500) : ""));
        for (const b of c.bekleyen.values()) b.reject(hata);
        c.bekleyen.clear();
        reject(hata);
      });
    });
    c.baslatma = p;
    p.catch(() => { if (c.baslatma === p) c.baslatma = null; });
    return p;
  }

  async function calisanIstek(anahtar, tur, ayar, istek, secenekler = {}) {
    if (osPlatform === "win32" && !fs.existsSync(PYTHON)) throw new Error("Taşınabilir Python kurulu değil; özelliği önce kurun.");
    const c = calisanAl(anahtar, tur, ayar, secenekler.bostaDakika || 10, secenekler.baslatmaZamanAsimiMs || 5 * 60000);
    await calisanBaslat(c);
    clearTimeout(c.zamanlayici);
    const id = ++c.sayac;
    try {
      return await new Promise((resolve, reject) => {
        c.bekleyen.set(id, { resolve, reject });
        c.proc.stdin.write(JSON.stringify({ ...istek, id }) + "\n", "utf8");
        if (secenekler.zamanAsimiMs) setTimeout(() => { if (c.bekleyen.has(id)) { c.bekleyen.delete(id); reject(new Error("İşlem zaman aşımına uğradı")); } }, secenekler.zamanAsimiMs);
      });
    } finally {
      c.zamanlayici = setTimeout(() => { if (c.bekleyen.size === 0) calisanKapat(c); }, c.bostaMs);
    }
  }

  // Tek bir kalıcı çalışanı durdurur (ör. sesli sohbette süresi aşan OmniVoice klon seslendirmesi)
  function calisanDurdur(anahtar) {
    const c = calisanlar.get(anahtar);
    if (c) calisanKapat(c);
    return !!c;
  }

  // Çalışanın durumu (ör. klon ses modeli yükleniyor mu, hazır mı)
  function calisanDurumu(anahtar) {
    const c = calisanlar.get(anahtar);
    if (!c || !c.proc) return { calisiyor: false, hazir: false, yukleniyor: false, bekleyen: 0 };
    return { calisiyor: true, hazir: !!c.hazir, yukleniyor: !c.hazir, bekleyen: c.bekleyen.size, acilisSn: c.baslatmaZamani ? Math.round((Date.now() - c.baslatmaZamani) / 1000) : null };
  }

  // Boşta kapanma süresini şimdiden itibaren ms'ye ayarlar (sesli sohbet açıkken model bellekte kalsın)
  function calisanCanliTut(anahtar, ms) {
    const c = calisanlar.get(anahtar);
    if (!c || !c.proc) return false;
    clearTimeout(c.zamanlayici);
    c.zamanlayici = setTimeout(() => { if (c.bekleyen.size === 0) calisanKapat(c); }, Math.max(30000, Number(ms) || c.bostaMs));
    return true;
  }

  function hepsiniKapat() {
    for (const c of calisanlar.values()) calisanKapat(c);
  }

  return {
    OZELLIKLER, PAKETLER, KLASORLER, PYTHON,
    ozellikKuruluMu, kuruluBiliniyorMu, ozellikKur, kurulumDurumu: () => ({ ...kurulum, sira: [...kurulumSirasi] }),
    paketKuruluMu, paketIndir, paketDurumu: () => ({ ...paketDurumu }),
    calisanIstek, calisanDurdur, calisanDurumu, calisanCanliTut, hepsiniKapat, hfAnahtari,
  };
};

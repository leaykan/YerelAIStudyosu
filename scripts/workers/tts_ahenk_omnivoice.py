# -*- coding: utf-8 -*-
"""Yerel AI Stüdyosu - Türkçe TTS işleyicileri: Ahenk Cep ve OmniVoice (ses klonlama).

kalici_calisan.py içine kayıt:
    from tts_ahenk_omnivoice import AhenkCep, OmniVoice
    TURLER.update({"ahenk": AhenkCep, "omnivoice": OmniVoice})

Arayüz (her iki sınıf):
    __init__(ayar)  -> modeli BİR KEZ yükler. ayar: {"threads": 4, "modelDir": isteğe bağlı yerel klasör,
                       "cihaz": "cpu" | "cuda" | "auto"}
    isle(istek)     -> istek: {"metin", "yol", "hiz", "ses", "uslup", "referans"}; WAV'ı istek["yol"]a yazar,
                       {"sure": sn, "ornekleme": Hz, "ses": kimlik} döner.
    OmniVoice ayrıca {"islem": "isit", "referans": yol} kabul eder: dosya yazmadan klon istemini önbelleğe
    alır ve kısa bir deneme üretimiyle ilk çağrı maliyetini öder (sesli sohbette klon ses ısıtması).

Çalışma anında ağ YOK (HF_HUB_OFFLINE=1, HF_HOME=<app>/cache/hf). Ağırlıklar kurulumda, sabit (pinned)
commit ile indirilir:   python tts_ahenk_omnivoice.py indir [ahenk|omnivoice]
                        python tts_ahenk_omnivoice.py dogrula [ahenk|omnivoice]

Lisans ve atıflar:
  * Ahenk Cep ağırlıkları: CC BY 4.0 — "Ahenk Cep, Ahenk (https://github.com/ozguradmin/ahenk-turkish-tts),
    CC BY 4.0". Çıkarım kodu vendor/ahenk_cep.py (Apache-2.0, değişiklikler o dosyada belirtildi).
    EMA Lightning motoru (canberkkkkkk, Apache-2.0), trnorm (ahenk-turkish-tts, Apache-2.0),
    Alania Turkish Synthetic Speech / Domain Text (PatientDesk AI, CC BY 4.0).
  * OmniVoice: kod Apache-2.0 (k2-fsa / Xiaomi Corp.). Model ağırlıkları CC BY-NC 4.0 — TİCARİ KULLANIM YOK.
    Ses belirteçleyici (audio_tokenizer, Higgs Audio v2): "Boson Higgs Audio 2 Community License"
    (lisans metni dağıtılmalı, "Built with Higgs Materials" ibaresi, 100.000 aylık kullanıcı sınırı).
    Makale: Zhu ve ark., "OmniVoice: Towards Omnilingual Zero-Shot TTS with Diffusion Language Models", 2026.
  * Metin temizleme ve üslup takma adları DD:YZ "Sansürsüz Lokal AI Stüdyosu V2" (MIT)
    tts-ahenk-worker.py'den uyarlanmıştır.
"""
import hashlib
import importlib.util
import os
import re
import sys
import unicodedata
import wave

# ---------------------------------------------------------------------------
# Sabitlenmiş ağırlıklar (kurulumda snapshot_download ile, çalışmada local_files_only ile)
# boyut ve sha256 değerleri HF API'den (LFS oid) alınmıştır.
# ---------------------------------------------------------------------------
AGIRLIKLAR = {
    "ahenk": {
        "repo": "ozgurguler/ahenk-cep-tr",
        "revision": "345c4cbb934815fa96ffd0d5061fd913237544bc",
        "allow_patterns": ["student.pt", "decoder.pt", "README.md"],
        # Dikkat: ahenk_cep.py BİLEREK indirilmez (vendor/ahenk_cep.py kullanılır).
        "dosyalar": {
            "student.pt": (22271307, "020e2d31cb51847a9f06376febbb6ba9329ded7c3084a7fdd4f45adada3f23d3"),
            "decoder.pt": (12044823, "5caeede49ce987a94e31fc8a58bed569e993c820fe6f1c9b301d6c489d3cbbd1"),
        },
    },
    "omnivoice": {
        "repo": "k2-fsa/OmniVoice",
        "revision": "c5fdb5ccb189668d56333f77ba2629f4cd7535f4",
        "allow_patterns": [
            "config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json", "chat_template.jinja",
            "README.md", "audio_tokenizer/config.json", "audio_tokenizer/model.safetensors",
            "audio_tokenizer/preprocessor_config.json", "audio_tokenizer/LICENSE",
        ],
        "dosyalar": {
            "model.safetensors": (2450344112, "730839316de585f4c8298ec0e1712efc10fb19c6fa4e36eb741cb8d51ebcf6aa"),
            "audio_tokenizer/model.safetensors": (805665628, "fe7c5e8785e0a05833e1bfc3e002ec7f55af21e306b2e7154a448c1f54ccfb0d"),
            "tokenizer.json": (11423986, "408f669b7e2b045fdf54201d815bd364e6667dbd845115da81239c40bc6dcfd1"),
            "config.json": (None, None),
            "tokenizer_config.json": (None, None),
            "audio_tokenizer/config.json": (None, None),
            "audio_tokenizer/preprocessor_config.json": (None, None),
        },
    },
}

_BURASI = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
# Ortak yardımcılar
# ---------------------------------------------------------------------------
def _sha256(yol, blok=1 << 20):
    h = hashlib.sha256()
    with open(yol, "rb") as f:
        for parca in iter(lambda: f.read(blok), b""):
            h.update(parca)
    return h.hexdigest()


def _dosyalari_dogrula(klasor, motor, tam_sha=True):
    """Gerekli dosyalar var mı, boyut (ve istenirse sha256) doğru mu? Sorun varsa açıklayıcı hata."""
    for ad, (boyut, sha) in AGIRLIKLAR[motor]["dosyalar"].items():
        yol = os.path.join(klasor, *ad.split("/"))
        if not os.path.isfile(yol):
            raise FileNotFoundError(f"{motor}: model dosyası eksik: {yol}")
        if boyut is not None and os.path.getsize(yol) != boyut:
            raise ValueError(f"{motor}: {ad} boyutu beklenenden farklı ({os.path.getsize(yol)} != {boyut}); "
                             "dosya yarım ya da değiştirilmiş.")
        if tam_sha and sha is not None and _sha256(yol) != sha:
            raise ValueError(f"{motor}: {ad} sha256 doğrulaması başarısız; dosya değiştirilmiş olabilir.")


def _model_klasoru(motor, ayar):
    """ayar["modelDir"] verilmişse onu, yoksa HF önbelleğindeki SABİT commit anlık görüntüsünü döndürür.

    revision tam commit sha olarak verildiği için refs/main'e bakılmaz; ağ erişimi yapılmaz.
    """
    yerel = ayar.get("modelDir")
    if yerel:
        yerel = os.path.abspath(str(yerel))
        if not os.path.isdir(yerel):
            raise FileNotFoundError(f"{motor}: model klasörü bulunamadı: {yerel}")
        return yerel
    bilgi = AGIRLIKLAR[motor]
    from huggingface_hub import snapshot_download
    try:
        return snapshot_download(bilgi["repo"], revision=bilgi["revision"],
                                 allow_patterns=bilgi["allow_patterns"], local_files_only=True)
    except Exception as hata:
        raise FileNotFoundError(
            f"{motor}: ağırlıklar HF önbelleğinde yok ({bilgi['repo']}@{bilgi['revision'][:12]}). "
            f"Kurulumda 'python tts_ahenk_omnivoice.py indir {motor}' çalıştırın. ({type(hata).__name__})") from hata


def _is_parcacigi(ayar):
    try:
        import torch
        n = int(ayar.get("threads", 0) or 0)
        if n > 0:
            torch.set_num_threads(max(1, n))
    except Exception:
        pass


def _cihaz_sec(ayar):
    import torch
    istenen = str(ayar.get("cihaz", "cpu")).lower()
    if istenen in ("cuda", "auto", "gpu") and torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _hiz(istek):
    try:
        h = float(istek.get("hiz", 1.0) or 1.0)
    except (TypeError, ValueError):
        h = 1.0
    return max(0.5, min(2.0, h))


def _tamsayi(istek, anahtar, varsayilan, alt, ust):
    try:
        return max(alt, min(ust, int(istek.get(anahtar, varsayilan))))
    except (TypeError, ValueError):
        return varsayilan


def _wav_yaz(yol, ses, ornekleme):
    """float32 [-1,1] mono sesi 16-bit PCM WAV olarak (önce geçici dosyaya, sonra atomik) yazar."""
    import numpy as np
    x = np.asarray(ses, dtype=np.float32).reshape(-1)
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    pcm = (np.clip(x, -1.0, 1.0) * 32767.0).astype("<i2")
    yol = os.path.abspath(str(yol))
    os.makedirs(os.path.dirname(yol), exist_ok=True)
    gecici = yol + ".yaziliyor"
    with wave.open(gecici, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(int(ornekleme))
        f.writeframes(pcm.tobytes())
    os.replace(gecici, yol)
    return round(len(x) / float(ornekleme), 3)


def _metni_temizle(metin):
    """Emoji, HTML etiketi ve tipografi temizliği (V2 clean_text_for_ahenk'ten uyarlandı, MIT)."""
    metin = re.sub(r"<[^>]+>", " ", str(metin))
    metin = metin.replace("℃", " derece ").replace("°", " derece ").replace("%", " yüzde ")
    metin = metin.replace("•", " ").replace("–", "-").replace("—", "-")
    metin = metin.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    metin = re.sub(r"[​-‏︀-️‍ ]", " ", metin)
    metin = "".join(" " if unicodedata.category(c) in ("So", "Sk", "Cs", "Cn", "Co") else c for c in metin)
    return re.sub(r"\s+", " ", metin).strip()


def _katla(s):
    """Türkçe karakterleri ASCII'ye katlar (takma ad eşleştirmesi için)."""
    s = str(s or "").strip().replace("İ", "i").replace("I", "ı").lower()
    return s.translate(str.maketrans("çğıöşü", "cgiosu"))


# ---------------------------------------------------------------------------
# Ahenk Cep (8.6M, 48 kHz, tek kadın sesi f022, 7 üslup) — CPU'da hızlı
# ---------------------------------------------------------------------------
SESLER_AHENK = [
    {"id": "f022", "ad": "Ahenk (kadın sesi)", "cinsiyet": "kadın"},
]

USLUPLAR = [
    {"id": "neutral", "ad": "Doğal / Nötr Ton"},
    {"id": "cheerful", "ad": "Neşeli ve Canlı Ton"},
    {"id": "calm", "ad": "Sakin ve Dingin Ton"},
    {"id": "empathetic", "ad": "Empatik ve Şefkatli Ton"},
    {"id": "sad", "ad": "Hüzünlü ve Duygusal Ton"},
    {"id": "surprised", "ad": "Şaşkın ve Heyecanlı Ton"},
    {"id": "angry", "ad": "Öfkeli ve Sert Ton"},
]

# V2 ile aynı takma adlar (Türkçe karakterli yazımlar _katla ile aynı anahtara iner)
USLUP_TAKMA_ADLARI = {
    "neutral": "neutral", "dogal": "neutral", "notr": "neutral", "standart": "neutral",
    "cheerful": "cheerful", "neseli": "cheerful", "canli": "cheerful",
    "calm": "calm", "sakin": "calm", "dingin": "calm",
    "empathetic": "empathetic", "empatik": "empathetic", "sefkatli": "empathetic",
    "sad": "sad", "huzunlu": "sad", "duygusal": "sad",
    "surprised": "surprised", "saskin": "surprised", "heyecanli": "surprised",
    "angry": "angry", "ofkeli": "angry", "sert": "angry",
}


def uslup_coz(deger):
    anahtar = _katla(deger)
    if anahtar.startswith("ahenk_"):
        anahtar = anahtar[6:]
    return USLUP_TAKMA_ADLARI.get(anahtar, "neutral")


def _vendor_ahenk_yukle():
    """vendor/ahenk_cep.py'yi DOSYA YOLUNDAN yükler (sys.path'e bağlı değil, HF'den .py çalıştırılmaz)."""
    yol = os.path.join(_BURASI, "vendor", "ahenk_cep.py")
    spec = importlib.util.spec_from_file_location("yerel_vendor_ahenk_cep", yol)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


class AhenkCep:
    ORNEKLEME = 48000

    def __init__(self, ayar):
        _is_parcacigi(ayar)
        klasor = _model_klasoru("ahenk", ayar)
        # 34 MB: her yüklemede sha256 doğrulaması ucuz (~0,1 sn); .pt dosyaları pickle kapsayıcıdır,
        # weights_only=True yüklemeye ek olarak içerik de sabitlenir.
        _dosyalari_dogrula(klasor, "ahenk", tam_sha=bool(ayar.get("dogrula", True)))
        vendor = _vendor_ahenk_yukle()
        self.cihaz = _cihaz_sec(ayar)
        self.m = vendor.AhenkCep(os.path.join(klasor, "student.pt"), os.path.join(klasor, "decoder.pt"),
                                 device=self.cihaz)
        # EMA ilk say() çağrısında CPU'da toplu-boyut ölçümü yapıp ~/.cache/ema_lightning'e yazar
        # (onlarca saniye). Tek istekli çalışan için gereksiz: boyutu 1'e sabitle.
        self.m.engine._batch_size = 1

    def isle(self, istek):
        metin = _metni_temizle(istek.get("metin", ""))
        if not metin:
            raise ValueError("Metin boş.")
        uslup = uslup_coz(istek.get("uslup") or istek.get("ses") or "neutral")
        ses, sr = self.m.say(
            metin, style=uslup,
            steps=_tamsayi(istek, "adim", 16, 4, 32),
            cfg=max(1.0, min(5.0, float(istek.get("cfg", 2.0) or 2.0))),
            speed=_hiz(istek),
            seed=_tamsayi(istek, "tohum", 0, 0, 2**31 - 1),
        )
        sure = _wav_yaz(istek["yol"], ses, sr)
        return {"sure": sure, "ornekleme": int(sr), "ses": "f022", "uslup": uslup}


# ---------------------------------------------------------------------------
# OmniVoice (Qwen3-0.6B tabanlı, 24 kHz, sıfır-örnek ses klonlama) — GPU önerilir
# ---------------------------------------------------------------------------
SESLER_OMNIVOICE = [
    {"id": "otomatik", "ad": "Otomatik ses", "cinsiyet": ""},
    {"id": "kadin_genc", "ad": "Genç kadın", "cinsiyet": "kadın"},
    {"id": "kadin_orta", "ad": "Orta yaşlı kadın", "cinsiyet": "kadın"},
    {"id": "kadin_yasli", "ad": "Yaşlı kadın", "cinsiyet": "kadın"},
    {"id": "erkek_genc", "ad": "Genç erkek", "cinsiyet": "erkek"},
    {"id": "erkek_orta", "ad": "Orta yaşlı erkek (kalın)", "cinsiyet": "erkek"},
    {"id": "erkek_yasli", "ad": "Yaşlı erkek", "cinsiyet": "erkek"},
    {"id": "kadin_fisilti", "ad": "Fısıldayan kadın", "cinsiyet": "kadın"},
    {"id": "cocuk", "ad": "Çocuk", "cinsiyet": ""},
]

# Ses tasarımı (instruct) — yalnızca omnivoice/utils/voice_design.py'deki geçerli etiketler
_OMNI_TASARIM = {
    "otomatik": None,
    "kadin_genc": "female, young adult",
    "kadin_orta": "female, middle-aged",
    "kadin_yasli": "female, elderly",
    "erkek_genc": "male, young adult",
    "erkek_orta": "male, middle-aged, low pitch",
    "erkek_yasli": "male, elderly",
    "kadin_fisilti": "female, whisper",
    "cocuk": "child",
}

_REF_UZANTILAR = (".wav", ".flac", ".ogg")  # soundfile ile okunur; mp3/m4a (ffmpeg) bilerek dışarıda
_REF_AZAMI_SN = 30.0


class OmniVoice:
    def __init__(self, ayar):
        import torch
        from omnivoice import OmniVoice as _OmniVoiceModel

        _is_parcacigi(ayar)
        klasor = _model_klasoru("omnivoice", ayar)
        # 3,2 GB'ı her açılışta hash'lemek pahalı: çalışmada boyut, kurulumda (dogrula) tam sha256.
        _dosyalari_dogrula(klasor, "omnivoice", tam_sha=bool(ayar.get("tamDogrulama", False)))
        self.torch = torch
        self.cihaz = _cihaz_sec(ayar)
        self.gpu = self.cihaz == "cuda"
        # Yerel klasör verildiği için omnivoice snapshot_download çağırmaz; audio_tokenizer/ alt klasörü
        # mevcut olduğundan "eustlb/higgs-audio-v2-tokenizer" indirmesine de düşmez. trust_remote_code yok.
        self.m = _OmniVoiceModel.from_pretrained(
            klasor, device_map=self.cihaz, dtype=torch.float16 if self.gpu else torch.float32)
        self.ornekleme = int(getattr(self.m, "sampling_rate", None) or 24000)
        self.referans_klasoru = ayar.get("referansKlasoru")  # isteğe bağlı ikinci savunma hattı
        self.asr_klasoru = ayar.get("asrModelDir")  # isteğe bağlı YEREL whisper klasörü
        self.trnorm = bool(ayar.get("trnorm", True))
        self._istem_onbellek = {}

    # -- referans ses ---------------------------------------------------------
    def _referans_dogrula(self, yol):
        yol = os.path.realpath(str(yol))
        if not os.path.isabs(yol) or not os.path.isfile(yol):
            raise FileNotFoundError("Referans ses bulunamadı: " + os.path.basename(yol))
        if not yol.lower().endswith(_REF_UZANTILAR):
            raise ValueError("Referans ses WAV/FLAC/OGG olmalı.")
        if self.referans_klasoru:
            kok = os.path.realpath(str(self.referans_klasoru))
            if os.path.commonpath([kok, yol]) != kok:
                raise PermissionError("Referans ses reference-voices klasörünün dışında.")
        import soundfile as sf
        sure = float(sf.info(yol).duration)
        if sure > _REF_AZAMI_SN:
            raise ValueError(f"Referans ses çok uzun ({sure:.0f} sn). 3-15 sn'lik bir kesit kullanın.")
        return yol

    def _referans_metni(self, yol, istek):
        metin = str(istek.get("referansMetin") or "").strip()
        if metin:
            return metin
        for aday in (yol + ".txt", os.path.splitext(yol)[0] + ".txt"):
            if os.path.isfile(aday):
                with open(aday, "r", encoding="utf-8") as f:
                    metin = f.read().strip()
                if metin:
                    return metin
        if self.asr_klasoru and os.path.isdir(str(self.asr_klasoru)):
            return None  # create_voice_clone_prompt yerel whisper ile yazıya döker
        raise ValueError("Referans sesin yazılı metni yok. 'referansMetin' gönderin ya da yanına "
                         "<dosya>.txt koyun (sunucu Seda/Duyu ile yazıya dökebilir). Uydurma metin klonu bozar.")

    def _klon_istemi(self, yol, istek):
        ref_metin = self._referans_metni(yol, istek)
        st = os.stat(yol)
        anahtar = (yol, st.st_mtime_ns, st.st_size, ref_metin)
        if anahtar not in self._istem_onbellek:
            if ref_metin is None and self.m._asr_pipe is None:
                self.m.load_asr_model(model_name=os.path.abspath(str(self.asr_klasoru)), device="cpu")
            if len(self._istem_onbellek) >= 16:
                self._istem_onbellek.clear()
            self._istem_onbellek[anahtar] = self.m.create_voice_clone_prompt(ref_audio=yol, ref_text=ref_metin)
        return self._istem_onbellek[anahtar]

    def _metin_hazirla(self, metin, dil):
        metin = _metni_temizle(metin)
        # Sayı/simge varsa Türkçe okunuşa çevir (trnorm Ahenk ile birlikte kurulu; yoksa olduğu gibi kalır)
        if self.trnorm and dil == "tr" and re.search(r"[0-9₺$€£/]", metin):
            try:
                from trnorm import normalize
                metin = normalize(metin)
            except Exception:
                pass
        return metin

    def _isit(self, istek):
        """Sesli sohbet ısıtması: model zaten yüklü (__init__); klon istemini (referansın ses belirteçleri)
        önbelleğe alır ve 2 adımlık kısa bir deneme üretimiyle ilk çağrı maliyetini (bellek ayırma, çekirdek
        seçimi) şimdi öder. Böylece ilk gerçek cümle yalnızca kendi süresini bekler. Dosya yazmaz."""
        import time
        torch = self.torch
        basla = time.time()
        istem = None
        referans = istek.get("referans")
        if referans:
            yol = self._referans_dogrula(referans)
            istem = self._klon_istemi(yol, istek)
        istem_sn = round(time.time() - basla, 2)
        deneme_sn = None
        try:
            kw = {"text": "Merhaba.", "language": "tr", "num_step": 2, "guidance_scale": 2.0,
                  "denoise": True, "postprocess_output": False}
            if istem is not None:
                kw["voice_clone_prompt"] = istem
            t = time.time()
            torch.manual_seed(0)
            with torch.inference_mode():
                self.m.generate(**kw)
            deneme_sn = round(time.time() - t, 2)
        except Exception as hata:  # ısınma üretimi isteğe bağlı; başarısızlığı klonu engellemez
            print(f"OmniVoice ısınma üretimi atlandı: {type(hata).__name__}: {hata}", file=sys.stderr)
        return {"isindi": True, "cihaz": self.cihaz, "istemSn": istem_sn, "denemeSn": deneme_sn,
                "sure": 0, "ornekleme": self.ornekleme}

    def isle(self, istek):
        if istek.get("islem") == "isit":
            return self._isit(istek)
        torch = self.torch
        dil = str(istek.get("dil") or "tr").lower()
        metin = self._metin_hazirla(istek.get("metin", ""), dil)
        if not metin:
            raise ValueError("Metin boş.")
        # num_step: yinelemeli kod çözme adımı; her adım modelin (koşullu + koşulsuz, toplu 2) tam bir ileri
        # geçişidir, süre adım sayısıyla doğru orantılıdır. Varsayılan: GPU 32 (OmniVoice varsayılanı), CPU 16.
        # Sesli sohbet işlemcide 8 gönderir (yaklaşık iki kat hızlı; kalite biraz düşer).
        kw = {
            "text": metin,
            "language": dil,
            "speed": _hiz(istek),
            "num_step": _tamsayi(istek, "adim", 32 if self.gpu else 16, 8, 64),
            "guidance_scale": max(1.0, min(5.0, float(istek.get("cfg", 2.0) or 2.0))),
            "denoise": True,
            "postprocess_output": True,
        }
        referans = istek.get("referans")
        if referans:
            yol = self._referans_dogrula(referans)
            kw["voice_clone_prompt"] = self._klon_istemi(yol, istek)
            ses_kimligi = "klon:" + os.path.basename(yol)
        else:
            ses_kimligi = str(istek.get("ses") or "otomatik")
            if ses_kimligi not in _OMNI_TASARIM:
                ses_kimligi = "otomatik"
            if _OMNI_TASARIM[ses_kimligi]:
                kw["instruct"] = _OMNI_TASARIM[ses_kimligi]
        # Örnekleme rastgele: aynı tohum = aynı tasarım sesi (uzun metinlerde tutarlılık)
        torch.manual_seed(_tamsayi(istek, "tohum", 0, 0, 2**31 - 1))
        with torch.inference_mode():
            sesler = self.m.generate(**kw)
        if not sesler or len(sesler[0]) == 0:
            raise RuntimeError("OmniVoice boş ses üretti.")
        sure = _wav_yaz(istek["yol"], sesler[0], self.ornekleme)
        return {"sure": sure, "ornekleme": self.ornekleme, "ses": ses_kimligi}


# ---------------------------------------------------------------------------
# Kurulum yardımcıları (AĞ GEREKİR — yalnızca kurulumda, HF_HOME ayarlıyken çalıştırın)
# ---------------------------------------------------------------------------
def indir(motor):
    from huggingface_hub import snapshot_download
    b = AGIRLIKLAR[motor]
    klasor = snapshot_download(b["repo"], revision=b["revision"], allow_patterns=b["allow_patterns"])
    _dosyalari_dogrula(klasor, motor, tam_sha=True)
    return klasor


def dogrula(motor):
    klasor = _model_klasoru(motor, {})
    _dosyalari_dogrula(klasor, motor, tam_sha=True)
    return klasor


if __name__ == "__main__":
    komut = sys.argv[1] if len(sys.argv) > 1 else ""
    motorlar = sys.argv[2:] or list(AGIRLIKLAR)
    if komut not in ("indir", "dogrula") or any(m not in AGIRLIKLAR for m in motorlar):
        print("Kullanım: python tts_ahenk_omnivoice.py indir|dogrula [ahenk] [omnivoice]", file=sys.stderr)
        sys.exit(2)
    for m in motorlar:
        print(m, "->", (indir if komut == "indir" else dogrula)(m))

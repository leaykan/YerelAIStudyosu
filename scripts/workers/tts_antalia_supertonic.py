# -*- coding: utf-8 -*-
"""Yerel AI Stüdyosu - Türkçe seslendirme işleyicileri: Antalia-2 Mini ve Supertonic-3.

kalici_calisan.py içindeki TURLER sözlüğüne eklenmek üzere yazıldı:
    from tts_antalia_supertonic import Antalia, Supertonic
    TURLER.update({"antalia": Antalia, "supertonic": Supertonic})

Arayüz (Seda/Duyu ile aynı):
    motor = Antalia(ayar)            # model bir kez yüklenir; ayar örn. {"threads": 4}
    motor.isle({"metin": "...", "yol": "cikti.wav", "hiz": 1.0, "ses": "", "uslup": None})
        -> {"sure": saniye, "ornekleme": örnekleme_hızı, "ses": kullanılan_ses_kimliği}

ÇEVRİMDIŞI ÇALIŞMA: Çalışan HF_HUB_OFFLINE=1 ve HF_HOME=<uygulama>/cache/hf ile başlar. Bu işleyiciler
Hugging Face'e HİÇ bağlanmaz: ağırlıkların önbellekteki sabit commit klasörünü
(<HF_HOME>/hub/models--<kurum>--<ad>/snapshots/<sha>/) kendileri bulur ve kütüphanelere yerel klasör
olarak verir. Böylece "refs/main" kaydına ya da kütüphanenin kendi indirme koduna ihtiyaç kalmaz.
Kurulum programı, çalışan başlamadan önce AGIRLIKLAR listesindeki her girdiyi
huggingface_hub.snapshot_download(repo, revision=sha, allow_patterns=...) ile indirmelidir.

Atıflar ve lisanslar:
  - Antalia-2 Mini (cloud0day3/antalia-mini): kod, metin normalleştirici ve ağırlıklar Apache-2.0
    (depodaki LICENSE ve NOTICE dosyaları korunmalı). Bağımlılık cmudict: BSD. Eğitim sesi VoxCPM2
    (Apache-2.0) ile üretilmiş, gerçek konuşmacı kaydı yok; tek sentetik erkek sesi.
  - Supertonic-3 (Supertone/supertonic-3, Copyright (c) 2026 Supertone Inc.): Python paketi
    "supertonic" MIT; model ağırlıkları OpenRAIL-M (kullanım kısıtlamaları LICENSE dosyasındadır ve
    yeniden dağıtımda aynen aktarılmalıdır).
  - Ses profili adları ve hız çarpanları DD:YZ "Sansürsüz Lokal AI Stüdyosu V2" (MIT) işçilerinden
    (tts-antalia-worker.py, tts-supertonic-worker.py, serve.cjs) uyarlanmıştır. Supertonic M1-F5 için
    verilen Türkçe adlar V2'nin etiketleridir; Supertone bu sesleri resmî olarak adlandırmaz.
"""
import os
import re

# ---------------------------------------------------------------------------
# Sabitlenmiş kurulum bilgisi (kurulum programı da bu sözlükleri içe aktarıp kullanabilir)
# ---------------------------------------------------------------------------
PIP_PAKETLERI = {
    "antalia": ["antalia-mini==1.0.1", "torch==2.15.0", "numpy==2.5.4", "safetensors==0.8.0",
                "soundfile==0.14.0", "cmudict==1.1.3"],
    "supertonic": ["supertonic==1.3.1", "onnxruntime==1.31.1", "numpy==2.5.4", "soundfile==0.14.0"],
}

AGIRLIKLAR = {
    "antalia": {
        "repo": "cloud0day3/antalia-mini",
        "revision": "8a79528770af2ed5cb6d3b9ac1248d370429f272",  # 2026-10-10, paket 1.0.1 ile aynı sürüm
        "allow_patterns": ["config.json", "acoustic.safetensors", "vocoder.safetensors", "LICENSE", "NOTICE"],
        # Önbellekte bulunması zorunlu dosyalar ve bayt boyutları (HF ağaç API'sinden)
        "gerekli": {"config.json": 2338, "acoustic.safetensors": 14757148, "vocoder.safetensors": 15742616},
        "sha256": {
            "acoustic.safetensors": "72c36a6855ce95dc1d35960a7b61515136813313406e5b9ae1c2ebe6cd2ad428",
            "vocoder.safetensors": "89ca374cc55864b38a36f9ea87c41e1b17376e5d6d68e3a0458332861509bbf6",
        },
    },
    "supertonic": {
        "repo": "Supertone/supertonic-3",
        # supertonic 1.3.1 paketinin kendi config.py'sinde sabitlediği commit (2026-05-06). Güncel "main"
        # (3cadd1ee...) yalnızca örnek ses dosyaları ekliyor; onnx/ ve voice_styles/ dosyaları birebir aynı.
        "revision": "724fb5abbf5502583fb520898d45929e62f02c0b",
        "allow_patterns": ["onnx/*", "voice_styles/*.json", "LICENSE"],
        "gerekli": {
            "onnx/tts.json": 8253, "onnx/unicode_indexer.json": 277676,
            "onnx/duration_predictor.onnx": 3700147, "onnx/text_encoder.onnx": 36416150,
            "onnx/vector_estimator.onnx": 256534781, "onnx/vocoder.onnx": 101424195,
            **{f"voice_styles/{s}.json": None for s in ("M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5")},
        },
        "sha256": {
            "onnx/duration_predictor.onnx": "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
            "onnx/text_encoder.onnx": "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
            "onnx/vector_estimator.onnx": "883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c",
            "onnx/vocoder.onnx": "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba",
        },
    },
}

# ---------------------------------------------------------------------------
# Ses listeleri (arayüzde gösterilir)
# ---------------------------------------------------------------------------
# Antalia-2 Mini'nin TEK bir sesi vardır; profiller yalnızca konuşma hızını değiştirir (V2'deki gibi).
_ANTALIA_PROFILLER = {
    "antalia_dogal": (1.00, "Antalia - Doğal erkek sesi (standart hız)"),
    "antalia_tok": (0.94, "Antalia - Sakin, tok anlatıcı (yavaş)"),
    "antalia_sicak": (0.96, "Antalia - Samimi anlatıcı (biraz yavaş)"),
    "antalia_genc": (1.05, "Antalia - Genç karakter (biraz hızlı)"),
    "antalia_akici": (1.08, "Antalia - Akıcı haber spikeri (hızlı)"),
}
_ANTALIA_TAKMA = {"antalia_erkek": "antalia_dogal", "erkek": "antalia_dogal", "dogal": "antalia_dogal"}
SESLER_ANTALIA = [{"id": k, "ad": ad, "cinsiyet": "erkek"} for k, (_, ad) in _ANTALIA_PROFILLER.items()]

_SUPERTONIC_ADLAR = {
    "M1": "M1 - Tok erkek", "M2": "M2 - Doğal erkek", "M3": "M3 - Akıcı erkek", "M4": "M4 - Genç erkek",
    "M5": "M5 - Anlatıcı erkek", "F1": "F1 - Doğal kadın", "F2": "F2 - Berrak kadın", "F3": "F3 - Canlı kadın",
    "F4": "F4 - Akıcı kadın", "F5": "F5 - Sıcak kadın",
}
SESLER_SUPERTONIC = [{"id": k, "ad": ad, "cinsiyet": "erkek" if k.startswith("M") else "kadın"}
                     for k, ad in _SUPERTONIC_ADLAR.items()]


# ---------------------------------------------------------------------------
# Ortak yardımcılar
# ---------------------------------------------------------------------------
def _hf_hub_onbellegi():
    """huggingface_hub'ın kullandığı önbellek kökü (HF_HUB_CACHE > HF_HOME/hub > ~/.cache/huggingface/hub)."""
    try:
        from huggingface_hub import constants  # ağ bağlantısı kurmaz, yalnızca ortam değişkenlerini okur
        return constants.HF_HUB_CACHE
    except Exception:
        if os.environ.get("HF_HUB_CACHE"):
            return os.environ["HF_HUB_CACHE"]
        hf_home = os.environ.get("HF_HOME") or os.path.join(
            os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache"), "huggingface")
        return os.path.join(hf_home, "hub")


def model_klasoru(motor, ayar=None):
    """Sabit commit'in önbellekteki klasörünü bulur ve gerekli dosyaları denetler (ağ kullanmaz).

    ayar["modelDir"] verilirse önbellek yerine o klasör kullanılır (elle kopyalanmış kurulumlar için)."""
    bilgi = AGIRLIKLAR[motor]
    ayar = ayar or {}
    if ayar.get("modelDir"):
        klasor = os.path.abspath(ayar["modelDir"])
    else:
        klasor = os.path.join(_hf_hub_onbellegi(), "models--" + bilgi["repo"].replace("/", "--"),
                              "snapshots", bilgi["revision"])
    eksik, bozuk = [], []
    for ad, boyut in bilgi["gerekli"].items():
        yol = os.path.join(klasor, *ad.split("/"))
        if not os.path.isfile(yol):  # isfile sembolik bağı izler: bozuk bağ da "eksik" sayılır
            eksik.append(ad)
        elif boyut is not None and os.path.getsize(yol) != boyut and not ayar.get("modelDir"):
            bozuk.append(ad)
    if eksik or bozuk:
        raise FileNotFoundError(
            f"{bilgi['repo']}@{bilgi['revision'][:12]} ağırlıkları önbellekte eksik/bozuk ({klasor}). "
            f"Eksik: {eksik[:4]} Boyutu uyuşmayan: {bozuk[:4]}. Kurulumu ağ açıkken yeniden çalıştırın.")
    return klasor


def _hiz(deger, alt=0.5, ust=2.0):
    try:
        h = float(deger)
    except (TypeError, ValueError):
        h = 1.0
    if h != h or h <= 0:  # NaN / sıfır / negatif
        h = 1.0
    return max(alt, min(ust, h))


def _wav_yaz(yol, ses, ornekleme):
    import numpy as np
    import soundfile as sf
    ses = np.asarray(ses, dtype=np.float32).reshape(-1)
    if ses.size == 0:
        raise ValueError("Ses üretilemedi (metin okunabilir harf içermiyor olabilir).")
    ses = np.clip(np.nan_to_num(ses), -1.0, 1.0)
    yol = os.path.abspath(yol)
    os.makedirs(os.path.dirname(yol), exist_ok=True)
    sf.write(yol, ses, int(ornekleme), subtype="PCM_16", format="WAV")
    return round(ses.size / float(ornekleme), 3)


def _metin(istek):
    metin = str(istek.get("metin", "") or "").strip()
    if not metin:
        raise ValueError("Metin boş.")
    if not istek.get("yol"):
        raise ValueError("Çıktı yolu (yol) gerekli.")
    return metin


# ---------------------------------------------------------------------------
# Antalia-2 Mini (PyTorch, 7.62M parametre, 48 kHz, tek erkek sesi)
# ---------------------------------------------------------------------------
class Antalia:
    def __init__(self, ayar):
        ayar = ayar or {}
        self.klasor = model_klasoru("antalia", ayar)
        from antalia_mini import Antalia as _Antalia
        threads = max(1, int(ayar.get("threads", 4)))
        # Yerel klasör verildiği için antalia_mini indirme koduna (hf_hub_download / urllib) hiç girmez.
        # Ağırlıklar safetensors'tan okunur; yüklemede config.json'daki sha256 değerleri de denetlenir.
        self.tts = _Antalia(self.klasor, device="cpu", threads=threads, variant="fp32", warmup=True)
        self.ornekleme = int(self.tts.sample_rate)
        self.varsayilan_hiz = float(self.tts.defaults.get("speed", 0.95))  # sürümün kendi varsayılanı

    def isle(self, istek):
        metin = _metin(istek)
        ses_id = str(istek.get("ses") or "").strip().lower()
        ses_id = _ANTALIA_TAKMA.get(ses_id, ses_id)
        if ses_id not in _ANTALIA_PROFILLER:
            ses_id = "antalia_dogal"
        carpan = _ANTALIA_PROFILLER[ses_id][0]
        # "uslup" bu modelde yok (tek ses, duygu denetimi yok); yok sayılır.
        hiz = _hiz(self.varsayilan_hiz * _hiz(istek.get("hiz", 1.0)) * carpan)
        tohum = istek.get("tohum")
        konusma = self.tts.say(metin, speed=hiz, seed=int(tohum) if tohum is not None else None)
        sure = _wav_yaz(istek["yol"], konusma.audio, konusma.sample_rate)
        return {"sure": sure, "ornekleme": int(konusma.sample_rate), "ses": ses_id}


# ---------------------------------------------------------------------------
# Supertonic-3 (ONNX Runtime, ~99M parametre, 31 dil, 44.1 kHz, 10 hazır ses)
# ---------------------------------------------------------------------------
_ETIKET = re.compile(r"(<\s*(?:laugh|breath|sigh)\s*>)", re.IGNORECASE)
_SUPERTONIC_TAKMA = {"erkek": "M1", "kadin": "F1", "kadın": "F1", "supertonic_natural": "M1",
                     "supertonic_erkek": "M1", "supertonic_kadin": "F1"}


class Supertonic:
    MIN_HIZ, MAX_HIZ = 0.7, 2.0     # supertonic çekirdeği bu aralık dışında hata verir
    VARSAYILAN_HIZ = 1.05           # paketin önerdiği doğal hız; istek hiz=1.0 bunu verir

    def __init__(self, ayar):
        ayar = ayar or {}
        self.klasor = model_klasoru("supertonic", ayar)
        from supertonic import TTS
        threads = max(1, int(ayar.get("threads", 4)))
        # auto_download=False + yerel klasör: huggingface_hub hiç çağrılmaz.
        self.tts = TTS(model="supertonic-3", model_dir=self.klasor, auto_download=False,
                       intra_op_num_threads=threads, inter_op_num_threads=1)
        self.ornekleme = int(self.tts.sample_rate)
        self.adim = max(1, min(100, int(ayar.get("adim", 8))))
        self.stiller = {}
        for ad in self.tts.voice_style_names:  # 10 ses stilini bir kez yükle (her biri ~290 KB JSON)
            self.stiller[ad.upper()] = self.tts.get_voice_style(ad)
        # Supertonic sayı/tarih/kısaltma okumaz. Aynı ortamda antalia_mini varsa onun Türkçe
        # normalleştiricisi (torch gerektirmez) kullanılır: "14:30" -> "on dört otuz". Kapatmak için
        # ayar {"normallestir": false}. Not: çıktı küçük harfe çevrilir.
        self._normallestir = None
        if ayar.get("normallestir", True):
            try:
                from antalia_mini.text import to_model_text
                self._normallestir = to_model_text
            except Exception:
                self._normallestir = None

    def _hazirla(self, metin):
        if self._normallestir is not None:
            parcalar = _ETIKET.split(metin)  # <laugh>/<breath>/<sigh> etiketleri korunur
            cikti = []
            for p in parcalar:
                if _ETIKET.fullmatch(p) or not p.strip():
                    cikti.append(p.strip().lower() if _ETIKET.fullmatch(p) else p)
                    continue
                try:
                    cikti.append(self._normallestir(p))
                except Exception:
                    cikti.append(p)
            metin = " ".join(x for x in cikti if x).strip()
        # Modelin desteklemediği karakterler synthesize() içinde hata verir; önceden ayıklanır.
        try:
            gecerli, desteksiz = self.tts.model.text_processor.validate_text(metin)
            if not gecerli:
                metin = "".join(ch for ch in metin if ch not in set(desteksiz))
        except Exception:
            pass
        metin = re.sub(r"\s+", " ", metin).strip()
        if not re.search(r"[^\W\d_]", metin):
            raise ValueError("Metin okunabilir harf içermiyor.")
        return metin

    def isle(self, istek):
        metin = self._hazirla(_metin(istek))
        ses_id = str(istek.get("ses") or "").strip()
        ses_id = _SUPERTONIC_TAKMA.get(ses_id.lower(), ses_id.upper().replace("SUPERTONIC_", ""))
        if ses_id not in self.stiller:
            ses_id = "M1" if "M1" in self.stiller else sorted(self.stiller)[0]
        # "uslup" ayrı bir parametre değildir; Supertonic'te ifade metin içine <laugh>, <breath>, <sigh>
        # etiketleriyle yazılır. Bu yüzden uslup yok sayılır.
        hiz = _hiz(self.VARSAYILAN_HIZ * _hiz(istek.get("hiz", 1.0)), self.MIN_HIZ, self.MAX_HIZ)
        wav, _sure = self.tts.synthesize(text=metin, voice_style=self.stiller[ses_id], total_steps=self.adim,
                                         speed=hiz, lang="tr")
        sure = _wav_yaz(istek["yol"], wav, self.ornekleme)
        return {"sure": sure, "ornekleme": self.ornekleme, "ses": ses_id}

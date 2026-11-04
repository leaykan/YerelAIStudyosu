# -*- coding: utf-8 -*-
"""Yerel AI Stüdyosu - kalıcı Python çalışanı.

Kullanım:  python -u kalici_calisan.py <tur> '<json ayar>'
İlk satır: {"hazir": true, "yuklemeSn": ...}  ya da  {"hazir": false, "hata": "..."}
Sonra her istek stdin'den tek satır JSON gelir ({"id": .., ...}), yanıt tek satır JSON döner.
Model bir kez yüklenir; sunucu boşta kalan çalışanı kapatır.

Seda ve Duyu bölümleri DD:YZ "Sansürsüz Lokal AI Stüdyosu V2" (MIT) işçilerinden uyarlanmıştır.
Seda-v0.2: Ahmet Atasoğlu (CC BY-SA 4.0). Duyu-small: Kaan Aydınlı.
"""
import json
import os
import sys
import time

try:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Kütüphanelerin stdout'a yazdığı satırlar protokolü bozmasın: gerçek stdout saklanır, print'ler stderr'e gider
_GERCEK_STDOUT = sys.stdout
sys.stdout = sys.stderr


def yaz(nesne):
    _GERCEK_STDOUT.write(json.dumps(nesne, ensure_ascii=False) + "\n")
    _GERCEK_STDOUT.flush()


# ---------------------------------------------------------------------------
# Seda-v0.2 (sherpa-onnx Zipformer, noktalama + büyük harf + rakam)
# ---------------------------------------------------------------------------
class Seda:
    VAD_RATE = 16000
    MIN_SILENCE = 0.35
    MIN_SPEECH = 0.2
    PAD_BEFORE = 0.6
    PAD_AFTER = 0.25
    MAX_REGION = 20.0

    def __init__(self, ayar):
        import numpy as np
        from sedalib import Recognizer
        self.np = np
        self.model_dir = ayar["modelDir"]
        if not os.path.exists(os.path.join(self.model_dir, "tokens.txt")):
            raise FileNotFoundError("Seda model klasörü bulunamadı: " + self.model_dir)
        self.threads = max(1, int(ayar.get("threads", 4)))
        mode = str(ayar.get("mode", "accurate")).lower()
        punctuate = bool(ayar.get("punctuate", True)) and os.path.exists(os.path.join(self.model_dir, "formatter", "formatter.int8.onnx"))
        self.recognizer = Recognizer(self.model_dir, mode=mode if mode in ("fast", "balanced", "accurate") else "accurate",
                                     punctuate=punctuate, num_threads=self.threads, vad=False)
        self.vad_path = os.path.join(self.model_dir, "vad", "silero_vad.onnx")

    def _bolgeler(self, x):
        np = self.np
        if not os.path.exists(self.vad_path):
            step = int(self.MAX_REGION * self.VAD_RATE)
            return [(a, min(len(x), a + step)) for a in range(0, len(x), step)]
        import sherpa_onnx
        vad = sherpa_onnx.VadModel.create(sherpa_onnx.VadModelConfig(
            silero_vad=sherpa_onnx.SileroVadModelConfig(model=self.vad_path, threshold=0.5),
            sample_rate=self.VAD_RATE, num_threads=min(2, self.threads)))
        w = vad.window_size()
        flags = [vad.is_speech(x[i:i + w].tolist()) for i in range(0, len(x) - w + 1, w)]
        min_sil = max(1, round(self.MIN_SILENCE * self.VAD_RATE / w))
        min_sp = max(1, round(self.MIN_SPEECH * self.VAD_RATE / w))
        runs, start, quiet = [], None, 0
        for i, sp in enumerate(flags):
            if sp:
                if start is None:
                    start = i
                quiet = 0
            elif start is not None:
                quiet += 1
                if quiet >= min_sil:
                    runs.append((start, i - quiet + 1))
                    start, quiet = None, 0
        if start is not None:
            runs.append((start, len(flags) - quiet))
        runs = [(a * w, b * w) for a, b in runs if b - a >= min_sp]
        limit = int(self.MAX_REGION * self.VAD_RATE)
        frame = self.VAD_RATE // 10
        out = []
        for a, b in runs:
            while b - a > limit:
                lo, hi = a + limit // 2, a + limit
                en = [float(np.mean(x[i:i + frame] ** 2)) for i in range(lo, hi - frame, frame)]
                cut = lo + int(np.argmin(en)) * frame + frame // 2 if en else hi
                out.append((a, cut))
                a = cut
            out.append((a, b))
        before, after = int(self.PAD_BEFORE * self.VAD_RATE), int(self.PAD_AFTER * self.VAD_RATE)
        padded, prev_end = [], 0
        for i, (a, b) in enumerate(out):
            next_start = out[i + 1][0] if i + 1 < len(out) else len(x)
            s = max(prev_end, a - before)
            e = min(len(x), b + min(after, (next_start - b) // 3))
            padded.append((s, e))
            prev_end = e
        return padded

    def isle(self, istek):
        np = self.np
        from sedalib import read_wav
        samples, sr = read_wav(istek["wavPath"])
        x = np.asarray(samples, dtype=np.float32)
        if sr != self.VAD_RATE and len(x):
            n = int(round(len(x) * self.VAD_RATE / sr))
            x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
        parcalar = []
        for a, b in self._bolgeler(x):
            metin = self.recognizer.transcribe(x[a:b], self.VAD_RATE).strip()
            if metin:
                parcalar.append({"metin": metin, "bas": round(a / self.VAD_RATE, 2), "son": round(b / self.VAD_RATE, 2)})
        return {"metin": " ".join(p["metin"] for p in parcalar), "parcalar": parcalar,
                "sesSuresi": round(len(x) / float(self.VAD_RATE), 2)}


# ---------------------------------------------------------------------------
# Duyu-small (ONNX)
# ---------------------------------------------------------------------------
class Duyu:
    def __init__(self, ayar):
        self.model_dir = ayar["modelDir"]
        if not os.path.exists(self.model_dir):
            raise FileNotFoundError("Duyu model klasörü bulunamadı: " + self.model_dir)
        sys.path.insert(0, self.model_dir)
        from duyu_small import DuyuSmall
        from duyu_small.audio import load_audio
        self.load_audio = load_audio
        self.m = DuyuSmall(self.model_dir, quant=str(ayar.get("quant", "int8")),
                           threads=int(ayar.get("threads", 4)), beam=int(ayar.get("beam", 5)))

    def isle(self, istek):
        dil = str(istek.get("dil", "tr")).lower()
        dil = "tr" if dil in ("auto", "tr", "turkish") else ("en" if dil in ("en", "english") else "mix")
        ses = self.load_audio(istek["wavPath"])
        metin = str(self.m.transcribe(ses, lang=dil) or "").strip()
        return {"metin": metin, "parcalar": [], "sesSuresi": round(len(ses) / 16000.0, 2)}


class Yanki:
    """Tanı amaçlı: çalışan altyapısının sağlam olduğunu doğrular."""
    def __init__(self, ayar):
        self.ayar = ayar

    def isle(self, istek):
        return {"yanki": istek.get("metin", ""), "python": sys.version.split()[0]}


# Seslendirme motorları ayrı dosyalarda; yalnızca istenen motor içe aktarılır (ağır kütüphaneler boşuna yüklenmesin)
_DIS_TURLER = {
    "antalia": ("tts_antalia_supertonic", "Antalia"),
    "supertonic": ("tts_antalia_supertonic", "Supertonic"),
    "ahenk": ("tts_ahenk_omnivoice", "AhenkCep"),
    "omnivoice": ("tts_ahenk_omnivoice", "OmniVoice"),
}


class _TurSozlugu(dict):
    def __contains__(self, anahtar):
        return dict.__contains__(self, anahtar) or anahtar in _DIS_TURLER

    def __getitem__(self, anahtar):
        if dict.__contains__(self, anahtar):
            return dict.__getitem__(self, anahtar)
        import importlib
        modul, sinif = _DIS_TURLER[anahtar]
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        return getattr(importlib.import_module(modul), sinif)


TURLER = _TurSozlugu({"seda": Seda, "duyu": Duyu, "yanki": Yanki})


def main():
    tur = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        ayar = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    except Exception:
        ayar = {}
    try:
        try:
            import torch  # varsa iş parçacığı sınırla (onnx modellerinde gerekmez)
            torch.set_num_threads(max(1, min(4, os.cpu_count() or 4)))
        except Exception:
            pass
        if tur not in TURLER:
            raise ValueError("Bilinmeyen çalışan türü: " + tur)
        basla = time.time()
        motor = TURLER[tur](ayar)
        yaz({"hazir": True, "yuklemeSn": round(time.time() - basla, 1)})
    except Exception as hata:
        yaz({"hazir": False, "hata": f"{type(hata).__name__}: {hata}"})
        sys.exit(1)

    for satir in sys.stdin:
        satir = satir.strip()
        if not satir:
            continue
        istek = {}
        try:
            istek = json.loads(satir)
            basla = time.time()
            sonuc = motor.isle(istek)
            sonuc.update({"id": istek.get("id"), "ok": True, "islemSn": round(time.time() - basla, 2)})
            yaz(sonuc)
        except Exception as hata:
            yaz({"id": istek.get("id") if isinstance(istek, dict) else None, "ok": False, "hata": f"{type(hata).__name__}: {hata}"})


if __name__ == "__main__":
    main()

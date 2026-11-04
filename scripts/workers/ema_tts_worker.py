# -*- coding: utf-8 -*-
"""EMA Lightning (Türkçe TTS) için kalıcı çalışan.

Sunucu (serve.cjs) bu betiği bir kez başlatır; model belleğe bir kez yüklenir.
Her istek stdin'den tek satır JSON olarak gelir:
  {"id": 1, "metin": "...", "yol": "C:/.../cikti.wav", "hiz": 1.0, "ornekleme": 24000}
Yanıt stdout'a tek satır JSON olarak yazılır:
  {"id": 1, "ok": true, "sure": 2.4, "uretimSn": 0.8}
İlk satır her zaman {"hazir": true|false, ...} olur.
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


def yaz(nesne):
    sys.stdout.write(json.dumps(nesne, ensure_ascii=False) + "\n")
    sys.stdout.flush()


try:
    import torch

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 4)))
    from ema_lightning import EMA

    basla = time.time()
    tts = EMA()
    yaz({"hazir": True, "yuklemeSn": round(time.time() - basla, 1)})
except Exception as hata:  # kurulum eksikse sunucu bunu kullanıcıya gösterir
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
        konusma = tts.say(
            istek["metin"],
            path=istek["yol"],
            speed=max(0.25, min(4.0, float(istek.get("hiz", 1.0)))),
            sample_rate=int(istek.get("ornekleme", 24000)),
        )
        yaz({"id": istek.get("id"), "ok": True, "sure": round(float(konusma.duration), 2),
             "uretimSn": round(time.time() - basla, 2)})
    except Exception as hata:
        yaz({"id": istek.get("id") if isinstance(istek, dict) else None, "ok": False,
             "hata": f"{type(hata).__name__}: {hata}"})

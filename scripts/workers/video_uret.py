# -*- coding: utf-8 -*-
"""Yerel AI Stüdyosu - metinden video üretimi (AnimateDiff, Wan 2.1 T2V 1.3B; elle kurulursa SVD-XT ve Wan 14B).

DD:YZ Sansürsüz Lokal AI Stüdyosu V2 (MIT, Tech Jarves / DD:YZ) kaynağından uyarlanmıştır
(scripts/workers/video-generator-worker.py: donanım seviyeleri, Wan boyut kovaları ve negatif istemi,
ffmpeg ile H.264 kodlama, SVD akışı).

İKİ ŞEKİLDE ÇALIŞIR
  1) Tek seferlik süreç (studyo.cjs'in kullandığı yol; video belleği çok büyük, iş bitince süreç kapanır):
       python -u video_uret.py  < stdin: tek JSON istek
     stderr: "@@PROGRESS {json}" satırları; stdout: tek satır JSON {"ok": true, ...} | {"ok": false, "hata": ...}
  2) Kalıcı çalışan: kalici_calisan.py _DIS_TURLER içinde "video": ("video_uret", "VideoUret")
     (önerilmez: video boru hatları 6-20 GB bellek tutar).

İSTEK
  {"islem": "uret" | "donanim", "motor": "animatediff" | "wan21-1.3b" | "wan21-14b" | "svd-xt",
   "istem": "...", "negatif": "...", "genislik": 512, "yukseklik": 512, "kare": 16, "adim": 20,
   "cfg": 7.5, "fps": 8, "tohum": int, "cikti": "<.mp4 yolu>",
   "taban": "<app/models içindeki SD 1.5 .safetensors>"   (AnimateDiff için),
   "gorsel": "<data:image/...;base64,...>"               (SVD için)}

GÜVENLİK
  - Ağ yok: HF_HUB_OFFLINE=1, tüm from_pretrained/from_single_file çağrıları local_files_only=True ve yerel
    klasörle. SD 1.5 tek dosyası "config=" ile indirilmiş yapılandırma klasörüne bağlanır (diffusers'ın
    yapılandırmayı Hub'dan çekme yolu hiç çalışmaz).
  - Yalnızca .safetensors. V2'deki AnimateDiff "mm_sd_v15_v2.ckpt" (pickle) yerine diffusers biçimli
    guoyww/animatediff-motion-adapter-v1-5-2 safetensors kullanılır. trust_remote_code yok.

MODELLER VE LİSANSLAR
  - guoyww/animatediff-motion-adapter-v1-5-2 @6167b88ffe39b4441fdf2113e77b99a6f56b7906 — HF deposunda lisans
    alanı yok; özgün AnimateDiff projesi (github.com/guoyww/AnimateDiff) Apache-2.0.
  - stable-diffusion-v1-5/stable-diffusion-v1-5 @451f4fe16113bff5a5d2269ed5ad43b0592e9a14 — yalnızca
    yapılandırma ve tokenizer (json/txt) indirilir; CreativeML OpenRAIL-M. Taban model kullanıcının kendi
    SD 1.5 dosyasıdır (kendi lisansı geçerli).
  - Wan-AI/Wan2.1-T2V-1.3B-Diffusers @0fad780a534b6463e45facd96134c9f345acfa5b — Apache-2.0.
  - SVD-XT 1.1 (Stability AI Community License, lisans onaylı/gated) ve Wan 2.1 14B: indirme bu sürümde
    kapalı; klasör elle konursa çalışır.
"""
import base64
import gc
import io
import json
import os
import subprocess
import sys
import time
import traceback

KOK = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
VIDEO_MODELLERI = os.path.join(KOK, "app", "video-models")
KLASORLER = {
    "animatediff": os.path.join(VIDEO_MODELLERI, "animatediff-motion-adapter-v1-5-2"),
    "sd15": os.path.join(VIDEO_MODELLERI, "sd15-yapilandirma"),
    "wan21-1.3b": os.path.join(VIDEO_MODELLERI, "wan21-t2v-1.3b"),
    "wan21-14b": os.path.join(VIDEO_MODELLERI, "wan21-t2v-14b"),
    "svd-xt": os.path.join(VIDEO_MODELLERI, "svd-xt-1.1"),
}

WAN_NEGATIF = (
    "Bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, "
    "overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, "
    "poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, "
    "messy background, three legs, many people in the background, walking backwards"
)
AD_NEGATIF = "bad quality, blurry, distorted, deformed, static, stripes, duplicate, disfigured, text, watermark"


def ilerleme(asama, yuzde, adim=0, toplam=0):
    try:
        sys.stderr.write("@@PROGRESS " + json.dumps({"phase": asama, "progress": max(0, min(100, int(yuzde))),
                                                     "step": int(adim), "total": int(toplam)}, ensure_ascii=False) + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def gunluk(mesaj):
    sys.stderr.write(f"[video] {mesaj}\n")
    sys.stderr.flush()


def donanim():
    bilgi = {"cpuSayisi": os.cpu_count() or 0, "cuda": False, "vramGb": 0, "gpuAdi": "", "torch": ""}
    try:
        import torch
        bilgi["torch"] = torch.__version__
        if torch.cuda.is_available():
            o = torch.cuda.get_device_properties(0)
            bilgi.update({"cuda": True, "gpuAdi": o.name, "vramGb": round(o.total_memory / 1073741824, 1)})
    except Exception as hata:
        bilgi["hata"] = f"{type(hata).__name__}: {hata}"
    try:
        import imageio_ffmpeg  # noqa: F401
        bilgi["ffmpeg"] = True
    except Exception:
        bilgi["ffmpeg"] = False
    return bilgi


def ffmpeg_yolu():
    # Önce pip paketi imageio-ffmpeg'in getirdiği sabit ikili; yoksa PATH'teki ffmpeg
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        import shutil
        yol = shutil.which("ffmpeg")
        if yol:
            return yol
    raise RuntimeError("ffmpeg bulunamadı (imageio-ffmpeg paketi kurulu değil). Video özelliğini yeniden kurun.")


def kareleri_kodla(kareler, yol, fps):
    """PIL kare listesini tarayıcıda oynayan H.264 MP4'e çevirir (ffmpeg rawvideo borusu, V2 yöntemi)."""
    import numpy as np
    w, h = kareler[0].size
    w2, h2 = w - (w % 2), h - (h % 2)  # yuv420p çift boyut ister
    gecici = yol + ".part.mp4"
    komut = [ffmpeg_yolu(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
             "-r", str(fps), "-i", "-", "-vf", f"crop={w2}:{h2}:0:0", "-c:v", "libx264", "-preset", "medium",
             "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", gecici]
    bayrak = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
    p = subprocess.Popen(komut, stdin=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=bayrak)
    try:
        for k in kareler:
            p.stdin.write(np.asarray(k.convert("RGB"), dtype=np.uint8).tobytes())
        p.stdin.close()
    except BrokenPipeError:
        pass
    hata = p.stderr.read().decode("utf-8", errors="replace")
    p.wait()
    if p.returncode != 0 or not os.path.exists(gecici):
        raise RuntimeError(f"ffmpeg kodlama hatası: {hata[-400:]}")
    os.replace(gecici, yol)


def _cihaz():
    import torch
    if torch.cuda.is_available():
        return "cuda", torch.float16
    return "cpu", torch.float32


def _geri_cagri(adim):
    def cb(boru, i, t, kw):
        ilerleme(f"Kareler işleniyor (adım {i + 1}/{adim})...", 15 + int((i + 1) / adim * 78), i + 1, adim)
        return kw
    return cb


def _kat(x, k, enaz):
    return max(enaz, int(x) // k * k)


# ---------------------------------------------------------------------------
# Düşük seviye: AnimateDiff (SD 1.5 + hareket adaptörü)
# ---------------------------------------------------------------------------
def animatediff(istek):
    import torch
    from diffusers import AnimateDiffPipeline, MotionAdapter, DPMSolverMultistepScheduler

    taban = istek.get("taban") or ""
    if not (taban.lower().endswith(".safetensors") and os.path.isfile(taban)):
        raise RuntimeError("AnimateDiff için app/models içinde bir SD 1.5 .safetensors model seçilmeli.")
    for ad in ("animatediff", "sd15"):
        if not os.path.isfile(os.path.join(KLASORLER[ad], "config.json" if ad == "animatediff" else "model_index.json")):
            raise RuntimeError(f"AnimateDiff dosyaları eksik ({KLASORLER[ad]}). Video Stüdyosu'ndan modeli indirin.")

    cihaz, dtype = _cihaz()
    genislik = _kat(istek.get("genislik", 512), 8, 256)
    yukseklik = _kat(istek.get("yukseklik", 512), 8, 256)
    kare = max(8, min(24, int(istek.get("kare", 16))))
    adim = max(4, min(50, int(istek.get("adim", 20))))
    cfg = float(istek.get("cfg", 7.5))
    fps = max(4, min(24, int(istek.get("fps", 8))))

    ilerleme("Hareket adaptörü ve SD 1.5 modeli yükleniyor...", 4)
    t0 = time.time()
    adaptor = MotionAdapter.from_pretrained(KLASORLER["animatediff"], dtype=dtype, local_files_only=True,
                                            use_safetensors=True)
    boru = AnimateDiffPipeline.from_single_file(taban, config=KLASORLER["sd15"], motion_adapter=adaptor,
                                                feature_extractor=None, image_encoder=None,
                                                dtype=dtype, local_files_only=True)
    boru.scheduler = DPMSolverMultistepScheduler.from_config(boru.scheduler.config, beta_schedule="linear")
    boru.set_progress_bar_config(disable=True)
    boru.to(cihaz)
    try:
        boru.vae.enable_slicing()
    except Exception:
        pass
    gunluk(f"AnimateDiff {time.time() - t0:.1f} sn'de yüklendi ({cihaz})")

    ilerleme("Video üretimi başladı...", 14, 0, adim)
    t1 = time.time()
    with torch.inference_mode():
        sonuc = boru(prompt=istek["istem"], negative_prompt=istek.get("negatif") or AD_NEGATIF,
                     width=genislik, height=yukseklik, num_frames=kare, guidance_scale=cfg,
                     num_inference_steps=adim, decode_chunk_size=2 if cihaz == "cpu" else 8,
                     generator=torch.Generator("cpu").manual_seed(istek["tohum"]),
                     callback_on_step_end=_geri_cagri(adim))
    kareler = sonuc.frames[0]
    gunluk(f"AnimateDiff örnekleme {time.time() - t1:.1f} sn")
    del boru, adaptor
    gc.collect()
    ilerleme("MP4 olarak kodlanıyor...", 95)
    kareleri_kodla(kareler, istek["cikti"], fps)
    return {"motor": "animatediff", "motorAdi": "AnimateDiff v1.5 v2 + " + os.path.basename(taban), "seviye": "Düşük",
            "genislik": genislik, "yukseklik": yukseklik, "kare": len(kareler), "fps": fps, "adim": adim}


# ---------------------------------------------------------------------------
# Orta/yüksek seviye: Wan 2.1 T2V
# ---------------------------------------------------------------------------
def wan_boyutu(genislik, yukseklik, buyuk=False):
    """V2'nin en-boy kovaları; ayrıca işlemci için küçük 416x240 deneme boyutu."""
    w, h = int(genislik or 832), int(yukseklik or 480)
    if buyuk:
        return (1280, 720) if w > h * 1.15 else ((720, 1280) if h > w * 1.15 else (960, 960))
    if max(w, h) <= 480:
        return (416, 240) if w > h * 1.15 else ((240, 416) if h > w * 1.15 else (320, 320))
    return (832, 480) if w > h * 1.15 else ((480, 832) if h > w * 1.15 else (624, 624))


def _wan_klasoru_denetle(klasor, etiket):
    if not os.path.isfile(os.path.join(klasor, "model_index.json")):
        raise RuntimeError(f"{etiket} Diffusers klasörü bulunamadı: {klasor}")
    eksik = []
    for alt in ("vae", "transformer", "text_encoder", "tokenizer"):
        d = os.path.join(klasor, alt)
        if not os.path.isdir(d) or (alt != "tokenizer" and not any(f.endswith(".safetensors") for f in os.listdir(d))):
            eksik.append(alt)
    if eksik:
        raise RuntimeError(f"{etiket} indirmesi eksik ({', '.join(eksik)}). İndirmeyi yeniden başlatın; tamamlanmış dosyalar atlanır.")


def wan(istek, buyuk=False):
    import torch
    from diffusers import WanPipeline, AutoencoderKLWan, UniPCMultistepScheduler

    klasor = KLASORLER["wan21-14b" if buyuk else "wan21-1.3b"]
    etiket = "Wan 2.1 T2V 14B" if buyuk else "Wan 2.1 T2V 1.3B"
    _wan_klasoru_denetle(klasor, etiket)
    cihaz, _ = _cihaz()
    genislik, yukseklik = wan_boyutu(istek.get("genislik"), istek.get("yukseklik"), buyuk)
    kare = int(istek.get("kare", 33))
    kare = max(9, min(81, (kare - 1) // 4 * 4 + 1))  # Wan 4k+1 kare ister
    adim = max(4, min(50, int(istek.get("adim", 30))))
    cfg = float(istek.get("cfg", 5.0))
    istem = istek["istem"]
    negatif = istek.get("negatif") or WAN_NEGATIF
    uretec = torch.Generator("cpu").manual_seed(istek["tohum"])
    t0 = time.time()

    if cihaz == "cuda":
        # V2 yolu: bf16 + model parçalarını sırayla ekran kartına alma
        ilerleme(f"{etiket} yükleniyor (ekran kartı)...", 4)
        vae = AutoencoderKLWan.from_pretrained(klasor, subfolder="vae", dtype=torch.float32, local_files_only=True)
        boru = WanPipeline.from_pretrained(klasor, vae=vae, dtype=torch.bfloat16, local_files_only=True)
        boru.scheduler = UniPCMultistepScheduler.from_config(boru.scheduler.config, flow_shift=5.0 if buyuk else 3.0)
        boru.set_progress_bar_config(disable=True)
        boru.enable_model_cpu_offload()
        ilerleme("Video üretimi başladı...", 14, 0, adim)
        with torch.inference_mode():
            sonuc = boru(prompt=istem, negative_prompt=negatif, width=genislik, height=yukseklik, num_frames=kare,
                         num_inference_steps=adim, guidance_scale=cfg, generator=uretec,
                         callback_on_step_end=_geri_cagri(adim), output_type="pil")
    else:
        # İşlemci yolu: UMT5-XXL metin kodlayıcı (bf16 ~11 GB) önce TEK BAŞINA yüklenir, istem gömüleri
        # çıkarılır ve bellekten atılır; sonra yalnızca DiT + VAE yüklenir. Tepe bellek ~12 GB'a iner
        # (hepsi birlikte ~29 GB tutardı).
        from transformers import AutoTokenizer, UMT5EncoderModel
        ilerleme("Metin kodlayıcı yükleniyor (UMT5-XXL, en ağır adım)...", 3)
        tok = AutoTokenizer.from_pretrained(klasor, subfolder="tokenizer", local_files_only=True)
        kod = UMT5EncoderModel.from_pretrained(klasor, subfolder="text_encoder", dtype=torch.bfloat16,
                                               local_files_only=True, use_safetensors=True).eval()
        ilerleme("İstem kodlanıyor...", 8)
        gecici = WanPipeline(tokenizer=tok, text_encoder=kod, vae=None, scheduler=None, transformer=None)
        with torch.inference_mode():
            gomu, neg_gomu = gecici.encode_prompt(prompt=istem, negative_prompt=negatif,
                                                  do_classifier_free_guidance=cfg > 1.0,
                                                  max_sequence_length=512, device=torch.device("cpu"))
        del gecici, kod, tok
        gc.collect()
        ilerleme(f"{etiket} video modeli yükleniyor...", 11)
        vae = AutoencoderKLWan.from_pretrained(klasor, subfolder="vae", dtype=torch.float32, local_files_only=True)
        boru = WanPipeline.from_pretrained(klasor, vae=vae, text_encoder=None, tokenizer=None,
                                           dtype=torch.float32, local_files_only=True)
        boru.scheduler = UniPCMultistepScheduler.from_config(boru.scheduler.config, flow_shift=5.0 if buyuk else 3.0)
        boru.set_progress_bar_config(disable=True)
        gomu = gomu.to(torch.float32)
        neg_gomu = neg_gomu.to(torch.float32) if neg_gomu is not None else None
        ilerleme("Video üretimi başladı...", 14, 0, adim)
        with torch.inference_mode():
            sonuc = boru(prompt_embeds=gomu, negative_prompt_embeds=neg_gomu, width=genislik, height=yukseklik,
                         num_frames=kare, num_inference_steps=adim, guidance_scale=cfg, generator=uretec,
                         callback_on_step_end=_geri_cagri(adim), output_type="pil")
    kareler = sonuc.frames[0]
    gunluk(f"{etiket}: {time.time() - t0:.1f} sn ({cihaz})")
    del boru, sonuc
    gc.collect()
    ilerleme("MP4 olarak kodlanıyor...", 95)
    kareleri_kodla(kareler, istek["cikti"], 16)
    return {"motor": "wan21-14b" if buyuk else "wan21-1.3b", "motorAdi": etiket,
            "seviye": "Yüksek" if buyuk else "Orta", "genislik": genislik, "yukseklik": yukseklik,
            "kare": len(kareler), "fps": 16, "adim": adim}


# ---------------------------------------------------------------------------
# Görselden video: Stable Video Diffusion XT 1.1 (elle kurulursa)
# ---------------------------------------------------------------------------
def svd(istek):
    import torch
    from PIL import Image
    from diffusers import StableVideoDiffusionPipeline

    veri = str(istek.get("gorsel") or "")
    if not veri:
        raise RuntimeError("Görselden video için bir başlangıç görseli gerekir.")
    if veri.startswith("data:") and "," in veri:
        veri = veri.split(",", 1)[1]
    kaynak = Image.open(io.BytesIO(base64.b64decode(veri))).convert("RGB")
    w, h = (576, 1024) if kaynak.size[1] > kaynak.size[0] * 1.15 else (1024, 576)
    olcek = max(w / kaynak.size[0], h / kaynak.size[1])
    yw, yh = int(round(kaynak.size[0] * olcek)), int(round(kaynak.size[1] * olcek))
    kaynak = kaynak.resize((yw, yh), Image.Resampling.LANCZOS)
    sol, ust = (yw - w) // 2, (yh - h) // 2
    gorsel = kaynak.crop((sol, ust, sol + w, ust + h))
    klasor = KLASORLER["svd-xt"]
    if not os.path.isfile(os.path.join(klasor, "model_index.json")):
        raise RuntimeError(f"SVD-XT 1.1 Diffusers klasörü bulunamadı: {klasor}")
    cihaz, dtype = _cihaz()
    adim = max(4, min(50, int(istek.get("adim", 25))))
    ilerleme("SVD-XT yükleniyor...", 4)
    boru = StableVideoDiffusionPipeline.from_pretrained(klasor, dtype=dtype, local_files_only=True,
                                                        use_safetensors=True,
                                                        variant="fp16" if cihaz == "cuda" else None)
    boru.set_progress_bar_config(disable=True)
    if cihaz == "cuda":
        boru.enable_model_cpu_offload()
    ilerleme("Video üretimi başladı...", 14, 0, adim)
    with torch.inference_mode():
        sonuc = boru(gorsel, width=w, height=h, num_frames=25, num_inference_steps=adim,
                     motion_bucket_id=int(istek.get("hareket", 127)), noise_aug_strength=0.02, fps=7,
                     decode_chunk_size=2 if cihaz == "cpu" else 8,
                     generator=torch.Generator("cpu").manual_seed(istek["tohum"]),
                     callback_on_step_end=_geri_cagri(adim))
    kareler = sonuc.frames[0]
    ilerleme("MP4 olarak kodlanıyor...", 95)
    kareleri_kodla(kareler, istek["cikti"], 8)
    return {"motor": "svd-xt", "motorAdi": "Stable Video Diffusion XT 1.1", "seviye": "Yüksek",
            "genislik": w, "yukseklik": h, "kare": len(kareler), "fps": 8, "adim": adim}


class VideoUret:
    def __init__(self, ayar=None):
        self.ayar = ayar or {}
        try:
            import torch
            torch.set_num_threads(max(1, min(8, os.cpu_count() or 4)))
        except Exception:
            pass

    def isle(self, istek):
        if istek.get("islem") == "donanim":
            return donanim()
        if not istek.get("cikti"):
            raise ValueError("Çıktı yolu verilmedi.")
        motor = str(istek.get("motor") or "").lower()
        istem = str(istek.get("istem") or "").strip()
        if not istem and motor != "svd-xt":
            raise ValueError("Video istemi boş olamaz.")
        tohum = istek.get("tohum")
        tohum = int(time.time() * 1000) % 2147483647 if tohum in (None, "", -1) else int(tohum)
        istek = dict(istek, istem=istem[:1500] or "a cinematic shot, natural motion, high quality", tohum=tohum)
        os.makedirs(os.path.dirname(os.path.abspath(istek["cikti"])), exist_ok=True)
        basla = time.time()
        gunluk(f"motor={motor}")
        if motor == "animatediff":
            bilgi = animatediff(istek)
        elif motor == "wan21-1.3b":
            bilgi = wan(istek, buyuk=False)
        elif motor == "wan21-14b":
            bilgi = wan(istek, buyuk=True)
        elif motor == "svd-xt":
            bilgi = svd(istek)
        else:
            raise ValueError(f"Desteklenmeyen video motoru: {motor}")
        bilgi.update({"cihaz": "cuda" if _cihaz()[0] == "cuda" else "cpu", "tohum": tohum, "uretimSn": round(time.time() - basla, 1), "cikti": istek["cikti"],
                      "boyut": os.path.getsize(istek["cikti"])})
        ilerleme("Tamamlandı", 100)
        return bilgi


def _tek_sefer():
    for akis in (sys.stdin, sys.stdout, sys.stderr):
        try:
            akis.reconfigure(encoding="utf-8")
        except Exception:
            pass
    gercek_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        istek = json.loads(sys.stdin.buffer.read().decode("utf-8", errors="replace") or "{}")
        cikti = VideoUret().isle(istek)
        cikti["ok"] = True
        kod = 0
    except MemoryError:
        cikti, kod = {"ok": False, "hata": "Bellek yetersiz (RAM). Daha düşük çözünürlük/daha az kare deneyin, diğer modelleri kapatın."}, 1
    except Exception as hata:
        traceback.print_exc(file=sys.stderr)
        mesaj = f"{type(hata).__name__}: {hata}"
        if "out of memory" in mesaj.lower() or "not enough memory" in mesaj.lower():
            mesaj = "Bellek yetmedi: " + mesaj
        cikti, kod = {"ok": False, "hata": mesaj[:1500]}, 1
    gercek_stdout.write(json.dumps(cikti, ensure_ascii=False) + "\n")
    gercek_stdout.flush()
    sys.exit(kod)


if __name__ == "__main__":
    _tek_sefer()

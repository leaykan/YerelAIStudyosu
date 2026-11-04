# -*- coding: utf-8 -*-
"""Yerel AI Stüdyosu - müzik (MusicGen Small) ve ses efekti (AudioLDM-S) üretimi.

DD:YZ Sansürsüz Lokal AI Stüdyosu V2 (MIT, Tech Jarves / DD:YZ) kaynağından uyarlanmıştır
(scripts/workers/music-worker.py: Türkçe terim sözlükleri, istem çevirisi, MusicGen uzun parça
birleştirme ve AudioLDM ayarları).

İKİ ŞEKİLDE ÇALIŞIR
  1) Tek seferlik süreç (sunucunun varsayılan yolu, studyo.cjs):
       python -u muzik_efekt.py   < stdin: tek JSON istek
     İlerleme stderr'e "@@PROGRESS {json}" satırları olarak yazılır, sonuç stdout'a tek satır JSON:
       {"ok": true, ...}  ya da  {"ok": false, "hata": "..."}
     Süreç işi bitince kapanır; bellek tamamen geri verilir, zaman aşımında sunucu süreci öldürür.
  2) Kalıcı çalışan (kalici_calisan.py, _DIS_TURLER içinde "muzik-efekt": ("muzik_efekt", "MuzikEfekt")):
       motor = MuzikEfekt(ayar); motor.isle(istek) -> dict
     Son yüklenen model bellekte tutulur (art arda üretimde yükleme süresi tekrarlanmaz).

İSTEK
  {"islem": "uret" (varsayılan) | "donanim",
   "tur": "muzik" | "efekt", "model": "musicgen-small" | "audioldm-s",
   "istem": "...", "sure": saniye, "tohum": int (isteğe bağlı), "cikti": "<.wav yolu>",
   "modelKlasoru": "<app/music-models/...>"}   (verilmezse kök klasöre göre bulunur)
  İsteğe bağlı: "sessizlikTekrar": 0-2 (varsayılan 1; sessizlik algılanınca kaç kez devam ettirilsin)

SESSİZLİK DENETİMİ (MusicGen)
  MusicGen bazen birkaç saniye müzikten sonra sessizlik kodları üretmeye başlar ve geri dönmez (30 Ekim:
  15 sn istenip ~3 sn müzik). Sondaki sessizlik istenen sürenin %30'unu aşarsa müzik, sessizliğin başladığı
  yerden son 5 sn bağlam verilerek (MusicGen'in resmî devam ettirme yolu) farklı tohumla sürdürülür. Yine
  sessiz kalırsa sessiz kuyruk atılır ve sonuçta "uyari" alanı döner (arayüzde gösterilir). Sonuçta ayrıca
  "sessizKuyrukSn" (onarımdan sonra kalan) ve "sessizlikOnarimi" (deneme sayısı) bulunur.

GÜVENLİK
  - Yalnızca yerel klasörden yükler (HF_HUB_OFFLINE=1, local_files_only=True); ağdan hiçbir şey indirmez.
  - Yalnızca .safetensors ağırlıkları; pickle (.bin/.ckpt/.pt, torch.load) ve trust_remote_code yok.
  - V2'deki MusicGen Medium/Large yolu AudioCraft pickle dosyasını torch.load(weights_only=False) ile
    açtığı için ALINMADI.

MODELLER VE LİSANSLAR (model kartlarından doğrulandı)
  - facebook/musicgen-small @4c8334b02c6ec4e8664a91979669a501ec497792 — ağırlıklar CC-BY-NC 4.0
    (ticari olmayan kullanım). Meta AudioCraft.
  - cvssp/audioldm-s-full-v2 @feeb3d14203495a4b6ac0893cbdedb2159b4819c — CC-BY-NC-SA 4.0
    (ticari olmayan, aynı lisansla paylaş). Haohe Liu ve ark., Surrey CVSSP.
"""
import json
import os
import random
import re
import sys
import time
import traceback

KOK = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
MUZIK_MODELLERI = os.path.join(KOK, "app", "music-models")

# Sabit commit'ler (indirme studyo.cjs/ozellikler.cjs PAKETLER ile yapılır; burada belge ve denetim için)
AGIRLIKLAR = {
    "musicgen-small": {"repo": "facebook/musicgen-small", "revision": "4c8334b02c6ec4e8664a91979669a501ec497792",
                        "klasor": "musicgen-small", "lisans": "CC-BY-NC-4.0"},
    "audioldm-s": {"repo": "cvssp/audioldm-s-full-v2", "revision": "feeb3d14203495a4b6ac0893cbdedb2159b4819c",
                    "klasor": "audioldm-s-full-v2", "lisans": "CC-BY-NC-SA-4.0"},
}


# ---------------------------------------------------------------------------
# Türkçe terim sözlükleri (V2'den aynen). MusicGen'in T5'i ve AudioLDM'in CLAP'ı İngilizce anlar.
# ---------------------------------------------------------------------------
TR_SFX_DICT = [
    ("gök gürültüsü", "loud thunderclap rumble"),
    ("şimşek", "lightning strike thunder"),
    ("sağanak yağmur", "heavy rain downpour"),
    ("yağmur", "rain falling water drops"),
    ("fırtına", "violent storm wind and rain"),
    ("rüzgar", "howling wind blowing"),
    ("patlama", "massive explosion boom blast"),
    ("bomba", "bomb explosion shockwave"),
    ("silah sesi", "gunshot firearm bang"),
    ("silah", "gunshot weapon fire"),
    ("ateş etme", "gunfire shooting"),
    ("lazer", "sci-fi laser beam zap"),
    ("ayak sesi", "footsteps walking on floor"),
    ("adımlar", "footsteps walking"),
    ("koşma", "running footsteps"),
    ("araba motoru", "car engine revving V8"),
    ("motor sesi", "engine roaring revving"),
    ("araba", "car driving pass by"),
    ("fren", "tires screeching car brake"),
    ("patinaj", "car tires skidding screech"),
    ("cam kırılması", "glass shattering breaking crash"),
    ("kırılan cam", "glass breaking shatter"),
    ("kapı gıcırtısı", "creaky wooden door opening"),
    ("kapı çarpması", "heavy door slam shut"),
    ("kapı", "door opening and closing"),
    ("alkış", "crowd clapping applause"),
    ("kalabalık", "crowd ambience chatter"),
    ("çığlık", "human scream shout"),
    ("kahkaha", "laughing laughter"),
    ("gülme", "laughter chuckling"),
    ("ağlama", "crying sobbing"),
    ("köpek havlaması", "dog barking"),
    ("köpek", "dog barking growling"),
    ("kedi miyavlaması", "cat meowing"),
    ("kedi", "cat meow purr"),
    ("kuş sesleri", "birds chirping singing in forest"),
    ("kuş", "bird chirping"),
    ("dalga", "ocean waves crashing on beach"),
    ("deniz", "sea waves water splashing"),
    ("su sesi", "flowing water stream splash"),
    ("su", "water splash flowing"),
    ("ateş", "crackling fire flames burning"),
    ("kamp ateşi", "campfire crackling wood burning"),
    ("kılıç", "metal sword clash slash"),
    ("yumruk", "heavy punch impact hit"),
    ("darbe", "heavy impact thud hit"),
    ("zil", "bell ringing chime"),
    ("telefon", "telephone ringing beep"),
    ("alarm", "siren alarm blaring"),
    ("siren", "police ambulance siren wailing"),
    ("helikopter", "helicopter rotor blades flying"),
    ("uçak", "jet airplane engine flyby"),
    ("tren", "train chugging on tracks horn"),
    ("klavye", "mechanical keyboard typing clicks"),
    ("saat", "clock ticking mechanical"),
    ("kalp atışı", "heartbeat thumping pulse"),
    ("korku", "creepy horror ambience drone"),
    ("uzay", "sci-fi space ambient whoosh"),
    ("rüzgarlı", "windy air whoosh"),
]

TR_MUSIC_DICT = [
    ("epik", "epic cinematic"),
    ("sinematik", "cinematic film score"),
    ("orkestra", "symphonic orchestra strings brass"),
    ("piyano", "acoustic grand piano"),
    ("akustik gitar", "acoustic guitar fingerpicking"),
    ("elektro gitar", "electric guitar riff solo"),
    ("gitar", "guitar melody"),
    ("keman", "emotional violin solo strings"),
    ("çello", "deep cello strings"),
    ("flüt", "wooden flute melody"),
    ("ney", "mystical reed flute ney"),
    ("bağlama", "anatolian folk lute baglama"),
    ("ud", "middle eastern oud melody"),
    ("davul", "powerful drums percussion beat"),
    ("bateri", "drum kit rhythm groove"),
    ("bas", "deep bassline groove"),
    ("hüzünlü", "melancholic emotional sad slow"),
    ("duygusal", "emotional heartfelt expressive"),
    ("neşeli", "upbeat happy cheerful bright"),
    ("enerjik", "energetic fast driving upbeat"),
    ("hareketli", "upbeat danceable rhythmic"),
    ("sakin", "calm relaxing peaceful ambient"),
    ("rahatlatıcı", "relaxing soothing chill ambient"),
    ("karanlık", "dark mysterious tense atmospheric"),
    ("gerilim", "suspenseful thriller tension"),
    ("romantik", "romantic warm tender"),
    ("lo-fi", "lofi hip hop chill beats"),
    ("lofi", "lofi chillhop dusty beats"),
    ("elektronik", "electronic synthwave house"),
    ("tekno", "techno club driving bass"),
    ("rock", "rock band electric guitar drums"),
    ("metal", "heavy metal distorted guitars double kick"),
    ("caz", "smooth jazz saxophone piano upright bass"),
    ("klasik", "classical chamber orchestra"),
    ("doğu", "oriental middle eastern traditional"),
    ("türk", "turkish anatolian folk melody"),
    ("oyun müziği", "video game soundtrack ost"),
    ("fon müziği", "background instrumental music"),
    ("melodi", "melodic instrumental"),
    ("ritim", "rhythmic beat groove"),
    ("yavaş", "slow tempo ambient"),
    ("hızlı", "fast tempo energetic"),
]


def cevir_ve_zenginlestir(ham_istem, efekt_mi, zenginlestir=True):
    """V2 translate_and_enrich_prompt: sözlükteki Türkçe terimleri İngilizceye çevirir.

    Tempo ifadeleri ("86 bpm", "86 BPM", "dakikada 86 vuruş", "tempo 86") çeviriden önce ayıklanır, "86 bpm"
    biçimine getirilip istemin sonuna aynen eklenir; sayılar ve "8-bit", "80s" gibi kelimeler korunur. Süre
    ifadeleri ("15 sn", "30 saniyelik") istemden atılır: süreyi modele "sure" alanı verir, T5 bunu anlamaz.
    İstem zaten İngilizceyse (Vega'nın ya da kullanıcının yazdığı) sözlük uygulanmaz, yalnızca tempo ve süre
    düzenlenir; böylece "bass" içindeki "bas" gibi yanlış eşleşmeler olmaz."""
    tempolar, metin = tempo_ayikla(ham_istem)
    metin = sure_ifadelerini_sil(metin)
    tempo_eki = ", ".join(tempolar)

    def ekle_tempo(s):
        s = _temizle(s)
        if not tempo_eki:
            return s
        return f"{s}, {tempo_eki}" if s else tempo_eki

    if ingilizce_mi(metin):
        temiz = _temizle(metin) or _temizle(ham_istem)
        if efekt_mi and zenginlestir:
            return f"high quality realistic sound effect of {temiz}, foley audio, clear recording"
        return ekle_tempo(temiz)

    kucuk = metin.replace("İ", "i").lower()
    for kelime in ("ses efekti", "sesi", "efekti", "üret", "yap", "bana", "lütfen"):
        kucuk = re.sub(rf"\b{kelime}\b", " ", kucuk)

    eslesen = []
    sozluk = TR_SFX_DICT if efekt_mi else (TR_MUSIC_DICT + TR_SFX_DICT)
    for tr, en in sozluk:
        # Terim bir kelimenin BAŞINDA aranır: Türkçe ekler yakalanır ("kuşların" -> "kuş") ama İngilizce
        # kelimelerin ortası eşleşmez (V2'de "loud" içindeki "ud" yanlışlıkla "oud" ekliyordu).
        desen = re.compile(rf"(?<!\w){re.escape(tr)}")
        if desen.search(kucuk):
            eslesen.append(en)
            kucuk = desen.sub(" ", kucuk)

    # Kullanıcının yazdığı İngilizce/ASCII kelimeler korunur. Kelimeler Türkçe harflerle birlikte bölünür,
    # böylece "müzik" gibi Türkçe kelimelerden "zik" gibi parçalar kalmaz; "8-bit", "80s", "lo-fi" korunur.
    kelimeler = re.findall(r"[0-9a-zçğıöşüâîû][0-9a-zçğıöşüâîû'\-]*", kucuk)
    dolgu = {"bir", "ile", "icin", "gibi", "cok", "daha", "olan", "veya", "hem", "lar", "ler", "lari", "leri", "dan", "den",
             "nin", "olsun", "tarz", "tarzi", "tarzinda", "istiyorum", "uret", "yap", "bana", "lutfen", "sarki", "parca", "muzik"}
    kalan = []
    for k in kelimeler:
        k = k.strip("-'")
        if not k or not re.fullmatch(r"[a-z0-9'\-]+", k) or k in dolgu:
            continue
        if len(re.sub(r"[^a-z]", "", k)) >= 3 or re.fullmatch(r"\d+-?(bit|s)", k):
            kalan.append(k)

    if eslesen:
        birlesik = ", ".join(eslesen)
        if kalan:
            birlesik = f"{birlesik}, {' '.join(kalan)}"
        if not zenginlestir:
            return ekle_tempo(birlesik)
        if efekt_mi:
            return f"high quality realistic sound effect, foley audio of {birlesik}, clear crisp recording"
        return ekle_tempo(f"{birlesik}, high quality studio instrumental music")
    temiz = _temizle(metin) or _temizle(ham_istem)
    if efekt_mi and zenginlestir:
        return f"high quality realistic sound effect of {temiz}, foley audio, clear recording"
    return ekle_tempo(temiz)


# Tempo: "86 bpm", "86BPM", "86 b.p.m.", "dakikada 86 vuruş", "86 vuruş/dk", "tempo 86", "86 tempoda"
_TEMPO_DESENLERI = [
    re.compile(r"(?<![\w.])(\d{2,3})\s*-?\s*b\.?\s?p\.?\s?m\.?(?!\w)", re.IGNORECASE),
    re.compile(r"(?<!\w)dakikada\s+(\d{2,3})\s+vuru[sş]\w*", re.IGNORECASE),
    re.compile(r"(?<![\w.])(\d{2,3})\s+vuru[sş]\w*\s*(?:/|bölü|bolu|her)?\s*(?:dk|dakika)\w*", re.IGNORECASE),
    re.compile(r"(?<!\w)tempo(?:su|sunda)?\s*[:=]?\s*(\d{2,3})(?!\d)", re.IGNORECASE),
    re.compile(r"(?<![\w.])(\d{2,3})(?!\d)\s+tempo\w*", re.IGNORECASE),
]
_SURE_DESENI = re.compile(
    r"(?<![\w.,])\d+(?:[.,]\d+)?\s*(?:sn|saniye\w*|sec|secs|seconds?|dk|dakika\w*|min|mins|minutes?)(?!\w)", re.IGNORECASE)
_INGILIZCE_KELIMELER = re.compile(
    r"\b(with|and|the|of|in|beat|beats|music|song|style|track|drums?|guitar|piano|bass|synth\w*|melody|ambient|loop|"
    r"vibe|groove|chill|soft|epic|upbeat|instrumental|orchestra\w*|strings|sound|sounds|rain|wind)\b", re.IGNORECASE)


def tempo_ayikla(metin):
    """Tempo ifadelerini bulur; (["86 bpm", ...], ifadeleri boşlukla değiştirilmiş metin) döner. 30-300 dışı yok sayılır."""
    tempolar = []

    def topla(m):
        n = int(m.group(1))
        if 30 <= n <= 300:
            t = f"{n} bpm"
            if t not in tempolar:
                tempolar.append(t)
            return " "
        return m.group(0)

    for desen in _TEMPO_DESENLERI:
        metin = desen.sub(topla, metin)
    return tempolar, metin


def sure_ifadelerini_sil(metin):
    return _SURE_DESENI.sub(" ", metin)


def ingilizce_mi(metin):
    """Türkçe harf içermeyen ve yaygın İngilizce müzik/ses kelimeleri geçen istem İngilizce sayılır."""
    if re.search(r"[çğıöşüÇĞİÖŞÜ]", metin):
        return False
    return bool(_INGILIZCE_KELIMELER.search(metin))


def _temizle(s):
    s = re.sub(r"\s+", " ", str(s or ""))
    s = re.sub(r"\s+([,.;:])", r"\1", s)
    s = re.sub(r"([,;])(?:\s*[,;])+", r"\1", s)
    return s.strip(" ,;:-")


# ---------------------------------------------------------------------------
# Yardımcılar
# ---------------------------------------------------------------------------
def ilerleme(asama, yuzde, adim=0, toplam=0):
    try:
        sys.stderr.write("@@PROGRESS " + json.dumps({"phase": asama, "progress": max(0, min(100, int(yuzde))),
                                                     "step": int(adim), "total": int(toplam)}, ensure_ascii=False) + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def donanim():
    """Torch'un gördüğü donanım (CUDA/VRAM). torch yoksa yalnızca işlemci bilgisi döner."""
    bilgi = {"cpuSayisi": os.cpu_count() or 0, "cuda": False, "vramGb": 0, "gpuAdi": "", "torch": ""}
    try:
        import torch
        bilgi["torch"] = torch.__version__
        if torch.cuda.is_available():
            ozl = torch.cuda.get_device_properties(0)
            bilgi.update({"cuda": True, "gpuAdi": ozl.name, "vramGb": round(ozl.total_memory / 1073741824, 1)})
        bilgi["mps"] = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    except Exception as hata:
        bilgi["hata"] = f"{type(hata).__name__}: {hata}"
    return bilgi


def _is_parcacigi():
    try:
        import torch
        torch.set_num_threads(max(1, min(8, os.cpu_count() or 4)))
    except Exception:
        pass


def _klasor(istek, anahtar):
    k = istek.get("modelKlasoru") or os.path.join(MUZIK_MODELLERI, AGIRLIKLAR[anahtar]["klasor"])
    if not os.path.isdir(k):
        raise RuntimeError(f"Model klasörü bulunamadı: {k}. Stüdyo sayfasından modeli indirin.")
    return k


def _generation_kimlikleri(model):
    """transformers 5 bu kimlikleri generation_config'e kopyalamıyor (V2'deki düzeltme)."""
    gen = model.generation_config
    kaynaklar = [model.config, getattr(model.config, "decoder", None)]
    for ad in ("decoder_start_token_id", "bos_token_id", "pad_token_id"):
        if getattr(gen, ad, None) is not None:
            continue
        for k in kaynaklar:
            deger = getattr(k, ad, None) if k is not None else None
            if deger is not None:
                setattr(gen, ad, deger)
                break
    if getattr(gen, "decoder_start_token_id", None) is None:
        gen.decoder_start_token_id = gen.pad_token_id if gen.pad_token_id is not None else gen.bos_token_id


SESSIZLIK_ORANI = 0.30  # sondaki sessizlik istenen sürenin bu oranını aşarsa onarılır / bildirilir


def sessiz_kuyruk_orn(ses, ornekleme, esik_db=-40.0, pencere_sn=0.05):
    """Sondaki sessizliğin örnek sayısı. 50 ms'lik pencerelerin RMS'i, parçanın yüksek kısmının (95. yüzdelik)
    esik_db altındaysa sessiz sayılır. 30 Ekim'deki dosyada müzik ~6000, sessizlik 3-4 RMS idi (-64 dB)."""
    import numpy as np
    ses = np.asarray(ses, dtype=np.float32).reshape(-1)
    w = max(1, int(pencere_sn * ornekleme))
    n = len(ses) // w
    if n < 4:
        return 0
    rms = np.sqrt(np.mean(ses[:n * w].reshape(n, w).astype(np.float64) ** 2, axis=1))
    ref = float(np.percentile(rms, 95))
    if ref <= 1e-7:
        return len(ses)
    esik = ref * (10.0 ** (esik_db / 20.0))
    sessiz = rms < esik
    say = 0
    for d in sessiz[::-1]:
        if not d:
            break
        say += 1
    if say == 0:
        return 0
    return min(len(ses), say * w + (len(ses) - n * w))


def _normalize_et_kaydet(ses, yol, ornekleme, model_adi):
    import numpy as np
    import soundfile as sf
    ses = np.asarray(ses, dtype=np.float32).reshape(-1)
    tepe = float(np.max(np.abs(ses))) if ses.size else 0.0
    if tepe <= 0.001:
        raise RuntimeError(f"{model_adi} bu istem için sessiz bir çıktı üretti. İstemi değiştirip tekrar deneyin.")
    ses = np.clip(ses / tepe * 0.95, -1.0, 1.0)
    os.makedirs(os.path.dirname(os.path.abspath(yol)), exist_ok=True)
    gecici = yol + ".part.wav"
    sf.write(gecici, ses, ornekleme, subtype="PCM_16")
    os.replace(gecici, yol)
    return len(ses) / float(ornekleme)


# ---------------------------------------------------------------------------
# Motor
# ---------------------------------------------------------------------------
class MuzikEfekt:
    def __init__(self, ayar=None):
        self.ayar = ayar or {}
        self._model_anahtari = None
        self._nesneler = None
        _is_parcacigi()

    def _bosalt(self):
        self._nesneler = None
        self._model_anahtari = None
        import gc
        gc.collect()

    # --- MusicGen ---------------------------------------------------------
    def _musicgen_yukle(self, klasor, cihaz, dtype):
        anahtar = ("musicgen", klasor, cihaz)
        if self._model_anahtari == anahtar:
            return self._nesneler
        self._bosalt()
        from transformers import AutoTokenizer, MusicgenForConditionalGeneration
        # Yalnızca tokenizer.json (hızlı tokenizer) kullanılır; spiece.model indirilmez
        tokenizer = AutoTokenizer.from_pretrained(klasor, local_files_only=True)
        model = MusicgenForConditionalGeneration.from_pretrained(
            klasor, dtype=dtype, local_files_only=True, use_safetensors=True).to(cihaz).eval()
        _generation_kimlikleri(model)
        # MusicGen'de bitiş jetonu yoktur; uzunluk yalnızca max_new_tokens ile belirlenir. T5 metin kodlayıcısının
        # eos_token_id=1 değeri (1 aynı zamanda geçerli bir ses kodu) üretim ayarına hiç sızmasın diye boşaltılır.
        # Not (31 Ekim testi, transformers 5.20): bu değer zaten sızmıyordu; 15 sn istenip ~4 sn müzik çıkması
        # erken bitişten değil, modelin kendisinin sessizlik kodları üretmesinden kaynaklanıyordu (747 karenin
        # tamamı çözülmüştü). Önlem _musicgen içindeki sessizlik denetimi ve top_k=250'dir.
        model.generation_config.eos_token_id = None
        try:
            model.config.eos_token_id = None
        except Exception:
            pass
        self._nesneler = (tokenizer, model)
        self._model_anahtari = anahtar
        return self._nesneler

    def _musicgen(self, istek, cihaz, dtype, tohum):
        import math
        import numpy as np
        import torch
        from transformers import LogitsProcessor, LogitsProcessorList

        sure = max(2, min(300, int(float(istek.get("sure", 10)))))
        klasor = _klasor(istek, "musicgen-small")
        ilerleme("MusicGen Small belleğe yükleniyor...", 8, 0, sure)
        tokenizer, model = self._musicgen_yukle(klasor, cihaz, dtype)
        etkin_istem = cevir_ve_zenginlestir(istek["istem"], efekt_mi=False)
        girdi = tokenizer([etkin_istem], padding=True, return_tensors="pt").to(cihaz)
        ses_cfg = model.config.audio_encoder
        ornekleme = int(getattr(ses_cfg, "sampling_rate", 32000) or 32000)
        # EnCodec 32 kHz: 640 örneklik adım = saniyede 50 kod karesi. Gecikme deseni yüzünden N jetonluk üretim
        # N - (kod kitabı sayısı - 1) kare ses verir (750 jeton -> 747 kare -> 14,94 sn).
        adim_orn = int(np.prod(getattr(ses_cfg, "upsampling_ratios", None) or [8, 5, 4, 4]))
        kare_hizi = ornekleme / float(adim_orn)
        gecikme = int(getattr(model.decoder.config, "num_codebooks", 4)) - 1
        tekrar_hakki = max(0, min(2, int(istek.get("sessizlikTekrar", 1))))
        durum = {"etiket": "Müzik sentezleniyor"}

        class Ilerleme(LogitsProcessor):
            def __init__(self, taban, toplam_jeton, toplam_sn):
                self.taban, self.toplam, self.sn, self.n = taban, max(1, toplam_jeton), toplam_sn, 0

            def __call__(self, input_ids, scores):
                self.n += 1
                if self.n % 10 == 0 or self.n == 1:
                    biten = self.taban + self.n
                    an = min(self.sn, int(biten / self.toplam * self.sn))
                    ilerleme(f"{durum['etiket']} ({an}/{self.sn} sn)...", 12 + int(min(1.0, biten / self.toplam) * 84), an, self.sn)
                return scores

        def uret(jeton, taban, toplam_jeton, parca_tohumu, baglam=None):
            """jeton kadar yeni jeton üretir. baglam (ses dizisi) verilirse MusicGen'in resmî devam ettirme yolu
            (input_values = ses istemi) kullanılır; dönen ses baglamın yeniden çözülmüş hali + devamıdır."""
            torch.manual_seed(parca_tohumu)
            ek = {}
            if baglam is not None:
                ek["input_values"] = torch.from_numpy(np.ascontiguousarray(baglam, dtype=np.float32)).to(cihaz, dtype)[None, None, :]
            # top_k=250 / CFG 3 / sıcaklık 1: Meta AudioCraft'ın MusicGen varsayılanları (transformers'ın
            # varsayılanı top_k=50; daha "açgözlü" örnekleme MusicGen'i sessizlik kodlarına kilitlemeye yatkın).
            with torch.inference_mode():
                cikti = model.generate(**girdi, **ek, max_new_tokens=jeton, min_new_tokens=jeton, eos_token_id=None,
                                       do_sample=True, guidance_scale=3.0, top_k=250, temperature=1.0,
                                       logits_processor=LogitsProcessorList([Ilerleme(taban, toplam_jeton, sure)]))
            return cikti[0, 0].cpu().float().numpy()

        def onar(ses, hedef_orn, taban, toplam_jeton, parca_tohumu):
            """Sondaki sessizlik hedefin %30'undan uzunsa, sessizliğin başladığı yerden müziği devam ettirir."""
            bilgi = {"onarildi": False, "deneme": 0}
            for deneme in range(tekrar_hakki):
                kuyruk = sessiz_kuyruk_orn(ses, ornekleme)
                muzik = len(ses) - kuyruk
                if kuyruk <= SESSIZLIK_ORANI * hedef_orn or muzik < int(1.0 * ornekleme):
                    break
                bilgi["deneme"] = deneme + 1
                # Sönme kuyruğunu da at (0,25 sn geri), kare sınırına hizala; son 5 sn bağlam olur
                kes = max(adim_orn, ((muzik - int(0.25 * ornekleme)) // adim_orn) * adim_orn)
                bas = max(0, kes - ((5 * ornekleme) // adim_orn) * adim_orn)
                baglam = ses[bas:kes]
                eksik_kare = int(math.ceil(max(0, hedef_orn - kes) / adim_orn))
                if eksik_kare <= 0:
                    break
                durum["etiket"] = f"Sessizlik algılandı ({kuyruk / ornekleme:.1f} sn), müzik devam ettiriliyor"
                ilerleme(durum["etiket"] + "...", 12 + int(min(1.0, kes / max(1, hedef_orn)) * 84), int(kes / ornekleme), sure)
                tam = uret(eksik_kare + gecikme, taban, toplam_jeton, parca_tohumu + 7919 * (deneme + 1), baglam)
                yeni = tam[len(baglam):]
                # Ek noktasında 30 ms geçiş (devamın baştaki kısmı bağlamın yeniden çözülmüş halidir)
                g = min(int(0.03 * ornekleme), kes, len(baglam))
                if g > 0:
                    t = np.linspace(0.0, 1.0, g, dtype=np.float32)
                    gecis = ses[kes - g:kes] * (1.0 - t) + tam[len(baglam) - g:len(baglam)] * t
                    ses = np.concatenate([ses[:kes - g], gecis, yeni]).astype(np.float32)
                else:
                    ses = np.concatenate([ses[:kes], yeni]).astype(np.float32)
                bilgi["onarildi"] = True
                durum["etiket"] = "Müzik sentezleniyor"
            return ses, bilgi

        onarimlar = 0
        # MusicGen'in dikkat penceresi 30 sn (1500 jeton); daha uzun parçalar 25 sn'lik bölümlerin
        # 1,5 sn eşit güçte (cos/sin) geçişle birleştirilmesiyle üretilir (V2 yöntemi).
        if sure <= 30:
            jeton = int(sure * kare_hizi)
            ses = uret(jeton, 0, jeton, tohum)
            ses, b = onar(ses, int(sure * ornekleme), 0, jeton, tohum)
            onarimlar += b["deneme"]
        else:
            parca_sn, ortusme = 25, 1.5
            adet = max(2, int(math.ceil((sure - ortusme) / (parca_sn - ortusme))))
            jeton = int(parca_sn * kare_hizi)
            parcalar = []
            for i in range(adet):
                p = uret(jeton, i * jeton, adet * jeton, tohum + i * 101)
                p, b = onar(p, int(parca_sn * ornekleme), i * jeton, adet * jeton, tohum + i * 101)
                onarimlar += b["deneme"]
                # Ortadaki bir bölüm sessiz biterse birleşik parçanın ortasında boşluk kalmasın: kırp
                if i < adet - 1:
                    k = sessiz_kuyruk_orn(p, ornekleme)
                    if k > int(1.0 * ornekleme):
                        p = p[:len(p) - k + int(0.2 * ornekleme)]
                parcalar.append(p)
            ort = int(ortusme * ornekleme)
            ses = parcalar[0]
            for p in parcalar[1:]:
                o = min(ort, len(ses) // 4, len(p) // 4)
                if o > 0:
                    t = np.linspace(0, np.pi / 2, o, dtype=np.float32)
                    ses = np.concatenate([ses[:-o], ses[-o:] * np.cos(t) + p[:o] * np.sin(t), p[o:]])
                else:
                    ses = np.concatenate([ses, p])
            hedef = int(sure * ornekleme)
            if len(ses) > hedef:
                ses = ses[:hedef]
                kuyruk = min(int(0.5 * ornekleme), len(ses) // 10)
                if kuyruk > 0:
                    ses[-kuyruk:] *= np.linspace(1.0, 0.0, kuyruk, dtype=np.float32)

        # Son denetim: sondaki sessizlik istenen sürenin %30'undan uzunsa sessizce kaydetmek yerine bildirilir.
        # Sessiz kuyruk atılır (0,5 sn sönme bırakılır); dosya istenenden kısa olur ve sonuçta "uyari" döner.
        kuyruk = sessiz_kuyruk_orn(ses, ornekleme)
        sessiz_sn = kuyruk / float(ornekleme)
        uyari = ""
        if kuyruk > SESSIZLIK_ORANI * sure * ornekleme and len(ses) - kuyruk >= int(0.5 * ornekleme):
            muzik_sn = (len(ses) - kuyruk) / float(ornekleme)
            birak = min(int(0.5 * ornekleme), kuyruk)
            ses = ses[:len(ses) - kuyruk + birak].copy()
            if birak > 0:
                ses[-birak:] *= np.linspace(1.0, 0.0, birak, dtype=np.float32)
            deneme_metni = f" ({onarimlar} kez devam ettirme denendi)" if onarimlar else ""
            uyari = (f"Model müziği {muzik_sn:.1f} sn'de bitirip sessizliğe düştü{deneme_metni}; sondaki {sessiz_sn:.1f} sn "
                     f"sessizlik atıldı, dosya istenen {sure} sn yerine {len(ses) / ornekleme:.1f} sn. "
                     "Farklı bir tohumla ya da tarzı ve çalgıları daha açık yazarak yeniden deneyin.")
        ilerleme("Müzik dosyası kaydediliyor...", 97, sure, sure)
        gercek = _normalize_et_kaydet(ses, istek["cikti"], ornekleme, "MusicGen")
        sonuc = {"sure": round(gercek, 2), "ornekleme": ornekleme, "kanal": 1, "etkinIstem": etkin_istem,
                 "model": "musicgen-small", "modelAdi": "Meta MusicGen Small (300M)", "efekt": False,
                 "sessizKuyrukSn": round(sessiz_sn, 2), "sessizlikOnarimi": onarimlar}
        if uyari:
            sonuc["uyari"] = uyari
        return sonuc

    # --- AudioLDM-S -------------------------------------------------------
    def _audioldm_yukle(self, klasor, cihaz, dtype):
        anahtar = ("audioldm", klasor, cihaz)
        if self._model_anahtari == anahtar:
            return self._nesneler
        self._bosalt()
        from diffusers import AudioLDMPipeline
        boru = AudioLDMPipeline.from_pretrained(klasor, dtype=dtype, local_files_only=True, use_safetensors=True)
        boru = boru.to(cihaz)
        try:
            boru.set_progress_bar_config(disable=True)
        except Exception:
            pass
        self._nesneler = boru
        self._model_anahtari = anahtar
        return boru

    def _audioldm(self, istek, cihaz, dtype, tohum):
        import torch
        sure = max(2.0, min(20.0, float(istek.get("sure", 6))))
        adim = max(10, min(100, int(istek.get("adim", 35))))
        klasor = _klasor(istek, "audioldm-s")
        ilerleme("AudioLDM-S belleğe yükleniyor...", 8, 0, adim)
        boru = self._audioldm_yukle(klasor, cihaz, dtype)
        # AudioLDM v1 (CLAP), negatif istem ya da uzun "zenginleştirilmiş" şablonla neredeyse sessiz çıktı
        # veriyor (V2'de -73 dB ölçülmüş); düz istem + CFG 2.5 varsayılanı kullanılır.
        etkin_istem = cevir_ve_zenginlestir(istek["istem"], efekt_mi=True, zenginlestir=False)

        def geri_cagri(i, t, latents):
            ilerleme(f"Ses efekti sentezleniyor (adım {i + 1}/{adim})...", 12 + int((i + 1) / adim * 84), i + 1, adim)

        uretec = torch.Generator(device="cpu").manual_seed(tohum)
        with torch.inference_mode():
            ses = boru(prompt=etkin_istem, num_inference_steps=adim, audio_length_in_s=sure, guidance_scale=2.5,
                       generator=uretec, callback=geri_cagri, callback_steps=1).audios[0]
        ilerleme("Ses efekti kaydediliyor...", 97, adim, adim)
        gercek = _normalize_et_kaydet(ses, istek["cikti"], 16000, "AudioLDM-S")
        return {"sure": round(gercek, 2), "ornekleme": 16000, "kanal": 1, "etkinIstem": etkin_istem,
                "model": "audioldm-s", "modelAdi": "AudioLDM-S Full v2", "efekt": True, "adim": adim}

    # --- Giriş ------------------------------------------------------------
    def isle(self, istek):
        if istek.get("islem") == "donanim":
            return donanim()
        istem = str(istek.get("istem") or "").strip()
        if not istem:
            raise ValueError("İstem (tarif) boş olamaz.")
        if not istek.get("cikti"):
            raise ValueError("Çıktı yolu verilmedi.")
        istek = dict(istek, istem=istem[:1000])
        import torch
        cihaz = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if cihaz == "cuda" else torch.float32
        tohum = istek.get("tohum")
        tohum = random.randint(100000, 99999999) if tohum in (None, "", -1) else int(tohum)
        model = str(istek.get("model") or "").lower()
        tur = str(istek.get("tur") or "").lower()
        basla = time.time()
        ilerleme("Ses motoru hazırlanıyor...", 4)
        if model == "audioldm-s" or (not model and tur == "efekt"):
            sonuc = self._audioldm(istek, cihaz, dtype, tohum)
        elif model == "musicgen-small" or (not model and tur == "muzik"):
            sonuc = self._musicgen(istek, cihaz, dtype, tohum)
        else:
            raise ValueError(f"Desteklenmeyen model: {model}")
        sonuc.update({"tohum": tohum, "cihaz": cihaz, "uretimSn": round(time.time() - basla, 1), "cikti": istek["cikti"]})
        ilerleme("Tamamlandı", 100)
        return sonuc


# ---------------------------------------------------------------------------
# Tek seferlik süreç girişi
# ---------------------------------------------------------------------------
def _tek_sefer():
    for akis in (sys.stdin, sys.stdout, sys.stderr):
        try:
            akis.reconfigure(encoding="utf-8")
        except Exception:
            pass
    gercek_stdout = sys.stdout
    sys.stdout = sys.stderr  # kütüphanelerin print'leri sonucu bozmasın
    try:
        istek = json.loads(sys.stdin.buffer.read().decode("utf-8", errors="replace") or "{}")
        sonuc = MuzikEfekt().isle(istek)
        sonuc["ok"] = True
        cikti = sonuc
        kod = 0
    except MemoryError:
        cikti, kod = {"ok": False, "hata": "Bellek yetersiz (RAM). Daha kısa süre deneyin ya da diğer modelleri kapatın."}, 1
    except Exception as hata:
        traceback.print_exc(file=sys.stderr)
        mesaj = f"{type(hata).__name__}: {hata}"
        if "out of memory" in mesaj.lower():
            mesaj = "Ekran kartı/sistem belleği yetmedi: " + mesaj
        cikti, kod = {"ok": False, "hata": mesaj[:1500]}, 1
    gercek_stdout.write(json.dumps(cikti, ensure_ascii=False) + "\n")
    gercek_stdout.flush()
    sys.exit(kod)


if __name__ == "__main__":
    _tek_sefer()

# Atıflar ve lisanslar

Bu proje, **DD:YZ "Sansürsüz Lokal AI Stüdyosu"** (V1 ve V2; Tech Jarves / DD:YZ, MIT lisansı) temel alınmıştır;
projenin asıl sahibi ve ana geliştiricisi DD:YZ (Tech Jarves)'tir. Bu çatal leaykan (https://github.com/leaykan) ve Claude (Anthropic) tarafından geliştirildi.
`LICENSE` dosyasında yalnızca orijinal telif satırı bulunur. Uygulama tek başına çalışır; kurulum ve kullanım için
hiçbir yapay zekâ asistanı ya da hesap gerekmez (bulut modelleri isteğe bağlıdır, aşağıya bakın).

- Orijinal proje (V1): https://github.com/DDYapayZeka/SansursuzLokalAIStudyosu-DDYZ
- Orijinal proje (V2): https://github.com/DDYapayZeka/SansursuzLokalAIStudyosu-V2
- Orijinal temel: Tech Jarves (MIT)

Aşağıdaki bileşenler depoyla **dağıtılmaz**; kurulum betikleri, ilk kurulum sihirbazı ya da Model Yöneticisi
kullanıcı istediğinde ilgili sitelerden **ayrıca indirir**. Her birinin lisansı kendi sahibine aittir.
**"Ticari olmayan"** işaretli olanlar yalnızca kişisel / ticari olmayan kullanım içindir; ürettiğiniz içeriği
ticari amaçla kullanmadan önce ilgili model sayfasını okuyun.

Son doğrulama: Kasım 2026, Hugging Face model sayfaları ve PyPI üzerinden. Lisanslar zamanla değişebilir; kesin bilgi her zaman model sayfasındadır.

## DD:YZ V2'den uyarlanan kısımlar (MIT)
- Müzik ve Ses Efekti Stüdyosu, Video Stüdyosu sayfaları ve işçileri (`MuzikStudyosu.jsx`, `VideoStudyosu.jsx`, `muzik_efekt.py`, `video_uret.py`, `studyo.cjs`)
- Seda / Duyu ses tanıma işçileri, Türkçe ses motorlarının profil adları, bulut sağlayıcı yaklaşımı, donanıma göre öneri fikri

## İlk kurulum sihirbazının denenmiş varsayılan seti
Sihirbaz bu modelleri önceden seçili getirir (alternatifler aşağıdaki bölümlerde). Tek dosyalı modeller sabit commit'ten iner ve SHA256 ile doğrulanır.

| Model | Kaynak | Lisans |
|---|---|---|
| Gemma 4 E4B (Q4_K_M GGUF) — alternatif E2B | Google; GGUF: `unsloth/gemma-4-E4B-it-GGUF`, `unsloth/gemma-4-E2B-it-GGUF` | Apache-2.0 |
| Whisper small q5_1 — alternatif base / medium / large-v3 turbo | `ggerganov/whisper.cpp` (OpenAI Whisper ağırlıkları) | MIT |
| EMA Lightning (Türkçe ses) | `ema-lightning` (PyPI) / `canberkkkkkk/ema-lightning` | Apache-2.0 (sentetik tek konuşmacılı veriyle eğitilmiş; gerçek bir kişinin sesi değildir) |
| CyberRealistic V8 (SD 1.5) | `cyberdelia/CyberRealistic` | CreativeML OpenRAIL-M (kullanım kısıtları geçerli) |
| MusicGen Small | `facebook/musicgen-small` | **CC BY-NC 4.0 (ticari olmayan)** |
| AudioLDM-S Full v2 | `cvssp/audioldm-s-full-v2` | **CC BY-NC-SA 4.0 (ticari olmayan)** |
| AnimateDiff hareket adaptörü v1.5 v2 | `guoyww/animatediff-motion-adapter-v1-5-2` | Apache-2.0 |

Görsel alternatifleri: Juggernaut XL v9 Lightning (`RunDiffusion/Juggernaut-XL-Lightning`, CreativeML OpenRAIL++-M),
DreamShaper 8 (`Lykon/DreamShaper`, CreativeML OpenRAIL-M), DreamShaper XL Lightning (`Lykon/dreamshaper-xl-lightning`, CreativeML OpenRAIL++-M).

## Ses tanıma (sesten metne)
| Bileşen | Kaynak | Lisans |
|---|---|---|
| whisper.cpp ve Whisper modelleri | `ggerganov/whisper.cpp`, OpenAI | MIT |
| Seda-v0.2 | `atasoglu/seda-v0.2` | CC BY-SA 4.0 (türev dağıtımda aynı lisans) |
| Duyu-small | `KaanAydinli/Duyu-small` | Apache-2.0 |

## Seslendirme (metinden sese)
| Bileşen | Kaynak | Lisans |
|---|---|---|
| EMA Lightning | `ema-lightning` (PyPI) | Apache-2.0 |
| Antalia-2 Mini | `cloud0day3/antalia-mini` | Apache-2.0 (kod, metin normalleştirici ve ağırlıklar; LICENSE ve NOTICE korunur; `cmudict` BSD) |
| Supertonic-3 | `Supertone/supertonic-3` | Örnek kod MIT; ağırlıklar OpenRAIL-M (kullanım kısıtları geçerli) |
| Ahenk Cep | `ozgurguler/ahenk-cep-tr`, `trnorm` | Ağırlıklar CC BY 4.0 (atıf zorunlu); çıkarım kodu Apache-2.0 |
| OmniVoice | `k2-fsa/OmniVoice` | Kod Apache-2.0; **model CC BY-NC (ticari olmayan)** |
| Kokoro 82M | `hexgrad/Kokoro-82M`, `onnx-community/Kokoro-82M-v1.0-ONNX` | Apache-2.0 |
| Piper | `rhasspy/piper` ve ses modelleri | Program MIT; her sesin kendi lisansı vardır (ses modelinin `MODEL_CARD` dosyasına bakın) |

Ses klonlama (OmniVoice): yalnızca sesin sahibinin açık izniyle kullanın. Klon örnekleri yalnızca sizin bilgisayarınızda saklanır.

## Müzik, ses efekti, video
| Bileşen | Kaynak | Lisans |
|---|---|---|
| MusicGen Small | `facebook/musicgen-small` | Ağırlıklar **CC BY-NC 4.0 (ticari olmayan)**; kod MIT |
| AudioLDM-S Full v2 | `cvssp/audioldm-s-full-v2` | **CC BY-NC-SA 4.0 (ticari olmayan)** |
| AnimateDiff hareket adaptörü | `guoyww/animatediff` | Apache-2.0 |
| Wan 2.1 T2V 1.3B | `Wan-AI/Wan2.1-T2V-1.3B` | Apache-2.0 |
| Stable Diffusion 1.5 yapılandırmaları | — | CreativeML OpenRAIL-M |

## Görsel hızlandırıcılar (hızlı mod)
| Bileşen | Kaynak | Lisans |
|---|---|---|
| LCM-LoRA SD 1.5 | `latent-consistency/lcm-lora-sdv1-5` | OpenRAIL++ |
| Hyper-SD | `ByteDance/Hyper-SD` | **Depoda lisans etiketi yok** — kullanım koşulları belirsiz; ticari kullanımda kaçının ya da sahibine danışın |
| RealESRGAN (büyütme) | `xinntao/Real-ESRGAN` | BSD-3-Clause |
| TAESD | `madebyollin/taesd` | MIT |

## Metin ve görsel motorları
| Bileşen | Lisans |
|---|---|
| llama.cpp | MIT |
| stable-diffusion.cpp | MIT |
| Node.js (taşınabilir) | MIT ve bileşen lisansları |
| Python (taşınabilir, python.org gömülü sürüm) | PSF License |
| PyTorch | BSD-3-Clause |
| Diğer görsel modelleri (Model Yöneticisi'nden indirilenler) | Her modelin kendi lisansı (çoğu CreativeML OpenRAIL-M / OpenRAIL++-M türevi) |

## Bulut sağlayıcıları (isteğe bağlı)
OpenAI, Google Gemini, Anthropic ve OpenRouter yalnızca resmî API'leri üzerinden, kullanıcının **kendi** API anahtarıyla kullanılır.
Uygulamaya hiçbir anahtar gömülü değildir. Anahtar yalnızca kullanıcının bilgisayarında saklanır (Windows'ta DPAPI ile şifreli) ve arayüze geri gönderilmez.
Bulut isteklerinde sağlayıcının kullanım koşulları ve içerik kuralları geçerlidir.

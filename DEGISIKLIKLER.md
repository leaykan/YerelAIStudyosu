# Değişiklikler

Bu belge, **Yerel AI Stüdyosu**'nun temel aldığı DD:YZ "Sansürsüz Lokal AI Stüdyosu" (V1, ardından V2) sürümüne göre
neleri değiştirdiğini özetler. Bu çatal leaykan ve Claude (Anthropic) tarafından geliştirildi (Eylül–Kasım 2026); asıl sahip ve ana geliştirici DD:YZ (Tech Jarves)'tir.
Orijinal geliştirici bu değişiklikleri dilediği gibi kullanabilir.

## 1.0.0 — ilk herkese açık sürüm (hazırlanıyor)

### Kimlik
- Ad "Yerel AI Stüdyosu" oldu; DD:YZ adı, orijinal telif satırı ve atıflar korundu (`LICENSE`, `ATIFLAR.md`, açılış ekranları).
- Arayüzün tamamı Türkçe; açılış sayfası Metin Sohbeti, sol menüde Görsel Stüdyo sohbetin hemen altında.

### Kullanıcılar, güvenlik ve kişisel hafıza
- İlk açılışta yönetici hesabı zorunlu; yönetici kullanıcı ekler, siler (sohbet, hafıza ve üretimleriyle), şifre sıfırlar, yönetici atar; son yönetici korunur.
- Her açılışta ve 15 dk hareketsizlikte yeniden giriş; oturum çerezi HttpOnly + SameSite=Strict; hatalı giriş sınırı; kullanıcı varken sunucu uç noktaları oturum ister.
- Sohbet geçmişi, üretimler (görsel, müzik, video, ses, döküm) ve kişisel hafıza kullanıcıya özel; başkasının dosyası görülemez, indirilemez, silinemez.
- Kişisel hafıza: tam ad ve hitap şekli ayrı tutulur; "unutma / hatırla" denen bilgi anında not olur; sohbetler yerel modelle kısa notlara özetlenir; notlar Ayarlar'dan düzenlenir; buluta varsayılan olarak gitmez.
- Çıkış düğmesi sohbeti kaydeder ve sohbet modelini bellekten çıkarır. Model yüklenince ve girişte sistem mesajı önceden işlenir (ilk yanıt hızlanır).
- Arka plandaki görsel işi durdurulabilir; uygulama kapanırken yarım kalan iş açılışta sorulur, kendiliğinden başlamaz.

### Vega — sohbet asistanı
- Yerel sohbet asistanının adı **Vega**; sistem mesajı Ayarlar'dan değiştirilebilir (varsayılanı genel bir metin).
- **Araç kullanımı**: Vega yalnızca gerektiğinde kendisi araç çağırır — `web_ara` (Web açıkken), `hesapla`, `saat`; bugünün tarihini bilir.
  Arama türünü (haber/genel), zamanı ve dili model seçer; haberlerde Google Haberler + DuckDuckGo; sabit "ABD/İngilizce" bölge kaldırıldı;
  arama sonuçları kısaltıldı (gündem özeti ~1 dk).
- **Sohbetten üretim**: görsel (istek → model seçimi → tarif → üretim → sohbete getirme), müzik, ses efekti ve video.
  Bellek tek büyük modele yettiği için görselde sıralı çalışma: Vega bellekten çıkar, görsel üretilir, Vega aynı ayarlarla geri yüklenir.
- Önerilen sohbet modeli **Gemma 4 E4B** (Türkçesi Qwen2.5-3B'den belirgin şekilde iyi).

### Sesli sohbet
- Konuşma tanıma sohbete bağlandı: konuşma yazı kutusuna dökülür, düzeltip Enter ile gönderilir.
- **Eller serbest** modu (Enter'sız otomatik gönderim), yanıtların otomatik sesli okunması (kapatılabilir), her yanıtta tekrar okuma düğmesi,
  model konuşurken mikrofonun beklemesi, sesin dile göre otomatik seçimi.
- Varsayılan konuşma tanıma modeli **Whisper small q5_1** (190 MB; Türkçe doğruluğu aynı, belirgin şekilde hızlı).

### Ses motorları
- **EMA Lightning** Türkçe seslendirme (doğru telaffuz); "Ses motoru" seçimi.
- V2'den uyarlanan **Seda** ve **Duyu** (ses tanıma), **Antalia-2 Mini, Supertonic-3, Ahenk Cep, OmniVoice** (seslendirme).
  Bu çatalda: Python paketleri **sabit sürümlerle ve yalnızca hazır paket (wheel)** olarak kurulur, model ağırlıkları sabit commit'lerden iner,
  OmniVoice gereksinimleri özet (hash) doğrulamalıdır; kurulum düğmeleri Model Yöneticisi › Metinden Sese › Türkçe Ses Motorları'nda.
- Model sayfasında "Sesten Metne" / "Metinden Sese" başlıkları, etkin model etiketi ve kalıcı seçim; seçim tüm sayfalarda ortak.

### Görsel
- **Arayüz baştan tasarlandı**: adım, CFG, örnekleyici, çözünürlük, seed, negatif istem gibi ayarlar Ayarlar'dan Görsel Stüdyo'ya taşındı;
  seçili modele göre kendiliğinden gelir, modelde kullanılamayan ayarlar nedeniyle birlikte soluk gösterilir, aralıklar modele göre daralır.
- **Hızlı mod** (yalnızca SD 1.5): LCM (5 adım), Hyper-SD (4/8 adım) — işlemcide görsel başına ~10 dk yerine ~3 dk.
- RealESRGAN büyütme; highres fix ölçüldü ve işlemcide kullanılamaz bulundu (ikinci difüzyon geçişi yerine yalnızca büyütme önerilir).
- "Sansürsüz" model etiketi; tam ekran görsel; ekran kayması düzeltmesi.

### V2'den uyarlanan stüdyolar
- **Müzik ve Ses Efekti Stüdyosu** (MusicGen Small, AudioLDM-S) — hem kendi sayfasından hem Vega'dan (`muzik_uret`, `efekt_uret`).
  Pickle tabanlı büyük modeller (MusicGen Medium/Large) bilerek dışarıda bırakıldı.
- **Video Stüdyosu** (AnimateDiff + kullanıcının SD 1.5 modeli, Wan 2.1 1.3B) — Vega aracı `video_uret`; işler ayrı süreçte çalışır,
  zaman aşımı ya da bellek hatası sunucuyu çökertmez; yetersiz donanımda "önerilmez" uyarısı.
- **Bulut modelleri** — yalnızca resmî API'ler ve kullanıcının kendi anahtarı; anahtar Windows DPAPI ile şifreli, arayüze asla geri gönderilmez;
  Gemini anahtarı adres satırında değil başlıkta; Vega kendiliğinden buluta geçmez; yerel model yüklenince bulut seçimi bırakılır.

### Otomasyon kuyruğu (isteğe bağlı, gelişmiş)
- `app/is-kuyrugu/` — klasöre bırakılan JSON iş dosyalarıyla tarayıcısız görsel üretimi; stil ön ayarları, img2img, LoRA, hızlı mod,
  arka plan silme, kırpma, çoklu boyut ve `.ico` üretimi, önizleme tablosu, indirme işleri. Kullanıcı önceliklidir (arayüz kullanılırken bekler).
  Herhangi bir betik ya da zamanlanmış görev kullanabilir; hiçbir harici araca bağlı değildir, klasöre iş yazan bir şey yoksa boşta bekler.
  Çıktılar `app/outputs/kuyruk-isleri/`. Sohbetten istenen görseller de bu kuyrukta üretilir.
- `scripts/araclar/gorsel-isle.cjs` — sunucusuz PNG son işleme.

### Kurulum ve yayın
- **`Kurulum.bat`** — tek dosyalık Windows kurulumu: bu bilgisayara ya da USB'ye (taşınabilir sürücüleri listeler, boş alanı denetler,
  FAT32 4 GB sınırı için uyarır), son sürümü GitHub'dan indirir, **SHA256** ile doğrular, zip-slip korumalı açar, masaüstü kısayolu ekler,
  `windows.bat`'ı başlatır; aynı klasöre yeniden kurulum güncelleme olur (modeller ve ayarlar korunur).
- **İlk kurulum sihirbazı** — donanım özeti (tümleşik ekran kartının paylaşımlı belleği VRAM sayılmaz); **"Önerilen modeller"** adımında
  denenmiş varsayılan set önceden seçili (Gemma 4 E4B Q4_K_M, Whisper small q5_1, EMA, CyberRealistic V8, MusicGen Small, AudioLDM-S,
  AnimateDiff), alternatifler altında seçilmemiş (Gemma 4 E2B; Seda, Duyu, diğer Whisper boyutları; Antalia, Supertonic, Ahenk, Piper, Kokoro,
  OmniVoice "ağır"; Juggernaut XL Lightning, DreamShaper 8 / XL Lightning; Wan 2.1 "ağır"). Her kartta "Bu bilgisayarda" notu,
  güçlü donanımda "güçlü bilgisayarınız için" vurgusu, toplam indirme ve disk denetimi. Kurulum uygulamanın mevcut indiricileriyle yapılır;
  tek dosyalı modeller sabit commit + SHA256 doğrulamalı. "Yapay zekânız" adımı; Ayarlar'dan yeniden açılabilir.
- **`scripts/yayin/disa-aktar.cjs`** — çalışma kopyasından temiz yayın kopyası ve sürüm zip'i; izin listesi (modeller, motorlar,
  önbellekler, kullanıcı verileri, yedekler, yama klasörleri, günlükler dışarıda), yayın dönüşümleri, gizli bilgi / kişisel yol / e-posta /
  kişisel ad / kişisel veri dosyası / yapay zekâ asistanına özgü kalıntı taraması (dosya adları ve ikili dosyalar dahil; bulguda durur).
  Kişisel adlar betiğe yazılmaz, çalışma anında verilir (`--isim`, `--isimler-dosyasi`, `YAS_OZEL_ISIMLER`); yayın paketi için ad listesi zorunlu.
  GitHub deposu `Kurulum.bat`'taki tek `$Repo` satırında; README göreli bağlantı kullanır. Yer tutucu dururken yalnızca `--deneme` paketi üretilir.
- Uygulama hiçbir yapay zekâ asistanı olmadan kurulur ve çalışır; kurulum asistana özgü hiçbir klasör oluşturmaz, geliştirici notları
  ve asistana özgü dosyalar yayına girmez. Sohbetten görselin varsayılan modeli sihirbazın denenmiş modelidir (dosya adında önek gerekmez).
- `windows.bat` arayüz kaynakları derlemeden yeniyse açılışta kendiliğinden derler; sunucu kendini yeniden başlatabilir.

### Güvenlik
- Orijinal projenin 25 Ekim güvenlik güncellemeleri taşındı (web araması sertleştirme, Node.js v22.23.4, Vite 8.3.5).
- Sunucu yalnızca yerel isteklere yanıt verir; başka sitelerden gelen API istekleri (`Sec-Fetch-Site: cross-site`) ve çerçeveye gömme
  (`X-Frame-Options: DENY`, `frame-ancestors 'none'`) reddedilir; model indirmeleri yalnızca `https://`.
- Taşınabilir Python indirmesi özetle doğrulanır; pip kurulumları sabit sürümlü ve yalnızca hazır paket.

## Bilinen sorunlar ve sıradakiler
- Yarım kalan büyük indirmeler baştan iner (HTTP Range ile kaldığı yerden devam planlandı).
- EMA ses modeli ve Kokoro ağırlıkları kendi kütüphanelerinin ilk çalıştırmasında iner (sabit commit/özet yok); Python paketleri sabit
  sürümlü ama (OmniVoice dışında) özet doğrulamasız.
- Linux ve macOS betikleri Windows kadar denenmedi; EMA ve Python tabanlı ses motorlarının otomatik kurulumu yalnızca Windows'ta.
- Ekran kartı olmadan her şey çalışır ama yavaştır: i5-7200U'da SD 1.5 görsel ~10 dk (hızlı modda ~3 dk), en düşük ayarlarla 1 saniyelik video ~22 dk.
  Video ve OmniVoice ekran kartlı bilgisayarlarda henüz yeterince denenmedi.
- İki dilli arayüz (Türkçe / İngilizce) henüz yok.

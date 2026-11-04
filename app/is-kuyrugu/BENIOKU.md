# Otomasyon kuyruğu (isteğe bağlı, gelişmiş)

> **Normal kullanımda bu klasöre dokunmanız gerekmez.** Uygulama bu kuyruk olmadan da eksiksiz çalışır ve hiçbir harici araca
> bağlı değildir; kuyruk, isteyenlerin kendi betikleriyle toplu görsel işi yaptırabilmesi için genel, dosya tabanlı bir arayüzdür.
> Klasöre iş dosyası yazan bir şey yoksa sunucu yalnızca boş klasörü birkaç saniyede bir yoklar, başka hiçbir şey yapmaz.
> Alt klasörleri silmeniz de sorun çıkarmaz; sunucu açılışta boş halleriyle yeniden oluşturur.

Sunucu (`scripts/server/serve.cjs`) çalışırken `bekleyen/` klasörüne konan her `.json` iş dosyasını sırayla işler. Tarayıcı veya arayüz gerekmez.
Herhangi bir otomasyon aracı kullanabilir: kendi yazdığınız bir betik (PowerShell, Python, Node.js…), Windows Görev Zamanlayıcı'daki
zamanlanmış bir görev ya da dosya yazabilen başka bir program. Uygulamanın kendi sohbet asistanı Vega da sohbetten istenen görselleri bu kuyrukta ürettirir.

Kuyruk yalnızca yerel dosya sistemiyle çalışır; ağdan iş kabul etmez. Klasöre yazabilen her program iş (görsel ya da indirme) ekleyebilir;
bu yüzden uygulama klasörünü paylaşımlı/ağ sürücüsüne koymayın ve yalnızca güvendiğiniz programların bu klasöre yazmasına izin verin.

En basit örnek (PowerShell, uygulama klasöründe):

```powershell
'{"ad": "deneme", "prompt": "a lighthouse at sunset, oil painting"}' | Set-Content -Encoding UTF8 app\is-kuyrugu\bekleyen\deneme.json
```

## Akış

1. `bekleyen/` içine bir iş dosyası yazılır (ör. `2026-01-15-deniz-feneri.json`). İşler dosya adına göre alfabetik sırayla alınır.
2. Sunucu işi `calisan/` klasörüne taşır, üretir.
3. Bitince iş `tamamlanan/` klasörüne, `sonuc` alanıyla birlikte yazılır. Hata olursa `hatali/` klasörüne, `hata` alanıyla yazılır.
4. Çıktılar `app/outputs/kuyruk-isleri/<ad>/` altına kaydedilir (eski sürümlerin farklı adlı klasöründeki dosyalar yerinde kalır). Galeriye karışmazlar (`"galeri": true` verilirse ana görsel galeriye `kuyruk-<ad>.png` olarak da kopyalanır).
5. Anlık durum her 2–3 saniyede `durum.json` dosyasına yazılır: çalışan iş, aşama, adım, motor durumu, kuyruk.
6. Yeni sunucu kodu gerektiren işler `yeniden-baslatinca/` klasörüne konur; sunucu bir sonraki açılışta onları `bekleyen/` klasörüne taşır.
7. İsteğe bağlı: `yeniden-baslat.istek` adlı boş bir dosya konursa sunucu boşta olduğunda (kuyruk, üretim, indirme, kurulum yokken) kendini yeniden başlatır. Sunucu dosyalarını kendi betikleriyle güncelleyenler içindir; dosya konmadıkça hiçbir şey olmaz.

`bekleyen/`, `calisan/`, `tamamlanan/`, `hatali/`, `durum.json` ve `motor-gunlugu.txt` çalışma zamanı dosyalarıdır; depoya girmez (`.gitignore`), dışa aktarımda da kopyalanmaz.

## Kullanıcı önceliklidir

- Arayüzden üretim yapılırken veya model yüklenirken kuyruk bekler.
- Kullanıcı son 10 dakika içinde arayüzden üretim yaptıysa iş, modeli değiştirmek gerekiyorsa bekler.
- Kullanıcı bir iş sürerken arayüzden motoru yeniden başlatırsa iş kesilir ve kuyruğa geri alınır (en fazla 3 deneme).

## İş dosyası alanları

Yalnızca `prompt` zorunludur.

| Alan | Açıklama | Varsayılan |
|---|---|---|
| `ad` | Çıktı klasörü ve dosya adı öneki | iş dosyasının adı |
| `model` | `app/models` içindeki dosya adı | yüklü model |
| `stil` | `stiller.json` içindeki ön ayar (prompt önek/sonek + negatif) | yok |
| `prompt` | İngilizce tarif | — |
| `negatif` | İstenmeyenler (İngilizce) | "" |
| `genislik`, `yukseklik` | Piksel; 64'ün katına yuvarlanır | SD1.5: 512, SDXL: 1024 |
| `adim` | Adım sayısı | Lightning: 4, SD1.5: 20, SDXL: 30 |
| `cfg` | Prompt'a bağlılık | Lightning: 1.5, diğer: 7 |
| `ornekleyici`, `zamanlayici`, `clipSkip` | Motor ayarları | euler_a, model varsayılanı, 0 |
| `seed` | Başlangıç seed'i; `adet` > 1 ise seed, seed+1, … | rastgele |
| `adet` | Kaç varyasyon (1–16) | 1 |
| `baslangicGorseli`, `donusum` | img2img: `is-kuyrugu/` veya `outputs/` altına göre yol; dönüşüm gücü 0.05–1 | yok, 0.6 |
| `hizli` | Hızlı mod (yalnızca SD1.5): `"lcm"` (5 adım), `"hyper4"` (4 adım), `"hyper8"` (8 adım) ya da `true` (= lcm). Hızlandırıcı LoRA eklenir, cfg 1 olur; `adim`/`cfg`/`ornekleyici` verilirse onlar geçerlidir. Arayüz ayarlarını etkilemez | yok |
| `lora` | Ek LoRA'lar: `["ad"]` veya `[{"ad": "x", "guc": 0.8}]` (`app/loras` içinde) | [] |
| `buyut` | ESRGAN ile 4 kat büyüt (`-x4.png`) | false |
| `arkaPlanSil`, `tolerans`, `kazanc` | `true`: kenarlardan düz arka planı şeffaf yap (prompt'ta düz arka plan istenmeli). `"parlaklik"`: siyah zemindeki parlayan çizimlerde parlaklığı alfaya çevir; koyu arayüzlerde ışık gibi durur, gölgeli nesnelerde kullanma. Çıktı `-seffaf.png` | false, 32, 1.25 |
| `kirp`, `bosluk` | Görünür içeriğe kırpıp kare tuvale ortala | false, 0.06 |
| `boyutlar` | Ek boyutlar, ör. `[256, 128, 64, 32]` (`-256.png` …) | [] |
| `ico` | 256 ve altındaki kare boyutlardan `.ico` üret | false |
| `onizlemeTablosu`, `tabloHucre` | Numaralı ızgara (`<ad>-tablo.png`); `adet` > 1 ise her zaman üretilir | false, 256 |
| `galeri` | Ana görseli uygulama galerisine de kopyala | false |

## Örnek

```json
{
  "ad": "deniz-feneri-ikonu",
  "model": "CyberRealistic_V8_FP16.safetensors",
  "stil": "duz-ikon",
  "prompt": "a lighthouse inside a rounded square app icon",
  "adet": 4,
  "hizli": "hyper8",
  "arkaPlanSil": true,
  "kirp": true,
  "boyutlar": [512, 256, 128, 64, 32],
  "ico": true
}
```

## Sunucusuz son işleme

Var olan bir PNG'yi yeniden işlemek için sunucu gerekmez:

```
node scripts/araclar/gorsel-isle.cjs <girdi.png> --arka-plan duz|parlaklik --kirp --boyutlar 256,128,64,32 --ico --cikti <klasor>
node scripts/araclar/gorsel-isle.cjs --tablo <cikti.png> <g1.png> <g2.png> ...
```

## Ölçülen süreler (i5-7200U, Intel HD 620 tümleşik, 16 GB, Vulkan)

- SDXL Lightning (q8_0 GGUF), 1024×1024, 4 adım: adım başına ~174 sn, VAE çözme ~7 dk; toplam ~19,5 dk.
- SD 1.5, 512×512, 20 adım: adım başına ~30 sn; toplam ~10 dk.
- ESRGAN 4x büyütme (512 → 2048): ~70 sn.
- Hızlı mod, SD 1.5 (DreamShaper 8, q8_0), 512×512, adım başına ~12,5 sn (cfg 1): LCM 5 adım ~2,5 dk, Hyper 4 adım ~2,2 dk, Hyper 8 adım ~3,2 dk (normal 20 adım ~9,5 dk).
- Öneri: kalite için `"hizli": "hyper8"`, hızlı taslak için `"hyper4"`. LCM daha sade ve yumuşak çıkıyor, ayrıntı az.

Ekran kartlı bir bilgisayarda bu süreler saniyeler mertebesine iner.

## İndirme işi

```json
{"tur": "indir", "hedef": "metin" | "gorsel" | "konusma" | "lora", "dosyalar": [{"url": "https://huggingface.co/...", "dosya": "x.safetensors"}]}
```

Yalnızca `https://` adresleri kabul edilir; dosya adı klasör dışına çıkamaz. Yalnızca güvendiğiniz kaynaklardan model indirin.

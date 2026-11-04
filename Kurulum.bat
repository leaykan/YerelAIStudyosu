<# :
@echo off
rem ==========================================================================
rem  Yerel AI Studyosu - Kurulum (tek dosya: once Windows komut istemi, sonra PowerShell)
rem  Bu dosyayi indirip cift tiklayin. Uygulamanin son surumunu GitHub'dan indirir,
rem  ozetini (SHA256) dogrular, secilen yere acar ve windows.bat ile ilk kurulumu baslatir.
rem  Yonetici izni gerekmez; bilgisayara program kurulmaz, her sey secilen klasordedir.
rem
rem  Yerel paket (internetsiz / test kurulumu): bu dosyanin yaninda YerelAIStudyosu-*.zip
rem  ve SHA256SUMS.txt varsa indirme yerine onlar kullanilir. Zip'in yolu ilk arguman olarak
rem  da verilebilir (zip'i bu dosyanin uzerine surukleyip birakmak ayni isi yapar):
rem      Kurulum.bat "<zip dosyasinin tam yolu>"
rem ==========================================================================
setlocal
chcp 65001 >nul
title Yerel AI Studyosu - Kurulum
set "YAS_KURULUM_BAT=%~f0"
set "YAS_YEREL_PAKET=%~1"
set "YAS_KURULUM_PS1=%TEMP%\YerelAIStudyosu-kurulum-%RANDOM%%RANDOM%.ps1"
rem PowerShell 5.1 BOM'suz dosyayi ANSI okur; Turkce metinler bozulmasin diye UTF-8 (BOM'lu) kopya calistirilir
powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText($env:YAS_KURULUM_PS1, [IO.File]::ReadAllText($env:YAS_KURULUM_BAT, [Text.Encoding]::UTF8), (New-Object Text.UTF8Encoding $true))"
if errorlevel 1 (
    echo.
    echo  [HATA] PowerShell calistirilamadi. Windows 10 veya 11 gereklidir.
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%YAS_KURULUM_PS1%"
set "YAS_KOD=%ERRORLEVEL%"
del "%YAS_KURULUM_PS1%" >nul 2>nul
if not "%YAS_KOD%"=="0" pause
exit /b %YAS_KOD%
#>

# ============================================================================
# PowerShell bölümü (Windows PowerShell 5.1 ile uyumlu)
# ============================================================================
$ErrorActionPreference = 'Stop'

# --- Ayarlar ---------------------------------------------------------------
# GitHub deposu (sahip/ad). Depo taşınırsa ya da çatallanırsa yalnızca bu satır değişir.
# >>> YAYINDAN ÖNCE DOLDURULACAK: depo sahibi henüz belirlenmedi; 'HESAP' yer tutucudur. <<<
# Yer tutucu dururken scripts/yayin/disa-aktar.cjs yayın paketi üretmez (yalnızca --deneme ile yerel deneme paketi);
# yayında "--depo <sahip>/YerelAIStudyosu" verilirse bu satır yalnızca dışa aktarılan kopyada doldurulur.
$Repo = 'leaykan/YerelAIStudyosu'
$RepoYerTutucu = ($Repo -like 'HESAP/*')
$RepoDegisti = $false
if ($env:YAS_REPO -and $env:YAS_REPO -ne $Repo) { $Repo = $env:YAS_REPO; $RepoDegisti = $true }
$PaketOneki = 'YerelAIStudyosu'          # sürüm paketlerinin adı: YerelAIStudyosu-<sürüm>.zip
$VarsayilanKlasorAdi = 'YerelAIStudyosu' # kurulum klasörünün önerilen adı (kullanıcı değiştirebilir)
$EnAzBosGB = 3        # uygulama + motorlar (modeller hariç)
$OnerilenBosGB = 25   # başlangıç modelleriyle birlikte rahat kullanım

try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try {
    $tls12 = [Enum]::ToObject([Net.SecurityProtocolType], 3072)
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor $tls12
} catch {}

function Yaz   { param([string]$m, [string]$renk = 'Gray') Write-Host $m -ForegroundColor $renk }
function Tamam { param([string]$m) Write-Host "   OK  $m" -ForegroundColor Green }
function Bilgi { param([string]$m) Write-Host "   >>  $m" -ForegroundColor Cyan }
function Uyari { param([string]$m) Write-Host "   !!  $m" -ForegroundColor Yellow }
function Hata  { param([string]$m) Write-Host "   XX  $m" -ForegroundColor Red }

function Sor {
    param([string]$Soru, [string]$Varsayilan = '')
    $ek = ''
    if ($Varsayilan -ne '') { $ek = " [$Varsayilan]" }
    $c = Read-Host "  $Soru$ek"
    if ([string]::IsNullOrWhiteSpace($c)) { return $Varsayilan }
    return $c.Trim()
}

function EvetMi {
    param([string]$Soru, [bool]$Varsayilan = $true)
    $v = 'h'
    if ($Varsayilan) { $v = 'E' }
    $c = Sor "$Soru (E/H)" $v
    return ($c -match '^(e|evet|y|yes)$')
}

function GBYaz { param([double]$bayt) return ('{0:N1} GB' -f ($bayt / 1GB)) }

function BosAlan {
    param([string]$Yol)
    $kok = [IO.Path]::GetPathRoot($Yol)
    try { return (New-Object IO.DriveInfo($kok)) } catch { return $null }
}

# Klasör adı Windows'ta geçerli mi? Geçerliyse $null, değilse Türkçe hata metni döner.
function KlasorAdiHatasi {
    param([string]$Ad)
    if ([string]::IsNullOrWhiteSpace($Ad)) { return 'Klasör adı boş olamaz.' }
    if ($Ad.Length -gt 80) { return 'Klasör adı en fazla 80 karakter olabilir.' }
    if ($Ad -match '[\\/:*?"<>|\x00-\x1F]') { return 'Klasör adında şu karakterler kullanılamaz: \ / : * ? " < > |' }
    if ($Ad -match '^\s|[\s.]$') { return 'Klasör adı boşlukla başlayamaz, nokta ya da boşlukla bitemez.' }
    $govde = ($Ad -split '\.')[0].Trim()
    if ($govde -match '^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9]|LPT[0-9])$') { return "'$Ad' Windows'ta ayrılmış bir addır; başka bir ad seçin." }
    return $null
}

# Tam klasör yolu geçerli mi? (sürücü harfiyle başlamalı; her parça geçerli bir klasör adı olmalı)
function YolHatasi {
    param([string]$Yol)
    if ([string]::IsNullOrWhiteSpace($Yol)) { return 'Bir klasör yolu yazın.' }
    if ($Yol -notmatch '^[A-Za-z]:\\') { return "Sürücü harfiyle başlayan tam bir yol yazın (ör. D:\$VarsayilanKlasorAdi). Ağ klasörleri desteklenmez." }
    $parcalar = @($Yol.Substring(3).Split('\') | Where-Object { $_ -ne '' })
    if ($parcalar.Count -eq 0) { return "Sürücünün köküne kurulamaz; bir klasör adı ekleyin (ör. D:\$VarsayilanKlasorAdi)." }
    foreach ($p in $parcalar) {
        $h = KlasorAdiHatasi $p
        if ($h) { return "'$p': $h" }
    }
    return $null
}

function AsciiDisiVar { param([string]$s) return ($s -match '[^\x20-\x7E]') }

function KlasorAdiSor {
    for ($deneme = 1; $deneme -le 5; $deneme++) {
        $ad = (Sor 'Klasör adı (yoksa oluşturulur)' $VarsayilanKlasorAdi).Trim('"').Trim()
        $h = KlasorAdiHatasi $ad
        if (-not $h) { return $ad }
        Hata $h
    }
    throw 'Geçerli bir klasör adı girilmedi.'
}

function Indir {
    param([string]$Url, [string]$Hedef, [string]$Etiket)
    Bilgi "İndiriliyor: $Etiket"
    for ($deneme = 1; $deneme -le 3; $deneme++) {
        $yanit = $null; $akis = $null; $cikis = $null
        try {
            $istek = [Net.HttpWebRequest]::Create($Url)
            $istek.UserAgent = 'YerelAIStudyosu-Kurulum'
            $istek.Timeout = 300000
            $istek.ReadWriteTimeout = 300000
            $yanit = $istek.GetResponse()
            $toplam = [long]$yanit.ContentLength
            $akis = $yanit.GetResponseStream()
            $cikis = [IO.File]::Create($Hedef)
            $tampon = New-Object byte[] 65536
            $inen = [long]0
            $son = [DateTime]::Now
            while ($true) {
                $n = $akis.Read($tampon, 0, $tampon.Length)
                if ($n -le 0) { break }
                $cikis.Write($tampon, 0, $n)
                $inen += $n
                if (([DateTime]::Now - $son).TotalMilliseconds -ge 400) {
                    $son = [DateTime]::Now
                    if ($toplam -gt 0) {
                        $yuzde = [int](($inen / $toplam) * 100)
                        Write-Host -NoNewline ("`r      %{0,3}  {1:N1} / {2:N1} MB      " -f $yuzde, ($inen / 1MB), ($toplam / 1MB))
                    } else {
                        Write-Host -NoNewline ("`r      {0:N1} MB      " -f ($inen / 1MB))
                    }
                }
            }
            if ($toplam -gt 0 -and $inen -ne $toplam) { throw "İndirme yarıda kesildi ($inen / $toplam bayt)." }
            Write-Host ("`r      Tamamlandı: {0:N1} MB                    " -f ($inen / 1MB)) -ForegroundColor Green
            return
        } catch {
            Write-Host ''
            if ($deneme -lt 3) { Uyari "Deneme $deneme başarısız: $($_.Exception.Message). Yeniden deneniyor..."; Start-Sleep -Seconds (2 * $deneme) }
            else { throw "İndirilemedi: $($_.Exception.Message)" }
        } finally {
            if ($cikis) { $cikis.Close() }
            if ($akis) { $akis.Close() }
            if ($yanit) { $yanit.Close() }
        }
    }
}

function OzetBul {
    # SHA256SUMS.txt biçimi: "<64 hex>  <dosya adı>" (sha256sum çıktısı); tek satırlık .sha256 dosyaları da kabul edilir
    param([string]$Metin, [string]$DosyaAdi)
    foreach ($satir in ($Metin -split "`r?`n")) {
        $s = $satir.Trim()
        if ($s -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
            if ($Matches[2].Trim() -eq $DosyaAdi) { return $Matches[1].ToLower() }
        } elseif ($s -match '^([0-9a-fA-F]{64})$') {
            return $Matches[1].ToLower()
        }
    }
    return $null
}

# Klasördeki sürüm paketini bulur: SHA256SUMS.txt'de adı geçen en yeni zip, yoksa en yeni zip
function PaketAra {
    param([string]$Klasor)
    $zipler = @(Get-ChildItem -LiteralPath $Klasor -Filter "$PaketOneki*.zip" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if ($zipler.Count -eq 0) { return $null }
    $sums = Join-Path $Klasor 'SHA256SUMS.txt'
    if (Test-Path -LiteralPath $sums -PathType Leaf) {
        $metin = [IO.File]::ReadAllText($sums)
        foreach ($z in $zipler) {
            foreach ($satir in ($metin -split "`r?`n")) {
                if ($satir.Trim() -match '^[0-9a-fA-F]{64}\s+\*?(.+)$' -and $Matches[1].Trim() -eq $z.Name) { return $z }
            }
        }
    }
    return $zipler[0]
}

# Paketin SHA256 özetini doğrular. Özet yoksa kullanıcıya sorar (varsayılan: Hayır).
function PaketDogrula {
    param([string]$ZipYolu, [string]$Beklenen, [string]$Kaynak)
    $gercek = (Get-FileHash -LiteralPath $ZipYolu -Algorithm SHA256).Hash.ToLower()
    if ($Beklenen) {
        if ($gercek -ne $Beklenen) {
            Remove-Item -LiteralPath $ZipYolu -Force -ErrorAction SilentlyContinue
            throw "Paketin özeti uyuşmuyor! Beklenen $Beklenen, paketin özeti $gercek. Dosya bozuk ya da değiştirilmiş olabilir; kurulum durduruldu."
        }
        Tamam "SHA256 doğrulandı ($Kaynak)."
    } else {
        Uyari "Doğrulama özeti bulunamadı; paket doğrulanmadan kurulacak. SHA256: $gercek"
        Uyari 'Doğrulanmamış bir paket bilgisayarınızda program çalıştırabilir. Emin değilseniz Enter''a basıp iptal edin ve paketi yalnızca resmî sürüm sayfasından indirin.'
        if (-not (EvetMi 'Doğrulanmamış paketle devam edilsin mi?' $false)) { throw 'Kurulum iptal edildi.' }
    }
}

# Paketin içindeki VERSION dosyasını okur (yoksa boş döner)
function ZipSurumu {
    param([string]$ZipYolu)
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($ZipYolu)
        try {
            foreach ($g in $z.Entries) {
                if ($g.FullName -match '^([^/\\]+[/\\])?VERSION$' -and $g.Length -lt 200) {
                    $okuyucu = New-Object IO.StreamReader($g.Open())
                    try { $s = $okuyucu.ReadToEnd().Trim() } finally { $okuyucu.Close() }
                    if ($s -match '^[0-9A-Za-z][0-9A-Za-z._+-]{0,40}$') { return $s }
                }
            }
        } finally { $z.Dispose() }
    } catch {}
    return ''
}

function Kisayol {
    param([string]$Konum, [string]$Hedef, [string]$Calisma, [string]$Aciklama)
    $kabuk = New-Object -ComObject WScript.Shell
    $k = $kabuk.CreateShortcut($Konum)
    $k.TargetPath = $Hedef
    $k.WorkingDirectory = $Calisma
    $k.Description = $Aciklama
    $k.IconLocation = "$env:SystemRoot\System32\shell32.dll,43"
    $k.Save()
}

function KisayolHedefi {
    param([string]$Konum)
    try { return [string]((New-Object -ComObject WScript.Shell).CreateShortcut($Konum).TargetPath) } catch { return '' }
}

# ============================================================================
Clear-Host
Yaz ''
Yaz '  ============================================================' Cyan
Yaz '    Yerel AI Stüdyosu  |  Kurulum' Cyan
Yaz '    Türkçe öncelikli, tamamen yerel yapay zekâ stüdyosu' DarkCyan
Yaz '    DD:YZ "Sansürsüz Lokal AI Stüdyosu" tabanlı (MIT)' DarkCyan
Yaz '  ============================================================' Cyan
Yaz ''
Yaz '  Bu sihirbaz uygulamanın son sürümünü GitHub''dan (ya da yanındaki yerel paketten)'
Yaz '  alıp seçtiğiniz klasöre kurar. Yönetici izni gerekmez. Modeller şimdi inmez;'
Yaz '  uygulama ilk açıldığında bilgisayarınıza uygun olanları önerir.'
Yaz ''

$tmpKok = $null
try {
    if ([Environment]::OSVersion.Version.Major -lt 10) { throw 'Windows 10 veya 11 gereklidir.' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw '64 bit Windows gereklidir.' }

    $batKonumu = $env:YAS_KURULUM_BAT
    $batKlasoru = ''
    if ($batKonumu) { $batKlasoru = Split-Path -Parent $batKonumu }

    $tmpKok = Join-Path ([IO.Path]::GetTempPath()) ("YerelAIStudyosu-kurulum-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $tmpKok | Out-Null
    $zipYolu = Join-Path $tmpKok 'paket.zip'
    $zipAdi = ''

    # --- 1) Paket: yerel mi, GitHub mı? ----------------------------------------
    $yerelPaket = $null
    $argPaket = [string]$env:YAS_YEREL_PAKET
    if ($argPaket.Trim()) {
        # Kurulum.bat'a argüman olarak (ya da sürükle-bırak ile) bir zip ya da klasör verildi
        $argPaket = $argPaket.Trim().Trim('"')
        if (Test-Path -LiteralPath $argPaket -PathType Container) {
            $yerelPaket = PaketAra $argPaket
            if (-not $yerelPaket) { throw "Verilen klasörde $PaketOneki*.zip bulunamadı: $argPaket" }
        } elseif (Test-Path -LiteralPath $argPaket -PathType Leaf) {
            if ($argPaket -notmatch '\.zip$') { throw "Verilen dosya bir .zip paketi değil: $argPaket" }
            $yerelPaket = Get-Item -LiteralPath $argPaket
        } else {
            throw "Verilen paket bulunamadı: $argPaket"
        }
    } elseif ($batKlasoru) {
        $aday = PaketAra $batKlasoru
        if ($aday) {
            Bilgi "Kurulum dosyasının yanında bir sürüm paketi bulundu: $($aday.Name)"
            if (EvetMi 'İnternetten indirmek yerine bu yerel paket kullanılsın mı?' $true) { $yerelPaket = $aday }
            Yaz ''
        }
    }

    if ($yerelPaket) {
        Yaz '  ------------------------------------------------------------' Magenta
        Yaz '    Yerel paketten kuruluyor (internetten indirme yapılmaz)' Magenta
        Yaz "    Paket: $($yerelPaket.FullName)" Magenta
        Yaz '  ------------------------------------------------------------' Magenta
        $zipAdi = $yerelPaket.Name
        # Doğrulama ve açma kopyadan yapılır: doğrulandıktan sonra asıl dosya değişse bile kurulan, doğrulanan olur
        Copy-Item -LiteralPath $yerelPaket.FullName -Destination $zipYolu -Force
        $beklenenOzet = $null
        $ozetKaynagi = ''
        $sums = Join-Path $yerelPaket.DirectoryName 'SHA256SUMS.txt'
        $tekOzet = "$($yerelPaket.FullName).sha256"
        if (Test-Path -LiteralPath $sums -PathType Leaf) {
            $beklenenOzet = OzetBul ([IO.File]::ReadAllText($sums)) $zipAdi
            $ozetKaynagi = 'yanındaki SHA256SUMS.txt'
            if (-not $beklenenOzet) { Uyari "SHA256SUMS.txt dosyasında $zipAdi için satır yok." }
        }
        if (-not $beklenenOzet -and (Test-Path -LiteralPath $tekOzet -PathType Leaf)) {
            $beklenenOzet = OzetBul ([IO.File]::ReadAllText($tekOzet)) $zipAdi
            $ozetKaynagi = "yanındaki $zipAdi.sha256"
        }
        PaketDogrula $zipYolu $beklenenOzet $ozetKaynagi
    } else {
        if ($RepoYerTutucu -and -not $RepoDegisti) {
            throw "Bu kurulum dosyası yerel deneme sürümüdür: GitHub deposu henüz tanımlı değil (internetten kurulum yapılamaz). Sürüm paketini (YerelAIStudyosu-<sürüm>.zip) ve SHA256SUMS.txt'yi bu dosyanın yanına koyup yeniden çalıştırın."
        }
        if ($RepoDegisti) {
            Uyari "DİKKAT: YAS_REPO ortam değişkeni nedeniyle paket varsayılan depodan değil github.com/$Repo deposundan indirilecek."
            if (-not (EvetMi 'Bu depoya güveniyor musunuz?' $false)) { throw 'Kurulum iptal edildi.' }
        }
        Bilgi "Son sürüm soruluyor: github.com/$Repo"
        $api = "https://api.github.com/repos/$Repo/releases/latest"
        try {
            $surum = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'YerelAIStudyosu-Kurulum'; 'Accept' = 'application/vnd.github+json' } -UseBasicParsing
        } catch {
            throw "GitHub'dan sürüm bilgisi alınamadı ($($_.Exception.Message)). İnternet bağlantınızı kontrol edin ya da depoda yayımlanmış bir sürüm (release) olduğundan emin olun. İnternetsiz kurulum için sürüm zip'ini ve SHA256SUMS.txt'yi bu dosyanın yanına koyun."
        }
        Tamam "Sürüm: $($surum.tag_name)  $($surum.name)"
        $beklenenOzet = $null
        $ozetKaynagi = ''
        $varlik = $surum.assets | Where-Object { $_.name -match "^$PaketOneki.*\.zip$" } | Select-Object -First 1
        if ($varlik) {
            $zipAdi = $varlik.name
            Indir $varlik.browser_download_url $zipYolu $zipAdi
            $ozetVarligi = $surum.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' -or $_.name -eq "$zipAdi.sha256" } | Select-Object -First 1
            if ($ozetVarligi) {
                $ozetDosyasi = Join-Path $tmpKok 'ozet.txt'
                Indir $ozetVarligi.browser_download_url $ozetDosyasi $ozetVarligi.name
                $beklenenOzet = OzetBul ([IO.File]::ReadAllText($ozetDosyasi)) $zipAdi
                $ozetKaynagi = $ozetVarligi.name
            }
        } else {
            Uyari 'Sürümde hazır paket bulunamadı; GitHub''ın kaynak kodu arşivi indirilecek (özet doğrulaması yapılamaz).'
            $zipAdi = "$PaketOneki-$($surum.tag_name).zip"
            Indir $surum.zipball_url $zipYolu 'Kaynak kodu arşivi'
        }
        PaketDogrula $zipYolu $beklenenOzet $ozetKaynagi
    }
    $yeniSurum = ZipSurumu $zipYolu
    if ($yeniSurum) { Bilgi "Paket sürümü: $yeniSurum" }

    # --- 2) Nereye? ----------------------------------------------------------
    $profil = [Environment]::GetFolderPath('UserProfile')
    if (-not $profil) { $profil = $env:USERPROFILE }
    $eskiKonum = ''
    if ($env:LOCALAPPDATA) {
        $aday = Join-Path $env:LOCALAPPDATA $VarsayilanKlasorAdi
        if (Test-Path -LiteralPath (Join-Path $aday 'windows.bat')) { $eskiKonum = $aday }
    }
    Yaz ''
    Yaz '  Nereye kurulsun?' White
    Yaz "    [1] Bu bilgisayara, kullanıcı klasörünüze (önerilen):  $profil\<klasör adı>"
    Yaz '    [2] USB bellek / harici diske (taşınabilir: başka bir Windows bilgisayarda da çalışır)'
    Yaz '    [3] Başka bir klasöre (tam yolunu yazarak)'
    if ($eskiKonum) { Yaz "    [4] Önceki kurulumu güncelle: $eskiKonum" }
    $secim = Sor 'Seçiminiz' '1'
    $usb = ($secim -eq '2')
    $hedef = ''
    $klasorAdi = $VarsayilanKlasorAdi

    if ($secim -eq '4' -and $eskiKonum) {
        $hedef = $eskiKonum
    } elseif ($secim -eq '3') {
        Yaz ''
        $gecerli = $false
        for ($deneme = 1; $deneme -le 5 -and -not $gecerli; $deneme++) {
            $c = (Sor "Tam klasör yolu (ör. D:\$VarsayilanKlasorAdi)" '').Trim('"').Trim()
            $h = YolHatasi $c
            if ($h) { Hata $h } else { $hedef = [IO.Path]::GetFullPath($c); $gecerli = $true }
        }
        if (-not $gecerli) { throw 'Geçerli bir klasör yolu girilmedi.' }
        $klasorAdi = Split-Path -Leaf $hedef
        if (AsciiDisiVar $hedef) {
            Uyari 'Bu yolda Türkçe ya da İngilizce dışı karakter var (ç, ğ, ı, İ, ö, ş, ü...). Bazı yapay zekâ motorları böyle yollardaki dosyaları açamayabilir.'
            if (-not (EvetMi 'Yine de bu yola kurulsun mu?' $true)) { throw 'Kurulum iptal edildi. Yalnızca İngilizce harfler içeren bir yol seçip yeniden deneyin.' }
        }
    } elseif (-not $usb) {
        if ($secim -ne '1') { Uyari "Geçersiz seçim ($secim); önerilen konum kullanılıyor." }
        if (-not $profil) { throw 'Kullanıcı klasörü bulunamadı; [3] ile bir klasör yolu yazın.' }
        Yaz ''
        Yaz "  Kurulum klasörü $profil içinde oluşturulur. Farklı bir ad verebilirsiniz."
        $klasorAdi = KlasorAdiSor
        $hedef = Join-Path $profil $klasorAdi
        if (AsciiDisiVar $hedef) {
            Yaz ''
            Uyari "Kurulum yolunda Türkçe ya da İngilizce dışı karakter var: $hedef"
            Uyari 'Bazı yapay zekâ motorları böyle yollardaki dosyaları açamayabilir.'
            $altAd = $klasorAdi
            if (AsciiDisiVar $altAd) { $altAd = $VarsayilanKlasorAdi }
            $alternatif = Join-Path ($env:SystemDrive.TrimEnd('\') + '\') $altAd
            if (EvetMi "Bunun yerine $alternatif kullanılsın mı?" $true) { $hedef = $alternatif; $klasorAdi = $altAd }
        }
    } else {
        $sistem = $env:SystemDrive.TrimEnd('\').ToUpper()
        $suruculer = @()
        foreach ($d in (Get-CimInstance Win32_LogicalDisk -ErrorAction SilentlyContinue)) {
            $harf = ([string]$d.DeviceID).ToUpper()
            if ($harf -eq $sistem) { continue }
            $tasinabilir = ($d.DriveType -eq 2)
            if ($d.DriveType -eq 3) {
                # Harici USB diskler Windows'ta "sabit disk" görünür; veri yolu USB ise listeye al
                try {
                    $bolum = Get-Partition -DriveLetter $harf.TrimEnd(':') -ErrorAction Stop
                    $disk = $bolum | Get-Disk -ErrorAction Stop
                    if ([string]$disk.BusType -eq 'USB') { $tasinabilir = $true }
                } catch {}
            }
            if ($tasinabilir -and $d.Size) { $suruculer += $d }
        }
        if ($suruculer.Count -eq 0) { throw 'Takılı bir USB bellek ya da harici disk bulunamadı. Sürücüyü takıp kurulumu yeniden başlatın.' }
        Yaz ''
        Yaz '  Bulunan taşınabilir sürücüler:' White
        $i = 0
        $onerilen = '1'
        foreach ($d in $suruculer) {
            $i++
            $etiket = [string]$d.VolumeName
            if (-not $etiket) { $etiket = '(adsız)' }
            $not = ''
            if ($batKlasoru -and $batKlasoru.ToUpper().StartsWith(([string]$d.DeviceID).ToUpper())) { $not = '  <- kurulum dosyası bu sürücüde'; $onerilen = "$i" }
            Yaz ("    [{0}] {1}  {2,-14} {3,-6}  boş {4} / {5}{6}" -f $i, $d.DeviceID, $etiket, $d.FileSystem, (GBYaz $d.FreeSpace), (GBYaz $d.Size), $not)
        }
        $s = Sor 'Hangi sürücü?' $onerilen
        $n = 0
        if (-not [int]::TryParse($s, [ref]$n) -or $n -lt 1 -or $n -gt $suruculer.Count) { throw 'Geçersiz seçim.' }
        $surucu = $suruculer[$n - 1]
        Yaz ''
        $klasorAdi = KlasorAdiSor
        if (AsciiDisiVar $klasorAdi) {
            Uyari 'Klasör adında Türkçe ya da İngilizce dışı karakter var; bazı yapay zekâ motorları böyle yollardaki dosyaları açamayabilir.'
            if (-not (EvetMi 'Yine de bu adla devam edilsin mi?' $false)) { throw 'Kurulum iptal edildi. Yalnızca İngilizce harfler içeren bir ad seçip yeniden deneyin.' }
        }
        $hedef = Join-Path ($surucu.DeviceID + '\') $klasorAdi

        if ([string]$surucu.FileSystem -eq 'FAT32') {
            Yaz ''
            Uyari 'Bu sürücü FAT32 biçimli. FAT32 tek dosyada 4 GB sınırına sahiptir:'
            Uyari 'Gemma 4 E4B (~5 GB) ve SDXL görsel modelleri (~7 GB) bu sürücüye inemez.'
            Uyari 'Öneri: sürücüyü exFAT (ya da NTFS) olarak biçimlendirin. DİKKAT: biçimlendirme sürücüdeki her şeyi siler.'
            if (-not (EvetMi 'Yine de FAT32 sürücüye kurulsun mu? (küçük modellerle çalışır)' $false)) { throw 'Kurulum iptal edildi. Sürücüyü exFAT/NTFS yapıp yeniden deneyin.' }
        }
        Bilgi 'USB 3 bellek ya da harici SSD önerilir; yavaş bellekte modellerin açılması uzun sürer.'
    }

    # --- 3) Alan ve klasör denetimi ---------------------------------------------
    $surucuBilgi = BosAlan $hedef
    if ($surucuBilgi) {
        $bos = [double]$surucuBilgi.AvailableFreeSpace
        if ($bos -lt ($EnAzBosGB * 1GB)) { throw ("Yetersiz boş alan: {0}. En az {1} GB gerekir (modeller hariç)." -f (GBYaz $bos), $EnAzBosGB) }
        if ($bos -lt ($OnerilenBosGB * 1GB)) { Uyari ("Boş alan {0}. Başlangıç modelleriyle rahat kullanım için {1} GB önerilir." -f (GBYaz $bos), $OnerilenBosGB) }
    }

    $guncelleme = $false
    if (Test-Path -LiteralPath $hedef -PathType Leaf) { throw "Bu adla bir dosya var, klasör oluşturulamaz: $hedef" }
    if (Test-Path -LiteralPath $hedef) {
        $icerik = @(Get-ChildItem -LiteralPath $hedef -Force -ErrorAction SilentlyContinue)
        if ($icerik.Count -gt 0) {
            if (Test-Path -LiteralPath (Join-Path $hedef 'windows.bat')) {
                Yaz ''
                Uyari "Bu klasörde zaten bir Yerel AI Stüdyosu var: $hedef"
                $kuruluSurum = ''
                $surumDosyasi = Join-Path $hedef 'VERSION'
                if (Test-Path -LiteralPath $surumDosyasi -PathType Leaf) { try { $kuruluSurum = ([IO.File]::ReadAllText($surumDosyasi)).Trim() } catch {} }
                if ($kuruluSurum -or $yeniSurum) {
                    $eski = $kuruluSurum; if (-not $eski) { $eski = 'bilinmiyor' }
                    $yeni = $yeniSurum; if (-not $yeni) { $yeni = 'bilinmiyor' }
                    Yaz "  Kurulu sürüm: $eski  ->  yeni sürüm: $yeni"
                }
                Yaz '  Güncellenirse program dosyaları yenilenir; modelleriniz, sohbet geçmişiniz ve ayarlarınız korunur.'
                Yaz '  Uygulama açıksa önce kapatın (açık komut penceresini kapatmanız yeterli).'
                if (-not (EvetMi 'Güncellensin mi?' $true)) { throw 'Kurulum iptal edildi.' }
                $guncelleme = $true
            } else {
                throw "Hedef klasör boş değil ve bir Yerel AI Stüdyosu kurulumu değil: $hedef. Başka bir klasör adı seçin."
            }
        }
    }
    # Klasörü oluştur ve yazılabildiğini dene (ör. Program Files gibi yönetici izni isteyen yerler)
    try {
        New-Item -ItemType Directory -Force -Path $hedef | Out-Null
        $yazmaDenemesi = Join-Path $hedef ('.yazma-denemesi-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
        [IO.File]::WriteAllText($yazmaDenemesi, 'ok')
        Remove-Item -LiteralPath $yazmaDenemesi -Force
    } catch {
        throw "Bu klasöre yazılamıyor: $hedef ($($_.Exception.Message)). Yönetici izni gerektirmeyen bir yer seçin (ör. kullanıcı klasörünüz ya da D:\$VarsayilanKlasorAdi)."
    }
    Yaz ''
    Bilgi "Kurulum yeri: $hedef"

    # --- 4) Aç ve yerleştir -----------------------------------------------
    Bilgi 'Paket açılıyor...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $acik = Join-Path $tmpKok 'acik'
    New-Item -ItemType Directory -Force -Path $acik | Out-Null
    $acikTam = [IO.Path]::GetFullPath($acik).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $zip = [IO.Compression.ZipFile]::OpenRead($zipYolu)
    try {
        foreach ($g in $zip.Entries) {
            $yol = [IO.Path]::GetFullPath((Join-Path $acik $g.FullName))
            # Zip içinden klasör dışına yazmaya çalışan girdileri reddet (zip-slip)
            if (-not $yol.StartsWith($acikTam, [StringComparison]::OrdinalIgnoreCase)) { throw "Güvensiz zip girdisi: $($g.FullName)" }
            if ($g.FullName.EndsWith('/') -or $g.FullName.EndsWith('\')) { New-Item -ItemType Directory -Force -Path $yol | Out-Null; continue }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $yol) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($g, $yol, $true)
        }
    } finally { $zip.Dispose() }

    # Paket tek bir üst klasör içeriyorsa (YerelAIStudyosu/ ya da GitHub'ın sahip-depo-sürüm/ klasörü) onun içi kullanılır
    $kaynak = $acik
    $ustler = @(Get-ChildItem -LiteralPath $acik -Force)
    if ($ustler.Count -eq 1 -and $ustler[0].PSIsContainer) { $kaynak = $ustler[0].FullName }
    if (-not (Test-Path -LiteralPath (Join-Path $kaynak 'windows.bat'))) { throw 'Paket beklenen yapıda değil (windows.bat bulunamadı).' }

    if ($guncelleme) {
        # Eski arayüz derlemesi silinir: windows.bat ilk açılışta bağımlılıkları tazeleyip arayüzü yeniden derler
        $eskiDist = Join-Path (Join-Path $hedef 'app') 'dist'
        if (Test-Path -LiteralPath $eskiDist) { Remove-Item -LiteralPath $eskiDist -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Bilgi 'Dosyalar yerleştiriliyor...'
    # Paket modelleri, sohbet geçmişini ve ayarları (app/config) içermez; güncellemede bunlar olduğu gibi kalır
    foreach ($o in (Get-ChildItem -LiteralPath $kaynak -Force)) {
        Copy-Item -LiteralPath $o.FullName -Destination $hedef -Recurse -Force
    }
    Remove-Item -LiteralPath $tmpKok -Recurse -Force -ErrorAction SilentlyContinue
    Tamam 'Dosyalar hazır.'

    # --- 5) Kısayol (yalnızca bu bilgisayara kurulumda) -------------------------
    $bat = Join-Path $hedef 'windows.bat'
    if (-not $usb) {
        try {
            $masaustu = [Environment]::GetFolderPath('Desktop')
            $kisayolYolu = Join-Path $masaustu 'Yerel AI Stüdyosu.lnk'
            if (Test-Path -LiteralPath $kisayolYolu) {
                $mevcutHedef = KisayolHedefi $kisayolYolu
                if ($mevcutHedef -and ($mevcutHedef -ne $bat)) {
                    # Başka bir kurulumu açan kısayolun üzerine yazılmaz; bu kurulum klasör adıyla ayrı kısayol alır
                    $kisayolYolu = Join-Path $masaustu "Yerel AI Stüdyosu ($klasorAdi).lnk"
                }
            }
            Kisayol $kisayolYolu $bat $hedef 'Yerel AI Stüdyosu'
            Tamam "Masaüstüne kısayol eklendi: $([IO.Path]::GetFileNameWithoutExtension($kisayolYolu))"
        } catch { Uyari "Masaüstü kısayolu oluşturulamadı: $($_.Exception.Message)" }
    } else {
        Bilgi "Taşınabilir kurulum: başka bir bilgisayarda sürücüdeki $klasorAdi\windows.bat dosyasını çift tıklayın."
        Bilgi 'Her yeni bilgisayarda ilk açılışta o bilgisayara uygun motorlar kısa bir onarımla eklenebilir.'
    }

    # --- 6) Başlat ---------------------------------------------------------
    Yaz ''
    Yaz '  ============================================================' Green
    if ($guncelleme) { Yaz '    Güncelleme tamamlandı.' Green } else { Yaz '    Kurulum tamamlandı.' Green }
    Yaz "    Yer: $hedef" Green
    if ($yerelPaket) { Yaz "    Kaynak: yerel paket ($zipAdi)" Green }
    if ($yeniSurum) { Yaz "    Sürüm: $yeniSurum" Green }
    Yaz '  ============================================================' Green
    Yaz ''
    Yaz '  İlk açılışta windows.bat taşınabilir Node.js ve yapay zekâ motorlarını indirir'
    Yaz '  (~1-1,5 GB, bir kerelik). Ardından tarayıcıda uygulama ve ilk kurulum sihirbazı açılır.'
    Yaz ''
    if (EvetMi 'Şimdi başlatılsın mı?' $true) {
        Start-Process -FilePath "$env:ComSpec" -ArgumentList '/c', "`"$bat`"" -WorkingDirectory $hedef
    }
    exit 0
} catch {
    Yaz ''
    Hata $_.Exception.Message
    Yaz ''
    if ($tmpKok -and (Test-Path -LiteralPath $tmpKok)) { Remove-Item -LiteralPath $tmpKok -Recurse -Force -ErrorAction SilentlyContinue }
    exit 1
}

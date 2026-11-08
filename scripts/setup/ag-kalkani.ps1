# Yerel AI Stüdyosu - Ağ kalkanı (Windows Güvenlik Duvarı)
#
# Uygulamanın app\ klasöründeki bütün motorların (Python, llama.cpp, stable-diffusion.cpp, whisper.cpp, Piper...)
# internete ÇIKIŞINI engeller. Yalnızca uygulamanın sunucusu (node.exe: web araması, model indirme, güncelleme) ve
# paket kurulumunda kullanılan Python kopyası (python-kurulum.exe) hariç tutulur.
#
#   -Islem Kur     : (yönetici) bu betiği korumalı %ProgramData%\YerelAIStudyosu klasörüne kopyalar, kuralları ekler ve
#                    kuralları 10 dakikada bir ve her açılışta kendiliğinden güncelleyen SYSTEM görevini kaydeder.
#                    Böylece sonradan inen yeni motorlar da kimse bir şey yapmadan korunur.
#   -Islem Esitle  : (görev) app\ altındaki yeni .exe'ler için kural ekler.
#   -Islem Kaldir  : (yönetici) görevi ve kuralları kaldırır (uygulamayı silerken).
#   -Islem Kapat   : (yönetici) kuralları devre dışı bırakır; görev onları yeniden açmaz (kalkan "kapalı" kalır).
#   -Islem Ac      : (yönetici) kuralları yeniden etkinleştirir.
#
# Görevin çalıştırdığı kopya yalnızca Yöneticiler ve SYSTEM tarafından değiştirilebilir (uygulama klasöründeki bir
# dosyayı değiştiren kötü niyetli bir kod, SYSTEM yetkisiyle çalışan bu görevi ele geçiremez).
param(
    [ValidateSet('Kur', 'Esitle', 'Kaldir', 'Kapat', 'Ac')][string]$Islem = 'Esitle',
    [Parameter(Mandatory = $true)][string]$Kok,
    [string]$Sonuc = ''
)
$ErrorActionPreference = 'Stop'

function Ozet([string]$s) {
    $sha = [Security.Cryptography.SHA256]::Create()
    return (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s.ToLowerInvariant())) | ForEach-Object { $_.ToString('x2') }) -join '')
}
function SonucYaz([string]$m) { if ($Sonuc) { Set-Content -LiteralPath $Sonuc -Value $m -Encoding UTF8 } }

$Kok = [IO.Path]::GetFullPath($Kok.Trim('"')).TrimEnd('\')
$kimlik = (Ozet $Kok).Substring(0, 8)
$grup = "YerelAIStudyosuKalkani-$kimlik"
$gorev = "YerelAIStudyosu Ag Kalkani $kimlik"
$guvenliKlasor = Join-Path $env:ProgramData 'YerelAIStudyosu'
$guvenliBetik = Join-Path $guvenliKlasor 'ag-kalkani.ps1'

$isaretYolu = Join-Path $guvenliKlasor "kalkan-$kimlik.json"
function KapaliMi {
    try { $i = Get-Content -LiteralPath $isaretYolu -Raw -ErrorAction Stop | ConvertFrom-Json; return [bool]$i.kapali } catch { return $false }
}
function IsaretYaz([bool]$kapali) {
    if (-not (Test-Path -LiteralPath $guvenliKlasor)) { return }
    $etkin = @(Get-NetFirewallRule -Group $grup -ErrorAction SilentlyContinue | Where-Object { "$($_.Enabled)" -eq 'True' }).Count
    $isaret = @{ kimlik = $kimlik; kok = $Kok; sonEsitleme = (Get-Date).ToUniversalTime().ToString('o'); kural = $etkin; kapali = $kapali
        gorev = [bool](Get-ScheduledTask -TaskName $gorev -ErrorAction SilentlyContinue)
        duvarAcik = (@(Get-NetFirewallProfile -ErrorAction SilentlyContinue | Where-Object { "$($_.Enabled)" -eq 'True' }).Count -gt 0) }
    Set-Content -LiteralPath $isaretYolu -Value ($isaret | ConvertTo-Json -Compress) -Encoding UTF8
}
function Esitle {
    $kapali = KapaliMi
    $app = Join-Path $Kok 'app'
    $haric = @((Join-Path $app 'tools\node-win\node.exe'), (Join-Path $app 'tools\python-win\python-kurulum.exe')) | ForEach-Object { $_.ToLowerInvariant() }
    # Henüz inmemiş olsa da bilinen motor yolları baştan kurala bağlanır
    $bilinen = @('tools\python-win\python.exe', 'tools\python-win\pythonw.exe') | ForEach-Object { Join-Path $app $_ }
    $bulunan = @()
    if (Test-Path -LiteralPath $app) {
        $bulunan = @(Get-ChildItem -LiteralPath $app -Recurse -Filter '*.exe' -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\(node_modules|kullanicilar|outputs|tts-outputs|chat-history|frontend|dist)\\' } |
            ForEach-Object { $_.FullName })
    }
    $hedef = @(@($bulunan) + @($bilinen) | Where-Object { $_ -and ($haric -notcontains $_.ToLowerInvariant()) } | Sort-Object -Unique)
    $mevcut = @{}
    Get-NetFirewallRule -Group $grup -ErrorAction SilentlyContinue | ForEach-Object {
        $f = $_ | Get-NetFirewallApplicationFilter
        if ($f.Program) { $mevcut[$f.Program.ToLowerInvariant()] = $true }
    }
    $eklenen = 0
    foreach ($p in $hedef) {
        if (-not $mevcut.ContainsKey($p.ToLowerInvariant())) {
            $kural = New-NetFirewallRule -DisplayName "Yerel AI Studyosu - motor internet engeli ($kimlik)" -Group $grup -Direction Outbound -Action Block -Program $p -Profile Any
            if ($kapali) { $kural | Disable-NetFirewallRule }
            $eklenen++
        }
    }
    IsaretYaz $kapali
    return $eklenen
}

try {
    if ($Islem -eq 'Kaldir') {
        Unregister-ScheduledTask -TaskName $gorev -Confirm:$false -ErrorAction SilentlyContinue
        Get-NetFirewallRule -Group $grup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        Remove-Item -LiteralPath (Join-Path $guvenliKlasor "kalkan-$kimlik.json") -Force -ErrorAction SilentlyContinue
        SonucYaz 'tamam kaldirildi'
        exit 0
    }
    if ($Islem -eq 'Kapat') {
        Get-NetFirewallRule -Group $grup -ErrorAction SilentlyContinue | Disable-NetFirewallRule
        IsaretYaz $true
        SonucYaz 'tamam kapatildi'
        exit 0
    }
    if ($Islem -eq 'Ac') {
        Get-NetFirewallRule -Group $grup -ErrorAction SilentlyContinue | Enable-NetFirewallRule
        IsaretYaz $false
        $n = Esitle
        SonucYaz "tamam acildi $n"
        exit 0
    }
    if ($Islem -eq 'Kur') {
        New-Item -ItemType Directory -Force -Path $guvenliKlasor | Out-Null
        # Korumalı klasör: Yöneticiler ve SYSTEM tam yetkili, Kullanıcılar yalnızca okur/çalıştırır
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        $miras = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
        $yayilim = [Security.AccessControl.PropagationFlags]::None
        foreach ($hak in @(@('S-1-5-32-544', 'FullControl'), @('S-1-5-18', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
            $sid = New-Object Security.Principal.SecurityIdentifier $hak[0]
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, $hak[1], $miras, $yayilim, 'Allow')))
        }
        Set-Acl -LiteralPath $guvenliKlasor -AclObject $acl
        if ($PSCommandPath -and ([IO.Path]::GetFullPath($PSCommandPath) -ne [IO.Path]::GetFullPath($guvenliBetik))) {
            Copy-Item -LiteralPath $PSCommandPath -Destination $guvenliBetik -Force
        }
        $arg = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$guvenliBetik`" -Islem Esitle -Kok `"$Kok`""
        $eylem = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
        $t1 = New-ScheduledTaskTrigger -AtStartup
        $t2 = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
        $kim = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $ayar = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
        Register-ScheduledTask -TaskName $gorev -Action $eylem -Trigger @($t1, $t2) -Principal $kim -Settings $ayar -Description "Yerel AI Studyosu ($Kok): motorlarin internete cikisini engelleyen guvenlik duvari kurallarini gunceller." -Force | Out-Null
    }
    if ($Islem -eq 'Kur') { Get-NetFirewallRule -Group $grup -ErrorAction SilentlyContinue | Enable-NetFirewallRule; IsaretYaz $false }
    $n = Esitle
    SonucYaz "tamam $n"
    exit 0
} catch {
    SonucYaz ("hata " + $_.Exception.Message)
    exit 1
}

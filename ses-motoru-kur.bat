@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Yerel AI Studyosu - EMA Lightning Turkce ses motoru kurulumu
cd /d "%~dp0"

set "APP=%~dp0app"
set "PYDIR=%APP%\tools\python-win"
set "PY=%PYDIR%\python.exe"
set "EMADIR=%APP%\tts-models\ema"
set "HF_HOME=%EMADIR%\hf"
set "PIP_CACHE_DIR=%APP%\cache\pip"
set "PYTHONUTF8=1"

echo.
echo  ============================================================
echo    EMA Lightning - Turkce ses motoru kurulumu
echo  ============================================================
echo.
echo  Kurulan: tasinabilir Python 3.12, PyTorch (CPU), ema-lightning
echo  Hepsi bu klasorun icine kurulur; bilgisayara bir sey kurulmaz.
echo  Yaklasik 300-400 MB indirilir, 5-15 dakika surebilir.
echo.

if not exist "%EMADIR%" mkdir "%EMADIR%"

if exist "%PY%" goto python_var
echo  [1/4] Tasinabilir Python indiriliyor...
if not exist "%PYDIR%" mkdir "%PYDIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile '%PYDIR%\python.zip'; if ((Get-FileHash '%PYDIR%\python.zip' -Algorithm MD5).Hash -ne 'FE8EF205F2E9C3BA44D0CF9954E1ABD3') { Remove-Item '%PYDIR%\python.zip'; throw 'Python arsivinin ozeti uyusmuyor' }; Expand-Archive -Path '%PYDIR%\python.zip' -DestinationPath '%PYDIR%' -Force; Remove-Item '%PYDIR%\python.zip'"
if not exist "%PY%" (
    echo  [HATA] Python indirilemedi. Internet baglantinizi kontrol edin.
    pause
    exit /b 1
)
rem Gomulu Python'da pip paketlerinin gorunmesi icin "import site" acilir
powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Content '%PYDIR%\python312._pth') -replace '^#\s*import site','import site' | Set-Content -Encoding ASCII '%PYDIR%\python312._pth'"
goto pip_kontrol

:python_var
echo  [1/4] Tasinabilir Python zaten var.

:pip_kontrol
"%PY%" -m pip --version >nul 2>nul
if not errorlevel 1 goto pip_var
echo  [2/4] pip kuruluyor...
rem pip: sabit surumlu wheel (PyPI), SHA256 dogrulanarak; sabitlenmemis get-pip.py calistirilmaz
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://files.pythonhosted.org/packages/f3/6e/1736e5b4ae2b778ef2f81c47d797de9f891d4d8acb047a24ca37a60294dd/pip-26.2.1-py3-none-any.whl' -OutFile '%PYDIR%\pip-26.2.1-py3-none-any.whl'; if ((Get-FileHash '%PYDIR%\pip-26.2.1-py3-none-any.whl' -Algorithm SHA256).Hash -ne '71138adf1f4ca900cdb7d289c21b7494329f2332b6d85f0e1c42108c0384ed3e') { Remove-Item '%PYDIR%\pip-26.2.1-py3-none-any.whl'; throw 'pip paketinin ozeti uyusmuyor' }"
"%PY%" -c "import sys; w=sys.argv[1]; sys.path.insert(0, w); from pip._internal.cli.main import main; sys.exit(main(['install', '--no-index', '--no-warn-script-location', w]))" "%PYDIR%\pip-26.2.1-py3-none-any.whl"
if errorlevel 1 (
    echo  [HATA] pip kurulamadi.
    pause
    exit /b 1
)
goto paketler

:pip_var
echo  [2/4] pip zaten var.

:paketler
echo  [3/4] PyTorch (yalnizca islemci surumu) ve EMA Lightning kuruluyor...
rem Surumler sabit: bilinen ve denenmis surumler kurulur
"%PY%" -m pip install --no-warn-script-location --only-binary=:all: torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 (
    echo  [HATA] PyTorch kurulamadi.
    pause
    exit /b 1
)
"%PY%" -m pip install --no-warn-script-location ema-lightning==1.1.2
if errorlevel 1 (
    echo  [HATA] ema-lightning kurulamadi.
    pause
    exit /b 1
)

echo  [4/4] Ses modeli indiriliyor (~34 MB) ve deneniyor...
"%PY%" -c "from ema_lightning import EMA; s=EMA().say('Kurulum tamamland\u0131. Merhaba, ben Vega. Art\u0131k T\u00fcrk\u00e7eyi daha do\u011fru telaffuz ediyorum.', path=r'%EMADIR%\deneme.wav', sample_rate=24000); print('  Ses suresi:', round(s.duration, 1), 'sn')"
if errorlevel 1 (
    echo  [HATA] Ses modeli indirilemedi ya da calismadi. Yukaridaki hatayi GitHub'da sorun (issue) olarak bildirin.
    pause
    exit /b 1
)

echo kuruldu %date% %time%> "%EMADIR%\kurulu.txt"
echo.
echo  ============================================================
echo    TAMAM. Deneme sesi caliniyor: app\tts-models\ema\deneme.wav
echo    Sunucuyu yeniden baslatin; ses listesinde
echo    "EMA Lightning (Turkce)" gorunecek.
echo  ============================================================
start "" "%EMADIR%\deneme.wav"
pause

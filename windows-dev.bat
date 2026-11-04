@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Yerel AI Studyosu  ^|  GELISTIRME MODU
cd /d "%~dp0"

set APP=%~dp0app
set NODE=%APP%\tools\node-win\node.exe
set NPM=%APP%\tools\node-win\npm.cmd
set SERVE=%~dp0scripts\server\serve.cjs
set FRONTEND=%APP%\frontend

:: Backend bu portta calisir (vite.config.js icindeki /api proxy hedefi)
set DEV_API_PORT=1422
:: Arayuz (Vite dev sunucusu) bu portta calisir - tarayicida acacagin adres
set DEV_UI_PORT=1420

echo.
echo  ============================================================
echo       Yerel AI Studyosu   ^|  Gelistirme
echo  ============================================================
echo.

if not exist "%NODE%" (
    echo  [HATA] Tasinabilir Node.js bulunamadi.
    echo         Once bir kez windows.bat calistirip kurulumu tamamlayin.
    pause
    exit /b 1
)

if not exist "%FRONTEND%\node_modules\vite" (
    echo  Arayuz bagimliliklari eksik, kuruluyor... ^(bir kereye mahsus^)
    call "%NPM%" --prefix "%FRONTEND%" install
    if errorlevel 1 (
        echo  [HATA] npm install basarisiz.
        pause
        exit /b 1
    )
)

:: Eski dev sureclerini temizle
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%DEV_API_PORT% " ^| findstr /I "LISTENING"') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%DEV_UI_PORT% " ^| findstr /I "LISTENING"') do taskkill /f /pid %%a >nul 2>nul

echo  1/2  Backend baslatiliyor  ^(port %DEV_API_PORT%^)...
start "DD-YZ Backend (dev)" cmd /k "cd /d "%~dp0" && set PORT=%DEV_API_PORT%&& "%NODE%" "%SERVE%""

timeout /t 4 >nul

echo  2/2  Arayuz baslatiliyor   ^(port %DEV_UI_PORT%, canli yenileme^)...
start "DD-YZ Arayuz (vite dev)" cmd /k "cd /d "%FRONTEND%" && "%NPM%" run dev"

timeout /t 5 >nul
start http://localhost:%DEV_UI_PORT%

echo.
echo  ============================================================
echo   GELISTIRME MODU CALISIYOR
echo.
echo   Arayuz  :  http://localhost:%DEV_UI_PORT%      ^<-- burayi ac
echo   Backend :  http://localhost:%DEV_API_PORT%      ^(dogrudan acma, arayuz proxy'liyor^)
echo.
echo   app\frontend\src icindeki dosyalari kaydettigin anda
echo   tarayici kendini yeniler. Backend'i (serve.cjs) degistirirsen
echo   sadece Backend penceresini kapatip bu dosyayi yeniden calistir.
echo.
echo   Bitirince: iki pencereyi de kapat.
echo   Yayina almak icin:  app\tools\node-win\npm.cmd --prefix app\frontend run build
echo                       ^(cikti app\dist icine yazilir, windows.bat onu sunar^)
echo  ============================================================
echo.
pause

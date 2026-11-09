@echo off
chcp 65001 >nul
title Actualizar Semillas de XuperTV
echo ========================================================
echo   XuperTV - Actualizador de Semillas (Sesiones de respaldo)
echo ========================================================
echo.
echo Conectando con el portal Magis desde tu conexion local...
echo Acuñando 30 semillas frescas...
echo.

node tools/mint-seeds.js --count 30 --pool dist/seeds/seeds.json --out dist/seeds/seeds.json
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] No se pudieron acuñar las semillas. Revisa tu conexion a internet.
    pause
    exit /b 1
)

echo.
echo Publicando las semillas directamente en GitHub...
node tools/push-seeds.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] No se pudieron subir a GitHub. Revisa tus credenciales de git.
    pause
    exit /b 1
)

echo.
echo ========================================================
echo   ¡TODO LISTO! 
echo   Las nuevas semillas ya estan publicadas en GitHub.
echo   Cualquier televisor las descargara automaticamente.
echo ========================================================
echo.
pause


@echo off
chcp 65001 >nul
title Configurar Tarea Automática de Semillas - XuperTV
echo ========================================================
echo   XuperTV - Auto-Renovador de Semillas en Segundo Plano
echo ========================================================
echo.
echo Esta herramienta crea una Tarea Programada en Windows para
echo renovar y subir semillas vivas a GitHub cada 3 horas de forma
echo completamente automatica y silenciosa en segundo plano.
echo.

set TASKNAME=XuperTV-RenovarSemillas
set SCRIPTDIR=%~dp0..
set RUNNER=%SCRIPTDIR%\tools\auto-renew-seeds.vbs

:: Crear el script VBS que ejecuta el batch sin abrir ventana negra
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.Run "cmd /c cd /d """ ^& "%SCRIPTDIR%" ^& """ && node tools/mint-seeds.js --count 30 --pool dist/seeds/seeds.json --out dist/seeds/seeds.json && node tools/push-seeds.js", 0, False
) > "%RUNNER%"

:: Registrar la tarea programada cada 3 horas
schtasks /create /tn "%TASKNAME%" /tr "wscript.exe \"%RUNNER%\"" /sc minute /mo 180 /f >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Tarea programada '%TASKNAME%' creada con exito!
    echo.
    echo A partir de ahora, cada 3 horas Windows ejecutara la renovacion
    echo en segundo plano sin mostrar ninguna ventana.
    echo ¡Ya no tendras que preocuparte nunca mas de actualizar semillas manualmente!
) else (
    echo [AVISO] Se requieren permisos de administrador para registrar la tarea.
    echo Haz clic derecho en este archivo y selecciona 'Ejecutar como administrador'.
)

echo.
echo ========================================================
pause

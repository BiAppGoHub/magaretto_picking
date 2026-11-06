@echo off
title VETE - Sistema de Control de Empaque y Codigo de Barras
color 0A

echo ==============================================================================
echo       VETE - SISTEMA DE CONTROL DE EMPAQUE Y PICKING
echo       Estacion de Lectura con Pistola Inalambrica USB y Supabase
echo ==============================================================================
echo.
echo Iniciando la aplicacion en Google Chrome sin cache...
echo.

set "HTML_FILE=%~dp0index.html"

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="%HTML_FILE%" --disable-application-cache --media-cache-size=1 --disk-cache-size=1
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --app="%HTML_FILE%" --disable-application-cache --media-cache-size=1 --disk-cache-size=1
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --app="%HTML_FILE%" --disable-application-cache --media-cache-size=1 --disk-cache-size=1
) else (
    start "" "%HTML_FILE%"
)

echo Sistema VETE iniciado correctamente.
exit

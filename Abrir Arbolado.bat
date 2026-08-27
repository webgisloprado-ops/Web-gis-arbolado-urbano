@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Sistema de Arbolado Urbano
echo.
echo   Iniciando el Sistema de Arbolado Urbano...
echo   Se abrira solo en tu navegador. No cierres esta ventana.
echo.
node server.mjs
if %errorlevel% neq 0 (
  echo.
  echo   [ERROR] No se pudo iniciar. Comprueba que Node.js este instalado ^(https://nodejs.org^).
  pause
)

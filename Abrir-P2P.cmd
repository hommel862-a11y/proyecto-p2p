@echo off
REM Abre P2P Decisor en modo escritorio (Electron).
REM Usa el bundle ya compilado en dist\p2p\browser: no requiere "ng serve".
cd /d "%~dp0"
if not exist "%~dp0dist\p2p\browser\index.html" (
  echo No se encontro el bundle compilado.
  echo Ejecuta primero: npm run build
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b 0

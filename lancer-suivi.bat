@echo off
cd /d "%~dp0"

echo.
echo ================================
echo Suivi Midea PortaSplit
echo ================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe.
  echo Installe Node.js LTS depuis https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".env" (
  echo Fichier .env manquant.
  echo.
  echo Cree un fichier .env dans ce dossier avec :
  echo TELEGRAM_BOT_TOKEN=ton_token
  echo TELEGRAM_CHAT_ID=8932446633
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installation des dependances...
  npm install
)

echo Installation/verif du navigateur Playwright...
npx playwright install chromium

echo Ouverture de la page locale...
start "" "http://localhost:8787"

echo Lancement du serveur local...
node local-server.js

pause

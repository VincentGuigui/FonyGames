@echo off
setlocal

cd /d "%~dp0.."

echo Starting FonyGames locally: the room server (wrangler, :8787) and the site (vite, :5173)...
echo Each opens in its own window - close either one to stop it.
echo (wrangler dev keeps room state between runs in .wrangler\state - delete
echo  that folder for a clean slate if old test rooms show up again.)
echo.

start "FonyGames - worker (wrangler :8787)" cmd /k "npm run worker:dev"
start "FonyGames - site (vite :5173)" cmd /k "npm run dev"

echo Both are starting up in their own windows.
echo Once the site window says it is ready, open http://localhost:5173
pause

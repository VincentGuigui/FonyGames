@echo off
setlocal

cd /d "%~dp0.."

echo Building FonyGames (typecheck, regenerated art, vite build, SSR pages, API stage)...

call npm run build
if errorlevel 1 goto :error

echo.
echo Done: dist/ is ready to serve (dist-private/db holds the pending migrations).
goto :end

:error
echo.
echo Build failed - see the error above.

:end
pause

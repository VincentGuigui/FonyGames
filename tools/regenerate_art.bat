@echo off
setlocal

cd /d "%~dp0.."

echo Regenerating generated art (derived outlines, OG previews, procedural cards)...

call npm run art
if errorlevel 1 goto :error

echo.
echo Done. Regenerated art is a real change - review the diff before committing it.
goto :end

:error
echo.
echo Art regeneration failed - see the error above.

:end
pause

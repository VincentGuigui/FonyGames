@echo off
setlocal

echo Fast-forwarding dev to main...

git fetch origin main
if errorlevel 1 goto :error

git push origin origin/main:dev
if errorlevel 1 goto :error

echo.
echo Done: dev now matches main.
goto :end

:error
echo.
echo Deploy failed - see the error above.
echo (a non-fast-forward push means dev has commits main doesn't - investigate before forcing anything)

:end
pause

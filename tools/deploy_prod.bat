@echo off
setlocal

echo Fast-forwarding prod to dev...

git fetch origin dev
if errorlevel 1 goto :error

git push origin origin/dev:prod
if errorlevel 1 goto :error

echo.
echo Done: prod now matches dev.
goto :end

:error
echo.
echo Deploy failed - see the error above.
echo (a non-fast-forward push means prod has commits dev doesn't - investigate before forcing anything)

:end
pause

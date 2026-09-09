@echo off
setlocal

cd /d "%~dp0.."

echo Running the full FonyGames test suite (npm test)...
echo (Needs a MariaDB test server for the PHP suite - see docs/database.md section 5.
echo  No PHP/MariaDB installed? Run tools\setup_windows_tests.ps1 once first.)
echo.

call npm test
if errorlevel 1 goto :error

echo.
echo All tests passed.
goto :end

:error
echo.
echo Tests failed - see the error above.

:end
pause

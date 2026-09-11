@echo off
setlocal
cd /d "%~dp0"

call npm run payload
if errorlevel 1 (
  echo Payload generation failed.
  pause
  exit /b 1
)

call node_modules\.bin\electron-builder.cmd --win portable
set "BUILD_EXIT=%ERRORLEVEL%"
pause
exit /b %BUILD_EXIT%

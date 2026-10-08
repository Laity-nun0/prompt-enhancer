@echo off
cd /d "%~dp0"
set POC_OPEN_BROWSER=1
node server/index.ts
pause

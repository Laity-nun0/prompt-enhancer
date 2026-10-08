@echo off
rem 此入口运行网页开发服务；日常使用请打开启动Companion.cmd。
cd /d "%~dp0"
set POC_OPEN_BROWSER=1
node server/index.ts
pause

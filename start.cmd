@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not defined PORT set PORT=8110
if not defined PUBLIC_BASE set PUBLIC_BASE=http://127.0.0.1:%PORT%
echo Автонова с пробегом -^> %PUBLIC_BASE%
node server.mjs
pause

@echo off
title TikTok Live Stickman Game
echo Dang kiem tra moi truong...

cd /d "%~dp0"

if not exist node_modules (
    echo Khong tim thay node_modules, dang cai dat thu vien...
    npm install
)

echo.
echo Dang khoi dong server...
echo Truy cap: http://localhost:3000
echo.

node server.js

if %errorlevel% neq 0 (
    echo.
    echo Da xay ra loi khi chay server.
    pause
)

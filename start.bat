@echo off
title TrustMark Provenance Watermarking Server
color 0b

echo ======================================================================
echo           Starting TrustMark Provenance Server (Local Offline)
echo ======================================================================
echo.

:: Check if Python is installed
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python was not found in PATH!
    echo Please ensure Python 3.10+ is installed and added to PATH.
    pause
    exit /b 1
)

:: Ensure UTF-8 output encoding
chcp 65001 >nul 2>&1
set PYTHONUTF8=1

:: Navigate to script directory
cd /d "%~dp0"

echo [INFO] Working Directory: %CD%
echo [INFO] Hardware Acceleration: NVIDIA GeForce RTX 5050 (CUDA)
echo [INFO] Server URL: http://127.0.0.1:5000
echo.
echo Launching browser and starting Flask server...
echo Press CTRL+C at any time in this window to stop the server.
echo.

:: Automatically open default browser after a 2-second delay in background
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:5000"

:: Start the Flask app
python app.py

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Server terminated with an error.
    pause
)

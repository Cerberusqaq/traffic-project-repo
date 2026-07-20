@echo off
chcp 65001 >nul
echo ==========================================
echo  Traffic Visualization Platform - Startup
echo ==========================================
echo.

cd /d "%~dp0"

REM Kill existing processes on ports 5000 and 5001
echo [0/2] Killing existing processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000"') do (
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5001"') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo      Done.

REM Start Python API service (background)
echo [1/2] Starting Python API service...
start "TrafficAPI" cmd /k "python python_api.py"

REM Wait for Python service to start (with timeout check)
echo      Waiting for Python service to be ready...
set "wait_count=0"
:wait_python
timeout /t 1 /nobreak > nul
curl -s http://127.0.0.1:5001/api/python/health >nul 2>&1
if %errorlevel% equ 0 (
    echo      Python API service is ready!
    goto python_ready
)
set /a wait_count+=1
if %wait_count% lss 30 (
    goto wait_python
)
echo      Warning: Python service may not be ready yet, continuing anyway...

:python_ready
REM Start Node.js frontend service (background)
echo [2/2] Starting Node.js frontend service...
start "TrafficFrontend" cmd /k "npm start"

REM Wait for Node.js service to fully start
timeout /t 5 /nobreak > nul

REM Open browser
start http://localhost:3000

echo.
echo ==========================================
echo  Browser should be opened at http://localhost:3000
echo ==========================================
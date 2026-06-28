@echo off
echo ==========================================
echo  Fat Loss Tracker — Build ^& Package
echo ==========================================
echo.

node --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Install from https://nodejs.org
  pause & exit /b 1
)

echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 ( echo ERROR: npm install failed. & pause & exit /b 1 )

echo.
echo [2/3] Building app bundle...
call npm run build
if errorlevel 1 ( echo ERROR: Build failed. & pause & exit /b 1 )

echo.
echo [3/3] Packaging Windows installer...
call npm run package:win
if errorlevel 1 ( echo ERROR: Packaging failed. & pause & exit /b 1 )

echo.
echo ==========================================
echo  Done! Installer is in the dist\ folder.
echo ==========================================
pause

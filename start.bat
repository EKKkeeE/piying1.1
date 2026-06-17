@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地服务器...
node tools\serve.js 5173
if errorlevel 1 (
  echo.
  echo Node 未安装或不在 PATH 中。请安装 Node.js: https://nodejs.org/
  pause
)

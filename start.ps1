# 绕过 npx.ps1 执行策略限制，直接用 Node 启动
Set-Location $PSScriptRoot
Write-Host "正在启动本地服务器..." -ForegroundColor Cyan
node tools/serve.js 5173

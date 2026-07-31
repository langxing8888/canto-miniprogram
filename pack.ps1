# 一键打包部署包：生成 dist/canto-server-日期.zip
# 用法：powershell -ExecutionPolicy Bypass -File pack.ps1
$root = $PSScriptRoot
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$zip = Join-Path $dist "canto-server-$stamp.zip"

# 打包 server 目录（排除本地临时文件）
$staging = Join-Path $env:TEMP "canto-pack-$stamp"
New-Item -ItemType Directory -Force -Path $staging | Out-Null
Copy-Item (Join-Path $root "server") (Join-Path $staging "server") -Recurse -Force
# 清掉临时文件
Get-ChildItem (Join-Path $staging "server") -Recurse -Filter "*.tmp" | Remove-Item -Force

Compress-Archive -Path (Join-Path $staging "server") -DestinationPath $zip -Force
Remove-Item $staging -Recurse -Force

$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "打包完成：$zip （$size KB）"
Write-Host "上传到服务器后按 server/DEPLOY.md 步骤部署即可。"

<#
.SYNOPSIS
  Zero-C-Drive Portable FFmpeg Installer for Agencia Digital 360 (Installs strictly on E:\tools\ffmpeg)
#>
$ErrorActionPreference = "Stop"

$TargetRoot = "E:\tools\ffmpeg"
$BinDir = Join-Path $TargetRoot "bin"
$TempZip = "E:\tools\ffmpeg_essentials.zip"

New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null

if (Test-Path (Join-Path $BinDir "ffmpeg.exe")) {
  Write-Host "[OK] FFmpeg portable ya existe en $BinDir" -ForegroundColor Green
  exit 0
}

Write-Host "[Agencia Digital 360] Descargando FFmpeg Essentials portable hacia E:\tools (0 bytes en C:\)..." -ForegroundColor Cyan
$Url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
Invoke-WebRequest -Uri $Url -OutFile $TempZip -UseBasicParsing

Write-Host "[Agencia Digital 360] Extrayendo en $TargetRoot..." -ForegroundColor Cyan
Expand-Archive -Path $TempZip -DestinationPath $TargetRoot -Force
Remove-Item -Force $TempZip

$ExtractedBin = Get-ChildItem -Path $TargetRoot -Directory | Where-Object { $_.Name -like "ffmpeg-*" } | Select-Object -First 1
if ($ExtractedBin) {
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  Copy-Item -Path (Join-Path $ExtractedBin.FullName "bin\*") -Destination $BinDir -Recurse -Force
  Remove-Item -Recurse -Force $ExtractedBin.FullName
}

Write-Host "[LISTO] FFmpeg instalado en $BinDir. start-agencia360.ps1 lo detectara automaticamente." -ForegroundColor Green

<#
.SYNOPSIS
  Zero-C-Drive Launcher for Agencia Digital 360 (FastAPI Execution Backend)
.DESCRIPTION
  Redirects all Python/AI caches (PIP_CACHE_DIR, HF_HOME, TORCH_HOME) to E:\
  so C:\ stays clean, ensures E:\Agencia_Inbox exists, and launches Uvicorn on :8090.
#>
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StorageCache = Join-Path $RootDir "storage\cache"
$InboxDir = "E:\Agencia_Inbox"
$FlowExportsDir = "E:\Agencia_Inbox\flow_exports"
$FfmpegBin = "E:\tools\ffmpeg\bin"

New-Item -ItemType Directory -Force -Path $StorageCache | Out-Null
New-Item -ItemType Directory -Force -Path $InboxDir | Out-Null
New-Item -ItemType Directory -Force -Path $FlowExportsDir | Out-Null

if (Test-Path $FfmpegBin) {
  $env:PATH = "$FfmpegBin;$env:PATH"
  Write-Host "[Agencia Digital 360] FFmpeg portable activo desde $FfmpegBin" -ForegroundColor Green
}

$env:TZ = "America/Caracas"
$env:LOCAL_INBOX_DIR = $InboxDir
$env:AG360_STORAGE_DIR = Join-Path $RootDir "storage"
$env:PIP_CACHE_DIR = Join-Path $StorageCache "pip"
$env:HF_HOME = Join-Path $StorageCache "huggingface"
$env:TORCH_HOME = Join-Path $StorageCache "torch"
$env:PYTHONPATH = Join-Path $RootDir "backend"

Write-Host "[Agencia Digital 360] Starting FastAPI Backend on http://127.0.0.1:8090 (VET UTC-4)" -ForegroundColor Cyan
Write-Host "[Agencia Digital 360] Read-Only Local Inbox: $InboxDir" -ForegroundColor Green
Write-Host "[Agencia Digital 360] Zero-C-Drive Cache Root: $StorageCache" -ForegroundColor Green

python -m uvicorn app.main:app --host 127.0.0.1 --port 8090 --reload


# Unified Backend Startup Script
# This script ensures a clean environment and correct Python version.

Write-Host "🧹 Cleaning up existing backend processes..." -ForegroundColor Cyan
Set-Location -Path "$PSScriptRoot\backend"
.\cleanup_backend.ps1

Write-Host "🚀 Starting Biometric Attendance Backend..." -ForegroundColor Green
# Use the virtual environment's python directly to avoid ModuleNotFoundError
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

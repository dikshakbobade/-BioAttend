# Intensive cleanup for Biometric Attendance Backend
Write-Host "🧼 [CLEANUP] Performing nuclear cleanup..." -ForegroundColor Cyan

# 1. Kill any process on port 8000
$connections = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if ($connections) {
    foreach ($conn in $connections) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "   ✅ Stopped process $($conn.OwningProcess) on port 8000" -ForegroundColor Yellow
    }
}

# 2. Kill all 'uvicorn' and 'python' processes in the current directory subtree
Get-Process python, uvicorn -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*biometric-attendance-system*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "   ✅ Local Python/Uvicorn processes terminated" -ForegroundColor Yellow

# 3. Clear all __pycache__ folders
Get-ChildItem -Path . -Include __pycache__ -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
Write-Host "   ✅ Bytecode caches cleared" -ForegroundColor Yellow

Write-Host "✨ Cleanup complete. Starting fresh." -ForegroundColor Green

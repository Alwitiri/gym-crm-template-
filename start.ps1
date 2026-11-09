# Gym CRM - start after setup.ps1 has run once.
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
Set-Location $PSScriptRoot
$ErrorActionPreference = "Stop"
docker compose up -d db | Out-Null
# Demo switches for this PC: practice payment page and on-screen login codes for the member app.
# (Never set these on the live server; the API refuses to start with them in production.)
foreach ($line in @("PUBLIC_APP_URL=http://localhost:3000", "PAYMENTS_SIMULATOR=1", "OTP_DEV_ECHO=1")) {
  $key = $line.Split("=")[0]
  if (-not (Select-String -Path "apps\api\.env" -Pattern "^$key=" -Quiet)) { Add-Content -Encoding ascii "apps\api\.env" $line }
}
# Stop anything still running from an earlier start (old API/web windows hold ports 4000 and 3000).
foreach ($port in 4000, 3000) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $owners) {
    if ($procId -gt 0) { Write-Host "Stopping old process on port $port (PID $procId)"; Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
  }
}
Start-Sleep -Seconds 1
# Install packages only when an update added new ones. Each app keeps its own node_modules
# (installing at the top level can be blocked by antivirus on Windows).
foreach ($app in @(@{ dir = "apps\web"; pkgs = @("next", "read-excel-file", "papaparse", "jsqr", "qrcode") }, @{ dir = "apps\api"; pkgs = @("@nestjs/core", "@prisma/client", "zod") })) {
  $missing = $app.pkgs | Where-Object { -not (Test-Path (Join-Path $app.dir "node_modules\$_")) }
  if ($missing) {
    Write-Host "Installing packages for $($app.dir): $($missing -join ', ')" -ForegroundColor Cyan
    Push-Location $app.dir
    npm install --workspaces=false --no-audit --no-fund
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Write-Host "Package install failed in $($app.dir). Close other Gym CRM windows and try again." -ForegroundColor Red; exit 1 }
  }
}
$root = (Get-Location).Path
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; `$host.UI.RawUI.WindowTitle='Gym CRM API'; npm run dev:api"
Start-Sleep -Seconds 6
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; `$host.UI.RawUI.WindowTitle='Gym CRM Web'; npm run dev:web"
Start-Sleep -Seconds 8
Start-Process "http://localhost:3000"
Write-Host "Gym CRM: http://localhost:3000  (owner@irontemple.in / Gym@12345678)" -ForegroundColor Green
Write-Host "Member app: http://localhost:3000/m (mobile 9840000000)   Enquiry form: http://localhost:3000/join"

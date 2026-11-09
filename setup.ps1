# Gym CRM - one-time local setup and start (Windows PowerShell)
# Run from the gym-crm folder:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Needs: Node.js 22+ and Docker Desktop (running).
# Safe to run again: it skips steps that are already done.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- checks
Step "Checking Node.js and Docker"
try { $nodeVer = (node -v).TrimStart("v") } catch { Fail "Node.js is not installed. Get the LTS from https://nodejs.org (version 22 or newer)." }
if ([int]($nodeVer.Split(".")[0]) -lt 22) { Fail "Node.js $nodeVer found; version 22 or newer is needed." }
try { docker info *> $null } catch { Fail "Docker isn't running. Start Docker Desktop, wait until it says 'Running', then run this again." }
if ($LASTEXITCODE -ne 0) { Fail "Docker isn't running. Start Docker Desktop, wait until it says 'Running', then run this again." }
Write-Host "Node $nodeVer, Docker OK"

# ---------------------------------------------------------------- env
$ownerUrl = "postgresql://gym_owner:change-me@localhost:5433/gymcrm"
$appUrl   = "postgresql://gym_app:change-me@localhost:5433/gymcrm"
$envFile  = "apps\api\.env"
if (-not (Test-Path $envFile)) {
  Step "Creating apps\api\.env"
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  @"
DATABASE_URL=$appUrl
MIGRATE_DATABASE_URL=$ownerUrl
SESSION_SECRET=$secret
WEB_ORIGIN=http://localhost:3000
PORT=4000
"@ | Set-Content -Encoding ascii $envFile
}
# Demo switches for this PC: practice payment page and on-screen login codes for the member app.
# (Never set these on the live server; the API refuses to start with them in production.)
foreach ($line in @("PUBLIC_APP_URL=http://localhost:3000", "PAYMENTS_SIMULATOR=1", "OTP_DEV_ECHO=1")) {
  $key = $line.Split("=")[0]
  if (-not (Select-String -Path "apps\api\.env" -Pattern "^$key=" -Quiet)) { Add-Content -Encoding ascii "apps\api\.env" $line }
}

# Prisma CLI reads these from the environment.
$env:MIGRATE_DATABASE_URL = $ownerUrl
$env:DATABASE_URL = $ownerUrl

# ---------------------------------------------------------------- database
Step "Starting PostgreSQL in Docker (port 5433)"
docker compose up -d db
if ($LASTEXITCODE -ne 0) { Fail "Couldn't start the database container." }
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  docker compose exec -T db pg_isready -U gym_owner -d gymcrm *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { Fail "PostgreSQL didn't become ready. Check 'docker compose logs db'." }

# ---------------------------------------------------------------- packages
Step "Installing packages (first time takes a few minutes)"
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }

# ---------------------------------------------------------------- migrations
Push-Location apps\api
try {
  if (-not (Test-Path "prisma\migrations")) {
    Step "Creating tables"
    npx prisma migrate dev --name init
    if ($LASTEXITCODE -ne 0) { Fail "Creating tables failed." }

    Step "Adding database rules (ledgers, overlap guard, GST numbering, branch security)"
    npx prisma migrate dev --create-only --name db_rules
    if ($LASTEXITCODE -ne 0) { Fail "Creating the rules migration failed." }
    $rulesDir = Get-ChildItem prisma\migrations -Directory | Where-Object { $_.Name -like "*_db_rules" } | Select-Object -First 1
    Get-Content prisma\sql\constraints.sql | Add-Content -Encoding utf8 (Join-Path $rulesDir.FullName "migration.sql")
    npx prisma migrate dev
    if ($LASTEXITCODE -ne 0) { Fail "Applying the database rules failed." }
  } else {
    Step "Applying any new migrations"
    npx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { Fail "Migrations failed." }
  }
  npx prisma generate | Out-Null
} finally { Pop-Location }

# ---------------------------------------------------------------- app role
Step "Creating the restricted app login (row-level security applies to it)"
$exists = docker compose exec -T db psql -U gym_owner -d gymcrm -tAc "SELECT 1 FROM pg_roles WHERE rolname='gym_app'"
if ("$exists".Trim() -ne "1") {
  Get-Content apps\api\prisma\sql\roles.sql | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U gym_owner -d gymcrm
  if ($LASTEXITCODE -ne 0) { Fail "Creating the gym_app role failed." }
} else { Write-Host "Already exists" }

# ---------------------------------------------------------------- demo data
Step "Adding demo data"
Push-Location apps\api
try {
  npx tsx prisma\seed.ts
  if ($LASTEXITCODE -ne 0) { Fail "Seeding failed." }
} finally { Pop-Location }

# ---------------------------------------------------------------- start
Step "Starting the API and the web app in two new windows"
$root = (Get-Location).Path
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; `$host.UI.RawUI.WindowTitle='Gym CRM API'; npm run dev:api"
Start-Sleep -Seconds 6
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; `$host.UI.RawUI.WindowTitle='Gym CRM Web'; npm run dev:web"

Write-Host "`nWaiting for the web app..." -NoNewline
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest -UseBasicParsing http://localhost:3000/login -TimeoutSec 2 *> $null; break } catch { Start-Sleep -Seconds 2; Write-Host "." -NoNewline }
}
Start-Process "http://localhost:3000"

Write-Host "`n`nGym CRM is running at http://localhost:3000" -ForegroundColor Green
Write-Host "Sign in as owner@irontemple.in  /  Gym@12345678"
Write-Host "Other logins (same password): front.rsp@irontemple.in, front.plm@irontemple.in, vikram@irontemple.in, accounts@irontemple.in"
Write-Host "Member app: http://localhost:3000/m  (mobile +919840000000; the login code shows on screen in demo mode)"
Write-Host "Enquiry form: http://localhost:3000/join"
Write-Host "To stop: close the two 'Gym CRM' windows. Next time, run start.ps1 instead of this script."

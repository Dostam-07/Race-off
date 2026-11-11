# One-shot Netlify deploy with first-time authorization.
#
#   .\tools\deploy_live.ps1 [siteName]
#
# 1. Requests authorization (opens your browser - click Approve).
# 2. Waits for the approval, then creates the site (first run) and deploys.
# 3. Verifies the live URL serves the game, the PWA files and the companion
#    API (public rooms + leaderboards).
#
# Safe to re-run any time: it rebuilds dist/ and redeploys.

param(
  [string]$SiteName = ''
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$npx = 'npx'

function Invoke-Netlify {
  param([string[]]$nArgs)
  # The CLI writes progress/URLs to stderr; with EAP=Stop that would abort.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $npx --yes netlify-cli@latest @nArgs 2>&1 | Out-String
  } finally {
    $ErrorActionPreference = $prev
  }
}

Write-Host '> building dist/ ...' -ForegroundColor Cyan
npx vite build
if ($LASTEXITCODE -ne 0) { Write-Error 'build failed'; exit 1 }

# --- 1. authorize (skip if already logged in)
$who = Invoke-Netlify @('api', 'getCurrentUser')
if ($LASTEXITCODE -ne 0 -or $who -notmatch '"id"') {
  Write-Host '> opening Netlify authorization in your browser - click APPROVE' -ForegroundColor Yellow
  $out = Invoke-Netlify @('login', '--request', 'Race-Off deploy - approve to publish the game')
  $url = [regex]::Match($out, 'https://app\.netlify\.com/authorize\S+').Value
  $ticket = [regex]::Match($url, 'ticket=([a-f0-9]+)').Groups[1].Value
  if (-not $url) { Write-Error 'could not start authorization'; exit 1 }
  Start-Process $url
  Write-Host "  authorize URL: $url"
  $ok = $false
  foreach ($i in 1..30) {
    Start-Sleep -Seconds 10
    $check = Invoke-Netlify @('login', '--check', $ticket)
    if ($check -notmatch 'pending') { $ok = $true; break }
    Write-Host "  waiting for approval... ($($i * 10)s)"
  }
  if (-not $ok) { Write-Error 'authorization not approved in time - re-run this script'; exit 1 }
  Write-Host '> authorized!' -ForegroundColor Green
}

# --- 2. create the site on first run, then deploy
if (-not $SiteName) { $SiteName = 'race-off-' + (-join ((97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })) }
Write-Host "> site: $SiteName" -ForegroundColor Cyan
$created = Invoke-Netlify @('sites:create', '--name', $SiteName, '--disable-linking') 2>&1
$siteId = [regex]::Match($created, '"id":\s*"([a-f0-9-]{36})"').Groups[1].Value
if (-not $siteId) {
  # name taken - the deploy below will tell us; try deploying to it anyway
  Write-Host $created
}

$deploy = Invoke-Netlify @('deploy', '--dir=dist', '--prod', '--site', $siteId, '--message', 'Race-Off deploy')
Write-Host $deploy
$live = [regex]::Match($deploy, 'https://[a-z0-9-]+\.netlify\.app').Value
if (-not $live) { Write-Error 'deploy did not return a URL'; exit 1 }

# --- 3. verify the live site
Write-Host "> verifying $live ..." -ForegroundColor Cyan
$fail = 0
foreach ($p in '/', '/manifest.webmanifest', '/sw.js', '/og-image.jpg', '/icon-192.png', '/companion-api/track') {
  try {
    $r = Invoke-WebRequest -Uri ($live + $p) -Method Head -UseBasicParsing -TimeoutSec 30
    Write-Host "  $p -> $($r.StatusCode)"
  } catch {
    Write-Host "  $p -> FAIL $($_.Exception.Message)" -ForegroundColor Red
    $fail++
  }
}
if ($fail -gt 0) { Write-Warning "$fail endpoint(s) failed - check the function logs in the Netlify dashboard" }
else { Write-Host 'LIVE AND HEALTHY - share the link!' -ForegroundColor Green }


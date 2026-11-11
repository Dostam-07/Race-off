# Race-Off deploy helper. dist/ is fully static - pick a host and go.
#
#   .\tools\deploy.ps1 netlify     -> npx netlify-cli deploy --dir=dist --prod
#   .\tools\deploy.ps1 vercel      -> npx vercel deploy dist --prod
#   .\tools\deploy.ps1 surge       -> npx surge dist <domain>
#   .\tools\deploy.ps1 pages       -> pushes dist/ to the gh-pages branch
#
# Each target asks for a one-time interactive login (browser or prompt) and
# remembers it. PWA + service worker require HTTPS - all four hosts provide it.
#
# GitHub Pages notes: run "pages" after adding a remote:
#   git remote add origin https://github.com/<user>/<repo>.git
# or push this repo to GitHub and let .github/workflows/deploy.yml do it on
# every push to main/master.

param(
  [Parameter(Position = 0)]
  [ValidateSet('netlify', 'vercel', 'surge', 'pages')]
  [string]$Target = 'netlify'
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# Always ship a fresh build.
Write-Host '> building dist/ ...' -ForegroundColor Cyan
npx vite build
if ($LASTEXITCODE -ne 0) { Write-Error 'build failed'; exit 1 }

switch ($Target) {
  'netlify' {
    Write-Host '> deploying to Netlify (browser login on first run)...' -ForegroundColor Cyan
    npx --yes netlify-cli@latest deploy --dir=dist --prod
  }
  'vercel' {
    Write-Host '> deploying to Vercel (login prompt on first run)...' -ForegroundColor Cyan
    npx --yes vercel@latest deploy dist --prod
  }
  'surge' {
    Write-Host '> deploying to Surge (email/password prompt on first run)...' -ForegroundColor Cyan
    npx --yes surge@latest dist --domain race-off.surge.sh
  }
  'pages' {
    Write-Host '> pushing dist/ to the gh-pages branch...' -ForegroundColor Cyan
    if (-not (git remote get-url origin 2>$null)) {
      Write-Error 'no git remote "origin" - add one first (git remote add origin ...)'
      exit 1
    }
    npx --yes gh-pages@latest -d dist
  }
}

Write-Host ''
Write-Host 'Done. Verify the live URL serves /manifest.webmanifest, /sw.js and /og-image.jpg' -ForegroundColor Green
Write-Host '(PWA + link previews need HTTPS - all four hosts provide it).' -ForegroundColor Green

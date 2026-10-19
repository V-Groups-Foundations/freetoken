# FreeToken one-line installer for Windows (PowerShell):
#   irm https://raw.githubusercontent.com/V-Groups-Foundations/freetoken/master/install.ps1 | iex
# Downloads FreeToken to ~\freetoken (git if you have it, otherwise a zip), installs it, and starts it -
# your browser opens already signed in. Safe to run again: it updates and restarts.
$ErrorActionPreference = 'Stop'
$repo = 'V-Groups-Foundations/freetoken'
$dir = if ($env:FREETOKEN_DIR) { $env:FREETOKEN_DIR } else { Join-Path $HOME 'freetoken' }

Write-Host "`n  FreeToken by V Groups - free AI for everyone`n" -ForegroundColor Cyan

$node = Get-Command node -ErrorAction SilentlyContinue
$ok = $false
if ($node) { $v = (node -v).TrimStart('v').Split('.'); $ok = [int]$v[0] -gt 20 -or ([int]$v[0] -eq 20 -and [int]$v[1] -ge 9) }
if (-not $ok) {
  Write-Host "  FreeToken needs Node.js 20.9 or newer." -ForegroundColor Yellow
  Write-Host "  Install it with:  winget install OpenJS.NodeJS.LTS   (or from https://nodejs.org)"
  Write-Host "  then open a new PowerShell window and run this installer again.`n"
  return
}

if (Test-Path (Join-Path $dir 'package.json')) {
  Write-Host "  Updating $dir"
  if ((Test-Path (Join-Path $dir '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) { git -C $dir pull --ff-only }
} elseif (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Host "  Downloading to $dir"
  git clone --depth 1 "https://github.com/$repo.git" $dir
} else {
  Write-Host "  Downloading to $dir (zip)"
  $zip = Join-Path $env:TEMP 'freetoken.zip'
  Invoke-WebRequest "https://codeload.github.com/$repo/zip/refs/heads/master" -OutFile $zip
  $tmp = Join-Path $env:TEMP ('freetoken-' + [guid]::NewGuid())
  Expand-Archive $zip $tmp
  Move-Item (Get-ChildItem $tmp | Select-Object -First 1).FullName $dir
  Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Set-Location $dir
Write-Host "  Installing (about a minute)..."
npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
Write-Host "`n  Starting FreeToken - your browser will open, already signed in." -ForegroundColor Green
Write-Host "  Next time: cd $dir; npm run dev     (V-Run desktop app: npm run desktop)`n"
npm run dev

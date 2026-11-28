Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js 20.19+ or 22.12+ is required. Install it from https://nodejs.org/' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}
if (-not (Test-Path 'node_modules')) {
  npm install
  if ($LASTEXITCODE -ne 0) { Read-Host 'Dependency installation failed. Press Enter'; exit $LASTEXITCODE }
}
npm run dev -- --host 127.0.0.1

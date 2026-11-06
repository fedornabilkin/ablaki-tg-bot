$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 26 and reopen PowerShell.'
}
$version = & node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v26\.') {
    throw 'This bot requires Node.js 26.'
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env'))) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.env.example') -Destination (Join-Path $PSScriptRoot '.env')
    throw 'Created .env. Fill TELEGRAM_BOT_TOKEN and TELEGRAM_AUTH_API_KEY, then run again.'
}

Push-Location (Join-Path $PSScriptRoot 'project')
try {
    if (-not (Test-Path -LiteralPath 'node_modules/.package-lock.json')) {
        & npm.cmd ci --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Could not install bot dependencies.' }
    }
    & npm.cmd start
    $botExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $botExitCode

param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.:-]*$')][string]$Server,
    [ValidateRange(1,65535)][int]$Port = 22,
    [Parameter(Mandatory=$true)][string]$KeyPath,
    [Parameter(Mandatory=$true)][string]$KnownHostsPath
)
$ErrorActionPreference = 'Stop'
$repo = 'fedornabilkin/ablaki-tg-bot'
foreach ($command in @('gh','ssh')) { Get-Command $command -ErrorAction Stop | Out-Null }
$KeyPath = (Resolve-Path -LiteralPath $KeyPath).Path
$KnownHostsPath = (Resolve-Path -LiteralPath $KnownHostsPath).Path
& gh auth status
if ($LASTEXITCODE -ne 0) { throw 'Run gh auth login first.' }
& ssh -i $KeyPath -p $Port -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KnownHostsPath" "ablakin-bot@$Server" 'test "$(id -un)" = ablakin-bot && test -w /opt/ablaki-tg-bot/releases && test -r /opt/ablaki-tg-bot/.env && docker info >/dev/null && docker compose version'
if ($LASTEXITCODE -ne 0) { throw 'SSH/Docker/directory check failed. No GitHub settings were changed.' }
$settings = [ordered]@{
    BOT_HOST = $Server
    BOT_PORT = [string]$Port
    BOT_USER = 'ablakin-bot'
    BOT_DEPLOY_PATH = '/opt/ablaki-tg-bot'
    BOT_SSH_KEY = [IO.File]::ReadAllText($KeyPath)
    BOT_KNOWN_HOSTS = [IO.File]::ReadAllText($KnownHostsPath)
}
try {
    foreach ($entry in $settings.GetEnumerator()) {
        $entry.Value | & gh secret set $entry.Key --repo $repo
        if ($LASTEXITCODE -ne 0) { throw "Failed to set $($entry.Key). Retry after fixing repository permissions." }
        Write-Host "Configured $($entry.Key)"
    }
} finally { $settings.Clear() }
& gh variable set BOT_DEPLOY_ENABLED --body false --repo $repo
if ($LASTEXITCODE -ne 0) { throw 'Failed to set the deployment switch.' }
Write-Host 'GitHub configured. Deployment remains disabled; run docker/check.ps1 next.'

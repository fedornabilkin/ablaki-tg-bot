param([ValidateSet('check','deploy','build')][string]$Operation = 'check')
$ErrorActionPreference = 'Stop'
$repo = 'fedornabilkin/ablaki-tg-bot'
Get-Command gh -ErrorAction Stop | Out-Null
& gh auth status
if ($LASTEXITCODE -ne 0) { throw 'Run gh auth login first.' }
if ($Operation -ne 'build') {
    $secretJson = & gh secret list --repo $repo --json name
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read GitHub secret names. Repository admin access is required.' }
    $names = @($secretJson | ConvertFrom-Json | ForEach-Object { $_.name })
    foreach ($name in @('BOT_HOST','BOT_PORT','BOT_USER','BOT_DEPLOY_PATH','BOT_SSH_KEY','BOT_KNOWN_HOSTS')) {
        if ($names -notcontains $name) { throw "Missing GitHub secret: $name. Run configure-github.ps1." }
    }
}
if ($Operation -eq 'deploy') {
    $enabled = & gh variable get BOT_DEPLOY_ENABLED --repo $repo --json value --jq .value
    if ($LASTEXITCODE -ne 0 -or "$enabled".Trim() -ne 'true') { throw 'Enable BOT_DEPLOY_ENABLED only after a successful check and stopping the local bot.' }
}
$checkId = [guid]::NewGuid().ToString('N')
& gh workflow run deploy.yml --repo $repo --ref master -f "operation=$Operation" -f "check_id=$checkId"
if ($LASTEXITCODE -ne 0) { throw 'Cannot start workflow. Check Actions permissions and that master contains the new workflow.' }
$runId = $null
$deadline = (Get-Date).AddSeconds(90)
do {
    $runsJson = & gh run list --repo $repo --workflow deploy.yml --event workflow_dispatch --limit 30 --json databaseId,displayTitle
    if ($LASTEXITCODE -ne 0) { throw 'Cannot list workflow runs.' }
    $matched = @(($runsJson | ConvertFrom-Json) | Where-Object { $_.displayTitle -like "*$checkId*" })
    if ($matched.Count -eq 1) { $runId = $matched[0].databaseId; break }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
if (!$runId) { throw "Workflow was submitted ($checkId) but has not appeared yet. Check the Actions page; do not dispatch duplicates." }
& gh run watch $runId --repo $repo --exit-status
if ($LASTEXITCODE -ne 0) {
    Write-Host "Details: gh run view $runId --repo $repo --log-failed"
    throw 'Checks/deployment failed. See the failed step above.'
}
Write-Host "SUCCESS: $Operation. https://github.com/$repo/actions/runs/$runId"

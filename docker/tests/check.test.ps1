$ErrorActionPreference = 'Stop'
# Mock only the GitHub CLI; no credentials, repository settings or server are used.
function global:gh {
    $global:LASTEXITCODE = 0
    $argText = $args -join ' '
    if ($argText -eq 'auth status') { return }
    if ($argText.StartsWith('secret list')) {
        $names = @('BOT_HOST','BOT_PORT','BOT_USER','BOT_SSH_KEY','BOT_KNOWN_HOSTS')
        if ($global:botCheckScenario -eq 'missing') { $names = @('BOT_HOST') }
        return ConvertTo-Json -Compress -InputObject @($names | ForEach-Object { @{name=$_} })
    }
    if ($argText.StartsWith('variable get')) { return 'true' }
    if ($argText.StartsWith('workflow run')) {
        $global:botCheckDispatched = $true
        $global:botCheckId = ($args | Where-Object { $_ -like 'check_id=*' }) -replace '^check_id=', ''
        return
    }
    if ($argText.StartsWith('run list')) {
        return ConvertTo-Json -Compress -InputObject @(
            @{databaseId=77;displayTitle="Telegram bot - $global:botCheckId"},
            @{databaseId=99;displayTitle='unrelated run'}
        )
    }
    if ($argText.StartsWith('run watch 77 ')) {
        $global:botCheckWatched = $true
        if ($global:botCheckScenario -eq 'failure') { $global:LASTEXITCODE = 1 }
        return
    }
    throw "Unexpected gh invocation: $argText"
}
try {
    $entry = Join-Path $PSScriptRoot '../check.ps1'
    foreach ($scenario in @('check','deploy','missing','failure')) {
        $global:botCheckScenario = $scenario
        $global:botCheckDispatched = $false
        $global:botCheckWatched = $false
        $failed = $false
        try {
            if ($scenario -eq 'deploy') { & $entry -Operation deploy } else { & $entry }
        } catch { $failed = $true }
        if ($scenario -in @('check','deploy')) {
            if ($failed -or !$global:botCheckDispatched -or !$global:botCheckWatched) { throw "Wrong successful workflow behavior: $scenario" }
        } elseif ($scenario -eq 'missing') {
            if (!$failed -or $global:botCheckDispatched) { throw 'Missing secrets must block dispatch' }
        } elseif (!$failed -or !$global:botCheckWatched) { throw 'Failed Actions run must fail the command' }
        Write-Output "PASS: $scenario (mock GitHub; no remote changes)"
    }
} finally {
    Remove-Item Function:\gh
    Remove-Variable -Scope Global -Name botCheckScenario,botCheckDispatched,botCheckWatched,botCheckId -ErrorAction SilentlyContinue
}
# The last scenario deliberately simulates gh exit 1; a passing test process exits 0.
$global:LASTEXITCODE = 0

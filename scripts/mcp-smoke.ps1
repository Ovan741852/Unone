[CmdletBinding()]
param(
    [string]$Project = 'D:/Projects/Unone_Games/minimal-2d'
)

$ErrorActionPreference = 'Stop'
$engineRoot = Split-Path -Parent $PSScriptRoot
$binaryPath = Join-Path $engineRoot 'target/debug/game.exe'

Push-Location $engineRoot
try {
    cargo build -p unone-cli
    if ($LASTEXITCODE -ne 0) {
        throw "unone-cli build failed with exit code $LASTEXITCODE"
    }

    $messages = @(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"unone-smoke","version":"1"}}}',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
        '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"unone_run","arguments":{"frames":2,"seed":42,"input_sequence":[{"actions":{"Right":true}},{"actions":{}}]}}}',
        '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"unone_run","arguments":{"action":"Right","input_sequence":[]}}}',
        '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"unone_asset_inspect","arguments":{}}}'
    )
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $binaryPath
    $processInfo.Arguments = '--project "' + $Project.Replace('"', '\"') + '" mcp'
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardInput = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $processInfo
    if (-not $process.Start()) {
        throw 'MCP server process could not start'
    }
    $inputText = ($messages -join "`n") + "`n"
    $utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
    $inputBytes = $utf8.GetBytes($inputText)
    $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
    $process.StandardInput.BaseStream.Flush()
    $process.StandardInput.BaseStream.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "MCP server exited with code $($process.ExitCode): $stderr"
    }
    $responses = @($stdout -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
    if ($responses.Count -ne 5) {
        throw "Expected 5 MCP responses, received $($responses.Count)"
    }

    $initialize = ConvertFrom-Json -InputObject ([string]$responses[0])
    $tools = ConvertFrom-Json -InputObject ([string]$responses[1])
    $run = ConvertFrom-Json -InputObject ([string]$responses[2])
    $conflict = ConvertFrom-Json -InputObject ([string]$responses[3])
    $asset = ConvertFrom-Json -InputObject ([string]$responses[4])
    $runPayload = ConvertFrom-Json -InputObject ([string](@($run.result.content)[0]).text)
    $conflictPayload = ConvertFrom-Json -InputObject ([string](@($conflict.result.content)[0]).text)
    $assetPayload = ConvertFrom-Json -InputObject ([string](@($asset.result.content)[0]).text)

    if ($initialize.result.protocolVersion -ne '2025-11-25') {
        throw "Unexpected negotiated protocol version: $($initialize.result.protocolVersion)"
    }
    if ($tools.result.tools.Count -ne 15) {
        throw "Unexpected MCP tool count: $($tools.result.tools.Count)"
    }
    if ($run.result.isError -ne $false -or $runPayload.ok -ne $true) {
        throw 'Deterministic MCP run failed'
    }
    if ($conflict.result.isError -ne $true -or @($conflictPayload.diagnostics)[0].code -ne 'MCP_ARGUMENT_CONFLICT') {
        throw 'MCP argument conflict did not produce the expected semantic diagnostic'
    }
    if ($asset.result.isError -ne $false -or $assetPayload.ok -ne $true -or @($assetPayload.diagnostics)[0].code -ne 'ASSET_MANIFEST_MISSING') {
        throw 'Asset inspect did not produce the expected semantic diagnostic'
    }

    Write-Output "MCP smoke passed: protocol=$($initialize.result.protocolVersion), tools=$(@($tools.result.tools).Count), digest=$($runPayload.value.observation_digest), conflict=$(@($conflictPayload.diagnostics)[0].code), asset=$(@($assetPayload.diagnostics)[0].code)"
}
finally {
    Pop-Location
}

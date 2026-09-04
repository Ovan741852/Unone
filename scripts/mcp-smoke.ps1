[CmdletBinding()]
param(
    [string]$Project = 'D:/Projects/Unone_Games/minimal-2d'
)

$ErrorActionPreference = 'Stop'
$engineRoot = Split-Path -Parent $PSScriptRoot
$binaryPath = Join-Path $engineRoot 'target/debug/game.exe'

Push-Location $engineRoot
try {
    if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
        cargo build -p unone-cli
        if ($LASTEXITCODE -ne 0) {
            throw "unone-cli build failed with exit code $LASTEXITCODE"
        }
    }

    $messages = @(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"unone-smoke","version":"1"}}}',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
        '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"unone_run","arguments":{"frames":2,"seed":42,"input_sequence":[{"actions":{"Right":true}},{"actions":{}}]}}}',
        '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"unone_run","arguments":{"action":"Right","input_sequence":[]}}}'
    )
    $responses = $messages | & $binaryPath --project $Project mcp
    if ($LASTEXITCODE -ne 0) {
        throw "MCP server exited with code $LASTEXITCODE"
    }
    if ($responses.Count -ne 4) {
        throw "Expected 4 MCP responses, received $($responses.Count)"
    }

    $initialize = $responses[0] | ConvertFrom-Json
    $tools = $responses[1] | ConvertFrom-Json
    $run = $responses[2] | ConvertFrom-Json
    $conflict = $responses[3] | ConvertFrom-Json
    $runPayload = $run.result.content[0].text | ConvertFrom-Json
    $conflictPayload = $conflict.result.content[0].text | ConvertFrom-Json

    if ($initialize.result.protocolVersion -ne '2025-11-25') {
        throw "Unexpected negotiated protocol version: $($initialize.result.protocolVersion)"
    }
    if ($tools.result.tools.Count -ne 10) {
        throw "Unexpected MCP tool count: $($tools.result.tools.Count)"
    }
    if ($run.result.isError -ne $false -or $runPayload.ok -ne $true) {
        throw 'Deterministic MCP run failed'
    }
    if ($conflict.result.isError -ne $true -or $conflictPayload.diagnostics[0].code -ne 'MCP_ARGUMENT_CONFLICT') {
        throw 'MCP argument conflict did not produce the expected semantic diagnostic'
    }

    Write-Output "MCP smoke passed: protocol=$($initialize.result.protocolVersion), tools=$($tools.result.tools.Count), digest=$($runPayload.value.observation_digest), conflict=$($conflictPayload.diagnostics[0].code)"
}
finally {
    Pop-Location
}

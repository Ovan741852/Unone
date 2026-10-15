param([ValidateRange(1024, 65535)][int]$Port = 8341)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'tools/serve.mjs') --port $Port
if ($LASTEXITCODE -ne 0) { throw 'Official player server failed. Export the game before launching it.' }

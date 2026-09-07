[CmdletBinding()]
param(
    [string]$Project = "."
)

$ErrorActionPreference = "Stop"
$engineRoot = Split-Path -Parent $PSScriptRoot
$Project = [IO.Path]::GetFullPath((Join-Path $engineRoot $Project))
$binaryPath = Join-Path $engineRoot "target\debug\game.exe"
$fixture = Join-Path $engineRoot "plugins\org.unone.blender\fixtures\scene.json"

if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
    throw "Missing $binaryPath. Run cargo build -p unone-cli first."
}

$test = & $binaryPath --project $Project --json plugin test --id org.unone.blender | ConvertFrom-Json
if (-not $test.ok -or $test.value.self_test -ne "passed") {
    throw "Blender plugin self-test failed: $($test | ConvertTo-Json -Depth 8)"
}

$preview = & $binaryPath --project $Project --json plugin call --id org.unone.blender --tool blender.preview --input $fixture | ConvertFrom-Json
if (-not $preview.ok -or $preview.value.preview -ne "semantic" -or $preview.value.entity_count -ne 2) {
    throw "Blender plugin preview failed: $($preview | ConvertTo-Json -Depth 8)"
}

Write-Output "plugin smoke passed: org.unone.blender self-test and semantic preview"

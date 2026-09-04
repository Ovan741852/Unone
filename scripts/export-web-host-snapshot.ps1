$ErrorActionPreference = 'Stop'
$project = 'D:\Projects\Unone_Games\angry-birds-2d'
$sequence = Join-Path $project 'tests\pointer-launch-sequence.json'
$outputPath = 'D:\Projects\Unone\web\host\snapshot.json'
$raw = (& cargo run --quiet -p unone-cli -- --project $project --json run --frames 60 --seed 42 --input-sequence $sequence | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw 'engine run failed; snapshot was not updated'
}
$result = $raw | ConvertFrom-Json
if (-not $result.ok) {
    throw 'engine returned a failed result; snapshot was not updated'
}
$result.value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $outputPath -Encoding utf8
Write-Output "exported engine snapshot: $outputPath"

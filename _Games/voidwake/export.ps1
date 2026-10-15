param([string]$Cli, [string]$Runtime)
$ErrorActionPreference = 'Stop'
$gameRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$engineRoot = [IO.Path]::GetFullPath((Join-Path $gameRoot '../..'))
if (-not (Test-Path -LiteralPath (Join-Path $engineRoot 'web/player/index.html') -PathType Leaf)) {
    throw 'Run this example from its Unone source checkout under _Games/voidwake.'
}
if (-not $Cli) {
    $Cli = Join-Path $engineRoot 'target/debug/game.exe'
    if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) {
        $Cli = Join-Path $engineRoot 'target/release/game.exe'
    }
}
$Cli = [IO.Path]::GetFullPath($Cli)
if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) {
    throw 'Build the current Unone CLI with cargo build -p unone-cli, or pass -Cli.'
}
if (-not $Runtime) { $Runtime = Join-Path $gameRoot 'dist/player-runtime' }
$Runtime = [IO.Path]::GetFullPath($Runtime)
if (-not (Test-Path -LiteralPath (Join-Path $Runtime 'runtime.json') -PathType Leaf)) {
    throw 'Build a matching release runtime with scripts/build-web-live.ps1 -Player -Project _Games/voidwake, or pass -Runtime.'
}
$selection = Get-Content -LiteralPath (Join-Path $gameRoot 'player.presentation.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ($selection.renderer_mode -ne 'official') { throw 'This example requires the official Unone renderer.' }

& node (Join-Path $gameRoot 'tools/compose-game.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Game source composition failed.' }

$generation = [Guid]::NewGuid().ToString('N')
$staging = [IO.Path]::GetFullPath((Join-Path $gameRoot ('.unone/player-export-' + $generation)))
$destination = [IO.Path]::GetFullPath((Join-Path $gameRoot 'dist/player'))
$backup = [IO.Path]::GetFullPath((Join-Path $gameRoot ('.unone/player-previous-' + $generation)))
$boundary = $gameRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($target in @($staging, $destination, $backup)) {
    if (-not $target.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Export target escaped the example project directory.'
    }
}
New-Item -ItemType Directory -Force -Path (Join-Path $gameRoot '.unone') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $gameRoot 'dist') | Out-Null
Push-Location $engineRoot
try {
    $packed = & $Cli --project $gameRoot --json bundle pack --output '.unone/bundles/manifest.json'
    if ($LASTEXITCODE -ne 0) { throw ('Official source bundle preparation failed: ' + ($packed -join "`n")) }
    $packReport = ($packed -join "`n") | ConvertFrom-Json
    if (-not $packReport.ok) { throw 'The source bundles were not prepared.' }
    $raw = & $Cli --project $gameRoot --json export web --runtime $Runtime --output $staging
    if ($LASTEXITCODE -ne 0) { throw ('Official player export failed: ' + ($raw -join "`n")) }
    $report = ($raw -join "`n") | ConvertFrom-Json
    if (-not $report.ok -or $report.value.renderer_mode -ne 'official') {
        throw 'The export did not confirm official renderer selection.'
    }
} finally { Pop-Location }
if (Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination $backup }
try { Move-Item -LiteralPath $staging -Destination $destination } catch {
    if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $destination)) {
        Move-Item -LiteralPath $backup -Destination $destination
    }
    throw
}
[pscustomobject]@{
    path = $destination
    renderer_mode = $report.value.renderer_mode
    renderer = $report.value.renderer
    release_root = $report.value.release_root
} | ConvertTo-Json

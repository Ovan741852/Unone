param(
    [Parameter(Mandatory = $true)][string]$Sdk,
    [string]$Analyzer
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$sdkRoot = [IO.Path]::GetFullPath($Sdk)
$sdkManifestPath = Join-Path $sdkRoot 'sdk.json'
if (-not (Test-Path -LiteralPath $sdkManifestPath -PathType Leaf)) {
    throw 'Pass -Sdk with the root of an extracted portable Unone SDK containing sdk.json.'
}
$sdkManifest = Get-Content -LiteralPath $sdkManifestPath -Raw -Encoding utf8 | ConvertFrom-Json
$cli = [IO.Path]::GetFullPath((Join-Path $sdkRoot $sdkManifest.cli))
$sdkBoundary = $sdkRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $cli.StartsWith($sdkBoundary, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $cli -PathType Leaf)) {
    throw 'The SDK manifest must name an existing CLI inside that SDK.'
}
if ($Analyzer) {
    $Analyzer = [IO.Path]::GetFullPath($Analyzer)
    if (-not (Test-Path -LiteralPath $Analyzer -PathType Leaf)) {
        throw 'Pass -Analyzer with the official luau-analyze executable, or configure UNONE_LUAU_ANALYZER.'
    }
}
$presentation = Get-Content -LiteralPath (Join-Path $projectRoot 'player.presentation.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ($presentation.renderer_mode -ne 'official') {
    throw 'This example requires the official Unone player.'
}

$generation = [Guid]::NewGuid().ToString('N')
$staging = [IO.Path]::GetFullPath((Join-Path $projectRoot ('.unone/player-export-' + $generation)))
$licenseStaging = [IO.Path]::GetFullPath((Join-Path $projectRoot ('.unone/font-licenses-' + $generation)))
$destination = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist/player'))
$licenseDestination = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist/font-licenses'))
$backup = [IO.Path]::GetFullPath((Join-Path $projectRoot ('.unone/player-previous-' + $generation)))
$licenseBackup = [IO.Path]::GetFullPath((Join-Path $projectRoot ('.unone/font-licenses-previous-' + $generation)))
$boundary = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($target in @($staging, $licenseStaging, $destination, $licenseDestination, $backup, $licenseBackup)) {
    if (-not $target.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'A generated output path escaped the example project.'
    }
}
New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot '.unone') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'dist') | Out-Null

$oldAnalyzer = $env:UNONE_LUAU_ANALYZER
$oldEncoding = [Console]::OutputEncoding
try {
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    if ($Analyzer) { $env:UNONE_LUAU_ANALYZER = $Analyzer }
    # The public SDK command owns verify, bundle synchronization and export.
    # Do not reconstruct runtime/template/bundle internals in this launcher.
    $raw = & $cli --sdk $sdkRoot --project $projectRoot --json project prepare --target web --output $staging
    $exitCode = $LASTEXITCODE
    $rawText = $raw -join "`n"
    $rawText | Set-Content -LiteralPath (Join-Path $projectRoot '.unone/last-prepare.json') -Encoding utf8
    if ($exitCode -ne 0) { throw ('Official project preparation failed: ' + $rawText) }
    $report = $rawText | ConvertFrom-Json
    if (-not $report.ok -or $report.value.status -ne 'ready' -or
        $report.value.export.renderer_mode -ne 'official' -or
        $report.value.launch.kind -ne 'static' -or
        -not (Test-Path -LiteralPath (Join-Path $staging 'index.html') -PathType Leaf)) {
        throw 'The SDK did not return a ready official static Web player.'
    }

    # Notices are a companion to the untouched, inventoried official export.
    New-Item -ItemType Directory -Path $licenseStaging | Out-Null
    foreach ($name in @('barlowcondensed-LICENSE.txt', 'notosanstc-LICENSE.txt', 'sharetechmono-LICENSE.txt')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot ('fonts/' + $name)) -Destination $licenseStaging
    }

    $movedPlayer = $false
    $movedLicenses = $false
    $publishedPlayer = $false
    $publishedLicenses = $false
    try {
        if (Test-Path -LiteralPath $destination) {
            Move-Item -LiteralPath $destination -Destination $backup
            $movedPlayer = $true
        }
        if (Test-Path -LiteralPath $licenseDestination) {
            Move-Item -LiteralPath $licenseDestination -Destination $licenseBackup
            $movedLicenses = $true
        }
        Move-Item -LiteralPath $licenseStaging -Destination $licenseDestination
        $publishedLicenses = $true
        Move-Item -LiteralPath $staging -Destination $destination
        $publishedPlayer = $true
    } catch {
        # Retain every generation for inspection; no recursive deletion is needed.
        if ($publishedPlayer) { Move-Item -LiteralPath $destination -Destination $staging }
        if ($publishedLicenses) { Move-Item -LiteralPath $licenseDestination -Destination $licenseStaging }
        if ($movedPlayer) { Move-Item -LiteralPath $backup -Destination $destination }
        if ($movedLicenses) { Move-Item -LiteralPath $licenseBackup -Destination $licenseDestination }
        throw
    }
    [pscustomobject]@{
        path = $destination
        entry = 'index.html'
        renderer_mode = $report.value.export.renderer_mode
        font_licenses = $licenseDestination
        previous_player = if ($movedPlayer) { $backup } else { $null }
    } | ConvertTo-Json
} finally {
    [Console]::OutputEncoding = $oldEncoding
    $env:UNONE_LUAU_ANALYZER = $oldAnalyzer
}

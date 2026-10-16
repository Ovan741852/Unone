param(
    [Parameter(Mandatory = $true)][string]$Sdk,
    [string]$Analyzer,
    [ValidateRange(1, 65535)][int]$Port = 8196,
    [switch]$OpenBrowser
)
$ErrorActionPreference = 'Stop'
$arguments = @{ Sdk = $Sdk }
if ($Analyzer) { $arguments.Analyzer = $Analyzer }
& (Join-Path $PSScriptRoot 'export.ps1') @arguments
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Use a static HTTP server for dist/player, or install Python to use this optional launcher.'
}
$url = 'http://127.0.0.1:' + $Port + '/'
Write-Host ('Official player: ' + $url)
Write-Host 'The static server stays in this terminal. Press Ctrl+C to stop it.'
if ($OpenBrowser) { Start-Process -FilePath $url }
& python -m http.server $Port --bind 127.0.0.1 --directory (Join-Path $PSScriptRoot 'dist/player')

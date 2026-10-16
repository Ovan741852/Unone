param(
    [Parameter(Mandatory = $true)][string]$Sdk,
    [string]$Analyzer,
    [ValidateRange(1, 65535)][int]$Port = 8196,
    [switch]$OpenBrowser
)
$ErrorActionPreference = 'Stop'
$sdkRoot = [IO.Path]::GetFullPath($Sdk)
$previewServer = Join-Path $sdkRoot 'scripts/serve-player.py'
if (-not (Test-Path -LiteralPath $previewServer -PathType Leaf)) {
    throw 'This SDK is missing scripts/serve-player.py. Update the portable Unone SDK, or export with export.ps1 and use a static host that serves .js/.mjs with a JavaScript MIME type and .wasm as application/wasm.'
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Install Python 3 to use the SDK preview helper, or export with export.ps1 and use a static host that serves .js/.mjs with a JavaScript MIME type and .wasm as application/wasm.'
}
$arguments = @{ Sdk = $sdkRoot }
if ($Analyzer) { $arguments.Analyzer = $Analyzer }
& (Join-Path $PSScriptRoot 'export.ps1') @arguments
$url = 'http://127.0.0.1:' + $Port + '/'
Write-Host ('Official player: ' + $url)
Write-Host 'The static server stays in this terminal. Press Ctrl+C to stop it.'
if ($OpenBrowser) { Start-Process -FilePath $url }
& python $previewServer --directory (Join-Path $PSScriptRoot 'dist/player') --port $Port --bind 127.0.0.1 --no-cache
if ($LASTEXITCODE -ne 0) { throw ('The SDK preview helper exited with code ' + $LASTEXITCODE + '.') }

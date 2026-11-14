param([int]$Port=8240, [switch]$NoBrowser)
$ErrorActionPreference='Stop'
$gameRoot=Join-Path $PSScriptRoot 'artifacts\playable'
$gameServer=Join-Path $PSScriptRoot 'scripts\serve-game.py'
if(-not(Test-Path -LiteralPath (Join-Path $gameRoot 'index.html'))){throw 'Play build missing: artifacts/playable/index.html'}
$gameUrl="http://127.0.0.1:$Port/"
if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalAddress -in @('127.0.0.1','0.0.0.0','::','::1')}){
  Write-Host "Local server already listening. Open $gameUrl"
  if(-not $NoBrowser){Start-Process $gameUrl}
  return
}
$gamePython='C:\Program Files\Python312\python.exe'
if(-not(Test-Path -LiteralPath $gamePython)){$gamePython=(Get-Command python -ErrorAction Stop).Source}
Write-Host "Open $gameUrl   (Ctrl+C stops the local server)"
if(-not $NoBrowser){Start-Process $gameUrl}
& $gamePython $gameServer $gameRoot --port $Port --gzip

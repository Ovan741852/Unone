param([int]$Port=8240, [string]$BindAddress='')
$ErrorActionPreference='Stop'
if(-not $BindAddress){
  $lanInterface=Get-NetIPConfiguration | Where-Object {$_.IPv4DefaultGateway -and $_.IPv4Address} | Select-Object -First 1
  $BindAddress=$lanInterface.IPv4Address.IPAddress | Select-Object -First 1
}
if(-not $BindAddress -or -not(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $BindAddress -ErrorAction SilentlyContinue)){
  throw 'An active local IPv4 address is required.'
}
$lanBuildRoot=Join-Path $PSScriptRoot 'artifacts\playable'
$lanRelease=(Get-Content -Raw -LiteralPath (Join-Path $lanBuildRoot 'CURRENT.json') | ConvertFrom-Json).release
if($lanRelease -notmatch '^release-\d+$'){throw 'Invalid current release.'}
$lanGameRoot=Join-Path $lanBuildRoot $lanRelease
if(-not(Test-Path -LiteralPath (Join-Path $lanGameRoot 'index.html'))){throw 'Current playable build is missing.'}
$lanUrl="http://${BindAddress}:$Port/"
if(Get-NetTCPConnection -LocalAddress $BindAddress -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){
  Write-Host "Server already listening: $lanUrl"
  return
}
$lanPython='C:\Program Files\Python312\python.exe'
if(-not(Test-Path -LiteralPath $lanPython)){$lanPython=(Get-Command python -ErrorAction Stop).Source}
Write-Host "LAN game: $lanUrl ($lanRelease)"
Write-Host 'Ctrl+C stops this server.'
& $lanPython (Join-Path $PSScriptRoot 'scripts\serve-game.py') $lanGameRoot --port $Port --bind $BindAddress --gzip

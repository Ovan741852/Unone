param([int]$Port=8242)
$ErrorActionPreference='Stop'
$toolPython='C:\Program Files\Python312\python.exe'
if(-not(Test-Path -LiteralPath $toolPython)){$toolPython=(Get-Command python -ErrorAction Stop).Source}
$toolTemp=Join-Path $PSScriptRoot '.cache\tmp'
New-Item -ItemType Directory -Force -Path $toolTemp | Out-Null
$env:TEMP=$toolTemp
$env:TMP=$toolTemp
$env:PYTHONIOENCODING='utf-8'
$toolListener=Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if($toolListener){
  $toolInfo=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/info" -TimeoutSec 5
  if($toolInfo.workspace -ne $PSScriptRoot -or $toolInfo.schema -ne 'hotchick.media.recipe.v1'){throw 'This port belongs to another service.'}
  Write-Host "Media workbench already running: http://127.0.0.1:$Port/"
  return
}
Write-Host "Media workbench: http://127.0.0.1:$Port/"
Write-Host 'Ctrl+C stops the local workbench.'
& $toolPython (Join-Path $PSScriptRoot 'scripts\media-tool\media_tool.py') serve --host 127.0.0.1 --port $Port

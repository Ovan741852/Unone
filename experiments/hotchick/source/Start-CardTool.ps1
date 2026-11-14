param([int]$Port=8243)
$ErrorActionPreference='Stop'
$cardPython='C:\Program Files\Python312\python.exe'
if(-not(Test-Path -LiteralPath $cardPython)){$cardPython=(Get-Command python -ErrorAction Stop).Source}
$cardTemp=Join-Path $PSScriptRoot '.cache\tmp'
New-Item -ItemType Directory -Force -Path $cardTemp | Out-Null
$env:TEMP=$cardTemp
$env:TMP=$cardTemp
$env:PYTHONIOENCODING='utf-8'
if(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){
  $cardInfo=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/info" -TimeoutSec 5
  if($cardInfo.workspace -ne $PSScriptRoot -or $cardInfo.schema -ne 'hotchick.cards.recipe.v1'){throw 'This port belongs to another service.'}
  Write-Host "Card workbench already running: http://127.0.0.1:$Port/"
  return
}
Write-Host "Card workbench: http://127.0.0.1:$Port/"
Write-Host 'Ctrl+C stops the local card workbench.'
& $cardPython (Join-Path $PSScriptRoot 'scripts\card-tool\card_tool.py') serve --host 127.0.0.1 --port $Port

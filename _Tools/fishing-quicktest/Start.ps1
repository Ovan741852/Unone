param([int]$Port=8194)
$ErrorActionPreference='Stop'
$quicktestUrl="http://127.0.0.1:$Port"
$quicktestRunning=$false
try {$quicktestInfo=Invoke-RestMethod "$quicktestUrl/api/catalog" -TimeoutSec 2;$quicktestRunning=$quicktestInfo.application -eq 'unone-fishing-quicktest'} catch {}
if(-not $quicktestRunning){
  $quicktestNode=(Get-Command node -ErrorAction Stop).Source
  $env:QUICKTEST_PORT=[string]$Port
  Start-Process -FilePath $quicktestNode -ArgumentList 'serve.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
  for($quicktestAttempt=0;$quicktestAttempt -lt 30;$quicktestAttempt++){
    Start-Sleep -Milliseconds 200
    try {$quicktestInfo=Invoke-RestMethod "$quicktestUrl/api/catalog" -TimeoutSec 1;if($quicktestInfo.application -eq 'unone-fishing-quicktest'){$quicktestRunning=$true;break}} catch {}
  }
}
if(-not $quicktestRunning){throw "Quicktest failed to start on port $Port. Run node serve.mjs to inspect the error."}
Start-Process -FilePath $quicktestUrl -WindowStyle Hidden

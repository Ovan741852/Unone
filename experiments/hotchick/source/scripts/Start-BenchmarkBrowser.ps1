param([int]$Port=9237)
$ErrorActionPreference='Stop'
$benchWorkspace=Split-Path -Parent $PSScriptRoot
$benchProfile=Join-Path $benchWorkspace '.cache\benchmark-chrome'
$benchTemp=Join-Path $benchWorkspace '.cache\tmp'
New-Item -ItemType Directory -Force -Path $benchTemp | Out-Null
$env:TEMP=$benchTemp
$env:TMP=$benchTemp
if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){
  $benchVersion=Invoke-RestMethod "http://127.0.0.1:$Port/json/version"
  Write-Host "CDP already available: $($benchVersion.Browser) on $Port"
  return
}
$benchChrome='C:\Program Files\Google\Chrome\Application\chrome.exe'
if(-not(Test-Path -LiteralPath $benchChrome)){throw 'Google Chrome was not found at the expected path.'}
$benchArguments=@('--headless=new','--enable-gpu','--use-angle=d3d11','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--autoplay-policy=no-user-gesture-required',"--remote-debugging-port=$Port","--user-data-dir=$benchProfile",'--window-size=1280,720','--force-device-scale-factor=1','about:blank')
$benchProcess=Start-Process -FilePath $benchChrome -ArgumentList $benchArguments -WindowStyle Hidden -PassThru
Write-Host "Benchmark Chrome PID=$($benchProcess.Id), CDP=$Port. Probe actual GPU before interpreting measurements."

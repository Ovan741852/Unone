param([int]$Port=8190,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$gameDirectory=$PSScriptRoot
$exportDirectory=Join-Path $gameDirectory 'dist/web'
if(-not (Test-Path -LiteralPath (Join-Path $exportDirectory 'index.html'))){throw 'Web export missing. Follow README.md to build the game first.'}
if($Port -lt 1024 -or $Port -gt 65535){throw 'Choose a port between 1024 and 65535.'}
$gameUrl="http://127.0.0.1:$Port/"
$alreadyRunning=$false
try {
 $existing=Invoke-RestMethod -Uri ($gameUrl+'content/project.json') -TimeoutSec 2
 $alreadyRunning=$existing.config.name -like '*ASHEN LEGION*'
 if(-not $alreadyRunning){throw "Port $Port serves a different application."}
} catch {
 if($_.Exception.Message -like '*different application*'){throw}
}
if(-not $alreadyRunning){
 $pythonExecutable=(Get-Command python -ErrorAction Stop).Source
 $serverScript=[IO.Path]::GetFullPath((Join-Path $gameDirectory '../../scripts/serve-player.py'))
 $arguments=@(('"'+$serverScript+'"'),('"'+$exportDirectory+'"'),'--port',"$Port")
 $serverProcess=Start-Process -FilePath $pythonExecutable -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $gameDirectory 'dist/server.log') -RedirectStandardError (Join-Path $gameDirectory 'dist/server-error.log')
 $isReady=$false
 for($attempt=0;$attempt -lt 40;$attempt++){
  if($serverProcess.HasExited){throw 'The local game server could not start. Check dist/server-error.log.'}
  try {$response=Invoke-RestMethod -Uri ($gameUrl+'content/project.json') -TimeoutSec 1;if($response.config.name -like '*ASHEN LEGION*'){$isReady=$true;break}} catch {}
  Start-Sleep -Milliseconds 150
 }
 if(-not $isReady){throw 'The local server did not become ready.'}
}
if(-not $NoBrowser){Start-Process $gameUrl}
Write-Host "ASHEN LEGION is ready: $gameUrl"

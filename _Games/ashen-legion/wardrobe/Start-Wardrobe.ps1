param([int]$Port=8192,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
if($Port -lt 1024 -or $Port -gt 65535){throw 'Invalid port'}
$viewerRoot=$PSScriptRoot
if(-not(Test-Path -LiteralPath (Join-Path $viewerRoot 'vendor/package/build/three.module.js'))){
 New-Item -ItemType Directory -Force (Join-Path $viewerRoot 'vendor') | Out-Null
 Invoke-WebRequest 'https://registry.npmjs.org/three/-/three-0.179.1.tgz' -OutFile (Join-Path $viewerRoot 'vendor/three.tgz')
 & tar -xzf (Join-Path $viewerRoot 'vendor/three.tgz') -C (Join-Path $viewerRoot 'vendor')
 if($LASTEXITCODE -ne 0){throw 'Three.js extraction failed'}
}
$viewerUrl="http://127.0.0.1:$Port/"
$running=$false
try{$response=Invoke-WebRequest $viewerUrl -TimeoutSec 2;if($response.Content -notlike '*CHARACTER LAB*'){throw 'Port occupied by another app'};$running=$true}catch{if($_.Exception.Message -like '*Port occupied*'){throw}}
if(-not $running){
 $server=[IO.Path]::GetFullPath((Join-Path $viewerRoot '../../../scripts/serve-player.py'))
 Start-Process -FilePath (Get-Command python).Source -ArgumentList @(('"'+$server+'"'),('"'+$viewerRoot+'"'),'--port',"$Port") -WindowStyle Hidden | Out-Null
 for($i=0;$i -lt 30;$i++){try{Invoke-WebRequest $viewerUrl -TimeoutSec 1 | Out-Null;break}catch{Start-Sleep -Milliseconds 150}}
}
if(-not $NoBrowser){Start-Process $viewerUrl}
Write-Host "Wardrobe: $viewerUrl"

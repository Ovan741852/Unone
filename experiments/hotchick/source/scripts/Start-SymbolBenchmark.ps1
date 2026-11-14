param([int]$Port=8237)
$ErrorActionPreference='Stop'
$benchRoot=Split-Path -Parent $PSScriptRoot
$benchUrl="http://127.0.0.1:$Port/"
if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){
  $benchPage=Invoke-WebRequest -Uri $benchUrl -UseBasicParsing
  if($benchPage.Content -notmatch 'Unone 多 Symbol 效能測試'){throw "Port $Port is in use by another service."}
  Write-Host "Benchmark is already running: $benchUrl"
  return
}
Write-Host "Open $benchUrl in Chrome or Edge. Ctrl+C stops the server."
& python (Join-Path $PSScriptRoot 'serve_symbol_benchmark.py') --port $Port

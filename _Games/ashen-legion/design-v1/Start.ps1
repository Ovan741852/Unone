$designRoot = $PSScriptRoot
$designListening = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8288 -State Listen -ErrorAction SilentlyContinue
if (-not $designListening) {
    $designNode = (Get-Command node -ErrorAction Stop).Source
    Start-Process -FilePath $designNode -ArgumentList ('"' + (Join-Path $designRoot 'serve.mjs') + '"') -WorkingDirectory $designRoot -WindowStyle Hidden
}
Start-Process 'http://127.0.0.1:8288'

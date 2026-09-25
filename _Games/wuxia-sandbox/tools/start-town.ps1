param([int]$Port=8088,[int]$NativePort=55433,[string]$NanoJevRoot='C:\Users\liNao\Documents\ComfyUI\NanoJev',[switch]$NoAI)
$ErrorActionPreference='Stop'
$townRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$engineRoot=(Resolve-Path -LiteralPath (Join-Path $townRoot '../..')).Path
$gameExe=Join-Path $engineRoot 'target/release/game.exe'
if (-not (Test-Path -LiteralPath $gameExe)) { throw 'Build Unone release CLI before starting the town.' }
$nativeListener=Get-NetTCPConnection -LocalPort $NativePort -State Listen -ErrorAction SilentlyContinue
if (-not $nativeListener) {
    & $gameExe --project $townRoot bundle pack | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Asset packing failed' }
    & $gameExe --project $townRoot bundle install --all | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Asset installation failed' }
    Start-Process -FilePath $gameExe -ArgumentList @('--project',"`"$townRoot`"",'preview','--tools-port',$NativePort) -WorkingDirectory $engineRoot -WindowStyle Hidden
} else {
    $snapshot=Invoke-RestMethod "http://127.0.0.1:$NativePort/request" -Method Post -ContentType 'application/json' -Body '{"method":"snapshot"}'
    if ($snapshot.value.observation.world.observations.town_size.width -ne 180) { throw "Port $NativePort is not running this version of the town. Stop that preview explicitly, then retry." }
    if ($snapshot.value.observation.world.observations.nanoj_decision_backend -ne 'nanojev-external-no-fallback') { throw 'An older rule-AI preview is still running. Stop that specific preview and restart.' }
    if (-not $snapshot.value.observation.world.observations.view_model.npc[0].identity.values) { throw 'An older preview without resident identities is running. Stop that specific preview and restart to load current Luau.' }
    if ($snapshot.value.observation.world.observations.decision_protocol -ne 'lookahead-v2') { throw 'This preview uses an older decision protocol. Restart the specific town preview and its NanoJev worker.' }
}
if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    $pythonExe=(Get-Command python).Source
    $hostScript=Join-Path $PSScriptRoot 'serve-town.py'
    Start-Process -FilePath $pythonExe -ArgumentList @("`"$hostScript`"",'--port',$Port,'--native-port',$NativePort) -WorkingDirectory $townRoot -WindowStyle Hidden
}
if (-not $NoAI) {
    $modelPython=Join-Path $NanoJevRoot '.venv-town/Scripts/python.exe'
    $agentScript=Join-Path $PSScriptRoot 'nanojev-agent.py'
    if (-not (Test-Path -LiteralPath $modelPython)) { throw 'NanoJev isolated Python is missing. See README.md for setup; no fallback AI was started.' }
    if (-not (Test-Path -LiteralPath (Join-Path $NanoJevRoot 'checkpoints/NanoJev/best.safetensors'))) { throw 'NanoJev checkpoint is missing; no fallback AI was started.' }
    $recordedAgentPid=0
    $agentStatusPath=Join-Path $townRoot '.runtime/nanojev-status.json'
    if (Test-Path -LiteralPath $agentStatusPath) { try { $recordedAgentPid=(Get-Content -LiteralPath $agentStatusPath -Raw | ConvertFrom-Json).pid } catch {} }
    $agentProcess=Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*nanojev-agent.py*' -and ($_.CommandLine -like '*wuxia-sandbox*' -or $_.ProcessId -eq $recordedAgentPid) }
    if (-not $agentProcess) {
        Start-Process -FilePath $modelPython -ArgumentList @("`"$agentScript`"",'--repo',"`"$NanoJevRoot`"",'--native',"http://127.0.0.1:$NativePort") -WorkingDirectory $townRoot -WindowStyle Hidden
    }
}
Write-Output "Game: http://127.0.0.1:$Port/"
Write-Output "Native diagnostics only: http://127.0.0.1:$NativePort/"

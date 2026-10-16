$ErrorActionPreference = 'Stop'
$engineRoot = 'D:/TSProject/Voidwake/engine'
$buildEvidence = Join-Path $engineRoot 'artifacts/voidwake-responsive-fx/build'
$buildCli = 'D:/TSProject/Voidwake/game/tools/build/native/release/game.exe'
$runtimeRoot = Join-Path $buildEvidence 'runtime-web'
$sdkRoot = 'D:/TSProject/UnoneVoidwake-20261016/sdk-final'
if(Test-Path -LiteralPath $sdkRoot) { throw ('Preserving existing SDK; output already exists: '+$sdkRoot) }
& $buildCli --json sdk pack --source-root $engineRoot --runtime $runtimeRoot --output $sdkRoot > (Join-Path $buildEvidence 'sdk-pack.json')
if($LASTEXITCODE -ne 0) { throw 'SDK pack failed' }
$sdkCli = Join-Path $sdkRoot 'bin/game.exe'
& $sdkCli --sdk $sdkRoot --json sdk inspect > (Join-Path $buildEvidence 'sdk-inspect.json')
if($LASTEXITCODE -ne 0) { throw 'SDK inspect failed' }
$inspection = Get-Content (Join-Path $buildEvidence 'sdk-inspect.json') -Raw -Encoding utf8 | ConvertFrom-Json
if(-not $inspection.ok) { throw 'SDK inspect reported ok=false' }
$inventory = @($inspection.value.sources.runtime_packages.files)
$verification = @()
foreach($file in $inventory) {
 $installedFile = Join-Path $sdkRoot $file.relative_path
 $sourceFile = Join-Path $engineRoot $file.relative_path
 $installedHash = (Get-FileHash -LiteralPath $installedFile).Hash.ToLowerInvariant()
 $sourceHash = (Get-FileHash -LiteralPath $sourceFile).Hash.ToLowerInvariant()
 $verification += @{relative_path=$file.relative_path;inventory_sha256=$file.sha256;installed_sha256=$installedHash;source_sha256=$sourceHash;matches=($installedHash -eq $sourceHash -and $installedHash -eq $file.sha256)}
}
if(@($verification | Where-Object {-not $_.matches}).Count -ne 0) { throw 'SDK source inventory mismatch' }
[IO.File]::WriteAllText((Join-Path $buildEvidence 'sdk-source-verification.json'),(@{sdk=$sdkRoot;verified_files=$verification.Count;files=$verification} | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$runtimeInfo = Get-Content (Join-Path $runtimeRoot 'runtime.json') -Raw -Encoding utf8 | ConvertFrom-Json
$releaseRecord = @{
 sdk=$sdkRoot;cli=$sdkCli
 cli_sha256=(Get-FileHash -LiteralPath $sdkCli).Hash.ToLowerInvariant()
 compiled_cli_sha256=(Get-FileHash -LiteralPath $buildCli).Hash.ToLowerInvariant()
 wasm_sha256=$runtimeInfo.wasm_sha256;javascript_sha256=$runtimeInfo.javascript_sha256
 runtime_packages=$runtimeInfo.runtime_packages;compiled_systems=$runtimeInfo.compiled_systems
 source_inventory_count=$verification.Count
 preserved_responsive_sdk_cli_sha256=(Get-FileHash -LiteralPath 'D:/TSProject/UnoneResponsive-20261016/sdk-final/bin/game.exe').Hash.ToLowerInvariant()
 preserved_responsive_sdk_wasm_sha256=(Get-FileHash -LiteralPath 'D:/TSProject/UnoneResponsive-20261016/sdk-final/runtimes/web-production-0/unone_player.wasm').Hash.ToLowerInvariant()
}
if($releaseRecord.cli_sha256 -ne $releaseRecord.compiled_cli_sha256) { throw 'SDK CLI differs from compiled CLI' }
if($releaseRecord.preserved_responsive_sdk_cli_sha256 -ne '8b200e78c6d4bc65cbd335369c7ce18f61e800fa5cdbbe5f8be934c5ff00e083') { throw 'Frozen previous SDK CLI changed' }
if($releaseRecord.preserved_responsive_sdk_wasm_sha256 -ne 'eefd60555314bfb164de7598566912f01a98514001efcd69a90a4dab1421d4da') { throw 'Frozen previous SDK WASM changed' }
[IO.File]::WriteAllText((Join-Path $buildEvidence 'release-artifacts.json'),($releaseRecord | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
Write-Output ($releaseRecord | ConvertTo-Json -Depth 8)

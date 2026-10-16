$ErrorActionPreference = 'Stop'
$engineRoot = 'D:/TSProject/Voidwake/engine'
$buildEvidence = Join-Path $engineRoot 'artifacts/voidwake-responsive-fx/build'
$env:CARGO_TARGET_DIR = 'D:/TSProject/Voidwake/game/tools/build/native'
$buildSteps = @(
 @{name='test-json-numeric-roundtrip'; argv=@('+1.95.0','test','-p','unone-engine','--release','--test','json_numeric_roundtrip')},
 @{name='test-web-publication-roundtrip'; argv=@('+1.95.0','test','-p','unone-web-live-smoke','--release','web_publication_preserves_binary64_through_instance_envelope')},
 @{name='workspace-tests'; argv=@('+1.95.0','test','--workspace','--release')},
 @{name='clippy'; argv=@('+1.95.0','clippy','--workspace','--all-targets','--release','--','-D','warnings')},
 @{name='build-cli'; argv=@('+1.95.0','build','-p','unone-cli','--release')}
)
$buildRecords = @()
foreach($buildStep in $buildSteps) {
 $taskArguments = $buildStep.argv
 $logPath = Join-Path $buildEvidence ($buildStep.name+'.txt')
 $startedAt = [DateTime]::UtcNow
 Write-Output ('Running '+$buildStep.name)
 & cargo @taskArguments *> $logPath
 $stepExitCode = $LASTEXITCODE
 $buildRecords += @{name=$buildStep.name;command=@('cargo')+$taskArguments;exit_code=$stepExitCode;started_at=$startedAt.ToString('o');elapsed_seconds=([DateTime]::UtcNow-$startedAt).TotalSeconds;log=$logPath}
 [IO.File]::WriteAllText((Join-Path $buildEvidence 'native-checks.json'),($buildRecords | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
 if($stepExitCode -ne 0) { throw ('Failed '+$buildStep.name+' exit '+$stepExitCode+'; see '+$logPath) }
 Write-Output ('Passed '+$buildStep.name)
}

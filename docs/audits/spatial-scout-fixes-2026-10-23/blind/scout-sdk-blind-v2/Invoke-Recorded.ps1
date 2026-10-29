param(
 [Parameter(Mandatory=$true)][string]$Name,
 [Parameter(Mandatory=$true)][string]$FilePath,
 [string]$ArgumentsJson='[]',
 [string]$WorkingDirectory='D:\Projects\Unone\artifacts\spatial-p2-sdk',
 [int]$TimeoutMs=120000,
 [switch]$SealAfter
)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$sequencePath=Join-Path $root 'sequence.txt'
$sequence=if(Test-Path -LiteralPath $sequencePath){[int](Get-Content -LiteralPath $sequencePath -Raw)+1}else{1}
[IO.File]::WriteAllText($sequencePath,[string]$sequence)
$prefix=('{0:D3}-{1}' -f $sequence,$Name)
$argsList=@(ConvertFrom-Json $ArgumentsJson)
function Quote-Arg([string]$value){
 if($value.Length -gt 0 -and $value -notmatch '[\s"]'){return $value}
 return '"' + [regex]::Replace([regex]::Replace($value,'(\\*)"','$1$1\"'),'(\\+)$','$1$1') + '"'
}
$record=[ordered]@{order=$sequence;name=$Name;argv=@($FilePath)+$argsList;workingDirectory=$WorkingDirectory;timeoutMs=$TimeoutMs;sealAfter=[bool]$SealAfter;startedUtc=[DateTime]::UtcNow.ToString('o')}
$meta=Join-Path $root "$prefix.json"
$record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $meta -Encoding utf8
$psi=New-Object Diagnostics.ProcessStartInfo
$psi.FileName=$FilePath
$psi.Arguments=($argsList | ForEach-Object { Quote-Arg ([string]$_) }) -join ' '
$psi.WorkingDirectory=$WorkingDirectory
$psi.UseShellExecute=$false
$psi.RedirectStandardOutput=$true
$psi.RedirectStandardError=$true
$p=New-Object Diagnostics.Process
$p.StartInfo=$psi
$outPath=Join-Path $root "$prefix.stdout"
$errPath=Join-Path $root "$prefix.stderr"
$outFile=[IO.File]::Create($outPath)
$errFile=[IO.File]::Create($errPath)
$watch=[Diagnostics.Stopwatch]::StartNew()
try{
 [void]$p.Start()
 $outTask=$p.StandardOutput.BaseStream.CopyToAsync($outFile)
 $errTask=$p.StandardError.BaseStream.CopyToAsync($errFile)
 $finished=$p.WaitForExit($TimeoutMs)
 if(-not $finished){$p.Kill();$p.WaitForExit()}
 $outTask.Wait();$errTask.Wait()
 $record.timedOut=-not $finished
 $record.exitCode=$p.ExitCode
} catch {
 $record.recorderError=$_.Exception.ToString()
 throw
} finally {
 $watch.Stop();$outFile.Dispose();$errFile.Dispose()
 $record.elapsedMs=$watch.ElapsedMilliseconds
 $record.endedUtc=[DateTime]::UtcNow.ToString('o')
 $record.stdoutPath=$outPath;$record.stderrPath=$errPath
 $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $meta -Encoding utf8
}
Write-Output ('RECORDED '+$meta)
Write-Output ('EXIT '+$record.exitCode+' TIMEOUT '+$record.timedOut+' ELAPSED_MS '+$record.elapsedMs)
[Console]::Out.Write([IO.File]::ReadAllText($outPath))
[Console]::Error.Write([IO.File]::ReadAllText($errPath))

if($SealAfter){
 $manifestPath=Join-Path $root 'SHA256SUMS.json'
 $sealPath=Join-Path $root 'SEAL.txt'
 if((Test-Path -LiteralPath $manifestPath) -or (Test-Path -LiteralPath $sealPath)){throw 'Evidence already sealed'}
 $files=@(Get-ChildItem -LiteralPath $root -File -Recurse | Sort-Object FullName | ForEach-Object {
  [ordered]@{path=$_.FullName.Substring($root.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
 })
 $manifest=[ordered]@{algorithm='SHA256';excluded=@('SHA256SUMS.json','SEAL.txt');files=$files}
 [IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 20))
 $detached=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
 [IO.File]::WriteAllText($sealPath,('SHA256SUMS.json '+$detached+[Environment]::NewLine))
}

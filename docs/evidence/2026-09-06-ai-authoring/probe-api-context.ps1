param([Parameter(Mandatory=$true)][string]$CliPath)
$ErrorActionPreference='Stop'
$probeCli=(Get-Item -LiteralPath $CliPath).FullName
$probeRoot=Join-Path ([IO.Path]::GetTempPath()) ('unone-api-context-'+[Guid]::NewGuid().ToString('N'))
$targetRoot=Join-Path $probeRoot '目標 遊戲'
$otherRoot=Join-Path $probeRoot '另一個 遊戲'
$records=[Collections.Generic.List[object]]::new()
function Invoke-ProbeCli([string[]]$Arguments,[string]$WorkingDirectory) {
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$probeCli
    $start.WorkingDirectory=$WorkingDirectory
    $start.UseShellExecute=$false
    $start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true
    $start.RedirectStandardError=$true
    $start.StandardOutputEncoding=[Text.Encoding]::UTF8
    $start.StandardErrorEncoding=[Text.Encoding]::UTF8
    foreach($argument in $Arguments){$start.ArgumentList.Add($argument)}
    $process=[Diagnostics.Process]::Start($start)
    $stdoutTask=$process.StandardOutput.ReadToEndAsync()
    $stderrTask=$process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout=$stdoutTask.GetAwaiter().GetResult()
    $stderr=$stderrTask.GetAwaiter().GetResult()
    $record=[ordered]@{cwd=$WorkingDirectory;argv=$Arguments;exit_code=$process.ExitCode;stdout=$stdout;stderr=$stderr}
    $records.Add($record)
    $process.Dispose()
    if($record.exit_code -ne 0){throw "Probe command failed: $stdout $stderr"}
    return ($stdout|ConvertFrom-Json)
}
$baseDirectory=[IO.Path]::GetTempPath()
$null=Invoke-ProbeCli @('--project',$targetRoot,'--json','project','init','--name','IntendedTarget') $baseDirectory
$null=Invoke-ProbeCli @('--project',$otherRoot,'--json','project','init','--name','UnrelatedCwd') $baseDirectory
$null=Invoke-ProbeCli @('--project',$targetRoot,'--json','systems','set','--id','physics2d','--enabled','false') $baseDirectory
$null=Invoke-ProbeCli @('--project',$otherRoot,'--json','systems','set','--id','physics2d','--enabled','true') $baseDirectory
$search=Invoke-ProbeCli @('--project',$targetRoot,'--json','api','search','攻擊') $otherRoot
$action=@($search.value.suggested_next_actions|Where-Object action -eq 'list_systems')
if($action.Count -ne 1 -or -not $action[0].ready -or $action[0].executable -ne 'game'){throw 'Missing ready systems action'}
$systems=Invoke-ProbeCli @($action[0].argv) $otherRoot
$physics=@($systems.value.systems|Where-Object {$_.id -eq 'physics2d'})
if($systems.value.project -ne 'IntendedTarget' -or $physics.Count -ne 1 -or $physics[0].enabled -ne $false -or $physics[0].source -ne 'project'){throw 'Followup inspected wrong project or wrong system setting'}
[ordered]@{fixture_root=$probeRoot;cli=$probeCli;passed=$true;records=$records;cleanup='Owned fixture retained; no deletion'}|ConvertTo-Json -Depth 30

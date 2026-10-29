param(
 [string]$Sdk='D:\Projects\Unone\artifacts\spatial-p2-sdk',
 [string]$Analyzer='D:\Projects\Unone\.toolcache\luau-0.734\luau-analyze.exe',
 [string]$OutputDirectory=''
)
$ErrorActionPreference='Stop'
if(-not $OutputDirectory){$OutputDirectory=Join-Path ([IO.Path]::GetTempPath()) ('unone-spatial-generic-probe-'+[guid]::NewGuid().ToString('N'))}
$fullOut=[IO.Path]::GetFullPath($OutputDirectory)
$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if(-not $fullOut.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Probe output must be a new OS-temp directory'}
if(Test-Path -LiteralPath $fullOut){throw 'Probe output directory must not exist'}
New-Item -ItemType Directory -Path $fullOut | Out-Null
$project=Join-Path $fullOut 'project'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'final-project') -Destination $project -Recurse
$manifest=Get-Content -LiteralPath (Join-Path $Sdk 'sdk.json') -Raw | ConvertFrom-Json
$cli=Join-Path $Sdk $manifest.cli
$env:UNONE_LUAU_ANALYZER=$Analyzer
$script:op=0
function Quote-Arg([string]$v){
 if($v.Length -gt 0 -and $v -notmatch '[\s"]'){return $v}
 return '"' + [regex]::Replace([regex]::Replace($v,'(\\*)"','$1$1\"'),'(\\+)$','$1$1') + '"'
}
function Run([string]$name,[string[]]$commandArgs){
 $script:op++
 $prefix=Join-Path $fullOut ('{0:D2}-{1}' -f $script:op,$name)
 $meta=[ordered]@{order=$script:op;argv=@($cli)+$commandArgs;startedUtc=[DateTime]::UtcNow.ToString('o');timeoutMs=120000;analyzer=$Analyzer}
 $meta | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath ($prefix+'.json')
 $psi=New-Object Diagnostics.ProcessStartInfo
 $psi.FileName=$cli;$psi.Arguments=($commandArgs | ForEach-Object{Quote-Arg $_}) -join ' '
 $psi.WorkingDirectory=$Sdk;$psi.UseShellExecute=$false
 $psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
 $p=New-Object Diagnostics.Process;$p.StartInfo=$psi
 $stdout=[IO.File]::Create($prefix+'.stdout');$stderr=[IO.File]::Create($prefix+'.stderr')
 $watch=[Diagnostics.Stopwatch]::StartNew()
 try{
  [void]$p.Start()
  $ot=$p.StandardOutput.BaseStream.CopyToAsync($stdout);$et=$p.StandardError.BaseStream.CopyToAsync($stderr)
  $finished=$p.WaitForExit(120000)
  if(-not $finished){$p.Kill();$p.WaitForExit()}
  $ot.Wait();$et.Wait();$meta.exitCode=$p.ExitCode;$meta.timedOut=-not $finished
 }finally{$stdout.Dispose();$stderr.Dispose();$watch.Stop();$meta.elapsedMs=$watch.ElapsedMilliseconds;$meta | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath ($prefix+'.json')}
 if($meta.exitCode -ne 0 -or $meta.timedOut){throw ('CLI operation failed: '+$name)}
 $raw=Get-Content -LiteralPath ($prefix+'.stdout') -Raw
 $r=$raw | ConvertFrom-Json
 if(-not $r.ok){throw ('CLI verdict failed: '+$name)}
 return $r
}
function Assert([bool]$condition,[string]$message){if(-not $condition){throw $message}}
function Sub($a,$b){return ,@(([double]$a[0]-$b[0]),([double]$a[1]-$b[1]),([double]$a[2]-$b[2]))}
function Add($a,$b){return ,@(([double]$a[0]+$b[0]),([double]$a[1]+$b[1]),([double]$a[2]+$b[2]))}
function Scale($a,[double]$s){return ,@(($a[0]*$s),($a[1]*$s),($a[2]*$s))}
function Dot($a,$b){return [double]($a[0]*$b[0]+$a[1]*$b[1]+$a[2]*$b[2])}
function Len($a){return [Math]::Sqrt((Dot $a $a))}
function Hit($body,$queryCenter,[double]$distance,[double]$fraction,[bool]$initial=$false){
 $delta=Sub $queryCenter $body.position
 $length=Len $delta
 $normal=if($initial -or $length -eq 0){@(0.0,0.0,1.0)}else{Scale $delta (1.0/$length)}
 return [pscustomobject]@{id=$body.id;distance=$distance;fraction=$fraction;point=(Add $body.position (Scale $normal $body.radius));normal=$normal}
}
function Oracle($bodies,$queries){
 $results=@()
 foreach($q in $queries){
  $hits=@()
  foreach($b in $bodies){
   $category=if($null -ne $b.category){[uint64]$b.category}else{[uint64]1}
   $mask=if($null -ne $q.mask){[uint64]$q.mask}else{[uint64]4294967295}
   if(($category -band $mask) -eq 0 -or ($null -ne $q.exclude_id -and $b.id -eq $q.exclude_id)){continue}
   if($q.kind -eq 'nearest'){
    $d=Len (Sub $q.point $b.position)
    if($d -le $q.max_distance){$hits+=Hit $b $q.point $d 0}
   }elseif($q.kind -eq 'overlap_sphere'){
    $d=Len (Sub $q.center $b.position)
    if($d -le ($q.radius+$b.radius)){$hits+=Hit $b $q.center $d 0}
   }else{
    $previous=if($null -ne $b.previous_position){$b.previous_position}else{$b.position}
    $p=Sub $q.from $previous
    $qv=Sub $q.to $q.from
    $bv=Sub $b.position $previous
    $v=Sub $qv $bv
    $radius=$q.radius+$b.radius
    $c=(Dot $p $p)-$radius*$radius
    $a=Dot $v $v
    $linear=2*(Dot $p $v)
    $initial=$c -le 0
    $t=$null
    if($initial){$t=0.0}elseif($a -gt 0){
     $discriminant=$linear*$linear-4*$a*$c
     if($discriminant -ge 0){$candidate=(-$linear-[Math]::Sqrt($discriminant))/(2*$a);if($candidate -ge 0 -and $candidate -le 1){$t=$candidate}}
    }
    if($null -ne $t){
     $moving=[pscustomobject]@{id=$b.id;radius=$b.radius;position=(Add $previous (Scale $bv $t))}
     $hits+=Hit $moving (Add $q.from (Scale $qv $t)) ((Len $qv)*$t) $t $initial
    }
   }
  }
  if($q.kind -eq 'nearest'){$hits=@($hits | Sort-Object distance,id | Select-Object -First 1)}
  elseif($q.kind -eq 'sweep_sphere'){$hits=@($hits | Sort-Object fraction,id | Select-Object -First 1)}
  else{$hits=@($hits | Sort-Object id)}
  $results+=[pscustomobject]@{hits=$hits}
 }
 return ,$results
}
$case=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'case.json') -Raw | ConvertFrom-Json
$expected=Oracle $case.bodies $case.queries
$expected | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $fullOut 'independent-expected.json')
$strict=Run 'check-types' @('--sdk',$Sdk,'--project',$project,'--json','check','--types')
Assert ($strict.value.type_check.passed -and $strict.value.strict_mode) 'Official strict checking did not pass'
$one=Run 'submission' @('--sdk',$Sdk,'--project',$project,'--json','run','--frames','1')
$two=Run 'delivery' @('--sdk',$Sdk,'--project',$project,'--json','run','--frames','2')
$o1=$one.value.world.observations;$o2=$two.value.world.observations
Assert ($null -eq $o1.frozen_batch) 'Results published in submission tick'
Assert (@($one.value.world.spatial.tickets).Count -eq 2) 'Frozen tickets absent in first frame snapshot'
Assert ($o1.next_tick_boundary.error -match 'SPATIAL_RESULT_NEXT_TICK') 'Early take not rejected'
Assert ($o1.invalid_replacement.error -match 'duplicate body ID 9') 'Deliberate duplicate input not rejected'
Assert ($o1.repair.version -eq 2 -and $o1.repair.packed_bytes -eq 48) 'Packed repair mismatch'
Assert ($o2.frozen_batch.version -eq 1 -and $o2.replacement_batch.version -eq 2) 'Version/frozen state failure'
Assert (@($o2.frozen_batch.results).Count -eq 4) 'Query results incomplete'
for($q=0;$q -lt $expected.Count;$q++){
 $actual=@($o2.frozen_batch.results[$q].hits)
 $wanted=@($expected[$q].hits)
 Assert ($actual.Count -eq $wanted.Count) ('Hit count mismatch query '+$q)
 for($h=0;$h -lt $wanted.Count;$h++){
  Assert ($actual[$h].id -eq $wanted[$h].id) 'ID/order mismatch'
  Assert ((@($actual[$h].PSObject.Properties.Name | Sort-Object) -join ',') -eq 'distance,fraction,id,normal,point') 'Incomplete hit record'
  foreach($field in @('distance','fraction')){
   Assert ([Math]::Abs($actual[$h].$field-$wanted[$h].$field) -lt $case.tolerance) ('Mismatch '+$field)
  }
  foreach($field in @('point','normal')){for($axis=0;$axis -lt 3;$axis++){Assert ([Math]::Abs($actual[$h].$field[$axis]-$wanted[$h].$field[$axis]) -lt $case.tolerance) ('Mismatch '+$field)}}
 }
}
$emptyShapes=@()
foreach($q in $o2.replacement_batch.results){
 $raw=$q.hits | ConvertTo-Json -Compress
 Assert ($raw -eq '{}' -or $raw -eq '[]') 'Replacement should have no contacts'
 $emptyShapes+=$raw
}
foreach($key in @('spatial_info_start','spatial_info_after_destroy','spatial_info_complete')){
 $info=$o2.$key
 Assert ($info.backend -eq 'cpu' -and -not $info.external) 'Unexpected backend'
 Assert ($info.api_version -eq 1 -and $info.packed_format -eq 'USB1' -and $info.delivery -eq 'next_tick') 'Info contract incomplete'
 Assert ($info.limits.safe_integer -eq 9007199254740991) 'safe_integer not preserved'
 Assert ($info.limits.bodies -eq 131072 -and $info.limits.bodies_per_index -eq 65536 -and $info.limits.coordinate_abs -eq 1000000 -and $info.limits.hits_per_query -eq 64 -and $info.limits.indices -eq 8 -and $info.limits.queries_per_batch -eq 1024 -and $info.limits.submissions_per_tick -eq 4 -and $info.limits.tickets -eq 16) 'Info limits mismatch'
 Assert (($info.operations -join ',') -eq 'nearest,overlap_sphere,sweep_sphere') 'Info operations mismatch'
}
Assert ($o2.spatial_info_start.indices -eq 1 -and $o2.spatial_info_start.bodies -eq 5) 'Initial usage mismatch'
Assert ($o2.spatial_info_after_destroy.indices -eq 0 -and $o2.spatial_info_after_destroy.tickets -eq 2) 'Destroy invalidated frozen input'
Assert ($o2.spatial_info_complete.indices -eq 0 -and $o2.spatial_info_complete.tickets -eq 0) 'Resources not consumed'
Assert ($o2.consumption_boundary.error -match 'SPATIAL_TICKET_UNKNOWN') 'Consumed ticket reusable'
Assert ($o2.verification.passed) 'In-project verification missing'
$entity1=$one.value.world.entities.unrelated
$entity2=$two.value.world.entities.unrelated
Assert (($entity1 | ConvertTo-Json -Depth 20 -Compress) -eq ($entity2 | ConvertTo-Json -Depth 20 -Compress)) 'Unrelated full entity changed'
Assert ($entity2.transform.x -eq -23 -and $entity2.transform.y -eq 47) 'Unrelated coordinates mismatch'
$report=[ordered]@{passed=$true;backendObserved='cpu';gpuExecuted=$false;strictPassed=$true;independentOracle='double precision generic quadratic sweep plus Euclidean nearest/overlap';tolerance=$case.tolerance;emptyHitsShapes=$emptyShapes;emptyHitsShapeDeviation=($emptyShapes -contains '{}');output=$fullOut}
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $fullOut 'verification.json')
$report | ConvertTo-Json -Depth 20

param([int]$NativePort=55433,[switch]$Json)
$ErrorActionPreference='Stop'
$body='{"method":"snapshot"}'
$payload=Invoke-RestMethod -Uri "http://127.0.0.1:$NativePort/request" -Method Post -ContentType 'application/json' -Body $body
$world=$payload.value.observation.world
$observation=@($world.observations)[0]
$people=@($observation.view_model.npc)
$performance=$payload.value.performance
$ai=$null
$aiPath=Join-Path $PSScriptRoot '..\.runtime\nanojev-status.json'
if(Test-Path -LiteralPath $aiPath){try{$ai=Get-Content -LiteralPath $aiPath -Raw|ConvertFrom-Json}catch{}}

function Count-Field($items,[string]$field){
    $counts=@{}
    foreach($item in $items){$key=[string]$item.$field;if([string]::IsNullOrWhiteSpace($key)){$key='(none)'};if($counts.ContainsKey($key)){$counts[$key]++}else{$counts[$key]=1}}
    return $counts
}
function Format-Counts($counts){
    return (($counts.GetEnumerator()|Sort-Object Value -Descending|ForEach-Object{"$($_.Name)=$($_.Value)"}) -join ', ')
}

$actions=Count-Field $people 'action_id'
$locations=Count-Field $people 'location'
$moving=@($people|Where-Object {$_.moving})
$waiting=@($people|Where-Object {$_.alive -and $_.action_id -eq 'wait'})
$waitingUnresolved=@($waiting|Where-Object {$_.decision_source -eq 'waiting-for-nanojev' -or $_.plan_status -like '*等待 NanoJev*' -or $_.plan_status -like '*下一個決策點*'})
$waitingAccepted=@($waiting|Where-Object {$_.decision_source -ne 'waiting-for-nanojev' -and $_.plan_status -notlike '*等待 NanoJev*' -and $_.plan_status -notlike '*下一個決策點*'})
$pendingPeople=@($people|Where-Object {$_.decision_pending})
$blocked=@($people|Where-Object {$_.alive -and $_.blocked_frames -gt 45})
$needsRoute=@($people|Where-Object {$_.alive -and $_.route_target -and (([math]::Abs($_.route_target.x-$_.world_position.x)+[math]::Abs($_.route_target.z-$_.world_position.z)) -gt 1)})
$status=[ordered]@{
    frame=$world.frame; clock=$observation.view_model.clock; residents=$people.Count
    alive=@($people|Where-Object {$_.alive}).Count; dead=@($people|Where-Object {!$_.alive}).Count
    moving=$moving.Count; waiting=$waiting.Count; waiting_unresolved=$waitingUnresolved.Count; waiting_accepted=$waitingAccepted.Count; pending_people=$pendingPeople.Count; needs_route=$needsRoute.Count; blocked_over_45=$blocked.Count
    actions=$actions; locations=$locations
    ai_phase=$ai.phase; ai_error=$ai.error; ai_mode=$ai.worker_mode; ai_threads=$ai.torch_threads; ai_batch=$ai.batch_size; ai_questions=$ai.batch_questions; ai_queue=$ai.queued; ai_applied=$ai.applied; ai_latency_ms=$ai.latency_ms
    entities=$performance.counts.entities; observations=$performance.counts.observations; ui_nodes=$performance.counts.ui_nodes
    mean_frame_ms=$performance.mean_frame_ms; p95_frame_ms=$performance.p95_frame_ms; frames_over_budget=$performance.frames_over_budget
    luau_memory_mb=[math]::Round($performance.luau_memory_bytes/1MB,2)
}
if($Json){$status|ConvertTo-Json -Depth 8;exit}
Write-Output "雲水鎮狀態  frame=$($status.frame)  $($status.clock)"
Write-Output "居民 alive/dead=$($status.alive)/$($status.dead)  moving=$($status.moving)  wait_state=$($status.waiting) (unresolved=$($status.waiting_unresolved) accepted=$($status.waiting_accepted))  pending_people=$($status.pending_people)  needs_route=$($status.needs_route)  blocked>45=$($status.blocked_over_45)"
Write-Output "行動: $(Format-Counts $actions)"
Write-Output "位置: $(Format-Counts $locations)"
Write-Output "NanoJev: phase=$($status.ai_phase) mode=$($status.ai_mode) cpu_threads=$($status.ai_threads) batch=$($status.ai_batch) questions=$($status.ai_questions) queue=$($status.ai_queue) applied=$($status.ai_applied) latency_ms=$($status.ai_latency_ms) error=$($status.ai_error)"
if($status.ai_error){Write-Output "NanoJev error: $($status.ai_error)"}
Write-Output "效能: entities=$($status.entities) observations=$($status.observations) ui_nodes=$($status.ui_nodes) mean_ms=$($status.mean_frame_ms) p95_ms=$($status.p95_frame_ms) over_budget=$($status.frames_over_budget) Luau_MB=$($status.luau_memory_mb)"
if($waiting.Count){Write-Output "等待中的前 8 人: $(($waiting|Select-Object -First 8|ForEach-Object{"$($_.name)@$($_.location)"}) -join ', ')"}

// Host submission counters, not a GPU/compositor scanout acknowledgement.
// Recording reads primitives from already-decoded snapshots; only a read-only
// query copies/sorts the fixed interval ring or constructs a report.
const LIMIT=512;
const REASONS=['raster_unavailable','raster_validation','frame_resources_pending','frame_pass_incomplete','world_assets_pending','ui_assets_pending','ui_diagnostics','ui_target_unavailable','cursor_assets_pending','cursor_diagnostics','other'];
export const DRAW_COMPLETED=Object.freeze({status:'completed'});
export const DRAW_UNKNOWN=Object.freeze({status:'unknown'});
export const DRAW_SKIPPED=Object.freeze(Object.fromEntries(REASONS.map(reason=>[reason,Object.freeze({status:'skipped',reason})])));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const frameOf=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const known=value=>value?.status==='completed'||value?.status==='skipped';
const SOURCES=['manual','startup','scheduler_raf','unknown'];
const OUTCOMES=['completed','skipped','unknown','error','no_submission'];
const NOMINAL_BUDGET=1000/60,RAF_SOURCE=2;
function ring(){return {values:new Float64Array(LIMIT),ends:new Float64Array(LIMIT),cursor:0,count:0};}
function push(r,value,end){if(!finite(value)||value<0||!finite(end))return;r.values[r.cursor]=value;r.ends[r.cursor]=end;r.cursor=(r.cursor+1)%LIMIT;r.count=Math.min(r.count+1,LIMIT);}
function distribution(r,at,windowMs){
 const values=[];let oldest=null,newest=null,start=null;
 for(let i=0;i<r.count;i++)if(r.ends[i]>=at-windowMs){values.push(r.values[i]);oldest=oldest===null?r.ends[i]:Math.min(oldest,r.ends[i]);newest=newest===null?r.ends[i]:Math.max(newest,r.ends[i]);start=start===null?r.ends[i]-r.values[i]:Math.min(start,r.ends[i]-r.values[i]);}
 values.sort((a,b)=>a-b);const percentile=p=>values.length?values[Math.ceil(values.length*p)-1]:null,coverage=start===null?0:Math.max(0,newest-Math.max(start,at-windowMs));
 return Object.freeze({window_ms:windowMs,retained:values.length,capacity:LIMIT,oldest_start_ms:start,oldest_end_ms:oldest,newest_end_ms:newest,coverage_ms:coverage,window_coverage:Math.min(1,coverage/windowMs),min_ms:values.length?values[0]:null,max_ms:values.length?values[values.length-1]:null,p50_ms:percentile(.5),p95_ms:percentile(.95),p99_ms:percentile(.99)});
}
export function createPlayerCompletionMetrics({now=()=>performance.now(),timeOrigin=globalThis.performance?.timeOrigin??null}={}){
 const intervals=new Float64Array(LIMIT),ends=new Float64Array(LIMIT),skips=new Float64Array(REASONS.length);
 const successfulRaf=ring(),freshRaf=ring(),submitWall=ring(),callbackWall=ring(),preparationWall=ring(),allRings=[successfulRaf,freshRaf,submitWall,callbackWall,preparationWall];
 const rowSource=new Uint8Array(LIMIT),rowOutcome=new Uint8Array(LIMIT),rowFlags=new Uint8Array(LIMIT),rowRaf=new Float64Array(LIMIT),rowStart=new Float64Array(LIMIT),rowEnd=new Float64Array(LIMIT),rowCallback=new Float64Array(LIMIT),rowFrame=new Float64Array(LIMIT),rowAt=new Float64Array(LIMIT),rowSequence=new Float64Array(LIMIT);
 const sourceCounts=new Float64Array(SOURCES.length),outcomeCounts=new Float64Array(OUTCOMES.length),deadlineCounts=new Float64Array(9);
 let session=0,accepted=0,attempts=0,completed=0,unique=0,unknown=0,errors=0,skipped=0,cursor=0,retained=0,droppedAtStart=0;
 let frame=null,time=null,published=null,lastFrame=null,lastCompleted=null,lastStatus='unknown',contract='unknown',lastOutcome=DRAW_UNKNOWN;
 let rowCursor=0,rowCount=0,rowTotal=0,lastRafRow=-1,lastRafSequence=0,lastRafTimestamp=null,highestFrame=null,lastRafFrame=null,lastSuccessfulRaf=null,lastFreshRaf=null;
 let rafAttempts=0,rafCompleted=0,rafRepeats=0,rafRegressions=0,rafAlreadyShown=0,rafInFlight=0,rafUnknownFrames=0,rafUnknownTimes=0,rafNonIncreasingTimes=0,callbacks=0,callbackInFlight=0,preparations=0,preparationCancelled=0,preparationSteps=0,preparationUnknownSteps=0,lastBudget=null;
 function reset(dropped=0){session++;accepted=attempts=completed=unique=unknown=errors=skipped=cursor=retained=0;skips.fill(0);droppedAtStart=Number.isSafeInteger(dropped)&&dropped>=0?dropped:0;
  frame=time=published=lastFrame=lastCompleted=null;lastStatus=contract='unknown';lastOutcome=DRAW_UNKNOWN;
  for(const r of allRings)r.cursor=r.count=0;sourceCounts.fill(0);outcomeCounts.fill(0);deadlineCounts.fill(0);rowCursor=rowCount=rowTotal=0;lastRafRow=-1;lastRafSequence=0;
  lastRafTimestamp=highestFrame=lastRafFrame=lastSuccessfulRaf=lastFreshRaf=null;
  rafAttempts=rafCompleted=rafRepeats=rafRegressions=rafAlreadyShown=rafInFlight=rafUnknownFrames=rafUnknownTimes=rafNonIncreasingTimes=callbacks=callbackInFlight=preparations=preparationCancelled=preparationSteps=preparationUnknownSteps=0;lastBudget=null;
 }
 function accept(snapshot,newSession=false,droppedSteps=0){if(newSession)reset(droppedSteps);const world=snapshot?.world;
  frame=frameOf(world?.frame);time=finite(world?.time_seconds)?world.time_seconds:null;published=now();accepted++;}
 function deadline(kind,rafTime,end,budgetMs){const offset=kind*3;if(!finite(rafTime)||!finite(end)||!finite(budgetMs)||budgetMs<=0){deadlineCounts[offset+2]++;return;}
  lastBudget=budgetMs;deadlineCounts[offset]++;if(end>rafTime+budgetMs)deadlineCounts[offset+1]++;
 }
 function record(source,outcome,rafTime,start,end,presentedFrame,inFlight,newSnapshot=false,regression=false,repeat=false){
  let sourceIndex=SOURCES.indexOf(source);if(sourceIndex<0)sourceIndex=SOURCES.length-1;const index=rowCursor;rowCursor=(rowCursor+1)%LIMIT;rowCount=Math.min(rowCount+1,LIMIT);rowTotal++;
  rowSource[index]=sourceIndex;rowOutcome[index]=outcome;rowRaf[index]=finite(rafTime)?rafTime:NaN;rowStart[index]=finite(start)?start:NaN;rowEnd[index]=finite(end)?end:NaN;rowCallback[index]=NaN;rowFrame[index]=presentedFrame===null?NaN:presentedFrame;rowAt[index]=finite(end)?end:now();rowSequence[index]=rowTotal;
  rowFlags[index]=(newSnapshot?1:0)|(regression?2:0)|(inFlight===true?4:0)|(repeat?8:0);sourceCounts[sourceIndex]++;outcomeCounts[outcome]++;
  if(sourceIndex===RAF_SOURCE){lastRafRow=index;lastRafSequence=rowTotal;lastRafTimestamp=finite(rafTime)?rafTime:null;}
 }
 function submitted(source,outcome,rafTime,startAt,inFlight,at,presentedFrame,budgetMs){
  const next=frameOf(presentedFrame),isRaf=source==='scheduler_raf',complete=outcome===0,regression=isRaf&&complete&&next!==null&&lastRafFrame!==null&&next<lastRafFrame,repeat=isRaf&&complete&&next!==null&&next===lastRafFrame;
  const fresh=complete&&next!==null&&(highestFrame===null||next>highestFrame);
  if(fresh)highestFrame=next;
  if(isRaf){rafAttempts++;if(inFlight===true)rafInFlight++;if(next===null)rafUnknownFrames++;if(!finite(rafTime))rafUnknownTimes++;deadline(0,rafTime,at,budgetMs);
   if(finite(startAt)&&finite(at)&&at>=startAt)push(submitWall,at-startAt,at);
   if(complete){rafCompleted++;if(repeat)rafRepeats++;if(regression)rafRegressions++;if(next!==null){if(!fresh)rafAlreadyShown++;lastRafFrame=next;}
    if(finite(rafTime)){if(lastSuccessfulRaf!==null){if(rafTime>lastSuccessfulRaf)push(successfulRaf,rafTime-lastSuccessfulRaf,rafTime);else rafNonIncreasingTimes++;}if(lastSuccessfulRaf===null||rafTime>lastSuccessfulRaf)lastSuccessfulRaf=rafTime;
     if(fresh&&!regression){if(lastFreshRaf!==null&&rafTime>lastFreshRaf)push(freshRaf,rafTime-lastFreshRaf,rafTime);if(lastFreshRaf===null||rafTime>lastFreshRaf)lastFreshRaf=rafTime;}
    }
   }
  }
  record(source,outcome,rafTime,startAt,at,next,inFlight,fresh,regression,repeat);
 }
 function skip(reason){skipped++;lastStatus='skipped';const index=REASONS.indexOf(reason),key=REASONS[index<0?REASONS.length-1:index];skips[index<0?REASONS.length-1:index]++;return lastOutcome=DRAW_SKIPPED[key];}
 function finish(world,ui,overlay,presentedFrame,at=now(),source='manual',rafTime=null,startAt=null,inFlight=false,budgetMs=NOMINAL_BUDGET){
  contract=known(world)&&known(ui)&&known(overlay)?'available':'unknown';
  const pending=world?.status==='skipped'?world:ui?.status==='skipped'?ui:overlay?.status==='skipped'?overlay:null;let result,outcome;
  if(pending){result=skip(pending.reason);outcome=1;}
  else if(world?.status!=='completed'||ui?.status!=='completed'||overlay?.status!=='completed'){unknown++;lastStatus='unknown';result=lastOutcome=DRAW_UNKNOWN;outcome=2;}
  else{
   contract='available';lastStatus='completed';completed++;const next=frameOf(presentedFrame);
   if(next!==lastFrame){unique++;lastFrame=next;}
   if(lastCompleted!==null&&finite(at)&&at>=lastCompleted){intervals[cursor]=at-lastCompleted;ends[cursor]=at;cursor=(cursor+1)%LIMIT;retained=Math.min(retained+1,LIMIT);}
   lastCompleted=finite(at)?at:null;result=lastOutcome=DRAW_COMPLETED;outcome=0;
  }
  submitted(source,outcome,rafTime,startAt,inFlight,at,presentedFrame,budgetMs);return result;
 }
 function error(source='manual',rafTime=null,startAt=null,inFlight=false,at=now(),presentedFrame=null,budgetMs=NOMINAL_BUDGET){errors++;lastStatus='error';lastOutcome=DRAW_UNKNOWN;submitted(source,3,rafTime,startAt,inFlight,at,presentedFrame,budgetMs);}
 function rafEnd(rafTime,start,end,inFlight=false,budgetMs=NOMINAL_BUDGET){
  callbacks++;if(inFlight===true)callbackInFlight++;if(finite(start)&&finite(end)&&end>=start)push(callbackWall,end-start,end);deadline(1,rafTime,end,budgetMs);
  if(lastRafRow>=0&&rowSequence[lastRafRow]===lastRafSequence&&lastRafTimestamp!==null&&lastRafTimestamp===rafTime){rowCallback[lastRafRow]=finite(end)?end:NaN;if(finite(end))rowAt[lastRafRow]=end;lastRafRow=-1;}
  else{record('scheduler_raf',4,rafTime,start,null,null,inFlight);const index=(rowCursor+LIMIT-1)%LIMIT;rowCallback[index]=finite(end)?end:NaN;rowAt[index]=finite(end)?end:now();lastRafRow=-1;}
 }
 function preparationEnd(tag,rafTime,start,end,steps,cancelled=false,budgetMs=NOMINAL_BUDGET){
  if(tag!==session)return false;preparations++;if(cancelled===true)preparationCancelled++;if(Number.isSafeInteger(steps)&&steps>=0)preparationSteps+=steps;else preparationUnknownSteps++;
  if(cancelled!==true){if(finite(start)&&finite(end)&&end>=start)push(preparationWall,end-start,end);deadline(2,rafTime,end,budgetMs);}return true;
 }
 function report(options={}){
  const {droppedSteps=null,paused=false,backend=null,windowMs=5000}=options,includeRafSamples=Object.hasOwn(options,'includeRafSamples')?options.includeRafSamples:false;
  if(!finite(windowMs)||windowMs<=0||windowMs>60000)throw Error('PLAYER_PERFORMANCE_WINDOW_INVALID');
  if(typeof includeRafSamples!=='boolean')throw Error('PLAYER_PERFORMANCE_OPTIONS_INVALID: includeRafSamples must be boolean');
  const at=now(),values=[];let oldest=null,newest=null;
  for(let i=0;i<retained;i++)if(ends[i]>=at-windowMs){values.push(intervals[i]);oldest=oldest===null?ends[i]:Math.min(oldest,ends[i]);newest=newest===null?ends[i]:Math.max(newest,ends[i]);}
  values.sort((a,b)=>a-b);const percentile=p=>values.length?values[Math.ceil(values.length*p)-1]:null;
  const counts={};for(let i=0;i<REASONS.length;i++)counts[REASONS[i]]=skips[i];
  const sources={},outcomes={};for(let i=0;i<SOURCES.length;i++)sources[SOURCES[i]]=sourceCounts[i];for(let i=0;i<OUTCOMES.length;i++)outcomes[OUTCOMES[i]]=outcomeCounts[i];
  let windowRows=0;const samples=includeRafSamples?[]:null,first=(rowCursor-rowCount+LIMIT)%LIMIT;
  for(let j=0;j<rowCount;j++){const i=(first+j)%LIMIT;if(rowAt[i]<at-windowMs)continue;windowRows++;if(!samples)continue;
   samples.push(Object.freeze({source:SOURCES[rowSource[i]],raf_time_ms:finite(rowRaf[i])?rowRaf[i]:null,start_ms:finite(rowStart[i])?rowStart[i]:null,end_ms:finite(rowEnd[i])?rowEnd[i]:null,callback_end_ms:finite(rowCallback[i])?rowCallback[i]:null,snapshot_frame:finite(rowFrame[i])?rowFrame[i]:null,outcome:OUTCOMES[rowOutcome[i]],new_snapshot:Boolean(rowFlags[i]&1),regression:Boolean(rowFlags[i]&2),in_flight:Boolean(rowFlags[i]&4)}));
  }
  const nominal={scope:'Nominal RAF timestamp plus supplied budget; wall-time diagnostics, not GPU, OS compositor or presentation deadlines.',budget_ms_last:lastBudget};
  for(const [i,name]of ['submission','callback','preparation'].entries())nominal[name]=Object.freeze({eligible:deadlineCounts[i*3],missed:deadlineCounts[i*3+1],unknown:deadlineCounts[i*3+2]});
  return Object.freeze({version:1,session,backend,completion_contract:contract,last_draw_status:lastStatus,
   simulation_frame:frame,simulation_time_seconds:time,accepted_publications:accepted,publication_at_ms:published,
   publication_timestamp_scope:'main-host snapshot acceptance',time_origin_ms:finite(timeOrigin)?timeOrigin:null,queried_at_ms:at,
   draw_attempts:attempts,completed_draws:completed,presented_frame_changes:unique,last_presented_snapshot_frame:lastFrame,
   last_completed_at_ms:lastCompleted,unknown_draws:unknown,error_draws:errors,skipped_draws:skipped,skip_counts:Object.freeze(counts),
   dropped_steps_total:Number.isSafeInteger(droppedSteps)&&droppedSteps>=droppedAtStart?droppedSteps-droppedAtStart:null,paused:paused===true,
   completed_intervals:Object.freeze({window_ms:windowMs,retained:values.length,capacity:LIMIT,oldest_end_ms:oldest,newest_end_ms:newest,p95_ms:percentile(.95),p99_ms:percentile(.99)}),
   successful_submission_raf_intervals:distribution(successfulRaf,at,windowMs),new_snapshot_raf_intervals:distribution(freshRaf,at,windowMs),
   submit_sync_wall:distribution(submitWall,at,windowMs),callback_sync_wall:distribution(callbackWall,at,windowMs),preparation_wall:distribution(preparationWall,at,windowMs),
   raf_diagnostics:Object.freeze({capacity:LIMIT,recorded_total:rowTotal,retained:windowRows,window_ms:windowMs,source_counts:Object.freeze(sources),outcome_counts:Object.freeze(outcomes),
    scheduler_raf:Object.freeze({submissions:rafAttempts,completed:rafCompleted,repeats:rafRepeats,regressions:rafRegressions,already_submitted_frames:rafAlreadyShown,in_flight_submissions:rafInFlight,unknown_frames:rafUnknownFrames,unknown_raf_timestamps:rafUnknownTimes,non_increasing_successful_raf_timestamps:rafNonIncreasingTimes}),
    callbacks,callbacks_in_flight:callbackInFlight,preparations,preparation_cancelled:preparationCancelled,preparation_steps:preparationSteps,preparation_unknown_steps:preparationUnknownSteps,
    wall_scope:'Submission/callback pacing wall statistics cover scheduler RAF only; startup/manual draws remain explicit source counters and optional rows.',preparation_wall_scope:'Active non-cancelled preparation spans only; cancelled spans retain step/count counters but have no active nominal deadline.',
    nominal_deadlines:Object.freeze(nominal),...(samples?{samples:Object.freeze(samples)}:{})}),
   semantics:'Completed synchronous world, UI and cursor submission; repeated snapshot redraws count separately. RAF intervals use browser callback timestamps; new-snapshot RAF intervals require a globally first shown valid advancing frame. Wall/preparation/nominal-deadline diagnostics are not GPU scanout or an FPS guarantee.'});
 }
 return Object.freeze({accept,reset,attempt(){attempts++;},finish,outcome:()=>lastOutcome,error,rafEnd,epoch:()=>session,preparationEnd,snapshot:report});
}
// A configurable owned property permits page teardown/reinitialization. Never
// replace another script's existing public name; removal checks identity.
export function installPlayerPerformanceAccessor(target,read){
 if('unonePlayerPerformance'in target)return ()=>{};
 const api=Object.freeze({snapshot:read});Object.defineProperty(target,'unonePlayerPerformance',{value:api,configurable:true});
 return ()=>{if(target.unonePlayerPerformance===api)delete target.unonePlayerPerformance;};
}

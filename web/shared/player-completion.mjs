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
export function createPlayerCompletionMetrics({now=()=>performance.now(),timeOrigin=globalThis.performance?.timeOrigin??null}={}){
 const intervals=new Float64Array(LIMIT),ends=new Float64Array(LIMIT),skips=new Float64Array(REASONS.length);
 let session=0,accepted=0,attempts=0,completed=0,unique=0,unknown=0,errors=0,skipped=0,cursor=0,retained=0,droppedAtStart=0;
 let frame=null,time=null,published=null,lastFrame=null,lastCompleted=null,lastStatus='unknown',contract='unknown',lastOutcome=DRAW_UNKNOWN;
 function reset(dropped=0){session++;accepted=attempts=completed=unique=unknown=errors=skipped=cursor=retained=0;skips.fill(0);droppedAtStart=Number.isSafeInteger(dropped)&&dropped>=0?dropped:0;
  frame=time=published=lastFrame=lastCompleted=null;lastStatus=contract='unknown';lastOutcome=DRAW_UNKNOWN;}
 function accept(snapshot,newSession=false,droppedSteps=0){if(newSession)reset(droppedSteps);const world=snapshot?.world;
  frame=frameOf(world?.frame);time=finite(world?.time_seconds)?world.time_seconds:null;published=now();accepted++;}
 function skip(reason){skipped++;lastStatus='skipped';const index=REASONS.indexOf(reason),key=REASONS[index<0?REASONS.length-1:index];skips[index<0?REASONS.length-1:index]++;return lastOutcome=DRAW_SKIPPED[key];}
 function finish(world,ui,overlay,presentedFrame,at=now()){
  contract=known(world)&&known(ui)&&known(overlay)?'available':'unknown';
  const pending=world?.status==='skipped'?world:ui?.status==='skipped'?ui:overlay?.status==='skipped'?overlay:null;
  if(pending)return skip(pending.reason);
  if(world?.status!=='completed'||ui?.status!=='completed'||overlay?.status!=='completed'){unknown++;lastStatus='unknown';return lastOutcome=DRAW_UNKNOWN;}
  contract='available';lastStatus='completed';completed++;const next=frameOf(presentedFrame);
  if(next!==lastFrame){unique++;lastFrame=next;}
  if(lastCompleted!==null&&finite(at)&&at>=lastCompleted){intervals[cursor]=at-lastCompleted;ends[cursor]=at;cursor=(cursor+1)%LIMIT;retained=Math.min(retained+1,LIMIT);}
  lastCompleted=finite(at)?at:null;
  return lastOutcome=DRAW_COMPLETED;
 }
 function report({droppedSteps=null,paused=false,backend=null,windowMs=5000}={}){
  if(!finite(windowMs)||windowMs<=0||windowMs>60000)throw Error('PLAYER_PERFORMANCE_WINDOW_INVALID');
  const at=now(),values=[];let oldest=null,newest=null;
  for(let i=0;i<retained;i++)if(ends[i]>=at-windowMs){values.push(intervals[i]);oldest=oldest===null?ends[i]:Math.min(oldest,ends[i]);newest=newest===null?ends[i]:Math.max(newest,ends[i]);}
  values.sort((a,b)=>a-b);const percentile=p=>values.length?values[Math.ceil(values.length*p)-1]:null;
  const counts={};for(let i=0;i<REASONS.length;i++)counts[REASONS[i]]=skips[i];
  return Object.freeze({version:1,session,backend,completion_contract:contract,last_draw_status:lastStatus,
   simulation_frame:frame,simulation_time_seconds:time,accepted_publications:accepted,publication_at_ms:published,
   publication_timestamp_scope:'main-host snapshot acceptance',time_origin_ms:finite(timeOrigin)?timeOrigin:null,queried_at_ms:at,
   draw_attempts:attempts,completed_draws:completed,presented_frame_changes:unique,last_presented_snapshot_frame:lastFrame,
   last_completed_at_ms:lastCompleted,unknown_draws:unknown,error_draws:errors,skipped_draws:skipped,skip_counts:Object.freeze(counts),
   dropped_steps_total:Number.isSafeInteger(droppedSteps)&&droppedSteps>=droppedAtStart?droppedSteps-droppedAtStart:null,paused:paused===true,
   completed_intervals:Object.freeze({window_ms:windowMs,retained:values.length,capacity:LIMIT,oldest_end_ms:oldest,newest_end_ms:newest,p95_ms:percentile(.95),p99_ms:percentile(.99)}),
   semantics:'Completed synchronous world, UI and cursor submission; repeated snapshot redraws count separately. No GPU scanout or FPS guarantee.'});
 }
 return Object.freeze({accept,reset,attempt(){attempts++;},finish,outcome:()=>lastOutcome,error(){errors++;lastStatus='error';lastOutcome=DRAW_UNKNOWN;},snapshot:report});
}

// A configurable owned property permits page teardown/reinitialization. Never
// replace another script's existing public name; removal checks identity.
export function installPlayerPerformanceAccessor(target,read){
 if('unonePlayerPerformance'in target)return ()=>{};
 const api=Object.freeze({snapshot:read});Object.defineProperty(target,'unonePlayerPerformance',{value:api,configurable:true});
 return ()=>{if(target.unonePlayerPerformance===api)delete target.unonePlayerPerformance;};
}

// One RAF owns update -> acceptance -> draw. Preparing another game View while
// the old one remains visible would advance private Luau projector/hit caches
// before input on that visible view is consumed. Keep the coherent order.
export function createAsyncScheduler({
 tick,render,onError=console.error,onVisibilityChange=()=>{},onWake=null,
 onRafEnd=null,onPreparationStart=null,onPreparationEnd=null,
 stepMs=1000/60,maxCatchUpSteps=5,now=()=>performance.now(),
 raf=cb=>requestAnimationFrame(cb),cancelRaf=id=>cancelAnimationFrame(id),
 visibilityTarget=globalThis.document,
}={}){
 if(typeof tick!=='function'||typeof render!=='function')throw TypeError('async scheduler requires tick() and render()');
 if(!Number.isFinite(stepMs)||stepMs<=0)throw RangeError('stepMs must be positive');
 if(!Number.isInteger(maxCatchUpSteps)||maxCatchUpSteps<=0)throw RangeError('maxCatchUpSteps must be a positive integer');
 // RAF timestamps may be rounded to tenths of a millisecond. Retain any early
 // step as negative debt; this never adds simulation time or erases that debt.
 const toleranceMs=Math.min(.25,stepMs/100);
 let started=false,paused=false,busy=false,last=0,acc=0,frame=null,generation=0,dropped=0,attached=false;
 const hidden=()=>visibilityTarget?.hidden===true||visibilityTarget?.visibilityState==='hidden';
 function resetClock(){last=now();acc=0;generation++;}
 function cancelFrame(){if(frame!==null){cancelRaf(frame);frame=null;}}
 function schedule(){if(started&&!hidden()&&!busy&&frame===null)frame=raf(draw);}
 function stop(){started=false;resetClock();cancelFrame();if(attached){visibilityTarget?.removeEventListener?.('visibilitychange',visibility);attached=false;}}
 async function draw(timestamp){
  frame=null;if(!started||hidden()||busy)return;
  const token=generation,at=Number.isFinite(timestamp)?timestamp:now(),began=now(),elapsed=Math.max(0,at-last);
  last=at;busy=true;let steps=0,error=null,preparationStart=null,tag,preparationReported=false,submissionStart=null,submissionEnd=null;
  try{
   if(!paused){
    acc+=elapsed;const due=Math.floor((acc+toleranceMs)/stepMs),lost=Math.max(0,due-maxCatchUpSteps);
    dropped+=lost;acc-=lost*stepMs;
    const count=Math.min(maxCatchUpSteps,Math.floor((acc+toleranceMs)/stepMs));
    if(count>0){
     preparationStart=now();tag=onPreparationStart?.();
     while(steps<count&&started&&!hidden()&&!paused&&token===generation&&acc+toleranceMs>=stepMs){acc-=stepMs;await tick();steps++;}
     preparationReported=true;onPreparationEnd?.(tag,at,preparationStart,now(),steps,!started||hidden()||paused||token!==generation,stepMs);
    }
   }
   if(started&&!hidden()&&token===generation){
    // The originating browser RAF timestamp survives awaits. Only this known
    // synchronous submission continuation contributes callback_sync_wall;
    // worker/job waits belong to preparation_wall, never sync CPU/wall work.
    submissionStart=now();try{render(at,submissionStart,false,'scheduler_raf',stepMs);}finally{submissionEnd=now();}
   }
  }catch(cause){
   // Teardown can reject an in-flight worker request after stop(), or after
   // a new clock/generation has replaced it. Only its current owner may fail
   // the scheduler; an obsolete continuation must not stop a restarted one.
   if(started&&token===generation){error=String(cause?.message??cause);stop();onError(cause);}
  }
  finally{
   if(preparationStart!==null&&!preparationReported)onPreparationEnd?.(tag,at,preparationStart,now(),steps,true,stepMs);
   busy=false;
   try{if(submissionStart!==null)onRafEnd?.(at,submissionStart,submissionEnd,false,stepMs);
    onWake?.({source:'raf',start_ms:began,end_ms:now(),timestamp_ms:at,elapsed_ms:elapsed,steps,busy:false,dropped_steps:dropped,error});}
   finally{schedule();}
  }
 }
 function visibility(){resetClock();cancelFrame();onVisibilityChange({visible:!hidden()});schedule();}
 return {
  start(){if(started)return;started=true;paused=false;resetClock();if(!attached){visibilityTarget?.addEventListener?.('visibilitychange',visibility);attached=true;}schedule();},
  pause(){paused=true;resetClock();},resume(){paused=false;resetClock();schedule();},stop,resetClock,
  get totalDroppedSteps(){return dropped;},get busy(){return busy;},
 };
}

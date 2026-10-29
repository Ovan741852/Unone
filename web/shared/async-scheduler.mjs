// One visible RAF owns update -> accepted snapshot -> draw. Independent timer
// updates can redraw N and then replace N+1 with N+2 before the next RAF, even
// when both simulation and drawing individually average 60 Hz.
export function createAsyncScheduler({
 tick,render,onError=console.error,onVisibilityChange=()=>{},onWake=null,
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
  last=at;busy=true;let steps=0,error=null;
  try{
   if(!paused){
    acc+=elapsed;
    const lost=Math.max(0,Math.floor((acc+toleranceMs)/stepMs)-maxCatchUpSteps);
    dropped+=lost;acc-=lost*stepMs;
    while(steps<maxCatchUpSteps&&acc+toleranceMs>=stepMs){
     acc-=stepMs;steps++;
     // Each step owns its usual input transaction. Awaiting also prevents a
     // worker publication from replacing a snapshot while it is being drawn.
     await tick();
     if(!started||hidden()||paused||token!==generation)return;
    }
   }
   if(started&&!hidden()&&token===generation)render();
  }catch(cause){error=String(cause?.message??cause);stop();onError(cause);}
  finally{
   busy=false;
   try{onWake?.({source:'raf',start_ms:began,end_ms:now(),timestamp_ms:at,elapsed_ms:elapsed,steps,busy:false,dropped_steps:dropped,error});}
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

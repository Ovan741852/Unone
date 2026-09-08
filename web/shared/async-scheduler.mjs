// Async simulation, independent RAF rendering. One tick may be in flight.
export function createAsyncScheduler({tick,render,onError=console.error,onVisibilityChange=()=>{},onWake=()=>{},stepMs=1000/60,maxCatchUpSteps=5,now=()=>performance.now(),raf=cb=>requestAnimationFrame(cb),cancelRaf=id=>cancelAnimationFrame(id),timer=(cb,ms)=>setTimeout(cb,ms),clearTimer=id=>clearTimeout(id),visibilityTarget=globalThis.document}){
 let started=false,paused=false,busy=false,last=0,acc=0,frame=null,wake=null,generation=0,dropped=0;
 const hidden=()=>visibilityTarget?.hidden===true;
 function reset(){last=now();acc=0;generation++;}
 function pump(){if(!started)return;const at=now(),elapsed=Math.max(0,at-last);last=at;
  if(!paused&&!hidden()){
   acc+=elapsed;const cap=stepMs*maxCatchUpSteps;if(acc>cap){const lost=Math.floor((acc-cap)/stepMs);dropped+=lost;acc-=lost*stepMs;}
   if(!busy&&acc>=stepMs){acc-=stepMs;busy=true;const token=generation;Promise.resolve().then(tick).catch(onError).finally(()=>{busy=false;if(token!==generation)acc=0;if(started){clearTimer(wake);wake=timer(pump,0);}});}
  }
  onWake({source:'async-timer',start_ms:at,end_ms:now(),elapsed_ms:elapsed,busy,dropped_steps:dropped});wake=timer(pump,busy?stepMs:Math.max(1,stepMs-acc));
 }
 function draw(){if(!started)return;if(!hidden()){try{render();}catch(error){onError(error);}}frame=raf(draw);}
 function visibility(){reset();onVisibilityChange({visible:!hidden()});}
 visibilityTarget?.addEventListener?.('visibilitychange',visibility);
 return {start(){if(started)return;started=true;reset();pump();frame=raf(draw);},pause(){paused=true;reset();},resume(){paused=false;reset();},stop(){started=false;generation++;clearTimer(wake);cancelRaf(frame);visibilityTarget?.removeEventListener?.('visibilitychange',visibility);},resetClock:reset,get totalDroppedSteps(){return dropped;},get busy(){return busy;}};
}

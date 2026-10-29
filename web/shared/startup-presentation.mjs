// Official checked presentation startup only. No simulation/backend/tick ownership.
export function startupCancelled(){const error=Error('PLAYER_STARTUP_CANCELLED');error.name='AbortError';return error;}
function active(signal){if(signal?.aborted)throw startupCancelled();}
export async function adoptStartupRenderer(factory,{signal,dispose}={}){
 active(signal);const renderer=await factory();
 if(signal?.aborted){dispose?.(renderer);throw startupCancelled();}return renderer;
}
function abortable(promise,signal){
 active(signal);return new Promise((resolve,reject)=>{
  const abort=()=>{signal?.removeEventListener('abort',abort);reject(startupCancelled());};
  signal?.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{signal?.removeEventListener('abort',abort);resolve(value);},error=>{signal?.removeEventListener('abort',abort);reject(error);});
  if(signal?.aborted)abort();
 });
}
function nextStartupFrame(action,services){
 const {signal,nextFrame,cancelFrame}=services;active(signal);
 return new Promise((resolve,reject)=>{
  let id=null;const abort=()=>{if(id!==null)cancelFrame(id);signal?.removeEventListener('abort',abort);reject(startupCancelled());};
  signal?.addEventListener('abort',abort,{once:true});
  id=nextFrame(()=>{signal?.removeEventListener('abort',abort);try{active(signal);resolve(action());}catch(error){reject(error);}});
  if(signal?.aborted)abort();
 });
}
function waitForContext(services,budget){
 const {sample,subscribe,signal,timer,clearTimer,now}=services;active(signal);
 const remaining=budget.limit-budget.used;if(remaining<=0)throw Error('PLAYER_STARTUP_CONTEXT_RECOVERY_TIMEOUT');
 return new Promise((resolve,reject)=>{
  const began=now();let settled=false,unsubscribe=null,timeout=null;
  function finish(error){if(settled)return;settled=true;budget.used+=Math.max(0,now()-began);
   unsubscribe?.();if(timeout!==null)clearTimer(timeout);signal?.removeEventListener('abort',abort);error?reject(error):resolve();}
  const abort=()=>finish(startupCancelled());
  function wake(){try{active(signal);if(now()-began>=remaining)throw Error('PLAYER_STARTUP_CONTEXT_RECOVERY_TIMEOUT');
   if(sample().state!=='lost')finish();}catch(error){finish(error);}}
  unsubscribe=subscribe(wake);if(settled){unsubscribe();return;}
  signal?.addEventListener('abort',abort,{once:true});wake();
  if(!settled)timeout=timer(()=>finish(Error('PLAYER_STARTUP_CONTEXT_RECOVERY_TIMEOUT')),remaining);
 });
}
export async function completeStartupPresentation(options){
 const services={nextFrame:f=>requestAnimationFrame(f),cancelFrame:n=>cancelAnimationFrame(n),
  timer:(f,ms)=>setTimeout(f,ms),clearTimer:n=>clearTimeout(n),now:()=>performance.now(),...options};
 const {draw,waitForAssets,sample,commit,signal,onState=()=>{}}=services;
 const maxAttempts=options.maxAttempts??32,budget={limit:options.maxLostWaitMs??60000,used:0};let attempts=0;
 const emit=phase=>onState({phase,attempts,max_attempts:maxAttempts,lost_wait_ms:budget.used,max_lost_wait_ms:budget.limit});
 function drawAttempt(){active(signal);if(attempts>=maxAttempts)throw Error('PLAYER_STARTUP_PRESENTATION_UNSTABLE');attempts++;emit('drawing');draw();}
 async function assets(){emit('assets');await abortable(waitForAssets(),signal);active(signal);}
 try{
  drawAttempt();await assets();drawAttempt();
  for(;;){
   active(signal);const state=sample();
   if(state.state==='lost'){emit('waiting-context');await waitForContext(services,budget);continue;}
   if(state.state!=='presented'){emit('redraw');await nextStartupFrame(drawAttempt,services);await assets();continue;}
   emit('frame-barrier');const committed=await nextStartupFrame(()=>{
    emit('committing');if(sample().state!=='presented')return false;active(signal);
    if(commit()===false)return false;emit('ready');return true;
   },services);
   if(committed)return;
  }
 }catch(error){emit(error?.name==='AbortError'?'cancelled':'failed');throw error;}
}

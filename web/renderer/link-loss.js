// A dead GPU process can fail the next program link before the browser says the
// context is lost. Android Chrome 150 in BlueStacks (docs/profiling.md) failed a
// link with LINK_STATUS false, every info log empty, isContextLost() false and
// getError() 0, and dispatched webglcontextlost only afterwards; the same shader
// pair linked in a fresh context. A real compile or link error leaves a log.
//
// So a link failure with empty logs on a live context is a suspected loss: the
// renderer skips frames and waits, for at most waitMs, for the loss (the event
// or isContextLost() turning true). A program that failed while it waited and
// fails again after the wait ended with the context alive is a shader error.
export const SUSPECTED_CONTEXT_LOSS='GPU_CONTEXT_SUSPECTED_LOST';
export const LINK_LOSS_WAIT_MS=5000;
export const isSuspectedContextLoss=error=>String(error?.message??'').startsWith(SUSPECTED_CONTEXT_LOSS);
export const suspectedContextLoss=id=>Error(`${SUSPECTED_CONTEXT_LOSS}: ${id} failed to link with empty logs; waiting for webglcontextlost`);
const trimmed=value=>typeof value==='string'?value.trim():'';
export function programLogs(gl,program,vertex,fragment){
 return {program:trimmed(gl.getProgramInfoLog(program)),vertex:trimmed(gl.getShaderInfoLog(vertex)),fragment:trimmed(gl.getShaderInfoLog(fragment))};
}
export const emptyLogs=logs=>!logs.program&&!logs.vertex&&!logs.fragment;

// One per GL context. classify() is called where a link failure would be fatal;
// pending() is true while a wait is open; settled() resolves when it closes, with
// 'lost' (the loss arrived), 'alive' (the wait ran out) or 'disposed'.
export function createLinkLossGuard({canvas=null,waitMs=LINK_LOSS_WAIT_MS,now=()=>performance.now(),
 setTimer=(run,ms)=>setTimeout(run,ms),clearTimer=id=>clearTimeout(id),onChange=()=>{}}={}){
 let gl=null,wait=null,timer=null,waits=0,outcome=null,disposed=false;
 // Program -> the wait it failed in. Programs do not survive a loss, so a loss forgets them.
 let failed=new WeakMap();
 const lostNow=()=>gl?.isContextLost?.()===true;
 function close(result){
  if(!wait)return;if(timer!==null){clearTimer(timer);timer=null;}
  const resolvers=wait.resolvers;wait=null;outcome=result;
  for(const resolve of resolvers)resolve(result);
  onChange(result);
 }
 function lost(){failed=new WeakMap();close('lost');}
 function expire(){if(lostNow())lost();else close('alive');}
 function due(){return wait!==null&&now()-wait.at>=waitMs;}
 function classify(context,program,logs){
  if(context)gl=context;
  if(disposed)return 'fatal';
  if(lostNow()){lost();return 'suspected';}
  if(!emptyLogs(logs))return 'fatal';
  if(due())expire();
  const seen=failed.get(program);
  if(seen!==undefined&&seen!==wait?.id)return 'fatal';
  if(!wait){wait={id:++waits,at:now(),resolvers:[]};timer=setTimer(expire,waitMs);onChange('suspected');}
  failed.set(program,wait.id);
  return 'suspected';
 }
 function pending(){
  if(!wait)return false;
  if(lostNow()){lost();return false;}
  if(due()){expire();return false;}
  return true;
 }
 const onLost=()=>lost(),onRestored=()=>lost();
 canvas?.addEventListener?.('webglcontextlost',onLost);canvas?.addEventListener?.('webglcontextrestored',onRestored);
 return {classify,pending,waitMs,
  settled:()=>wait?new Promise(resolve=>wait.resolvers.push(resolve)):Promise.resolve(outcome??'alive'),
  metrics:()=>({waiting:wait!==null,suspected_losses:waits,last_outcome:outcome,wait_ms:waitMs}),
  dispose(){if(disposed)return;disposed=true;canvas?.removeEventListener?.('webglcontextlost',onLost);canvas?.removeEventListener?.('webglcontextrestored',onRestored);close('disposed');}};
}

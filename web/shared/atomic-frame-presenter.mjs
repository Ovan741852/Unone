// Internal coordinator for an opted-in host. No physical scan-out guarantee is
// implied by a successful submission: browser compositing remains asynchronous.
// Hooks must be synchronous; the caller owns scheduling, visibility and UI.
export function createAtomicFramePresenter({transaction,transactionSnapshot=value=>value,prepare,drawWorld,drawUi,routeToken,commitRoute,abortRoute,commitHosts,enterWait,recover,leaveWait}){
 for(const [name,fn]of Object.entries({prepare,drawWorld,drawUi,routeToken,commitRoute,abortRoute,commitHosts,enterWait,recover,leaveWait}))
  if(typeof fn!=='function')throw Error(`ATOMIC_FRAME_HOOK_REQUIRED: ${name}`);
 if(!transaction||!['begin','commit','abort'].every(k=>typeof transaction[k]==='function'))throw Error('ATOMIC_FRAME_TRANSACTION_REQUIRED');
 let running=false,disposed=false;
 const completed=value=>value?.status==='completed';
 function present(snapshot){
  if(disposed)throw Error('ATOMIC_FRAME_DISPOSED');if(running)throw Error('ATOMIC_FRAME_REENTRANT');running=true;
  let active=false,token=null,recovered=false,canvasChanged=false,uiStarted=false,uiReturned=false;
  const fail=value=>{recovered=true;recover(value);};
  const stop=(outcome,uncertain=false)=>{
   if(token!==null){abortRoute(token);token=null;}
   if(active){transaction.abort();active=false;}
   if(uncertain||outcome?.presentation==='unknown')fail(outcome);else enterWait(outcome);
   return outcome;
  };
  try{
   const prepared=prepare(snapshot);if(!completed(prepared))return stop(prepared);
   const transactionValue=transactionSnapshot(snapshot);
   let begin=transaction.begin(transactionValue,{allowResize:false});
   if(begin?.reason==='frame_resize_required'){
    // This callback must synchronously block interaction and show opaque UI;
    // changing canvas dimensions itself destroys its old drawing buffer.
    enterWait(begin);begin=transaction.begin(transactionValue,{allowResize:true});
   }
   if(!completed(begin))return stop(begin,begin?.presentation==='unknown');active=true;canvasChanged=begin.presentation==='unknown';
   const world=drawWorld(snapshot);if(!completed(world))return stop(world,begin.presentation==='unknown');
   uiStarted=true;const ui=drawUi(snapshot);uiReturned=true;token=routeToken();if(!completed(ui))return stop(ui,begin.presentation==='unknown');
   const result=transaction.commit();active=false;
   if(!completed(result)||result.presentation!=='submitted')return stop(result,canvasChanged||result?.presentation==='unknown');
   // From this point the compositor may already have the new world. If a
   // routing/IME/cursor commit fails, a recovery cover is mandatory.
   try{commitHosts(snapshot);if(token!==null){commitRoute(token);token=null;}leaveWait();}
   catch(error){if(token!==null){abortRoute(token);token=null;}fail({status:'skipped',reason:'host_commit_failed',presentation:'unknown',error});throw error;}
   return result;
  }catch(error){
   // drawUi may throw after it staged a route but before it returned the
   // token to this coordinator. Retire that candidate as well.
   if(uiStarted&&!uiReturned&&token===null)try{token=routeToken();}catch{}
   if(token!==null){try{abortRoute(token);}catch{}token=null;}
   if(active){try{transaction.abort();}catch{}active=false;}
   // Even an exception before begin can be followed by asynchronous callbacks.
   // Recover is idempotent and keeps input blocked until a later clean frame.
   if(!recovered)fail({status:'skipped',reason:'frame_exception',presentation:'unknown',error});throw error;
  }finally{running=false;}
 }
 return {present,dispose(){disposed=true;}};
}

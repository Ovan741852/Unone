// Records only presentation waits while the host is eligible/visible.  This
// clock never changes hostTime: the receipt is ordinary recorded tick input.
// A committed receipt is cumulative within an epoch so a failed tick can be
// retried without losing or double-counting the interval.
const MAX=Number.MAX_SAFE_INTEGER;
export function createPresentationWaitClock({epoch=1,now=()=>performance.now(),wallNow=now,eligible=true,maxObservationGapMs=1000}={}){
 if(!Number.isSafeInteger(epoch)||epoch<1)throw Error('PRESENTATION_WAIT_EPOCH_INVALID');
 if(!Number.isFinite(maxObservationGapMs)||maxObservationGapMs<=0)throw Error('PRESENTATION_WAIT_GAP_INVALID');
 let active=false,allowed=Boolean(eligible),start=null,wallStart=null,total=0,uncertain=0,revision=1,ack=0,inflight=null,disposed=false,lastNow=null;
 function timestamp(){const t=now();if(typeof t!=='number'||!Number.isFinite(t)||t<0||(lastNow!==null&&t<lastNow))throw Error('PRESENTATION_WAIT_CLOCK_INVALID');lastNow=t;return t;}
 function wall(){const value=wallNow();if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('PRESENTATION_WAIT_CLOCK_INVALID');return value;}
 function close(t,w){if(start===null)return;const elapsed=Math.max(t-start,Math.max(0,w-wallStart));
  const observed=t-start<=maxObservationGapMs&&w>=wallStart&&w-wallStart<=maxObservationGapMs;
  const next=observed?total+Math.min(t-start,w-wallStart):uncertain+elapsed;
  if(!Number.isFinite(next)||next>MAX)throw Error('PRESENTATION_WAIT_OVERFLOW');
  if(observed)total=next;else uncertain=next;start=wallStart=null;}
 function restart(t,w){if(active&&allowed){start=t;wallStart=w;}}
 function ensure(){if(disposed)throw Error('PRESENTATION_WAIT_DISPOSED');}
 function snapshot(){return {epoch,visible_ms:Math.floor(total),uncertain_ms:Math.floor(uncertain)};}
 return {
  begin(){ensure();if(active)return;const t=timestamp(),w=wall();active=true;restart(t,w);},
  checkpoint(){ensure();if(!active||!allowed)return;const t=timestamp(),w=wall();close(t,w);restart(t,w);},
  end(){ensure();if(!active)return;const t=timestamp(),w=wall();close(t,w);active=false;revision++;},
  setEligible(value){ensure();const next=Boolean(value);if(next===allowed)return;const t=timestamp(),w=wall();close(t,w);allowed=next;restart(t,w);},
  // A lease remains byte-identical on failure and cannot acknowledge a newer
  // epoch or newly accrued wait by accident.
  lease(){ensure();if(inflight)return {token:inflight.token,receipt:{...inflight.receipt}};
   if(ack===revision)return null;const token=Symbol('presentation-wait'),receipt=snapshot();inflight={token,receipt,revision};return {token,receipt:{...receipt}};},
  commit(token){ensure();if(!inflight||inflight.token!==token)throw Error('PRESENTATION_WAIT_STALE_COMMIT');ack=inflight.revision;inflight=null;},
  retry(token){ensure();if(!inflight||inflight.token!==token)throw Error('PRESENTATION_WAIT_STALE_RETRY');},
  reset(nextEpoch){ensure();if(active||inflight)throw Error('PRESENTATION_WAIT_RESET_BUSY');if(!Number.isSafeInteger(nextEpoch)||nextEpoch<=epoch)throw Error('PRESENTATION_WAIT_EPOCH_INVALID');epoch=nextEpoch;total=uncertain=0;revision=1;ack=0;start=wallStart=null;lastNow=null;},
  report(){return {epoch,visible_ms:Math.floor(total),uncertain_ms:Math.floor(uncertain),active,eligible:allowed,waiting_receipt:!!inflight};},
  dispose(){disposed=true;inflight=null;start=null;},
 };
}

// Independent of the frame scheduler: it also observes startup waits, where
// no scheduler has started yet. Browser throttling/suspension naturally
// becomes an uncertain interval in the clock rather than invented visibility.
export function createPresentationWaitHeartbeat({clock,schedule=setTimeout,cancel=clearTimeout,intervalMs=250,onError=error=>{throw error;}}){
 if(!clock||typeof clock.checkpoint!=='function'||!Number.isFinite(intervalMs)||intervalMs<=0)throw Error('PRESENTATION_HEARTBEAT_INVALID');
 let running=false,timer=null;
 function arm(){if(running&&timer===null)timer=schedule(tick,intervalMs);}
 function tick(){timer=null;if(!running)return;try{clock.checkpoint();}catch(error){running=false;onError(error);return;}arm();}
 return {start(){if(running)return;running=true;arm();},stop(){running=false;if(timer!==null)cancel(timer);timer=null;},report:()=>({running,scheduled:timer!==null})};
}

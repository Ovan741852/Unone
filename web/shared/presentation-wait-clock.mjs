// Records only presentation waits while the host is eligible/visible.  This
// clock never changes hostTime: the receipt is ordinary recorded tick input.
// A committed receipt is cumulative within an epoch so a failed tick can be
// retried without losing or double-counting the interval.
const MAX=Number.MAX_SAFE_INTEGER;
export function createPresentationWaitClock({epoch=1,now=()=>performance.now(),eligible=true}={}){
 if(!Number.isSafeInteger(epoch)||epoch<1)throw Error('PRESENTATION_WAIT_EPOCH_INVALID');
 let active=false,allowed=Boolean(eligible),start=null,total=0,revision=1,ack=0,inflight=null,disposed=false,lastNow=null;
 function timestamp(){const t=now();if(typeof t!=='number'||!Number.isFinite(t)||t<0||(lastNow!==null&&t<lastNow))throw Error('PRESENTATION_WAIT_CLOCK_INVALID');lastNow=t;return t;}
 function close(t){if(start===null)return;const next=total+(t-start);if(!Number.isFinite(next)||next>MAX)throw Error('PRESENTATION_WAIT_OVERFLOW');total=next;start=null;}
 function restart(t){if(active&&allowed)start=t;}
 function ensure(){if(disposed)throw Error('PRESENTATION_WAIT_DISPOSED');}
 function snapshot(){return {epoch,visible_ms:Math.floor(total)};}
 return {
  begin(){ensure();if(active)return;const t=timestamp();active=true;restart(t);},
  end(){ensure();if(!active)return;const t=timestamp();close(t);active=false;revision++;},
  setEligible(value){ensure();const next=Boolean(value);if(next===allowed)return;const t=timestamp();close(t);allowed=next;restart(t);},
  // A lease remains byte-identical on failure and cannot acknowledge a newer
  // epoch or newly accrued wait by accident.
  lease(){ensure();if(inflight)return {token:inflight.token,receipt:{...inflight.receipt}};
   if(ack===revision)return null;const token=Symbol('presentation-wait'),receipt=snapshot();inflight={token,receipt,revision};return {token,receipt:{...receipt}};},
  commit(token){ensure();if(!inflight||inflight.token!==token)throw Error('PRESENTATION_WAIT_STALE_COMMIT');ack=inflight.revision;inflight=null;},
  retry(token){ensure();if(!inflight||inflight.token!==token)throw Error('PRESENTATION_WAIT_STALE_RETRY');},
  reset(nextEpoch){ensure();if(active||inflight)throw Error('PRESENTATION_WAIT_RESET_BUSY');if(!Number.isSafeInteger(nextEpoch)||nextEpoch<=epoch)throw Error('PRESENTATION_WAIT_EPOCH_INVALID');epoch=nextEpoch;total=0;revision=1;ack=0;start=null;lastNow=null;},
  report(){return {epoch,visible_ms:Math.floor(total),active,eligible:allowed,waiting_receipt:!!inflight};},
  dispose(){disposed=true;inflight=null;start=null;},
 };
}

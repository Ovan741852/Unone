// Released-player error policy and reporting (docs/player-export.md#runtime-errors).
// The engine does the recovering, as the export's error_policy allows: it keeps
// the previous screen when a UI publish is over capacity, and skips the rest of
// a failing Game.update until too many frames fail in a row. This host makes
// every recovery visible without stopping the game: a rate-limited console
// warning, a small notice, and document.body.dataset.playerRecoveredErrors.
const UI_CAPACITY=['fail','keep_previous'],SCRIPT_ERRORS=['fail','continue'],FIELDS=['ui_capacity','script_errors','max_consecutive_script_errors'];

// The policy to send in the load payload, or null for the engine's strict
// default. The exporter writes error_policy into presentation.json; an export
// without one (older or hand-assembled) stays strict. ?unone_errors=strict
// forces strict on a production export for QA runs that must fail loudly.
export function playerErrorPolicy(presentation,search=''){
 const forced=new URLSearchParams(search).get('unone_errors');
 if(forced!==null&&forced!=='strict')throw Error('PLAYER_ERROR_POLICY_OVERRIDE_INVALID: ?unone_errors=strict is the only override');
 const declared=presentation?.error_policy;
 if(declared===undefined||forced==='strict')return null;
 if(!declared||typeof declared!=='object'||Array.isArray(declared)||Object.keys(declared).some(key=>!FIELDS.includes(key)))throw Error('ERROR_POLICY_INVALID: presentation.json error_policy');
 const policy={ui_capacity:'fail',script_errors:'fail',max_consecutive_script_errors:60,...declared};
 if(!UI_CAPACITY.includes(policy.ui_capacity)||!SCRIPT_ERRORS.includes(policy.script_errors)||!Number.isInteger(policy.max_consecutive_script_errors)||policy.max_consecutive_script_errors<1||policy.max_consecutive_script_errors>3600)throw Error('ERROR_POLICY_INVALID: presentation.json error_policy');
 return policy.ui_capacity==='fail'&&policy.script_errors==='fail'?null:policy;
}

const LABEL={ui:'UI publish over capacity; kept the previous screen',script:'Game.update error; skipped the rest of that update'};
// Reads world.recovered_errors from each accepted snapshot. Counters are
// cumulative per runtime session; a fresh session (restart) starts them over.
export function createRecoveryReporter({target,log=globalThis.console,now=()=>performance.now(),warnIntervalMs=5000,noticeMs=4000,doc=globalThis.document,schedule=globalThis.setTimeout,cancel=globalThis.clearTimeout}={}){
 let seen={ui:0,script:0},latest=null,notice=null,hideTimer=null,disposed=false;
 const lastWarn={ui:-Infinity,script:-Infinity},skipped={ui:0,script:0};
 function warn(kind,added,record,at){
  if(at-lastWarn[kind]<warnIntervalMs){skipped[kind]+=added;return;}
  const more=skipped[kind]+added-1;skipped[kind]=0;lastWarn[kind]=at;
  log?.warn?.(`UNONE_PLAYER_RECOVERED ${LABEL[kind]}${more>0?` (+${more} more)`:''}: ${JSON.stringify(record??null)}`);
 }
 function show(record){
  if(!doc?.createElement||!doc.body)return;
  if(!notice){
   notice=doc.createElement('div');notice.dataset.unonePlayerNotice='';notice.setAttribute('role','status');
   notice.style.cssText='position:fixed;left:8px;bottom:8px;max-width:min(36em,calc(100% - 16px));padding:3px 8px;border-radius:4px;background:#000a;color:#fde68a;font:12px/1.4 system-ui,sans-serif;pointer-events:none;z-index:2147483647';
   doc.body.append(notice);
  }
  const parts=[];
  if(record.ui_rejections)parts.push(`UI kept previous screen ×${record.ui_rejections}${record.last_ui_rejection?` (${record.last_ui_rejection.code})`:''}`);
  if(record.script_errors)parts.push(`script errors skipped ×${record.script_errors}`);
  notice.textContent='Recovered: '+parts.join(' · ');notice.hidden=false;
  if(hideTimer!=null)cancel(hideTimer);
  hideTimer=schedule(()=>{hideTimer=null;if(notice)notice.hidden=true;},noticeMs);
 }
 return {
  accept(world){
   if(disposed)return false;
   const record=world?.recovered_errors;
   if(!record){seen={ui:0,script:0};return false;}
   if(record.ui_rejections<seen.ui||record.script_errors<seen.script)seen={ui:0,script:0};
   const ui=record.ui_rejections-seen.ui,script=record.script_errors-seen.script;
   if(ui<=0&&script<=0){
    // A returning update resets the consecutive run; keep the QA copy current.
    if(latest&&record.consecutive_script_errors!==latest.consecutive_script_errors){latest=record;if(target?.dataset)target.dataset.playerRecoveredErrors=JSON.stringify(record);}
    return false;
   }
   const at=now();seen={ui:record.ui_rejections,script:record.script_errors};latest=record;
   if(ui>0)warn('ui',ui,record.last_ui_rejection,at);
   if(script>0)warn('script',script,record.last_script_error,at);
   if(target?.dataset)target.dataset.playerRecoveredErrors=JSON.stringify(record);
   show(record);
   return true;
  },
  report:()=>latest,
  dispose(){disposed=true;if(hideTimer!=null)cancel(hideTimer);hideTimer=null;notice?.remove();notice=null;},
 };
}

// Released-player error policy and reporting (docs/player-export.md#runtime-errors).
// The engine does the recovering, as the export's error_policy allows: it keeps
// the previous screen when a UI publish is over capacity, and skips the rest of
// a failing Game.update until too many frames fail in a row. This host makes
// every recovery visible without stopping the game: a rate-limited console
// warning, a small notice, and document.body.dataset.playerRecoveredErrors.
const UI_CAPACITY=['fail','keep_previous'],SCRIPT_ERRORS=['fail','continue'],FIELDS=['ui_capacity','script_errors','max_consecutive_script_errors'];

// Host-independent, versioned outgoing error contract. Never forward a world,
// physical-input receipt, save, arbitrary diagnostic facts or the thrown object.
export const PLAYER_ERROR_EVENT='unone-player-error';
function technicalText(value,max){
 return String(value??'').slice(0,8192)
  .replace(/https?:\/\/[^\s<>"')]+/gi,'[url]')
  .replace(/\b[A-Z]:[\\/][^\r\n)]+/gi,'[local-path]')
  .replace(/\b(?:Bearer\s+\S+|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+)?)/gi,'[secret]')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email]')
  .replace(/\b(?:password|token|secret|authorization|cookie|session|playerId|userId|username)["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi,'[redacted]')
  .replace(/\{[^\r\n]*\}/g,'[data]').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,max);
}
const identifier=(value,fallback)=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(value)?value:fallback;
const coordinate=value=>Number.isSafeInteger(value)&&value>=0&&value<=10000000?value:undefined;
function sourceFrames(value){
 const frames=[];let file,line;
 for(const row of String(value??'').slice(0,16384).split('\n')){
  // Luau frames and V8/Safari/Firefox JS frames. Keep only basenames/positions.
  const lua=/^\s*\[string\s+\\?["']([^"'\r\n]+?)\\?["']\]:(\d+)/.exec(row);
  const js=!lua&&/^\s*(?:at\s+|[^\s@]+@).*?([^\s/\\():]+\.(?:[cm]?js|luau?)):(\d+)(?::\d+)?/.exec(row);
  const match=lua||js;if(!match)continue;
  const name=match[1].replace(/\\/g,'/').split('/').at(-1);const pos=coordinate(Number(match[2]));
  if(!/^[A-Za-z0-9_. -]{1,160}$/.test(name)||!pos)continue;
  file??=name;line??=pos;frames.push('    at '+name+':'+pos);if(frames.length===12)break;
 }
 return {file,line,stack:frames.join('\n').slice(0,2048)};
}
export function playerErrorDetail(error,{fatal=true,phase='runtime',backend='unknown',sequence=1}={}){
 let raw='',stack='',envelope,errorCode,errorFrame;
 try{
  raw=typeof error==='string'?error:typeof error?.message==='string'?error.message:'Player operation failed';
  stack=typeof error?.stack==='string'?error.stack:'';
  errorCode=error?.code;errorFrame=error?.frame;
  if(raw.length<=65536&&raw.trimStart().startsWith('{'))try{envelope=JSON.parse(raw);}catch{}
 }catch{raw='Player operation failed';}
 const diagnostic=envelope?.diagnostic;
 const cause=diagnostic?.facts?.last_error;
 const detail=typeof diagnostic?.explanation==='string'?diagnostic.explanation:raw;
 const text=typeof cause?.explanation==='string'?cause.explanation:detail;
 const origin=sourceFrames(text);const frames=origin.stack?origin:sourceFrames(stack);
 const result={version:1,sequence,severity:fatal?'error':'warning',fatal,phase:identifier(phase,'runtime'),backend:['main','worker'].includes(backend)?backend:'unknown',
  code:identifier(diagnostic?.code??errorCode,'PLAYER_ERROR'),message:technicalText(text.split('\n')[0],512)||'Player operation failed'};
 if(cause?.code)result.causeCode=identifier(cause.code,'LUAU_RUNTIME_ERROR');
 if(frames.stack)result.stack=frames.stack;
 if(frames.file){result.file=frames.file;result.line=frames.line;}
 const frame=coordinate(cause?.frame??errorFrame);if(frame!==undefined)result.frame=frame;
 return Object.freeze(result);
}
export function createPlayerErrorChannel({target=globalThis.window,context=()=>({})}={}){
 let terminal=false,latest=null,sequence=0,closed=false;const subscribers=new Set();
 const api=Object.freeze({last:()=>latest,subscribe(listener){
  if(typeof listener!=='function')throw TypeError('PLAYER_ERROR_LISTENER_INVALID');
  if(closed)return()=>{};if(subscribers.size>=32)throw RangeError('PLAYER_ERROR_LISTENER_LIMIT');
  subscribers.add(listener);return()=>subscribers.delete(listener);
 }});
 try{if(target)Object.defineProperty(target,'unonePlayerErrors',{value:api,configurable:true});}catch{}
 function emit(error,fatal){
  if(closed||terminal)return null;if(fatal)terminal=true;
  let info={};try{info=context()??{};}catch{}
  let event;try{event=playerErrorDetail(error,{fatal,phase:info.phase,backend:info.backend,sequence:++sequence});}catch{event=playerErrorDetail('Player operation failed',{fatal,sequence});}latest=event;
  for(const listener of [...subscribers])try{const value=listener(event);if(value?.then)Promise.resolve(value).catch(()=>{});}catch{/* A subscriber cannot stop cleanup or recurse. */}
  try{target?.dispatchEvent?.(new CustomEvent(PLAYER_ERROR_EVENT,{detail:event}));}catch{}
  return event;
 }
 return {api,fatal:error=>emit(error,true),recovered:record=>emit({message:record?.message??'Recovered player error',code:record?.code,frame:record?.frame},false),
  reset(){terminal=false;latest=null;},dispose(){closed=true;subscribers.clear();try{if(target?.unonePlayerErrors===api)delete target.unonePlayerErrors;}catch{}}};
}

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
export function createRecoveryReporter({target,log=globalThis.console,now=()=>performance.now(),warnIntervalMs=5000,noticeMs=4000,doc=globalThis.document,schedule=globalThis.setTimeout,cancel=globalThis.clearTimeout,onError=()=>{}}={}){
 let seen={ui:0,script:0},latest=null,notice=null,hideTimer=null,disposed=false;
 const lastWarn={ui:-Infinity,script:-Infinity},skipped={ui:0,script:0};
 function warn(kind,added,record,at){
  if(at-lastWarn[kind]<warnIntervalMs){skipped[kind]+=added;return;}
  const more=skipped[kind]+added-1;skipped[kind]=0;lastWarn[kind]=at;
  try{onError(record);}catch{/* Optional host observers never alter recovery. */}
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

const modes=['bloom_on_ao_off','bloom_off_ao_off','bloom_on_ao_on','bloom_off_ao_on'];
// Extension enabling and query objects belong to one WebGL context epoch.
export function createBloomTimer(gl,canvas){
 let extension=gl.getExtension('EXT_disjoint_timer_query_webgl2'),epoch=1,lost=false,disposed=false,active=null;
 const pending=[],samples=Object.fromEntries(modes.map(mode=>[mode,[]]));
 const rawLost=()=>gl.isContextLost?.()===true;
 function lose(){
  if(disposed||lost)return;lost=true;extension=null;active=null;pending.length=0;
  for(const values of Object.values(samples))values.length=0;
 }
 function restore(){
  if(disposed||!lost)return;lost=false;epoch++;
  extension=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 }
 function available(){if(rawLost())lose();return !disposed&&!lost&&extension!==null;}
 function poll(){
  if(!available())return;
  if(gl.getParameter(extension.GPU_DISJOINT_EXT)){
   for(const item of pending)gl.deleteQuery(item.query);pending.length=0;return;
  }
  while(pending.length&&gl.getQueryParameter(pending[0].query,gl.QUERY_RESULT_AVAILABLE)){
   const item=pending.shift(),ms=gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6;
   gl.deleteQuery(item.query);const bucket=samples[item.mode];bucket.push(ms);if(bucket.length>240)bucket.shift();
  }
 }
 function begin(mode){
  if(!modes.includes(mode))throw Error('GPU_TIMER_MODE_INVALID');
  poll();if(!available()||pending.length>=8)return null;
  if(active)throw Error('GPU_TIMER_NESTED_QUERY');
  const query=gl.createQuery();if(rawLost()){lose();return null;}if(!query)return null;
  const token={query,epoch,mode};gl.beginQuery(extension.TIME_ELAPSED_EXT,query);active=token;return token;
 }
 function end(token){
  if(!token||!available()||token.epoch!==epoch||active!==token)return;
  active=null;gl.endQuery(extension.TIME_ELAPSED_EXT);pending.push(token);
 }
 function reset(){
  for(const values of Object.values(samples))values.length=0;
  if(available())for(const item of pending)gl.deleteQuery(item.query);pending.length=0;
 }
 function metrics(){
  const summarize=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);
   return {samples:values.length,median_ms:sorted[Math.floor(sorted.length/2)],p95_ms:sorted[Math.floor(sorted.length*.95)]};};
  return {available:available(),context:{epoch,lost,disposed,pending:pending.length,active:active!==null},
   samples:Object.fromEntries(Object.entries(samples).map(([mode,values])=>[mode,summarize(values)]))};
 }
 function dispose(){
  if(disposed)return;
  if(available()){
   if(active){gl.endQuery(extension.TIME_ELAPSED_EXT);gl.deleteQuery(active.query);active=null;}
   for(const item of pending)gl.deleteQuery(item.query);
  }
  pending.length=0;active=null;extension=null;disposed=true;
  canvas?.removeEventListener?.('webglcontextlost',lose);canvas?.removeEventListener?.('webglcontextrestored',restore);
 }
 canvas?.addEventListener?.('webglcontextlost',lose);canvas?.addEventListener?.('webglcontextrestored',restore);
 return {begin,end,reset,metrics,dispose};
}

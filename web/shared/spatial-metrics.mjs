// Detached, bounded host diagnostics. Nothing here affects fixed-tick delivery.
const kinds=['configure','drain','complete','report','profile','fault','diagnostic'];
const phases=['json_encode_ms','copy_in_ms','abi_ms','response_decode_ms'];
const safe=Number.MAX_SAFE_INTEGER;
const add=(a,b)=>Math.min(safe,a+b);
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
function empty(){return {requests:0,failed_requests:0,request_bytes:0,response_bytes:0,...Object.fromEntries(phases.map(p=>[p,0]))};}
export function createSpatialHostMetrics(){
 let setup=null,totals=empty(),byKind={};
 return {
  reset(){setup=null;totals=empty();byKind={};},
  setup(sample){
   for(const p of ['total_ms','executor_create_ms','configure_ms'])if(!number(sample[p]))throw Error('SPATIAL_METRIC_INVALID');
   setup={...sample};
  },
  request(kind,sample){
   if(!kinds.includes(kind)||!['request_bytes','response_bytes',...phases].every(p=>number(sample[p])))throw Error('SPATIAL_METRIC_INVALID');
   const entry=byKind[kind]??=empty();
   for(const target of [totals,entry]){
    target.requests=add(target.requests,1);if(!sample.success)target.failed_requests=add(target.failed_requests,1);
    for(const p of ['request_bytes','response_bytes',...phases])target[p]=add(target[p],sample[p]);
   }
  },
  report(){return structuredClone({api_version:1,clock:'host_monotonic',scope:'Since latest host load. JSON encode includes stringify/TextEncoder; copy_in covers WASM allocation/copy; abi includes the synchronous WASM request and its internal serialization, not GPU execution; response_decode covers readObservation copy/TextDecoder/JSON parse. Setup includes executor creation/configuration; configure_ms overlaps bridge configure timings. Excludes project load, Worker messaging, caller application and report cloning. Failed request metrics include only phases reached.',setup,bridge:{totals,by_kind:byKind}});},
 };
}

// Reproducible exported-payload CPU probe, usable for any project; no renderer.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {webcrypto,createHash} from 'node:crypto';
import {cpus,platform,freemem,totalmem} from 'node:os';
import vm from 'node:vm';
const {values}=parseArgs({options:{export:{type:'string'},output:{type:'string'},frames:{type:'string',default:'180'},warmup:{type:'string',default:'30'},repeats:{type:'string',default:'3'},sampling:{type:'boolean',default:false},seed:{type:'string',default:'42'},transport:{type:'string',default:'auto'},'verify-memory':{type:'boolean',default:false},'checkpoint-every':{type:'string',default:'30'},'setup-requests':{type:'string'},'no-profile-window':{type:'boolean',default:false}}});
if(values.sampling&&values['no-profile-window'])throw new Error('sampling requires a profile window');
const checkpointEvery=Number(values['checkpoint-every']);if(!Number.isInteger(checkpointEvery)||checkpointEvery<1||checkpointEvery>10000)throw new Error('checkpoint-every must be 1..10000');
const setupRequests=values['setup-requests']?JSON.parse(readFileSync(values['setup-requests'],'utf8')):[];if(!Array.isArray(setupRequests)||setupRequests.length>64)throw new Error('setup-requests must be an array of at most 64 core requests');
if(!values.export)throw new Error('Use --export <development player> [--output report.json] [--sampling]');
const frames=Number(values.frames),warmup=Number(values.warmup),repeats=Number(values.repeats),seed=BigInt(values.seed);
if(!Number.isInteger(frames)||frames<1||frames>10000||!Number.isInteger(warmup)||warmup<0||warmup>10000||!Number.isInteger(repeats)||repeats<1||repeats>20||seed<0n||seed>2n**64n-1n)throw new Error('Invalid bounded frame/repeat/seed arguments');
if(!['auto','json','memory'].includes(values.transport))throw new Error('transport must be auto/json/memory');
const folder=resolve(values.export),manifest=JSON.parse(readFileSync(join(folder,'runtime/runtime.json'),'utf8'));
if(!manifest.preview_tools)throw new Error('Development export required for profiling');
const payloadBytes=readFileSync(join(folder,'content/project.json')),payload=JSON.parse(payloadBytes),wasmBytes=readFileSync(join(folder,'runtime',manifest.wasm));
const hash=b=>createHash('sha256').update(b).digest('hex');
const js=join(folder,'runtime',manifest.javascript);
const {loadProject,readObservation}=await import(pathToFileURL(join(folder,'web/shared/load-project.js')).href);
const module=await new Promise((ready,reject)=>{
 const options={wasmBinary:new Uint8Array(wasmBytes),noInitialRun:true,onAbort:r=>reject(new Error(String(r))),print:()=>{},printErr:console.error};
 const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
 options.onRuntimeInitialized=()=>ready(context.Module);vm.runInNewContext(readFileSync(js,'utf8'),context,{filename:js});
});
function request(value){const b=new TextEncoder().encode(JSON.stringify(value)),p=module._unone_web_alloc(b.length);module.HEAPU8.set(b,p);const code=module._unone_web_developer_request(p,b.length),r=readObservation(module);if(code||!r.ok)throw new Error(JSON.stringify(r));return r.value;}
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return {mean_ms:a.reduce((x,y)=>x+y,0)/a.length,median_ms:s[Math.floor(s.length/2)],p95_ms:s[Math.ceil(s.length*.95)-1],max_ms:s.at(-1)};};
const memoryTransport=values.transport==='memory'||(values.transport==='auto'&&typeof module._unone_web_set_instance_transport==='function');
const report={version:1,artifact:{payload_sha256:hash(payloadBytes),wasm_sha256:hash(wasmBytes),javascript_sha256:hash(readFileSync(js)),manifest},environment:{node:process.version,platform:platform(),cpu:cpus()[0]?.model,cpu_count:cpus().length,memory_free_bytes:freemem(),memory_total_bytes:totalmem(),started_utc:new Date().toISOString()},conditions:{instance_transport:memoryTransport?'wasm-memory-v1':'json',frames,warmup,repeats,seed:String(seed),sampling:values.sampling,profile_window:!values['no-profile-window'],checkpoint_every:checkpointEvery,setup_requests:setupRequests,input:'empty input every tick',excluded:['renderer','GPU','RAF scheduler','recording','human tools panel'],note:'CPU throughput, not interactive FPS. Compare like-for-like unprofiled runs; sampling has overhead.'},runs:[]};
for(let repeat=0;repeat<repeats;repeat++){
 loadProject(module,payload,seed);
 if(memoryTransport){if(!module._unone_web_set_instance_transport||module._unone_web_set_instance_transport(1))throw new Error('INSTANCE_TRANSPORT_UNAVAILABLE');}
 if(values['verify-memory']){
  if(!memoryTransport)throw new Error('Memory verification requires memory transport');
  const binary=readObservation(module),old=module.HEAPU8.buffer;
  module._unone_web_alloc(old.byteLength+65536);
  if(module.HEAPU8.buffer===old)throw new Error('Memory growth was not exercised');
  const copies=Object.fromEntries(Object.entries(binary.world.instances3d).map(([id,b])=>[id,Buffer.from(new Uint8Array(module.HEAPU8.buffer,b.memory.offset,b.memory.byte_length))]));
  if(module._unone_web_set_instance_transport(0))throw new Error('JSON switch failed');
  const json=readObservation(module);
  if(binary.observation_digest!==json.observation_digest)throw new Error('Transport changed digest');
  for(const [id,b]of Object.entries(json.world.instances3d))if(!copies[id].equals(Buffer.from(b.data,'base64')))throw new Error('INSTANCE_BYTES_MISMATCH: '+id);
  if(module._unone_web_set_instance_transport(1))throw new Error('Memory switch failed');
  report.memory_verification={batches:Object.keys(copies).length,memory_growth:true,bytes_equal:true,digest_equal:true,note:'Verification run; allocation overhead makes it unsuitable as a clean timing baseline'};
 }

 for(const setup of setupRequests)request(setup);
 const raw=[],checkpoints=[];
 function tick(){const input=new TextEncoder().encode('{"actions":{}}'),p=module._unone_web_alloc(input.length);module.HEAPU8.set(input,p);if(module._unone_web_set_input_frame(p,input.length))throw new Error('input failed');const a=performance.now();if(module._unone_web_tick())throw new Error(JSON.stringify(readObservation(module)));const b=performance.now(),state=readObservation(module),c=performance.now();return {tick_publish_ms:b-a,decode_ms:c-b,total_ms:c-a,state,output_bytes:module._unone_web_observation_len()};}
 for(let i=0;i<warmup;i++)tick();
 if(!values['no-profile-window'])request({method:'profile_start',sampling:values.sampling});
 let state;
 for(let i=0;i<frames;i++){const r=tick();state=r.state;raw.push([r.tick_publish_ms,r.decode_ms,r.total_ms,r.output_bytes]);if((i+1)%checkpointEvery===0||i===frames-1)checkpoints.push({frame:state.world.frame,digest:state.observation_digest});}
 const profile=values['no-profile-window']?null:request({method:'profile_stop'});
 report.runs.push({repeat,summary:{tick_publish:stats(raw.map(x=>x[0])),decode:stats(raw.map(x=>x[1])),total:stats(raw.map(x=>x[2]))},checkpoints,observations:state.world.observations,profile,raw_columns:['tick_publish_ms','decode_ms','total_ms','output_bytes'],raw});
 console.error(JSON.stringify({repeat,sampling:values.sampling,mean_ms:report.runs.at(-1).summary.total.mean_ms}));
}
const output=JSON.stringify(report,null,2);if(values.output)writeFileSync(resolve(values.output),output);else console.log(output);

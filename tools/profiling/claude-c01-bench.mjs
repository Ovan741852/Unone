// Node CPU bench over the production projected-frame modules with a synthetic producer.
// Mirrors the frame-relevant order of web/renderer/three.js draw(): decode/validate,
// publication identity, resource prepare, ordered submission. CPU THREE objects only:
// no WebGL upload, GPU time, pixels or FPS are measured here.
// Usage: node tools/profiling/claude-c01-bench.mjs --scenario level33 --updates 120 --redraws 1 [--out file.json]
//        [--decoder retained|uncached] (uncached = per-draw projectedFrame, as frozen candidate2 three.js)
//        [--draws path/to/projected-frame-draws.js] [--frame path/to/projected-frame.mjs] [--identity path/to/publication.js]
import {pathToFileURL} from 'node:url';
import {MessageChannel} from 'node:worker_threads';
import fs from 'node:fs';
import * as THREE from '../../web/vendor/three/three.player.min.js';
import {createSegmentProfiler,distribution} from './claude-c01-segment-profiler.mjs';
import {createSyntheticProducer} from './claude-c01-synthetic-scene.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const mod=(p,d)=>import(p?pathToFileURL(p).href:new URL(d,import.meta.url).href);
const scenario=arg('scenario','level33'),updates=Number(arg('updates',120)),redraws=Number(arg('redraws',1)),warmup=Number(arg('warmup',10));
const [{createFrameDraws},frameModule,{framePresentationIdentity},{assertFrameSnapshot}]=await Promise.all([
 mod(arg('draws'),'../../web/renderer/projected-frame-draws.js'),mod(arg('frame'),'../../web/shared/projected-frame.mjs'),
 mod(arg('identity'),'../../web/renderer/projected-frame-publication.js'),import('../../web/renderer/projected-frame-policy.js')]);
const textures={white:new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1),atlas:new THREE.DataTexture(new Uint8Array(64*64*4).fill(200),64,64)};
for(const t of Object.values(textures))t.needsUpdate=true;
const sources=Object.fromEntries(Object.entries(textures).map(([id,texture])=>[id,{state:'ready',texture}]));
const specs=new Map(Object.keys(sources).map(id=>[id,{id,kind:'texture2d'}]));
const frameDraws=createFrameDraws(THREE,s=>sources[s.id]);
let submitted=0,scissors=0;
const renderer={getPixelRatio:()=>1,setScissor(){scissors++;},setScissorTest(){},render(){submitted++;}};
const profiler=createSegmentProfiler({enabled:true,counters:()=>frameDraws.metrics()});
const channel=new MessageChannel();
const transfer=value=>new Promise(resolve=>{channel.port2.once('message',resolve);channel.port1.postMessage(value);});
const producer=createSyntheticProducer(scenario);
const decoderMode=arg('decoder','retained');
if(!['retained','uncached'].includes(decoderMode))throw Error('BENCH_DECODER_MODE');
const retained=decoderMode==='retained'?frameModule.createProjectedFrameDecoder():null;
const decodeFrame=retained?s=>retained.decode(s):s=>frameModule.projectedFrame(s);
const PROFILE='rgb8_encoded_rebuild_v1';
// One presentation pass over an already-accepted snapshot (what every RAF draw does).
function present(snapshot){
 const frame=profiler.segment('packed_decode_validate',()=>{const f=decodeFrame(snapshot);assertFrameSnapshot(PROFILE,snapshot,f);return f;});
 profiler.segment('publication_identity',()=>framePresentationIdentity(frame));
 const ready=profiler.segment('resource_prepare',()=>frameDraws.prepare(frame,specs));
 if(!ready)throw Error('BENCH_TEXTURE_NOT_READY');
 profiler.segment('render_submit',()=>frameDraws.draw(renderer,{},1280,720));
}
let accepted=null,bytes=0;
async function tick(i){
 const {snapshot,changed}=profiler.segment('update',()=>producer.step());
 const text=profiler.segment('observation_serialize',()=>new TextEncoder().encode(JSON.stringify(snapshot)));bytes=text.length;
 const parsed=profiler.segment('observation_parse',()=>JSON.parse(new TextDecoder().decode(text)));
 accepted=await profiler.segment('host_transfer',()=>transfer(parsed));
 present(accepted);return changed;
}
for(let i=0;i<warmup;i++){await profiler.update('warmup-'+i,()=>tick(i));for(let r=0;r<redraws;r++)profiler.update('warmup-redraw',()=>present(accepted));}
profiler.reset();
for(let i=0;i<updates;i++){
 await profiler.update('u'+i,()=>tick(i),{kind:'update'});
 for(let r=0;r<redraws;r++)profiler.update('u'+i+'-redraw'+r,()=>present(accepted),{kind:'redraw'});
}
channel.port1.close();
const records=profiler.records(),pick=k=>records.filter(r=>r.meta.kind===k);
function summarize(rows){
 const names=[...new Set(rows.flatMap(r=>Object.keys(r.segments)))];
 return {updates:rows.length,wall_ms:distribution(rows.map(r=>r.wall_ms)),unattributed_ms:distribution(rows.map(r=>r.unattributed_ms)),
  segments_exclusive_ms:Object.fromEntries(names.map(n=>[n,distribution(rows.map(r=>r.segments[n]?.exclusive_ms??0))])),
  resource_delta_per_update:Object.fromEntries(['frame_geometry_builds','frame_geometry_reuses','frame_geometry_disposes','frame_material_builds','frame_material_reuses','frame_material_disposes','frame_texture_builds','frame_texture_disposes','frame_rebuilds']
   .map(k=>[k,distribution(rows.map(r=>r.counter_delta[k]))]))};
}
const final=frameDraws.metrics();frameDraws.clear();const cleared=frameDraws.metrics();
const report={scenario,decoder:decoderMode,decoder_metrics:retained?.metrics()??null,draws:producer.drawCount,raw_geometry_bytes:producer.rawBytes(),observation_bytes:bytes,updates,redraws_per_update:redraws,warmup,
 node:process.version,modules:{draws:arg('draws')??'web/renderer/projected-frame-draws.js',frame:arg('frame')??'web/shared/projected-frame.mjs',identity:arg('identity')??'web/renderer/projected-frame-publication.js'},
 update:summarize(pick('update')),redraw:summarize(pick('redraw')),
 resources_final:final,resources_after_clear:cleared,
 live_bounded:final.frame_live_geometries===producer.drawCount&&final.frame_live_materials===producer.drawCount,
 released_on_clear:cleared.frame_live_geometries===0&&cleared.frame_live_materials===0&&cleared.frame_live_textures===0,
 submitted_draws:submitted,scissor_calls:scissors,
 scope:'Node CPU: real production decode/identity/prepare/submit modules with CPU THREE objects. Not WebGL upload, GPU, pixels or FPS. update=synthetic producer, observation_serialize=JSON proxy for Rust serialization, observation_parse=same TextDecoder+JSON.parse as readObservation, host_transfer=structured-clone MessageChannel hop.',
 records:arg('records')==='1'?records:undefined};
const text=JSON.stringify(report,null,1);
if(arg('out'))fs.writeFileSync(arg('out'),text);
console.log(JSON.stringify({scenario,decoder:decoderMode,draws:report.draws,raw_geometry_bytes:report.raw_geometry_bytes,update_wall:report.update.wall_ms,redraw_wall:report.redraw.wall_ms,
 update_segments_p95:Object.fromEntries(Object.entries(report.update.segments_exclusive_ms).map(([k,v])=>[k,+v.p95.toFixed(3)])),
 redraw_segments_p95:Object.fromEntries(Object.entries(report.redraw.segments_exclusive_ms).map(([k,v])=>[k,+v.p95.toFixed(3)])),
 live_bounded:report.live_bounded,released_on_clear:report.released_on_clear},null,1));

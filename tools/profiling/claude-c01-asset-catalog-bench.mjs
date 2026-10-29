// Node CPU bench of the actual three.js specsOf + draw() path, legacy per-draw index vs granted catalog.
// Supporting data only: no WebGL upload, GPU, display or FPS. Row reads are exact counts.
// Usage: node tools/profiling/claude-c01-asset-catalog-bench.mjs [--rows 113776] [--redraws 30] [--updates 10] [--three file] [--out file.json]
import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import * as THREE from '../../web/vendor/three/three.player.min.js';
import {createSegmentProfiler,distribution} from './claude-c01-segment-profiler.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const web=new URL('../../web/',import.meta.url),mod=p=>import(new URL(p,web).href);
const [{createProjectedFrameDecoder},{assertFrameSnapshot},{createFrameDraws},{frameProfileCases},{framePresentationIdentity},{createTextureCachePolicy},{createPlayerProfiler},encoding]=await Promise.all([
 mod('shared/projected-frame.mjs'),mod('renderer/projected-frame-policy.js'),mod('renderer/projected-frame-draws.js'),mod('renderer/projected-frame-profile.js'),
 mod('renderer/projected-frame-publication.js'),mod('renderer/texture-cache-policy.js'),mod('shared/raster-diagnostics.mjs'),mod('shared/asset-encoding.js')]);
const threePath=arg('three',null),source=fs.readFileSync(threePath??new URL('renderer/three.js',web),'utf8');
const at=n=>source.indexOf(`  function ${n}(`),line=source.indexOf('  const specsOf = ');
const body=source.slice(line,source.indexOf('\n',line))+'\n'+source.slice(at('profileProviders'),at('clearTextures'));
const rows=Number(arg('rows',113776)),redraws=Number(arg('redraws',30)),updates=Number(arg('updates',10));
function manifest(n){const assets=[{id:'white',kind:'texture2d',source:'white.png'}];for(let i=0;i<n;i++)assets.push({id:`img/a${i}`,kind:'texture2d',source:`images/a${i}.png`,encoding:{decoder:'image',format:'png',mime:'image/png'}});return {version:1,assets};}
// --count 0 measures timing without the counting Proxy (which itself slows every row read).
const counting=arg('count','1')!=='0';
function counted(m){const reads={n:0};if(!counting)return {reads,manifest:m};return {reads,manifest:{...m,assets:new Proxy(m.assets,{get(t,k,r){if(typeof k==='string'&&/^\d+$/.test(k))reads.n++;return Reflect.get(t,k,r);}})}};}
function scenario(mode,n){
 const {reads,manifest:m}=counted(manifest(n)),creationStart=performance.now();
 const catalog=mode==='catalog'?encoding.createAssetCatalog(m,{adopt:true}):null,creation_ms=performance.now()-creationStart,creation_reads=reads.n;
 const noop=()=>{},texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1),profiler=createPlayerProfiler({limit:2048});
 const frameDraws=createFrameDraws(THREE,()=>({state:'ready',texture}));
 const context={...encoding,profile:profiler.renderer,options:{getAssetManifest:()=>m,...(catalog?{getAssetCatalog:()=>catalog}:{})},
  textureCache:createTextureCachePolicy(new Map()),frameDecoder:createProjectedFrameDecoder(),framePublicationIdentity:null,framePresentationIdentity,frameProfile:'rgb8_encoded_rebuild_v1',framePublication:null,assertFrameSnapshot,
  assertProjectedBackend:noop,assertRasterSnapshot:noop,assertFrameGpuError:noop,rasterAvailable:()=>true,projectedEntries:()=>[],heightfieldEntries:()=>[],backend:'webgl',rasterPolicy:{requested:'upper_left_checked'},
  bloom:null,effects:null,lastDrawTime:null,presentationContext:()=>({}),presentationHooks:[],renderer:{info:{reset:noop,render:{calls:0,triangles:0},memory:{geometries:0,textures:0}},getContext:()=>({}),render:noop},
  worldOf:x=>x,resize:noop,checkedRaster:true,validateRaster:()=>true,visibleSprites:()=>[],records:new Map(),shaderMaterials:{retain:noop},scene:{},camera:{},camera3d:{},meshes3d:new Map(),
  heightfields:{draw:noop},instances:{draw:noop},particles:{draw:noop},projected:{prepare:noop,draw:noop},rasterPass:{draw:noop},frameDraws,
  framePass:{draw:()=>true},startupPresentation:{invalidate:noop,drawn:noop},rasterCapability:{metrics:()=>({status:'validated',context_epoch:1,target_generation:1})}};
 vm.createContext(context);vm.runInContext(body,context);context.profileProviders(profiler);
 // Menu-like frame: zero draws, as in the recovered B13 menu sample.
 const frame={...structuredClone(frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame),draws:[]};let snapshot={projected_world_visible:false,projected_frame:frame};
 const segments=createSegmentProfiler({enabled:true,counters:()=>({manifest_row_reads:reads.n})});
 const one=kind=>segments.update(kind,()=>{const e=profiler.begin('draw');profiler.within(e,'renderer_draw',()=>context.draw(snapshot));const r=profiler.end(e,profiler.outcomeOf(e)??'returned');segments.segment('noop',noop);return r;},{kind});
 const drawRecords={redraw:[],update:[]};
 for(let u=0;u<updates;u++){
  snapshot={...snapshot,projected_frame:{...snapshot.projected_frame,revision:snapshot.projected_frame.revision+1}};drawRecords.update.push(one('update'));
  for(let r=0;r<redraws/updates;r++)drawRecords.redraw.push(one('redraw'));
 }
 const rec=segments.records(),dist=(list,name)=>distribution(list.map(r=>r.spans.find(s=>s.name===name)?.ms??0));
 const summary=kind=>({draws:drawRecords[kind].length,status:[...new Set(drawRecords[kind].map(r=>r.status))],
  manifest_row_reads_per_draw:distribution(rec.filter(r=>r.meta.kind===kind).map(r=>r.counter_delta.manifest_row_reads)),
  scene_sync_ms:dist(drawRecords[kind],'scene_sync'),renderer_draw_ms:dist(drawRecords[kind],'renderer_draw'),wall_ms:distribution(rec.filter(r=>r.meta.kind===kind).map(r=>r.wall_ms)),
  asset_index:drawRecords[kind][0].attrs.asset_index,asset_index_size:drawRecords[kind][0].attrs.asset_index_size});
 return {mode,rows:n+1,catalog_creation_ms:catalog?creation_ms:null,catalog_creation_row_reads:catalog?creation_reads:null,update:summary('update'),redraw:summary('redraw')};
}
const report={node:process.version,row_reads_counted:counting,three:threePath??'web/renderer/three.js',redraws,updates,scope:'Node CPU actual draw path, menu-like zero-draw frame; host timings are supporting data only (no GPU/WebGL/display)',
 results:[rows,50].flatMap(n=>['legacy','catalog'].map(mode=>scenario(mode,n)))};
if(arg('out',null))fs.writeFileSync(arg('out'),JSON.stringify(report,null,1));
for(const r of report.results)console.log(`${r.mode.padEnd(7)} rows=${String(r.rows).padEnd(6)} create=${r.catalog_creation_ms?.toFixed(1)??'-'}ms  redraw scene_sync p50/p95/max=${['p50','p95','max'].map(k=>r.redraw.scene_sync_ms[k].toFixed(3)).join('/')}  update scene_sync p50=${r.update.scene_sync_ms.p50.toFixed(3)}  row_reads/draw=${r.redraw.manifest_row_reads_per_draw.p50}  index=${r.redraw.asset_index}:${r.redraw.asset_index_size}`);

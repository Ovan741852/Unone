// Actual three.js specsOf definition + draw() with real frame draws, decoder, texture cache, policy and
// profiler, over a large (113,776-row) and a small asset manifest. Manifest row reads are counted with
// a Proxy, so repeated enumeration is measured exactly rather than by host timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.player.min.js';
import {createProjectedFrameDecoder} from '../shared/projected-frame.mjs';
import {assertFrameSnapshot} from './projected-frame-policy.js';
import {createFrameDraws} from './projected-frame-draws.js';
import {frameProfileCases} from './projected-frame-profile.js';
import {framePresentationIdentity} from './projected-frame-publication.js';
import {createTextureCachePolicy} from './texture-cache-policy.js';
import {createPlayerProfiler} from '../shared/raster-diagnostics.mjs';
import * as encoding from '../shared/asset-encoding.js';
import {DRAW_COMPLETED,DRAW_SKIPPED} from '../shared/player-completion.mjs';
const source=fs.readFileSync(process.env.UNONE_CATALOG_THREE_SOURCE??new URL('./three.js',import.meta.url),'utf8');
const at=name=>source.indexOf(`  function ${name}(`);
const specsLine=source.slice(source.indexOf('  const specsOf = '),source.indexOf('\n',source.indexOf('  const specsOf = ')));
const body=specsLine+'\n'+source.slice(at('profileProviders')>=0?at('profileProviders'):at('draw'),at('clearTextures'))+source.slice(at('rasterLost'),at('rasterAvailable'));
const LARGE=113776;
function manifest(rows,extra=[]){
 const assets=[...extra];for(let i=0;i<rows;i++)assets.push({id:`img/a${i}`,kind:'texture2d',source:`images/a${i}.png`,encoding:{decoder:'image',format:'png',mime:'image/png'}});
 return {version:1,assets};
}
const base=()=>[{id:'white',kind:'texture2d',source:'white.png'},{id:'second',kind:'texture2d',source:'second.png'}];
// Count element reads (enumeration) of the manifest's asset array.
function counted(m){const reads={n:0};const assets=new Proxy(m.assets,{get(t,k,r){if(typeof k==='string'&&/^\d+$/.test(k))reads.n++;return Reflect.get(t,k,r);}});return {manifest:{...m,assets},reads};}
function fixture({getAssetManifest,getAssetCatalog,profiler=null}){
 const calls=[],noop=()=>{},texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 const state={pending:new Set(),failed:new Set()};
 // Host texture loader: records which declared spec (id/source/kind) every decision used.
 const textureFor=spec=>{calls.push(['texture',spec?.id,spec?.source]);if(state.failed.has(spec.id))return {state:'error',error:Error('TEXTURE_LOAD_FAILED: '+spec.id)};return state.pending.has(spec.id)?{state:'loading'}:{state:'ready',texture};};
 const frameDraws=createFrameDraws(THREE,textureFor);
 const context={spritePresentation:null,spriteResources:null,ui:null,worldSubmitted:false,retireWorldGpuBindings:noop,DRAW_COMPLETED,DRAW_SKIPPED,uiImageBatchPrefix:{clear:noop},...encoding,profile:profiler?.renderer??null,options:{...(getAssetManifest?{getAssetManifest}:{}),...(getAssetCatalog?{getAssetCatalog}:{})},
  textureCache:createTextureCachePolicy(new Map()),frameDecoder:createProjectedFrameDecoder(),framePublicationIdentity:null,framePresentationIdentity,frameProfile:'rgb8_encoded_rebuild_v1',framePublication:null,assertFrameSnapshot,
  assertProjectedBackend:noop,assertRasterSnapshot:noop,assertFrameGpuError:noop,rasterAvailable:()=>true,projectedEntries:()=>[],heightfieldEntries:()=>[],
  backend:'webgl',rasterPolicy:{requested:'upper_left_checked'},bloom:null,effects:null,lastDrawTime:null,presentationContext:()=>({}),presentationHooks:[],
  renderer:{info:{reset:noop,render:{calls:0,triangles:0},memory:{geometries:0,textures:0}},getContext:()=>({}),render(){calls.push('ordinary');}},worldOf:x=>x,resize:noop,
  checkedRaster:true,validateRaster:()=>true,visibleSprites:()=>[],records:new Map(),shaderMaterials:{retain:noop},scene:{},camera:{},camera3d:{},geometry3d:{draw:()=>false,clear(){},contextLost(){},metrics:()=>({})},curvature:{prepare(){},viewport(){},curvature:0},world3d:{scale:{z:1}},bufferSize:{x:1,y:1},drawInRect:(_,draw)=>draw(),meshEntities:{draw:()=>false,clear(){},contextLost(){}},
  heightfields:{draw:noop},instances:{draw:noop},particles:{draw:noop},projected:{entries:()=>[],prepare:noop,draw:noop,clear:noop},rasterPass:{draw:noop,invalidate:noop},frameDraws,
  framePass:{draw(d,c,frame){d.draw({getPixelRatio:()=>1,setScissor(...s){calls.push(['scissor',...s]);},setScissorTest:noop,render(scene){calls.push(['draw',scene.children[0].material.uniforms.frameTexture.value===texture]);}},c,1280,720);return true;},invalidate:noop},
  startupPresentation:{invalidate:noop,drawn(){calls.push('drawn');}},rasterCapability:{metrics:()=>({status:'validated',context_epoch:1,target_generation:1}),lost:noop,restored:noop}};
 vm.createContext(context);vm.runInContext(body,context);if(profiler)context.profileProviders(profiler);
 const frame=frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame;frame.draws[0].scissor={x:4,y:8,width:100,height:50};
 const snapshot={projected_world_visible:false,projected_frame:frame};
 function draw(s=snapshot){try{context.draw(s);return 'ok';}catch(e){return 'throw:'+e.message;}}
 return {context,calls,state,frameDraws,snapshot,frame,draw};
}
function journey(f){
 const out=[];out.push(f.draw(),f.draw(),f.draw());                             // stable redraws
 const next=structuredClone(f.frame);next.revision++;f.snapshot.projected_frame=next;out.push(f.draw()); // new revision, same content
 const core=structuredClone(f.frame);core.revision=1;f.snapshot.projected_frame=core;out.push(f.draw()); // new Core revision 1
 const swap=structuredClone(core);swap.draws[0].texture='second';f.snapshot.projected_frame=swap;f.state.pending.add('second');out.push(f.draw()); // pending
 f.state.pending.delete('second');out.push(f.draw());
 const missing=structuredClone(swap);missing.draws[0].texture='not-declared';f.snapshot.projected_frame=missing;out.push(f.draw()); // missing spec
 f.state.failed.add('second');f.snapshot.projected_frame=swap;out.push(f.draw()); // load error
 f.state.failed.delete('second');f.context.rasterLost();f.context.rasterRestored();out.push(f.draw()); // context lifecycle
 return {out,calls:f.calls,metrics:f.frameDraws.metrics()};
}
const catalogApi=()=>{assert.equal(typeof encoding.createAssetCatalog,'function','createAssetCatalog export');return encoding;};
test('granted catalog: repeated draws and updates never re-enumerate a 113,776-row manifest',()=>{
 const {createAssetCatalog}=catalogApi(),{manifest:m,reads}=counted(manifest(LARGE,base()));
 // adopt (as the official player does): a counting Proxy cannot be structured-cloned.
 const catalog=createAssetCatalog(m,{adopt:true});const creation=reads.n;assert.equal(creation>=LARGE+2,true,'one enumeration at creation');
 const f=fixture({getAssetManifest:()=>m,getAssetCatalog:()=>catalog}),r=journey(f);
 assert.equal(reads.n-creation,0,'zero manifest row reads across all draws');
 assert.deepEqual(r.out.slice(0,7),['ok','ok','ok','ok','ok','ok','ok']);
});
test('legacy dynamic caller without a grant keeps the exact per-draw rebuild and sees in-place edits',()=>{
 const {manifest:m,reads}=counted(manifest(50,base()));const f=fixture({getAssetManifest:()=>m});
 f.draw();f.draw();assert.equal(reads.n,2*52,'legacy enumerates once per draw');
 m.assets[0].kind='audio';assert.equal(f.draw(),'throw:PROJECTED_FRAME_TEXTURE_MISSING: white','in-place mutation visible on the next legacy draw');
});
test('granted catalog makes exactly the same texture/material/geometry/scissor/error decisions as legacy',()=>{
 const {createAssetCatalog}=catalogApi();
 for(const rows of [0,50,LARGE]){
  const legacy=journey(fixture({getAssetManifest:()=>manifest(rows,base())}));
  const m=manifest(rows,base()),catalog=createAssetCatalog(m);
  const granted=journey(fixture({getAssetManifest:()=>m,getAssetCatalog:()=>catalog}));
  assert.deepEqual(granted,legacy,`rows=${rows}`);
  assert(legacy.out.some(o=>o.startsWith('throw:PROJECTED_FRAME_TEXTURE_MISSING')));assert(legacy.out.some(o=>o.startsWith('throw:TEXTURE_LOAD_FAILED')));
 }
});
test('replacement is explicit by generation; ungranted objects are rejected before any GPU resource change',()=>{
 const {createAssetCatalog}=catalogApi();let current=createAssetCatalog(manifest(10,base()));
 const f=fixture({getAssetManifest:()=>current.manifest,getAssetCatalog:()=>current});
 assert.equal(f.draw(),'ok');const before=f.frameDraws.metrics();
 const replaced=createAssetCatalog({assets:[{id:'white',kind:'audio',source:'x.wav'}]});assert(replaced.generation>current.generation);
 current=replaced;assert.equal(f.draw(),'throw:PROJECTED_FRAME_TEXTURE_MISSING: white','replacement takes effect at the next draw');
 current={kind:'unone.asset-catalog',generation:999,manifest:{assets:[]},size:0,specs:new Map()};
 assert.match(f.draw(),/^throw:ASSET_CATALOG_REQUIRED/);
 assert.deepEqual(f.frameDraws.metrics(),before,'rejected draws changed no frame resources');
});
test('profile records the index kind and size per draw',()=>{
 const {createAssetCatalog}=catalogApi(),p=createPlayerProfiler({limit:16}),catalog=createAssetCatalog(manifest(5,base()));
 const f=fixture({getAssetManifest:()=>catalog.manifest,getAssetCatalog:()=>catalog,profiler:p});
 const e=p.begin('draw');p.within(e,'renderer_draw',()=>f.context.draw(f.snapshot));const r=p.end(e,'completed');
 assert.deepEqual([r.attrs.asset_index,r.attrs.asset_index_size,r.attrs.asset_catalog_generation],['catalog',7,catalog.generation]);
});

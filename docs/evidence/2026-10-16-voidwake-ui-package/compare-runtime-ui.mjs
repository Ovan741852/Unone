import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import vm from 'node:vm';

// This harness supplies real host project/input envelopes to the production
// WASM ABI. It never substitutes an API, rewrites script, or injects game state.
const out=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),fontFallback=args.includes('--font-fallback');
const positions=args.filter(arg=>arg!=='--font-fallback');
const baselinePath=resolve(positions[0]??join(out,'baseline-player/content/project.json'));
if(!positions[1])throw Error('Usage: node compare-runtime-ui.mjs <baseline project.json> <current project.json> [runtime-directory] [--font-fallback]');
const currentPath=resolve(positions[1]);
const runtimeRoot=resolve(positions[2]??'D:/TSProject/Voidwake/game/runtime');
const loaderPath=resolve('D:/TSProject/Voidwake/game/web/shared/load-project.js');
const manifest=JSON.parse(readFileSync(join(runtimeRoot,'runtime.json'),'utf8'));
const hash=data=>createHash('sha256').update(data).digest('hex');
const wasm=readFileSync(join(runtimeRoot,manifest.wasm));
const javascript=readFileSync(join(runtimeRoot,manifest.javascript));
assert.equal(hash(wasm),manifest.wasm_sha256,'Real WASM bytes match runtime manifest');
assert.equal(hash(javascript),manifest.javascript_sha256,'Real loader bytes match runtime manifest');
assert.equal(manifest.runtime_packages?.['@unone/ui'],'0.1.0');
const payloads={baseline:JSON.parse(readFileSync(baselinePath,'utf8')),current:JSON.parse(readFileSync(currentPath,'utf8'))};
assert.equal(payloads.current.config.runtime_packages?.['@unone/ui'],'0.1.0');
const {loadProject,readObservation}=await import(pathToFileURL(loaderPath));
const report={ok:false,started_utc:new Date().toISOString(),runtime:{path:runtimeRoot,wasm_sha256:hash(wasm),javascript_sha256:hash(javascript),runtime_packages:manifest.runtime_packages,manifest_source_commit:manifest.source_commit,manifest_source_dirty:manifest.source_dirty},inputs:{baseline:{path:baselinePath,sha256:hash(readFileSync(baselinePath)),script_sha256:hash(payloads.baseline.script)},current:{path:currentPath,sha256:hash(readFileSync(currentPath)),script_sha256:hash(payloads.current.script)}},seed:42,viewports:[],errors:[],limitations:['Headless real-WASM equality proves published semantic UI and game observations; it does not prove browser pixels, font rasterization, input routing, shader presentation, or GPU behavior.','Both payloads run on the same current production runtime. This isolates game UI authoring changes rather than comparing engine versions.','Viewport aspect is supplied through the normal host payload field. Actions are supplied only through the official input-frame ABI.','Runtime package version is recorded from the hashed runtime descriptor and required current project declaration; no script/state is injected to query extra observations.']};
const expectedFontFamilies={
 'Noto Sans TC':'Noto Sans TC, Noto Sans TC Supplemental',
 'Share Tech Mono':'Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental',
};
report.comparison={mode:fontFallback?'exact-except-two-explicit-font-family-substitutions':'exact',expected_font_family_substitutions:fontFallback?expectedFontFamilies:{},rationale:fontFallback?'Retain original font faces first and add locally packaged supplemental character fallback. Only these exact strings in published UI node style.font_family fields may differ. All other node/style/geometry/content/action fields and observations must remain equal.':null};
function comparisonUi(source){
 if(!fontFallback)return {ui:source,substitutions:[]};
 const ui=structuredClone(source),substitutions=[];
 function visit(node,path){
  const family=node?.style?.font_family;
  if(Object.hasOwn(expectedFontFamilies,family)){
   node.style.font_family=expectedFontFamilies[family];
   substitutions.push({path:path+'/style/font_family',id:node.id,baseline:family,expected_current:expectedFontFamilies[family]});
  }
  for(const [index,child] of (node?.children??[]).entries())visit(child,path+'/children/'+index);
 }
 visit(ui,'');return {ui,substitutions};
}
let totalFrames=0;
try{
 const module=await new Promise((done,reject)=>{
  const options={wasmBinary:new Uint8Array(wasm),noInitialRun:true,print:()=>{},printErr:console.error,onAbort:reject};
  const runtimeJs=join(runtimeRoot,manifest.javascript);
  const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(runtimeJs).href}},location:{href:pathToFileURL(runtimeJs).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
  options.onRuntimeInitialized=()=>done(context.Module);
  try{vm.runInNewContext(javascript.toString('utf8'),context,{timeout:30000});}catch(error){reject(error);}
 });
 function run(payload,aspect){
  let state,frames=0;const checkpoints=[];
  function reload(){state=loadProject(module,{...payload,viewport_aspect:aspect},42n);return state;}
  function tick(actions={}){
   const bytes=new TextEncoder().encode(JSON.stringify({actions}));
   const address=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,address);
   assert.equal(module._unone_web_set_input_frame(address,bytes.length),0);
   assert.equal(module._unone_web_tick(),0);
   state=readObservation(module);frames++;totalFrames++;
   assert.equal(state.world.observations.finiteState,true);
   return state;
  }
  function checkpoint(name,phase){
   if(phase)assert.equal(state.world.observations.phase,phase,name+' reaches intended phase');
   checkpoints.push({name,frame:state.world.frame,phase:state.world.observations.phase,ui:state.world.ui,observations:state.world.observations});
  }
  reload();checkpoint('menu-start','menu');tick();checkpoint('menu-frame-1','menu');
  tick({Start:true});checkpoint('playing-start','playing');
  for(let i=0;i<45;i++)tick({KeyD:true});checkpoint('playing-moved','playing');
  tick({Pause:true});checkpoint('paused','paused');
  for(let i=0;i<120;i++)tick({KeyD:true,Fire:true});checkpoint('pause-frozen-120-input-frames','paused');
  tick({Resume:true});checkpoint('resumed','playing');tick();
  tick({Pause:true});tick();tick({Abandon:true});checkpoint('abandon-confirmation','paused');
  tick();tick({CancelAbandon:true});checkpoint('abandon-cancelled','paused');
  tick();tick({Abandon:true});tick();tick({Menu:true});checkpoint('abandoned-menu','menu');
  tick();tick({Start:true});tick();tick({AutoFire:true});checkpoint('auto-fire-disabled','playing');
  tick();tick({Dash:true});tick();tick({Burst:true});checkpoint('abilities-used','playing');
  tick();tick({Sound:true});checkpoint('sound-toggled','playing');
  tick();tick({Restart:true});checkpoint('restarted','playing');
  reload();tick({Start:true});for(let i=1;i<2500;i++)tick();checkpoint('upgrade-2500','upgrade');
  tick({Select1:true});checkpoint('upgrade-selected','playing');
  assert.equal(state.world.observations.upgradesInstalled,1);
  for(let i=0;i<10;i++)tick({Select1:true});checkpoint('held-choice-installs-once','playing');
  assert.equal(state.world.observations.upgradesInstalled,1);
  reload();tick({Start:true});tick({AutoFire:true});
  let deathFrames=0;for(;deathFrames<5000&&state.world.observations.phase!=='gameover';deathFrames++)tick();
  assert.equal(state.world.observations.phase,'gameover','Normal combat without autofire reaches gameover within bounded frame budget');
  checkpoint('natural-gameover','gameover');tick({Restart:true});checkpoint('restart-after-gameover','playing');
  return {frames,death_frames:deathFrames,checkpoints};
 }
 function firstDifferences(a,b,path='',result=[]){
  if(isDeepStrictEqual(a,b)||result.length>=12)return result;
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
   for(const key of new Set([...Object.keys(a),...Object.keys(b)]))firstDifferences(a[key],b[key],path+'/'+key,result);
  }else result.push({path,baseline:a,current:b});
  return result;
 }
 for(const viewport of [{name:'desktop',width:1440,height:900},{name:'intermediate',width:1020,height:884},{name:'portrait',width:390,height:844}]){
  const aspect=viewport.width/viewport.height;
  const baseline=run(payloads.baseline,aspect),current=run(payloads.current,aspect);
  assert.equal(current.frames,baseline.frames,'Equal real tick count');
  assert.equal(current.checkpoints.length,baseline.checkpoints.length);
  const result={viewport,aspect,frames_per_payload:current.frames,natural_death_frames:current.death_frames,cases:[]};
  report.viewports.push(result);
  for(let i=0;i<baseline.checkpoints.length;i++){
   const before=baseline.checkpoints[i],after=current.checkpoints[i];
   assert.equal(before.name,after.name);
   const compared=comparisonUi(before.ui);
   const uiEqual=isDeepStrictEqual(compared.ui,after.ui),observationsEqual=isDeepStrictEqual(before.observations,after.observations);
   const entry={name:before.name,frame:before.frame,phase:before.phase,ui_equal:uiEqual,ui_raw_exact_equal:isDeepStrictEqual(before.ui,after.ui),observations_equal:observationsEqual,baseline_ui_sha256:hash(JSON.stringify(before.ui)),current_ui_sha256:hash(JSON.stringify(after.ui)),baseline_observations_sha256:hash(JSON.stringify(before.observations)),current_observations_sha256:hash(JSON.stringify(after.observations))};
   if(fontFallback){entry.expected_font_substitutions=compared.substitutions;entry.comparison_baseline_ui_sha256=hash(JSON.stringify(compared.ui));}
   if(!uiEqual)entry.ui_differences=firstDifferences(compared.ui,after.ui);
   if(!observationsEqual)entry.observation_differences=firstDifferences(before.observations,after.observations);
   result.cases.push(entry);
  }
  result.ok=result.cases.every(c=>c.ui_equal&&c.observations_equal);
  console.log(JSON.stringify({viewport:viewport.name,ok:result.ok,cases:result.cases.length,frames_per_payload:result.frames_per_payload,natural_death_frames:result.natural_death_frames}));
 }
 report.ok=report.viewports.every(v=>v.ok);
 if(!report.ok)process.exitCode=1;
}catch(error){report.errors.push(error.stack);process.exitCode=1;}
finally{report.total_real_wasm_ticks=totalFrames;report.finished_utc=new Date().toISOString();writeFileSync(join(out,fontFallback?'runtime-ui-final.json':'runtime-ui-equivalence.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,total_real_wasm_ticks:totalFrames,compared_cases:report.viewports.reduce((n,v)=>n+v.cases.length,0),errors:report.errors}));

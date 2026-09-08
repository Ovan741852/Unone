// Test selected artifacts, not binary strings or hand-assembled project contracts.
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const {values}=parseArgs({options:{full:{type:'string'},minimal:{type:'string'},development:{type:'string'},output:{type:'string'}}});
if(!values.full||!values.minimal)throw new Error('--full and --minimal runtime directories required');
const root=resolve(import.meta.dirname,'..'),cli=join(root,'target/debug/game.exe');
const fixture=join(root,'tests/optional-systems-project');
const scratch=mkdtempSync(join(tmpdir(),'unone-optional-'));
function run(args,success=true){
 const r=spawnSync(args[0],args.slice(1),{encoding:'utf8',maxBuffer:16*1024*1024,timeout:120000});
 if(success&&r.status!==0)throw new Error(`${args.join(' ')}: ${r.stdout} ${r.stderr}`);
 return r;
}
async function moduleFor(directory,manifest){
 const js=join(directory,manifest.javascript),began=performance.now();
 const module=await new Promise((ready,reject)=>{
  const options={wasmBinary:new Uint8Array(readFileSync(join(directory,manifest.wasm))),noInitialRun:true,onAbort:r=>reject(new Error(String(r))),print(){},printErr(){}};
  const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
  options.onRuntimeInitialized=()=>ready(context.Module);
  vm.runInNewContext(readFileSync(js,'utf8'),context,{filename:js});
 });
 return {module,initialize_ms:performance.now()-began};
}
const measurements=[];
try {
 for(const variant of ['full','minimal','development']) {
  if(!values[variant])continue;
  const runtime=resolve(values[variant]),manifest=JSON.parse(readFileSync(join(runtime,'runtime.json'),'utf8'));
  const output=join(scratch,variant);
  const args=[cli,'--project',fixture,'export','web','--runtime',runtime,'--output',output,'--json'];
  if(manifest.preview_tools)args.push('--development');
  run(args);
  run([process.execPath,join(root,'scripts/verify-host-parity.mjs'),'--fixture',fixture,'--export',output]);
  if(variant!=='full'){
   const emittedManifest=join(output,'runtime/runtime.json');
   const original=readFileSync(emittedManifest,'utf8');
   const lie=JSON.parse(original);lie.compiled_systems.push('physics3d');writeFileSync(emittedManifest,JSON.stringify(lie));
   const negative=run([process.execPath,join(root,'scripts/verify-host-parity.mjs'),'--fixture',fixture,'--export',output],false);
   writeFileSync(emittedManifest,original);
   if(negative.status===0||!negative.stderr.includes('RUNTIME_CAPABILITIES_MISMATCH'))throw new Error('Capability metadata mutation was not detected');
  }
  const inventory=JSON.parse(readFileSync(join(output,'export.json'),'utf8'));
  for(const unwanted of ['web/shared/audio-playback.js','web/shared/ui-tree.js','web/renderer/particles.js','web/renderer/effekseer.js'])if(inventory.files.some(f=>f.path===unwanted))throw new Error(`Disabled host module packaged: ${unwanted}`);
  const player=readFileSync(join(output,'web/player/main.js'),'utf8');
  if(player.includes('localStorage.'))throw new Error('Disabled save touches storage');
  // Every relative static import must resolve inside the actual export.
  for(const file of inventory.files.filter(f=>f.path.endsWith('.js')&&!f.path.includes('/vendor/')&&!f.path.startsWith('runtime/'))){
   const text=readFileSync(join(output,file.path),'utf8');
   for(const match of text.matchAll(/from\s+["'](\.[^"']+)["']/g))readFileSync(resolve(output,file.path,'..',match[1]));
  }
  if(variant==='minimal'){
   const noTests=join(scratch,'no-tests-source');mkdirSync(noTests);
   const config=JSON.parse(readFileSync(join(fixture,'project.unone.json'),'utf8'));config.test_files=[];
   writeFileSync(join(noTests,'project.unone.json'),JSON.stringify(config));
   for(const file of ['main.luau','scene.json'])copyFileSync(join(fixture,file),join(noTests,file));
   const noTestsOutput=join(scratch,'no-tests-export');
   run([cli,'--project',noTests,'export','web','--runtime',runtime,'--output',noTestsOutput,'--json']);
   const checked=run([process.execPath,join(root,'scripts/verify-host-parity.mjs'),'--fixture',noTests,'--export',noTestsOutput]);
   if(!checked.stdout.includes('"compared_frames":1'))throw new Error('Project without test files was not replayed');
  }
  const {loadProject,readObservation}=await import(pathToFileURL(join(output,'web/shared/load-project.js')).href);
  const payload=JSON.parse(readFileSync(join(output,'content/project.json'),'utf8'));
  const timings=[];
  for(let i=0;i<5;i++){
   const initialized=await moduleFor(runtime,manifest),began=performance.now();
   const snapshot=loadProject(initialized.module,payload,42n);
   const loadMs=performance.now()-began;
   timings.push({initialize_ms:initialized.initialize_ms,project_load_ms:loadMs});
   if(snapshot.world.observations.ticks!==0)throw new Error('Fixture start did not execute');
   if(manifest.preview_tools&&i===0){
    const m=initialized.module;
    function request(value){const bytes=new TextEncoder().encode(JSON.stringify(value));const ptr=m._unone_web_alloc(bytes.length);m.HEAPU8.set(bytes,ptr);m._unone_web_developer_request(ptr,bytes.length);return readObservation(m);}
    const before=request({method:'snapshot'});
    const clicked=request({method:'invoke',id:'qa.ping',revision:before.value.tools.revision});
    if(!clicked.ok||clicked.value.observation.world.observations.clicked!==true||clicked.value.observation.world.frame!==0)throw new Error('Selected development tools failed with physics/UI disabled');
   }
   if(variant!=='full'&&i===0){
    for(const feature of ['physics2d','physics3d','audio']){
     const bad=structuredClone(payload);bad.config.systems[feature]=true;
     let rejected=false;
     try{loadProject(initialized.module,bad,42n);}catch(error){rejected=String(error).includes('SYSTEM_NOT_COMPILED');}
     if(!rejected)throw new Error(`Compiled-out ${feature} accepted by WASM`);
    }
    const typo=structuredClone(payload);typo.config.systems.Physics3D=false;
    let typoRejected=false;
    try{loadProject(initialized.module,typo,42n);}catch(error){typoRejected=String(error).includes('SYSTEM_UNKNOWN');}
    if(!typoRejected)throw new Error('Noncanonical system key silently accepted');
    const badScene=structuredClone(payload);badScene.scene.physics3d={bodies:{}};
    let sceneRejected=false;
    try{loadProject(initialized.module,badScene,42n);}catch(error){sceneRejected=String(error).includes('SYSTEM_NOT_COMPILED');}
    if(!sceneRejected)throw new Error('Compiled-out scene solver accepted');
    const bad=structuredClone(payload);bad.script='return {start=function(api) api.physics3d.raycast({}) end,update=function() end}';
    let rejected=false;
    try{loadProject(initialized.module,bad,42n);}catch(error){rejected=String(error).includes('SYSTEM_NOT_COMPILED');}
    if(!rejected)throw new Error('Compiled-out Lua API silently accepted');
   }
  }
  const wasm=readFileSync(join(runtime,manifest.wasm));
  measurements.push({variant,compiled_systems:manifest.compiled_systems,wasm_bytes:wasm.length,gzip_bytes:gzipSync(wasm).length,brotli_bytes:brotliCompressSync(wasm).length,timings});
  if(variant!=='full'){
   const badExport=run([cli,'--project',join(root,'_Games/physics3d-lab'),'export','web','--runtime',runtime,'--output',join(scratch,variant+'-invalid'),'--json',...(manifest.preview_tools?['--development']:[])],false);
   if(badExport.status===0||!badExport.stdout.includes('SYSTEM_NOT_COMPILED'))throw new Error('Incompatible runtime export accepted');
  }
 }
 const report={ok:true,environment:'Node '+process.version+' on '+process.platform+' '+process.arch,measurement_scope:'WASM initialization and project load in Node, five same-process instances; excludes network, renderer and browser first paint; first initialization includes cold compilation',measurements};
 if(values.output)writeFileSync(values.output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
} finally {rmSync(scratch,{recursive:true,force:true});}

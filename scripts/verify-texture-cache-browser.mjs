// An isolated exported official player and the same release's official adapter.
// Real Chrome, real Three/WebGL uploads and deletion; no renderer substitutes.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sdk=path.resolve(process.argv[2]??path.join(root,'artifacts/core-sdk-texture-cache-v2'));
const out=path.resolve(process.argv[3]??path.join(root,'artifacts/texture-cache-browser'));
const sourceTemplates=process.argv.includes('--source-templates');
await fs.mkdir(out,{recursive:true});
const project=await fs.mkdtemp(path.join(out,'fixture-')),exportRoot=path.join(project,'player'),productionRoot=path.join(project,'production');
const checks=[],errors=[],phases=[],report={ok:false,completed:false,sdk,sourceTemplates,project,checks,errors,phases};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function check(value,label){assert.ok(value,label);checks.push(label);console.log('PASS '+label);}
function crc(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return (c^0xffffffff)>>>0;}
function chunk(type,data){const key=Buffer.from(type),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([key,data])));return Buffer.concat([length,key,data,sum]);}
function png(color){const header=Buffer.alloc(13);header.writeUInt32BE(64);header.writeUInt32BE(64,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc(64*(64*4+1));for(let y=0;y<64;y++)for(let x=0;x<64;x++){const at=y*257+1+x*4;for(let i=0;i<3;i++)pixels[at+i]=Math.min(255,color[i]+((x<8||y<8||x>55||y>55)?25:0));pixels[at+3]=255;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
const letters=['A','B','C'],policy={max_bytes:32768,max_entries:2,idle_frames:180};
const script=`local Game={}
local phase="A"
local function publish(api)
 for _,letter in {"A","B","C"} do api.entity.setSpriteVisible(letter,phase==letter or phase=="all") end
 api.observation.set("cache_phase",phase)
 api.ui.setRoot({kind="screen",id="cache-fixture",node="test",children={{kind="text",id="phase",text="Texture cache: "..phase.." | A/B/C single, P all",rect={x=5,y=84,width=90,height=10},style={font_size=3.5,color={1,1,1,1}}}}})
end
function Game.start(api)
 api.camera.setTransform({projection="orthographic",position={x=0,y=0,z=0},orthographicSize=4})
 publish(api)
end
function Game.update(api,_dt)
 for _,letter in {"A","B","C"} do if api.input.wasPressed(letter) then phase=letter;publish(api) end end
 if api.input.wasPressed("P") then phase="all";publish(api) end
end
return Game`;
let browser,server;
try{
 await fs.mkdir(path.join(project,'assets'));
 for(let i=0;i<3;i++)await fs.writeFile(path.join(project,'assets',letters[i]+'.png'),png([[215,45,65],[35,175,80],[35,95,215]][i]));
 const assets={version:1,assets:letters.map(id=>({id:'texture://cache/'+id,kind:'texture2d',source:'assets/'+id+'.png',bundle:'content'}))};
 const config={name:'Official texture-cache lifecycle fixture',entry_script:'main.luau',main_scene:'scene.json',asset_manifest:'assets.json',
  systems:{physics2d:false,physics3d:false,spine:false,effekseer:false,jobs:false,audio:false,particle:false,save:false,camera2d:true,camera3d:false,ui:true}};
 const scene={entities:letters.map((id,i)=>({id,transform:{x:(i-1)*2,y:0},sprite:{asset:'texture://cache/'+id,size:{x:1.5,y:1.5},visible:id==='A',layer:1}}))};
 for(const [name,value]of Object.entries({'project.unone.json':config,'scene.json':scene,'assets.json':assets,'player.presentation.json':{renderer_mode:'official',bloom:false,runtime_backend:'main',texture_cache:policy}}))
  await fs.writeFile(path.join(project,name),JSON.stringify(value,null,2));
 await fs.writeFile(path.join(project,'main.luau'),script);
 const cli=sourceTemplates?path.join(root,'target/release/game.exe'):path.join(sdk,'bin/game.exe'),args=['--project',project,'--json','export','web','--runtime',path.join(sdk,'runtimes/web-development-1'),'--development','--output',exportRoot];
 const env={...process.env};if(sourceTemplates)delete env.UNONE_SDK_ROOT;
 const exported=spawnSync(cli,args,{cwd:root,encoding:'utf8',env});report.export={command:args,status:exported.status,stdout:exported.status?exported.stdout:undefined,stderr:exported.stderr};
 assert.equal(exported.status,0,exported.stdout+exported.stderr);
 const manifest=JSON.parse(await fs.readFile(path.join(exportRoot,'export.json'),'utf8'));report.release=manifest.release_root;
 check(manifest.renderer_mode==='official'&&manifest.renderer==='three-webgl','Isolated project exported with the official renderer');
 const releaseRoot=path.join(exportRoot,manifest.release_root);
 report.binding={sdkJsonSha256:hash(await fs.readFile(path.join(sdk,'sdk.json'))),cliSha256:hash(await fs.readFile(cli)),scriptSha256:hash(Buffer.from(script)),
  sdkPolicySha256:hash(await fs.readFile(path.join(sdk,'templates/web/renderer/texture-cache-policy.js'))),
  exportedPolicySha256:hash(await fs.readFile(path.join(releaseRoot,'web/renderer/texture-cache-policy.js'))),
  sdkThreeSha256:hash(await fs.readFile(path.join(sdk,'templates/web/renderer/three.js'))),
  exportedThreeSha256:hash(await fs.readFile(path.join(releaseRoot,'web/renderer/three.js'))),
  exportedCoreSha256:hash(await fs.readFile(path.join(releaseRoot,'web/shared/runtime-core.mjs'))),
  wasmSha256:hash(await fs.readFile(path.join(sdk,'runtimes/web-development-1/unone_player.wasm')))};
 check(report.binding.sdkPolicySha256===report.binding.exportedPolicySha256,'Native test executes the exact SDK cache policy bytes');
 server=http.createServer(async(req,res)=>{try{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/favicon.ico'){res.writeHead(204).end();return;}
  const base=name.startsWith('/production/')?productionRoot:exportRoot;if(base===productionRoot)name=name.slice('/production'.length);
  if(name==='/')name='/index.html';const file=path.resolve(base,'.'+name);if(!file.startsWith(base+path.sep))throw Error('outside export');
  const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css','.png':'image/png'}[path.extname(file)]??'application/octet-stream';
  res.writeHead(200,{'content-type':mime,'cache-control':'no-store'});res.end(await fs.readFile(file));}catch(e){res.writeHead(404).end(String(e));}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));report.url='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true,executablePath:process.env.UNONE_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:800,height:450},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure()?.errorText));
 await page.addInitScript(()=>{
  const old=HTMLCanvasElement.prototype.getContext,contexts=[];
  HTMLCanvasElement.prototype.getContext=function(...args){const gl=old.apply(this,args);if(!gl||!['webgl','webgl2'].includes(args[0])||gl.__cacheProbe)return gl;
   gl.__cacheProbe=true;const active=new Map(),events=[],bound=new Map();const bind=gl.bindTexture.bind(gl),remove=gl.deleteTexture.bind(gl);
   gl.bindTexture=function(target,texture){bound.set(target,texture);return bind(target,texture);};
   for(const name of ['texImage2D','texSubImage2D']){const upload=gl[name].bind(gl);gl[name]=function(...values){const result=upload(...values),image=values.at(-1),match=String(image?.currentSrc||image?.src||'').match(/\/assets\/([ABC])\.png$/);
    if(match){const texture=bound.get(values[0]);active.set(texture,match[1]);events.push({type:'upload',asset:match[1]});}return result;};}
   gl.deleteTexture=function(texture){if(active.has(texture)){events.push({type:'delete',asset:active.get(texture)});active.delete(texture);}return remove(texture);};
   contexts.push({canvas:this,gl,active,events});return gl;};
  window.__textureGpu=()=>contexts.map(c=>({canvas:c.canvas.id,alive:[...c.active.values()].sort(),events:[...c.events],
   gpu:(()=>{const debug=c.gl.getExtension('WEBGL_debug_renderer_info');return debug?c.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):c.gl.getParameter(c.gl.RENDERER);})()}));
 });
 await page.goto(report.url,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.body.dataset.playerError||(window.unoneDeveloper&&document.body.dataset.playerPerformance),null,{timeout:45000});
 const startupError=await page.evaluate(()=>document.body.dataset.playerError);if(startupError)throw Error(startupError);
 await page.locator('#unone-developer .dev-close').click();
 async function state(){return page.evaluate(async()=>({performance:JSON.parse(document.body.dataset.playerPerformance??'{}'),
  observation:(await window.unoneDeveloper.request({method:'observations'})).value,gpu:window.__textureGpu(),error:document.body.dataset.playerError??null}));}
 async function wait(predicate,label,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){const s=await state();if(s.error)throw Error(s.error);if(predicate(s))return s;await page.waitForTimeout(50);}throw Error('Timeout '+label);}
 async function key(letter){await page.keyboard.down(letter);await page.waitForTimeout(90);await page.keyboard.up(letter);}
 async function capture(name,predicate,timeout){const s=await wait(predicate,name,timeout);await page.screenshot({path:path.join(out,name+'.png')});phases.push({name,...s});return s;}
 const bytes=s=>s.performance.texture_cache?.decoded_texture_bytes_estimate;
 const first=await capture('01-A',s=>s.observation.observations.cache_phase==='A'&&bytes(s)===16384);
 check(first.performance.texture_cache.entries===1&&first.performance.texture_cache.pinned_bytes_estimate===16384,'A uploads one real 64x64 RGBA sprite texture and protects it');
 check(first.gpu.find(c=>c.canvas==='game').alive.join()==='A','Real WebGL texture upload corresponds to visible A');
 await key('b');const second=await capture('02-B',s=>s.observation.observations.cache_phase==='B'&&bytes(s)===32768);
 check(second.performance.texture_cache.entries===2&&second.performance.texture_cache.evicted===0,'Switching to B retains idle A during its grace period');
 await key('c');const third=await capture('03-C-pressure',s=>s.observation.observations.cache_phase==='C'&&bytes(s)===32768&&s.performance.texture_cache.evicted>=1);
 check(third.performance.texture_cache.entries===2&&third.gpu.find(c=>c.canvas==='game').alive.join()==='B,C','Count/byte pressure evicts old A while current C remains visible');
 const idle=await capture('04-C-idle',s=>s.observation.observations.cache_phase==='C'&&bytes(s)===16384&&s.performance.texture_cache.entries===1,15000);
 check(idle.performance.texture_cache.evicted>=2&&idle.gpu.find(c=>c.canvas==='game').alive.join()==='C','Idle grace expiry releases B in real WebGL without evicting current C');
 await key('p');const all=await capture('05-all-active',s=>s.observation.observations.cache_phase==='all'&&bytes(s)===49152);
 check(all.performance.texture_cache.entries===3&&all.performance.texture_cache.pressure_entries===1&&all.performance.texture_cache.pressure_bytes===16384,'Three active sprites report honest pressure above the two-texture budget');
 check(all.performance.texture_cache.pinned_bytes_estimate===49152&&all.gpu.find(c=>c.canvas==='game').alive.join()==='A,B,C','All three current-frame textures stay protected and GPU-resident');
 await page.waitForTimeout(3500);const protectedState=await state();
 check(bytes(protectedState)===49152&&protectedState.gpu.find(c=>c.canvas==='game').alive.join()==='A,B,C','Visible textures remain protected beyond the idle timeout');
 report.activeAfterGrace=protectedState;
 await page.evaluate(()=>window.unoneDeveloper.request({method:'pause',paused:true}));
 report.adapter=await page.evaluate(async release=>{
  const {createThreeRenderer}=await import('/'+release+'web/renderer/three.js'),assets=await fetch('/'+release+'content/assets.json').then(r=>r.json());
  const canvas=document.createElement('canvas');canvas.id='cache-direct-clear';canvas.width=canvas.height=256;canvas.style.cssText='width:256px;height:256px';document.body.append(canvas);
  let context,delay=0;const renderer=await createThreeRenderer(canvas,{kind:'three-webgl',bloom:false,ao:false,textureCache:{max_bytes:32768,max_entries:2,idle_frames:180},
   getAssetManifest:()=>assets,loadAssetUrl:async asset=>{if(delay)await new Promise(r=>setTimeout(r,delay));return '/'+release+'content/'+asset.source;},onReady:c=>{context=c;}});
  const snapshot={world:{frame:1,time_seconds:0,camera:{position:{x:0,y:0},view_height:4,zoom:1},entities:Object.fromEntries(['A','B','C'].map((id,i)=>[id,{id,transform:{x:(i-1)*1.2,y:0},sprite:{asset:'texture://cache/'+id,size:{x:1,y:1},visible:true,layer:1}}]))}};
  renderer.draw(snapshot);await renderer.ready();renderer.draw(snapshot);const before=renderer.metrics(),gl=context.renderer.getContext(),pixel=new Uint8Array(4);gl.readPixels(128,128,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  renderer.clearTextures();const after=renderer.metrics(),mapsDetached=context.root.children.every(mesh=>mesh.material.map===null);
  delay=150;snapshot.world.entities={A:snapshot.world.entities.A};renderer.draw(snapshot);renderer.clearTextures();await new Promise(r=>setTimeout(r,400));
  const late=renderer.metrics(),glError=gl.getError();renderer.dispose();const disposed=renderer.metrics();canvas.remove();
  return {before,after,late,disposed,mapsDetached,pixel:[...pixel],glError};
 },manifest.release_root);
 check(report.adapter.before.texture_cache.entries===3&&report.adapter.before.textures===3,'Same-release official adapter also uploads three protected GPU textures');
 check(report.adapter.after.texture_cache.entries===0&&report.adapter.after.texture_cache.decoded_texture_bytes_estimate===0&&report.adapter.after.textures===0,'clearTextures immediately releases cache entries, estimated bytes and actual Three GPU texture allocations');
 check(report.adapter.mapsDetached,'clearTextures detaches sprite materials from disposed maps');
 check(report.adapter.late.texture_cache.entries===0&&report.adapter.late.textures===0,'A real late image completion after clear cannot resurrect the cache or GPU texture');
 check(report.adapter.glError===0&&report.adapter.pixel[1]>report.adapter.pixel[0]&&report.adapter.pixel[1]>report.adapter.pixel[2],'Actual native adapter pixels show the expected green middle sprite with no GL errors');
 check(report.adapter.disposed.textures===0,'Official adapter disposal remains clean after explicit clear');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await page.waitForTimeout(100);
 report.afterPlayerTeardown=await page.evaluate(()=>window.__textureGpu());
 check(report.afterPlayerTeardown.every(c=>c.alive.length===0),'Official player teardown deletes every uploaded fixture sprite texture');
 await page.close();
 async function startupSmoke(url,backend){
  const smoke=await browser.newPage({viewport:{width:800,height:450}}),localErrors=[];
  smoke.on('pageerror',e=>localErrors.push(String(e)));smoke.on('console',m=>{if(m.type()==='error')localErrors.push(m.text());});
  try{
   await smoke.goto(url,{waitUntil:'networkidle'});await smoke.waitForFunction(()=>document.body.dataset.playerError||document.body.dataset.playerPerformance,null,{timeout:20000});
   let state=await smoke.evaluate(()=>({error:document.body.dataset.playerError,performance:JSON.parse(document.body.dataset.playerPerformance??'{}'),mode:document.body.dataset.playerRenderer}));
   check(!state.error&&state.mode==='official'&&state.performance.backend.backend===backend&&state.performance.backend.viewport?.mode==='aspect-only',backend+': actual official startup reports aspect-only compatibility honestly');
   await smoke.setViewportSize({width:900,height:500});await smoke.waitForTimeout(650);
   state=await smoke.evaluate(()=>({error:document.body.dataset.playerError,performance:JSON.parse(document.body.dataset.playerPerformance??'{}')}));
   check(!state.error&&state.performance.texture_cache.decoded_texture_bytes_estimate===16384&&localErrors.length===0,backend+': real native resize keeps the old runtime and GPU sprite healthy');
   return {backend,url,errors:localErrors,...state};
  }finally{await smoke.close();}
 }
 report.workerStartup=await startupSmoke(report.url+'?backend=worker','worker');
 const prodArgs=['--project',project,'--json','export','web','--runtime',path.join(sdk,'runtimes/web-production-0'),'--output',productionRoot];
 const production=spawnSync(cli,prodArgs,{cwd:root,encoding:'utf8',env});assert.equal(production.status,0,production.stdout+production.stderr);
 report.productionExport=JSON.parse(production.stdout).value;
 report.productionStartup=await startupSmoke(report.url+'production/','main');
 check(errors.length===0,'Zero native browser page, console or failed-resource errors');
 report.ok=true;report.completed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(done=>server.close(done));report.passed=checks.length;report.testScriptSha256=hash(await fs.readFile(import.meta.filename));await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,passed:checks.length,evidence:path.join(out,'result.json'),error:report.error}));

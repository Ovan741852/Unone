// Canonical renderer modules on real WebGL: upload scheduling, complete pixels, context restore.
// No game, save, frame-rate, display-present or GPU-kernel-duration claim.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
let chromium;
for(const candidate of [process.env.PLAYWRIGHT_MODULE,'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright','playwright'].filter(Boolean)){
 try{({chromium}=require(candidate));break;}catch{}
}
if(!chromium)throw Error('Use an existing Playwright runtime via PLAYWRIGHT_MODULE');
const html=`<!doctype html><canvas></canvas><script type="module">
import * as T from '/web/vendor/three/three.module.js';
import {createFrameDraws} from '/web/renderer/projected-frame-draws.js';
import {createFramePass} from '/web/renderer/projected-frame-pass.js';
import {projectedFrame} from '/web/shared/projected-frame.mjs';
import {frameProfileCases} from '/web/renderer/projected-frame-profile.js';
import {validateFrameTarget} from '/web/renderer/projected-frame-validator.js';
window.run=async packets=>{
 window.stage='create';
 const canvas=document.querySelector('canvas'),renderer=new T.WebGLRenderer({canvas,antialias:false,preserveDrawingBuffer:true});
 renderer.setPixelRatio(1);renderer.setSize(1280,720,false);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.NoToneMapping;
 const gl=renderer.getContext(),camera=new T.PerspectiveCamera(),pass=createFramePass(T,renderer),texture=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);
 texture.colorSpace=T.NoColorSpace;texture.needsUpdate=true;
 const draws=createFrameDraws(T,()=>({state:'ready',texture})),specs={get:id=>({id,kind:'texture2d'})};
 const calls={bufferData:0,bufferSubData:0,sub_bytes:0};
 for(const name of ['bufferData','bufferSubData']){const original=gl[name].bind(gl);gl[name]=(...args)=>{calls[name]++;if(name==='bufferSubData')calls.sub_bytes+=args[2].byteLength;return original(...args);};}
 const pixels=()=>{const p=new Uint8Array(1280*720*4);gl.readPixels(0,0,1280,720,gl.RGBA,gl.UNSIGNED_BYTE,p);if(gl.getError()!==gl.NO_ERROR)throw Error('GPU_READBACK_ERROR');return p;};
 const same=(a,b)=>{if(a.length!==b.length)throw Error('PIXEL_SIZE');for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw Error('PIXEL_MISMATCH '+i+': '+a[i]+' != '+b[i]);};
 const draw=(api,frame)=>{if(!api.prepare(frame,specs)||!pass.draw(api,camera,frame))throw Error('DRAW_INCOMPLETE');return pixels();};
 const fresh=frame=>{const api=createFrameDraws(T,()=>({state:'ready',texture}));try{return draw(api,frame);}finally{api.clear();}};
 try{
  window.stage='conformance';
  const conformance=validateFrameTarget(T,renderer,pass,{physical_size:[1280,720],material_profile:'rgb8_encoded_rebuild_v1'});
  if(conformance.passed!==conformance.samples)throw Error('CONFORMANCE '+JSON.stringify(conformance.failures));
  const raw=structuredClone(frameProfileCases(1280,720).find(c=>c.id==='alpha-always').frame),first=projectedFrame({projected_frame:raw});
  draw(draws,first);const before={...calls},beforeMetrics=draws.metrics();
  const edited=structuredClone(raw),vertices=Uint8Array.from(atob(edited.draws[0].vertices),c=>c.charCodeAt(0)),view=new DataView(vertices.buffer);
  for(let i=0;i<3;i++){view.setFloat32(i*40+24,0,true);view.setFloat32(i*40+28,1,true);}
  edited.draws[0].vertices=btoa(String.fromCharCode(...vertices));edited.draws[0].indices='AQAAAAAAAAACAAAA';edited.revision++;
  const next=projectedFrame({projected_frame:edited}),changed=draw(draws,next),after={...calls};
  if(after.bufferData!==before.bufferData||after.bufferSubData-before.bufferSubData!==2)throw Error('EXPECTED_EXISTING_GPU_BUFFER_UPDATES '+JSON.stringify({before,after}));
  if(draws.metrics().frame_geometry_builds!==beforeMetrics.frame_geometry_builds)throw Error('UNEXPECTED_GEOMETRY_BUILD');
  same(changed,fresh(next));const steady={...calls};for(let i=0;i<12;i++)same(draw(draws,next),changed);
  if(calls.bufferData!==steady.bufferData||calls.bufferSubData!==steady.bufferSubData)throw Error('UNCHANGED_GEOMETRY_UPLOAD');
  const packetCases=[];window.stage='packets';
  if(packets){for(const tick of [71,72]){const packet=packets.find(p=>p.tick===tick);if(!packet)throw Error('PACKET_MISSING '+tick);const frame=projectedFrame({projected_frame:packet.projected_frame});same(draw(draws,frame),fresh(frame));packetCases.push({tick,draws:frame.draws.length});}}
  window.stage='context-loss';draws.clear();draw(draws,next);const beforeLoss=pixels(),extension=gl.getExtension('WEBGL_lose_context');
  if(!extension)throw Error('CONTEXT_LOSS_EXTENSION_UNAVAILABLE');
  await new Promise(resolve=>{canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();resolve();},{once:true});extension.loseContext();});
  draws.clear();pass.contextLost();
  window.stage='context-restore';await new Promise(resolve=>{canvas.addEventListener('webglcontextrestored',resolve,{once:true});setTimeout(()=>extension.restoreContext(),100);});
  window.stage='restored-draw';
  same(draw(draws,next),beforeLoss);
  const resourcesBeforeClear=draws.metrics();draws.clear();const resourcesAfterClear=draws.metrics();
  for(const key of ['frame_live_geometries','frame_live_materials','frame_live_textures'])if(resourcesAfterClear[key]!==0)throw Error('RESOURCE_RETAINED '+key);
  return {ok:true,scope:'real WebGL uploads, full default-framebuffer pixels, conformance, context restore; no FPS claim',conformance,changed_uploads:{bufferData:after.bufferData-before.bufferData,bufferSubData:after.bufferSubData-before.bufferSubData,bytes:after.sub_bytes-before.sub_bytes},unchanged_redraws:12,packetCases,resourcesBeforeClear,resourcesAfterClear};
 }finally{draws.clear();pass.dispose();texture.dispose();renderer.dispose();}
};
</script>`;
const server=http.createServer(async(req,res)=>{
 try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
  if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep)||!pathname.startsWith('/web/')){res.writeHead(404);res.end();return;}
  const bytes=await readFile(path);res.writeHead(200,{'content-type':['.js','.mjs'].includes(extname(path))?'text/javascript':'application/octet-stream'});res.end(bytes);
 }catch(error){res.writeHead(500);res.end(error.message);}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({...process.env.UNONE_BROWSER_PATH?{executablePath:process.env.UNONE_BROWSER_PATH}:{channel:process.env.BROWSER_CHANNEL??'msedge'},headless:true});
 const page=await browser.newPage(),errors=[],consoleErrors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))consoleErrors.push(message.text());});
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>typeof window.run==='function');
 const packets=process.env.UNONE_PROJECTED_PACKETS?JSON.parse(await readFile(process.env.UNONE_PROJECTED_PACKETS,'utf8')).packets:null;
 const report=await page.evaluate(async packets=>{try{return await Promise.race([window.run(packets),new Promise((_,reject)=>setTimeout(()=>reject(Error('BROWSER_TEST_TIMEOUT: '+window.stage)),45000))]);}catch(error){return {ok:false,error:String(error.stack??error),stage:window.stage};}},packets);report.browser=await browser.version();report.browserErrors=errors;report.consoleErrors=consoleErrors;
 const path=resolve(root,process.argv[2]??'.cache/projected-frame-updates-browser.json');await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,report:path},null,2));assert.equal(report.ok,true,report.error);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
}finally{await browser?.close();await new Promise(done=>server.close(done));}

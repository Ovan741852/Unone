// Actual official legacy projected adapter versus Canvas drawImage. This is a
// bounded pixel/sampling/order regression, not a game FPS or memory-soak test.
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
const html=`<!doctype html><canvas id="gpu"></canvas><canvas id="reference"></canvas><script type="module">
import * as T from '/web/vendor/three/three.module.js';
import {createProjectedRenderer} from '/web/renderer/projected.js';
import {createProjectedRasterPass} from '/web/renderer/projected-raster.js';
import {validateRasterTarget} from '/web/renderer/projected-raster-validator.js';
window.run=async()=>{
 const width=64,height=48,canvas=document.querySelector('#gpu'),reference=document.querySelector('#reference');reference.width=width;reference.height=height;
 const context=reference.getContext('2d',{willReadFrequently:true}),renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true});
 renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.NoToneMapping;
 const gl=renderer.getContext(),camera=new T.PerspectiveCamera(),textures=new Map(),images=new Map(),specs=new Map();
 const add=(id,w,h,pixels)=>{
  const source=document.createElement('canvas');source.width=w;source.height=h;const ctx=source.getContext('2d');ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels),w,h),0,0);images.set(id,source);
  const flipped=new Uint8Array(pixels.length);for(let y=0;y<h;y++)flipped.set(pixels.slice(y*w*4,(y+1)*w*4),(h-1-y)*w*4);
  const texture=new T.DataTexture(flipped,w,h);texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;texture.generateMipmaps=false;textures.set(id,texture);specs.set(id,{kind:'texture2d'});
 };
 add('background',2,2,[32,64,96,255,192,160,128,255,96,32,64,255,160,192,32,255]);
 add('edge',2,2,[255,0,0,255,0,255,0,128,0,0,255,0,255,255,255,32]);
 add('red',1,1,[255,0,0,255]);add('green',1,1,[0,255,0,255]);add('blue',1,1,[0,0,255,255]);
 const atlas=[];for(let y=0;y<4;y++)for(let x=0;x<4;x++)atlas.push(...(x>=1&&x<3&&y>=1&&y<3?[0,255,0,255]:[255,0,255,255]));add('atlas',4,4,atlas);
 const alphaAtlas=[];for(let y=0;y<4;y++)for(let x=0;x<4;x++)alphaAtlas.push(...(x>=1&&x<3&&y>=1&&y<3?[255,0,0,96]:[0,0,255,0]));add('alpha-atlas',4,4,alphaAtlas);
 const b64=a=>{const bytes=new Uint8Array(a.buffer);let text='';for(const n of bytes)text+=String.fromCharCode(n);return btoa(text);};
 const batch=(draw,order)=>{
  const {texture,rect=[0,0,width,height],source,alpha=1,blend='source_over',filter='linear',scissor}=draw,image=images.get(texture),[x,y,w,h]=rect,
   [sx,sy,sw,sh]=source??[0,0,image.width,image.height],u0=sx/image.width,u1=(sx+sw)/image.width,v0=1-(sy+sh)/image.height,v1=1-sy/image.height,
   left=x/width*2-1,right=(x+w)/width*2-1,top=1-y/height*2,bottom=1-(y+h)/height*2,
   vertices=new Float32Array([left,bottom,.5,1,u0,v0,1,1,1,alpha,right,bottom,.5,1,u1,v0,1,1,1,alpha,right,top,.5,1,u1,v1,1,1,1,alpha,left,top,.5,1,u0,v1,1,1,1,alpha]);
  return {format:'f32le-clip4-uv2-rgba4-u32-v1',texture,order,depth_test:false,depth_write:false,color_mode:'encoded',sampling_space:'encoded',filter,alpha_cutoff:0,blend,revision:1,vertex_count:4,index_count:6,vertices:b64(vertices),indices:b64(new Uint32Array([0,1,2,0,2,3])),...(scissor?{scissor}:{} )};
 };
 const backdrop={texture:'background',blend:'opaque',filter:'nearest'},cases=[
  {id:'nearest-alpha',draws:[backdrop,{texture:'edge',filter:'nearest',rect:[8,8,48,32]}]},
  {id:'linear-premultiplied-alpha',draws:[backdrop,{texture:'edge',rect:[8,8,48,32]}]},
  {id:'linear-texture-times-vertex-alpha',draws:[backdrop,{texture:'edge',rect:[8,8,48,32],alpha:.25}]},
  {id:'opaque-after-translucent',draws:[{texture:'red',blend:'opaque'},{texture:'green',alpha:.5},{texture:'blue',blend:'opaque',rect:[16,8,32,32]}]},
  {id:'translucent-after-opaque',draws:[{texture:'red',blend:'opaque'},{texture:'blue',blend:'opaque',rect:[16,8,32,32]},{texture:'green',alpha:.5}]},
  {id:'multiple-translucent-overlap',draws:[backdrop,{texture:'edge',alpha:.75,rect:[4,4,40,36]},{texture:'edge',alpha:.25,rect:[20,12,40,28]}]},
  {id:'physical-scissor',draws:[backdrop,{texture:'edge',rect:[8,8,48,32],scissor:{x:17,y:13,width:21,height:19}}]},
  {id:'atlas-crop-linear-upscale-outside-neighbors',draws:[backdrop,{texture:'atlas',source:[1,1,2,2],rect:[8,8,48,32]}]},
  {id:'atlas-crop-linear-upscale-transparent-neighbors',draws:[backdrop,{texture:'alpha-atlas',source:[1,1,2,2],rect:[8,8,48,32]}]},
  {id:'fractional-source-crop',draws:[backdrop,{texture:'edge',source:[.25,.25,1.5,1.5],rect:[8,8,48,32]}]},
 ];
 const textureFor=spec=>({state:'ready',texture:textures.get([...specs].find(([,s])=>s===spec)[0])}),adapter=createProjectedRenderer(T,textureFor),results=[];
 cases.push({id:'transparent-backdrop-alpha',draws:[{texture:'edge',alpha:.5,rect:[8,8,48,32]}]},
  {id:'transparent-backdrop-multiple-overlays',draws:[{texture:'edge',alpha:.75,rect:[4,4,40,36]},{texture:'edge',alpha:.25,rect:[20,12,40,28]}]});
 try{
  const pass=createProjectedRasterPass(T,renderer);let conformance;
  try{conformance=validateRasterTarget(T,renderer,pass,{physical_size:[width,height]});if(conformance.samples!==conformance.passed)throw Error('DEFAULT_OPAQUE_CONFORMANCE '+JSON.stringify(conformance));}finally{pass.dispose();}
  for(const fixture of cases){
   adapter.clear();const geometry={};fixture.draws.forEach((draw,i)=>geometry['batch'+i]=batch(draw,i));adapter.prepare(adapter.entries({projected_geometry:geometry}),specs);
   renderer.setClearColor(0,0);renderer.clear();adapter.draw(renderer,camera);context.clearRect(0,0,width,height);
   for(const draw of fixture.draws){
    const image=images.get(draw.texture),rect=draw.rect??[0,0,width,height],source=draw.source??[0,0,image.width,image.height];context.save();
    if(draw.scissor){const s=draw.scissor;context.beginPath();context.rect(s.x,s.y,s.width,s.height);context.clip();}
    context.imageSmoothingEnabled=draw.filter!=='nearest';context.globalAlpha=draw.blend==='opaque'?1:draw.alpha??1;context.drawImage(image,...source,...rect);context.restore();
   }
   const actual=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,actual);if(gl.getError()!==gl.NO_ERROR)throw Error('GPU_READBACK_ERROR');
   const expected=context.getImageData(0,0,width,height).data;let differing=0,maxError=0,first=null;
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){
    const a=actual[((height-1-y)*width+x)*4+c],raw=expected[(y*width+x)*4+c],alpha=expected[(y*width+x)*4+3],e=c<3?Math.round(raw*alpha/255):raw,error=Math.abs(a-e);maxError=Math.max(maxError,error);if(error>2){differing++;first??={x,y,channel:c,actual:a,expected:e};}
   }
   results.push({id:fixture.id,passed:differing===0,tolerance:2,maxError,differingChannels:differing,firstMismatch:first});
  }
  window.pixelComparison={actual:canvas.toDataURL(),reference:reference.toDataURL()};
  const calls={bufferData:0,bufferSubData:0};for(const name of Object.keys(calls)){const original=gl[name].bind(gl);gl[name]=(...args)=>{calls[name]++;return original(...args);};}
  const read=()=>{const pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError()!==gl.NO_ERROR)throw Error('GPU_READBACK_ERROR');return pixels;};
  const same=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw Error('UPDATE_PIXEL_MISMATCH '+i+': '+a[i]+' != '+b[i]);};
  const draw=api=>{renderer.setClearColor(0,0);renderer.clear();api.draw(renderer,camera);return read();};
  adapter.clear();const initial=batch({texture:'edge',rect:[8,8,48,32]},0),first={projected_geometry:{a:initial}};adapter.prepare(adapter.entries(first),specs);draw(adapter);const before={...calls},resourcesBefore=adapter.metrics();
  const edited=structuredClone(initial),vertexBytes=Uint8Array.from(atob(edited.vertices),c=>c.charCodeAt(0)),view=new DataView(vertexBytes.buffer);view.setFloat32(0,-.5,true);edited.vertices=btoa(String.fromCharCode(...vertexBytes));edited.indices=b64(new Uint32Array([1,2,3,1,3,0]));edited.revision=2;
  const next={projected_geometry:{a:edited}};adapter.prepare(adapter.entries(next),specs);const changed=draw(adapter),after={...calls};
  if(after.bufferData!==before.bufferData||after.bufferSubData-before.bufferSubData!==2)throw Error('EXPECTED_EXISTING_BUFFER_UPDATES '+JSON.stringify({before,after}));
  if(adapter.metrics().projected_geometry_builds!==resourcesBefore.projected_geometry_builds)throw Error('UNEXPECTED_GEOMETRY_BUILD');
  const fresh=createProjectedRenderer(T,textureFor);try{fresh.prepare(fresh.entries(next),specs);same(changed,draw(fresh));}finally{fresh.clear();}
  const steady={...calls};for(let i=0;i<20;i++){adapter.prepare(adapter.entries(next),specs);same(changed,draw(adapter));}
  if(calls.bufferData!==steady.bufferData||calls.bufferSubData!==steady.bufferSubData)throw Error('UNCHANGED_GEOMETRY_UPLOAD');
  const invalid=structuredClone(next);invalid.projected_geometry.a.indices=b64(new Uint32Array([99,2,3,1,3,0]));let rejected=false;try{adapter.prepare(adapter.entries(invalid),specs);}catch(error){if(!String(error).includes('PROJECTED_INVALID'))throw error;rejected=true;}if(!rejected)throw Error('INVALID_STALE_PAYLOAD_ACCEPTED');same(changed,draw(adapter));
  const resourcesBeforeClear=adapter.metrics();adapter.clear();const resourcesAfterClear=adapter.metrics();if(resourcesAfterClear.projected_live_geometries||resourcesAfterClear.projected_live_materials||resourcesAfterClear.projected_retained_geometries)throw Error('PROJECTED_RESOURCE_RETAINED');
  adapter.prepare(adapter.entries(next),specs);const beforeLoss=draw(adapter),extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw Error('CONTEXT_LOSS_EXTENSION_UNAVAILABLE');
  await new Promise(resolve=>{canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();resolve();},{once:true});extension.loseContext();});adapter.clear();
  await new Promise(resolve=>{canvas.addEventListener('webglcontextrestored',resolve,{once:true});setTimeout(()=>extension.restoreContext(),100);});
  adapter.prepare(adapter.entries(next),specs);same(beforeLoss,draw(adapter));adapter.clear();
  const debug=gl.getExtension('WEBGL_debug_renderer_info');return {ok:results.every(c=>c.passed),scope:'Actual official host-raster legacy projected adapter versus Canvas2D drawImage, full-frame RGB/RGBA pixels, existing GL buffer updates, stale-payload rejection and bounded resource retirement; no FPS or long-soak claim.',physicalSize:[width,height],conformance,results,
   updates:{bufferData:after.bufferData-before.bufferData,bufferSubData:after.bufferSubData-before.bufferSubData,unchangedRedraws:20,invalidStaleRejected:rejected,contextRestorePixelsEqual:true,resourcesBeforeClear,resourcesAfterClear},
   gpu:{renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR)}};
 }finally{adapter.clear();for(const texture of textures.values())texture.dispose();renderer.dispose();}
};
</script>`;
const server=http.createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep)||!pathname.startsWith('/web/')){res.writeHead(404);res.end();return;}
 const bytes=await readFile(path);res.writeHead(200,{'content-type':['.js','.mjs'].includes(extname(path))?'text/javascript':'application/octet-stream'});res.end(bytes);
 }catch(error){res.writeHead(500);res.end(error.message);}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({...process.env.UNONE_BROWSER_PATH?{executablePath:process.env.UNONE_BROWSER_PATH}:{channel:process.env.BROWSER_CHANNEL??'msedge'},headless:true});
 const page=await browser.newPage(),errors=[],warnings=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))warnings.push(message.text());});
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>typeof window.run==='function');
 const report=await page.evaluate(async()=>{try{return await window.run();}catch(error){return {ok:false,error:String(error.stack??error)};}});report.browser=await browser.version();report.browserErrors=errors;report.consoleErrors=warnings;
 const output=resolve(root,process.argv[2]??'artifacts/web-priority-20261030-source-over-pixels');await mkdir(output,{recursive:true});await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');await page.screenshot({path:resolve(output,'post-update.png')});
 const comparison=await page.evaluate(()=>window.pixelComparison);if(comparison)for(const [name,url]of Object.entries(comparison))await writeFile(resolve(output,name+'.png'),Buffer.from(url.split(',')[1],'base64'));
 console.log(JSON.stringify({...report,evidence:output},null,2));assert.equal(report.ok,true,report.error??'Canvas pixel mismatch');assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
}finally{await browser?.close();await new Promise(done=>server.close(done));}

// Real browser shader compilation, pixel probes and asynchronous GPU samples.
// Usage: node scripts/verify-shaders-browser.mjs <output-directory> [--fallback-only]
// Set PLAYWRIGHT_MODULE if playwright is not installed in the normal Node path.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]||'shader-review-output');
const fallbackOnly=process.argv.includes('--fallback-only');
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><canvas id="view"></canvas>');return;}
    const file=resolve(root,'.'+pathname);
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    res.setHeader('content-type',extname(file)==='.js'?'text/javascript':'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:800,height:500}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result=await page.evaluate(async(fallbackOnly)=>{
    const THREE=await import('/web/vendor/three/three.module.js');
    const {createBloom}=await import('/web/renderer/bloom.js');
    const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:false,preserveDrawingBuffer:true});
    renderer.setSize(640,360);renderer.outputColorSpace=THREE.SRGBColorSpace;
    const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    const samples=[],queryModes=new Map();let mode='',collecting=true;
    const begin=gl.beginQuery.bind(gl),get=gl.getQueryParameter.bind(gl);
    gl.beginQuery=(target,q)=>{queryModes.set(q,mode);return begin(target,q);};
    gl.getQueryParameter=(q,p)=>{const v=get(q,p);if(p===gl.QUERY_RESULT&&queryModes.has(q)){if(collecting)samples.push({pass:queryModes.get(q),shader:'shader://yessir/postprocess',gpu_ms:v/1e6});queryModes.delete(q);}return v;};
    const bloom=createBloom(THREE,renderer),scene=new THREE.Scene();
    scene.background=new THREE.Color(0x273343);
    const camera=new THREE.PerspectiveCamera(45,640/360,.1,100);camera.position.set(4,4,7);camera.lookAt(0,0,0);
    scene.add(new THREE.HemisphereLight(0xffffff,0x445566,2));
    const box=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0xcbb589}));box.position.y=.5;scene.add(box);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:0x788391}));floor.rotation.x=-Math.PI/2;scene.add(floor);
    const glow=new THREE.Mesh(new THREE.SphereGeometry(.25,12,8),new THREE.MeshBasicMaterial({color:new THREE.Color(3,.8,.2)}));glow.position.set(1,.4,0);scene.add(glow);
    const modes=[[false,false],[true,false],[false,true],[true,true]],runs=[];
    if(!fallbackOnly)for(const [on,ao] of modes){mode=`bloom_${on?'on':'off'}_ao_${ao?'on':'off'}`;bloom.setEnabled(on);bloom.setAO(ao);for(let i=0;i<48;i++){bloom.draw(scene,camera);await new Promise(requestAnimationFrame);}runs.push({mode,metrics:bloom.metrics()});}
    collecting=false;
    // Low radiance flat plane: no Bloom contribution or geometric AO expected.
    const flat=new THREE.Scene();flat.background=new THREE.Color(.08,.08,.08);
    flat.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({color:new THREE.Color(.08,.08,.08)})));
    const ortho=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);ortho.position.z=2;
    const probes=[];
    for(const [on,ao] of modes){bloom.setEnabled(on);bloom.setAO(ao);bloom.draw(flat,ortho);const pixel=new Uint8Array(4);gl.readPixels(320,180,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);probes.push({on,ao,pixel:[...pixel]});}
    // Exercise first-frame AO without any initialized Bloom target, with RGBA8 fallback.
    const extension=gl.getExtension.bind(gl);
    gl.getExtension=name=>name==='EXT_color_buffer_float'?null:extension(name);
    const ldr=createBloom(THREE,renderer);gl.getExtension=extension;
    ldr.setEnabled(false);ldr.setAO(true);ldr.draw(flat,ortho);
    const ldrPixel=new Uint8Array(4);gl.readPixels(320,180,1,1,gl.RGBA,gl.UNSIGNED_BYTE,ldrPixel);
    const fallbacks=[];
    for(const missing of ['EXT_color_buffer_float','EXT_disjoint_timer_query_webgl2']){
      gl.getExtension=name=>name===missing?null:extension(name);
      const effect=createBloom(THREE,renderer);gl.getExtension=extension;
      for(const [on,ao] of modes){
        effect.setEnabled(on);effect.setAO(ao);effect.draw(flat,ortho);
        const pixel=new Uint8Array(4);gl.readPixels(320,180,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        fallbacks.push({missing,on,ao,pixel:[...pixel],metrics:effect.metrics()});
      }
    }
    for(const [w,h] of [[1,1],[17,9],[641,359]]){renderer.setSize(w,h);bloom.draw(flat,ortho);}
    const programs=renderer.info.programs.map(p=>({name:p.name,runnable:gl.getProgramParameter(p.program,gl.LINK_STATUS)}));
    const wgsl=[];
    if(!fallbackOnly&&navigator.gpu){
      const adapter=await navigator.gpu.requestAdapter();
      if(adapter){
        const device=await adapter.requestDevice();
        const source=await fetch('/web/shared/webgpu-snapshot.js').then(r=>r.text());
        for(const match of source.matchAll(/createShaderModule\(\{ code: `([\s\S]*?)` \}\)/g)){
          const info=await device.createShaderModule({code:match[1]}).getCompilationInfo();
          wgsl.push({messages:info.messages.map(m=>({type:m.type,message:m.message,line:m.lineNum}))});
        }
        device.destroy();
        const {createWebGpuRenderer}=await import('/web/shared/webgpu-snapshot.js');
        const canvas=document.createElement('canvas');canvas.style.width='64px';canvas.style.height='64px';document.body.append(canvas);
        const raw=await createWebGpuRenderer(canvas);raw.draw({world:{entities:{}}});
        await new Promise(requestAnimationFrame);canvas.remove();
      }
    }
    renderer.setSize(640,360);bloom.setEnabled(true);bloom.setAO(true);bloom.draw(scene,camera);
    return {renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),three:THREE.REVISION,timerAvailable:!!ext,glError:gl.getError(),programs,wgsl,probes,fallbacks,ldrFirstAO:{hdr:ldr.metrics().hdr,pixel:[...ldrPixel]},runs,samples};
  },fallbackOnly);
  await page.locator('canvas').screenshot({path:resolve(out,'preview.png')});
  result.errors=errors;
  await writeFile(resolve(out,'browser.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({renderer:result.renderer,programs:result.programs,glError:result.glError,probes:result.probes,samples:result.samples.length,errors},null,2));
  const pixelMismatch=[...result.probes.map(p=>p.pixel),...result.fallbacks.map(p=>p.pixel),result.ldrFirstAO.pixel].some(p=>p.some((v,i)=>Math.abs(v-result.probes[0].pixel[i])>1));
  const fallbackMismatch=result.fallbacks.some(({missing,metrics})=>missing==='EXT_color_buffer_float'?metrics.hdr!==false:
    metrics.gpu_timer_available!==false||['gpu_on','gpu_off','gpu_ao_only','gpu_bloom_with_ao'].some(k=>metrics[k]!==null)||Object.values(metrics.gpu_samples_by_mode).some(v=>v!==null));
  if(errors.length||result.glError||pixelMismatch||fallbackMismatch||result.ldrFirstAO.hdr!==false||result.programs.some(p=>p.runnable===false)||result.wgsl.some(s=>s.messages.some(m=>m.type==='error')))process.exitCode=1;
}finally{await browser?.close();await new Promise(r=>server.close(r));}

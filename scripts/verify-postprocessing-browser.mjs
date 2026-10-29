// Actual official WebGL adapter; isolated solid-color scenes, no game or saves.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
let chromium;
for(const candidate of [process.env.PLAYWRIGHT_MODULE,'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright','playwright'].filter(Boolean)){
  try{({chromium}=require(candidate));break;}catch{}
}
if(!chromium)throw Error('Use the existing Playwright runtime via PLAYWRIGHT_MODULE');
const html=`<!doctype html><script type="module">
import * as T from '/web/vendor/three/three.module.js';
import {createThreeRenderer} from '/web/renderer/three.js';
const modes=[['low',false,false],['medium',true,false],['high',true,true],['ao-only',false,true]];
const config={toneMapping:'aces',exposure:1.05,bloomThreshold:1.1,bloomStrength:.16,aoStrength:.9};
const cases=[];
async function run(label,postprocessing,raw,color=[.5,.5,.5]){
  const canvas=document.createElement('canvas');canvas.style.width='32px';canvas.style.height='32px';document.body.append(canvas);let context;
  const adapter=await createThreeRenderer(canvas,{kind:'three-webgl',bloom:false,ao:false,...(postprocessing===undefined?{}:{postprocessing}),onReady:value=>{
    context=value;
    const geometry=new T.PlaneGeometry(6,6),material=raw?new T.ShaderMaterial({vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'void main(){gl_FragColor=vec4('+color.map(v=>Number(v).toFixed(5)).join(',')+',1.);}'}):new T.MeshBasicMaterial({color:new T.Color().setRGB(...color)}),mesh=new T.Mesh(geometry,material);value.scene.add(mesh);
    return ()=>{value.scene.remove(mesh);geometry.dispose();material.dispose();};
  }});
  const previous={tone:context.renderer.toneMapping,exposure:context.renderer.toneMappingExposure};
  const snapshot={world:{frame:1,time_seconds:0,entities:{},instances3d:{},observations:{},camera3d:{position:{x:0,y:0,z:2},target:{x:0,y:0,z:0},fov_degrees:60}}};
  const pixels=[];
  for(const [mode,bloom,ao]of modes){
    adapter.setBloom(bloom);adapter.setAO(ao);adapter.draw(snapshot,{dt:0});
    const gl=context.renderer.getContext(),bytes=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    pixels.push({mode,rgb:[...bytes.slice(0,3)],glError:gl.getError(),metrics:adapter.metrics()});
  }
  const restored=previous.tone===context.renderer.toneMapping&&previous.exposure===context.renderer.toneMappingExposure;
  const texturesBeforeDispose=context.renderer.info.memory.textures;adapter.dispose();const texturesAfterDispose=context.renderer.info.memory.textures;
  cases.push({label,pixels,restored,texturesBeforeDispose,texturesAfterDispose});canvas.remove();
}
try{
  await run('legacy-builtin',undefined,false);
  await run('legacy-raw',undefined,true);
  await run('aces-builtin',config,false);
  await run('aces-raw',config,true);
  await run('linear-builtin',{...config,toneMapping:'none',exposure:1},false);
  await run('linear-raw',{...config,toneMapping:'none',exposure:1},true);
  await run('linear-half-exposure',{...config,toneMapping:'none',exposure:.5},true);
  // Above-threshold radiance with Bloom disabled checks unclipped HDR/ACES parity.
  await run('aces-hdr-builtin',{...config,bloomStrength:0},false,[2,1,.25]);
  await run('aces-hdr-raw',{...config,bloomStrength:0},true,[2,1,.25]);
  window.report={ok:true,cases};
}catch(error){window.report={ok:false,error:String(error.stack??error),cases};}
</script>`;
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
    if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep))throw Error('outside test root');
    const bytes=await readFile(path);res.writeHead(200,{'content-type':extname(path)==='.json'?'application/json':'text/javascript'});res.end(bytes);
  }catch(error){res.writeHead(404);res.end(error.message);}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL??'msedge',headless:true});
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>window.report,{timeout:60000});
  const report=await page.evaluate(()=>window.report);report.browserErrors=errors;
  assert.equal(report.ok,true,report.error);assert.deepEqual(errors,[]);
  const byLabel=Object.fromEntries(report.cases.map(item=>[item.label,item]));
  const near=(a,b)=>a.every((value,i)=>Math.abs(value-b[i])<=1);
  for(const item of report.cases){
    assert.equal(item.restored,true,item.label+' renderer state');assert.equal(item.texturesAfterDispose,0,item.label+' GPU texture cleanup');
    for(const sample of item.pixels)assert.equal(sample.glError,0,item.label+' GL error');
    if(!item.label.startsWith('legacy-')){
      for(const sample of item.pixels)assert(near(sample.rgb,item.pixels[0].rgb),item.label+' quality color parity');
      assert.equal(item.pixels.find(p=>p.mode==='high').metrics.ao,true);
      assert.equal(item.pixels.find(p=>p.mode==='high').metrics.postprocessing.aoStrength,.9);
      assert.equal(item.pixels[0].metrics.output_pipeline,'linear-tone-srgb');
    }
  }
  assert(near(byLabel['legacy-builtin'].pixels[0].rgb,[188,188,188]),'legacy built-in output stays unchanged');
  assert.equal(byLabel['legacy-builtin'].pixels[0].metrics.postprocessing,null);
  assert(near(byLabel['legacy-raw'].pixels[0].rgb,[127,127,127]),'legacy direct raw output stays unchanged');
  assert(near(byLabel['aces-builtin'].pixels[0].rgb,byLabel['aces-raw'].pixels[0].rgb),'ACES builtin/raw parity');
  assert(near(byLabel['aces-hdr-builtin'].pixels[0].rgb,byLabel['aces-hdr-raw'].pixels[0].rgb),'HDR builtin/raw parity');
  assert(byLabel['aces-hdr-raw'].pixels[0].rgb[0]<255,'ACES preserves bright radiance without hard white clipping');
  assert(near(byLabel['linear-raw'].pixels[0].rgb,[188,188,188]),'raw linear .5 is encoded to sRGB exactly once');
  assert(near(byLabel['linear-half-exposure'].pixels[0].rgb,[137,137,137]),'linear exposure applies without a nonlinear curve');
  report.sourceSha256={};for(const file of ['web/renderer/bloom.js','web/renderer/three.js'])report.sourceSha256[file]=createHash('sha256').update(await readFile(resolve(root,file))).digest('hex');
  await mkdir(resolve(root,'.cache'),{recursive:true});await writeFile(resolve(root,'.cache/postprocessing-browser-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,cases:report.cases.map(item=>({label:item.label,pixels:item.pixels.map(p=>({mode:p.mode,rgb:p.rgb})),texturesAfterDispose:item.texturesAfterDispose})),browserErrors:errors,report:resolve(root,'.cache/postprocessing-browser-report.json')},null,2));
}finally{await browser.close();server.close();}

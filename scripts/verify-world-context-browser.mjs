// Official Three world lifecycle proof. Readbacks/listener inspection are QA
// instrumentation; this does not measure frame cadence or GPU scanout.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const omitRetire=process.argv.includes('--diagnostic-omit-retire');
const html=`<!doctype html><canvas style="width:320px;height:240px"></canvas><script type="module">
import {createThreeRenderer} from '/web/renderer/three.js';
window.run=async()=>{
 const canvas=document.querySelector('canvas'),loads=[],fetches=[],originalFetch=window.fetch;window.fetch=(...args)=>{fetches.push(String(args[0]));return originalFetch(...args);};let capture;
 const assets=[{id:'asset://checker',kind:'texture2d',source:'checker.svg'},{id:'mesh://qa',kind:'mesh3d',source:'triangle.mesh.json'}];
 const api=await createThreeRenderer(canvas,{kind:'three-webgl',threeModuleUrl:'/web/vendor/three/three.player.min.js',bloom:true,
  getAssetManifest:()=>({assets}),loadAssetUrl:async asset=>{loads.push(asset.id);return '/qa/'+asset.source;},onReady:context=>{capture=context;}});
 const transform=(x,y,z,scale=1)=>({position:{x,y,z},rotation:{x:0,y:0,z:0},scale:{x:scale,y:scale,z:scale}}),entity=(id,asset,x,y,z)=>({id,mesh3d:{asset,visible:true},transform3d:transform(x,y,z)});
 const packed=new Float32Array([-1.4,-.8,0,0,0,0,1,.7,.7,.7]),data=btoa(String.fromCharCode(...new Uint8Array(packed.buffer)));
 const snapshot={world:{camera:{view_height:5,zoom:1},camera3d:{position:{x:3,y:2,z:8},target:{x:0,y:0,z:0},fov_degrees:50},
  entities:{sprite:{id:'sprite',sprite:{asset:'asset://checker',visible:true,size:{x:1.2,y:1.2},layer:1},transform:{x:-1.5,y:1},shader_material:'qa'},box:entity('box','mesh://primitive/box',0,0,0),sphere:entity('sphere','mesh://primitive/sphere',0,1.3,0),mesh:entity('mesh','mesh://qa',1.3,0,0)},
  shader_materials:{qa:{fragment:'vec4 unoneShade(vec2 uv,vec4 texel){return texel;}',uniforms:{}}},instances3d:{batch:{asset:'mesh://qa',format:'f32le-p3-q4-s3-v1',count:1,data}},
  heightfields:{ground:{width:2,depth:2,cell_size:2,origin:{x:-1,y:-1.4,z:-1},heights:[0,0,0,0],texture:'asset://checker',revision:1}},
  particles:[{position:{x:1.5,y:1.2,z:0},size:.6,color:[1,.4,.1,1],sprite_shape:'soft_circle',additive:false}]}};
 const read=()=>{const gl=capture.renderer.getContext(),size=new capture.THREE.Vector2();capture.renderer.getDrawingBufferSize(size);const pixels=new Uint8Array(size.x*size.y*4);gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
 const collect=()=>{const resources=new Set();capture.scene.traverse(object=>{if(!object.isMesh)return;if(object.geometry)resources.add(object.geometry);if(object.isInstancedMesh)resources.add(object);
  for(const material of Array.isArray(object.material)?object.material:[object.material]){if(!material)continue;resources.add(material);if(material.map)resources.add(material.map);for(const uniform of Object.values(material.uniforms??{}))if(uniform.value?.isTexture)resources.add(uniform.value);}});return [...resources];};
 const count=objects=>objects.map(object=>({uuid:object.uuid,type:object.type??'Texture',listeners:object._listeners?.dispose?.length??0}));
 api.draw(snapshot);await api.ready();assertComplete(api.draw(snapshot));const initial=read(),initialScreenshot=canvas.toDataURL('image/png'),owned=collect(),arrays=new Map(owned.filter(o=>o.isBufferGeometry).map(o=>[o,o.attributes.position.array])),matrixArrays=new Map(owned.filter(o=>o.isInstancedMesh).map(o=>[o,o.instanceMatrix.array])),images=new Map(owned.filter(o=>o.isTexture).map(o=>[o,o.image]));
 let nonBackgroundPixels=0;for(let i=0;i<initial.length;i+=4)if(initial[i]!==initial[0]||initial[i+1]!==initial[1]||initial[i+2]!==initial[2])nonBackgroundPixels++;if(nonBackgroundPixels<100)throw Error('WORLD_HAS_NO_VISIBLE_ARTWORK');
 const baseLoads=[...loads],baseFetches=[...fetches],initialListeners=count(owned),cycles=[];if(initialListeners.some(r=>r.listeners!==1))throw Error('INITIAL_DISPOSE_BINDINGS '+JSON.stringify(initialListeners));
 const extension=capture.renderer.getContext().getExtension('WEBGL_lose_context');if(!extension)throw Error('CONTEXT_EXTENSION_MISSING');
 try{for(let epoch=1;epoch<=3;epoch++){
   await new Promise(resolve=>{canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();resolve();},{once:true});extension.loseContext();});
   const lostOutcome=api.draw(snapshot),lostListeners=count(owned);if(lostOutcome.status!=='skipped')throw Error('LOST_DRAW_COMPLETED');
   await new Promise(resolve=>{canvas.addEventListener('webglcontextrestored',resolve,{once:true});setTimeout(()=>extension.restoreContext(),100);});
   assertComplete(api.draw(snapshot));const next=read(),after=collect(),listeners=count(owned);let max=0,differences=0;for(let i=0;i<next.length;i++){const delta=Math.abs(next[i]-initial[i]);max=Math.max(max,delta);if(delta)differences++;}
   if(max)throw Error('RESTORE_PIXELS_CHANGED '+JSON.stringify({epoch,max,differences}));if(after.length!==owned.length||after.some(object=>!owned.includes(object)))throw Error('CPU_OWNER_IDENTITY_CHANGED');
   for(const [geometry,array]of arrays)if(geometry.attributes.position.array!==array)throw Error('CPU_GEOMETRY_ARRAY_CHANGED');for(const [mesh,array]of matrixArrays)if(mesh.instanceMatrix.array!==array)throw Error('CPU_INSTANCE_ARRAY_CHANGED');for(const [texture,image]of images)if(texture.image!==image)throw Error('DECODED_IMAGE_CHANGED');
   if(JSON.stringify(loads)!==JSON.stringify(baseLoads)||JSON.stringify(fetches)!==JSON.stringify(baseFetches))throw Error('RESTORE_REFETCH');
   cycles.push({epoch,lostOutcome,lostListeners,restoredListeners:listeners,pixelDifferences:differences,maxChannelDifference:max,metrics:api.metrics()});
  }
  const removed={world:{...snapshot.world,entities:{},instances3d:{},heightfields:{},particles:[]}};assertComplete(api.draw(removed));api.clearTextures();api.dispose();const afterDispose=count(owned),finalGpuMemory={...capture.renderer.info.memory,programs:capture.renderer.info.programs.length};if(afterDispose.some(r=>r.listeners))throw Error('DISPOSAL_LISTENERS_RETAINED');if(finalGpuMemory.geometries||finalGpuMemory.textures||finalGpuMemory.programs)throw Error('DISPOSAL_GPU_RESOURCES_RETAINED '+JSON.stringify(finalGpuMemory));
  return {ok:cycles.every(c=>c.lostListeners.every(r=>r.listeners===0)&&c.restoredListeners.every(r=>r.listeners===1)),scope:'Actual official Three world renderer: sprite/custom shader, primitive box/sphere, decoded mesh, packed instancing, particles, heightfield and Bloom; three loss/restore epochs. CPU objects/arrays/images and load/fetch counts retained, no game code.',initialScreenshot,nonBackgroundPixels,loads,fetches,initialListeners,cycles,afterDispose,finalGpuMemory,finalMetrics:api.metrics()};
 }finally{api.dispose();window.fetch=originalFetch;}
 function assertComplete(outcome){if(outcome?.status!=='completed')throw Error('DRAW_NOT_COMPLETE '+JSON.stringify(outcome));}
};
</script>`;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#e35025" d="M0 0h8v8H0z"/><path fill="#25b8e3" d="M0 0h4v4H0zM4 4h4v4H4z"/></svg>',triangle=JSON.stringify({version:1,positions:[-.5,-.5,0,.5,-.5,0,0,.5,0],uvs:[0,0,1,0,.5,1],indices:[0,1,2],texture:'asset://checker'});
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}if(pathname==='/qa/checker.svg'||pathname==='/qa/triangle.mesh.json'){res.writeHead(200,{'content-type':pathname.endsWith('.svg')?'image/svg+xml':'application/json'});res.end(pathname.endsWith('.svg')?svg:triangle);return;}
 const path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep)||!pathname.startsWith('/web/')){res.writeHead(404);res.end();return;}let body=await readFile(path);if(omitRetire&&pathname==='/web/renderer/three.js'){const original=body.toString();body=original.replace(/    retireWorldGpuBindings\(\);\r?\n/,'');if(body===original)throw Error('QA_RETIRE_CALL_NOT_FOUND');}res.writeHead(200,{'content-type':['.js','.mjs'].includes(extname(path))?'text/javascript':'application/octet-stream'});res.end(body);
 }catch(error){res.writeHead(500);res.end(error.message);}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL??'msedge',headless:true});const page=await browser.newPage(),errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))warnings.push(m.text());});await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>typeof window.run==='function');
 const report=await page.evaluate(async()=>{try{return await window.run();}catch(error){return {ok:false,error:String(error.stack??error)};}});report.browser=await browser.version();report.variant=omitRetire?'diagnostic current official renderer with only retirement call omitted; old-epoch reproduction':'production source';report.errors=errors;report.warnings=warnings;
 const out=resolve(root,process.argv[2]??'artifacts/world-context-browser');await mkdir(out,{recursive:true});if(report.initialScreenshot){await writeFile(resolve(out,'world.png'),Buffer.from(report.initialScreenshot.split(',')[1],'base64'));delete report.initialScreenshot;}await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');await page.screenshot({path:resolve(out,'world-after-disposal.png')});console.log(JSON.stringify(report,null,2));if(!omitRetire){assert.equal(report.ok,true,report.error);assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);}
}finally{await browser?.close();await new Promise(done=>server.close(done));}

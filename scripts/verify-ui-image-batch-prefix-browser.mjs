// Official renderer component proof. QA readbacks/compositing are diagnostic;
// production prefix rendering uses the existing framebuffer without readback.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const html=`<!doctype html><canvas id="world"></canvas><canvas id="actual-ui"></canvas><canvas id="reference-ui"></canvas><canvas id="actual"></canvas><canvas id="expected"></canvas><script type="module">
import * as T from '/web/vendor/three/three.player.min.js';
import {createUiImageBatchPrefix} from '/web/renderer/ui-image-batch-prefix.js';
import {createCanvasUi} from '/web/shared/canvas-ui.mjs';
import {retainImageResource} from '/web/shared/retained-image-generation.mjs';
window.run=async()=>{
 const images=new Map(),add=(id,w,h,pixels)=>{const image=document.createElement('canvas');image.width=w;image.height=h;image.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),w,h),0,0);images.set(id,image);};
 add('asset://white',1,1,[255,255,255,255]);add('asset://red',1,1,[255,0,0,255]);add('asset://blue',1,1,[0,0,255,255]);
 add('asset://alpha',2,2,[255,0,0,255,0,255,0,128,0,0,255,0,255,255,255,32]);
 const atlas=[];for(let y=0;y<4;y++)for(let x=0;x<4;x++)atlas.push(...(x>=1&&x<3&&y>=1&&y<3?[0,255,0,128]:[255,0,255,0]));add('asset://atlas',4,4,atlas);
 const reports=[],worldCanvas=document.querySelector('#world'),uiCanvas=document.querySelector('#actual-ui'),refUiCanvas=document.querySelector('#reference-ui'),actualCanvas=document.querySelector('#actual'),expectedCanvas=document.querySelector('#expected');
 for(const [width,height,dpr]of [[128,96,1],[128,96,2],[96,128,1]]){
  const renderer=new T.WebGLRenderer({canvas:worldCanvas,alpha:false,antialias:false,preserveDrawingBuffer:true});renderer.setPixelRatio(dpr);renderer.setSize(width,height,false);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.NoToneMapping;
  const scene=new T.Scene(),camera=new T.Camera(),background=new T.ShaderMaterial({uniforms:{time:{value:0}},vertexShader:'void main(){gl_Position=vec4(position,1.0);}',fragmentShader:'uniform float time;void main(){gl_FragColor=vec4(0.12+0.08*sin(gl_FragCoord.x*0.07+time),0.23+0.05*cos(gl_FragCoord.y*0.09+time),0.4,1.0);}',depthTest:false,depthWrite:false,toneMapped:false}),plane=new T.PlaneGeometry(2,2),mesh=new T.Mesh(plane,background);mesh.frustumCulled=false;scene.add(mesh);
  const presenter=createUiImageBatchPrefix(T,renderer),load=id=>{if(!images.has(id))throw Error('Missing '+id);return images.get(id);};
  const actual=createCanvasUi(uiCanvas,{resolveAsset:load,getImageBatchPresenter:()=>presenter}),reference=createCanvasUi(refUiCanvas,{resolveAsset:load});
  const pw=width*dpr,ph=height*dpr;actualCanvas.width=expectedCanvas.width=pw;actualCanvas.height=expectedCanvas.height=ph;
  const ac=actualCanvas.getContext('2d',{willReadFrequently:true}),ec=expectedCanvas.getContext('2d',{willReadFrequently:true});
  const quad=(asset,x,y,w,h,extra={})=>({asset,rect:{x,y,width:w,height:h},...extra}),def=(quads,bounds={x:0,y:0,width:64,height:48})=>retainImageResource({revision:1,bounds,quads});
  const art=def([quad('asset://atlas',4,4,16,16,{source:{x:1,y:1,width:2,height:2},opacity:.5}),quad('asset://blue',20,4,12,16,{opacity:.5}),quad('asset://atlas',32,4,16,16,{source:{x:1,y:1,width:2,height:2},opacity:.25}),quad('asset://alpha',8,20,20,16,{opacity:.6})]),
   tiles=def([0,8,16,24].map(x=>quad('asset://white',x,0,8,8))),later=def([quad('asset://red',35,28,20,14,{opacity:.3})]);
  const matrix=(pan=0,origin=0,zoom=1)=>({a:100/width*zoom,b:0,c:0,d:100/height*zoom,tx:100/width*(pan-zoom*origin),ty:-100/height*zoom*origin}),bounds={x:0,y:0,width:100,height:100};
  const first={kind:'image_batch',id:'art',rect:bounds,content:'art',transform:matrix()},tileNode={kind:'image_batch',id:'tiles',rect:bounds,content:'tiles',transform:matrix()},
   snapshot={world:{ui_image_batches:{art,tiles,later},ui:{children:[first,{kind:'input_region',id:'world-input',rect:bounds,action:'World'},tileNode,
    {kind:'text',id:'over-prefix',rect:{x:5,y:10,width:60,height:15},text:'OVER',fontSize:12},
    {kind:'text',id:'hud',rect:{x:5,y:25,width:80,height:25},text:'HUD',fontSize:12},
    {kind:'image_batch',id:'later',rect:bounds,content:'later',transform:matrix()},
    {kind:'button',id:'button',rect:{x:60,y:75,width:35,height:15},text:'Go',action:'Go'}]}}};
  const clear=uiCanvas.getContext('2d').clearRect.bind(uiCanvas.getContext('2d'));let canvasClears=0;uiCanvas.getContext('2d').clearRect=(...args)=>{canvasClears++;return clear(...args);};
  const gl=renderer.getContext(),uploads={bufferData:0,bufferSubData:0};for(const name of Object.keys(uploads)){const original=gl[name].bind(gl);gl[name]=(...args)=>{uploads[name]++;return original(...args);};}
  const draw=async(pan,time,origin=0,zoom=1,expectedPrefix=2)=>{
   first.transform=matrix(pan,origin,zoom);tileNode.transform=matrix(pan,0,zoom);background.uniforms.time.value=time;renderer.render(scene,camera);ec.clearRect(0,0,pw,ph);ec.drawImage(worldCanvas,0,0);
   actual.draw(snapshot,{width,height,dpr});reference.draw(snapshot,{width,height,dpr});await Promise.all([actual.ready(),reference.ready()]);
   // Redraw the world before each UI attempt: an unchanged UI must still draw
   // its GPU prefix, while the Canvas HUD can retain its previous raster.
   renderer.render(scene,camera);ec.clearRect(0,0,pw,ph);ec.drawImage(worldCanvas,0,0);const outcome=actual.draw(snapshot,{width,height,dpr});reference.draw(snapshot,{width,height,dpr});
   ac.clearRect(0,0,pw,ph);ac.drawImage(worldCanvas,0,0);ac.drawImage(uiCanvas,0,0);ec.drawImage(refUiCanvas,0,0);
   if(outcome.status!=='completed')throw Error('UI_NOT_COMPLETE '+JSON.stringify(outcome));if(presenter.metrics().prefix_nodes!==expectedPrefix)throw Error('PREFIX_NOT_ACCELERATED '+JSON.stringify(presenter.metrics()));
   return {a:ac.getImageData(0,0,pw,ph).data,e:ec.getImageData(0,0,pw,ph).data};
  };
  const compare=(a,e,pan,zoom=1)=>{
    let max=0,differences=0,interiorBad=0,seamBad=0;
    const rectangles=[...art.quads,...tiles.quads].map(q=>({left:(q.rect.x*zoom+pan)*dpr,right:((q.rect.x+q.rect.width)*zoom+pan)*dpr,bottom:q.rect.y*zoom*dpr,top:(q.rect.y+q.rect.height)*zoom*dpr}));
    if(first.rect!==bounds){const r=first.rect;rectangles.push({left:r.x*pw/100,right:(r.x+r.width)*pw/100,bottom:r.y*ph/100,top:(r.y+r.height)*ph/100});}
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
     const py=ph-y-.5,px=x+.5,near=rectangles.some(r=>py>=r.bottom-1&&py<=r.top+1&&(Math.abs(px-r.left)<=1||Math.abs(px-r.right)<=1)||px>=r.left-1&&px<=r.right+1&&(Math.abs(py-r.bottom)<=1||Math.abs(py-r.top)<=1));
     for(let c=0;c<4;c++){const delta=Math.abs(a[(y*pw+x)*4+c]-e[(y*pw+x)*4+c]);max=Math.max(max,delta);if(delta>2){differences++;if(!near)interiorBad++;}}
     if(py>=dpr&&py<7*zoom*dpr&&px>=pan*dpr+.5&&px<(32*zoom+pan)*dpr-.5)for(let c=0;c<3;c++)if(a[(y*pw+x)*4+c]!==255)seamBad++;
    }
    if(interiorBad||seamBad)throw Error('COVERAGE_OR_INTERIOR '+JSON.stringify({pan,zoom,interiorBad,seamBad,max,differences}));return {panCssPixels:pan,zoom,maxChannelDifference:max,edgeChannelsDifferingAbove2:differences,interiorBad,seamBad};
  };
  try{
   await draw(0,0);const before=presenter.metrics(),beforeUploads={...uploads},beforeClears=canvasClears,cases=[];
   for(const pan of [0,.125,.25,.375,.5,.625,.75,.875]){
    const {a,e}=await draw(pan,pan+1);cases.push(compare(a,e,pan));
   }
   const zoomed=await draw(.3125,2,0,1.125);cases.push({...compare(zoomed.a,zoomed.e,.3125,1.125),case:'fractional_zoom'});
   first.rect={x:8.7,y:5.1,width:15.2,height:12.4};const clipped=await draw(.375,2.5);cases.push({...compare(clipped.a,clipped.e,.375),case:'fractional_clip'});first.rect=bounds;
   const small=await draw(.375,3);
   const after=presenter.metrics(),cameraUploads={bufferData:uploads.bufferData-beforeUploads.bufferData,bufferSubData:uploads.bufferSubData-beforeUploads.bufferSubData},cameraCanvasClears=canvasClears-beforeClears;if(after.geometry_builds!==before.geometry_builds||cameraUploads.bufferData||cameraUploads.bufferSubData)throw Error('CAMERA_RESOURCE_CHURN');
   if(canvasClears!==beforeClears)throw Error('HUD_RASTER_CHURN '+beforeClears+' -> '+canvasClears);
   if(actual.hitTest(70,80).action!=='Go')throw Error('HUD_INPUT_CHANGED');
   snapshot.world.ui.children.unshift({kind:'text',id:'before-art',rect:{x:0,y:2,width:40,height:12},text:'BOTTOM',fontSize:12});
   const fallback=await draw(.375,3,0,1,0);for(let i=0;i<fallback.a.length;i++)if(fallback.a[i]!==fallback.e[i])throw Error('LEADING_TEXT_ORDER_MISMATCH '+i);snapshot.world.ui.children.shift();
   const offset=1e8;const shifted=def(art.quads.map(q=>({...q,rect:{...q.rect,x:q.rect.x+offset,y:q.rect.y+offset}})),{x:offset,y:offset,width:64,height:48});
   snapshot.world.ui_image_batches.art=shifted;const large=await draw(.375,3,offset);if(presenter.metrics().prefix_nodes!==2)throw Error('LARGE_ORIGIN_FALLBACK');
   for(let i=0;i<large.a.length;i++)if(Math.abs(large.a[i]-small.a[i])>2)throw Error('LARGE_ORIGIN_PIXEL_MISMATCH '+i);
   let restored=null;if(width===128&&height===96&&dpr===1){const extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw Error('CONTEXT_LOSS_EXTENSION');
    await new Promise(resolve=>{worldCanvas.addEventListener('webglcontextlost',event=>{event.preventDefault();resolve();},{once:true});extension.loseContext();});
    const lost=actual.draw(snapshot,{width,height,dpr});if(lost.status!=='skipped'||lost.reason!=='ui_target_unavailable')throw Error('LOST_UI_COUNTED_COMPLETE');plane.dispose();
    await new Promise(resolve=>{worldCanvas.addEventListener('webglcontextrestored',resolve,{once:true});setTimeout(()=>extension.restoreContext(),100);});const again=await draw(.375,3,offset);
    for(let i=0;i<large.a.length;i++)if(large.a[i]!==again.a[i])throw Error('RESTORED_PIXEL_MISMATCH '+i);restored=true;
   }
   const resourcesBeforeClear=presenter.metrics();actual.dispose();reference.dispose();const resourcesAfterClear=presenter.metrics();
   if(resourcesAfterClear.live_geometries||resourcesAfterClear.live_materials||resourcesAfterClear.live_textures)throw Error('RESOURCE_RETAINED');
   reports.push({width,height,dpr,cases,geometryBuildsDuringCamera:after.geometry_builds-before.geometry_builds,uploadsDuringCamera:cameraUploads,canvasHudRepaints:cameraCanvasClears,overlappingHudOrderCorrect:true,leadingTextFullFallbackPixelsEqual:true,largeOriginAccelerated:true,largeOriginPixelsEqual:true,contextRestorePixelsEqual:restored,resourcesBeforeClear,resourcesAfterClear});
  }finally{actual.dispose();reference.dispose();presenter.dispose();plane.dispose();background.dispose();renderer.dispose();}
 }
 return {ok:true,scope:'Official WebGL UI prefix plus real Canvas HUD; fractional pan/shared-edge coverage, source crop/alpha/order, ordinary world shader underlay, DPR, retained geometry and release. GPU pixel-center edge coverage is intentionally distinct from Canvas AA, without snapping.',reports};
};
</script>`;
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}const path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep)||!pathname.startsWith('/web/')){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':['.js','.mjs'].includes(extname(path))?'text/javascript':'application/octet-stream'});res.end(await readFile(path));}catch(error){res.writeHead(500);res.end(error.message);}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL??'msedge',headless:true});const page=await browser.newPage(),errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))warnings.push(m.text());});
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>typeof window.run==='function');const report=await page.evaluate(async()=>{try{return await window.run();}catch(error){return {ok:false,error:String(error.stack??error)};}});report.browser=await browser.version();report.errors=errors;report.warnings=warnings;
 const out=resolve(root,process.argv[2]??'artifacts/retained-ui-prefix-browser');await mkdir(out,{recursive:true});await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');await page.screenshot({path:resolve(out,'comparison.png')});console.log(JSON.stringify(report,null,2));assert.equal(report.ok,true,report.error);assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
}finally{await browser?.close();await new Promise(done=>server.close(done));}

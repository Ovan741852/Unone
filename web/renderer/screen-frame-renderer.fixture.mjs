import {createThreeRenderer} from './three.js';

window.testFrameRenderer=async()=>{
 const makeCanvas=()=>{const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas);return canvas;};
 const ordinaryCanvas=makeCanvas(),stagedCanvas=makeCanvas();
 const opts={kind:'three-webgl',threeModuleUrl:'/web/vendor/three/three.player.min.js',antialias:false};
 const ordinary=await createThreeRenderer(ordinaryCanvas,opts);
 const staged=await createThreeRenderer(stagedCanvas,{...opts,frameTransaction:true,webglDefaultDepth:false});
 if(!staged.frameTransaction)throw Error('transaction unavailable');
 const tx=staged.frameTransaction;
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 const read=canvas=>{const gl=canvas.getContext('webgl2'),pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
 const entity=(id,x,z,color)=>({id,mesh3d:{asset:'mesh://primitive/box',visible:true,color},transform3d:{position:{x,y:0,z},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});
 const base={world:{camera:{view_height:5,zoom:1},camera3d:{position:{x:3,y:2,z:8},target:{x:0,y:0,z:0},fov_degrees:50},entities:{box:entity('box',0,0,'#f00000'),back:entity('back',.25,-1,'#00a000')}}};
 const rect={world:{...base.world,camera3d:{...base.world.camera3d,rect:{x:.1,y:.2,width:.7,height:.6}}}};
 const empty={world:{camera:{view_height:5,zoom:1},entities:{},projected_world_visible:false}};
 const draw=(snapshot,allowResize=false)=>{const start=tx.begin(snapshot,{allowResize});assert(start.status==='completed','begin '+JSON.stringify(start));const result=staged.draw(snapshot);assert(result.status==='completed','draw '+JSON.stringify(result));const end=tx.commit();assert(end.status==='completed','commit '+JSON.stringify(end));return {start,end};};
 try{
  const refused=tx.begin(base);assert(refused.reason==='frame_resize_required','resize not deferred');
  const results=[];
  for(const [index,snapshot] of [base,rect,rect,base,empty,base].entries()){
   const reference=ordinary.draw(snapshot);assert(reference.status==='completed','reference '+JSON.stringify(reference));
   const state=draw(snapshot,index===0),a=read(ordinaryCanvas),b=read(stagedCanvas);let differing=0,max=0;
   for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)differing++;max=Math.max(max,d);}
   results.push({index,differing,max,depth:tx.metrics().depth_allocated,...state});
  }
  const before=read(stagedCanvas);assert(tx.begin(rect).status==='completed','abort begin');assert(staged.draw(rect).status==='completed','abort draw');assert(tx.abort().presentation==='unchanged','abort');const after=read(stagedCanvas);
  const retained=before.every((x,i)=>x===after[i]);
  const gl=stagedCanvas.getContext('webgl2'),extension=gl.getExtension('WEBGL_lose_context');assert(extension,'missing lose-context extension');
  await new Promise(resolve=>{stagedCanvas.addEventListener('webglcontextlost',event=>{event.preventDefault();resolve();},{once:true});extension.loseContext();});
  const lost=tx.begin(base);assert(lost.status==='skipped'&&lost.presentation==='unknown','loss must be uncertain '+JSON.stringify(lost));
  await new Promise(resolve=>{stagedCanvas.addEventListener('webglcontextrestored',resolve,{once:true});setTimeout(()=>extension.restoreContext(),100);});
  const restored=draw(base),restoredPixels=read(stagedCanvas);assert(restoredPixels.every((x,i)=>x===before[i]),'restore pixels differ');assert(tx.metrics().epoch===2,'context epoch');
  return {results,retained,lost,restored,depthPolicy:staged.metrics().webgl_default_depth,transaction:tx.metrics()};
 }finally{ordinary.dispose();staged.dispose();}
};

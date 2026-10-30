// Official game UI on the three.js WebGL pipeline: the render pipeline's `ui`
// stage, drawn into the same frame as the world. One instanced quad shader
// draws boxes, borders, images, 9-slices, image batches and text in painter
// order; quads split into draw calls only where their texture changes.
// The browser font engine rasterizes each text block once into an atlas page
// (a glyph resource, like a decoded image); every pixel on screen is drawn by
// three.js. Geometry is rebuilt only when the composition changes; unchanged
// frames submit the same draw calls again.
import {slicePatches} from '../shared/ui-geometry.mjs';
import {textPaintBounds} from '../shared/ui-presentation.mjs';
import {imageBatchSnappedRect} from '../shared/ui-image-batch.mjs';

const STRIDE=32,FILL=0,BORDER=1,IMAGE=2,FREE=3,MAX_PAGES=4,ATTRIBUTES=['uiOrigin','uiAxis','uiUv','uiColor','uiBorder','uiBox','uiParams','uiClip'];
// Pixel space is the drawing buffer, y down. uiOrigin = origin.xy + x axis,
// uiAxis = y axis; axes carry image-batch affine transforms and reflection.
const VERTEX=`attribute vec4 uiOrigin;attribute vec4 uiAxis;attribute vec4 uiUv;attribute vec4 uiColor;attribute vec4 uiBorder;attribute vec4 uiBox;attribute vec4 uiParams;attribute vec4 uiClip;
uniform vec2 uiSize;
varying vec2 vPixel;varying vec2 vUv;varying vec4 vColor;varying vec4 vBorder;varying vec4 vBox;varying vec4 vParams;varying vec4 vClip;
void main(){vec2 corner=position.xy;vec2 pixel=uiOrigin.xy+corner.x*uiOrigin.zw+corner.y*uiAxis.xy;
vPixel=pixel;vUv=mix(uiUv.xy,uiUv.zw,corner);vColor=uiColor;vBorder=uiBorder;vBox=uiBox;vParams=uiParams;vClip=uiClip;
gl_Position=vec4(pixel.x/uiSize.x*2.0-1.0,1.0-pixel.y/uiSize.y*2.0,0.0,1.0);}`;
// Modes: 0 rounded fill, 1 rounded border ring (Canvas stroke on the half-width
// inset path), 2 premultiplied texture clipped to the rounded box, 3 texture
// with the rectangular clip only. Output is premultiplied sRGB, blended like
// the browser composites a 2D layer.
const FRAGMENT=`uniform sampler2D uiTexture;
varying vec2 vPixel;varying vec2 vUv;varying vec4 vColor;varying vec4 vBorder;varying vec4 vBox;varying vec4 vParams;varying vec4 vClip;
float roundedBox(vec2 p,vec4 b,float r){vec2 h=b.zw*0.5;r=clamp(r,0.0,min(h.x,h.y));vec2 q=abs(p-(b.xy+h))-h+r;return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r;}
float coverage(vec4 b,float r){return clamp(0.5-roundedBox(vPixel,b,r),0.0,1.0);}
void main(){
 if(vPixel.x<vClip.x||vPixel.y<vClip.y||vPixel.x>=vClip.z||vPixel.y>=vClip.w)discard;
 float mode=vParams.z;vec4 color;
 if(mode<0.5)color=vec4(vColor.rgb,1.0)*vColor.a*coverage(vBox,vParams.x);
 else if(mode<1.5){float w=vParams.y;vec4 inner=vec4(vBox.xy+w,vBox.zw-2.0*w);
  float hole=inner.z>0.0&&inner.w>0.0?coverage(inner,max(0.0,vParams.x-w)):0.0;
  color=vec4(vBorder.rgb,1.0)*vBorder.a*coverage(vBox,vParams.x)*(1.0-hole);}
 else{color=texture2D(uiTexture,vUv)*vColor.a;if(mode<2.5)color*=coverage(vBox,vParams.x);}
 gl_FragColor=color*vParams.w;
}`;
const imageSize=image=>[image?.naturalWidth??image?.width,image?.naturalHeight??image?.height];
const capacityFor=n=>2**Math.ceil(Math.log2(Math.max(64,n)));
const WHITE=[1,1,1,1],NONE=[0,0,0,0],FULL_UV=[0,0,1,1];

export function createGpuUi(THREE,renderer,{available=()=>true,createSurface=()=>document.createElement('canvas')}={}){
 const scene=new THREE.Scene(),camera=new THREE.Camera(),size=new THREE.Vector2(),uiSize=new THREE.Vector2(1,1),viewport=new THREE.Vector4(),at=new THREE.Vector2();
 const positions=new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,1,1,0,0,1,0]),3),index=new THREE.BufferAttribute(new Uint16Array([0,1,2,0,2,3]),1);
 const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
 const runs=[],pages=[],slots=new Map(),dedicated=new Map(),imageTextures=new Map();
 let data=new Float32Array(256*STRIDE),count=0,drawRuns=0,width=0,height=0,disposed=false,scratch=null,scratchContext=null,scratchTexture=null,atlasSize=0;
 let rebuilds=0,rasters=0,uploads=0,compactions=0,draws=0,lastRegions=0,lastMs=null,wasted=0,stale=true;

 function material(){
  return new THREE.ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT,uniforms:{uiSize:{value:uiSize},uiTexture:{value:white}},
   transparent:true,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,blending:THREE.CustomBlending,
   blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor});
 }
 function runAt(i,needed){
  let r=runs[i];if(r&&r.capacity>=needed)return r;
  const capacity=capacityFor(needed),geometry=new THREE.InstancedBufferGeometry(),buffer=new THREE.InstancedInterleavedBuffer(new Float32Array(capacity*STRIDE),STRIDE,1);
  buffer.setUsage(THREE.DynamicDrawUsage);geometry.setIndex(index);geometry.setAttribute('position',positions);
  ATTRIBUTES.forEach((name,k)=>geometry.setAttribute(name,new THREE.InterleavedBufferAttribute(buffer,4,k*4)));
  if(r){r.geometry.dispose();r.mesh.geometry=geometry;Object.assign(r,{geometry,buffer,capacity});return r;}
  const mesh=new THREE.Mesh(geometry,material());mesh.frustumCulled=false;mesh.renderOrder=i;scene.add(mesh);
  r={mesh,geometry,buffer,capacity};runs[i]=r;return r;
 }

 // Text atlas: shelf-packed pages, one slot per text node id so a changing
 // label re-rasterizes in place. A full atlas is repacked with only the live
 // composition; blocks larger than a page get their own texture.
 function surface(w,h){const canvas=createSurface();canvas.width=w;canvas.height=h;return canvas;}
 function configure(texture){texture.flipY=false;texture.premultiplyAlpha=true;texture.generateMipmaps=false;texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.colorSpace=THREE.NoColorSpace;return texture;}
 function newPage(){
  const blank=surface(atlasSize,atlasSize),texture=configure(new THREE.Texture(blank));texture.needsUpdate=true;
  renderer.initTexture(texture);blank.width=blank.height=1;// GPU storage stays; the blank CPU canvas is released.
  const page={texture,shelves:[],top:0};pages.push(page);return page;
 }
 function fit(page,w,h){
  for(const s of page.shelves)if(h<=s.height&&s.height<=h*1.5+8&&s.x+w<=atlasSize){const x=s.x;s.x+=w+1;return {page,x,y:s.y};}
  const shelfHeight=Math.min(atlasSize,Math.ceil(h/4)*4);
  if(w>atlasSize||page.top+shelfHeight>atlasSize)return null;
  const shelf={y:page.top,height:shelfHeight,x:w+1};page.shelves.push(shelf);page.top+=shelfHeight+1;return {page,x:0,y:shelf.y};
 }
 function allocate(w,h){
  if(w>atlasSize||h>atlasSize)return null;
  for(const page of pages){const place=fit(page,w,h);if(place)return place;}
  return pages.length<MAX_PAGES?fit(newPage(),w,h):null;
 }
 function paint(request,canvas,context){
  canvas.width=request.w;canvas.height=request.h;
  context.setTransform(1,0,0,1,-request.x0,-request.y0);request.paint(context);rasters++;
 }
 // Atlas uploads rasterize into one grow-only CPU-backed scratch canvas and
 // send just that block's pixels with one texSubImage2D. The texture is bound
 // through Three's state cache and unpack state is set, never queried: every
 // gl.getParameter is a synchronous GPU round trip.
 function upload(slot,request){
  const {w,h}=request;
  if(!scratch||scratch.width<w||scratch.height<h){
   scratch=surface(Math.max(w,scratch?.width??0,256),Math.max(h,scratch?.height??0,64));
   scratchContext=scratch.getContext('2d',{willReadFrequently:true});if(!scratchContext)throw Error('UI_TEXT_RASTER_UNAVAILABLE');
  }
  const context=scratchContext;context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,w,h);
  context.save();try{context.beginPath();context.rect(0,0,w,h);context.clip();context.setTransform(1,0,0,1,-request.x0,-request.y0);request.paint(context);}finally{context.restore();}rasters++;
  const pixels=context.getImageData(0,0,w,h).data,gl=renderer.getContext();
  renderer.state.bindTexture(gl.TEXTURE_2D,renderer.properties.get(slot.page.texture).__webglTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);
  try{gl.texSubImage2D(gl.TEXTURE_2D,0,slot.x,slot.y,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);uploads++;}
  finally{gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);}
 }
 function placeText(requests){
  const live=new Set(requests.map(r=>r.key));
  const resolve=fresh=>{
   const missing=[];
   for(const request of requests){
    let slot=fresh?null:slots.get(request.key);
    if(!slot||slot.w<request.w||slot.h<request.h){if(slot)wasted++;const place=allocate(request.w,request.h);if(!place){missing.push(request);continue;}slot={...place,w:request.w,h:request.h,content:null};slots.set(request.key,slot);}
    request.slot=slot;
   }
   return missing;
  };
  let missing=resolve(false);
  if(missing.length&&(slots.size>live.size||wasted)){
   // Repack: drop every slot this composition does not use, re-raster the rest.
   compactions++;wasted=0;slots.clear();for(const page of pages){page.shelves=[];page.top=0;}missing=resolve(true);
  }
  for(const request of requests)if(request.slot&&!missing.includes(request)){
   if(request.slot.content!==request.content){upload(request.slot,request);request.slot.content=request.content;}
   const s=request.slot;request.texture=s.page.texture;request.uv=[s.x/atlasSize,s.y/atlasSize,(s.x+request.w)/atlasSize,(s.y+request.h)/atlasSize];
  }
  for(const request of missing){
   let own=dedicated.get(request.key);
   if(!own||own.content!==request.content){own?.texture.dispose();const canvas=surface(request.w,request.h),context=canvas.getContext('2d');
    if(!context)throw Error('UI_TEXT_RASTER_UNAVAILABLE');paint(request,canvas,context);
    own={texture:configure(new THREE.Texture(canvas)),content:request.content};own.texture.needsUpdate=true;dedicated.set(request.key,own);uploads++;}
   request.texture=own.texture;request.uv=FULL_UV;request.dedicated=true;
  }
  for(const [key,own]of dedicated)if(!missing.some(r=>r.key===key)){own.texture.dispose();dedicated.delete(key);}
 }
 function imageTexture(image,used){
  used.add(image);let texture=imageTextures.get(image);
  if(!texture){texture=configure(new THREE.Texture(image));texture.needsUpdate=true;imageTextures.set(image,texture);}
  return texture;
 }

 function rebuild(context){
  const started=performance.now(),{nodes,nodeKeys,batches,images,scale,paintText,hasText,imageError,identity}=context,W=width,H=height,unit=H/100;
  const prims=[],requests=[],ids=new Map(),usedImages=new Set(),screen=[0,0,W,H];
  const clipOf=c=>c?[c.x*W/100,(100-c.y-c.height)*H/100,(c.x+c.width)*W/100,(100-c.y)*H/100]:screen;
  const meet=(a,b)=>[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];
  const rect=(x,y,w,h,extra)=>prims.push({origin:[x,y],axisX:[w,0],axisY:[0,h],uv:FULL_UV,color:WHITE,border:NONE,box:[x,y,w,h],radius:0,width:0,opacity:1,...extra});
  function image(node,x,y,w,h,radius,opacity,clip){
   const entry=images.get(node.asset);if(!entry?.image)return;
   const pad=node.style?.padding??{},left=(pad.left??0)*unit,top=(pad.top??0)*unit;
   const cw=Math.max(0,w-left-(pad.right??0)*unit),ch=Math.max(0,h-top-(pad.bottom??0)*unit);if(!cw||!ch)return;
   const [iw,ih]=imageSize(entry.image),texture=imageTexture(entry.image,usedImages),cx=x+left,cy=y+top,inner=meet(clip,[cx,cy,cx+cw,cy+ch]);
   const quad=(dx,dy,dw,dh,uv)=>rect(dx,dy,dw,dh,{mode:IMAGE,texture,uv,box:[x,y,w,h],radius,opacity,clip:inner});
   try{
    if(node.slice){
     if(node.fit&&node.fit!=='stretch')throw Error('UI_SLICE_FIT_CONFLICT: omit fit or use stretch');
     for(const [s,d]of slicePatches(node.slice,iw,ih,cw,ch,H))quad(cx+d.x,cy+d.y,d.width,d.height,[s.x/iw,s.y/ih,(s.x+s.width)/iw,(s.y+s.height)/ih]);
    }else if(node.fit==='stretch')quad(cx,cy,cw,ch,FULL_UV);
    else{const k=node.fit==='cover'?Math.max(cw/iw,ch/ih):Math.min(cw/iw,ch/ih);quad(cx+(cw-iw*k)/2,cy+(ch-ih*k)/2,iw*k,ih*k,FULL_UV);}
   }catch(error){imageError(node,null,error);}
  }
  function imageBatch(node,clip){
   const instance=batches.get(node),t=instance.transform,stage=meet(clip,clipOf(instance.clip));
   const point=(sx,sy)=>[(t.a*sx+t.c*sy+t.tx)*W/100,H-(t.b*sx+t.d*sy+t.ty)*H/100];
   instance.definition.quads.forEach((q,i)=>{
    const entry=images.get(q.asset);if(!entry?.image)return;
    const [iw,ih]=imageSize(entry.image),s=q.source,r=q.rect;
    if(s&&(s.x+s.width>iw||s.y+s.height>ih)){imageError(node,i,Error(`UI_SLICE_BOUNDS: source exceeds image ${iw}x${ih}`));return;}
    let origin,axisX,axisY;
    if(instance.pixelSnap){const snapped=imageBatchSnappedRect(instance,r,W,H);if(!snapped.width||!snapped.height)return;origin=[snapped.x,snapped.y];axisX=[snapped.width,0];axisY=[0,snapped.height];}
    else{const tl=point(r.x,r.y+r.height),tr=point(r.x+r.width,r.y+r.height),bl=point(r.x,r.y);origin=tl;axisX=[tr[0]-tl[0],tr[1]-tl[1]];axisY=[bl[0]-tl[0],bl[1]-tl[1]];}
    prims.push({mode:FREE,origin,axisX,axisY,uv:s?[s.x/iw,s.y/ih,(s.x+s.width)/iw,(s.y+s.height)/ih]:FULL_UV,color:[1,1,1,q.opacity??1],border:NONE,box:[0,0,0,0],radius:0,width:0,opacity:1,clip:stage,texture:imageTexture(entry.image,usedImages)});
   });
  }
  function text(node,nodeKey,x,y,w,h,radius,opacity,clip,bounds){
   const x0=Math.max(Math.floor(bounds.x),Math.floor(clip[0]),0),y0=Math.max(Math.floor(bounds.y),Math.floor(clip[1]),0);
   const x1=Math.min(Math.ceil(bounds.x+bounds.width),Math.ceil(clip[2]),W),y1=Math.min(Math.ceil(bounds.y+bounds.height),Math.ceil(clip[3]),H);
   if(x1<=x0||y1<=y0)return;
   const n=(ids.get(node.id)??0)+1;ids.set(node.id,n);
   const request={key:n>1?`${node.id}\u0000${n}`:node.id,x0,y0,w:x1-x0,h:y1-y0,
    content:`${identity}${nodeKey}${x-x0},${y-y0},${w},${h},${x1-x0},${y1-y0},${H},${scale}`,
    paint:target=>paintText(target,node,{x,y,width:w,height:h,viewportHeight:H},scale)};
   requests.push(request);
   rect(x0,y0,x1-x0,y1-y0,{mode:node.style?.text_shadow?FREE:IMAGE,text:request,box:[x,y,w,h],radius,opacity,clip});
  }
  for(let index=0;index<nodes.length;index++){
   const node=nodes[index];if(node.kind==='input_region')continue;
   const clip=clipOf(node.clip);
   if(node.kind==='image_batch'){imageBatch(node,clip);continue;}
   const r=node.rect,x=r.x*W/100,y=(100-r.y-r.height)*H/100,w=r.width*W/100,h=r.height*H/100,style=node.style;
   const opacity=style?.opacity??1,bounds=textPaintBounds(style,{x,y,width:w,height:h,viewportHeight:H});
   if(opacity<=0||bounds.x>=clip[2]||bounds.x+bounds.width<=clip[0]||bounds.y>=clip[3]||bounds.y+bounds.height<=clip[1])continue;
   const radius=(style?.border_radius??0)*unit;
   if(style?.background)rect(x,y,w,h,{mode:FILL,color:style.background,radius,opacity,clip});
   if(node.kind==='image')image(node,x,y,w,h,radius,opacity,clip);
   else if(hasText(node))text(node,nodeKeys?.[index]??JSON.stringify(node),x,y,w,h,radius,opacity,clip,bounds);
   const border=Math.min((style?.border_width??0)*unit,w,h);
   if(border>0)rect(x,y,w,h,{mode:BORDER,border:style.border_color??WHITE,radius,width:border,opacity,clip});
  }
  placeText(requests);
  for(const [image,texture]of imageTextures)if(!usedImages.has(image)){texture.dispose();imageTextures.delete(image);}
  // Pack quads in painter order; a draw call ends only where the texture changes.
  if(data.length<prims.length*STRIDE)data=new Float32Array(capacityFor(prims.length)*STRIDE);
  const groups=[];let group=null;count=0;
  for(const p of prims){
   const texture=p.text?p.text.texture:p.texture;if(p.text&&!texture)continue;
   if(!group||(texture&&group.texture&&texture!==group.texture)){group={texture:null,start:count,count:0};groups.push(group);}
   if(texture)group.texture=texture;
   const uv=p.text?p.text.uv:p.uv,o=count*STRIDE,c=p.color,b=p.border,box=p.box,clip=p.clip;
   data.set([p.origin[0],p.origin[1],p.axisX[0],p.axisX[1],p.axisY[0],p.axisY[1],0,0,uv[0],uv[1],uv[2],uv[3],c[0],c[1],c[2],c[3],b[0],b[1],b[2],b[3],
    box[0],box[1],box[2],box[3],p.radius,p.width,p.mode,p.opacity,clip[0],clip[1],clip[2],clip[3]],o);
   group.count++;count++;
  }
  groups.forEach((g,i)=>{const r=runAt(i,g.count);r.buffer.array.set(data.subarray(g.start*STRIDE,(g.start+g.count)*STRIDE));
   r.buffer.clearUpdateRanges();r.buffer.addUpdateRange(0,g.count*STRIDE);r.buffer.needsUpdate=true;
   r.geometry.instanceCount=g.count;r.mesh.material.uniforms.uiTexture.value=g.texture??white;r.mesh.visible=g.count>0;});
  for(let i=groups.length;i<runs.length;i++)runs[i].mesh.visible=false;
  drawRuns=groups.length;lastRegions=prims.length;lastMs=performance.now()-started;rebuilds++;stale=false;
 }

 function clear(){
  for(const r of runs){scene.remove(r.mesh);r.geometry.dispose();r.mesh.material.dispose();}runs.length=0;
  for(const page of pages)page.texture.dispose();pages.length=0;slots.clear();
  for(const own of dedicated.values())own.texture.dispose();dedicated.clear();
  for(const texture of imageTextures.values())texture.dispose();imageTextures.clear();
  scratchTexture?.dispose();scratchTexture=null;count=drawRuns=wasted=0;width=height=0;stale=true;
 }
 return {
  // Drawing-buffer pixels the UI lays out against, and the CSS->device scale.
  target(){if(disposed||!available()||renderer.getContext().isContextLost())return null;renderer.getDrawingBufferSize(size);return {width:size.x,height:size.y,scale:renderer.getPixelRatio()};},
  draw(context){
   if(disposed||!available()||renderer.getContext().isContextLost())return {skipped:true,regions:0};
   renderer.getDrawingBufferSize(size);
   if(!atlasSize)atlasSize=Math.min(4096,renderer.capabilities?.maxTextureSize??2048);
   if(context.changed||stale||size.x!==width||size.y!==height){width=size.x;height=size.y;uiSize.set(width,height);rebuild(context);}
   if(count){
    const autoClear=renderer.autoClear,test=renderer.getScissorTest(),target=renderer.getRenderTarget();renderer.getViewport(viewport);
    try{renderer.autoClear=false;renderer.setRenderTarget(null);renderer.setScissorTest(false);renderer.setViewport(0,0,width/renderer.getPixelRatio(),height/renderer.getPixelRatio());renderer.render(scene,camera);draws++;}
    finally{renderer.setRenderTarget(target);renderer.setViewport(viewport);renderer.setScissorTest(test);renderer.autoClear=autoClear;}
   }
   return {skipped:false,regions:lastRegions,cpu_ms:lastMs};
  },
  contextLost(){clear();},
  clear,
  dispose(){if(disposed)return;clear();white.dispose();disposed=true;},
  metrics:()=>({backend:'three.js',quads:count,draw_calls:drawRuns,rebuilds,last_rebuild_ms:lastMs,text_rasters:rasters,atlas_uploads:uploads,atlas_compactions:compactions,
   atlas_pages:pages.length,atlas_page_size:atlasSize,text_slots:slots.size,dedicated_text_textures:dedicated.size,image_textures:imageTextures.size,submits:draws}),
 };
}

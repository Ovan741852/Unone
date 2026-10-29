import {PROJECTED_FRAGMENT_SHADER} from './projected-raster-shaders.js';
import {DRAW_COMPLETED,DRAW_SKIPPED} from '../shared/player-completion.mjs';
const VERTEX=`attribute float imageOpacity;
uniform mat3 imageTransform;
uniform vec2 imageFramebufferSize;
uniform int imagePixelSnap;
varying vec2 projectedUv;
varying vec4 projectedColor;
void main(){vec3 pixel=imageTransform*vec3(position.xy,1.0);if(imagePixelSnap==1)pixel.xy=sign(pixel.xy)*floor(abs(pixel.xy)+0.5);gl_Position=vec4(pixel.xy/imageFramebufferSize*2.0-1.0,0.0,1.0);projectedUv=uv;projectedColor=vec4(1.0,1.0,1.0,imageOpacity);}`;
const FRAGMENT='uniform vec4 imageClip;\n'+PROJECTED_FRAGMENT_SHADER.replace('void main(){','void main(){\n if(gl_FragCoord.x<imageClip.x||gl_FragCoord.y<imageClip.y||gl_FragCoord.x>=imageClip.z||gl_FragCoord.y>=imageClip.w)discard;');
const imageWidth=image=>image?.naturalWidth??image?.width,imageHeight=image=>image?.naturalHeight??image?.height;
function clipBox(instance,width,height){
 const r=instance.clip,left=r.x*width/100,bottom=r.y*height/100,right=(r.x+r.width)*width/100,top=(r.y+r.height)*height/100,
  x=Math.floor(left),y=height-Math.ceil(top);
 return {x,y,width:Math.ceil(right)-x,height:Math.ceil(top)-Math.floor(bottom),left,bottom,right,top};
}
function eligible(instance,width,height){
 const t=instance.transform,bounds=instance.definition.bounds,ox=instance.definition.originX,oy=instance.definition.originY,
  tx=t.a*ox+t.c*oy+t.tx,ty=t.b*ox+t.d*oy+t.ty;
 if(t.b!==0||t.c!==0||t.a<0||t.d<0||![t.a,t.d,tx,ty].every(n=>Number.isFinite(Math.fround(n))))return false;
 // Rebase geometry once and compose its origin in CPU f64. GPU coverage is
 // ordinary pixel-center triangle coverage (no per-quad AA seams or snapping).
 // Fall back only for transforms whose f32 admission would visibly quantize.
 const epsilon=2**-23,error=(extent,scale,translation)=>Math.abs(scale)*extent*epsilon+Math.abs(Math.fround(scale)-scale)*extent+Math.abs(Math.fround(translation)-translation)+(Math.abs(Math.fround(translation))+Math.abs(Math.fround(scale))*extent+Math.max(width,height))*epsilon;
 if(!Number.isFinite(Math.fround(bounds.width))||!Number.isFinite(Math.fround(bounds.height))||error(bounds.width,t.a*width/100,tx*width/100)>.01||error(bounds.height,t.d*height/100,ty*height/100)>.01)return false;
 return true;
}
export function createUiImageBatchPrefix(THREE,renderer,{enabled=true}={}){
 const scene=new THREE.Scene(),camera=new THREE.Camera(),resources=new Map(),images=new Map();
 let instances=new Map(),disposed=false,targetUnavailable=false,material=null,textureWrites=0,uploadedTextureWrites=0;
 const size=new THREE.Vector2(),viewport=new THREE.Vector4(),scissor=new THREE.Vector4();
 let geometryBuilds=0,geometryDisposes=0,geometryUpdates=0,materialBuilds=0,materialDisposes=0,textureBuilds=0,textureDisposes=0,meshBuilds=0,meshDisposes=0,draws=0,lastNodes=0,lastQuads=0,lastReason='empty';
 const freeGeometry=g=>{g.dispose();geometryDisposes++;},freeMaterial=m=>{m.dispose();materialDisposes++;},freeTexture=t=>{t.dispose();textureDisposes++;};
 const freeInstance=r=>{scene.remove(r.mesh);meshDisposes++;};
 const freeResource=r=>freeGeometry(r.geometry);
 function texture(image){
  const width=imageWidth(image),height=imageHeight(image);let entry=images.get(image);
  if(!entry){const value=new THREE.Texture(image);value.colorSpace=THREE.SRGBColorSpace;value.flipY=true;value.premultiplyAlpha=false;
   value.minFilter=value.magFilter=THREE.LinearFilter;value.generateMipmaps=false;entry={value,width,height};images.set(image,entry);textureBuilds++;value.needsUpdate=true;textureWrites++;}
  else if(entry.width!==width||entry.height!==height){entry.width=width;entry.height=height;entry.value.needsUpdate=true;textureWrites++;}
  return entry.value;
 }
 function sourceReady(instance,assets){
  const limit=renderer.capabilities?.maxTextureSize;if(!Number.isInteger(limit)||limit<1)return false;
  for(const need of instance.definition.requirements){const entry=assets.get(need.asset);if(entry?.state!=='ready'||!entry.image)return false;
   const w=imageWidth(entry.image),h=imageHeight(entry.image);if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0||w>limit||h>limit||need.maxX>w||need.maxY>h)return false;}
  return true;
 }
 const capacityFor=count=>2**Math.ceil(Math.log2(Math.max(1,count)));
 function allocate(data,capacity){
  const geometry=new THREE.BufferGeometry();geometryBuilds++;
  try{const buffer=new THREE.InterleavedBuffer(new Float32Array(capacity*24),6);buffer.setUsage(THREE.DynamicDrawUsage);
   geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(buffer,2,3));geometry.setAttribute('imageOpacity',new THREE.InterleavedBufferAttribute(buffer,1,5));
   const indices=new Uint32Array(capacity*6);for(let q=0;q<capacity;q++){const v=q*4,i=q*6;indices[i]=v;indices[i+1]=v+1;indices[i+2]=v+2;indices[i+3]=v;indices[i+4]=v+2;indices[i+5]=v+3;}
   geometry.setIndex(new THREE.BufferAttribute(indices,1));const old=data.geometry;data.geometry=geometry;data.buffer=buffer;data.capacity=capacity;data.shrinkFrames=0;if(old)freeGeometry(old);
  }catch(error){freeGeometry(geometry);throw error;}
 }
 function writeResource(data,definition,assets){
  const count=definition.quads.length;if(!data.geometry||data.capacity<count)allocate(data,capacityFor(count));
  const values=data.buffer.array,groups=data.geometry.groups,sources=[],byAsset=new Map(),ox=definition.originX,oy=definition.originY;
  for(const asset of definition.assets){const image=assets.get(asset).image,source={asset,image,width:imageWidth(image),height:imageHeight(image),texture:texture(image)};sources.push(source);byAsset.set(asset,source);}
  let offset=0,changed=false,groupCount=0,group=null;
  const value=n=>{n=Math.fround(n);if(values[offset]!==n){values[offset]=n;changed=true;}offset++;};
  const vertex=(x,y,u,v,a)=>{value(x);value(y);value(0);value(u);value(v);value(a);};
  for(let i=0;i<count;i++){
   const q=definition.quads[i],source=byAsset.get(q.asset),iw=source.width,ih=source.height,s=q.source,r=q.rect,
    u0=s?s.x/iw:0,u1=s?(s.x+s.width)/iw:1,v0=s?1-(s.y+s.height)/ih:0,v1=s?1-s.y/ih:1,alpha=q.opacity??1,x=r.x-ox,y=r.y-oy;
   vertex(x,y,u0,v0,alpha);vertex(x+r.width,y,u1,v0,alpha);vertex(x+r.width,y+r.height,u1,v1,alpha);vertex(x,y+r.height,u0,v1,alpha);
   if(!group||group.asset!==q.asset){group=groups[groupCount]??{};groups[groupCount++]=group;group.start=i*6;group.count=0;group.materialIndex=0;group.asset=q.asset;group.texture=source.texture;}group.count+=6;
  }
  groups.length=groupCount;data.geometry.setDrawRange(0,count*6);
  if(changed){data.buffer.clearUpdateRanges();data.buffer.addUpdateRange(0,count*24);data.buffer.needsUpdate=true;geometryUpdates++;}
  data.definition=definition;data.sources=sources;data.ox=ox;data.oy=oy;data.count=count;
 }
 function resource(instance,assets,activeTokens){
  const definition=instance.definition;let data=resources.get(definition.token);
  if(data&&data.sources.every(s=>{const image=assets.get(s.asset)?.image;return image===s.image&&imageWidth(image)===s.width&&imageHeight(image)===s.height;}))return data;
  if(!data){const candidate=instances.get(instance.node.id)?.data;
   // A generation can be shared by several instances. Reuse its storage only
   // after every selected instance has stopped referencing that generation.
   if(candidate&&!activeTokens.has(candidate.definition.token)){data=candidate;resources.delete(candidate.definition.token);}
   else data={geometry:null,capacity:0,shrinkFrames:0};
  }
  writeResource(data,definition,assets);resources.set(definition.token,data);return data;
 }
 function compact(activeTokens,assets){
  let capacity=0,used=0;for(const token of activeTokens){const data=resources.get(token);capacity+=data.capacity;used+=data.count;}
  const budget=Math.max(256,used*4);
  for(const token of activeTokens){const data=resources.get(token),target=capacityFor(data.count);
   data.shrinkFrames=data.capacity>Math.max(16,target*4)?data.shrinkFrames+1:0;
   if(data.capacity>target&&(capacity>budget||data.shrinkFrames>=60)){const old=data.capacity;allocate(data,target);writeResource(data,data.definition,assets);capacity+=target-old;}
  }
 }
 function sharedMaterial(){
  if(!material){material=new THREE.ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT,
   uniforms:{imageTransform:{value:null},imageFramebufferSize:{value:size},imagePixelSnap:{value:0},imageClip:{value:null},projectedTexture:{value:null},projectedEncodedMode:{value:1},projectedAlphaCutoff:{value:0},projectedAlphaStrict:{value:0},projectedEncodedSampling:{value:1},projectedRepeatAddress:{value:0},projectedSourceOver:{value:1},projectedLinearFiltering:{value:1}},
   side:THREE.DoubleSide,depthTest:false,depthWrite:false,transparent:false,toneMapped:false,blending:THREE.CustomBlending,
   blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor,premultipliedAlpha:false});materialBuilds++;}return material;
 }
 function makeInstance(data){
  const record={data,matrix:new THREE.Matrix3(),clip:new THREE.Vector4(),box:null},mesh=new THREE.Mesh(data.geometry,[sharedMaterial()]);record.mesh=mesh;meshBuilds++;mesh.frustumCulled=false;
  mesh.onBeforeRender=(_renderer,_scene,_camera,_geometry,m,group)=>{
   const b=record.box;renderer.setScissor(b.x/record.ratio,(record.height-b.y-b.height)/record.ratio,b.width/record.ratio,b.height/record.ratio);renderer.setScissorTest(true);
   m.uniforms.imageTransform.value=record.matrix;m.uniforms.imagePixelSnap.value=record.pixelSnap?1:0;m.uniforms.imageClip.value=record.clip;m.uniforms.projectedTexture.value=group.texture;
   // The pinned Three renderer uploads ShaderMaterial uniforms after each
   // onBeforeRender. Groups stay in authored order even with one material.
   m.uniformsNeedUpdate=true;
  };return record;
 }
 function sweep(activeTokens,activeImages){
  for(const [token,r]of resources)if(!activeTokens.has(token)){freeResource(r);resources.delete(token);}
  for(const [image,t]of images)if(!activeImages.has(image)){freeTexture(t.value);images.delete(image);}
 }
 function clear(){for(const r of instances.values())freeInstance(r);instances.clear();for(const r of resources.values())freeResource(r);resources.clear();for(const t of images.values())freeTexture(t.value);images.clear();if(material){freeMaterial(material);material=null;}lastNodes=lastQuads=0;}
 function drawPrefix(prefix,context){
  lastNodes=lastQuads=0;targetUnavailable=false;if(disposed)return 0;
  if(!prefix.length){clear();lastReason='empty';return 0;}
  if(!enabled||!renderer.getContext){lastReason='backend_unavailable';clear();return 0;}
  if(renderer.getContext().isContextLost()){targetUnavailable=true;lastReason='context_lost';clear();return 0;}
  renderer.getDrawingBufferSize(size);const {width,height}=context;
  if(size.x!==width||size.y!==height||renderer.getRenderTarget()!==null||renderer.outputColorSpace!==THREE.SRGBColorSpace){lastReason='target_pipeline';clear();return 0;}
  let count=0;const boxes=[];
  for(const p of prefix){const box=clipBox(p,width,height);if(!box||!eligible(p,width,height)){lastReason='canvas_coverage';break;}if(!sourceReady(p,context.images)){lastReason='images_pending_or_bounds';break;}boxes.push(box);count++;}
  if(!count){clear();return 0;}
  const activeTokens=new Set(),activeImages=new Set();for(let i=0;i<count;i++){const p=prefix[i];activeTokens.add(p.definition.token);for(const id of p.definition.assets)activeImages.add(context.images.get(id).image);}
  const staged=[],next=new Map(),selected=[];let rank=0;
  try{for(let i=0;i<count;i++)selected.push(resource(prefix[i],context.images,activeTokens));compact(activeTokens,context.images);
   for(let i=0;i<count;i++){
    const p=prefix[i],data=selected[i],old=instances.get(p.node.id),record=old??makeInstance(data);
    if(record!==old)staged.push(record);record.data=data;record.pixelSnap=p.pixelSnap===true;record.mesh.geometry=data.geometry;const t=p.transform;
    // Compose in physical framebuffer units before f32 upload. A normalized
    // stage->pixel round trip can move exact half-pixel camera ties.
    record.matrix.set(t.a*width/100,t.c*width/100,(t.a*data.ox+t.c*data.oy+t.tx)*width/100,t.b*height/100,t.d*height/100,(t.b*data.ox+t.d*data.oy+t.ty)*height/100,0,0,1);record.box=boxes[i];record.clip.set(record.box.left,record.box.bottom,record.box.right,record.box.top);record.height=height;record.ratio=renderer.getPixelRatio();
    record.mesh.renderOrder=rank++;record.mesh.visible=boxVisible(record.box);next.set(p.node.id,record);
   }
  }catch(error){for(const r of staged)freeInstance(r);throw error;}
  for(const [id,r]of instances)if(next.get(id)!==r)freeInstance(r);
  for(const r of staged)scene.add(r.mesh);instances=next;sweep(activeTokens,activeImages);
  const autoClear=renderer.autoClear,sort=renderer.sortObjects,test=renderer.getScissorTest(),gl=renderer.getContext(),upload=uploadedTextureWrites!==textureWrites,
   unpack=upload?[gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)]:null;
  renderer.getViewport(viewport);renderer.getScissor(scissor);
  try{renderer.autoClear=false;renderer.sortObjects=true;renderer.setViewport(0,0,width/renderer.getPixelRatio(),height/renderer.getPixelRatio());renderer.render(scene,camera);if(gl.isContextLost()){targetUnavailable=true;lastReason='context_lost';return 0;}uploadedTextureWrites=textureWrites;}
  finally{if(unpack){gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,unpack[0]);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,unpack[1]);}renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.sortObjects=sort;renderer.autoClear=autoClear;}
  draws++;lastNodes=count;for(let i=0;i<count;i++)lastQuads+=prefix[i].definition.quads.length;lastReason=count===prefix.length?'accelerated':lastReason;return count;
 }
 const boxVisible=b=>b.width>0&&b.height>0;
 return {drawPrefix,clear,completion:()=>targetUnavailable?DRAW_SKIPPED.ui_target_unavailable:DRAW_COMPLETED,dispose(){if(disposed)return;clear();disposed=true;},metrics:()=>({draws,prefix_nodes:lastNodes,prefix_quads:lastQuads,coverage:'pixel_center',fallback_reason:lastReason,
  geometry_builds:geometryBuilds,geometry_disposes:geometryDisposes,geometry_updates:geometryUpdates,live_geometries:geometryBuilds-geometryDisposes,buffer_capacity_quads:[...resources.values()].reduce((n,r)=>n+r.capacity,0),active_resource_quads:[...resources.values()].reduce((n,r)=>n+r.count,0),material_builds:materialBuilds,material_disposes:materialDisposes,live_materials:materialBuilds-materialDisposes,mesh_builds:meshBuilds,mesh_disposes:meshDisposes,live_meshes:meshBuilds-meshDisposes,texture_builds:textureBuilds,texture_disposes:textureDisposes,live_textures:textureBuilds-textureDisposes})};
}

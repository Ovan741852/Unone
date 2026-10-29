import {PROJECTED_FRAGMENT_SHADER} from './projected-raster-shaders.js';
import {DRAW_COMPLETED,DRAW_SKIPPED} from '../shared/player-completion.mjs';
const VERTEX=`attribute float imageOpacity;
uniform mat3 imageTransform;
varying vec2 projectedUv;
varying vec4 projectedColor;
void main(){vec3 stage=imageTransform*vec3(position.xy,1.0);gl_Position=vec4(stage.xy/50.0-1.0,0.0,1.0);projectedUv=uv;projectedColor=vec4(1.0,1.0,1.0,imageOpacity);}`;
const FRAGMENT='uniform vec4 imageClip;\n'+PROJECTED_FRAGMENT_SHADER.replace('void main(){','void main(){\n if(gl_FragCoord.x<imageClip.x||gl_FragCoord.y<imageClip.y||gl_FragCoord.x>=imageClip.z||gl_FragCoord.y>=imageClip.w)discard;');
const dimensions=image=>[image?.naturalWidth??image?.width,image?.naturalHeight??image?.height];
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
 const epsilon=2**-23,error=(extent,scale,translation)=>Math.abs(scale)*extent*epsilon+Math.abs(Math.fround(scale)-scale)*extent+Math.abs(Math.fround(translation)-translation)+(Math.abs(Math.fround(translation))+Math.abs(Math.fround(scale))*extent+50)*epsilon;
 if(!Number.isFinite(Math.fround(bounds.width))||!Number.isFinite(Math.fround(bounds.height))||error(bounds.width,t.a,tx)*width/100>.01||error(bounds.height,t.d,ty)*height/100>.01)return false;
 return true;
}
export function createUiImageBatchPrefix(THREE,renderer,{enabled=true}={}){
 const scene=new THREE.Scene(),camera=new THREE.Camera(),resources=new Map(),images=new Map();let instances=new Map(),disposed=false,targetUnavailable=false,uploadedTextureBuilds=0;
 const size=new THREE.Vector2(),viewport=new THREE.Vector4(),scissor=new THREE.Vector4();
 let geometryBuilds=0,geometryDisposes=0,materialBuilds=0,materialDisposes=0,textureBuilds=0,textureDisposes=0,draws=0,lastNodes=0,lastQuads=0,lastReason='empty';
 const freeGeometry=g=>{g.dispose();geometryDisposes++;},freeMaterial=m=>{m.dispose();materialDisposes++;},freeTexture=t=>{t.dispose();textureDisposes++;};
 const freeInstance=r=>{for(const mesh of r.meshes){scene.remove(mesh);freeMaterial(mesh.material);}};
 const freeResource=r=>{for(const run of r.runs)freeGeometry(run.geometry);};
 function texture(image){
  let value=images.get(image);if(!value){value=new THREE.Texture(image);value.colorSpace=THREE.SRGBColorSpace;value.flipY=true;value.premultiplyAlpha=false;
   value.minFilter=value.magFilter=THREE.LinearFilter;value.generateMipmaps=false;value.needsUpdate=true;images.set(image,value);textureBuilds++;}return value;
 }
 function sourceReady(instance,assets){
  const limit=renderer.capabilities?.maxTextureSize;if(!Number.isInteger(limit)||limit<1)return false;
  for(const need of instance.definition.requirements){const entry=assets.get(need.asset);if(entry?.state!=='ready'||!entry.image)return false;
   const [w,h]=dimensions(entry.image);if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0||w>limit||h>limit||need.maxX>w||need.maxY>h)return false;}
  return true;
 }
 function resource(instance,assets){
  const definition=instance.definition,old=resources.get(definition.token);
  if(old&&old.sources.every(s=>assets.get(s.asset)?.image===s.image))return old;
  const runs=[],sources=[],seen=new Set(),ox=definition.originX,oy=definition.originY;let vertices=[],indices=[],asset=null;
  function flush(){if(!vertices.length)return;const geometry=new THREE.BufferGeometry();geometryBuilds++;
   try{const buffer=new THREE.InterleavedBuffer(new Float32Array(vertices),6);geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));
    geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(buffer,2,3));geometry.setAttribute('imageOpacity',new THREE.InterleavedBufferAttribute(buffer,1,5));geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices),1));runs.push({asset,geometry});
   }catch(error){freeGeometry(geometry);throw error;}vertices=[];indices=[];
  }
  try{for(const q of definition.quads){
   if(asset!==q.asset){flush();asset=q.asset;}const image=assets.get(asset).image,[iw,ih]=dimensions(image),s=q.source??{x:0,y:0,width:iw,height:ih},r=q.rect,
    u0=s.x/iw,u1=(s.x+s.width)/iw,v0=1-(s.y+s.height)/ih,v1=1-s.y/ih,alpha=q.opacity??1,index=vertices.length/6;
   const x=r.x-ox,y=r.y-oy;vertices.push(x,y,0,u0,v0,alpha,x+r.width,y,0,u1,v0,alpha,x+r.width,y+r.height,0,u1,v1,alpha,x,y+r.height,0,u0,v1,alpha);
   indices.push(index,index+1,index+2,index,index+2,index+3);if(!seen.has(asset)){seen.add(asset);sources.push({asset,image});}
  }flush();}catch(error){for(const run of runs)freeGeometry(run.geometry);throw error;}
  const result={definition,runs,sources,ox,oy};resources.set(definition.token,result);if(old)freeResource(old);return result;
 }
 function makeInstance(instance,data,assets){
  const matrix=new THREE.Matrix3(),clip=new THREE.Vector4(),meshes=[];const record={data,matrix,clip,meshes,box:null};
  try{for(const run of data.runs){
   const material=new THREE.ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT,
    uniforms:{imageTransform:{value:matrix},imageClip:{value:clip},projectedTexture:{value:texture(assets.get(run.asset).image)},projectedEncodedMode:{value:1},projectedAlphaCutoff:{value:0},projectedAlphaStrict:{value:0},projectedEncodedSampling:{value:1},projectedRepeatAddress:{value:0},projectedSourceOver:{value:1},projectedLinearFiltering:{value:1}},
    side:THREE.DoubleSide,depthTest:false,depthWrite:false,transparent:false,toneMapped:false,blending:THREE.CustomBlending,
    blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor,premultipliedAlpha:false});materialBuilds++;
   let mesh;try{mesh=new THREE.Mesh(run.geometry,material);mesh.frustumCulled=false;mesh.onBeforeRender=()=>{const b=record.box;renderer.setScissor(b.x/record.ratio,(record.height-b.y-b.height)/record.ratio,b.width/record.ratio,b.height/record.ratio);renderer.setScissorTest(true);};meshes.push(mesh);}catch(error){freeMaterial(material);throw error;}
  }}catch(error){for(const mesh of meshes)freeMaterial(mesh.material);throw error;}return record;
 }
 function sweep(activeTokens,activeImages){
  for(const [token,r]of resources)if(!activeTokens.has(token)){freeResource(r);resources.delete(token);}
  for(const [image,t]of images)if(!activeImages.has(image)){freeTexture(t);images.delete(image);}
 }
 function clear(){for(const r of instances.values())freeInstance(r);instances.clear();for(const r of resources.values())freeResource(r);resources.clear();for(const t of images.values())freeTexture(t);images.clear();lastNodes=lastQuads=0;}
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
  const staged=[],next=new Map();let rank=0;
  try{for(let i=0;i<count;i++){
   const p=prefix[i],data=resource(p,context.images),old=instances.get(p.node.id),record=old?.data===data?old:makeInstance(p,data,context.images);
   if(record!==old)staged.push(record);const t=p.transform;record.matrix.set(t.a,t.c,t.a*data.ox+t.c*data.oy+t.tx,t.b,t.d,t.b*data.ox+t.d*data.oy+t.ty,0,0,1);record.box=boxes[i];record.clip.set(record.box.left,record.box.bottom,record.box.right,record.box.top);record.height=height;record.ratio=renderer.getPixelRatio();
   for(const mesh of record.meshes){mesh.renderOrder=rank++;mesh.visible=boxVisible(record.box);}next.set(p.node.id,record);
  }}catch(error){for(const r of staged)for(const mesh of r.meshes)freeMaterial(mesh.material);throw error;}
  for(const [id,r]of instances)if(next.get(id)!==r)freeInstance(r);
  for(const r of staged)for(const mesh of r.meshes)scene.add(mesh);instances=next;sweep(activeTokens,activeImages);
  const autoClear=renderer.autoClear,sort=renderer.sortObjects,test=renderer.getScissorTest(),gl=renderer.getContext(),upload=uploadedTextureBuilds!==textureBuilds,
   unpack=upload?[gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)]:null;
  renderer.getViewport(viewport);renderer.getScissor(scissor);
  try{renderer.autoClear=false;renderer.sortObjects=true;renderer.setViewport(0,0,width/renderer.getPixelRatio(),height/renderer.getPixelRatio());renderer.render(scene,camera);if(gl.isContextLost()){targetUnavailable=true;lastReason='context_lost';return 0;}uploadedTextureBuilds=textureBuilds;}
  finally{if(unpack){gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,unpack[0]);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,unpack[1]);}renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.sortObjects=sort;renderer.autoClear=autoClear;}
  draws++;lastNodes=count;lastQuads=prefix.slice(0,count).reduce((n,p)=>n+p.definition.quads.length,0);lastReason=count===prefix.length?'accelerated':lastReason;return count;
 }
 const boxVisible=b=>b.width>0&&b.height>0;
 return {drawPrefix,clear,completion:()=>targetUnavailable?DRAW_SKIPPED.ui_target_unavailable:DRAW_COMPLETED,dispose(){if(disposed)return;clear();disposed=true;},metrics:()=>({draws,prefix_nodes:lastNodes,prefix_quads:lastQuads,coverage:'pixel_center',fallback_reason:lastReason,
  geometry_builds:geometryBuilds,geometry_disposes:geometryDisposes,live_geometries:geometryBuilds-geometryDisposes,material_builds:materialBuilds,material_disposes:materialDisposes,live_materials:materialBuilds-materialDisposes,texture_builds:textureBuilds,texture_disposes:textureDisposes,live_textures:textureBuilds-textureDisposes})};
}

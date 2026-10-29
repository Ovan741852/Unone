// Canonical packed transport validation; renderer-specific resources stay in adapters.
import {isProjectedBase64} from './projected-base64.js';
const format='f32le-clip4-uv2-rgba4-u32-v1',utf8=new TextEncoder();
const invalid=m=>{throw Error(`PROJECTED_INVALID: ${m}`);};
const keys=new Set(['format','texture','order','depth_test','depth_write','scissor','color_mode','filter','sampling_space','address_mode','alpha_cutoff','alpha_compare','vertex_count','index_count','vertices','indices','revision']);
const decodeSrgb=n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
const encodeSrgb=n=>n<=.0031308?n*12.92:1.055*n**(1/2.4)-.055;
// Reference scalar output encoded for an sRGB surface; actual adapters run the same transfer in shaders.
export function projectedModulate(textureEncoded,vertexRgb,mode='linear'){
 if(!['linear','encoded'].includes(mode))invalid('color_mode');
 return mode==='encoded'?textureEncoded*vertexRgb:encodeSrgb(decodeSrgb(textureEncoded)*vertexRgb);
}
// RGBA8 top-left source, official bottom-left UV; returns encoded RGB and linear alpha.
export function projectedSampleRgba8(image,width,height,u,v,{filter='nearest',sampling_space='linear',address_mode='clamp'}={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||image.length!==width*height*4||![u,v].every(Number.isFinite)||!['linear','encoded'].includes(sampling_space)||!['nearest','linear'].includes(filter)||!['clamp','repeat'].includes(address_mode))invalid('sample reference arguments');
 const address=(n,size)=>address_mode==='repeat'?((n%size)+size)%size:Math.max(0,Math.min(size-1,n));
 const pixel=(x,y)=>{x=address(x,width);y=address(y,height);return Array.from(image.slice((y*width+x)*4,(y*width+x)*4+4),n=>n/255);};
 if(filter==='nearest')return pixel(Math.floor(u*width),Math.floor((1-v)*height));
 const x=u*width-.5,y=(1-v)*height-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
 const p=[pixel(x0,y0),pixel(x0+1,y0),pixel(x0,y0+1),pixel(x0+1,y0+1)];
 const weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
 return [0,1,2,3].map(c=>{const linear=c<3&&sampling_space==='linear';let value=0;for(let i=0;i<4;i++)value+=weights[i]*(linear?decodeSrgb(p[i][c]):p[i][c]);return linear?encodeSrgb(value):value;});
}
export function projectedScissor(scissor,width,height){
 const s=scissor??{x:0,y:0,width,height};
 const x=Math.min(s.x,width),y=Math.min(s.y,height),w=Math.min(s.x+s.width,width)-x,h=Math.min(s.y+s.height,height)-y;
 return w>0&&h>0?{x,y,width:w,height:h}:null;
}
function bytes(s){
 if(!isProjectedBase64(s))invalid('base64 payload');
 const raw=atob(s),b=new Uint8Array(raw.length);
 // atob produces byte code units; avoid allocating/calling an iterator callback per byte.
 for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);
 return b;
}
export function projectedGeometryData(d){
 const vb=bytes(d.vertices),ib=bytes(d.indices);
 if(vb.byteLength!==d.vertex_count*40||ib.byteLength!==d.index_count*4)invalid('exact byte counts');
 const v=new DataView(vb.buffer),ix=new DataView(ib.buffer);
 const vertices=new Float32Array(d.vertex_count*10),indices=new Uint32Array(d.index_count);
 for(let i=0;i<vertices.length;i++){
  const n=v.getFloat32(i*4,true),field=i%10;
  if(!Number.isFinite(n)||Math.abs(n)>1e9||(field===3&&n<=0)||(field>=6&&(n<0||n>1)))invalid('finite bounded clip/UV,positiveW,linearRGBA0..1');
  vertices[i]=n;
 }
 for(let i=0;i<indices.length;i++){indices[i]=ix.getUint32(i*4,true);if(indices[i]>=d.vertex_count)invalid('index range');}
 return {vertices,indices};
}
const revision=n=>(Number.isSafeInteger(n)&&n>0)||(typeof n==='string'&&/^[1-9][0-9]{0,19}$/.test(n)&&BigInt(n)<=18446744073709551615n);
function compareUtf8(a,b){const x=utf8.encode(a),y=utf8.encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;}
export function projectedEntries(snapshot){
 const batches=(snapshot?.world??snapshot)?.projected_geometry;
 if(batches===undefined||batches===null)return [];
 if(typeof batches!=='object'||Array.isArray(batches))invalid('batch map required');
 const entries=Object.entries(batches);if(entries.length>256)invalid('batch limit');let vertices=0,indices=0;
 for(const [id,d] of entries){
  if(!id||utf8.encode(id).length>128||!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!keys.has(k)))invalid('id/unknown fields');
  if(d.format!==format||typeof d.texture!=='string'||!d.texture||utf8.encode(d.texture).length>256)invalid('format/texture');
  if(!Number.isInteger(d.vertex_count)||d.vertex_count<3||d.vertex_count>262144||!Number.isInteger(d.index_count)||d.index_count<3||d.index_count>1572864||d.index_count%3)invalid('geometry counts');
  vertices+=d.vertex_count;indices+=d.index_count;if(vertices>1048576||indices>6291456)invalid('world geometry limit');
  if(!Number.isInteger(d.order)||d.order< -32768||d.order>32767||typeof d.depth_test!=='boolean'||typeof d.depth_write!=='boolean'||!revision(d.revision))invalid('order/depth/revision');
  if(d.color_mode!==undefined&&!['linear','encoded'].includes(d.color_mode))invalid('color_mode');
  if(d.filter!==undefined&&!['nearest','linear'].includes(d.filter))invalid('filter');
  if(d.sampling_space!==undefined&&!['linear','encoded'].includes(d.sampling_space))invalid('sampling_space');
  if(d.address_mode!==undefined&&!['clamp','repeat'].includes(d.address_mode))invalid('address_mode');
  if(d.alpha_cutoff!==undefined&&(typeof d.alpha_cutoff!=='number'||!Number.isFinite(d.alpha_cutoff)||d.alpha_cutoff<0||d.alpha_cutoff>1))invalid('alpha_cutoff');
  if(d.alpha_compare!==undefined&&!['greater_equal','greater'].includes(d.alpha_compare))invalid('alpha_compare');
  const s=d.scissor;if(s!==undefined&&(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['x','y','width','height'].includes(k))||![s.x,s.y,s.width,s.height].every(Number.isInteger)||s.x<0||s.y<0||s.width<=0||s.height<=0||s.x+s.width>32768||s.y+s.height>32768))invalid('physical pixel scissor rectangle');
  // Validate before any GPU mutation, including replacements with a stale revision.
  projectedGeometryData(d);
 }
 return entries.sort((a,b)=>a[1].order-b[1].order||compareUtf8(a[0],b[0]));
}
export function assertProjectedBackend(snapshot,backend){
 const world=snapshot?.world??snapshot;
 if(backend!=='webgl'&&world?.projected_frame!==undefined)throw Error(`PROJECTED_FRAME_BACKEND_UNSUPPORTED: ${backend}`);
 if(backend!=='webgl'&&(Object.keys(world?.projected_geometry??{}).length||world?.projected_world_visible===false))
  throw Error(`PROJECTED_BACKEND_UNSUPPORTED: ${backend} requires the official Three WebGL or native projected adapter`);
}

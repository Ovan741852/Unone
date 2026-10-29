import {FRAME_PROFILE,FRAME_PROFILES,frameInvalid,frameMaterial,frameNormalized,frameObject,frameSequence} from './projected-frame-material.mjs';
import {projectedGeometryData} from './projected-geometry.js';
const utf8=new TextEncoder(),format='f32le-clip4-uv2-rgba4-u32-v1';
export const PROJECTED_FRAME_DRAW_LIMIT=1024;
function geometry(d,profile){
 const data=projectedGeometryData(d),v=data.vertices,ix=data.indices,bits=new Uint32Array(v.buffer);
 for(let i=0;i<ix.length;i+=3){
  const first=ix[i]*10;
  for(let k=0;k<3;k++){
   const p=ix[i+k]*10;
   if(v[p+3]!==1||v[p+2]<0||v[p+2]>1)frameInvalid('indexed W1/Z0..1');
   if(d.clip_policy==='inside'&&(Math.abs(v[p])>1||Math.abs(v[p+1])>1))frameInvalid('inside clip bounds');
   if(profile===FRAME_PROFILE)for(let c=6;c<10;c++)if(bits[p+c]!==bits[first+c])frameInvalid('constant triangle RGBA bits');
  }
 }
 return data;
}
function draw(d,profile,geometryFor){
 frameObject(d,['id','texture','format','clip_policy','material','vertex_count','index_count','vertices','indices'],['scissor']);
 if(typeof d.id!=='string'||!d.id||utf8.encode(d.id).length>128||typeof d.texture!=='string'||!d.texture||utf8.encode(d.texture).length>256||d.format!==format)frameInvalid('id/texture/format');
 if(!['clip','inside'].includes(d.clip_policy)||!Number.isInteger(d.vertex_count)||d.vertex_count<3||d.vertex_count>262144||!Number.isInteger(d.index_count)||d.index_count<3||d.index_count>1572864||d.index_count%3)frameInvalid('geometry counts/policy');
 if(typeof d.vertices!=='string'||typeof d.indices!=='string'||d.vertices.length!==4*Math.ceil(d.vertex_count*40/3)||d.indices.length!==4*Math.ceil(d.index_count*4/3))frameInvalid('exact bounded base64 lengths');
 const s=d.scissor;
 if(s!==undefined){frameObject(s,['x','y','width','height']);
  if(![s.x,s.y,s.width,s.height].every(Number.isInteger)||s.x<0||s.y<0||s.width<1||s.height<1||s.x+s.width>32768||s.y+s.height>32768)frameInvalid('physical top-left scissor');}
 return {...d,scissor:s?{...s}:undefined,material:frameMaterial(d.material),data:geometryFor(d,profile)};
}
function decodeFrame(snapshot,geometryFor){
 const f=(snapshot?.world??snapshot)?.projected_frame;if(f===undefined)return null;
 frameObject(f,['profile','initial','draws','revision']);
 if(!FRAME_PROFILES.includes(f.profile))frameInvalid('profile');
 const rev=f.revision;
 if(!((Number.isSafeInteger(rev)&&rev>0)||(typeof rev==='string'&&/^[1-9][0-9]{0,19}$/.test(rev)&&BigInt(rev)<=18446744073709551615n)))frameInvalid('revision');
 frameObject(f.initial,['rgb8','depth']);const rgb=frameSequence(f.initial.rgb8,3);
 if(rgb.length!==3||!rgb.every(n=>Number.isInteger(n)&&n>=0&&n<=255))frameInvalid('rgb8');
 const draws=[],ids=new Set();let vertices=0,indices=0;
 for(const d of frameSequence(f.draws,PROJECTED_FRAME_DRAW_LIMIT)){
  vertices+=d?.vertex_count??0;indices+=d?.index_count??0;if(vertices>1048576||indices>6291456)frameInvalid('world budgets');
  const decoded=draw(d,f.profile,geometryFor);if(ids.has(d.id))frameInvalid('unique draw ids');ids.add(d.id);draws.push(decoded);
 }
 return {profile:f.profile,initial:{rgb8:[...rgb],depth:frameNormalized(f.initial.depth)},draws,revision:rev};
}
export function projectedFrame(snapshot){return decodeFrame(snapshot,geometry);}
// Presentation-owned decoder retained across draws. Geometry validation is a pure function of
// (vertices, indices, counts, clip_policy, profile), so identical content reuses validated arrays;
// every other field is revalidated on each call. Callers receive copies, so in-place edits of
// decoded arrays cannot alter retained bytes. Only the last accepted frame's content is retained,
// and a rejected frame leaves the previous generation unchanged.
export function createProjectedFrameDecoder(){
 let retained=new Map(),decodes=0,reuses=0;
 const find=(map,d,profile)=>map.get(d.vertices)?.find(r=>r.indices===d.indices&&r.vertex_count===d.vertex_count&&r.index_count===d.index_count&&r.clip_policy===d.clip_policy&&r.profile===profile);
 function decode(snapshot){
  const next=new Map();let built=0,found=0;
  const frame=decodeFrame(snapshot,(d,profile)=>{
   let r=find(next,d,profile)??find(retained,d,profile);
   if(r)found++;
   else{const data=geometry(d,profile);built++;
    r={indices:d.indices,vertex_count:d.vertex_count,index_count:d.index_count,clip_policy:d.clip_policy,profile,data};}
   if(!find(next,d,profile)){if(next.has(d.vertices))next.get(d.vertices).push(r);else next.set(d.vertices,[r]);}
   return {vertices:r.data.vertices.slice(),indices:r.data.indices.slice()};
  });
  // An absent frame publishes nothing and keeps the last accepted generation.
  if(frame){retained=next;decodes+=built;reuses+=found;}
  return frame;
 }
 return {decode,clear(){retained=new Map();},
  metrics:()=>({geometry_decodes:decodes,geometry_reuses:reuses,retained_geometries:[...retained.values()].reduce((n,rows)=>n+rows.length,0)})};
}

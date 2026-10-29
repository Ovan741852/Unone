// Neutral finite conformance inputs. Pixel positions here author only private test
// geometry at known sample centers; no game TL conversion or material rules live here.
const images={white:{width:1,height:1,rgba:[255,255,255,255]},gray:{width:1,height:1,rgba:[128,128,128,255]},
 alpha127:{width:1,height:1,rgba:[128,128,128,127]},
 corners:{width:2,height:2,rgba:[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]}};
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const grid=(lo,hi)=>{const result=[];for(let y=lo;y<=hi;y++)for(let x=lo;x<=hi;x++)result.push([x,y]);return result;};
const constant=value=>rect(0,0,1,1).map(()=>value.slice());
function shape(id,positions,options={}){
 return {id,positions,indices:[0,1,2,0,2,3],texture:'corners',uv:[[0,1],[1,1],[1,0],[0,0]],
  rgba:constant([1,1,1,1]),w:[1,1,1,1],z:.25,order:0,depth_test:true,depth_write:true,color_mode:'encoded',
  filter:'linear',sampling_space:'encoded',address_mode:'clamp',alpha_cutoff:0,...options};
}
function shared(diagonal,reverse,winding){
 const pairs=diagonal==='down'?[[0,1,2],[0,2,3]]:[[0,1,3],[1,2,3]];
 return {id:`shared-${diagonal}-${reverse}-${winding}`,points:grid(0,7),batches:pairs.map((indices,i)=>
  shape('triangle'+i,rect(1,1,5,5),{indices:winding?indices.slice().reverse():indices,texture:'white',
   rgba:constant(i?[0,1,0,1]:[1,0,0,1]),order:reverse?1-i:i}))};
}
function depths(){
 const result=[];
 for(let i=0;i<4;i++)result.push({id:'depth'+i,points:[[3,3]],batches:[
  shape('near',rect(1,1,5,5),{texture:'white',rgba:constant([1,0,0,1]),depth_write:!!(i&1)}),
  shape('far',rect(1,1,5,5),{texture:'white',rgba:constant([0,0,1,1]),z:.75,depth_test:!!(i&2),order:1})]});
 result.push({id:'discard-depth',points:[[3,3]],batches:[
  shape('far',rect(1,1,5,5),{texture:'white',rgba:constant([0,0,1,1]),z:.75}),
  shape('discard',rect(1,1,5,5),{texture:'white',rgba:constant([1,0,0,0]),z:.1,alpha_cutoff:.5,order:1})]});
 return result;
}
function materials(){
 const data=[['mod-linear','gray',{rgba:constant([128/255,128/255,128/255,1]),color_mode:'linear'}],
 ['mod-encoded','gray',{rgba:constant([128/255,128/255,128/255,1])}],
 ['sample-linear','corners',{color_mode:'linear',sampling_space:'linear'}],['sample-encoded','corners',{}],
 ['zero-survivor','white',{rgba:constant([1,0,0,0]),filter:'nearest'}],
 ['zero-discard','white',{rgba:constant([1,0,0,0]),filter:'nearest',alpha_compare:'greater'}],
 ['alpha-equal-pass','white',{rgba:constant([0,1,0,.5]),alpha_cutoff:.5,filter:'nearest'}],
 ['alpha-equal-discard','white',{rgba:constant([0,1,0,.5]),alpha_cutoff:.5,alpha_compare:'greater',filter:'nearest'}],
 ['gray-alpha-pass','alpha127',{alpha_cutoff:127/255,filter:'nearest'}],
 ['gray-alpha-discard','alpha127',{alpha_cutoff:128/255,filter:'nearest'}],
 ['repeat-seam','corners',{uv:constant([0,.25]),address_mode:'repeat'}]];
 const result=data.map(([id,texture,extra])=>({id,points:[[3,3]],batches:[shape(id,rect(1,1,5,5),{texture,uv:constant([.5,.5]),...extra})]}));
 result.push({id:'nearest-orientation',points:[[2,2],[5,2],[2,5],[5,5]],batches:[shape('orientation',rect(1,1,5,5),{filter:'nearest'})]});
 return result;
}
export function rasterProfileInputs(){
 const cases=[...[[2,2],[1.5,1.5],[2.25,2.25],[1.75,1.75]].map(([x,y],i)=>
  ({id:'boundary'+i,points:grid(0,7),batches:[shape('quad',rect(x,y,2,2))]})),
  ...['down','up'].flatMap(d=>[false,true].flatMap(r=>[false,true].map(w=>shared(d,r,w)))),
  {id:'slanted',points:grid(0,7),batches:[shape('triangle',[[1,1],[6,2],[2,6]],{indices:[0,1,2],texture:'white',uv:[[.5,.5],[.5,.5],[.5,.5]],rgba:constant([1,1,0,1]),w:[1,1,1]})]},
  {id:'perspective',points:[[2,2],[3,2],[4,4]],batches:[shape('gradient',rect(1,1,5,5),{w:[1,2,4,1],rgba:[[1,.2,.1,1],[.1,1,.2,1],[.2,.1,1,1],[.8,.7,.4,1]]})]},
  {id:'scissor',points:grid(0,7),batches:[shape('scissor',rect(1,1,5,5),{texture:'white',rgba:constant([1,0,0,1]),scissor:{x:2,y:2,width:1,height:1}})]},
  ...depths(),...materials()];
 return {images,cases};
}
const base64=bytes=>{let value='';for(const n of bytes)value+=String.fromCharCode(n);return btoa(value);};
export function packRasterProfileCase(input,width,height,revision){
 const projected_geometry={};
 for(const b of input.batches){
  const vertices=new ArrayBuffer(b.positions.length*40),v=new DataView(vertices);
  b.positions.forEach(([x,y],i)=>{const w=b.w[i],values=[(2*(x+.5)/width-1)*w,(1-2*(y+.5)/height)*w,b.z*w,w,...b.uv[i],...b.rgba[i]];
   values.forEach((n,j)=>v.setFloat32(i*40+j*4,n,true));});
  const indices=new ArrayBuffer(b.indices.length*4),ix=new DataView(indices);b.indices.forEach((n,i)=>ix.setUint32(i*4,n,true));
  const {id,positions,uv,rgba,w,z,indices:unused,...policy}=b;
  projected_geometry[id]={...policy,format:'f32le-clip4-uv2-rgba4-u32-v1',vertices:base64(new Uint8Array(vertices)),indices:base64(new Uint8Array(indices)),
   vertex_count:b.positions.length,index_count:b.indices.length,revision};
 }
 return {projected_world_visible:false,projected_geometry};
}

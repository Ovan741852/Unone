// Authored test inputs only. Expected pixels come from the independent Python reference.
export const BACKGROUND=[17,24,39];
export const IMAGES={
 white:{width:1,height:1,rgba:[255,255,255,255]},
 gray:{width:1,height:1,rgba:[128,128,128,255]},
 alpha127:{width:1,height:1,rgba:[128,128,128,127]},
 corners:{width:2,height:2,rgba:[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]}
};
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const points=(x0,y0,x1,y1)=>{const a=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)a.push([x,y]);return a;};
function shape(id,positions,options={}){
 return {id,positions,indices:[0,1,2,0,2,3],texture:'corners',uv:[[0,1],[1,1],[1,0],[0,0]],
  rgba:positions.map(()=>[1,1,1,1]),w:positions.map(()=>1),z:.25,order:0,depth_test:true,depth_write:true,
  color_mode:'encoded',filter:'linear',sampling_space:'encoded',address_mode:'clamp',alpha_cutoff:0,...options};
}
function tiny(name,x,y){return {id:name,description:`Original integer-center reference TL${x}..${x+2}; outside ring included`,
 batches:[shape('quad',rect(x,y,2,2))],points:points(98,98,104,104),region:[98,98,7,7]};}
function shared(name,diagonal,reverse,winding){
 const positions=rect(100,100,4,4),pairs=diagonal==='down'?[[0,1,2],[0,2,3]]:[[0,1,3],[1,2,3]];
 const batches=pairs.map((indices,i)=>shape(`tri${i}`,positions,{indices:winding?[...indices].reverse():indices,texture:'white',
  rgba:positions.map(()=>i?[0,1,0,1]:[1,0,0,1]),order:reverse?1-i:i}));
 return {id:name,description:`Shared ${diagonal} edge / ${reverse?'reverse':'forward'} draw order / ${winding?'CCW':'CW'}`,
  batches,points:points(99,99,105,105),region:[99,99,7,7]};
}
function alpha(){
 const data=[['gte-equal',.5,.5,'greater_equal',[0,1,0]],['greater-equal',.5,.5,'greater',[1,0,0]],
 ['greater-above',.75,.5,'greater',[0,0,1]],['greater-below',.25,.5,'greater',[1,0,0]],
 ['gte-zero',0,0,'greater_equal',[1,0,0]],['greater-zero',0,0,'greater',[0,1,0]],
 ['gte-one',1,1,'greater_equal',[1,1,0]],['greater-one',1,1,'greater',[1,1,0]]];
 return {id:'alpha8',description:'Existing r3 exact alpha1 texel × binary vertex alpha; includes alpha0 survivor marker',
  batches:data.map(([id,a,cutoff,compare,c],i)=>shape(id,rect(8+i%4*160,8+Math.floor(i/4)*180,120,120),
   {texture:'white',rgba:rect(0,0,1,1).map(()=>[...c,a]),filter:'nearest',alpha_cutoff:cutoff,alpha_compare:compare})),
  points:data.map((_,i)=>[68+i%4*160,68+Math.floor(i/4)*180]),region:[8,8,620,300]};
}
function materials(){
 const add=(id,texture,x,y,extra={})=>shape(id,rect(x,y,120,120),{texture,uv:rect(0,0,1,1).map(()=>[.5,.5]),color_mode:'linear',filter:'nearest',sampling_space:'linear',alpha_cutoff:.05,...extra});
 const batches=[add('mod-linear','gray',8,8,{rgba:rect(0,0,1,1).map(()=>[128/255,128/255,128/255,1])}),
  add('mod-encoded','gray',168,8,{rgba:rect(0,0,1,1).map(()=>[128/255,128/255,128/255,1]),color_mode:'encoded'}),
  add('sample-linear','corners',328,8,{filter:'linear',alpha_cutoff:0}),
  add('sample-encoded','corners',488,8,{filter:'linear',sampling_space:'encoded',alpha_cutoff:0}),
  add('alpha-retain','alpha127',8,188,{alpha_cutoff:127/255}),add('alpha-discard','alpha127',168,188,{alpha_cutoff:128/255}),
  add('nearest-uv','corners',328,188,{uv:[[0,1],[1,1],[1,0],[0,0]],sampling_space:'encoded',alpha_cutoff:0}),
  add('repeat-seam','corners',488,188,{uv:rect(0,0,1,1).map(()=>[0,.25]),filter:'linear',sampling_space:'encoded',address_mode:'repeat',alpha_cutoff:0})];
 return {id:'material11',description:'Existing default material11 fixed goldens; AAfalse profile, no change to expected ±1',batches,
  points:[[68,68],[228,68],[388,68],[548,68],[68,248],[228,248],[358,218],[418,218],[358,278],[418,278],[548,248]],region:[8,8,620,300]};
}
function depth(){
 const batches=[],samples=[];
 for(let i=0;i<4;i++){
  const x=8+i*160;for(const [n,z,c] of [[0,.25,[1,0,0,1]],[1,.75,[0,0,1,1]]])
   batches.push(shape(`depth${i}-${n}`,rect(x,8,120,120),{texture:'white',rgba:rect(0,0,1,1).map(()=>c),
    z,order:n,depth_write:n===0?!!(i&1):true,depth_test:n===1?!!(i&2):true}));samples.push([x+60,68]);
 }
 batches.push(shape('behind',rect(8,188,120,120),{texture:'white',rgba:rect(0,0,1,1).map(()=>[0,0,1,1]),z:.75,order:2}));
 batches.push(shape('discard-front',rect(8,188,120,120),{texture:'white',rgba:rect(0,0,1,1).map(()=>[1,0,0,0]),z:.1,alpha_cutoff:.5,order:3}));
 return {id:'depth',description:'First near depth_write × second far depth_test four combinations, then discarded front',batches,points:[...samples,[68,248]],region:[8,8,620,300]};
}
export function authoredCases(){
 const gradient=shape('perspective',rect(200,100,120,80),{w:[1,2,4,1],rgba:[[1,.2,.1,1],[.1,1,.2,1],[.2,.1,1,1],[.8,.7,.4,1]]});
 const scissor=shape('clip',rect(98,98,8,8),{texture:'white',rgba:rect(0,0,1,1).map(()=>[1,0,0,1]),scissor:{x:100,y:100,width:1,height:1}});
 return [tiny('integer',100,100),tiny('interior',99.5,99.5),tiny('fractional-positive',100.25,100.25),tiny('fractional-negative',99.75,99.75),
  ...['down','up'].flatMap(d=>[false,true].flatMap(r=>[false,true].map(w=>shared(`shared-${d}-${r?'reverse':'forward'}-${w?'ccw':'cw'}`,d,r,w)))),
  {id:'slanted',description:'Non-axis edge coverage; original top-left half-plane reference',batches:[shape('triangle',[[100,100],[106,102],[101,107]],
   {indices:[0,1,2],uv:[[.5,.5],[.5,.5],[.5,.5]],texture:'white',rgba:[[1,1,0,1],[1,1,0,1],[1,1,0,1]],w:[1,1,1]})],points:points(99,99,108,109),region:[99,99,10,11]},
  {id:'gradients',description:'Unequal clipW with perspective UV and RGBA; interpolation stays source-owned',batches:[gradient],points:[[220,110],[230,120],[260,140],[290,160]],region:[200,100,120,80]},
  {id:'scissor',description:'Physical 1pixel top-left scissor; outside ring and empty intersection',batches:[scissor,
   {...scissor,id:'empty',order:1,scissor:{x:32760,y:32760,width:1,height:1}}],points:points(98,98,104,104),region:[98,98,7,7]},
  {id:'empty',description:'Remove last batch; must preserve cleared background, no previous coverage',batches:[],points:points(99,99,103,103),region:[99,99,5,5]},
  alpha(),materials(),depth()];
}
function base64(bytes){let text='';for(const n of bytes)text+=String.fromCharCode(n);return btoa(text);}
export function packCase(input,width,height,revision=1){
 const projected_geometry={};
 for(const b of input.batches){
  const vertices=new ArrayBuffer(b.positions.length*40),v=new DataView(vertices);
  for(let i=0;i<b.positions.length;i++){
   const [x,y]=b.positions[i],w=b.w[i],values=[(2*(x+.5)/width-1)*w,(1-2*(y+.5)/height)*w,b.z*w,w,...b.uv[i],...b.rgba[i]];
   values.forEach((n,j)=>v.setFloat32(i*40+j*4,n,true));
  }
  const indices=new ArrayBuffer(b.indices.length*4),ix=new DataView(indices);b.indices.forEach((n,j)=>ix.setUint32(j*4,n,true));
  const {positions,indices:unused,rgba,w,z,uv,id,...policy}=b;
  projected_geometry[id]={...policy,format:'f32le-clip4-uv2-rgba4-u32-v1',vertex_count:b.positions.length,index_count:b.indices.length,
   vertices:base64(new Uint8Array(vertices)),indices:base64(new Uint8Array(indices)),revision};
 }
 return {projected_world_visible:false,projected_geometry};
}

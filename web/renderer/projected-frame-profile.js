import {rasterProfileInputs,packRasterProfileCase} from './projected-raster-profile.js';
import {RASTER_PROFILE} from './projected-raster-profile-expected.js';
import {FRAME_PROFILE} from '../shared/projected-frame-material.mjs';
const compares=['never','less','equal','less_equal','greater','not_equal','greater_equal','always'];
export const FRAME_IMAGES={white:{width:1,height:1,rgba:[255,255,255,255]},
 tint:{width:1,height:1,rgba:[200,100,50,255]},zero:{width:1,height:1,rgba:[200,100,50,0]},
 corners:{width:2,height:2,rgba:[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]}};
const material=()=>({rgb:'texture_times_vertex',texture_alpha:'sampled',alpha:'texture_times_vertex',
 alpha_test:{enabled:false,compare:'greater',reference:0},blend:{enabled:false,operation:'add',source:'source_alpha',destination:'one_minus_source_alpha'},
 depth:{test:true,write:false,compare:'less_equal'},sampler:{min:'nearest',mag:'nearest',address_u:'clamp',address_v:'clamp'}});
const encode=b=>{let s='';for(const n of b)s+=String.fromCharCode(n);return btoa(s);};
function fullDraw(id,options={}){
 const m=material();for(const [k,value] of Object.entries(options.material??{}))m[k]=typeof value==='object'?{...m[k],...value}:value;
 return {id,texture:'white',rgba:[1,0,0,1],z:.5,uv:[.25,.75],...options,material:m};
}
export function packFrameDraw(d){
 const b=new ArrayBuffer(120),v=new DataView(b);[[-1,-1],[3,-1],[-1,3]].forEach(([x,y],i)=>{
  [x,y,d.z,1,...d.uv,...d.rgba].forEach((n,k)=>v.setFloat32(i*40+k*4,n,true));});
 return {id:d.id,texture:d.texture,format:'f32le-clip4-uv2-rgba4-u32-v1',clip_policy:'clip',material:d.material,
  vertices:encode(new Uint8Array(b)),indices:'AAAAAAEAAAACAAAA',vertex_count:3,index_count:3};
}
function scalarCases(){
 const bg=[20,40,60],results=[{id:'initial',draws:[],rgb:bg,depth:.5}];
 const equality=[false,false,true,true,false,false,true,true];
 compares.forEach((compare,i)=>{
  results.push({id:'alpha-'+compare,draws:[fullDraw('a',{rgba:[1,0,0,.5],material:{...material(),alpha_test:{enabled:true,compare,reference:.5}}})],rgb:equality[i]?[255,0,0]:bg});
  results.push({id:'depth-'+compare,depth:.5,draws:[fullDraw('z',{material:{...material(),depth:{test:true,write:false,compare}}})],rgb:equality[i]?[255,0,0]:bg});
 });
 for(const [alpha,pass] of [['texture',true],['vertex',false],['texture_times_vertex',false]])
  results.push({id:'alpha-source-'+alpha,draws:[fullDraw('source',{texture:'tint',rgba:[1,1,1,.25],material:{...material(),alpha,alpha_test:{enabled:true,compare:'greater',reference:.5}}})],rgb:pass?[200,100,50]:bg});
 results.push({id:'format-absent',draws:[fullDraw('absent',{texture:'zero',rgba:[1,1,1,.25],material:{...material(),texture_alpha:'one',alpha:'texture',alpha_test:{enabled:true,compare:'greater',reference:.5}}})],rgb:[200,100,50]});
 for(const [destination,rgb] of [['one_minus_source_alpha',[110,70,55]],['one',[120,90,85]]])
  results.push({id:'blend-'+destination,draws:[fullDraw('blend',{texture:'tint',rgba:[1,1,1,.5],material:{...material(),alpha:'vertex',blend:{enabled:true,operation:'add',source:'source_alpha',destination}}})],rgb});
 results.push({id:'alpha-zero-rgb',draws:[fullDraw('zero',{texture:'zero',rgba:[1,1,1,1]})],rgb:[200,100,50]});
 results.push({id:'discard-no-depth',draws:[fullDraw('discard',{rgba:[1,0,0,0],z:.1,material:{...material(),alpha_test:{enabled:true,compare:'greater',reference:0},depth:{test:true,write:true,compare:'less'}}}),fullDraw('far',{rgba:[0,0,1,1],z:.75})],rgb:[0,0,255]});
 const add=fullDraw('add',{rgba:[1,1,1,1],material:{...material(),blend:{enabled:true,operation:'add',source:'source_alpha',destination:'one'}}});
 const over=fullDraw('over',{rgba:[0,0,0,.5],material:{...material(),blend:{enabled:true,operation:'add',source:'source_alpha',destination:'one_minus_source_alpha'}}});
 results.push({id:'ordered-clamp',initial:[200,50,25],draws:[add,over],rgb:[128,128,128]});
 results.push({id:'reversed-clamp',initial:[200,50,25],draws:[over,add],rgb:[255,255,255]});
 for(const [uv,rgb] of [[[.25,.75],[255,0,0]],[[.75,.75],[0,255,0]],[[.25,.25],[0,0,255]],[[.75,.25],[255,255,255]]])
  results.push({id:'orientation-'+uv.join('-'),draws:[fullDraw('uv',{texture:'corners',rgba:[1,1,1,1],uv})],rgb});
 results.push({id:'mag-linear-min-nearest',draws:[fullDraw('mag',{texture:'corners',rgba:[1,1,1,1],uv:[.5,.5],material:{...material(),sampler:{min:'nearest',mag:'linear',address_u:'clamp',address_v:'clamp'}}})],rgb:[128,128,128]});
 results.push({id:'address-u-repeat-v-clamp',draws:[fullDraw('uv',{texture:'corners',rgba:[1,1,1,1],uv:[1.25,1.25],material:{...material(),sampler:{min:'nearest',mag:'nearest',address_u:'repeat',address_v:'clamp'}}})],rgb:[255,0,0]});
 return results.map(c=>({...c,initial:c.initial??bg,depth:c.depth??1}));
}
export function frameProfileCases(width,height){
 const raster=rasterProfileInputs();
 const shapes=raster.cases.filter(c=>c.id.startsWith('boundary')||c.id.startsWith('shared-')||['slanted','scissor'].includes(c.id));
 const cases=shapes.map((c,i)=>{
  const old=packRasterProfileCase(c,width,height,i+1).projected_geometry;
  const draws=Object.entries(old).sort((a,b)=>a[1].order-b[1].order).map(([id,d])=>({id,texture:d.texture,format:d.format,vertices:d.vertices,indices:d.indices,
   vertex_count:d.vertex_count,index_count:d.index_count,clip_policy:'clip',...(d.scissor?{scissor:d.scissor}:{}),
   material:{...material(),depth:{test:d.depth_test,write:d.depth_write,compare:'less'},sampler:{min:d.filter,mag:d.filter,address_u:d.address_mode,address_v:d.address_mode}}}));
  return {id:c.id,frame:{profile:FRAME_PROFILE,revision:i+1,initial:{rgb8:[17,24,39],depth:1},draws},expected:RASTER_PROFILE.expected[c.id].map(r=>({point:r.point,rgb:r.rgb}))};
 });
 for(const c of scalarCases())cases.push({id:c.id,frame:{profile:FRAME_PROFILE,revision:cases.length+1,initial:{rgb8:c.initial,depth:c.depth},draws:c.draws.map(packFrameDraw)},
  expected:[[0,0],[width-1,0],[0,height-1],[width-1,height-1]].map(point=>({point,rgb:c.rgb}))});
 return cases;
}
export const FRAME_CONFORMANCE={version:'rgb8_encoded_rebuild_v1-neutral-1',hash:'af17bacdb1c96f48081f3a83e93d05d6376c99b1924bb5bbecfd6310b53faff1',
 limitations:'encoded RGBA8/depth32float reference; complete known initial destination rebuilt each redraw; worldhidden; opaque/cutout/RGB source-alpha blend; original precision/dither/backdrop unclosed'};

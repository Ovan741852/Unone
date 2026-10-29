import {packFrameDraw} from './projected-frame-profile.js';
export const GOURAUD_FRAME_PROFILE='rgb8_encoded_gouraud_v1';
const rgba=[[1,0,0,.25],[0,1,0,.75],[0,0,1,1]],initial=[20,40,60];
const material=()=>({rgb:'texture_times_vertex',texture_alpha:'sampled',alpha:'texture_times_vertex',
 alpha_test:{enabled:false,compare:'greater',reference:.55},
 blend:{enabled:false,operation:'add',source:'source_alpha',destination:'one_minus_source_alpha'},
 depth:{test:true,write:false,compare:'less_equal'},
 sampler:{min:'nearest',mag:'nearest',address_u:'clamp',address_v:'clamp'}});
function pack(id,m){
 const d=packFrameDraw({id,texture:'white',rgba:[1,1,1,1],z:.25,uv:[.5,.5],material:m});
 const bytes=Uint8Array.from(atob(d.vertices),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
 rgba.forEach((color,i)=>color.forEach((value,c)=>view.setFloat32(i*40+24+c*4,value,true)));
 let encoded='';for(const value of bytes)encoded+=String.fromCharCode(value);d.vertices=btoa(encoded);return d;
}
function expected(point,width,height,mode){
 // Independent barycentric equation for fixed clip vertices(-1,-1),(3,-1),(-1,3).
 const [x,y]=point,u=(x+.5)/(2*width),v=(height-y-.5)/(2*height),w=1-u-v;
 const alpha=.25*w+.75*u+v,rgb=[w,u,v];
 if(mode==='alpha-test'&&!(alpha>.55))return initial;
 if(mode==='blend-over'||mode==='blend-add')
  return rgb.map((value,c)=>Math.round(Math.min(1,value*alpha+initial[c]/255*(mode==='blend-add'?1:1-alpha))*255));
 return rgb.map(value=>Math.round(value*255));
}
export function gouraudFrameCases(width,height){
 const points=[[0,0],[width-1,0],[0,height-1],[width-1,height-1],
  [Math.floor(width/4),Math.floor(height/4)],[Math.floor(width*3/4),Math.floor(height/4)],
  [Math.floor(width/4),Math.floor(height*3/4)],[Math.floor(width*3/4),Math.floor(height*3/4)]];
 return ['rgb-alpha-gradient','alpha-test','blend-over','blend-add'].map((mode,i)=>{
  const m=material();if(mode==='alpha-test')m.alpha_test.enabled=true;
  if(mode.startsWith('blend')){m.blend.enabled=true;if(mode==='blend-add')m.blend.destination='one';}
  return {id:'gouraud-'+mode,frame:{profile:GOURAUD_FRAME_PROFILE,revision:1000+i,
   initial:{rgb8:initial,depth:1},draws:[pack(mode,m)]},
   expected:points.map(point=>({point,rgb:expected(point,width,height,mode)}))};
 });
}
export const GOURAUD_CONFORMANCE={version:'rgb8_encoded_gouraud_v1-neutral-1',
 hash:'213716a2541df755f78c7742d8eb713c50c42ad81ef78d18ac007f5d51ba5e6b',
 scope:'four fixed vertex RGB/alpha interpolation, alpha admission and RGB blend cases, 32 actual GPU samples; legacy checks retained',
 tolerance_rgb8:1};

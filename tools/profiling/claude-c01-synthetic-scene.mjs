// Synthetic, game-independent projected-frame producers for profiling.
// Content is generated from a local seeded LCG; no engine clock or RNG is used.
import {Buffer} from 'node:buffer';
const MATERIAL={rgb:'texture_times_vertex',texture_alpha:'sampled',alpha:'texture_times_vertex',
 alpha_test:{enabled:true,compare:'greater_equal',reference:0.5},
 blend:{enabled:false,operation:'add',source:'source_alpha',destination:'one_minus_source_alpha'},
 depth:{test:true,write:true,compare:'less_equal'},
 sampler:{min:'nearest',mag:'nearest',address_u:'clamp',address_v:'clamp'}};
export function lcg(seed){let s=seed>>>0;return ()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}
// Each triangle owns three vertices with constant RGBA, valid for both frame profiles.
export function triangleSoup(triangles,rand,{phase=0}={}){
 const v=Buffer.alloc(triangles*3*40),ix=Buffer.alloc(triangles*3*4);
 for(let t=0;t<triangles;t++){
  const cx=rand()*1.8-.9,cy=rand()*1.8-.9,z=rand(),r=.02+rand()*.05,rgba=[rand(),rand(),rand(),1];
  for(let k=0;k<3;k++){
   const a=phase+k*2.0943951,o=(t*3+k)*40;
   v.writeFloatLE(cx+Math.cos(a)*r,o);v.writeFloatLE(cy+Math.sin(a)*r,o+4);v.writeFloatLE(z,o+8);v.writeFloatLE(1,o+12);
   v.writeFloatLE(k===1?1:0,o+16);v.writeFloatLE(k===2?1:0,o+20);
   for(let c=0;c<4;c++)v.writeFloatLE(rgba[c],o+24+c*4);
   ix.writeUInt32LE(t*3+k,(t*3+k)*4);
  }
 }
 return {vertices:v.toString('base64'),indices:ix.toString('base64'),vertex_count:triangles*3,index_count:triangles*3,raw_bytes:v.length+ix.length};
}
function draw(id,texture,soup,material=MATERIAL,scissor){
 const {raw_bytes,...g}=soup;
 return {id,texture,format:'f32le-clip4-uv2-rgba4-u32-v1',clip_policy:'clip',material:structuredClone(material),...g,...(scissor?{scissor}:{})};
}
// Scenario definitions. `period` = updates between periodic replacements (terrain).
export const SCENARIOS={
 // Ordinary level-sized frame: ~33 draws, ~500KB raw geometry.
 level33:{draws:[{kind:'terrain',count:1,triangles:2400,period:10},{kind:'static',count:28,triangles:40},{kind:'dynamic',count:4,triangles:60}]},
 // Draw-count capacity: ~620 draws, small geometry each.
 capacity620:{draws:[{kind:'terrain',count:1,triangles:2400,period:10},{kind:'static',count:611,triangles:8},{kind:'dynamic',count:8,triangles:8}]}
};
export function createSyntheticProducer(name,{seed=1,textures=['white','atlas']}={}){
 const spec=SCENARIOS[name];if(!spec)throw Error('SYNTHETIC_SCENARIO_UNKNOWN: '+name);
 const rows=[];let serial=0;
 for(const group of spec.draws)for(let i=0;i<group.count;i++){
  const id=`${group.kind}-${i}`,rand=lcg(seed*7919+serial++),texture=textures[rows.length%textures.length];
  // Same texture under two samplers exercises per-sampler texture variants.
  const material=structuredClone(MATERIAL);if(rows.length%5===1)material.sampler={min:'linear',mag:'linear',address_u:'repeat',address_v:'clamp'};
  if(group.kind==='dynamic'){material.blend.enabled=true;material.depth.write=false;}
  const scissor=group.kind==='dynamic'&&i===0?{x:16,y:16,width:640,height:360}:undefined;
  rows.push({id,group,texture,material,scissor,seed:seed*104729+rows.length,soup:triangleSoup(group.triangles,rand)});
 }
 let revision=0;
 function regenerate(row,step){row.soup=triangleSoup(row.group.triangles,lcg(row.seed+step*31),{phase:step*.01});}
 return {
  name,rawBytes:()=>rows.reduce((n,r)=>n+r.soup.raw_bytes,0),drawCount:rows.length,
  // One independent update: dynamic draws change every update, terrain every `period`.
  step(){
   revision++;const changed=[];
   for(const row of rows){
    if(row.group.kind==='dynamic'||(row.group.period&&revision>1&&revision%row.group.period===0)){regenerate(row,revision);changed.push(row.id);}
   }
   const frame={profile:'rgb8_encoded_rebuild_v1',revision,initial:{rgb8:[20,40,60],depth:1},
    draws:rows.map(r=>draw(r.id,r.texture,r.soup,r.material,r.scissor))};
   return {snapshot:{world:{frame:revision,projected_world_visible:false,projected_frame:frame,entities:{}}},changed};
  }};
}

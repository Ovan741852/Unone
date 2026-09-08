// Presentation only: immutable simulation snapshots and their digest are untouched.
const clamp=x=>Math.max(0,Math.min(1,x));
const lerp=(a,b,t)=>a+(b-a)*t;
function vec(a,b,t){return {x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:lerp(a.z,b.z,t)};}
function angle(a,b,t){let delta=(b-a)%(2*Math.PI);if(delta>Math.PI)delta-=2*Math.PI;if(delta< -Math.PI)delta+=2*Math.PI;return a+delta*t;}
function transform(a,b,t){return {position:vec(a.position,b.position,t),scale:vec(a.scale,b.scale,t),rotation:{x:angle(a.rotation.x,b.rotation.x,t),y:angle(a.rotation.y,b.rotation.y,t),z:angle(a.rotation.z,b.rotation.z,t)}};}
export function createPresentationInterpolator({enabled=false,instanceBatches=[],now=()=>performance.now()}={}){
 const entities=new Map(),batches=new Map(),selected=new Set(instanceBatches);let latest=null,serial=0,metrics={interpolated_entities:0,interpolated_instances:0,snaps:0};
 function state(map,id,key,value,frame,at){let s=map.get(id);if(s?.key===key)return s;const duration=s?Math.min(250,Math.max(1000/60,(frame-s.frame)*1000/60)):1000/60;s={previous:s?.current??value,current:value,key,frame,at,duration};map.set(id,s);return s;}
 return {reset(){entities.clear();batches.clear();latest=null;metrics.snaps++;},accept(snapshot,memory){latest=snapshot;if(!enabled)return;const frame=snapshot.world.frame,at=now();
  for(const [id,e]of Object.entries(snapshot.world.entities??{}))if(e.transform3d)state(entities,id,JSON.stringify(e.transform3d),structuredClone(e.transform3d),frame,at);
  for(const id of entities.keys())if(!snapshot.world.entities[id])entities.delete(id);
  for(const [id,b]of Object.entries(snapshot.world.instances3d??{}))if(selected.has(id)&&b.memory){
   const key=b.asset+'|'+b.count+'|'+b.memory.revision,old=batches.get(id);if(old?.key===key)continue;
   if(old&&(old.asset!==b.asset||old.count!==b.count)){batches.delete(id);metrics.snaps++;}
   const source=memory(b),value=new Float32Array(source.slice(b.memory.offset,b.memory.offset+b.memory.byte_length));const s=state(batches,id,key,value,frame,at);s.asset=b.asset;s.count=b.count;s.output??=new Float32Array(value.length);
  }
  for(const id of batches.keys())if(!snapshot.world.instances3d?.[id])batches.delete(id);
 },sample({snap=false}={}){
  if(!latest||!enabled||snap)return {snapshot:latest,memory:null};const at=now(),world={...latest.world,entities:{...latest.world.entities},instances3d:{...latest.world.instances3d}};metrics.interpolated_entities=0;metrics.interpolated_instances=0;
  for(const [id,s]of entities){const t=clamp((at-s.at)/s.duration);world.entities[id]={...world.entities[id],transform3d:transform(s.previous,s.current,t)};metrics.interpolated_entities++;}
  for(const [id,s]of batches){const t=clamp((at-s.at)/s.duration),a=s.previous,b=s.current,o=s.output;
   for(let i=0;i<b.length;i+=10){for(let j=0;j<10;j++){if(j<3||j>6)o[i+j]=lerp(a[i+j],b[i+j],t);}let dot=0;for(let j=3;j<7;j++)dot+=a[i+j]*b[i+j];let length=0;for(let j=3;j<7;j++){o[i+j]=lerp(a[i+j],dot<0?-b[i+j]:b[i+j],t);length+=o[i+j]**2;}length=Math.sqrt(length);for(let j=3;j<7;j++)o[i+j]=length>1e-8?o[i+j]/length:b[i+j];}
   world.instances3d[id]={...world.instances3d[id],presentation_revision:++serial,memory:{...world.instances3d[id].memory,offset:0,buffer_id:id,revision:String(serial)}};metrics.interpolated_instances+=s.count;
  }
  return {snapshot:{...latest,world},memory:batch=>batches.get(batch.memory.buffer_id)?.output.buffer};
 },report(){return {enabled,instance_batches:[...selected],...metrics,semantics:'Display-only delayed interpolation. Packed rows must retain identity/order; count/asset changes snap. Does not alter canonical state or tick rate.'};}};
}

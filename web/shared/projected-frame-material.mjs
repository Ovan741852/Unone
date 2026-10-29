export const FRAME_PROFILE='rgb8_encoded_rebuild_v1';
export const FRAME_GOURAUD_PROFILE='rgb8_encoded_gouraud_v1';
export const FRAME_PROFILES=[FRAME_PROFILE,FRAME_GOURAUD_PROFILE];
export const FRAME_COMPARES=Object.freeze(['never','less','equal','less_equal','greater','not_equal','greater_equal','always']);
export const frameInvalid=m=>{throw Error('PROJECTED_FRAME_INVALID: '+m);};
export function frameObject(value,required,optional=[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>![...required,...optional].includes(k))||required.some(k=>!Object.hasOwn(value,k)))frameInvalid('closed object fields');
 return value;
}
export function frameNormalized(n){
 if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)frameInvalid('normalized finite scalar');
 return n===0?0:Math.fround(n);
}
export function frameSequence(a,max){
 if(!Array.isArray(a)||a.length>max||Object.keys(a).length!==a.length||Object.keys(a).some((k,i)=>k!==String(i)))frameInvalid('dense bounded sequence');
 return a;
}
const choice=(n,choices)=>{if(!choices.includes(n))frameInvalid('material enum');return n;};
const bool=n=>{if(typeof n!=='boolean')frameInvalid('boolean');return n;};
export function frameMaterial(value){
 const m=frameObject(value,['rgb','texture_alpha','alpha','alpha_test','blend','depth','sampler']);
 const a=frameObject(m.alpha_test,['enabled','compare','reference']),b=frameObject(m.blend,['enabled','operation','source','destination']);
 const d=frameObject(m.depth,['test','write','compare']),s=frameObject(m.sampler,['min','mag','address_u','address_v']);
 if(d.test===false&&d.write===true)throw Error('PROJECTED_FRAME_DEPTH_UNSUPPORTED');
 return {rgb:choice(m.rgb,['texture_times_vertex']),texture_alpha:choice(m.texture_alpha,['sampled','one']),alpha:choice(m.alpha,['texture','vertex','texture_times_vertex']),
  alpha_test:{enabled:bool(a.enabled),compare:choice(a.compare,FRAME_COMPARES),reference:frameNormalized(a.reference)},
  blend:{enabled:bool(b.enabled),operation:choice(b.operation,['add']),source:choice(b.source,['source_alpha']),destination:choice(b.destination,['one','one_minus_source_alpha'])},
  depth:{test:bool(d.test),write:bool(d.write),compare:choice(d.compare,FRAME_COMPARES)},
  sampler:{min:choice(s.min,['nearest','linear']),mag:choice(s.mag,['nearest','linear']),address_u:choice(s.address_u,['clamp','repeat']),address_v:choice(s.address_v,['clamp','repeat'])}};
}
export function frameCompare(a,b,kind){
 switch(kind){case'never':return false;case'less':return a<b;case'equal':return a===b;case'less_equal':return a<=b;
 case'greater':return a>b;case'not_equal':return a!==b;case'greater_equal':return a>=b;case'always':return true;default:frameInvalid('compare');}
}
// Scalar reference for conformance. GPU implementation and GPU acceptance remain separate.
export function frameFragment(texture,vertex,destination,material){
 const at=material.texture_alpha==='one'?1:texture[3];
 const a=material.alpha==='texture'?at:material.alpha==='vertex'?vertex[3]:at*vertex[3];
 const discarded=material.alpha_test.enabled&&!frameCompare(a,material.alpha_test.reference,material.alpha_test.compare);
 const fd=material.blend.destination==='one'?1:1-a;
 const rgb=texture.slice(0,3).map((c,i)=>{
  if(discarded)return destination[i];
  const source=c*vertex[i];return Math.max(0,Math.min(1,material.blend.enabled?source*a+destination[i]*fd:source));
 });
 return {discarded,rgb,alpha:a};
}

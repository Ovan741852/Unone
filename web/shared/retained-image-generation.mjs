// Engine-owned immutable generation grant, shared by ABI, IPC and presentation.
// A generation token proves immutable ownership, never geometry validity: its
// first consumer must still validate the complete content before rendering.
const generations=new WeakMap();
export const retainedImageGeneration=value=>value&&typeof value==='object'?generations.get(value):undefined;
export function retainImageResource(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('UI_IMAGE_RESOURCE_INVALID');
 if(generations.has(value))return value;
 const stack=[value],seen=new Set();
 while(stack.length){const next=stack.pop();if(!next||typeof next!=='object'||seen.has(next))continue;seen.add(next);
  if(seen.size>1_048_576)throw Error('UI_IMAGE_RESOURCE_LIMIT');
  const prototype=Object.getPrototypeOf(next);
  if(Array.isArray(next)?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw Error('UI_IMAGE_RESOURCE_INVALID');
  if(Object.getOwnPropertySymbols(next).length)throw Error('UI_IMAGE_RESOURCE_INVALID');
  for(const property of Object.values(Object.getOwnPropertyDescriptors(next))){
   if(!Object.hasOwn(property,'value')||typeof property.value==='function')throw Error('UI_IMAGE_RESOURCE_INVALID');
   const child=property.value;if(child&&typeof child==='object')stack.push(child);
  }
 }
 for(const next of seen)Object.freeze(next);
 generations.set(value,Object.freeze({}));return value;
}

// Private immutable world fields leased by revision, shared by the ABI reader
// and the worker transfer. An unchanged field keeps one frozen value across
// publications, so consumers may cache work by identity.
const publications=new WeakMap();
export const WORLD_FIELD_MAX_ENCODED_BYTES=64*1024*1024;
export function createWorldFieldPublication(text){
 if(typeof text!=='string')throw Error('WORLD_FIELD_PUBLICATION_INVALID');
 const value=JSON.parse(text),stack=[];
 if(value&&typeof value==='object')stack.push(value);
 while(stack.length){
  const current=stack.pop();
  Object.freeze(current);
  // JSON.parse produced these own data properties; avoid an Object.values array per object.
  for(const key in current)if(Object.hasOwn(current,key)){
   const child=current[key];if(child&&typeof child==='object')stack.push(child);
  }
 }
 const entry=Object.freeze({value,text,token:Object.freeze({})});
 if(value&&typeof value==='object')publications.set(value,entry);
 return entry;
}
export const worldFieldPublication=value=>value&&typeof value==='object'?publications.get(value):undefined;

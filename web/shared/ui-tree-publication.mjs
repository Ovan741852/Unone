// Private immutable presentation ownership, shared by the ABI and worker.
// A token proves decoded ownership, not geometry or layout validity: the first
// renderer consumer must still validate the complete tree before using it.
const publications=new WeakMap();
export const UI_TREE_MAX_ENCODED_BYTES=64*1024*1024;
function encodedLength(text){
 let bytes=text.length;
 if(bytes>UI_TREE_MAX_ENCODED_BYTES)throw Error('UI_TREE_PUBLICATION_LIMIT');
 for(let i=0;i<text.length;i++){
  const code=text.charCodeAt(i);
  if(code<=0x7f)continue;
  if(code<=0x7ff)bytes++;
  else if(code>=0xd800&&code<=0xdbff&&i+1<text.length&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){bytes+=2;i++;}
  else bytes+=2;
  if(bytes>UI_TREE_MAX_ENCODED_BYTES)throw Error('UI_TREE_PUBLICATION_LIMIT');
 }
 return bytes;
}
export function createUiTreePublication(text){
 if(typeof text!=='string')throw Error('UI_TREE_PUBLICATION_INVALID');
 const bytes=encodedLength(text),value=JSON.parse(text);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('UI_TREE_PUBLICATION_INVALID');
 // The encoded-byte bound limits this fresh JSON tree. Do not introduce a
 // second object-count limit which could reject a Core-valid publication.
 const stack=[value];
 while(stack.length){
  const current=stack.pop();
  Object.freeze(current);
  // JSON.parse produced these own data properties. Do not allocate an
  // Object.values array for every rectangle, color, style or node.
  for(const key in current)if(Object.hasOwn(current,key)){
   const child=current[key];if(child&&typeof child==='object')stack.push(child);
  }
 }
 const entry=Object.freeze({value,text,bytes,token:Object.freeze({})});
 publications.set(value,entry);return entry;
}
export const uiTreePublication=tree=>tree&&typeof tree==='object'?publications.get(tree):undefined;
export const uiTreeGeneration=tree=>uiTreePublication(tree)?.token;

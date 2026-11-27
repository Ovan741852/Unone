// Private immutable presentation ownership, shared by the ABI and worker.
// A token proves decoded ownership, not geometry or layout validity: the first
// renderer consumer must still validate the complete tree before using it.
const publications=new WeakMap();
const childIndexes=new WeakMap(),retryAfter=new WeakMap();
const utf8=new TextDecoder('utf-8',{fatal:true});
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
function freezeJson(value){
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
 return value;
}
function publish(value,text,bytes){
 const entry=Object.freeze({value,text,bytes,token:Object.freeze({})});
 publications.set(value,entry);return entry;
}
function parseRoot(text,bytes){
 const value=JSON.parse(text);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('UI_TREE_PUBLICATION_INVALID');
 return publish(freezeJson(value),text,bytes);
}
export function createUiTreePublication(text){
 if(typeof text!=='string')throw Error('UI_TREE_PUBLICATION_INVALID');
 return parseRoot(text,encodedLength(text));
}

// Find the end of an object in compact serde JSON. This only delimits candidates.
// New bytes are always parsed by JSON.parse; unchanged bytes already passed it.
function objectEnd(text,at,limit){
 let depth=0,quoted=false;
 for(;at<limit;at++){
  const c=text.charCodeAt(at);
  if(quoted){if(c===92)at++;else if(c===34)quoted=false;}
  else if(c===34)quoted=true;
  else if(c===123)depth++;
  else if(c===125&&--depth===0)return at+1;
 }
 return -1;
}
function indexChildren(previous,start,end){
 const spans=[];
 let at=start;
 for(let i=0;i<previous.value.children.length;i++){
  if(previous.text[at]!=='{')return null;
  const next=objectEnd(previous.text,at,end);
  if(next<0)return null;
  spans.push({start:at,end:next,bytes:encodedLength(previous.text.slice(at,next))});
  at=next;
  if(at<end){if(previous.text[at]!==',')return null;at++;}
 }
 return at===end?spans:null;
}
function reuseChildren(view,text,previous){
 const root=previous.value;
 if(root.kind!=='screen'||typeof root.id!=='string'||typeof root.node!=='string'||!Array.isArray(root.children)
  ||root.children.length<8||root.children.length>4096)return null;
 // Match the complete envelope around Core's children array. Fall back for a
 // scene/metadata change or any other (including future) root serialization.
 const prefix='{"kind":"screen","id":'+JSON.stringify(root.id)+',"node":'+JSON.stringify(root.node)+',"children":[';
 const suffix=Object.hasOwn(root,'budget')?'],"budget":'+JSON.stringify(root.budget)+'}':']}';
 if(!text.startsWith(prefix)||!text.endsWith(suffix)||!previous.text.startsWith(prefix)||!previous.text.endsWith(suffix))return null;
 let old=childIndexes.get(previous);
 if(!old){old=indexChildren(previous,prefix.length,previous.text.length-suffix.length);if(!old)return null;}
 const limit=text.length-suffix.length,children=[],spans=[];
 let at=prefix.length,byteAt=encodedLength(prefix)+(view[0]===0xef&&view[1]===0xbb&&view[2]===0xbf?3:0),misses=0,hits=0;
 while(at<limit){
  if(text[at]!=='{'||children.length>=4096)return null;
  const index=children.length,span=old[index],start=at;
  let node,bytes;
  if(span&&text.startsWith(previous.text.slice(span.start,span.end),at)){
   at+=span.end-span.start;bytes=span.bytes;node=root.children[index];hits++;
  }else{
   if(++misses>=12&&hits<misses)return null;
   at=objectEnd(text,at,limit);if(at<0)return null;
   bytes=encodedLength(text.slice(start,at));
   // Parse a separately decoded child so a reused string cannot keep an
   // entire retired screen's UTF-16 source alive.
   node=freezeJson(JSON.parse(utf8.decode(view.subarray(byteAt,byteAt+bytes))));
  }
  if(at>limit)return null;
  children.push(node);spans.push({start,end:at,bytes});byteAt+=bytes;
  if(at===limit)break;
  if(text[at]!==','||++at===limit)return null;
  byteAt++;
 }
 const value=Object.freeze({...root,children:Object.freeze(children)});
 return {value,spans};
}
export function decodeUiTreePublication(view,previous){
 if(view.byteLength>UI_TREE_MAX_ENCODED_BYTES)throw Error('UI_TREE_PUBLICATION_LIMIT');
 const text=utf8.decode(view),bytes=view.byteLength-(view[0]===0xef&&view[1]===0xbb&&view[2]===0xbf?3:0);
 // Tiny trees already parse cheaply. Bound extra indexing memory and bypass
 // fast-changing scenes for a few generations after a miss.
 if(bytes<8192||bytes>1024*1024||!previous||publications.get(previous.value)!==previous)return parseRoot(text,bytes);
 const delay=retryAfter.get(previous)??0;
 if(delay===0){
  const reuse=reuseChildren(view,text,previous);
  if(reuse){const entry=publish(reuse.value,text,bytes);childIndexes.set(entry,reuse.spans);return entry;}
 }
 const entry=parseRoot(text,bytes);retryAfter.set(entry,delay===0?12:delay-1);return entry;
}
export const uiTreePublication=tree=>tree&&typeof tree==='object'?publications.get(tree):undefined;
export const uiTreeGeneration=tree=>uiTreePublication(tree)?.token;

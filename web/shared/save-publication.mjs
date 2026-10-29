// Private immutable host publication. Ownership is granted only after decoding
// JSON; caller-authored revisions/identity are never an unchanged-content proof.
const entries=new WeakMap(),owned=new WeakSet();
export function createSavePublication(text){
 if(typeof text!=='string')throw Error('SAVE_TRANSPORT_INVALID');
 const value=JSON.parse(text),stack=[value];
 while(stack.length){const v=stack.pop();if(!v||typeof v!=='object')continue;for(const child of Object.values(v))if(child&&typeof child==='object')stack.push(child);Object.freeze(v);}
 const entry=Object.freeze({value,text,token:Object.freeze({})});owned.add(entry);return entry;
}
export function attachSavePublication(snapshot,entry){
 if(!owned.has(entry)||!snapshot||typeof snapshot!=='object'||snapshot.save_payload!==entry.value)throw Error('SAVE_TRANSPORT_INVALID');
 entries.set(snapshot,entry);return snapshot;
}
export function savePublication(snapshot){
 const entry=entries.get(snapshot),field=snapshot&&Object.getOwnPropertyDescriptor(snapshot,'save_payload');
 return entry&&field&&Object.hasOwn(field,'value')&&field.value===entry.value?entry:undefined;
}
export function serializedSavePayload(snapshot){return savePublication(snapshot)?.text??JSON.stringify(snapshot.save_payload);}

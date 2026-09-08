const MAX_PACKET=2*1024*1024,MAX_METADATA=512*1024,MAX_BYTES=256*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const empty=new ArrayBuffer(0);
function invalid(code='JOB_BINARY_INVALID'){throw Error(code);}
function fields(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))invalid('JOB_BINARY_METADATA_INVALID');}
function raw(buffer){if(!(buffer instanceof ArrayBuffer))invalid('JOB_BINARY_BUFFER_REQUIRED');return new Uint8Array(buffer);}
function framing(header,payloadLength){
 const metadata=encoder.encode(JSON.stringify(header));
 if(metadata.length>MAX_METADATA||12+metadata.length+payloadLength>MAX_PACKET)invalid('JOB_BINARY_LIMIT');
 return metadata;
}
function prefix(target,metadata,payload){const view=new DataView(target.buffer,target.byteOffset,target.byteLength);target.set([85,74,66,49]);view.setUint32(4,metadata.length,true);view.setUint32(8,payload.length,true);target.set(metadata,12);target.set(payload,12+metadata.length);}
export function encodeJobPacket(header,buffer=empty){const payload=raw(buffer),metadata=framing(header,payload.length),packet=new Uint8Array(12+metadata.length+payload.length);prefix(packet,metadata,payload);return packet;}
export function decodeJobPacket(bytes){
 if(!ArrayBuffer.isView(bytes)||bytes.byteLength<12||bytes.byteLength>MAX_PACKET)invalid('JOB_BINARY_HEADER_INVALID');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u8=new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(0,true)!==0x31424a55)invalid('JOB_BINARY_VERSION_INVALID');
 const metadata=view.getUint32(4,true),payload=view.getUint32(8,true);
 if(metadata>MAX_METADATA||12+metadata+payload!==bytes.byteLength)invalid('JOB_BINARY_LENGTH_INVALID');
 let header;try{header=JSON.parse(decoder.decode(u8.subarray(12,12+metadata)));}catch{invalid('JOB_BINARY_METADATA_INVALID');}
 if(!header||typeof header!=='object'||Array.isArray(header))invalid('JOB_BINARY_METADATA_INVALID');
 return {header,payload:u8.subarray(12+metadata),metadataBytes:metadata};
}

export function createBinaryJobTransport(module,now=()=>performance.now()){
 const totals={requests:0,metadata_sent_bytes:0,metadata_received_bytes:0,payload_sent_bytes:0,payload_received_bytes:0,copied_payload_from_wasm_bytes:0,encode_ms:0,abi_ms:0,decode_ms:0};
 function request(header,buffer=empty,execute=false){
  if(typeof module._unone_web_jobs_binary!=='function')invalid('JOB_BINARY_ABI_UNAVAILABLE: rebuild the player runtime');
  const start=now(),payload=raw(buffer),metadata=framing(header,payload.length),length=12+metadata.length+payload.length;
  const pointer=module._unone_web_alloc(length);
  // Refresh the heap after allocation: Emscripten may have grown its memory.
  prefix(module.HEAPU8.subarray(pointer,pointer+length),metadata,payload);
  const encoded=now(),status=module._unone_web_jobs_binary(pointer,length,execute?1:0),executed=now();
  const offset=module._unone_web_observation_ptr(),size=module._unone_web_observation_len();
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||size>MAX_PACKET||offset+size>module.HEAPU8.byteLength)invalid('JOB_BINARY_RESPONSE_BOUNDS');
  const bytes=module.HEAPU8.subarray(offset,offset+size);
  if(status!==0)throw Error(decoder.decode(bytes));
  const decoded=decodeJobPacket(bytes);
  totals.requests++;totals.metadata_sent_bytes+=metadata.length;totals.metadata_received_bytes+=decoded.metadataBytes;
  totals.payload_sent_bytes+=payload.length;totals.payload_received_bytes+=decoded.payload.length;
  totals.encode_ms+=encoded-start;totals.abi_ms+=executed-encoded;totals.decode_ms+=now()-executed;
  return decoded;
 }
 function owned(bytes){const start=now(),copy=new Uint8Array(bytes.length);copy.set(bytes);totals.copied_payload_from_wasm_bytes+=bytes.length;totals.decode_ms+=now()-start;return copy.buffer;}
 return {
  drain(){
   const {header,payload}=request({kind:'drain'});fields(header,['kind','tasks']);
   if(header.kind!=='tasks'||!Array.isArray(header.tasks)||header.tasks.length>4)invalid('JOB_BINARY_TASKS_INVALID');
   let offset=0;const ids=new Set(),tasks=[];
   for(const t of header.tasks){
    fields(t,['id','path','source','offset','byte_length']);
    if(typeof t.id!=='string'||typeof t.path!=='string'||typeof t.source!=='string'||ids.has(t.id)||t.offset!==offset||!Number.isSafeInteger(t.byte_length)||t.byte_length<0||t.byte_length>MAX_BYTES||offset+t.byte_length>payload.length)invalid('JOB_BINARY_TASKS_INVALID');
    ids.add(t.id);tasks.push({id:t.id,path:t.path,source:t.source,input:owned(payload.subarray(offset,offset+t.byte_length))});offset+=t.byte_length;
   }
   if(offset!==payload.length)invalid('JOB_BINARY_TRAILING_PAYLOAD');return tasks;
  },
  execute(work){
   fields(work,['id','path','source','input']);if(raw(work.input).length>MAX_BYTES)invalid('JOB_BINARY_LIMIT');
   const {header,payload}=request({kind:'execute',id:work.id,path:work.path,source:work.source},work.input,true);
   fields(header,['kind','id','error','run_ms','profile']);
   if(header.kind!=='complete'||header.id!==work.id||!Number.isFinite(header.run_ms)||header.run_ms<0||(header.error!==null&&typeof header.error!=='string')||payload.length>MAX_BYTES||(header.error!==null&&payload.length!==0))invalid('JOB_BINARY_REPLY_INVALID');
   return {...header,output:header.error===null?owned(payload):null};
  },
  complete(result){
   if(result.kind!=='complete'||typeof result.id!=='string'||!Number.isFinite(result.run_ms)||result.run_ms<0||(result.error!==null&&(typeof result.error!=='string'||result.output!==null)))invalid('JOB_BINARY_REPLY_INVALID');
   if(result.error===null&&raw(result.output).length>MAX_BYTES)invalid('JOB_BINARY_LIMIT');
   const {header,payload}=request({kind:'complete',id:result.id,error:result.error,run_ms:result.run_ms,profile:result.profile},result.error===null?result.output:empty);
   fields(header,['kind']);if(header.kind!=='accepted'||payload.length)invalid('JOB_BINARY_ACK_INVALID');
  },
  report(){return {format:'UJB1',...totals,note:'Host-local totals. Payloads are opaque bytes; metadata alone is JSON. encode/decode includes JS boundary copies; abi_ms includes Rust work and is not disjoint from kernel run_ms.'};}
 };
}

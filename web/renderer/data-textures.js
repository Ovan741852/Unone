// Runtime data textures (api.texture): texel arrays the game builds for mesh
// shader materials to sample. One GPU texture per ID, uploaded again only when
// its revision changes; texels come from Wasm memory views, transferred buffers
// or base64. All are nearest-sampled and clamped: shaders read exact texels.
const FORMATS={rgba8:{bytes:4,integer:false},r32i:{bytes:4,integer:true},rgba32i:{bytes:16,integer:true},r32f:{bytes:4,integer:false},rgba32f:{bytes:16,integer:false}};
const invalid=message=>{throw Error(`DATA_TEXTURE_INVALID: ${message}`);};
function decodeBase64(text){const raw=atob(text),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
export const dataTextureFormat=format=>FORMATS[format]??invalid(`format ${format}`);
// A private, aligned copy of one texture's texels.
export function dataTextureBytes(entry,memory){
  const layout=dataTextureFormat(entry.format),{width,height}=entry;
  if(!Number.isSafeInteger(width)||width<1||width>4096||!Number.isSafeInteger(height)||height<1||height>4096)invalid('size');
  let bytes;
  if(entry.memory){
    const view=entry.memory,buffer=memory?.({memory:view});
    if(!(buffer instanceof ArrayBuffer)||!Number.isSafeInteger(view.offset)||view.offset<0||!Number.isSafeInteger(view.byte_length)||view.offset+view.byte_length>buffer.byteLength)invalid('memory view');
    bytes=new Uint8Array(buffer,view.offset,view.byte_length).slice();
  }else if(typeof entry.data==='string')bytes=decodeBase64(entry.data);
  else invalid('texels missing');
  if(bytes.byteLength!==width*height*layout.bytes)invalid('byte count');
  return bytes;
}
export function createDataTextures(THREE,{memory}={}){
  const records=new Map(),zeros=new Map();let uploads=0;
  const typed=(format,bytes)=>format==='rgba8'?bytes:FORMATS[format].integer?new Int32Array(bytes.buffer):new Float32Array(bytes.buffer);
  function configure(texture,format){
    const integer=FORMATS[format].integer;
    texture.format=format==='r32i'?THREE.RedIntegerFormat:format==='rgba32i'?THREE.RGBAIntegerFormat:format==='r32f'?THREE.RedFormat:THREE.RGBAFormat;
    texture.type=format==='rgba8'?THREE.UnsignedByteType:integer?THREE.IntType:THREE.FloatType;
    if(integer)texture.internalFormat=format==='r32i'?'R32I':'RGBA32I';
    texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.flipY=false;texture.unpackAlignment=1;
    texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.colorSpace=THREE.NoColorSpace;texture.needsUpdate=true;
    return texture;
  }
  const create=(format,width,height,bytes)=>configure(new THREE.DataTexture(typed(format,bytes),width,height),format);
  // Brings the GPU textures to the published set; unchanged revisions cost nothing.
  function sync(entries){
    const alive=new Set();
    for(const [id,entry]of Object.entries(entries??{})){
      alive.add(id);const revision=String(entry.revision);let record=records.get(id);
      if(record?.revision===revision)continue;
      const bytes=dataTextureBytes(entry,memory);
      if(record&&record.format===entry.format&&record.width===entry.width&&record.height===entry.height){
        record.texture.image.data=typed(entry.format,bytes);record.texture.needsUpdate=true;record.revision=revision;
      }else{
        record?.texture.dispose();
        record={revision,format:entry.format,width:entry.width,height:entry.height,texture:create(entry.format,entry.width,entry.height,bytes)};records.set(id,record);
      }
      uploads++;
    }
    for(const [id,record]of records)if(!alive.has(id)){record.texture.dispose();records.delete(id);}
  }
  return {sync,
    get:id=>records.get(id)?.texture,
    // What an unbound sampler reads: one zero texel of the sampler's kind.
    zero(kind){let texture=zeros.get(kind);if(!texture){texture=kind==='int'?create('r32i',1,1,new Uint8Array(4)):create('rgba8',1,1,new Uint8Array(4));zeros.set(kind,texture);}return texture;},
    integer:id=>FORMATS[records.get(id)?.format]?.integer,
    contextLost(retire){for(const record of records.values())retire(record.texture);for(const texture of zeros.values())retire(texture);},
    clear(){for(const record of records.values())record.texture.dispose();records.clear();},
    metrics:()=>({data_textures:records.size,data_texture_uploads:uploads})};
}

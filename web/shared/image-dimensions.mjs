// Bounded encoded-header metadata only; never decodes pixels or invokes DOM.
// PNG: https://www.w3.org/TR/png-3/#11IHDR
// JPEG SOF layout: https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/src/jdmarker.c
// WebP: https://developers.google.com/speed/webp/docs/riff_container
// VP8L: https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification
// VP8 key frames: https://www.rfc-editor.org/rfc/rfc6386.html#section-9.1
export const IMAGE_DIMENSIONS_MAX_PREFIX_BYTES=64*1024;
export class ImageDimensionsError extends Error {
 constructor(code,message){super(`${code}: ${message}`);this.name='ImageDimensionsError';this.code=code;}
}
const invalid=message=>{throw new ImageDimensionsError('IMAGE_DIMENSIONS_INVALID',message);};
const pngSignature=[137,80,78,71,13,10,26,10];
const sof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
const webpTags=['VP8X','VP8L','VP8 '];
function ascii(bytes,offset,text){
 for(let n=0;n<text.length;n++)if(bytes[offset+n]!==text.charCodeAt(n))return false;
 return true;
}
function dimensions(format,width,height){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0
  ||!Number.isSafeInteger(width*height*4))invalid(`${format} dimensions or RGBA size overflow`);
 return {format,width,height};
}
function png(bytes,view){
 if(bytes.length<16)return null;
 if(view.getUint32(8)!==13||!ascii(bytes,12,'IHDR'))invalid('png must begin with a 13-byte IHDR');
 if(bytes.length<24)return null;
 const width=view.getUint32(16),height=view.getUint32(20);
 if(width>0x7fffffff||height>0x7fffffff)invalid('png dimensions exceed unsigned 31-bit range');
 return dimensions('png',width,height);
}
function jpeg(bytes,view){
 let cursor=2;
 while(cursor<bytes.length){
  if(bytes[cursor++]!==0xff)invalid('jpeg marker prefix');
  while(cursor<bytes.length&&bytes[cursor]===0xff)cursor++;
  if(cursor===bytes.length)return null;
  const marker=bytes[cursor++];
  if(marker===0||marker===0xd8)invalid('jpeg unexpected stuffed byte or repeated SOI');
  if(marker===0xd9||marker===0xda)return null; // Never scan entropy data for an accidental SOF.
  if(marker===1||(marker>=0xd0&&marker<=0xd7))continue;
  if(cursor+2>bytes.length)return null;
  const length=view.getUint16(cursor);
  if(length<2)invalid('jpeg segment length');
  if(sof.has(marker)){
   if(length<8)invalid('jpeg SOF segment length');
   if(cursor+8>bytes.length)return null;
   const precision=bytes[cursor+2],height=view.getUint16(cursor+3),width=view.getUint16(cursor+5),components=bytes[cursor+7];
   if(!components||length!==8+3*components||precision<1||precision>16)invalid('jpeg SOF component layout');
   if(cursor+length>bytes.length)return null;
   // DNL can declare height later; this bounded pre-scan cannot infer it.
   if(!height){if(!width)invalid('jpeg zero width');return null;}
   return dimensions('jpeg',width,height);
  }
  if(cursor+length>bytes.length)return null;
  cursor+=length;
 }
 return null;
}
function webpChunk(bytes,view,tag,start,size){
 if(tag==='VP8X'){
  if(size!==10)invalid('webp VP8X chunk size');
  if(start+10>bytes.length)return null;
  const uint24=at=>bytes[at]+bytes[at+1]*256+bytes[at+2]*65536;
  const width=uint24(start+4)+1,height=uint24(start+7)+1;
  if(width*height>0xffffffff)invalid('webp canvas area exceeds unsigned 32-bit range');
  return dimensions('webp',width,height);
 }
 if(tag==='VP8L'){
  if(size<5)invalid('webp VP8L header size');
  if(start+5>bytes.length)return null;
  if(bytes[start]!==0x2f)invalid('webp VP8L signature');
  const bits=view.getUint32(start+1,true);
  if(bits>>>29)invalid('webp VP8L unsupported version');
  return dimensions('webp',(bits&0x3fff)+1,((bits>>>14)&0x3fff)+1);
 }
 if(size<10)invalid('webp VP8 header size');
 if(start+10>bytes.length)return null;
 if((bytes[start]&1)!==0||!ascii(bytes,start+3,'\x9d\x01\x2a'))invalid('webp VP8 requires key-frame signature');
 return dimensions('webp',view.getUint16(start+6,true)&0x3fff,view.getUint16(start+8,true)&0x3fff);
}
function webp(bytes,view){
 const fileSize=view.getUint32(4,true);
 if(fileSize<12||fileSize>0xfffffff6||(fileSize&1))invalid('webp RIFF size');
 const end=fileSize+8;
 let cursor=12;
 while(cursor+8<=bytes.length&&cursor+8<=end){
  const size=view.getUint32(cursor+4,true),start=cursor+8,next=start+size+(size&1);
  if(next>end)invalid('webp chunk exceeds RIFF size');
  let tag=null;
  for(const candidate of webpTags)if(ascii(bytes,cursor,candidate)){tag=candidate;break;}
  if(tag!==null)return webpChunk(bytes,view,tag,start,size);
  if(next>bytes.length)return null;
  if((size&1)&&bytes[next-1]!==0)invalid('webp chunk padding');
  cursor=next;
 }
 if(cursor<end&&cursor+8>end)invalid('webp truncated chunk header in RIFF size');
 return null;
}
/**
 * A prefix, not a full-file validator. null means unsupported or insufficient;
 * a known malformed header throws ImageDimensionsError. No CRC, entropy, EXIF
 * orientation, animation-storage or actual-decoder validation is claimed.
 * JPEG dimensions describe the encoded raster; EXIF can swap browser display
 * width/height without changing the admitted RGBA byte count. SVG stays unknown.
 */
export function inspectImageDimensions(prefix){
 if(!(prefix instanceof Uint8Array))invalid('prefix must be Uint8Array');
 if(prefix.byteLength>IMAGE_DIMENSIONS_MAX_PREFIX_BYTES)
  throw new ImageDimensionsError('IMAGE_DIMENSIONS_PREFIX_LIMIT','retain at most 64 KiB');
 let view;try{view=new DataView(prefix.buffer,prefix.byteOffset,prefix.byteLength);}catch{invalid('prefix backing buffer is unavailable');}
 if(prefix.length>=8&&pngSignature.every((value,n)=>prefix[n]===value))return png(prefix,view);
 if(prefix.length>=2&&prefix[0]===0xff&&prefix[1]===0xd8)return jpeg(prefix,view);
 if(prefix.length>=12&&ascii(prefix,0,'RIFF')&&ascii(prefix,8,'WEBP'))return webp(prefix,view);
 return null;
}

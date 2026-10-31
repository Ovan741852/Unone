import test from 'node:test';
import assert from 'node:assert/strict';
import {IMAGE_DIMENSIONS_MAX_PREFIX_BYTES,ImageDimensionsError,inspectImageDimensions} from './image-dimensions.mjs';

// Complete 3x2 encoded images, generated once with Pillow (RGB for JPEG/lossy
// WebP; RGBA for PNG/extended WebP). Tests do not import an image decoder.
const encoded={
 png:'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAFElEQVR4nGOs0NjSwAAFTDAGiAYAKvIB2M/x2MoAAAAASUVORK5CYII=',
 jpeg:'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDj6KKK+zPaP//Z',
 webpLossy:'UklGRjoAAABXRUJQVlA4IC4AAACwAQCdASoDAAIAAUAmJaACdLoABGaAAP7x3I/9QZ/4mz/ibPnt/6rxBmesgAAA',
 webpLossless:'UklGRh4AAABXRUJQVlA4TBEAAAAvAkAAAAdQlOKVtv+BiOh/AAA=',
 webpExtended:'UklGRlIAAABXRUJQVlA4WAoAAAAYAAAAAgAAAQAAVlA4TBEAAAAvAkAAEAdQlOKVtoCBiOh/AABFWElGGgAAAE1NACoAAAAIAAEBEgADAAAAAQABAAAAAAAA',
};
const fixtures=Object.fromEntries(Object.entries(encoded).map(([name,b64])=>[name,new Uint8Array(Buffer.from(b64,'base64'))]));
const result=format=>({format,width:3,height:2});
function rejects(bytes,code='IMAGE_DIMENSIONS_INVALID'){
 assert.throws(()=>inspectImageDimensions(bytes),error=>error instanceof ImageDimensionsError&&error.code===code);
}
function u32(bytes,at,value,little=false){new DataView(bytes.buffer,bytes.byteOffset,bytes.length).setUint32(at,value,little);return bytes;}
function segment(marker,payload){const out=new Uint8Array(payload.length+4);out.set([255,marker,(payload.length+2)>>8,(payload.length+2)&255]);out.set(payload,4);return out;}
function jpegSof(marker=0xc0,width=3,height=2){return segment(marker,new Uint8Array([8,height>>8,height&255,width>>8,width&255,3,1,0x11,0,2,0x11,1,3,0x11,1]));}
function join(...chunks){return new Uint8Array(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))));}
function riff(chunk,size=chunk.length){const bytes=new Uint8Array(12+chunk.length);bytes.set(Buffer.from('RIFF'));u32(bytes,4,4+size,true);bytes.set(Buffer.from('WEBP'),8);bytes.set(chunk,12);return bytes;}
function chunk(tag,data){const bytes=new Uint8Array(8+data.length+(data.length&1));bytes.set(Buffer.from(tag));u32(bytes,4,data.length,true);bytes.set(data,8);return bytes;}

test('complete encoded PNG/JPEG/three WebP variants and subviews report dimensions without mutation',()=>{
 for(const [name,bytes]of Object.entries(fixtures)){
  const before=bytes.slice(),expected=result(name.startsWith('webp')?'webp':name);
  assert.deepEqual(inspectImageDimensions(bytes),expected,name);
  const backing=new Uint8Array(bytes.length+9);backing.set(bytes,5);
  assert.deepEqual(inspectImageDimensions(backing.subarray(5,5+bytes.length)),expected,name+' nonzero byteOffset');
  assert.deepEqual(bytes,before);
 }
});
test('every truncation of real valid files returns null or the exact dimensions, never RangeError or invented size',()=>{
 for(const [name,bytes]of Object.entries(fixtures))for(let length=0;length<=bytes.length;length++){
  const actual=inspectImageDimensions(bytes.subarray(0,length));
  if(actual!==null)assert.deepEqual(actual,result(name.startsWith('webp')?'webp':name),name+' prefix '+length);
 }
 assert.equal(inspectImageDimensions(fixtures.png.subarray(0,23)),null);
 assert.deepEqual(inspectImageDimensions(fixtures.png.subarray(0,24)),result('png'));
});
test('unsupported, empty, partial signatures and SVG remain explicitly unknown',()=>{
 for(const bytes of [new Uint8Array(),new Uint8Array([255]),new Uint8Array([137,80,78]),
  new TextEncoder().encode('GIF89a'),new TextEncoder().encode('<svg width="100%" viewBox="0 0 1 1"/>'),
  new TextEncoder().encode('RIFF0000WAVE')])assert.equal(inspectImageDimensions(bytes),null);
});
test('prefix limit/type/detached backing errors are typed and bounded scans terminate',()=>{
 assert.equal(IMAGE_DIMENSIONS_MAX_PREFIX_BYTES,65536);
 rejects(new Uint8Array(65537),'IMAGE_DIMENSIONS_PREFIX_LIMIT');rejects([137,80]);rejects(new ArrayBuffer(24));
 const detached=new Uint8Array(24);structuredClone(detached.buffer,{transfer:[detached.buffer]});rejects(detached);
 const fills=new Uint8Array(65536).fill(255);fills.set([255,216]);assert.equal(inspectImageDimensions(fills),null);
 const zeros=new Uint8Array(65536);assert.equal(inspectImageDimensions(zeros),null);
});
test('PNG rejects wrong IHDR shape, zero/out-of-spec dimensions and unsafe RGBA estimates',()=>{
 const header=fixtures.png.slice(0,24);
 rejects(u32(header.slice(),8,12));const wrong=header.slice();wrong[12]=0;rejects(wrong);
 rejects(u32(header.slice(),16,0));rejects(u32(header.slice(),20,0));rejects(u32(header.slice(),16,0x80000000));
 const overflow=header.slice();u32(overflow,16,0x7fffffff);u32(overflow,20,0x7fffffff);rejects(overflow);
});
test('JPEG skips APP/COM payloads, marker fill and standalone markers instead of mistaking embedded SOF bytes',()=>{
 const fake=join(new Uint8Array([9,8]),jpegSof(0xc0,500,400));
 const bytes=join(new Uint8Array([255,216]),segment(0xe1,fake),new Uint8Array([255,255,1,255,0xd0]),segment(0xfe,new Uint8Array([1,2,3])),jpegSof(0xc2));
 assert.deepEqual(inspectImageDimensions(bytes),result('jpeg'));
 for(const marker of [0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf])
  assert.deepEqual(inspectImageDimensions(join(new Uint8Array([255,216]),jpegSof(marker))),result('jpeg'));
});
test('JPEG incomplete/unsupported scan and DNL height are unknown; malformed lengths/components/width reject',()=>{
 const soi=new Uint8Array([255,216]);
 assert.equal(inspectImageDimensions(join(soi,new Uint8Array([255,225,255,255,1]))),null);
 assert.equal(inspectImageDimensions(join(soi,new Uint8Array([255,218]),jpegSof())),null);
 assert.equal(inspectImageDimensions(join(soi,jpegSof(0xc0,3,0))),null);
 rejects(join(soi,new Uint8Array([0,0])));rejects(join(soi,new Uint8Array([255,0])));
 rejects(join(soi,new Uint8Array([255,216])));rejects(join(soi,new Uint8Array([255,225,0,1])));
 const badLength=jpegSof();badLength[3]=7;rejects(join(soi,badLength));
 const badComponents=jpegSof();badComponents[9]=0;rejects(join(soi,badComponents));
 rejects(join(soi,jpegSof(0xc0,0,2)));
});
test('JPEG exactly bounded metadata prefix and SOF beyond it cannot cause unbounded search',()=>{
 const bytes=new Uint8Array(65536);bytes.set([255,216,255,225,255,254]);
 assert.equal(inspectImageDimensions(bytes),null,'APP ends beyond retained prefix');
 const prefix=join(new Uint8Array([255,216]),...Array.from({length:1000},()=>segment(0xfe,new Uint8Array())),jpegSof());
 assert.deepEqual(inspectImageDimensions(prefix),result('jpeg'));
});
test('WebP unknown padded chunks are skipped and raw dimension headers need no full compressed payload',()=>{
 const data=fixtures.webpLossless.subarray(12);
 assert.deepEqual(inspectImageDimensions(riff(join(chunk('JUNK',new Uint8Array([1])),data))),result('webp'));
 assert.deepEqual(inspectImageDimensions(fixtures.webpLossy.subarray(0,30)),result('webp'));
 assert.deepEqual(inspectImageDimensions(fixtures.webpLossless.subarray(0,25)),result('webp'));
 assert.deepEqual(inspectImageDimensions(fixtures.webpExtended.subarray(0,30)),result('webp'));
});
test('WebP RIFF/segment sizes, padding, signatures, zero dimensions and VP8L version are validated',()=>{
 rejects(u32(fixtures.webpLossy.slice(),4,5,true));rejects(u32(fixtures.webpLossy.slice(),16,0xffffffff,true));
 const badSignature=fixtures.webpLossy.slice();badSignature[23]=0;rejects(badSignature);
 const interframe=fixtures.webpLossy.slice();interframe[20]|=1;rejects(interframe);
 const zeroWidth=fixtures.webpLossy.slice();zeroWidth[26]=0;zeroWidth[27]=0;rejects(zeroWidth);
 const version=fixtures.webpLossless.slice();version[24]|=0xe0;rejects(version);
 const badMagic=fixtures.webpLossless.slice();badMagic[20]=0;rejects(badMagic);
 const padding=chunk('JUNK',new Uint8Array([1]));padding[9]=1;rejects(riff(join(padding,fixtures.webpLossless.subarray(12))));
 rejects(riff(chunk('VP8X',new Uint8Array(8))));rejects(riff(chunk('VP8L',new Uint8Array(4))));
 rejects(riff(chunk('VP8 ',new Uint8Array(8))));
});
test('WebP extended 24-bit +1 and VP8L 14-bit +1 dimensions have correct boundaries',()=>{
 const extended=new Uint8Array(10);extended[4]=0xff;extended[5]=0xff;extended[6]=0xff;
 assert.deepEqual(inspectImageDimensions(riff(chunk('VP8X',extended))),{format:'webp',width:16777216,height:1});
 extended[7]=0xff;extended[8]=0xff;extended[9]=0xff;rejects(riff(chunk('VP8X',extended)));
 const lossless=new Uint8Array([0x2f,255,255,255,15]);
 assert.deepEqual(inspectImageDimensions(riff(chunk('VP8L',lossless))),{format:'webp',width:16384,height:16384});
});

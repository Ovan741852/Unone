import {createProjectedRenderer,projectedEntries} from './projected.js';
import {rasterProfileInputs,packRasterProfileCase} from './projected-raster-profile.js';
import {RASTER_PROFILE} from './projected-raster-profile-expected.js';
import {saveRasterState,restoreRasterState} from './projected-raster-target.js';
export {RASTER_PROFILE};
function texturesFor(THREE,images){
 const records=new Map();
 for(const [id,image] of Object.entries(images)){
  const pixels=new Uint8Array(image.rgba.length),stride=image.width*4;
  for(let y=0;y<image.height;y++)pixels.set(image.rgba.slice(y*stride,(y+1)*stride),(image.height-1-y)*stride);
  const texture=new THREE.DataTexture(pixels,image.width,image.height);
  texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.generateMipmaps=false;
  texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;
  records.set(id,{state:'ready',texture});
 }
 return records;
}
function compareReadback(input,pixels,markers){
 const rows=RASTER_PROFILE.expected[input.id],failures=[];let passed=0;
 for(const row of rows){
  const [x,y]=row.point,offset=((7-y)*8+x)*4,actual=[...pixels.slice(offset,offset+3)],marker=markers[(y*8+x)*4+3];
  const okay=actual.every((n,i)=>Math.abs(n-row.rgb[i])<=1)&&marker===(row.marker?255:0);
  if(okay)passed++;else if(failures.length<8)failures.push({case:input.id,point:row.point,expected:row.rgb,actual,
   expected_marker:row.marker?255:0,actual_marker:marker});
 }
 return {samples:rows.length,passed,failures};
}
// Real synchronous GPU readback. Used only at constructor/target/context changes.
export function validateRasterTarget(THREE,renderer,pass,view){
 const gl=renderer.getContext();if(gl.isContextLost())return {lost:true};
 const input=rasterProfileInputs(),state=saveRasterState(THREE,renderer);
 if(state.target!==null)throw Error('PROJECTED_RASTER_PROFILE_UNSUPPORTED: validation requires default incoming target');
 if(input.cases.length!==RASTER_PROFILE.case_count||RASTER_PROFILE.sample_count>1024||input.cases.length>40)
  throw Error('PROJECTED_RASTER_SELFTEST_PROFILE_INVALID');
 const records=texturesFor(THREE,input.images),specs=new Map([...records.keys()].map(id=>[id,{id,kind:'texture2d'}]));
 const projected=createProjectedRenderer(THREE,spec=>records.get(spec.id),{raster:'upper_left_checked'}),camera=new THREE.PerspectiveCamera();
 const pixels=new Uint8Array(8*8*4),markers=new Uint8Array(8*8*4),result={samples:0,passed:0,failures:[],
  readback:'actual-WebGL2-default-RGBA8-and-staging-marker'};pass.invalidate();
 try{
  const ratio=renderer.getPixelRatio();renderer.setRenderTarget(null);renderer.setViewport(0,0,view.physical_size[0]/ratio,view.physical_size[1]/ratio);
  renderer.autoClear=false;renderer.setClearColor(0x111827,1);
  for(let i=0;i<input.cases.length;i++){
   if(gl.isContextLost())return {lost:true};
   const current=input.cases[i];renderer.setScissorTest(false);renderer.clear(true,true,false);
   projected.prepare(projectedEntries(packRasterProfileCase(current,...view.physical_size,i+1)),specs);pass.draw(projected,camera);
   if(gl.isContextLost())return {lost:true};
   gl.readPixels(0,view.physical_size[1]-8,8,8,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   if(gl.isContextLost())return {lost:true};
   pass.readCoverage(0,0,8,8,markers);if(gl.isContextLost())return {lost:true};
   const compared=compareReadback(current,pixels,markers);
   result.samples+=compared.samples;result.passed+=compared.passed;result.failures.push(...compared.failures.slice(0,8-result.failures.length));
  }
  return result;
 }catch(error){if(gl.isContextLost())return {lost:true};throw error;}finally{
  projected.clear();for(const record of records.values())record.texture.dispose();
  restoreRasterState(renderer,state);
  // A startup/resize probe never leaves its diagnostic pixels presented. No old
  // framebuffer-content rollback is promised; the actual game draws immediately next.
  if(!gl.isContextLost()){renderer.setScissorTest(false);renderer.clear(true,true,false);restoreRasterState(renderer,state);}
 }
}

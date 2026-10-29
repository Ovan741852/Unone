import {frameProfileCases,FRAME_IMAGES,FRAME_CONFORMANCE} from './projected-frame-profile.js';
import {gouraudFrameCases,GOURAUD_CONFORMANCE,GOURAUD_FRAME_PROFILE} from './projected-frame-gouraud-profile.js';
import {createFrameDraws} from './projected-frame-draws.js';
import {projectedFrame} from '../shared/projected-frame.mjs';
import {saveRasterState,restoreRasterState} from './projected-raster-target.js';
import {assertFrameGpuError} from './projected-frame-target-query.js';
export {FRAME_CONFORMANCE};
export const frameConformance=profile=>profile===GOURAUD_FRAME_PROFILE?
 {...GOURAUD_CONFORMANCE,legacy:FRAME_CONFORMANCE}:FRAME_CONFORMANCE;
function textures(THREE){
 const records=new Map();for(const [id,image] of Object.entries(FRAME_IMAGES)){
  const pixels=new Uint8Array(image.rgba.length),stride=image.width*4;
  for(let y=0;y<image.height;y++)pixels.set(image.rgba.slice(y*stride,(y+1)*stride),(image.height-1-y)*stride);
  const texture=new THREE.DataTexture(pixels,image.width,image.height);texture.colorSpace=THREE.NoColorSpace;
  texture.flipY=false;texture.generateMipmaps=false;texture.needsUpdate=true;records.set(id,{state:'ready',texture});
 }return records;
}
function compare(gl,current,width,height){
 const small=current.expected.every(r=>r.point[0]<8&&r.point[1]<8),pixels=new Uint8Array(small?256:4),failures=[];
 if(small)gl.readPixels(0,height-8,8,8,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let passed=0;
 for(const row of current.expected){const [x,y]=row.point;
  if(!small)gl.readPixels(x,height-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const offset=small?((7-y)*8+x)*4:0,actual=[...pixels.slice(offset,offset+3)];
  if(actual.every((n,i)=>Math.abs(n-row.rgb[i])<=1))passed++;
  else if(failures.length<8)failures.push({case:current.id,point:row.point,expected:row.rgb,actual});
 }
 if(gl.getError()!==gl.NO_ERROR&&!gl.isContextLost())throw Error('PROJECTED_FRAME_SELFTEST_READBACK_ERROR');
 return {samples:current.expected.length,passed,failures};
}
export function validateFrameTarget(THREE,renderer,pass,view){
 const gl=renderer.getContext();if(gl.isContextLost())return {lost:true};
 const [width,height]=view.physical_size,inputs=frameProfileCases(width,height),state=saveRasterState(THREE,renderer);
 if(view.material_profile===GOURAUD_FRAME_PROFILE)inputs.push(...gouraudFrameCases(width,height));
 if(inputs.length>64||inputs.reduce((n,c)=>n+c.expected.length,0)>2048)throw Error('PROJECTED_FRAME_SELFTEST_PROFILE_INVALID');
 const records=textures(THREE),specs=new Map([...records.keys()].map(id=>[id,{id,kind:'texture2d'}]));
 const draws=createFrameDraws(THREE,s=>records.get(s.id)),camera=new THREE.PerspectiveCamera();
 const result={samples:0,passed:0,failures:[],readback:'actual-default-RGB;attachment-query-and-GPU-textureSize;four-corner-RGB/depth',
  ...(view.material_profile===GOURAUD_FRAME_PROFILE?{gouraud:GOURAUD_CONFORMANCE}:{})};
 pass.invalidate();assertFrameGpuError(gl,'frame-validation.invalidate');
 try{
  for(const current of inputs){
   if(gl.isContextLost())return {lost:true};const frame=projectedFrame({projected_frame:current.frame});
   if(!draws.prepare(frame,specs)||!pass.draw(draws,camera,frame))return {lost:true};
   const r=compare(gl,current,width,height);result.samples+=r.samples;result.passed+=r.passed;
   result.failures.push(...r.failures.slice(0,8-result.failures.length));if(gl.isContextLost())return {lost:true};
  }return result;
 }catch(error){if(gl.isContextLost())return {lost:true};throw error;
 }finally{
  const check=stage=>{if(!gl.isContextLost())assertFrameGpuError(gl,'frame-validation.'+stage);};
  try{
   draws.clear();check('draws-dispose');
   for(const [id,r] of records){r.texture.dispose();check('texture-dispose.'+id);}
   restoreRasterState(renderer,state);check('restore-before-clear');
   if(!gl.isContextLost()){renderer.setScissorTest(false);renderer.clear(true,true,false);check('clear');}
  }finally{restoreRasterState(renderer,state);check('restore-final');}
 }
}

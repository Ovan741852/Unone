// Camera curvature for every world material, applied in the vertex stage after
// the model-view transform: in view space relative to the camera target,
// y -= curvature * (x^2 + z^2). Materials are patched lazily the first time a
// curved camera draws them; the patched shader is a no-op at curvature 0.
// Screen billboards get their own projection stage (always patched): the
// anchor is projected, then each corner moves by its pixel offset, and the
// depth test uses the anchor moved toward the camera by depth_bias.
const CURVE=`if(unoneCurvature!=0.0){
 float unoneDepth=-mvPosition.z-unoneCurveDistance;
 mvPosition.y-=unoneCurvature*(mvPosition.x*mvPosition.x+unoneDepth*unoneDepth);
}`;
const CHUNK=`#include <project_vertex>
${CURVE}
gl_Position=projectionMatrix*mvPosition;`;
const BILLBOARD=`vec4 mvPosition=vec4(transformed,1.0);
#ifdef USE_INSTANCING
 mvPosition=instanceMatrix*mvPosition;
#endif
mvPosition=modelViewMatrix*mvPosition;
${CURVE}
vec4 unoneClip=projectionMatrix*mvPosition;
vec4 unoneBiased=projectionMatrix*vec4(mvPosition.xy,mvPosition.z+unoneDepthBias,1.0);
gl_Position=vec4((unoneClip.xy/unoneClip.w+vec2(unoneOffset.x,-unoneOffset.y)*2.0/unoneViewport)*unoneBiased.w,unoneBiased.z,unoneBiased.w);`;
export function createWorldCurvature(){
  const uniforms={unoneCurvature:{value:0},unoneCurveDistance:{value:0},unoneViewport:{value:[1,1]}},patched=new WeakSet();
  function patch(material,chunk,declarations,extra={}){
    if(patched.has(material))return;patched.add(material);
    const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
    material.onBeforeCompile=function(shader,renderer){
      previous?.call(this,shader,renderer);
      // Custom shaders without the standard projection chunk are left unchanged.
      if(!shader.vertexShader.includes('#include <project_vertex>'))return;
      Object.assign(shader.uniforms,uniforms,extra);
      shader.vertexShader=declarations+shader.vertexShader.replace('#include <project_vertex>',chunk);
    };
    material.customProgramCacheKey=function(){return key.call(this)+'|unone-'+(chunk===CHUNK?'curvature':'billboard');};
    material.needsUpdate=true;
  }
  let active=false;
  return {
    // Bent geometry can enter the frustum from outside its unbent bounds.
    prepare(scene,camera3d){
      const curvature=camera3d?.curvature??0;uniforms.unoneCurvature.value=curvature;
      if(curvature){const p=camera3d.position,t=camera3d.target;uniforms.unoneCurveDistance.value=Math.hypot(p.x-t.x,p.y-t.y,p.z-t.z);}
      if(!curvature&&!active)return;
      active=true;
      scene.traverse(object=>{
        if(!object.material)return;object.frustumCulled=!curvature&&object.frustumCulled;
        for(const material of Array.isArray(object.material)?object.material:[object.material])
          patch(material,CHUNK,'uniform float unoneCurvature;\nuniform float unoneCurveDistance;\n');
      });
    },
    billboard(material,depthBias){
      patch(material,BILLBOARD,'attribute vec2 unoneOffset;\nuniform float unoneCurvature;\nuniform float unoneCurveDistance;\nuniform vec2 unoneViewport;\nuniform float unoneDepthBias;\n',
        {unoneDepthBias:{value:depthBias}});
    },
    // Pixel size of the area the world is drawn into, for billboard offsets.
    viewport(width,height){uniforms.unoneViewport.value=[Math.max(1,width),Math.max(1,height)];},
    get curvature(){return uniforms.unoneCurvature.value;},
  };
}

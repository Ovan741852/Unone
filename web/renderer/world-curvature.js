// Camera curvature for every world material, applied in the vertex stage after
// the model-view transform: in view space relative to the camera target,
// y -= curvature * (x^2 + z^2). Materials are patched lazily the first time a
// curved camera draws them; the patched shader is a no-op at curvature 0.
const CHUNK=`#include <project_vertex>
if(unoneCurvature!=0.0){
 float unoneDepth=-mvPosition.z-unoneCurveDistance;
 mvPosition.y-=unoneCurvature*(mvPosition.x*mvPosition.x+unoneDepth*unoneDepth);
 gl_Position=projectionMatrix*mvPosition;
}`;
export function createWorldCurvature(){
  const uniforms={unoneCurvature:{value:0},unoneCurveDistance:{value:0}},patched=new WeakSet();
  function patch(material){
    if(patched.has(material))return;patched.add(material);
    const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
    material.onBeforeCompile=function(shader,renderer){
      previous?.call(this,shader,renderer);
      // Custom shaders without the standard projection chunk are left unchanged.
      if(!shader.vertexShader.includes('#include <project_vertex>'))return;
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader='uniform float unoneCurvature;\nuniform float unoneCurveDistance;\n'+shader.vertexShader.replace('#include <project_vertex>',CHUNK);
    };
    material.customProgramCacheKey=function(){return key.call(this)+'|unone-curvature';};
    material.needsUpdate=true;
  }
  let active=false;
  return {
    // Bent geometry can enter the frustum from outside its unbent bounds.
    prepare(scene,camera3d){
      const curvature=camera3d?.curvature??0;uniforms.unoneCurvature.value=curvature;
      if(!curvature&&!active)return;
      active=true;
      if(curvature){const p=camera3d.position,t=camera3d.target;uniforms.unoneCurveDistance.value=Math.hypot(p.x-t.x,p.y-t.y,p.z-t.z);}
      scene.traverse(object=>{
        if(!object.material)return;object.frustumCulled=!curvature&&object.frustumCulled;
        for(const material of Array.isArray(object.material)?object.material:[object.material])patch(material);
      });
    },
    get curvature(){return uniforms.unoneCurvature.value;},
  };
}

// Game art direction: painted albedo, three lighting bands and a plum ink silhouette.
// Shares materials and skeletons; it never owns animation, collision or combat rules.
export function createInkStyle(T){
 const bands=new T.DataTexture(new Uint8Array([105,176,245]),3,1,T.RedFormat);
 bands.minFilter=T.NearestFilter;bands.magFilter=T.NearestFilter;bands.generateMipmaps=false;bands.needsUpdate=true;
 const materials=new Map(),viewport={value:new T.Vector2(1440,900)};
 const outline=new T.MeshBasicMaterial({color:0x392a35,side:T.BackSide,toneMapped:false});
 outline.name='Plum silhouette';
 outline.onBeforeCompile=shader=>{
  shader.uniforms.inkViewport=viewport;
  shader.vertexShader='uniform vec2 inkViewport;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
   vec3 inkNormal=normal;
   #ifdef USE_SKINNING
    mat4 inkSkin=skinWeight.x*boneMatX+skinWeight.y*boneMatY+skinWeight.z*boneMatZ+skinWeight.w*boneMatW;
    inkNormal=(bindMatrixInverse*inkSkin*bindMatrix*vec4(inkNormal,0.0)).xyz;
   #endif
   vec2 inkDirection=(projectionMatrix*vec4(normalMatrix*inkNormal,0.0)).xy;
   inkDirection/=max(length(inkDirection),0.0001);
   gl_Position.xy+=inkDirection*2.6/inkViewport*gl_Position.w;
  `);
 };
 outline.customProgramCacheKey=()=> 'forest-plum-ink-v1';
 function paint(source){
  if(!materials.has(source)){
   const m=new T.MeshToonMaterial({map:source.map,color:source.color,gradientMap:bands,side:source.side,transparent:source.transparent,opacity:source.opacity,alphaTest:source.alphaTest});
   m.name='Painted ink · '+source.name;materials.set(source,m);
  }
  return materials.get(source);
 }
 function apply(root){
  const meshes=[];root.traverse(o=>{if(o.isMesh&&!o.userData.inkStyled&&!o.userData.inkOutline)meshes.push(o)});
  for(const mesh of meshes){
   mesh.userData.inkStyled=true;mesh.material=Array.isArray(mesh.material)?mesh.material.map(paint):paint(mesh.material);
   // Open cloth has no closed back surface; outlining it would cover the cloth itself.
   if(mesh.userData.storybookGeometry&&mesh.material.side===T.DoubleSide)continue;
   const stroke=mesh.isSkinnedMesh?new T.SkinnedMesh(mesh.geometry,outline):new T.Mesh(mesh.geometry,outline);
   if(mesh.isSkinnedMesh){stroke.bindMode=mesh.bindMode;stroke.bind(mesh.skeleton,mesh.bindMatrix);}
   stroke.name='Ink · '+mesh.name;stroke.userData.inkOutline=true;stroke.userData.fanRigid=true;stroke.frustumCulled=false;
   stroke.onBeforeRender=renderer=>renderer.getDrawingBufferSize(viewport.value);
   mesh.add(stroke);
  }
 }
 return {apply,paint,inspect:()=>({style:'olive-crimson-ink',materials:materials.size,outlinePixels:1.3,lightingBands:3}),dispose(){bands.dispose();outline.dispose();for(const m of materials.values())m.dispose();materials.clear();}};
}

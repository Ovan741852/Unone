// Artistic world presentation only. Luau collisions remain a 25 x 25 square.
const factor=z=>Math.max(.4,Math.min(2,1.125-.046*z));
export function fanPoint(x,z,seat,inverse=false){
 const a=(seat-1)*Math.PI/2,c=Math.cos(a),s=Math.sin(a);
 let lateral=x*c-z*s;const depth=x*s+z*c;
 lateral=inverse?lateral/factor(depth):lateral*factor(depth);
 return {x:lateral*c+depth*s,z:depth*c-lateral*s};
}
export function installFanView({THREE:T,scene,camera3d:camera}){
 // Fit the far wall corners to the viewport and the player's base above the HUD.
 // Use the actual projection for rendering, labels and input ray inversion.
 const originalProjection=camera.updateProjectionMatrix;
 const framing=new T.Matrix4();
 camera.updateProjectionMatrix=function(){
  originalProjection.call(this);this.updateMatrixWorld(true);
  const length=Math.hypot(this.position.x,this.position.z),c=this.position.z/length,s=this.position.x/length;
  const project=(x,z)=>new T.Vector3(x*c+z*s,0,z*c-x*s).project(this);
  const edge=12.86,far=project(edge*factor(-edge),-edge),base=project(0,12.2);
  const horizontal=.98/Math.abs(far.x),portrait=this.aspect<1.05;
  // The old independent X/Y fit stretched every actor on a portrait display.
  // Use uniform image-plane scaling there and reserve the bottom for touch UI.
  const vertical=portrait?horizontal:1.2/(far.y-base.y),baseY=portrait?-.38:-.76;
  framing.set(horizontal,0,0,0, 0,vertical,0,baseY-vertical*base.y, 0,0,1,0, 0,0,0,1);
  this.projectionMatrix.premultiply(framing);this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
 };
 const patched=new Map(),previous=scene.onBeforeRender;
 const inverse={value:new T.Matrix4()},vp={value:new T.Matrix4()},basis={value:new T.Vector2(1,0)};
 scene.onBeforeRender=function(renderer,sc,camera,...rest){
  previous?.call(this,renderer,sc,camera,...rest);
  vp.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);inverse.value.copy(vp.value).invert();
  const length=Math.hypot(camera.position.x,camera.position.z);basis.value.set(camera.position.z/length,camera.position.x/length);
  scene.traverse(o=>{
   if(!o.isMesh&&!o.isPoints&&!o.isLine)return;o.frustumCulled=false;
   // Actors already translate their entire rig through fanPoint. Their vertices,
   // equipment and ink silhouette retain the same shape at every field position.
   if(o.userData.fanRigid)return;
   for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(!m||patched.has(m))continue;const compile=m.onBeforeCompile,key=m.customProgramCacheKey;patched.set(m,{compile,key});
    const rigid=Boolean(o.userData.fanRigid);
    m.onBeforeCompile=function(shader,...args){compile.call(this,shader,...args);Object.assign(shader.uniforms,{fanInverse:inverse,fanVP:vp,fanBasis:basis});
     shader.vertexShader='uniform mat4 fanInverse;\nuniform mat4 fanVP;\nuniform vec2 fanBasis;\n'+shader.vertexShader;
     const warp=rigid?`\nvec4 fanWorld=fanInverse*gl_Position;\nvec4 fanAnchor=modelMatrix*vec4(0.0,0.0,0.0,1.0);\nfloat fanL=fanAnchor.x*fanBasis.x-fanAnchor.z*fanBasis.y;\nfloat fanD=fanAnchor.x*fanBasis.y+fanAnchor.z*fanBasis.x;\nfloat fanShift=fanL*(clamp(1.125-0.046*fanD,0.4,2.0)-1.0);\nfanWorld.x+=fanShift*fanBasis.x;\nfanWorld.z-=fanShift*fanBasis.y;\ngl_Position=fanVP*fanWorld;\n`:`\nvec4 fanWorld=fanInverse*gl_Position;\nfloat fanL=fanWorld.x*fanBasis.x-fanWorld.z*fanBasis.y;\nfloat fanD=fanWorld.x*fanBasis.y+fanWorld.z*fanBasis.x;\nfanL*=clamp(1.125-0.046*fanD,0.4,2.0);\nfanWorld.x=fanL*fanBasis.x+fanD*fanBasis.y;\nfanWorld.z=fanD*fanBasis.x-fanL*fanBasis.y;\ngl_Position=fanVP*fanWorld;\n`;
     const end=shader.vertexShader.lastIndexOf('}');shader.vertexShader=shader.vertexShader.slice(0,end)+warp+shader.vertexShader.slice(end);
    };m.customProgramCacheKey=function(){return key.call(this)+'|forest-world-fan-v3|'+rigid;};m.needsUpdate=true;
   }
  });
 };
 return {dispose(){camera.updateProjectionMatrix=originalProjection;camera.updateProjectionMatrix();scene.onBeforeRender=previous;for(const [m,p]of patched){m.onBeforeCompile=p.compile;m.customProgramCacheKey=p.key;m.needsUpdate=true;}patched.clear();}};
}

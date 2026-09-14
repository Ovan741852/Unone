// Presentation-only faction livery, weapon silhouettes and contact shadows.
// Attachments follow the existing animated bones and preserve painted GLB faces.
export function createStorybookActors(T,scene){
 const materials=new Map(),geometries=new Set();
 const material=color=>{if(!materials.has(color))materials.set(color,new T.MeshStandardMaterial({color,roughness:.86,metalness:.08,flatShading:true,side:T.DoubleSide}));return materials.get(color);};
 function mesh(geometry,color){geometries.add(geometry);const m=new T.Mesh(geometry,material(color));m.userData.storybookGeometry=true;m.userData.fanRigid=true;return m;}
 function attach(actor,boneName,part,position,rotation=[0,0,0]){
  actor.updateMatrixWorld(true);const bone=actor.getObjectByName('mixamorig'+boneName);if(!bone)return;
  part.position.set(...position);part.rotation.set(...rotation);actor.add(part);actor.updateMatrixWorld(true);bone.attach(part);
 }
 function cloth(points){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points,3));g.computeVertexNormals();return g;}
 function decorate(actor,data){
  const color=[0xa7403d,0x777993,0x914f68][data.k-1];
  const cape=mesh(cloth([-.27,.79,-.20,.27,.79,-.20,-.34,.27,-.32, .27,.79,-.20,.34,.30,-.35,-.34,.27,-.32]),color);
  attach(actor,'Spine1',cape,[0,0,0]);
  const crest=mesh(new T.BoxGeometry(.10,.21,.34),color);attach(actor,'Head',crest,[0,data.artLegacy?1.58:1.76,-.025]);
  if(data.k===1){
   const shield=mesh(new T.CylinderGeometry(.25,.25,.065,6),0x213e54);attach(actor,'LeftHand',shield,[.45,.66,.12],[Math.PI/2,0,0]);
   const boss=mesh(new T.OctahedronGeometry(.105),0xe8c17b);attach(actor,'LeftHand',boss,[.45,.66,.18]);
  }else if(!data.equipment?.[4]){
   const pole=mesh(new T.CylinderGeometry(.023,.023,1.9,6),0xc39c67);attach(actor,'RightHand',pole,[-.46,.68,.55],[Math.PI/2,0,0]);
   const tip=mesh(new T.ConeGeometry(.105,.35,4),0xb5e7e5);attach(actor,'RightHand',tip,[-.46,.68,1.65],[Math.PI/2,0,0]);
   const pennant=mesh(cloth([-.48,.69,1.12,-.48,.69,.66,-.48,.34,.85]),color);attach(actor,'RightHand',pennant,[0,0,0]);
   const baseWeapon=actor.getObjectByName('Equipment_weapon');if(baseWeapon)baseWeapon.visible=false;
  }
 }
 const shadowGeometry=new T.CircleGeometry(1,16);shadowGeometry.rotateX(-Math.PI/2);
 const shadowMaterial=new T.MeshBasicMaterial({color:0x493546,transparent:true,opacity:.38,depthWrite:false});
 const shadows=new T.InstancedMesh(shadowGeometry,shadowMaterial,300);shadows.frustumCulled=false;shadows.renderOrder=1;scene.add(shadows);
 shadows.count=0;
 const ringGeometry=new T.RingGeometry(.90,1,32);ringGeometry.rotateX(-Math.PI/2);
 const ringMaterial=new T.MeshBasicMaterial({transparent:true,opacity:.80,depthWrite:false});
 const rings=new T.InstancedMesh(ringGeometry,ringMaterial,100);rings.frustumCulled=false;scene.add(rings);
 rings.count=0;
 const dummy=new T.Object3D(),tint=new T.Color();
 function update(entries){let si=0,ri=0;
  for(const entry of entries.values()){
   if(entry.death!==null)continue;const d=entry.last,scale=entry.root.scale.x;
   if(si<300){dummy.position.set(d.x,.045,d.z);dummy.scale.set(scale*(d.k===3?.9:.65),1,scale*(d.k===3?1:.52));dummy.rotation.set(0,d.yaw??0,0);dummy.updateMatrix();shadows.setMatrixAt(si++,dummy.matrix);}
   if(!d.k&&d.rank>=3&&ri<100){dummy.position.set(d.x,.06,d.z);dummy.scale.setScalar(scale*(d.rank===5?1.1:.85));dummy.updateMatrix();rings.setMatrixAt(ri,dummy.matrix);rings.setColorAt(ri++,tint.set(d.rank>=5?0xf5d593:d.rank===4?0xd494d5:0xe99370));}
  }
  shadows.count=si;shadows.instanceMatrix.needsUpdate=true;rings.count=ri;rings.instanceMatrix.needsUpdate=true;if(rings.instanceColor)rings.instanceColor.needsUpdate=true;
 }
 function release(actor){actor.traverse(o=>{if(o.userData.storybookGeometry){o.geometry.dispose();geometries.delete(o.geometry);}});}
 return {decorate,update,release,dispose(){for(const g of geometries)g.dispose();for(const m of materials.values())m.dispose();shadows.removeFromParent();rings.removeFromParent();shadowGeometry.dispose();shadowMaterial.dispose();ringGeometry.dispose();ringMaterial.dispose();}};
}

import * as T from 'three';
// Blender-authored bind geometry; uses the existing rig and animation contract.
export function applyStorybook(rig,data,texture=null){
 if(data.format!=='storybook-blender-mesh-v1')throw Error('Unknown Blender mesh format');
 const remove=g=>{rig.root.remove(g);g.traverse(o=>o.geometry?.dispose());};remove(rig.body);for(const g of Object.values(rig.slots))remove(g);
 if(data.bindBones){
  for(const b of rig.bones){const world=data.bindBones[b.name];if(!world)throw Error('Missing bind joint '+b.name);b.position.fromArray(world);if(b.parent.isBone)b.position.sub(new T.Vector3().fromArray(data.bindBones[b.parent.name]));rig.rest[b.name]=b.position.clone();}
  rig.root.updateMatrixWorld(true);rig.skeleton.calculateInverses();
 }
 const painted=texture?new T.MeshStandardMaterial({map:texture,roughness:.9,metalness:0,flatShading:true,side:T.DoubleSide}):null;
 const materials={};for(const [key,hex]of Object.entries(data.palette))materials[key]=new T.MeshStandardMaterial({color:'#'+hex,metalness:0,roughness:.94,flatShading:true,side:T.DoubleSide});
 const names=new Map(rig.bones.map((b,i)=>[b.name,i]));
 function part(spec,variant){
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(spec.position,3));geometry.setIndex(spec.index);geometry.computeVertexNormals();
  if(spec.uv)geometry.setAttribute('uv',new T.Float32BufferAttribute(spec.uv,2));
  const ids=[],weights=[];for(const list of spec.weights){for(let i=0;i<4;i++){const pair=list[i];if(pair&&!names.has(pair[0]))throw Error('Missing bone '+pair[0]);ids.push(pair?names.get(pair[0]):0);weights.push(pair?.[1]??0);}}
  geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
  let material=painted??materials[spec.material];if(!painted&&variant==='forest'&&spec.material==='blue'){material=materials.forest??=new T.MeshStandardMaterial({color:'#91a584',roughness:.94,flatShading:true,side:T.DoubleSide});}
  const mesh=new T.SkinnedMesh(geometry,material);mesh.name=spec.name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.bind(rig.skeleton,new T.Matrix4());return mesh;
 }
 rig.body=new T.Group();rig.body.name='Body';for(const spec of data.parts.filter(p=>p.slot==='base'))rig.body.add(part(spec));rig.root.add(rig.body);
 rig.equip=(slot,variant)=>{if(rig.slots[slot])remove(rig.slots[slot]);const group=new T.Group();group.name='Equipment_'+slot;rig.slots[slot]=group;rig.root.add(group);if(variant==='none')return;for(const spec of data.parts.filter(p=>p.slot===slot))group.add(part(spec,variant));};
 if(painted)materials.painted=painted;rig.mats=materials;for(const slot of ['head','body','feet','hands','weapon'])rig.equip(slot,'storybook');return rig;
}

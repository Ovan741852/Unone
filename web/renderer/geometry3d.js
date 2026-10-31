// Retained world-space meshes (api.geometry3d). One instanced mesh per mesh
// generation, rebuilt only when its revision changes; placements and visibility
// update in place. The camera places them on the GPU, so camera motion costs
// nothing here.
const FORMATS={'f32le-p3-uv2-rgba4-u32-v1':{stride:9,billboard:false},'f32le-p3-o2-uv2-rgba4-u32-v1':{stride:11,billboard:true}};
const IDENTITY={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const invalid=message=>{throw Error(`GEOMETRY3D_INVALID: ${message}`);};
function decodeBase64(text){const raw=atob(text),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
// Copies one mesh's bytes out of the Wasm heap, a transferred buffer or base64.
export function geometry3dBytes(mesh,memory){
  const layout=FORMATS[mesh.format];if(!layout)throw Error('GEOMETRY3D_FORMAT_UNSUPPORTED: '+mesh.format);
  const vc=mesh.vertex_count,ic=mesh.index_count;
  if(!Number.isSafeInteger(vc)||vc<3||vc>262144||!Number.isSafeInteger(ic)||ic<3||ic>1572864||ic%3)invalid('counts');
  let vertices,indices;
  if(mesh.memory){
    const part=view=>{const buffer=memory?.({memory:view});
      if(!(buffer instanceof ArrayBuffer)||!Number.isSafeInteger(view?.offset)||view.offset<0||!Number.isSafeInteger(view.byte_length)||view.offset+view.byte_length>buffer.byteLength)invalid('memory view');
      return new Uint8Array(buffer,view.offset,view.byte_length).slice();};
    vertices=part(mesh.memory.vertices);indices=part(mesh.memory.indices);
  }else{vertices=decodeBase64(mesh.vertices);indices=decodeBase64(mesh.indices);}
  if(vertices.byteLength!==vc*layout.stride*4||indices.byteLength!==ic*4)invalid('byte counts');
  return {vertices:new Float32Array(vertices.buffer,0,vc*layout.stride),indices:new Uint32Array(indices.buffer,0,ic),...layout};
}

export function createGeometry3DRenderer(THREE,scene,{textureFor,memory,curvature}){
  const records=new Map(),variants=new Map(),object=new THREE.Object3D();let rebuilds=0;
  // Sampler state lives on the texture object, so each filter/address pair of
  // one asset gets its own shallow clone sharing the decoded image.
  function sampled(source,filter,address){
    const key=filter+':'+address;let byKey=variants.get(source);if(!byKey){byKey=new Map();variants.set(source,byKey);}
    let texture=byKey.get(key);
    if(!texture){texture=source.clone();const mode=filter==='nearest'?THREE.NearestFilter:THREE.LinearFilter;
      texture.minFilter=texture.magFilter=mode;texture.generateMipmaps=false;
      texture.wrapS=texture.wrapT=address==='repeat'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;texture.needsUpdate=true;byKey.set(key,texture);}
    return texture;
  }
  function dispose(record){scene.remove(record.mesh);record.mesh.geometry.dispose();record.mesh.material.dispose();record.mesh.dispose();}
  function build(mesh,capacity){
    const {vertices,indices,stride,billboard}=geometry3dBytes(mesh,memory),geometry=new THREE.BufferGeometry();
    const interleaved=new THREE.InterleavedBuffer(vertices,stride),at=billboard?2:0;
    geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
    if(billboard)geometry.setAttribute('unoneOffset',new THREE.InterleavedBufferAttribute(interleaved,2,3));
    geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(interleaved,2,3+at));
    geometry.setAttribute('color',new THREE.InterleavedBufferAttribute(interleaved,4,5+at));
    geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeBoundingSphere();
    const m=mesh.material??{},blend=m.blend??'opaque';
    // Screen billboards face the viewer by construction, so they never cull.
    const material=new THREE.MeshBasicMaterial({vertexColors:true,transparent:blend==='transparent',depthWrite:blend!=='transparent',
      alphaTest:blend==='cutout'?(m.alpha_cutoff??.5):0,side:m.double_sided||billboard?THREE.DoubleSide:THREE.FrontSide});
    if(billboard)curvature.billboard(material,m.depth_bias??0);
    const instanced=new THREE.InstancedMesh(geometry,material,capacity);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);instanced.frustumCulled=false;
    instanced.renderOrder=blend==='transparent'?(m.order??0):0;
    rebuilds++;return instanced;
  }
  // Returns true while a declared texture is still loading. Placements are
  // published apart from mesh content; a mesh without one draws at the origin.
  function draw(meshes,placements,specs){
    let pending=false;const alive=new Set();
    for(const [id,mesh]of Object.entries(meshes??{})){
      alive.add(id);const placement=placements?.[id],transforms=placement?.transforms??[IDENTITY];
      let record=records.get(id);const revision=String(mesh.revision);
      if(record?.revision!==revision||record.capacity<transforms.length){
        if(record)dispose(record);
        const capacity=2**Math.ceil(Math.log2(Math.max(1,transforms.length)));
        record={revision,capacity,mesh:build(mesh,capacity),placement:null};records.set(id,record);scene.add(record.mesh);
      }
      const instanced=record.mesh,key=JSON.stringify(transforms);
      if(record.placement!==key){
        transforms.forEach((t,i)=>{object.position.set(t.position.x,t.position.y,t.position.z);object.rotation.set(t.rotation.x,t.rotation.y,t.rotation.z);
          object.scale.set(t.scale.x,t.scale.y,t.scale.z);object.updateMatrix();instanced.setMatrixAt(i,object.matrix);});
        instanced.count=transforms.length;instanced.instanceMatrix.needsUpdate=true;record.placement=key;
      }
      let ready=true;
      if(mesh.texture){
        const spec=specs.get(mesh.texture);if(spec?.kind!=='texture2d')throw Error(`GEOMETRY3D_TEXTURE_MISSING: ${mesh.texture}`);
        const texture=textureFor(spec);if(!texture)throw Error(`GEOMETRY3D_TEXTURE_LOADER_MISSING: ${mesh.texture}`);if(texture.error)throw texture.error;
        ready=texture.state==='ready';
        if(ready){const m=mesh.material??{},map=sampled(texture.texture,m.filter??'linear',m.address??'clamp');
          if(instanced.material.map!==map){instanced.material.map=map;instanced.material.needsUpdate=true;}}
        else pending=true;
      }
      // An untextured mesh draws at once; a textured one waits for its image.
      instanced.visible=placement?.visible!==false&&ready&&transforms.length>0;
    }
    for(const [id,record]of records)if(!alive.has(id)){dispose(record);records.delete(id);}
    return pending;
  }
  function clearVariants(){for(const byKey of variants.values())for(const texture of byKey.values())texture.dispose();variants.clear();}
  return {draw,
    contextLost(retire){for(const record of records.values()){retire(record.mesh.geometry);retire(record.mesh.material);}},
    clear(){for(const record of records.values())dispose(record);records.clear();clearVariants();},
    metrics:()=>({geometry3d_meshes:records.size,geometry3d_rebuilds:rebuilds})};
}

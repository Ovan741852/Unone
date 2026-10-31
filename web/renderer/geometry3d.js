// Retained world-space meshes (api.geometry3d). One instanced mesh per mesh,
// touched only when its revision changes: new bytes of the same shape upload
// into the existing buffers, anything else rebuilds. Placements and visibility
// update in place. The camera places them on the GPU, so camera motion costs
// nothing here. A mesh may name a scene shader material, which brings its own
// vertex stage and declares extra per-vertex attributes after the color.
import {meshShaderLayout,createMeshShaderMaterial,applyMeshShaderValues} from './shader-materials.js';
const FORMATS={'f32le-p3-uv2-rgba4-u32-v1':{stride:9,billboard:false},'f32le-p3-o2-uv2-rgba4-u32-v1':{stride:11,billboard:true}};
const ATTRIBUTE_FORMAT='f32le-p3-uv2-rgba4-attr-u32-v1';
const IDENTITY={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const invalid=message=>{throw Error(`GEOMETRY3D_INVALID: ${message}`);};
function decodeBase64(text){const raw=atob(text),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
// Interleaved layout of one mesh: the declared attributes of its shader
// material follow the color in the attribute format.
function layoutOf(mesh,materials){
  if(mesh.format!==ATTRIBUTE_FORMAT){const layout=FORMATS[mesh.format];if(!layout)throw Error('GEOMETRY3D_FORMAT_UNSUPPORTED: '+mesh.format);return {...layout,attributes:[]};}
  const id=mesh.material?.shader,definition=materials?.[id];
  if(!definition)throw Error(`SHADER_MATERIAL_UNKNOWN: ${id}`);
  return {...meshShaderLayout(definition),billboard:false};
}
// One mesh's bytes as views into the Wasm heap or a transferred buffer, or
// decoded from base64. Views alias their source: copy before keeping them.
function geometry3dViews(mesh,memory,materials){
  const layout=layoutOf(mesh,materials);
  const vc=mesh.vertex_count,ic=mesh.index_count;
  if(!Number.isSafeInteger(vc)||vc<3||vc>262144||!Number.isSafeInteger(ic)||ic<3||ic>1572864||ic%3)invalid('counts');
  let vertices,indices,aliased=false;
  if(mesh.memory){
    const part=view=>{const buffer=memory?.({memory:view});
      if(!(buffer instanceof ArrayBuffer)||!Number.isSafeInteger(view?.offset)||view.offset<0||!Number.isSafeInteger(view.byte_length)||view.offset+view.byte_length>buffer.byteLength)invalid('memory view');
      return new Uint8Array(buffer,view.offset,view.byte_length);};
    vertices=part(mesh.memory.vertices);indices=part(mesh.memory.indices);aliased=true;
  }else{vertices=decodeBase64(mesh.vertices);indices=decodeBase64(mesh.indices);}
  if(vertices.byteLength!==vc*layout.stride*4||indices.byteLength!==ic*4)invalid('byte counts');
  return {vertices,indices,aliased,...layout};
}
// Copies one mesh's bytes out of the Wasm heap, a transferred buffer or base64.
export function geometry3dBytes(mesh,memory,materials){
  const {vertices,indices,aliased,...layout}=geometry3dViews(mesh,memory,materials);
  const own=bytes=>aliased?bytes.slice():bytes;
  return {vertices:new Float32Array(own(vertices).buffer,0,mesh.vertex_count*layout.stride),
    indices:new Uint32Array(own(indices).buffer,0,mesh.index_count),...layout};
}
// Unaligned heap offsets are possible, so bytes are compared and copied as bytes.
function sameBytes(a,b){
  if(a.byteLength!==b.byteLength)return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
  return true;
}

export function createGeometry3DRenderer(THREE,scene,{textureFor,memory,curvature,dataTextures}){
  const records=new Map(),variants=new Map(),object=new THREE.Object3D();let rebuilds=0,updates=0;
  // Engine values every mesh shader reads; materials share these objects.
  const shared={unone_time:{value:0},unone_frame:{value:0},unone_viewport:{value:[0,0,1,1]},unone_handedness:{value:new THREE.Matrix4()}};
  let white=null;const blank=()=>{if(!white){white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;}return white;};
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
  // Everything but the bytes: a new revision with the same shape updates the
  // existing GPU buffers in place instead of rebuilding mesh and material. A
  // shader mesh's shape includes its program, so a new definition rebuilds.
  const programOf=d=>d?[d.vertex??null,d.fragment,d.attributes??[],d.varyings??[],Object.entries(d.uniforms??{}).map(([n,v])=>[n,Array.isArray(v)?v.length:1]),
    Object.entries(d.samplers??{}).map(([n,s])=>[n,s.type??'float'])]:null;
  // Points each declared sampler at its bound texture; false while an asset loads.
  function bindSamplers(material,definition,specs){
    let ready=true;
    for(const [name,sampler]of Object.entries(definition.samplers??{})){
      const source=sampler.source,kind=sampler.type??'float';let texture=dataTextures.zero(kind);
      if(source?.data!==undefined){
        texture=dataTextures.get(source.data);if(!texture)throw Error(`DATA_TEXTURE_MISSING: ${source.data}`);
        if(dataTextures.integer(source.data)!==(kind==='int'))throw Error(`SHADER_TEXTURE_TYPE: ${name}`);
      }else if(source?.asset!==undefined){
        const spec=specs.get(source.asset);if(spec?.kind!=='texture2d')throw Error(`SHADER_TEXTURE_MISSING: ${source.asset}`);
        const loaded=textureFor(spec);if(!loaded)throw Error(`SHADER_TEXTURE_LOADER_MISSING: ${source.asset}`);if(loaded.error)throw loaded.error;
        if(loaded.state==='ready')texture=loaded.texture;else ready=false;
      }
      material.uniforms[name].value=texture;
    }
    return ready;
  }
  const shapeOf=(mesh,materials)=>JSON.stringify([mesh.format,mesh.vertex_count,mesh.index_count,mesh.texture??null,mesh.material??null,
    programOf(materials?.[mesh.material?.shader])]);
  function update(record,mesh,materials){
    const {vertices,indices}=geometry3dViews(mesh,memory,materials),geometry=record.mesh.geometry;
    const interleaved=geometry.attributes.position.data,index=geometry.index;
    new Uint8Array(interleaved.array.buffer,interleaved.array.byteOffset,interleaved.array.byteLength).set(vertices);interleaved.needsUpdate=true;
    const current=new Uint8Array(index.array.buffer,index.array.byteOffset,index.array.byteLength);
    if(!sameBytes(current,indices)){current.set(indices);index.needsUpdate=true;}
    updates++;
  }
  function material(mesh,billboard,definition){
    const m=mesh.material??{},blend=m.blend??'opaque';
    // Screen billboards face the viewer by construction, so they never cull.
    const side=m.double_sided||billboard?THREE.DoubleSide:THREE.FrontSide;
    if(definition)return createMeshShaderMaterial(THREE,m.shader,definition,{shared,texture:blank(),blend,alphaCutoff:m.alpha_cutoff??.5,side});
    const basic=new THREE.MeshBasicMaterial({vertexColors:true,transparent:blend==='transparent',depthWrite:blend!=='transparent',
      alphaTest:blend==='cutout'?(m.alpha_cutoff??.5):0,side});
    if(billboard)curvature.billboard(basic,m.depth_bias??0);
    return basic;
  }
  function build(mesh,capacity,materials){
    const {vertices,indices,stride,billboard,attributes}=geometry3dBytes(mesh,memory,materials),geometry=new THREE.BufferGeometry();
    const interleaved=new THREE.InterleavedBuffer(vertices,stride),at=billboard?2:0;
    geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
    if(billboard)geometry.setAttribute('unoneOffset',new THREE.InterleavedBufferAttribute(interleaved,2,3));
    geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(interleaved,2,3+at));
    geometry.setAttribute('color',new THREE.InterleavedBufferAttribute(interleaved,4,5+at));
    for(const a of attributes)geometry.setAttribute(a.name,new THREE.InterleavedBufferAttribute(interleaved,a.size,a.offset));
    geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeBoundingSphere();
    const m=mesh.material??{},instanced=new THREE.InstancedMesh(geometry,material(mesh,billboard,m.shader?materials[m.shader]:null),capacity);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);instanced.frustumCulled=false;
    instanced.renderOrder=(m.blend??'opaque')==='transparent'?(m.order??0):0;
    rebuilds++;return instanced;
  }
  // Returns true while a declared texture is still loading. Placements are
  // published apart from mesh content; a mesh without one draws at the origin.
  // `world` supplies the scene's shader materials and the simulation clock.
  function draw(meshes,placements,specs,world={}){
    let pending=false;const alive=new Set(),materials=world.shader_materials;
    shared.unone_time.value=Number(world.time_seconds??0);shared.unone_frame.value=Number(world.frame??0);
    // Undo the host's left-handed root mirror (world3d scale z = -1) for game shaders.
    shared.unone_handedness.value.makeScale(1,1,world.camera3d?.handedness==='left'?-1:1);
    for(const [id,mesh]of Object.entries(meshes??{})){
      alive.add(id);const placement=placements?.[id],transforms=placement?.transforms??[IDENTITY];
      let record=records.get(id);const revision=String(mesh.revision),shape=shapeOf(mesh,materials);
      if(record&&record.revision!==revision&&record.capacity>=transforms.length&&record.shape===shape){
        update(record,mesh,materials);record.revision=revision;
      }else if(record?.revision!==revision||record.capacity<transforms.length||record.shape!==shape){
        if(record)dispose(record);
        const capacity=2**Math.ceil(Math.log2(Math.max(1,transforms.length)));
        record={revision,capacity,shape,mesh:build(mesh,capacity,materials),placement:null};records.set(id,record);scene.add(record.mesh);
      }
      const instanced=record.mesh,key=JSON.stringify(transforms),shader=mesh.material?.shader;
      let ready=true;
      if(shader){applyMeshShaderValues(instanced.material,materials[shader]);if(!bindSamplers(instanced.material,materials[shader],specs)){ready=false;pending=true;}}
      if(record.placement!==key){
        transforms.forEach((t,i)=>{object.position.set(t.position.x,t.position.y,t.position.z);object.rotation.set(t.rotation.x,t.rotation.y,t.rotation.z);
          object.scale.set(t.scale.x,t.scale.y,t.scale.z);object.updateMatrix();instanced.setMatrixAt(i,object.matrix);});
        instanced.count=transforms.length;instanced.instanceMatrix.needsUpdate=true;record.placement=key;
      }
      if(mesh.texture){
        const spec=specs.get(mesh.texture);if(spec?.kind!=='texture2d')throw Error(`GEOMETRY3D_TEXTURE_MISSING: ${mesh.texture}`);
        const texture=textureFor(spec);if(!texture)throw Error(`GEOMETRY3D_TEXTURE_LOADER_MISSING: ${mesh.texture}`);if(texture.error)throw texture.error;
        const loaded=texture.state==='ready';ready&&=loaded;
        if(loaded){const m=mesh.material??{},map=sampled(texture.texture,m.filter??'linear',m.address??'clamp');
          if(shader)instanced.material.uniforms.unone_texture.value=map;
          else if(instanced.material.map!==map){instanced.material.map=map;instanced.material.needsUpdate=true;}}
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
    // The area the world draws into, in drawing-buffer pixels (lower-left origin).
    viewport(x,y,width,height){const v=shared.unone_viewport.value;v[0]=x;v[1]=y;v[2]=Math.max(1,width);v[3]=Math.max(1,height);},
    contextLost(retire){for(const record of records.values()){retire(record.mesh.geometry);retire(record.mesh.material);}if(white)retire(white);},
    clear(){for(const record of records.values())dispose(record);records.clear();clearVariants();white?.dispose();white=null;},
    metrics:()=>({geometry3d_meshes:records.size,geometry3d_rebuilds:rebuilds,geometry3d_updates:updates})};
}

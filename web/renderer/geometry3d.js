// Retained world-space meshes (api.geometry3d). One instanced mesh per mesh,
// touched only when its content changes. Vertex and index buffers retain
// capacity across topology changes. Placements and visibility
// update in place. The camera places them on the GPU, so camera motion costs
// nothing here. A mesh may name a scene shader material, which brings its own
// vertex stage and declares extra per-vertex attributes after the color.
import {meshShaderLayout,createMeshShaderMaterial,applyMeshShaderValues} from './shader-materials.js';
import {worldFieldPublication} from '../shared/world-field-publication.mjs';
const FORMATS={'f32le-p3-uv2-rgba4-u32-v1':{stride:9,billboard:false},'f32le-p3-o2-uv2-rgba4-u32-v1':{stride:11,billboard:true}};
const ATTRIBUTE_FORMAT='f32le-p3-uv2-rgba4-attr-u32-v1';
const MAX_VERTICES=262144,MAX_INDICES=1572864;
const MIN_TRIM_BYTES=256*1024,TRIM_IDLE_MS=30000,TRIM_INTERVAL_MS=1000;
const IDENTITY={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const AT_ORIGIN=[IDENTITY];
function sameVector(a,b){return a.x===b.x&&a.y===b.y&&a.z===b.z;}
// A new immutable placement publication can change just one mesh. Compare
// only the matrix inputs when two different frozen arrays reach this mesh.
function sameTransforms(a,b){
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i++){
    const left=a[i],right=b[i];
    if(!sameVector(left.position,right.position)||!sameVector(left.rotation,right.rotation)||!sameVector(left.scale,right.scale))return false;
  }
  return true;
}
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
  if(!Number.isSafeInteger(vc)||vc<3||vc>MAX_VERTICES||!Number.isSafeInteger(ic)||ic<3||ic>MAX_INDICES||ic%3)invalid('counts');
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
  return ownedArrays(geometry3dViews(mesh,memory,materials),mesh.vertex_count,mesh.index_count);
}
function ownedArrays({vertices,indices,aliased,...layout},vertexCapacity,indexCapacity){
  function own(bytes,length){
    if(!aliased&&bytes.byteLength===length)return bytes.buffer;
    const result=new Uint8Array(length);result.set(bytes);return result.buffer;
  }
  return {vertices:new Float32Array(own(vertices,vertexCapacity*layout.stride*4)),
    indices:new Uint32Array(own(indices,indexCapacity*4)),...layout};
}
function growCapacity(current,needed,limit){
  return needed<=current?current:Math.min(limit,Math.ceil(needed*1.5));
}
function trimmedCapacity(elements,used,elementBytes){
  return elements>4*used&&(elements-used)*elementBytes>=MIN_TRIM_BYTES?used:elements;
}
function markPrefix(attribute,count){
  // More than one simulation publication can arrive before Three uploads.
  // Keep the union so a shorter submission cannot hide pending suffix writes.
  const pending=attribute.updateRanges[0];
  if(pending)pending.count=Math.max(pending.count,count);
  else attribute.addUpdateRange(0,count);
  attribute.needsUpdate=true;
}
// Unaligned heap offsets are possible, so bytes are compared and copied as bytes.
function sameBytes(a,b){
  if(a.byteLength!==b.byteLength)return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
  return true;
}

export function createGeometry3DRenderer(THREE,scene,{textureFor,memory,curvature,dataTextures,now=()=>performance.now()}){
  const records=new Map(),variants=new Map(),object=new THREE.Object3D();let rebuilds=0,updates=0,bufferGrowths=0,samplerBuilds=0,samplerDisposes=0;
  const pendingTrims=new Map();let nextTrim=0,bufferTrims=0,trimmedBytes=0;
  // Engine values every mesh shader reads; materials share these objects.
  const shared={unone_time:{value:0},unone_frame:{value:0},unone_viewport:{value:[0,0,1,1]},unone_handedness:{value:new THREE.Matrix4()}};
  let white=null;const blank=()=>{if(!white){white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;}return white;};
  // Meshes own their sampler variants together. Each variant borrows the source image.
  function releaseSampler(record){
    const sample=record.sampler;if(!sample)return;
    record.sampler=null;
    if(--sample.users)return;
    const group=sample.group;group.samples.delete(sample.key);
    if(!group.samples.size)variants.delete(sample.source);
    sample.texture.dispose();samplerDisposes++;
  }
  function sampled(record,source,filter,address){
    let sample=record.sampler;
    const pixels=source.source;
    let group=sample?.source===source?sample.group:variants.get(source);
    if(!group){
      group={samples:new Map(),pixels,version:source.version,dataVersion:pixels.version,image:pixels.data,ready:pixels.dataReady};
      variants.set(source,group);
    }else if(group.version!==source.version||group.pixels!==pixels||group.dataVersion!==pixels.version||group.image!==pixels.data||group.ready!==pixels.dataReady){
      // Three tracks uploads per Source. Different sampler modes can map to
      // different GPU textures, so they need independent upload versions.
      for(const active of group.samples.values()){
        active.texture.source.data=pixels.data;active.texture.source.dataReady=pixels.dataReady;active.texture.needsUpdate=true;
      }
      group.pixels=pixels;group.version=source.version;group.dataVersion=pixels.version;group.image=pixels.data;group.ready=pixels.dataReady;
    }
    if(sample?.source!==source||sample.filter!==filter||sample.address!==address){
      const key=filter+':'+address;sample=group.samples.get(key);
      if(!sample){
        const texture=source.clone(),mode=filter==='nearest'?THREE.NearestFilter:THREE.LinearFilter;
        texture.source=new THREE.Source(pixels.data);texture.source.dataReady=pixels.dataReady;
        texture.minFilter=texture.magFilter=mode;texture.generateMipmaps=false;
        texture.wrapS=texture.wrapT=address==='repeat'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;texture.needsUpdate=true;
        group.dataVersion=pixels.version; // cloning touched the shared source version
        sample={source,group,key,filter,address,texture,users:0};group.samples.set(key,sample);samplerBuilds++;
      }
      sample.users++;releaseSampler(record);record.sampler=sample;
    }
    return sample.texture;
  }
  function dispose(record){scene.remove(record.mesh);releaseSampler(record);record.mesh.geometry.dispose();record.mesh.material.dispose();record.mesh.dispose();}
  // Compare shader source strings directly. Serializing both stages per mesh
  // per draw used to escape thousands of unchanged characters each time.
  const interfaces=new WeakMap();
  function shaderInterface(definition,leased){
    if(!definition)return null;
    if(leased&&interfaces.has(definition))return interfaces.get(definition);
    const key=JSON.stringify([definition.attributes??[],definition.varyings??[],
      Object.entries(definition.uniforms??{}).map(([name,value])=>[name,Array.isArray(value)?value.length:1]),
      Object.entries(definition.samplers??{}).map(([name,sampler])=>[name,sampler.type??'float'])]);
    // The publication owns a deeply frozen tree. Other callers may mutate a
    // definition in place, so their interface must be read on every draw.
    if(leased)interfaces.set(definition,key);
    return key;
  }
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
  function update(id,record,mesh,materials){
    const views=geometry3dViews(mesh,memory,materials),geometry=record.mesh.geometry;
    const interleaved=geometry.attributes.position.data,index=geometry.index;
    const vertexCapacity=interleaved.array.length/interleaved.stride,indexCapacity=index.array.length;
    const topologyChanged=interleaved.count!==mesh.vertex_count||index.count!==mesh.index_count;
    if(mesh.vertex_count>vertexCapacity||mesh.index_count>indexCapacity){
      record.mesh.geometry=buildGeometry(mesh,views,growCapacity(vertexCapacity,mesh.vertex_count,MAX_VERTICES),
        growCapacity(indexCapacity,mesh.index_count,MAX_INDICES));
      geometry.dispose();bufferGrowths++;
    }else{
      const {vertices,indices}=views;
      new Uint8Array(interleaved.array.buffer,interleaved.array.byteOffset,vertices.byteLength).set(vertices);
      markPrefix(interleaved,mesh.vertex_count*interleaved.stride);
      const current=new Uint8Array(index.array.buffer,index.array.byteOffset,indices.byteLength);
      if(!sameBytes(current,indices)){current.set(indices);markPrefix(index,mesh.index_count);}
      if(topologyChanged){
        interleaved.count=mesh.vertex_count;index.count=mesh.index_count;
        geometry.setDrawRange(0,mesh.index_count);geometry.boundingBox=null;geometry.computeBoundingSphere();
      }
    }
    if(topologyChanged){
      record.mesh.boundingSphere=null;record.mesh.boundingBox=null;
      const active=record.mesh.geometry,position=active.attributes.position.data,index=active.index;
      const vertexCapacity=position.array.length/position.stride;
      const vertices=trimmedCapacity(vertexCapacity,position.count,position.stride*4)<vertexCapacity;
      const indices=trimmedCapacity(index.array.length,index.count,4)<index.array.length;
      if(vertices||indices){
        const previous=pendingTrims.get(id);
        if(!previous||previous.vertices!==vertices||previous.indices!==indices){
          pendingTrims.delete(id);pendingTrims.set(id,{deadline:now()+TRIM_IDLE_MS,vertices,indices});
        }
      }else pendingTrims.delete(id);
    }
    updates++;
  }
  // Only meshes that have fallen far below their high-water mark enter the
  // queue. Repeated growth cancels retirement; stationary meshes need no scan.
  function trimIdleBuffers(meshes,materials){
    if(!pendingTrims.size)return;
    const [id,{deadline}]=pendingTrims.entries().next().value,time=now();
    if(time<deadline||time<nextTrim)return;
    const record=records.get(id),geometry=record.mesh.geometry,v=geometry.attributes.position.data,index=geometry.index;
    const vertexCapacity=trimmedCapacity(v.array.length/v.stride,v.count,v.stride*4);
    const indexCapacity=trimmedCapacity(index.array.length,index.count,4);
    const mesh=meshes[id],views={...layoutOf(mesh,materials),aliased:true,
      vertices:new Uint8Array(v.array.buffer,v.array.byteOffset,v.count*v.stride*4),
      indices:new Uint8Array(index.array.buffer,index.array.byteOffset,index.count*4)};
    record.mesh.geometry=buildGeometry(mesh,views,vertexCapacity,indexCapacity,geometry);
    trimmedBytes+=v.array.byteLength+index.array.byteLength-(vertexCapacity*v.stride+indexCapacity)*4;
    bufferTrims++;pendingTrims.delete(id);nextTrim=time+TRIM_INTERVAL_MS;geometry.dispose();
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
  function buildGeometry(mesh,views,vertexCapacity,indexCapacity,previousBounds){
    const {vertices,indices,stride,billboard,attributes}=ownedArrays(views,vertexCapacity,indexCapacity),geometry=new THREE.BufferGeometry();
    const interleaved=new THREE.InterleavedBuffer(vertices,stride),at=billboard?2:0;
    interleaved.count=mesh.vertex_count;
    geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
    if(billboard)geometry.setAttribute('unoneOffset',new THREE.InterleavedBufferAttribute(interleaved,2,3));
    geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(interleaved,2,3+at));
    geometry.setAttribute('color',new THREE.InterleavedBufferAttribute(interleaved,4,5+at));
    for(const a of attributes)geometry.setAttribute(a.name,new THREE.InterleavedBufferAttribute(interleaved,a.size,a.offset));
    const index=new THREE.BufferAttribute(indices,1);index.count=mesh.index_count;
    geometry.setIndex(index);geometry.setDrawRange(0,mesh.index_count);
    if(previousBounds){geometry.boundingSphere=previousBounds.boundingSphere;geometry.boundingBox=previousBounds.boundingBox;}
    else geometry.computeBoundingSphere();
    return geometry;
  }
  function build(mesh,capacity,materials){
    const views=geometry3dViews(mesh,memory,materials),geometry=buildGeometry(mesh,views,mesh.vertex_count,mesh.index_count);
    const {billboard}=views;
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
    const leasedMaterials=worldFieldPublication(materials),leasedPlacements=worldFieldPublication(placements);
    shared.unone_time.value=Number(world.time_seconds??0);shared.unone_frame.value=Number(world.frame??0);
    // Undo the host's left-handed root mirror (world3d scale z = -1) for game shaders.
    shared.unone_handedness.value.makeScale(1,1,world.camera3d?.handedness==='left'?-1:1);
    for(const [id,mesh]of Object.entries(meshes??{})){
      alive.add(id);const placement=placements?.[id],transforms=placement?.transforms??AT_ORIGIN;
      const shader=mesh.material?.shader,definition=materials?.[shader];
      const vertex=definition?.vertex??null,fragment=definition?.fragment??null;
      const layout=shaderInterface(definition,leasedMaterials);
      const shape=JSON.stringify([mesh.format,mesh.texture??null,mesh.material??null]);
      const revision=String(mesh.revision);
      let record=records.get(id);
      if(!record||record.capacity<transforms.length||record.shape!==shape||record.layout!==layout||
          record.vertex!==vertex||record.fragment!==fragment){
        const capacity=2**Math.ceil(Math.log2(Math.max(1,transforms.length)));
        const previous=record;
        record={revision,capacity,shape,layout,vertex,fragment,mesh:build(mesh,capacity,materials),placement:null,sampler:null};
        if(previous){
          pendingTrims.delete(id);
          if(mesh.texture){record.sampler=previous.sampler;previous.sampler=null;}
          dispose(previous);
        }
        records.set(id,record);scene.add(record.mesh);
      }else if(record.revision!==revision||record.mesh.geometry.attributes.position.count!==mesh.vertex_count||record.mesh.geometry.index.count!==mesh.index_count){
        update(id,record,mesh,materials);record.revision=revision;
      }
      const instanced=record.mesh,key=leasedPlacements?transforms:JSON.stringify(transforms);
      let ready=true;
      if(shader){applyMeshShaderValues(instanced.material,materials[shader]);if(!bindSamplers(instanced.material,materials[shader],specs)){ready=false;pending=true;}}
      if(record.placement!==key){
        if(!leasedPlacements||!Array.isArray(record.placement)||!sameTransforms(record.placement,transforms)){
          transforms.forEach((t,i)=>{object.position.set(t.position.x,t.position.y,t.position.z);object.rotation.set(t.rotation.x,t.rotation.y,t.rotation.z);
            object.scale.set(t.scale.x,t.scale.y,t.scale.z);object.updateMatrix();instanced.setMatrixAt(i,object.matrix);});
          instanced.count=transforms.length;instanced.instanceMatrix.needsUpdate=true;
        }
        record.placement=key;
      }
      if(mesh.texture){
        const spec=specs.get(mesh.texture);if(spec?.kind!=='texture2d')throw Error(`GEOMETRY3D_TEXTURE_MISSING: ${mesh.texture}`);
        const texture=textureFor(spec);if(!texture)throw Error(`GEOMETRY3D_TEXTURE_LOADER_MISSING: ${mesh.texture}`);if(texture.error)throw texture.error;
        const loaded=texture.state==='ready';ready&&=loaded;
        if(loaded){const m=mesh.material??{},map=sampled(record,texture.texture,m.filter??'linear',m.address??'clamp');
          if(shader)instanced.material.uniforms.unone_texture.value=map;
          else if(instanced.material.map!==map){instanced.material.map=map;instanced.material.needsUpdate=true;}}
        else pending=true;
      }
      // An untextured mesh draws at once; a textured one waits for its image.
      instanced.visible=placement?.visible!==false&&ready&&transforms.length>0;
    }
    for(const [id,record]of records)if(!alive.has(id)){dispose(record);records.delete(id);pendingTrims.delete(id);}
    trimIdleBuffers(meshes,materials);
    return pending;
  }
  return {draw,
    // The area the world draws into, in drawing-buffer pixels (lower-left origin).
    viewport(x,y,width,height){const v=shared.unone_viewport.value;v[0]=x;v[1]=y;v[2]=Math.max(1,width);v[3]=Math.max(1,height);},
    contextLost(retire){const samplers=new Set();
      for(const record of records.values()){retire(record.mesh.geometry);retire(record.mesh.material);if(record.sampler)samplers.add(record.sampler.texture);}
      for(const texture of samplers)retire(texture);if(white)retire(white);},
    clear(){for(const record of records.values())dispose(record);records.clear();pendingTrims.clear();nextTrim=0;white?.dispose();white=null;},
    metrics:()=>({geometry3d_meshes:records.size,geometry3d_rebuilds:rebuilds,geometry3d_updates:updates,geometry3d_buffer_growths:bufferGrowths,
      geometry3d_pending_buffer_trims:pendingTrims.size,geometry3d_buffer_trims:bufferTrims,geometry3d_trimmed_bytes:trimmedBytes,
      geometry3d_sampler_variants:samplerBuilds-samplerDisposes,geometry3d_sampler_builds:samplerBuilds,geometry3d_sampler_disposes:samplerDisposes})};
}

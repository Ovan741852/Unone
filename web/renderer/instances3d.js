// Generic packed transform batches. No gameplay, unit types or targeting here.
export function instanceView(batch,memory){
  if(!Number.isSafeInteger(batch.count)||batch.count<0||batch.count>100000)throw new Error('INSTANCE_BUFFER_INVALID: count');
  if(batch.memory){
    const {offset,byte_length,revision}=batch.memory,buffer=memory?.();
    if(!(buffer instanceof ArrayBuffer)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(byte_length)||byte_length!==batch.count*40||typeof revision!=='string'||!/^[0-9]{1,20}$/.test(revision)||offset+byte_length>buffer.byteLength)throw new Error('INSTANCE_MEMORY_INVALID: invalid pointer, length or memory provider');
    return new DataView(buffer,offset,byte_length);
  }
  const raw=atob(batch.data),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  if(bytes.length!==batch.count*40)throw new Error('INSTANCE_BUFFER_INVALID');
  return new DataView(bytes.buffer);
}
export function createInstanceRenderer(THREE,scene,assetFor,memory){
  const records=new Map(),object=new THREE.Object3D();let count=0;
  function draw(batches,specs){
    count=0;const alive=new Set();
    for(const [id,batch] of Object.entries(batches??{})){
      if(batch.format!=='f32le-p3-q4-s3-v1')throw new Error('INSTANCE_FORMAT_UNSUPPORTED: '+batch.format);
      alive.add(id);const asset=assetFor(batch.asset,specs);if(asset.error)throw asset.error;if(!asset.geometry)continue;
      let r=records.get(id);
      if(r&&(r.asset!==batch.asset||r.capacity<batch.count)){scene.remove(r.mesh);r.mesh.dispose();records.delete(id);r=null;}
      if(!r){const mesh=new THREE.InstancedMesh(asset.geometry,asset.material,Math.max(1,batch.count));mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;scene.add(mesh);r={mesh,asset:batch.asset,capacity:Math.max(1,batch.count),data:null};records.set(id,r);}
      r.mesh.count=batch.count;count+=batch.count;
      const key=batch.memory?'memory:'+batch.memory.revision:'json:'+batch.data;
      if(r.data===key)continue;
      const view=instanceView(batch,memory);
      for(let i=0;i<batch.count;i++){
        const o=i*40,f=j=>view.getFloat32(o+j*4,true);
        object.position.set(f(0),f(1),f(2));object.quaternion.set(f(3),f(4),f(5),f(6));object.scale.set(f(7),f(8),f(9));object.updateMatrix();r.mesh.setMatrixAt(i,object.matrix);
      }
      r.mesh.instanceMatrix.needsUpdate=true;r.data=key;
    }
    for(const [id,r]of records)if(!alive.has(id)){scene.remove(r.mesh);r.mesh.dispose();records.delete(id);}
  }
  return {draw,get count(){return count;},clear(){for(const r of records.values()){scene.remove(r.mesh);r.mesh.dispose();}records.clear();count=0;}};
}

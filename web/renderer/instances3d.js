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
// Render-only spatial cells. Mesh bounds include full rotated/scaled geometry,
// not just the cell itself, so objects crossing cell edges cannot disappear.
export function partitionInstances(view,count,cellSize=64){
  const cells=new Map();
  for(let i=0;i<count;i++){
    const o=i*40,key=Math.floor(view.getFloat32(o,true)/cellSize)+','+Math.floor(view.getFloat32(o+4,true)/cellSize)+','+Math.floor(view.getFloat32(o+8,true)/cellSize);
    let ids=cells.get(key);if(!ids){ids=[];cells.set(key,ids);}ids.push(i);
  }
  return cells;
}
export function createInstanceRenderer(THREE,scene,assetFor,memory){
  const records=new Map(),rendered=new Set(),object=new THREE.Object3D();let count=0;
  const dispose=r=>{for(const c of r.cells.values()){scene.remove(c.mesh);c.mesh.dispose();}};
  function draw(batches,specs){
    count=0;rendered.clear();const alive=new Set();
    for(const [id,batch] of Object.entries(batches??{})){
      if(batch.format!=='f32le-p3-q4-s3-v1')throw new Error('INSTANCE_FORMAT_UNSUPPORTED: '+batch.format);
      alive.add(id);const asset=assetFor(batch.asset,specs);if(asset.error)throw asset.error;if(!asset.geometry)continue;
      let r=records.get(id);
      if(r&&r.asset!==batch.asset){dispose(r);records.delete(id);r=null;}
      if(!r){r={asset:batch.asset,cells:new Map(),data:null,count:0};records.set(id,r);}
      count+=batch.count;
      const key=batch.memory?'memory:'+batch.memory.revision:'json:'+batch.data;
      if(r.data===key&&r.count===batch.count)continue;
      const view=instanceView(batch,memory),cells=partitionInstances(view,batch.count);
      for(const [cell,ids] of cells){
        let c=r.cells.get(cell);
        if(c&&c.capacity<ids.length){scene.remove(c.mesh);c.mesh.dispose();r.cells.delete(cell);c=null;}
        if(!c){
          const capacity=2**Math.ceil(Math.log2(Math.max(1,ids.length)));
          const mesh=new THREE.InstancedMesh(asset.geometry,asset.material,capacity);
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=true;
          mesh.onBeforeRender=()=>rendered.add(mesh);
          scene.add(mesh);c={mesh,capacity};r.cells.set(cell,c);
        }
        c.mesh.count=ids.length;
        if(!asset.geometry.boundingSphere)asset.geometry.computeBoundingSphere();
        const bounds=asset.geometry.boundingSphere,center=bounds.center;
        let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
        for(let n=0;n<ids.length;n++){
          const o=ids[n]*40,f=j=>view.getFloat32(o+j*4,true);
          object.position.set(f(0),f(1),f(2));object.quaternion.set(f(3),f(4),f(5),f(6));object.scale.set(f(7),f(8),f(9));object.updateMatrix();c.mesh.setMatrixAt(n,object.matrix);
          const m=object.matrix.elements;
          const x=m[0]*center.x+m[4]*center.y+m[8]*center.z+m[12],y=m[1]*center.x+m[5]*center.y+m[9]*center.z+m[13],z=m[2]*center.x+m[6]*center.y+m[10]*center.z+m[14];
          const radius=bounds.radius*Math.max(Math.abs(f(7)),Math.abs(f(8)),Math.abs(f(9)));
          minX=Math.min(minX,x-radius);minY=Math.min(minY,y-radius);minZ=Math.min(minZ,z-radius);
          maxX=Math.max(maxX,x+radius);maxY=Math.max(maxY,y+radius);maxZ=Math.max(maxZ,z+radius);
        }
        // Conservative bounds in the same pass as matrix packing. No second
        // per-instance matrix decode/transform pass just to perform culling.
        c.mesh.boundingSphere??=bounds.clone();
        c.mesh.boundingSphere.center.set((minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2);
        c.mesh.boundingSphere.radius=Math.hypot(maxX-minX,maxY-minY,maxZ-minZ)/2;
        c.mesh.instanceMatrix.needsUpdate=true;
      }
      for(const [cell,c] of r.cells)if(!cells.has(cell)){scene.remove(c.mesh);c.mesh.dispose();r.cells.delete(cell);}
      r.data=key;r.count=batch.count;
    }
    for(const [id,r]of records)if(!alive.has(id)){dispose(r);records.delete(id);}
  }
  return {draw,get count(){return count;},metrics(){let cells=0,submitted=0;for(const r of records.values())cells+=r.cells.size;for(const mesh of rendered)submitted+=mesh.count;return {instance_cells:cells,submitted_instance_cells:rendered.size,submitted_instances:submitted,culled_instances:count-submitted};},clear(){for(const r of records.values())dispose(r);records.clear();rendered.clear();count=0;}};
}

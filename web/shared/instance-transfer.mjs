// Renderer transport only. Canonical simulation observations are never modified.
export class InstanceTransfer {
  constructor(){this.revisions=new Map();this.retired=new Set();this.pool=[];this.poolBytes=0;this.serial=0;this.metrics={copied_bytes:0,allocated_bytes:0,reused_bytes:0,unchanged_batches:0};}
  recycle(buffers=[]){for(const b of buffers){if(!(b instanceof ArrayBuffer))throw Error('TRANSFER_RECYCLE_INVALID');if(this.pool.length<32&&this.poolBytes+b.byteLength<=16*1024*1024){this.pool.push(b);this.poolBytes+=b.byteLength;}}}
  reset(){for(const id of this.revisions.keys())this.retired.add(id);this.revisions.clear();}
  encode(value,heap){
    let snapshot=value?.world?value:value?.observation;
    if(!snapshot?.world)return {value,updates:[],removed:[]};
    snapshot={...snapshot,world:{...snapshot.world,instances3d:Object.fromEntries(Object.entries(snapshot.world.instances3d??{}).map(([id,b])=>[id,{...b,memory:b.memory?{...b.memory}:undefined}]))}};
    value=value.world?snapshot:{...value,observation:snapshot};
    const updates=[],alive=new Set();
    for(const [id,b] of Object.entries(snapshot.world.instances3d??{})){
      if(!b.memory)continue;alive.add(id);const m=b.memory,key=[b.asset,b.count,m.revision,m.byte_length].join('|');
      const old=this.revisions.get(id);let revision=old?.revision;
      if(old?.key!==key){
        if(!Number.isSafeInteger(m.byte_length)||m.byte_length<0||m.byte_length>4_000_000||!Number.isSafeInteger(m.offset)||m.offset<0||m.offset+m.byte_length>heap.byteLength)throw Error('TRANSFER_SOURCE_INVALID');
        const index=this.pool.findIndex(buffer=>buffer.byteLength===m.byte_length);
        let buffer;if(index<0){buffer=new ArrayBuffer(m.byte_length);this.metrics.allocated_bytes+=m.byte_length;}else{buffer=this.pool.splice(index,1)[0];this.poolBytes-=buffer.byteLength;this.metrics.reused_bytes+=buffer.byteLength;}
        new Uint8Array(buffer).set(new Uint8Array(heap,m.offset,m.byte_length));this.metrics.copied_bytes+=m.byte_length;
        revision=String(++this.serial);this.revisions.set(id,{key,revision});updates.push({id,buffer});
      }else this.metrics.unchanged_batches++;
      b.memory={...m,offset:0,buffer_id:id,revision};
    }
    const removed=[...this.retired].filter(id=>!alive.has(id));this.retired.clear();for(const id of this.revisions.keys())if(!alive.has(id)){this.revisions.delete(id);removed.push(id);}
    return {value,updates,removed};
  }
  report(){return {...this.metrics,pooled_bytes:this.poolBytes,pooled_buffers:this.pool.length};}
}
export class InstanceReceiver {
  constructor(){this.buffers=new Map();this.recycled=[];}
  accept(packet){for(const id of packet.removed??[]){const old=this.buffers.get(id);if(old)this.recycled.push(old);this.buffers.delete(id);}for(const {id,buffer}of packet.updates??[]){const old=this.buffers.get(id);if(old)this.recycled.push(old);this.buffers.set(id,buffer);}return packet.value;}
  memory(batch){const b=this.buffers.get(batch.memory.buffer_id);if(!b)throw Error('TRANSFER_BATCH_MISSING');return b;}
  takeRecycled(){return this.recycled.splice(0);}
}

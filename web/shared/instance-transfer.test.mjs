import test from 'node:test';
import assert from 'node:assert/strict';
import {InstanceTransfer,InstanceReceiver} from './instance-transfer.mjs';
test('delta transfer preserves source pointers and recycles replaced buffers',()=>{
 const t=new InstanceTransfer(),r=new InstanceReceiver(),heap=new Uint8Array(32);heap.set([1,2,3,4],8);
 const original={world:{instances3d:{a:{asset:'a',count:1,memory:{offset:8,byte_length:4,revision:'1'}}}}};
 const a=r.accept(t.encode(original,heap.buffer));assert.equal(original.world.instances3d.a.memory.offset,8);assert.deepEqual([...new Uint8Array(r.memory(a.world.instances3d.a))],[1,2,3,4]);
 assert.equal(t.encode(original,heap.buffer).updates.length,0);
 original.world.instances3d.a.memory.revision='2';r.accept(t.encode(original,heap.buffer));t.recycle(r.takeRecycled());
 original.world.instances3d.a.memory.revision='3';r.accept(t.encode(original,heap.buffer));assert.equal(t.report().reused_bytes,4);
 r.accept(t.encode({world:{instances3d:{}}},heap.buffer));assert.equal(r.takeRecycled().length,2);
});

test('reload retires buffers absent from the new project',()=>{
 const t=new InstanceTransfer(),r=new InstanceReceiver(),heap=new ArrayBuffer(40);
 const value={world:{instances3d:{old:{asset:'a',count:1,memory:{offset:0,byte_length:40,revision:'1'}}}}};
 r.accept(t.encode(value,heap));t.reset();
 r.accept(t.encode({world:{instances3d:{}}},heap));assert.equal(r.buffers.size,0);assert.equal(r.takeRecycled().length,1);
});

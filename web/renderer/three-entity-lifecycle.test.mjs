import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./three.js',import.meta.url),'utf8');
function body(start,end){const at=source.indexOf(start),until=source.indexOf(end,at);assert(at>=0&&until>at);return source.slice(at,until);}
const pruneSprites=new Function('records','alive','world','root',body('    for (const [id, record] of records) {','    shaderMaterials.retain('));
const pruneMeshes=new Function('meshes3d','alive3d','world','scene',body('    for (const [id,mesh] of meshes3d) {',"    profile?.mark('scene_sync');"));

test('production sprite synchronization releases despawned entities and preserves temporarily hidden sprites',()=>{
 const records=new Map(),attached=new Set();let disposed=0;
 const root={remove:mesh=>attached.delete(mesh)};
 for(let i=0;i<500;i++){
  const id='spawn-'+i,mesh={visible:true},record={mesh,material:{map:{},dispose(){disposed++;}}};records.set(id,record);attached.add(mesh);
  pruneSprites(records,new Set(),{entities:{[id]:{sprite:{visible:false}}}},root);
  assert.equal(records.size,1);assert.equal(disposed,i,'invisible existing entity retains its reusable material');
  pruneSprites(records,new Set(),{entities:{}},root);
  assert.equal(records.size,0);assert.equal(attached.size,0);assert.equal(disposed,i+1);
 }
});

test('production mesh synchronization releases despawned primitive ownership and preserves shared asset resources',()=>{
 const meshes3d=new Map(),attached=new Set();let geometries=0,materials=0;
 for(const [id,asset] of [['primitive','mesh://primitive/box'],['shared','actor']]){
  const mesh={userData:{asset},geometry:{dispose(){geometries++;}},material:{dispose(){materials++;}}};meshes3d.set(id,mesh);attached.add(mesh);
 }
 pruneMeshes(meshes3d,new Set(),{entities:{primitive:{mesh3d:{visible:false}},shared:{mesh3d:{visible:false}}}},{remove:m=>attached.delete(m)});
 assert.equal(meshes3d.size,2);assert.equal(geometries,0);
 pruneMeshes(meshes3d,new Set(),{entities:{}},{remove:m=>attached.delete(m)});
 assert.equal(meshes3d.size,0);assert.equal(attached.size,0);assert.equal(geometries,1);assert.equal(materials,1);
});

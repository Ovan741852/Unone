import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMesh,meshGeometry} from './mesh.js';
import * as THREE from '../vendor/three/three.core.js';

const triangle=()=>({version:1,positions:[0,0,0,1,0,0,0,1,0],uvs:[0,0,1,0,0,1],indices:[0,1,2],texture:'texture://test'});
test('mesh produces real indexed geometry with UVs and bounds',()=>{
  const geometry=meshGeometry(THREE,triangle());
  assert.equal(geometry.attributes.position.count,3);
  assert.equal(geometry.attributes.uv.count,3);
  assert.deepEqual([...geometry.index.array],[0,1,2]);
  assert.ok(geometry.boundingSphere.radius>0);
  geometry.dispose();
});
test('malformed meshes fail instead of rendering a placeholder',()=>{
  for(const patch of [{indices:[0,1,3]},{indices:[0,1]},{uvs:[0,1]},{positions:[Infinity,0,0]},{postions:[]},{version:2},{texture:''}]) {
    assert.throws(()=>validateMesh({...triangle(),...patch}),/MESH_INVALID/);
  }
});

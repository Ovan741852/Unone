import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {createShaderMaterials,fragmentSource} from './shader-materials.js';
const definition={fragment:'vec4 unoneShade(vec2 uv,vec4 color){return color*strength;}',uniforms:{strength:.5,tint:[1,.5,.2]}};

test('typed uniforms update without recompiling; entities keep independent textures and release resources',()=>{
 const renderer={debug:{}},pool=createShaderMaterials(THREE,renderer,'webgl');
 const a={id:'a',shader_material:'shield'},b={id:'b',shader_material:'shield'};
 const mapA=new THREE.Texture(),mapB=new THREE.Texture();
 const baseA=new THREE.MeshBasicMaterial({map:mapA,color:0xffffff}),baseB=new THREE.MeshBasicMaterial({map:mapB,color:0xffffff});
 const world={frame:12,time_seconds:.2,shader_materials:{shield:structuredClone(definition)}};
 const first=pool.assign(a,baseA,world),second=pool.assign(b,baseB,world);
 assert.notEqual(first,second);assert.equal(first.uniforms.unone_texture.value,mapA);assert.equal(second.uniforms.unone_texture.value,mapB);
 world.shader_materials.shield.uniforms.strength=.9;world.frame=13;
 assert.equal(pool.assign(a,baseA,world),first);assert.equal(first.uniforms.strength.value,.9);assert.equal(first.uniforms.unone_frame.value,13);
 let disposed=0;first.addEventListener('dispose',()=>disposed++);pool.retain(new Set(['b']));assert.equal(disposed,1);assert.equal(pool.count,1);
 assert.equal(pool.assign({id:'a'},baseA,world),baseA);pool.dispose();assert.equal(renderer.debug.onShaderError,undefined);assert.equal(pool.count,0);
 baseA.dispose();baseB.dispose();mapA.dispose();mapB.dispose();
});

test('declaration errors, unavailable backends and GPU compiler failures surface explicit diagnostics',()=>{
 assert.match(fragmentSource('shield',definition),/uniform vec3 tint;/);
 assert.throws(()=>fragmentSource('bad',{...definition,uniforms:{unone_time:1}}),/SHADER_UNIFORM_INVALID/);
 assert.throws(()=>fragmentSource('bad',{...definition,uniforms:{value:[1,2,3,4,5]}}),/SHADER_UNIFORM_INVALID/);
 const renderer={debug:{}},pool=createShaderMaterials(THREE,renderer,'webgpu'),base=new THREE.MeshBasicMaterial();
 assert.throws(()=>pool.assign({id:'ship',shader_material:'shield'},base,{shader_materials:{shield:definition}}),/SHADER_BACKEND_UNSUPPORTED/);
 const gl={getShaderSource:()=> '// UNONE_MATERIAL:shield',getProgramInfoLog:()=> 'link error',getShaderInfoLog:()=> 'syntax error',deleteShader(){}};
 assert.throws(()=>renderer.debug.onShaderError(gl,{}, {}, {}),/SHADER_COMPILE_FAILED: shield/);pool.dispose();base.dispose();
});

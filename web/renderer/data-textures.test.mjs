import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.core.js';
import {createDataTextures,dataTextureBytes} from './data-textures.js';
import {createGeometry3DRenderer} from './geometry3d.js';
import {createWorldCurvature} from './world-curvature.js';

const base64=bytes=>Buffer.from(bytes).toString('base64');
const ints=values=>new Uint8Array(new Int32Array(values).buffer);

test('data textures upload exact texels once per revision and never alias the heap',()=>{
  const heap=new ArrayBuffer(64),textures=createDataTextures(THREE,{memory:()=>heap});
  textures.sync({heights:{width:2,height:2,format:'r32i',revision:1,data:base64(ints([0,-1,65536,-32768]))}});
  const first=textures.get('heights');
  assert.deepEqual([first.format,first.type,first.internalFormat,first.magFilter,first.flipY],[THREE.RedIntegerFormat,THREE.IntType,'R32I',THREE.NearestFilter,false]);
  assert.deepEqual([...first.image.data],[0,-1,65536,-32768]);
  first.image.data[0]=7;textures.sync({heights:{width:2,height:2,format:'r32i',revision:1,data:base64(ints([9,9,9,9]))}});
  assert.equal(textures.get('heights').image.data[0],7,'an unchanged revision uploads nothing');
  textures.sync({heights:{width:2,height:2,format:'r32i',revision:2,data:base64(ints([1,2,3,4]))}});
  assert.equal(textures.get('heights'),first,'same-shape revisions reuse the texture');assert.deepEqual([...first.image.data],[1,2,3,4]);
  new Uint8Array(heap).set(new Uint8Array(new Float32Array([0.5,1,2,3]).buffer),16);
  const view={width:1,height:1,format:'rgba32f',revision:3,memory:{offset:16,byte_length:16}};
  textures.sync({heights:{...view}});
  assert.notEqual(textures.get('heights'),first,'a new shape replaces the texture');
  assert.deepEqual([...textures.zero('int').image.data],[0]);
  const copied=dataTextureBytes(view,()=>heap);new Uint8Array(heap).fill(0);assert.equal(new Float32Array(copied.buffer)[0],0.5,'texels are copied out of the heap');
  assert.throws(()=>dataTextureBytes({...view,width:2},()=>heap),/DATA_TEXTURE_INVALID/);
  assert.throws(()=>dataTextureBytes({...view,format:'r16'},()=>heap),/DATA_TEXTURE_INVALID/);
  assert.equal(createDataTextures(THREE).metrics().data_textures,0);
  textures.sync({});assert.equal(textures.get('heights'),undefined);assert.equal(textures.metrics().data_texture_uploads,3);
});

test('mesh samplers read their bound data texture, an asset, or zero when unbound',()=>{
  const scene=new THREE.Scene(),dataTextures=createDataTextures(THREE),image={state:'pending',texture:new THREE.Texture()};
  const renderer=createGeometry3DRenderer(THREE,scene,{textureFor:()=>image,curvature:createWorldCurvature(),dataTextures});
  const v=new Float32Array(27);for(let i=0;i<3;i++)v.set([i,0,0,0,0,1,1,1,1],i*9);
  const mesh={format:'f32le-p3-uv2-rgba4-u32-v1',vertex_count:3,index_count:3,revision:1,material:{shader:'land'},
    vertices:base64(new Uint8Array(v.buffer)),indices:base64(new Uint8Array(new Uint32Array([0,1,2]).buffer))};
  const land=samplers=>({vertex:'vec4 unoneVertex(vec3 position, mat4 model){return vec4(float(texelFetch(heights,ivec2(0),0).x),0.0,0.0,1.0);}',
    fragment:'vec4 unoneShade(vec2 uv, vec4 color){return color*texture2D(ground,uv);}',samplers});
  const specs=new Map([['texture://ground',{kind:'texture2d'}]]);
  dataTextures.sync({heights:{width:1,height:1,format:'r32i',revision:1,data:base64(ints([5]))},palette:{width:1,height:1,format:'rgba8',revision:1,data:base64(new Uint8Array(4))}});
  const bound={heights:{type:'int',source:{data:'heights'}},ground:{type:'float',source:{asset:'texture://ground'}}};
  assert.equal(renderer.draw({land:mesh},{},specs,{shader_materials:{land:land(bound)}}),true,'an asset sampler waits for its image');
  const drawn=scene.children[0],uniforms=drawn.material.uniforms;
  assert.ok(drawn.material.vertexShader.includes('uniform highp isampler2D heights;')&&drawn.material.fragmentShader.includes('uniform highp sampler2D ground;'));
  assert.equal(uniforms.heights.value,dataTextures.get('heights'));assert.equal(drawn.visible,false);
  image.state='ready';renderer.draw({land:mesh},{},specs,{shader_materials:{land:land(bound)}});
  assert.equal(uniforms.ground.value,image.texture);assert.equal(drawn.visible,true);
  renderer.draw({land:mesh},{},specs,{shader_materials:{land:land({heights:{type:'int'},ground:{type:'float'}})}});
  assert.equal(scene.children[0],drawn,'binding changes never rebuild the program');
  assert.deepEqual([uniforms.heights.value,uniforms.ground.value],[dataTextures.zero('int'),dataTextures.zero('float')]);
  assert.throws(()=>renderer.draw({land:mesh},{},specs,{shader_materials:{land:land({...bound,heights:{type:'int',source:{data:'missing'}}})}}),/DATA_TEXTURE_MISSING/);
  assert.throws(()=>renderer.draw({land:mesh},{},specs,{shader_materials:{land:land({...bound,heights:{type:'int',source:{data:'palette'}}})}}),/SHADER_TEXTURE_TYPE/);
});

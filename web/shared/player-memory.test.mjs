// The player's memory owners: one row per owner, saying what its number is and
// which other owners hold the same bytes, so a reader never adds them up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {playerMemorySnapshot} from './player-memory.mjs';
import {createRuntimeCore} from './runtime-core.mjs';
import {createAudioPlayback} from './audio-playback.js';

const MiB=1024*1024;
const sources={
 backend:{backend:'main',wasm_linear_bytes:64*MiB,luau_heap_bytes:3*MiB},
 images:{resident_entries:5,resident_bytes_estimate:20*MiB,active_entries:3,active_bytes_estimate:12*MiB,scene_entries:1,scene_bytes_estimate:4*MiB,unused_entries:2,unused_bytes_estimate:8*MiB,
  loading_metrics:{failed:0},groups:{held_entries:3,held_bytes_estimate:12*MiB}},
 renderer:{textures:9,geometries:4,bloom:false,bloom_resolution:[640,360],texture_cache:{entries:2,decoded_texture_bytes_estimate:6*MiB,pinned_bytes_estimate:2*MiB},
  sprite_resources:{supported:true,live_textures:2,gpu_reserved_bytes_estimate:6*MiB,image_leases:2,errors:0},
  ui_image_batches:{live_textures:3,live_geometries:1,live_meshes:1,live_materials:1,buffer_capacity_quads:64,image_leases:3}},
 ui:{decoded_rgba_bytes_estimate:4*MiB,assets:[{id:'a',state:'ready'},{id:'b',state:'error'}]},
 audio:{available:true,assets:2,decoded_bytes_estimate:1000},
 drawingBuffer:[1280,720],
};
const byId=snapshot=>Object.fromEntries(snapshot.owners.map(row=>[row.id,row]));

test('each owner says what its number is and what it is part of',()=>{
 const snapshot=playerMemorySnapshot(sources),rows=byId(snapshot);
 assert.equal(snapshot.version,1);
 assert.deepEqual([rows['wasm.linear_memory'].basis,rows['wasm.linear_memory'].bytes],['capacity',64*MiB]);
 assert.deepEqual([rows['luau.heap'].basis,rows['luau.heap'].bytes,rows['luau.heap'].within],['live',3*MiB,'wasm.linear_memory']);
 for(const id of ['images.decoded.active','images.decoded.scene','images.decoded.groups','images.decoded.inactive_cache'])assert.equal(rows[id].within,'images.decoded.resident',id);
 assert.deepEqual(rows['images.decoded.active'].overlaps,['images.decoded.scene','images.decoded.groups']);
 assert.deepEqual(rows['images.decoded.inactive_cache'].overlaps,[],'the inactive cache holds only what no owner leases');
 assert.deepEqual([rows['images.decoded.groups'].bytes,rows['images.decoded.groups'].entries],[12*MiB,3]);
 assert.deepEqual([rows['images.decoded.inactive_cache'].bytes,rows['images.decoded.inactive_cache'].entries],[8*MiB,2]);
 assert.deepEqual([rows['canvas_ui.images'].within,rows['canvas_ui.images'].entries],['images.decoded.active',2]);
 assert.deepEqual([rows['gpu.textures'].basis,rows['gpu.textures'].entries,rows['gpu.textures'].bytes],['count',9,null],'WebGL hides texture bytes');
 assert.equal(rows['gpu.geometries'].entries,4);
 assert.deepEqual([rows['gpu.world_textures'].within,rows['gpu.world_textures'].pinned_bytes],['gpu.textures',2*MiB]);
 assert.deepEqual([rows['gpu.ui_prefix'].entries,rows['gpu.ui_prefix'].image_leases,rows['gpu.ui_prefix'].buffer_capacity_quads],[3,3,64]);
 assert.deepEqual([rows['render_targets.drawing_buffer'].basis,rows['render_targets.drawing_buffer'].bytes],['lower_bound',1280*720*4]);
 assert.deepEqual([rows['render_targets.post'].enabled,rows['render_targets.post'].size],[false,null],'no post targets while bloom is off');
 assert.equal(rows['audio.decoded'].bytes,1000);
 assert.deepEqual([rows['js.heap'].basis,rows['js.heap'].bytes],['external',null]);
 assert.deepEqual(snapshot.failures,{image_loads_failed:0,sprite_errors:0,ui_image_errors:1});
 assert.ok(snapshot.unmeasured.some(row=>row.id==='gpu.driver')&&snapshot.unmeasured.some(row=>row.id==='browser.process'));
 assert.match(snapshot.scope,/Never add rows/);
 assert.throws(()=>{snapshot.owners[0].bytes=1;},TypeError);
});

test('an owner the host did not report is null, never zero or a guess',()=>{
 const rows=byId(playerMemorySnapshot({backend:{wasm_linear_bytes:1024}}));
 assert.equal(rows['luau.heap'].bytes,null,'an older runtime without the export');
 assert.equal(rows['images.decoded.resident'].bytes,null);
 assert.equal(rows['gpu.textures'].entries,null);
 assert.equal(rows['render_targets.drawing_buffer'].bytes,null);
 assert.equal(rows['audio.decoded'].bytes,null);
 assert.equal(byId(playerMemorySnapshot({audio:{available:false,assets:0}}))['audio.decoded'].bytes,0,'no audio context holds nothing');
 assert.equal(byId(playerMemorySnapshot({renderer:{sprite_resources:{supported:false}}}))['gpu.sprite_textures'].bytes,null);
 assert.equal(byId(playerMemorySnapshot({backend:{wasm_linear_bytes:-1,luau_heap_bytes:Number.NaN}}))['wasm.linear_memory'].bytes,null);
});

test('runtime core reads the Luau heap without collecting, and null without the export',async()=>{
 const encoder=new TextEncoder();let length=0,reads=0;
 const module={HEAPU8:new Uint8Array(65536),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>length};
 const publish=()=>{const bytes=encoder.encode(JSON.stringify({world:{frame:0,instances3d:{}}}));module.HEAPU8.set(bytes,4096);length=bytes.length;return 0;};
 module._unone_web_load_project=publish;module._unone_web_set_instance_transport=publish;
 const core=createRuntimeCore(module);
 assert.deepEqual(core.memory(),{wasm_linear_bytes:65536,luau_heap_bytes:null});
 module._unone_web_luau_heap_bytes=()=>{reads++;return 4096;};
 assert.deepEqual(core.memory(),{wasm_linear_bytes:65536,luau_heap_bytes:4096});
 module._unone_web_luau_heap_bytes=()=>-1;
 assert.equal(core.memory().luau_heap_bytes,null,'no runtime loaded');
 assert.equal(reads,1);
});

test('audio reports decoded PCM bytes, or null when a buffer hides its size',async()=>{
 const context=(buffer)=>({state:'running',destination:{},createGain:()=>({gain:{value:1},connect:next=>next}),decodeAudioData:async()=>buffer});
 const make=buffer=>createAudioPlayback({assetManifest:{assets:[{id:'a',kind:'audio',source:'a.wav',encoding:{format:'wav',mime:'audio/wav',decoder:'audio'}}]},
  audioContextFactory:()=>context(buffer),loadAssetBytes:async()=>new Uint8Array(4)});
 assert.equal((await make({length:48000,numberOfChannels:2})).report().decoded_bytes_estimate,48000*2*4);
 assert.equal((await make({decoded:4})).report().decoded_bytes_estimate,null);
});

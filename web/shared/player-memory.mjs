// One read of the official Web player's memory owners and how they overlap.
// It never adds owners up: they share pixels, live in different heaps, and the
// browser, OS and GPU driver keep copies the page cannot see. Each row says what
// its number is (capacity, live, estimate, count, lower bound) and where it came
// from; an owner this host did not report is null, never a guess.
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const UNMEASURED=Object.freeze([
 Object.freeze({id:'browser.process',reason:'Renderer and GPU process memory is visible only to the OS; measure-web-export reads it per process at checkpoints.'}),
 Object.freeze({id:'gpu.driver',reason:'WebGL hides texture, buffer and render-target allocation sizes; the driver may pad, mip or duplicate them.'}),
 Object.freeze({id:'browser.image_copies',reason:'The browser may keep encoded bytes and its own decoded copy beside the broker estimate, and frees a retired HTML image when it chooses.'}),
 Object.freeze({id:'browser.compositor',reason:'Swap chain, compositor and canvas backing copies are not exposed to the page.'}),
]);
const SCOPE='Owners measured at one moment. within: this owner is part of that one. overlaps: these owners can hold the same bytes. Never add rows; logical release (closed_images, released_bytes_estimate) is not memory returned to the OS.';

/** @param {{backend?:object|null,images?:object|null,renderer?:object|null,ui?:object|null,audio?:object|null,drawingBuffer?:number[]|null}} sources */
export function playerMemorySnapshot({backend=null,images=null,renderer=null,ui=null,audio=null,drawingBuffer=null}={}){
 const owners=[];
 const add=(id,basis,{bytes=null,entries=null,within=null,overlaps=[],source,note=null,...extra})=>owners.push(Object.freeze({id,basis,bytes,entries,within,overlaps:Object.freeze(overlaps),source,...extra,...(note?{note}:{})}));
 add('wasm.linear_memory','capacity',{bytes:finite(backend?.wasm_linear_bytes),source:'backend.wasm_linear_bytes',note:'Linear memory only grows; it holds the Luau VM, engine state and published buffers.'});
 add('luau.heap','live',{bytes:finite(backend?.luau_heap_bytes),within:'wasm.linear_memory',source:'backend.luau_heap_bytes',note:'Main Luau VM in use, garbage not yet collected included; reading it never collects.'});
 const groups=images?.groups;
 add('images.decoded.resident','estimate',{bytes:finite(images?.resident_bytes_estimate),entries:count(images?.resident_entries),source:'image broker report',note:'width × height × 4 per decoded image the broker holds.'});
 add('images.decoded.active','estimate',{bytes:finite(images?.active_bytes_estimate),entries:count(images?.active_entries),within:'images.decoded.resident',overlaps:['images.decoded.scene','images.decoded.groups'],source:'image broker report',note:'Images some consumer (world texture, Canvas UI, GPU UI prefix, cursor, group) has leased.'});
 add('images.decoded.scene','estimate',{bytes:finite(images?.scene_bytes_estimate),entries:count(images?.scene_entries),within:'images.decoded.resident',overlaps:['images.decoded.active','images.decoded.groups'],source:'image broker report'});
 add('images.decoded.groups','estimate',{bytes:finite(groups?.held_bytes_estimate),entries:count(groups?.held_entries),within:'images.decoded.resident',overlaps:['images.decoded.active','images.decoded.scene'],source:'image group manager',note:'Images held by preload/load groups, shared images counted once.'});
 add('images.decoded.inactive_cache','estimate',{bytes:finite(images?.unused_bytes_estimate),entries:count(images?.unused_entries),within:'images.decoded.resident',source:'image broker report',note:'Ready images no owner holds, kept by the bounded LRU.'});
 add('canvas_ui.images','estimate',{bytes:finite(ui?.decoded_rgba_bytes_estimate),entries:Array.isArray(ui?.assets)?ui.assets.length:null,within:'images.decoded.active',source:'Canvas UI report',note:'Decoded images the current Canvas UI composition borrows.'});
 const textures=count(renderer?.textures);
 add('gpu.textures','count',{entries:textures,source:'three.js renderer.info.memory.textures',note:'Every live renderer texture, render targets and data textures included; WebGL hides their bytes.'});
 add('gpu.geometries','count',{entries:count(renderer?.geometries),source:'three.js renderer.info.memory.geometries'});
 const cache=renderer?.texture_cache;
 add('gpu.world_textures','estimate',{bytes:finite(cache?.decoded_texture_bytes_estimate),entries:count(cache?.entries),within:'gpu.textures',overlaps:['gpu.sprite_textures'],source:'renderer texture_cache',pinned_bytes:finite(cache?.pinned_bytes_estimate),note:'Upload-size estimate of cached world textures, not driver allocation.'});
 const sprites=renderer?.sprite_resources;
 add('gpu.sprite_textures','estimate',{bytes:sprites?.supported===false?null:finite(sprites?.gpu_reserved_bytes_estimate),entries:sprites?.supported===false?null:count(sprites?.live_textures),within:'gpu.textures',overlaps:['gpu.world_textures'],source:'renderer sprite_resources',image_leases:count(sprites?.image_leases)});
 const prefix=renderer?.ui_image_batches;
 add('gpu.ui_prefix','count',{entries:count(prefix?.live_textures),within:'gpu.textures',source:'renderer ui_image_batches',geometries:count(prefix?.live_geometries),meshes:count(prefix?.live_meshes),materials:count(prefix?.live_materials),buffer_capacity_quads:count(prefix?.buffer_capacity_quads),image_leases:count(prefix?.image_leases)});
 const [width,height]=Array.isArray(drawingBuffer)?drawingBuffer:[];
 const buffer=count(width)&&count(height)?{width,height}:null;
 add('render_targets.drawing_buffer','lower_bound',{bytes:buffer?buffer.width*buffer.height*4:null,source:'canvas width × height',size:buffer,note:'One RGBA8 color buffer; depth, multisampling and swap chain copies are not included.'});
 const bloom=renderer?.bloom===true&&Array.isArray(renderer?.bloom_resolution)?{width:renderer.bloom_resolution[0],height:renderer.bloom_resolution[1]}:null;
 add('render_targets.post','dimensions',{within:'gpu.textures',source:'renderer bloom metrics',enabled:renderer?typeof renderer.bloom==='boolean'?renderer.bloom:null:null,size:bloom,note:'Post-processing targets exist only while bloom or ambient occlusion is on; their formats are not exposed.'});
 add('audio.decoded','estimate',{bytes:audio?.available===false?0:finite(audio?.decoded_bytes_estimate),entries:count(audio?.assets),source:'audio playback report',note:'Decoded PCM as 32-bit float per channel; WebAudio internals are not included.'});
 add('js.heap','external',{source:'DevTools Runtime.getHeapUsage (measure-web-export)',note:'Read outside the page; performance.memory is coarse and Chromium-only.'});
 const failures={image_loads_failed:count(images?.loading_metrics?.failed),sprite_errors:sprites?.supported===false?null:count(sprites?.errors),ui_image_errors:Array.isArray(ui?.assets)?ui.assets.filter(asset=>asset?.state==='error').length:null};
 return Object.freeze({version:1,owners:Object.freeze(owners),unmeasured:UNMEASURED,failures:Object.freeze(failures),scope:SCOPE});
}

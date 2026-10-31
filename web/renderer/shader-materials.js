// Declarative fragment materials. Only this engine adapter creates GPU resources;
// game scripts select IDs and update typed uniforms through api.shader.
const vertexShader = `varying vec2 unone_uv;
void main(){unone_uv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const reserved = new Set(['main','uniform','varying','attribute','precision','float','vec2','vec3','vec4','void','in','out','texture','texture2D']);
const validName = name => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) && !name.startsWith('gl_') && !name.startsWith('unone_') && !name.includes('__') && !reserved.has(name);
function width(value){if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=3.4028234663852886e38)return 1;if(Array.isArray(value)&&value.length>=2&&value.length<=4&&value.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=3.4028234663852886e38))return value.length;throw Error('SHADER_UNIFORM_INVALID: finite float/vec2/vec3/vec4 required');}
const uniformType = value => ['','float','vec2','vec3','vec4'][width(value)];
export function fragmentSource(id,definition){
 if(typeof definition?.fragment!=='string'||!definition.fragment.includes('unoneShade')||new TextEncoder().encode(definition.fragment).length>16384||definition.fragment.includes('#version'))throw Error(`SHADER_DEFINITION_INVALID: ${id}`);
 const entries=Object.entries(definition.uniforms??{});if(entries.length>32)throw Error(`SHADER_DEFINITION_INVALID: ${id} has more than 32 uniforms`);
 const declarations=entries.map(([name,value])=>{if(!validName(name))throw Error(`SHADER_UNIFORM_INVALID: ${id}.${name}`);return `uniform ${uniformType(value)} ${name};`}).join('\n');
 return `// UNONE_MATERIAL:${id}\nuniform sampler2D unone_texture;
uniform vec4 unone_base_color;
uniform float unone_time;
uniform float unone_frame;
varying vec2 unone_uv;
${declarations}
${definition.fragment}
void main(){gl_FragColor=unoneShade(unone_uv,texture2D(unone_texture,unone_uv)*unone_base_color);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
}

// Mesh materials (geometry3d): an optional vertex stage plus the interface the
// definition declares once -- uniforms, per-vertex attributes after the color,
// and varyings between the stages. Both stages are generated from it here, so
// a new kind of input (samplers, integer uniforms) is one more declaration.
const vecType=size=>size===1?'float':`vec${size}`;
const DEFAULT_VERTEX='vec4 unoneVertex(vec3 position, mat4 model){return unone_projection*unone_view*model*vec4(position,1.0);}';
// Attribute offsets in floats within an interleaved vertex: position.xyz, uv,
// RGBA, then the declared attributes in order.
export function meshShaderLayout(definition){
  let offset=9;const attributes=(definition?.attributes??[]).map(({name,size})=>{const at=offset;offset+=size;return {name,size,offset:at};});
  return {stride:offset,attributes};
}
export function meshShaderSources(id,definition){
  fragmentSource(id,definition);
  const vertex=definition.vertex??DEFAULT_VERTEX;
  if(typeof vertex!=='string'||!vertex.includes('unoneVertex')||vertex.includes('#version')||new TextEncoder().encode(vertex).length>16384)throw Error(`SHADER_DEFINITION_INVALID: ${id}`);
  const uniforms=Object.entries(definition.uniforms??{}).map(([name,value])=>`uniform ${uniformType(value)} ${name};`).join('\n');
  const varyings=(definition.varyings??[]).map(v=>`${v.interpolation==='flat'?'flat ':''}varying ${vecType(v.size)} ${v.name};`).join('\n');
  const samplers=Object.entries(definition.samplers??{}).map(([name,s])=>`uniform highp ${s.type==='int'?'isampler2D':'sampler2D'} ${name};`).join('\n');
  const shared=`// UNONE_MATERIAL:${id}
uniform float unone_time;
uniform float unone_frame;
uniform vec4 unone_viewport;
${uniforms}
${samplers}
varying vec2 unone_uv;
varying vec4 unone_color;
${varyings}`;
  const vertexShader=`${shared}
// The host may mirror the world root for a left-handed camera; model and
// unone_view stay in the game's coordinates, and their product is unchanged.
uniform mat4 unone_handedness;
#define unone_view (viewMatrix*unone_handedness)
#define unone_projection projectionMatrix
${(definition.attributes??[]).map(a=>`attribute ${vecType(a.size)} ${a.name};`).join('\n')}
${vertex}
void main(){
 unone_uv=uv;unone_color=color;
 mat4 unone_model=unone_handedness*modelMatrix;
#ifdef USE_INSTANCING
 unone_model=unone_model*instanceMatrix;
#endif
 gl_Position=unoneVertex(position,unone_model);
}`;
  const fragmentShader=`${shared}
uniform sampler2D unone_texture;
uniform float unone_alpha_cutoff;
${definition.fragment}
void main(){
 vec4 unoneColor=unoneShade(unone_uv,texture2D(unone_texture,unone_uv)*unone_color);
 if(unoneColor.a<unone_alpha_cutoff)discard;
 gl_FragColor=unoneColor;
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
  return {vertexShader,fragmentShader,signature:vertexShader+'\n'+fragmentShader};
}
// `shared` uniforms (time, frame, viewport) are objects owned by the caller and
// shared by every mesh material, so one write per frame reaches all of them.
export function createMeshShaderMaterial(THREE,id,definition,{shared,texture,blend='opaque',alphaCutoff=.5,side}){
  const {vertexShader,fragmentShader}=meshShaderSources(id,definition);
  const uniforms={...shared,unone_texture:{value:texture},unone_alpha_cutoff:{value:blend==='cutout'?alphaCutoff:-1}};
  for(const [name,value] of Object.entries(definition.uniforms??{}))uniforms[name]={value:Array.isArray(value)?[...value]:value};
  // Samplers are bound before every draw.
  for(const name of Object.keys(definition.samplers??{}))uniforms[name]={value:null};
  return new THREE.ShaderMaterial({name:`unone-shader:${id}`,uniforms,vertexShader,fragmentShader,vertexColors:true,
    transparent:blend==='transparent',depthWrite:blend!=='transparent',side});
}
// Current values of the declared uniforms; their names and widths are fixed by the definition.
export function applyMeshShaderValues(material,definition){
  for(const [name,value] of Object.entries(definition.uniforms??{})){
    const uniform=material.uniforms[name];
    if(Array.isArray(value)){for(let i=0;i<value.length;i++)uniform.value[i]=value[i];}else uniform.value=value;
  }
}

// Resource preparation owns source/type layout; instances own mutable values.
export function spriteMaterialDescriptor(id, definition) {
 if(!id && definition===undefined)return BASIC_SPRITE_MATERIAL;
 if(typeof id!=='string'||!id||!definition)throw Error('SPRITE_MATERIAL_INVALID');
 const source=fragmentSource(id,definition),defaults={};
 for(const [name,value]of Object.entries(definition.uniforms??{}))defaults[name]=Array.isArray(value)?Object.freeze([...value]):value;
 return Object.freeze({id,source,signature:source,defaults:Object.freeze(defaults),names:Object.freeze(Object.keys(defaults))});
}
const BASIC_SPRITE_MATERIAL=Object.freeze({signature:'basic',id:null,source:null,defaults:Object.freeze({}),names:Object.freeze([])});
export function createSpriteMaterial(THREE, descriptor, texture) {
 if(!descriptor.source)return new THREE.MeshBasicMaterial({color:0xffffff,map:texture,transparent:true,opacity:1});
 const uniforms={unone_texture:{value:texture},unone_base_color:{value:[1,1,1,1]},unone_time:{value:0},unone_frame:{value:0}};
 for(const [name,value]of Object.entries(descriptor.defaults))uniforms[name]={value:Array.isArray(value)?[...value]:value};
 return new THREE.ShaderMaterial({name:`unone-shader:${descriptor.id}`,uniforms,vertexShader,fragmentShader:descriptor.source,transparent:true,depthWrite:false});
}
export function validateSpriteUniforms(descriptor, values=descriptor.defaults) {
 if(!values||typeof values!=='object'||Array.isArray(values))throw Error('SPRITE_UNIFORMS_INVALID');
 const names=descriptor.names;let count=0;for(const name in values)if(Object.hasOwn(values,name))count++;
 if(count!==names.length)throw Error('SPRITE_UNIFORMS_INVALID');
 for(const name of names)if(!Object.hasOwn(values,name)||width(values[name])!==width(descriptor.defaults[name]))throw Error(`SPRITE_UNIFORMS_INVALID: ${name}`);
 return values;
}
export function applySpriteMaterialValues(material, descriptor, texture, values, world) {
 validateSpriteUniforms(descriptor,values);
 if(!descriptor.source){const changed=Boolean(material.map)!==Boolean(texture);material.map=texture;material.color.set(0xffffff);if(changed)material.needsUpdate=true;return;}
 const uniforms=material.uniforms;uniforms.unone_texture.value=texture;
 uniforms.unone_time.value=Number(world.time_seconds??0);uniforms.unone_frame.value=Number(world.frame??0);
 for(const name of descriptor.names){const value=values[name];
  if(Array.isArray(value)){const target=uniforms[name].value;for(let i=0;i<value.length;i++)target[i]=value[i];}
  else uniforms[name].value=value;
 }
}
export function createShaderMaterials(THREE,renderer,backend){
 const records=new Map();
 const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
 const previousError=renderer.debug?.onShaderError,previousCheck=renderer.debug?.checkShaderErrors;
 const onShaderError=(gl,program,vertex,fragment)=>{const source=gl.getShaderSource(fragment)??'';const id=source.match(/UNONE_MATERIAL:([^\s]+)/)?.[1]??'engine-program';const message=`SHADER_COMPILE_FAILED: ${id}\n${gl.getProgramInfoLog(program)??''}\n${gl.getShaderInfoLog(vertex)??''}\n${gl.getShaderInfoLog(fragment)??''}`;gl.deleteShader(vertex);gl.deleteShader(fragment);throw Error(message);};
 if(renderer.debug){renderer.debug.checkShaderErrors=true;renderer.debug.onShaderError=onShaderError;}
 function assign(entity,base,world){
  const id=entity.shader_material,key=String(entity.id);if(!id)return base;
  if(backend!=='webgl')throw Error(`SHADER_BACKEND_UNSUPPORTED: material '${id}' requires the official WebGL player; custom GLSL sprite materials are not implemented on ${backend}`);
  const definition=world.shader_materials?.[id];if(!definition)throw Error(`SHADER_MATERIAL_UNKNOWN: ${id}`);
  const source=fragmentSource(id,definition),signature=source;let record=records.get(key);
  if(!record||record.signature!==signature){
   record?.material.dispose();
   const uniforms={unone_texture:{value:white},unone_base_color:{value:[1,1,1,1]},unone_time:{value:0},unone_frame:{value:0}};
   for(const [name,value] of Object.entries(definition.uniforms??{}))uniforms[name]={value:Array.isArray(value)?[...value]:value};
   const material=new THREE.ShaderMaterial({name:`unone-shader:${id}`,uniforms,vertexShader,fragmentShader:source,transparent:true,depthWrite:false});
   record={signature,material};records.set(key,record);
  }
  const uniforms=record.material.uniforms;uniforms.unone_texture.value=base.map??white;
  uniforms.unone_base_color.value=[base.color.r,base.color.g,base.color.b,base.opacity??1];
  uniforms.unone_time.value=Number(world.time_seconds??0);uniforms.unone_frame.value=Number(world.frame??0);
  for(const [name,value] of Object.entries(definition.uniforms??{}))uniforms[name].value=Array.isArray(value)?[...value]:value;
  return record.material;
 }
 function retain(ids){for(const [id,record] of records)if(!ids.has(id)){record.material.dispose();records.delete(id);}}
 function clear(){retain(new Set());}
 return {assign,retain,clear,contextLost(retire){retire(white);for(const record of records.values())retire(record.material);},get count(){return records.size},dispose(){clear();white.dispose();if(renderer.debug?.onShaderError===onShaderError){renderer.debug.onShaderError=previousError;renderer.debug.checkShaderErrors=previousCheck;}}};
}

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

struct Camera {position:vec4f,forward:vec4f,right:vec4f,up:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var texture:texture_2d<f32>;
@group(1) @binding(1) var textureSampler:sampler;
struct Out {@builtin(position) clip:vec4f,@location(0) uv:vec2f,@location(1) world:vec3f};
@vertex fn vs(@location(0) p:vec3f,@location(1) uv:vec2f,@location(2) translation:vec3f,@location(3) q:vec4f,@location(4) scale:vec3f)->Out{
 let local=p*scale;let world=local+2.*cross(q.xyz,cross(q.xyz,local)+q.w*local)+translation;
 let delta=world-camera.position.xyz;let depth=dot(delta,camera.forward.xyz);
 let near=camera.right.w;let far=camera.up.w;var out:Out;
 out.clip=vec4f(dot(delta,camera.right.xyz)/(camera.position.w*camera.forward.w),dot(delta,camera.up.xyz)/camera.position.w,far/(far-near)*depth-far*near/(far-near),depth);
 out.uv=uv;out.world=world;return out;
}
@fragment fn fs(v:Out)->@location(0) vec4f {
 // Web's imported mesh path uses MeshBasicMaterial. Keep native assets
 // unlit as well so sRGB texture values and scene brightness match across
 // WebGL/WebGPU, Windows native and Android native hosts.
 return vec4f(textureSample(texture,textureSampler,v.uv).rgb,1.);
}

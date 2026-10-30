// UI tiles: one instance per leaf tile, a clip-space rectangle (left, top,
// right, bottom) and its texture window (u0, v0, u1, v1).
@group(0) @binding(0) var picture:texture_2d<f32>;
@group(0) @binding(1) var filtering:sampler;
struct V { @builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i:u32,@location(0) rect:vec4<f32>,@location(1) window:vec4<f32>)->V {
 let corner=array<vec2<f32>,6>(vec2(0.,0.),vec2(0.,1.),vec2(1.,0.),vec2(1.,0.),vec2(0.,1.),vec2(1.,1.))[i];
 var o:V;o.position=vec4(mix(rect.x,rect.z,corner.x),mix(rect.y,rect.w,corner.y),0.,1.);o.uv=mix(window.xy,window.zw,corner);return o;
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{return textureSample(picture,filtering,v.uv);}

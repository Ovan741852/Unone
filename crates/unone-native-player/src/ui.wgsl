@group(0) @binding(0) var picture:texture_2d<f32>;
@group(0) @binding(1) var filtering:sampler;
struct V { @builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
 let uv=array<vec2<f32>,6>(vec2(0.,0.),vec2(0.,1.),vec2(1.,0.),vec2(1.,0.),vec2(0.,1.),vec2(1.,1.))[i];
 var o:V;o.position=vec4(uv.x*2.-1.,1.-uv.y*2.,0.,1.);o.uv=uv;return o;
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{return textureSample(picture,filtering,v.uv);}

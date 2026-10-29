@group(0) @binding(0) var image:texture_2d<f32>;
@group(1) @binding(0) var imageSampler:sampler;
struct Material {alpha_cutoff:f32,encoded_mode:f32,encoded_sampling:f32,repeat_address:f32,
 alpha_strict:f32,pad0:f32,pad1:f32,pad2:f32};
@group(1) @binding(1) var<uniform> material:Material;
fn to_encoded(value:vec3f)->vec3f {return select(1.055*pow(value,vec3f(1./2.4))-0.055,12.92*value,value<=vec3f(0.0031308));}
fn to_linear(value:vec3f)->vec3f {return select(pow((value+0.055)/1.055,vec3f(2.4)),value/12.92,value<=vec3f(0.04045));}
fn encoded_texel(p:vec2i,size:vec2i)->vec4f {
 var position=clamp(p,vec2i(0),size-vec2i(1));
 if material.repeat_address>0.5 {position=((p%size)+size)%size;}
 let value=textureLoad(image,position,0);
 return vec4f(to_encoded(value.rgb),value.a);
}
fn sample_image(uv:vec2f)->vec4f {
 let value=textureSample(image,imageSampler,uv);
 if material.encoded_sampling<0.5 {return value;}
 let size=vec2i(textureDimensions(image));let p=uv*vec2f(size)-0.5;let low=vec2i(floor(p));let fraction=fract(p);
 let top=mix(encoded_texel(low,size),encoded_texel(low+vec2i(1,0),size),fraction.x);
 let bottom=mix(encoded_texel(low+vec2i(0,1),size),encoded_texel(low+vec2i(1,1),size),fraction.x);
 let encoded=mix(top,bottom,fraction.y);return vec4f(to_linear(encoded.rgb),encoded.a);
}
struct Out {@builtin(position) clip:vec4f,@location(0) uv:vec2f,@location(1) color:vec4f};
@vertex fn vs(@location(0) clip:vec4f,@location(1) uv:vec2f,@location(2) color:vec4f)->Out {
 var out:Out;out.clip=clip;out.uv=vec2f(uv.x,1.-uv.y);out.color=color;return out;
}
@fragment fn fs(v:Out)->@location(0) vec4f {
 let texel=sample_image(v.uv);
 let alpha=texel.a*v.color.a;
 if material.alpha_strict>0.5 {if alpha<=material.alpha_cutoff {discard;}}
 else if alpha<material.alpha_cutoff {discard;}
 var rgb=texel.rgb*v.color.rgb;
 if material.encoded_mode>0.5 {rgb=to_linear(to_encoded(texel.rgb)*v.color.rgb);}
 return vec4f(rgb,1.);
}

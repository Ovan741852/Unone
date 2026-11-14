struct Camera {position:vec4f,forward:vec4f,right:vec4f,up:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var texture:texture_2d<f32>;
@group(1) @binding(1) var textureSampler:sampler;
// Scene lighting (lighting.rs light_values). Colours are linear and already
// multiplied by intensity; ambient.w is 1 when the scene is lit.
struct Light {
 ambient:vec4f,
 sun_direction:vec4f, // towards the sun, w 1 when there is a sun
 sun_color:vec4f,     // w 1 when the sun casts shadows
 shadow:vec4f,        // x bias, y one shadow-map texel
 shadow_view_proj:mat4x4f,
 points:array<vec4f,8>,      // xyz position, w range
 point_colors:array<vec4f,8>,
 counts:vec4f,               // x point light count
};
@group(2) @binding(0) var<uniform> light:Light;
@group(2) @binding(1) var shadow_map:texture_depth_2d;
@group(2) @binding(2) var shadow_sampler:sampler_comparison;
struct Out {@builtin(position) clip:vec4f,@location(0) uv:vec2f,@location(1) world:vec3f,@location(2) normal:vec3f};
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@vertex fn vs(@location(0) p:vec3f,@location(1) uv:vec2f,@location(5) normal:vec3f,@location(2) translation:vec3f,@location(3) q:vec4f,@location(4) scale:vec3f)->Out{
 let world=rotate(q,p*scale)+translation;
 let delta=world-camera.position.xyz;let depth=dot(delta,camera.forward.xyz);
 let near=camera.right.w;let far=camera.up.w;var out:Out;
 out.clip=vec4f(dot(delta,camera.right.xyz)/(camera.position.w*camera.forward.w),dot(delta,camera.up.xyz)/camera.position.w,far/(far-near)*depth-far*near/(far-near),depth);
 // Normals take the inverse scale, so stretched meshes stay correctly lit.
 let safe=select(scale,vec3f(1e-6),abs(scale)<vec3f(1e-6));
 out.uv=uv;out.world=world;out.normal=rotate(q,normal/safe);return out;
}
// 3x3 PCF over the sun's shadow map; outside the shadow box stays lit.
fn sun_shadow(world:vec3f)->f32{
 if light.sun_color.w<0.5 {return 1.;}
 let clip=light.shadow_view_proj*vec4f(world,1.);
 let uv=vec2f(clip.x*.5+.5,.5-clip.y*.5);
 if any(uv<vec2f(0.))||any(uv>vec2f(1.))||clip.z<0.||clip.z>1. {return 1.;}
 let reference=clip.z-light.shadow.x;
 var sum=0.;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  sum+=textureSampleCompareLevel(shadow_map,shadow_sampler,uv+vec2f(f32(x),f32(y))*light.shadow.y,reference);
 }}
 return sum/9.;
}
@fragment fn fs(v:Out)->@location(0) vec4f {
 // Match the static-mesh contract's alpha test. Cutout texels must not write
 // depth: foliage and image-based characters otherwise occlude the world with
 // their transparent rectangle. Surviving texels remain opaque/depth tested.
 let color=textureSample(texture,textureSampler,v.uv);
 // The face's own normal, turned towards the camera, decides which side is
 // seen; like Three's double-sided materials, the back side is lit with the
 // flipped normal whatever the mesh winding.
 let face=normalize(cross(dpdx(v.world),dpdy(v.world)));
 if color.a < 0.05 { discard; }
 // Unlit scenes keep the texture colour exactly, like Web's MeshBasicMaterial.
 if light.ambient.w<0.5 {return vec4f(color.rgb,1.);}
 let seen=select(face,-face,dot(face,camera.position.xyz-v.world)<0.);
 // A vertex no triangle uses has a zero normal; fall back to the face.
 var n=select(seen,normalize(v.normal),length(v.normal)>1e-6);
 if dot(n,seen)<0. {n=-n;}
 var irradiance=light.ambient.rgb;
 if light.sun_direction.w>0.5 {
  irradiance+=light.sun_color.rgb*max(dot(n,light.sun_direction.xyz),0.)*sun_shadow(v.world);
 }
 for(var i=0u;i<u32(light.counts.x);i++){
  let to_light=light.points[i].xyz-v.world;
  let distance=length(to_light);
  // (1 - (d / range)^4)^2, Three's point falloff with decay 0.
  let window=clamp(1.-pow(distance/light.points[i].w,4.),0.,1.);
  irradiance+=light.point_colors[i].rgb*max(dot(n,to_light/max(distance,1e-6)),0.)*window*window;
 }
 return vec4f(color.rgb*irradiance,1.);
}

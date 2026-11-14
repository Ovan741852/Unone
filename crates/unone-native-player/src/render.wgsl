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
 hemisphere_sky:vec4f,       // w 1 when there is a hemisphere light
 hemisphere_ground:vec4f,
 environment:vec4f,          // intensity, rotation (radians), top mip, w 1 when loaded
 sh:array<vec4f,9>,          // cosine-convolved irradiance: E(n) = sum(sh[i] * Y_i(n))
};
@group(2) @binding(3) var environment_map:texture_2d<f32>;
@group(2) @binding(4) var environment_sampler:sampler;
// A world direction in the panorama, rotated like Three's environmentRotation.
fn environment_direction(d:vec3f)->vec3f{
 let a=-light.environment.y;let c=cos(a);let s=sin(a);
 return vec3f(c*d.x+s*d.z,d.y,-s*d.x+c*d.z);
}
// Three's equirect convention; texture rows run top first.
fn environment_radiance(d:vec3f,lod:f32)->vec3f{
 let e=environment_direction(d);
 let uv=vec2f(atan2(e.z,e.x)*.15915494+.5,.5-asin(clamp(e.y,-1.,1.))*.31830989);
 return textureSampleLevel(environment_map,environment_sampler,uv,lod).rgb;
}
fn environment_irradiance(n:vec3f)->vec3f{
 let d=environment_direction(n);
 let basis=array<f32,9>(.282095,.488603*d.y,.488603*d.z,.488603*d.x,1.092548*d.x*d.y,1.092548*d.y*d.z,.315392*(3.*d.z*d.z-1.),1.092548*d.x*d.z,.546274*(d.x*d.x-d.y*d.y));
 var e=vec3f(0.);
 for(var i=0;i<9;i++){e+=light.sh[i].rgb*basis[i];}
 return max(e,vec3f(0.));
}
// The mesh's material (lighting.rs material_values): w of color is 1 for a
// declared material, shaded physically; 0 keeps plain diffuse light.
struct Material {color:vec4f,surface:vec4f,emissive:vec4f};
@group(3) @binding(0) var<uniform> material:Material;
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
// Three.js MeshStandardMaterial's direct specular (BRDF_GGX): Schlick
// Fresnel, height-correlated Smith visibility and the GGX distribution.
fn ggx_specular(l:vec3f,view:vec3f,n:vec3f,f0:vec3f,roughness:f32)->vec3f{
 let alpha=roughness*roughness;let a2=alpha*alpha;let h=normalize(l+view);
 let n_l=clamp(dot(n,l),0.,1.);let n_v=clamp(dot(n,view),0.,1.);let n_h=clamp(dot(n,h),0.,1.);let v_h=clamp(dot(view,h),0.,1.);
 let fresnel=exp2((-5.55473*v_h-6.98316)*v_h);
 let f=f0*(1.-fresnel)+vec3f(fresnel);
 let visibility=0.5/max(n_l*sqrt(a2+(1.-a2)*n_v*n_v)+n_v*sqrt(a2+(1.-a2)*n_l*n_l),1e-6);
 let d=n_h*n_h*(a2-1.)+1.;
 return f*(visibility*0.31830988618*a2/(d*d));
}
// The panorama behind everything (environment.background): a fullscreen
// triangle turned into view directions with the camera basis.
struct SkyOut {@builtin(position) clip:vec4f,@location(0) ndc:vec2f};
@vertex fn vs_sky(@builtin(vertex_index) index:u32)->SkyOut{
 var corners=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));
 var out:SkyOut;out.clip=vec4f(corners[index],.5,1.);out.ndc=corners[index];return out;
}
@fragment fn fs_sky(v:SkyOut)->@location(0) vec4f{
 let d=normalize(camera.forward.xyz+camera.right.xyz*v.ndc.x*camera.position.w*camera.forward.w+camera.up.xyz*v.ndc.y*camera.position.w);
 return vec4f(environment_radiance(d,0.)*light.environment.x,1.);
}
@fragment fn fs(v:Out)->@location(0) vec4f {
 // Match the static-mesh contract's alpha test. Cutout texels must not write
 // depth: foliage and image-based characters otherwise occlude the world with
 // their transparent rectangle. Surviving texels remain opaque/depth tested.
 let sampled=textureSample(texture,textureSampler,v.uv);
 let color=vec4f(sampled.rgb*material.color.rgb,sampled.a);
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
 // Ambient plus the hemisphere's sky-to-ground mix by the normal's height.
 var ambient=light.ambient.rgb;
 if light.hemisphere_sky.w>0.5 {ambient+=mix(light.hemisphere_ground.rgb,light.hemisphere_sky.rgb,.5*n.y+.5);}
 // A material is metallic/rough (GGX, as Three's standard material); a mesh
 // without one keeps plain diffuse. Lights add n.l * colour * (diffuse + pi * specular).
 let physical=material.color.w>0.5;
 let metallic=material.surface.x;
 let roughness=min(max(material.surface.y,.0525),1.);
 let diffuse=select(color.rgb,color.rgb*(1.-metallic),physical);
 let f0=mix(vec3f(.04),color.rgb,metallic);
 let view=normalize(camera.position.xyz-v.world);
 var radiance=ambient*diffuse;
 if light.sun_direction.w>0.5 {
  let l=light.sun_direction.xyz;
  var brdf=diffuse;
  if physical {brdf+=3.14159265*ggx_specular(l,view,n,f0,roughness);}
  radiance+=light.sun_color.rgb*max(dot(n,l),0.)*sun_shadow(v.world)*brdf;
 }
 for(var i=0u;i<u32(light.counts.x);i++){
  let to_light=light.points[i].xyz-v.world;
  let distance=length(to_light);
  let l=to_light/max(distance,1e-6);
  // (1 - (d / range)^4)^2, Three's point falloff with decay 0.
  let window=clamp(1.-pow(distance/light.points[i].w,4.),0.,1.);
  var brdf=diffuse;
  if physical {brdf+=3.14159265*ggx_specular(l,view,n,f0,roughness);}
  radiance+=light.point_colors[i].rgb*max(dot(n,l),0.)*window*window*brdf;
 }
 // Image-based light for materials, as Three's standard material takes it:
 // a mip-blurred reflection weighted by its DFG approximation, plus SH
 // irradiance on the diffuse part.
 if physical&&light.environment.w>.5 {
  let n_v=clamp(dot(n,view),0.,1.);
  let r4=roughness*vec4f(-1.,-.0275,-.572,.022)+vec4f(1.,.0425,1.04,-.04);
  let a004=min(r4.x*r4.x,exp2(-9.28*n_v))*r4.x+r4.y;
  let fab=vec2f(-1.04,1.04)*a004+r4.zw;
  let single=f0*fab.x+vec3f(fab.y);
  let mirrored=reflect(-view,n);
  radiance+=light.environment.x*(environment_radiance(mirrored,roughness*light.environment.z)*single+environment_irradiance(n)*.31830989*diffuse);
 }
 return vec4f(radiance+material.emissive.rgb,1.);
}

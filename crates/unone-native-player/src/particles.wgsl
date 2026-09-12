struct Camera {position:vec4f,forward:vec4f,right:vec4f,up:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
struct Out {@builtin(position) clip:vec4f,@location(0) uv:vec2f,@location(1) color:vec4f};
@vertex fn vs(@builtin(vertex_index) vertex:u32,@location(0) p:vec4f,@location(1) color:vec4f)->Out {
 let corners=array<vec2f,6>(vec2f(-.5,-.5),vec2f(.5,-.5),vec2f(.5,.5),vec2f(-.5,-.5),vec2f(.5,.5),vec2f(-.5,.5));let uv=corners[vertex];let world=p.xyz+p.w*(camera.right.xyz*uv.x+camera.up.xyz*uv.y);let delta=world-camera.position.xyz;let depth=dot(delta,camera.forward.xyz);let n=camera.right.w;let f=camera.up.w;var out:Out;out.clip=vec4f(dot(delta,camera.right.xyz)/(camera.position.w*camera.forward.w),dot(delta,camera.up.xyz)/camera.position.w,f/(f-n)*depth-f*n/(f-n),depth);out.uv=uv*2.;out.color=color;return out;
}
@fragment fn fs(v:Out)->@location(0) vec4f {let alpha=(1.-smoothstep(.15,1.,length(v.uv)))*v.color.a;if alpha<.005 {discard;}return vec4f(v.color.rgb,alpha);}

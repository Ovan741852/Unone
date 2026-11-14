// Depth-only pass into the sun's shadow map (lighting.rs). Instances use the
// mesh pipeline's transform; alpha-tested cutout texels cast no shadow, as on
// the Web player.
struct ShadowCamera { view_proj: mat4x4f };
@group(0) @binding(0) var<uniform> shadow_camera: ShadowCamera;
@group(1) @binding(0) var texture: texture_2d<f32>;
@group(1) @binding(1) var textureSampler: sampler;
struct Out { @builtin(position) clip: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@location(0) p: vec3f, @location(1) uv: vec2f, @location(2) translation: vec3f, @location(3) q: vec4f, @location(4) scale: vec3f) -> Out {
    let local = p * scale;
    let world = local + 2. * cross(q.xyz, cross(q.xyz, local) + q.w * local) + translation;
    var out: Out;
    out.clip = shadow_camera.view_proj * vec4f(world, 1.);
    out.uv = uv;
    return out;
}

@fragment fn fs(v: Out) {
    if textureSample(texture, textureSampler, v.uv).a < 0.05 {
        discard;
    }
}

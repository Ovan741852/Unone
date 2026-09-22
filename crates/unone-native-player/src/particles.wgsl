struct Camera { position: vec4f, forward: vec4f, right: vec4f, up: vec4f };
@group(0) @binding(0) var<uniform> camera: Camera;

struct Out {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
    @location(1) color: vec4f,
    @location(2) shape: f32,
};

@vertex fn vs(
    @builtin(vertex_index) vertex: u32,
    @location(0) particle: vec4f,
    @location(1) color: vec4f,
    @location(2) params: vec2f,
) -> Out {
    let corners = array<vec2f, 6>(
        vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5),
        vec2f(-0.5, -0.5), vec2f(0.5, 0.5), vec2f(-0.5, 0.5),
    );
    let corner = corners[vertex];
    let c = cos(params.x);
    let s = sin(params.x);
    let rotated = vec2f(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
    let world = particle.xyz + particle.w * (camera.right.xyz * rotated.x + camera.up.xyz * rotated.y);
    let delta = world - camera.position.xyz;
    let depth = dot(delta, camera.forward.xyz);
    let near = camera.right.w;
    let far = camera.up.w;
    var out: Out;
    out.clip = vec4f(
        dot(delta, camera.right.xyz) / (camera.position.w * camera.forward.w),
        dot(delta, camera.up.xyz) / camera.position.w,
        far / (far - near) * depth - far * near / (far - near),
        depth,
    );
    out.uv = rotated * 2.0;
    out.color = color;
    out.shape = params.y;
    return out;
}

@fragment fn fs(v: Out) -> @location(0) vec4f {
    let r = length(v.uv);
    var mask = 1.0 - smoothstep(0.72, 1.0, r);
    if v.shape > 0.5 && v.shape < 1.5 {
        let diamond = abs(v.uv.x) + abs(v.uv.y);
        mask = 1.0 - smoothstep(0.82, 1.0, diamond);
    } else if v.shape > 1.5 && v.shape < 2.5 {
        let ring = abs(r - 0.72);
        mask = (1.0 - smoothstep(0.10, 0.24, ring)) * (1.0 - smoothstep(0.90, 1.0, r));
    } else if v.shape > 2.5 {
        let ellipse = length(vec2f(v.uv.x * 2.6, v.uv.y));
        mask = 1.0 - smoothstep(0.72, 1.0, ellipse);
    }
    let alpha = mask * v.color.a;
    if alpha < 0.005 { discard; }
    return vec4f(v.color.rgb, alpha);
}

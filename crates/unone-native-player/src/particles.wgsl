struct Camera { position: vec4f, forward: vec4f, right: vec4f, up: vec4f };
@group(0) @binding(0) var<uniform> camera: Camera;
// The particle image for textured batches; shape batches bind a 1x1 white texture.
@group(1) @binding(0) var image: texture_2d<f32>;
@group(1) @binding(1) var image_sampler: sampler;

struct Out {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
    @location(1) color: vec4f,
    @location(2) shape: f32,
    @location(3) tex: vec2f,
    @location(4) textured: f32,
};

// particle: position.xyz, size (height); params: rotation, shape, aspect (width/height), textured flag;
// cell: flipbook rect u, v, width, height in texture space (origin top left).
@vertex fn vs(
    @builtin(vertex_index) vertex: u32,
    @location(0) particle: vec4f,
    @location(1) color: vec4f,
    @location(2) params: vec4f,
    @location(3) cell: vec4f,
) -> Out {
    let corners = array<vec2f, 6>(
        vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5),
        vec2f(-0.5, -0.5), vec2f(0.5, 0.5), vec2f(-0.5, 0.5),
    );
    let corner = corners[vertex];
    let c = cos(params.x);
    let s = sin(params.x);
    let scaled = vec2f(corner.x * params.z, corner.y);
    let rotated = vec2f(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);
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
    // The silhouette lives in the quad's own frame, so it turns with the particle.
    out.uv = corner * 2.0;
    out.color = color;
    out.shape = params.y;
    out.tex = vec2f(cell.x + (corner.x + 0.5) * cell.z, cell.y + (0.5 - corner.y) * cell.w);
    out.textured = params.w;
    return out;
}

@fragment fn fs(v: Out) -> @location(0) vec4f {
    // Sample in uniform control flow; shape batches read the white texture.
    let texel = textureSample(image, image_sampler, v.tex);
    if v.textured > 0.5 {
        let painted = texel.a * v.color.a;
        if painted < 0.005 { discard; }
        return vec4f(texel.rgb * v.color.rgb, painted);
    }
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

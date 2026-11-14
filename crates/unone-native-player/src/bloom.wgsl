struct VsOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var linear_sampler: sampler;
@group(0) @binding(3) var<uniform> params: vec4<f32>;

fn fullscreen(index: u32) -> VsOut {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0),
    );
    let position = positions[index];
    var out: VsOut;
    out.position = vec4<f32>(position, 0.0, 1.0);
    out.uv = position * 0.5 + vec2<f32>(0.5);
    return out;
}

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VsOut {
    return fullscreen(index);
}

// Texture-to-texture passes sample in framebuffer row order, so every bloom
// texture keeps the scene texture's orientation and the composite maps scene
// and glow identically.
@vertex
fn vs_texel(@builtin(vertex_index) index: u32) -> VsOut {
    var out = fullscreen(index);
    out.uv.y = 1.0 - out.uv.y;
    return out;
}

@fragment
fn extract(in: VsOut) -> @location(0) vec4<f32> {
    let color = textureSample(image, linear_sampler, in.uv).rgb;
    let luminance = max(color.r, max(color.g, color.b));
    let mask = smoothstep(params.x, params.y, luminance);
    return vec4<f32>(color * mask, 1.0);
}

@fragment
fn blur(in: VsOut) -> @location(0) vec4<f32> {
    let direction = params.xy;
    let texel = 1.0 / vec2<f32>(textureDimensions(image));
    let offset = direction * texel;
    var color = textureSample(image, linear_sampler, in.uv) * 0.227027;
    color += textureSample(image, linear_sampler, in.uv + offset * 1.384615) * 0.316216;
    color += textureSample(image, linear_sampler, in.uv - offset * 1.384615) * 0.316216;
    color += textureSample(image, linear_sampler, in.uv + offset * 3.230769) * 0.070270;
    color += textureSample(image, linear_sampler, in.uv - offset * 3.230769) * 0.070270;
    return vec4<f32>(color.rgb, 1.0);
}

// Tone curves ported from three.js so a declared tonemap pass matches the Web
// player: ACESFilmicToneMapping (exposure / 0.6) and LinearToneMapping.
fn rrt_and_odt_fit(v: vec3<f32>) -> vec3<f32> {
    let a = v * (v + 0.0245786) - 0.000090537;
    let b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

fn aces(color: vec3<f32>, exposure: f32) -> vec3<f32> {
    let input_mat = mat3x3<f32>(
        vec3<f32>(0.59719, 0.07600, 0.02840),
        vec3<f32>(0.35458, 0.90834, 0.13383),
        vec3<f32>(0.04823, 0.01566, 0.83777),
    );
    let output_mat = mat3x3<f32>(
        vec3<f32>(1.60475, -0.10208, -0.00327),
        vec3<f32>(-0.53108, 1.10813, -0.07276),
        vec3<f32>(-0.07367, -0.00605, 1.07602),
    );
    let fitted = rrt_and_odt_fit(input_mat * (color * exposure / 0.6));
    return clamp(output_mat * fitted, vec3<f32>(0.0), vec3<f32>(1.0));
}

// The composite's second group: the scene depth and the declared look (AO,
// fog, grade, vignette), in the same order and formulas as Web bloom.js.
struct Look {
    fog_color: vec4<f32>, // rgb linear, w mode: 0 off, 1 exp2, 2 linear
    fog: vec4<f32>,       // density, start, end, w AO strength (0 off)
    tint: vec4<f32>,      // rgb linear grade tint, w grade on
    grade: vec4<f32>,     // saturation, contrast, brightness, w vignette strength (0 off)
    vignette: vec4<f32>,  // rgb linear colour, w radius
    camera: vec4<f32>,    // vignette softness, near, far, w depth available
    lens: vec4<f32>,      // tan(fov / 2), aspect
};
@group(1) @binding(0) var depth_image: texture_depth_2d;
@group(1) @binding(1) var<uniform> look: Look;

fn texel(p: vec2<i32>) -> vec2<i32> {
    return clamp(p, vec2<i32>(0), vec2<i32>(textureDimensions(depth_image)) - vec2<i32>(1));
}

fn depth_at(p: vec2<i32>) -> f32 {
    return textureLoad(depth_image, texel(p), 0);
}

// View-space position in the Web convention (the camera looks down -z),
// rebuilt from the native projection, whose depth is f*n / (f - d*(f - n)).
fn view_position(at: vec2<i32>) -> vec3<f32> {
    let p = texel(at);
    let size = vec2<f32>(textureDimensions(depth_image));
    let near = look.camera.y;
    let far = look.camera.z;
    let z = far * near / (far - depth_at(p) * (far - near));
    let ndc = vec2<f32>((f32(p.x) + 0.5) / size.x * 2.0 - 1.0, 1.0 - (f32(p.y) + 0.5) / size.y * 2.0);
    return vec3<f32>(ndc.x * look.lens.x * look.lens.y * z, ndc.y * look.lens.x * z, -z);
}

// Depth-based SSAO with Web's 12-sample spiral, in pixels.
fn occlusion(p: vec2<i32>) -> f32 {
    if (look.fog.w <= 0.0 || look.camera.w < 0.5 || depth_at(p) >= 0.99999) {
        return 0.0;
    }
    let c = view_position(p);
    let l = c - view_position(p - vec2<i32>(1, 0));
    let r = view_position(p + vec2<i32>(1, 0)) - c;
    let d = c - view_position(p + vec2<i32>(0, 1));
    let u = view_position(p - vec2<i32>(0, 1)) - c;
    // The nearer depth neighbour keeps normals from spanning silhouettes.
    var n = cross(select(r, l, abs(l.z) < abs(r.z)), select(u, d, abs(d.z) < abs(u.z)));
    n = n / max(length(n), 1e-6);
    if (n.z < 0.0) {
        n = -n;
    }
    var occ = 0.0;
    for (var i = 0; i < 12; i++) {
        let angle = f32(i) * 2.39996;
        let radius = 5.0 + f32(i % 4) * 4.0;
        let q = p + vec2<i32>(round(vec2<f32>(cos(angle), -sin(angle)) * radius));
        if (depth_at(q) < 0.99999) {
            let v = view_position(q) - c;
            let distance = length(v);
            occ += smoothstep(0.08, 0.65, dot(n, v / max(0.001, distance))) * max(0.0, 1.0 - distance / 2.2);
        }
    }
    return occ;
}

// Fog by view depth; pixels with no geometry (the background) stay clear.
fn fog_amount(p: vec2<i32>) -> f32 {
    if (look.fog_color.w < 0.5 || look.camera.w < 0.5 || depth_at(p) >= 0.99999) {
        return 0.0;
    }
    let distance = max(-view_position(p).z, 0.0);
    if (look.fog_color.w > 1.5) {
        return clamp((distance - look.fog.y) / (look.fog.z - look.fog.y), 0.0, 1.0);
    }
    let x = look.fog.x * max(distance - look.fog.y, 0.0);
    return 1.0 - exp(-x * x);
}

// params: x bloom strength (0 without bloom), y exposure, z tone mode
// (0 none: legacy output, 1 linear exposure, 2 ACES).
@fragment
fn composite(in: VsOut) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(in.position.xy));
    let scene = textureSample(image, linear_sampler, in.uv).rgb;
    let glow = textureSample(bloom, linear_sampler, in.uv).rgb;
    var color = scene * (1.0 - clamp(occlusion(p) / 12.0 * look.fog.w, 0.0, 0.65));
    color = mix(color, look.fog_color.rgb, fog_amount(p));
    color += glow * params.x;
    if (params.z > 1.5) {
        color = aces(color, params.y);
    } else if (params.z > 0.5) {
        color = clamp(color * params.y, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    if (look.tint.w > 0.5) {
        var g = color * look.tint.rgb * look.grade.z;
        g = mix(vec3<f32>(dot(g, vec3<f32>(0.2126, 0.7152, 0.0722))), g, look.grade.x);
        color = max((g - 0.18) * look.grade.y + 0.18, vec3<f32>(0.0));
    }
    if (look.grade.w > 0.0) {
        let edge = smoothstep(look.vignette.w, look.vignette.w + look.camera.x, length(in.uv - vec2<f32>(0.5)) * 1.41421356);
        color = mix(color, look.vignette.rgb, edge * look.grade.w);
    }
    return vec4<f32>(color, 1.0);
}

// FXAA over the composited image; params.xy is one texel. Luma uses an
// approximate gamma like Web, while the image itself stays linear.
fn luma(c: vec3<f32>) -> f32 {
    return dot(sqrt(max(c, vec3<f32>(0.0))), vec3<f32>(0.299, 0.587, 0.114));
}

@fragment
fn fxaa(in: VsOut) -> @location(0) vec4<f32> {
    let px = params.xy;
    let uv = in.uv;
    let m = textureSample(image, linear_sampler, uv).rgb;
    let lm = luma(m);
    let nw = luma(textureSample(image, linear_sampler, uv + vec2<f32>(-1.0, -1.0) * px).rgb);
    let ne = luma(textureSample(image, linear_sampler, uv + vec2<f32>(1.0, -1.0) * px).rgb);
    let sw = luma(textureSample(image, linear_sampler, uv + vec2<f32>(-1.0, 1.0) * px).rgb);
    let se = luma(textureSample(image, linear_sampler, uv + vec2<f32>(1.0, 1.0) * px).rgb);
    let lo = min(lm, min(min(nw, ne), min(sw, se)));
    let hi = max(lm, max(max(nw, ne), max(sw, se)));
    var dir = vec2<f32>(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
    let reduce = max((nw + ne + sw + se) * (0.25 / 8.0), 1.0 / 128.0);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), vec2<f32>(-8.0), vec2<f32>(8.0)) * px;
    let near = 0.5 * (textureSample(image, linear_sampler, uv + dir * (1.0 / 3.0 - 0.5)).rgb
        + textureSample(image, linear_sampler, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
    let wide = near * 0.5 + 0.25 * (textureSample(image, linear_sampler, uv - dir * 0.5).rgb
        + textureSample(image, linear_sampler, uv + dir * 0.5).rgb);
    let lw = luma(wide);
    return vec4<f32>(select(wide, near, lw < lo || lw > hi), 1.0);
}

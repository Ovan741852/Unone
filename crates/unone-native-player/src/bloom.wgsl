struct VsOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var linear_sampler: sampler;
@group(0) @binding(3) var<uniform> params: vec4<f32>;

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VsOut {
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

// params: x bloom strength (0 without bloom), y exposure, z tone mode
// (0 none: legacy output, 1 linear exposure, 2 ACES).
@fragment
fn composite(in: VsOut) -> @location(0) vec4<f32> {
    let scene = textureSample(image, linear_sampler, in.uv).rgb;
    let glow = textureSample(bloom, linear_sampler, in.uv).rgb;
    let color = scene + glow * params.x;
    if (params.z > 1.5) {
        return vec4<f32>(aces(color, params.y), 1.0);
    }
    if (params.z > 0.5) {
        return vec4<f32>(clamp(color * params.y, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
    }
    return vec4<f32>(color, 1.0);
}

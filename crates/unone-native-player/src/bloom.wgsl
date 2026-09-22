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

@fragment
fn composite(in: VsOut) -> @location(0) vec4<f32> {
    let scene = textureSample(image, linear_sampler, in.uv).rgb;
    let glow = textureSample(bloom, linear_sampler, in.uv).rgb;
    return vec4<f32>(scene + glow * params.x, 1.0);
}

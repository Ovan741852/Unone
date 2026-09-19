struct Camera2D { position: vec2f, view_height: f32, aspect: f32 };
@group(0) @binding(0) var<uniform> camera: Camera2D;
@group(1) @binding(0) var texture: texture_2d<f32>;
@group(1) @binding(1) var textureSampler: sampler;

struct Out { @builtin(position) clip: vec4f, @location(0) uv: vec2f };

@vertex fn vs(
  @location(0) p: vec2f,
  @location(1) uv: vec2f,
  @location(2) center: vec2f,
  @location(3) size: vec2f,
  @location(4) rotation: f32,
  @location(5) layer: f32,
) -> Out {
  let c = cos(rotation);
  let s = sin(rotation);
  let local = p * size;
  let world = center + vec2f(local.x * c - local.y * s, local.x * s + local.y * c);
  // Camera2D's view_height is the vertical world span.  The horizontal span
  // grows with the surface aspect, matching the engine's pointer mapping.
  let half_width = max(camera.view_height * max(camera.aspect, 0.0001) * 0.5, 0.0001);
  let half_height = max(camera.view_height * 0.5, 0.0001);
  var out: Out;
  out.clip = vec4f(
    (world.x - camera.position.x) / half_width,
    (world.y - camera.position.y) / half_height,
    clamp(layer / 100000.0, -0.99, 0.99),
    1.0,
  );
  out.uv = uv;
  return out;
}

@fragment fn fs(v: Out) -> @location(0) vec4f {
  return textureSample(texture, textureSampler, v.uv);
}

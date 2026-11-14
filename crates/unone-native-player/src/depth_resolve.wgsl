// With MSAA on, copy sample 0 of the multisampled scene depth into the
// single-sample depth that AO, fog and projected geometry read (render.rs Msaa).
@group(0) @binding(0) var depth_msaa: texture_depth_multisampled_2d;

@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    var corners = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
    return vec4f(corners[index], 0., 1.);
}

struct Depth { @builtin(frag_depth) depth: f32 };

@fragment fn fs(@builtin(position) position: vec4f) -> Depth {
    var out: Depth;
    out.depth = textureLoad(depth_msaa, vec2i(position.xy), 0);
    return out;
}

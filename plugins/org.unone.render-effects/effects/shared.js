// Shared helpers for the render-effects passes. Each pass is an official
// render_extensions module (docs/render-pipeline.md): createPass gets THREE
// and returns {draw, dispose}; draw reads the previous image (linear colour)
// and writes the next target, or the screen when it is the last pass.
export const VERTEX = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';

// The last pass writes the screen, so every shader ends by encoding the output
// colour space exactly once; Three makes this a no-op for offscreen targets.
export function shaderPass(THREE, fragment, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {image: {value: null}, resolution: {value: new THREE.Vector2(1, 1)}, ...uniforms},
    vertexShader: VERTEX,
    fragmentShader: fragment + '\n',
    depthTest: false,
    depthWrite: false,
  });
}

// A declared param, clamped to its range; anything else takes the default.
export function param(params, name, spec) {
  const value = params?.[name];
  if (spec.type === 'boolean') return typeof value === 'boolean' ? value : spec.default;
  if (spec.type === 'color') return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : spec.default;
  if (typeof value !== 'number' || !Number.isFinite(value)) return spec.default;
  return Math.min(spec.max, Math.max(spec.min, value));
}

// One pass from its metadata: `update(uniforms, values, context)` copies the
// clamped params into uniforms before each draw.
export function definePass(effect, fragment, uniforms, update) {
  return function createPass({THREE}) {
    const material = shaderPass(THREE, fragment, uniforms(THREE));
    let frame = 0;
    return {
      draw({input, output, params, width, height, fullscreen}) {
        const values = Object.fromEntries(Object.entries(effect.params).map(([name, spec]) => [name, param(params, name, spec)]));
        material.uniforms.image.value = input;
        material.uniforms.resolution.value.set(Math.max(1, width ?? 1), Math.max(1, height ?? 1));
        update(material.uniforms, values, {frame: frame++});
        fullscreen(material, output);
      },
      dispose() { material.dispose(); },
    };
  };
}

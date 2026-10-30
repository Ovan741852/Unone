// A render_extensions pass (ADR 0048): blend the frame towards a tint colour.
// Params come from project.unone.json and api.render.setPass every frame.
export function createPass({THREE}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {image: {value: null}, tint: {value: new THREE.Vector3(1, 1, 1)}, amount: {value: 0}},
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    // The last pass writes the screen, so encode the output colour space once here.
    fragmentShader: 'uniform sampler2D image;uniform vec3 tint;uniform float amount;varying vec2 vUv;' +
      'void main(){vec3 c=texture2D(image,vUv).rgb;gl_FragColor=vec4(mix(c,c*tint,amount),1.);\n#include <colorspace_fragment>\n}',
    depthTest: false, depthWrite: false,
  });
  return {
    draw({input, output, params, fullscreen}) {
      material.uniforms.image.value = input;
      material.uniforms.tint.value.set(params.r ?? 1, params.g ?? 1, params.b ?? 1);
      material.uniforms.amount.value = params.amount ?? 0;
      fullscreen(material, output);
    },
    dispose() { material.dispose(); },
  };
}

// Scene lighting (ADR 0054, docs/lighting.md) for the official WebGL player:
// one ambient light, one sun (directional light) with an optional shadow map,
// and up to eight point lights, set from the snapshot's world.lighting.
//
// The contract is Lambert diffuse with intensity 1 as full light. Three's
// Lambert BRDF divides by pi, so every intensity is scaled by pi here; the
// native shader implements the contract directly. Lights live in the world
// group, so a left-handed camera mirrors them with the geometry.
export const MAX_POINT_LIGHTS = 8;

export function createLighting(THREE, renderer, world) {
  const ambient = new THREE.AmbientLight(0xffffff, 0);
  // Sky from +y, ground from -y; Three mixes them by the normal's height.
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 0);
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  const points = Array.from({length: MAX_POINT_LIGHTS}, () => new THREE.PointLight(0xffffff, 0, 10, 0));
  for (const light of [ambient, hemisphere, sun, sun.target, ...points]) { light.visible = false; world.add(light); }
  // No cost while no light casts shadows: Three skips the shadow pass and
  // compiles programs without shadow code.
  if (renderer?.shadowMap) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; }
  const direction = new THREE.Vector3();
  const state = {lit: false, shadows: false};

  function apply(lighting, camera3d) {
    state.lit = Boolean(lighting);
    state.shadows = false;
    ambient.visible = state.lit;
    hemisphere.visible = Boolean(lighting?.hemisphere);
    sun.visible = sun.target.visible = Boolean(lighting?.sun);
    sun.castShadow = false;
    for (let index = 0; index < MAX_POINT_LIGHTS; index++) {
      const point = lighting?.points?.[index], light = points[index];
      light.visible = Boolean(point);
      if (point) {
        light.position.set(point.position.x, point.position.y, point.position.z);
        light.color.set(point.color);
        light.intensity = point.intensity * Math.PI;
        // decay 0: Three's falloff is then exactly (1 - (d / range)^4)^2.
        light.distance = point.range;light.decay = 0;
      }
    }
    if (!lighting) return state;
    ambient.color.set(lighting.ambient.color);
    ambient.intensity = lighting.ambient.intensity * Math.PI;
    if (lighting.hemisphere) {
      hemisphere.color.set(lighting.hemisphere.sky);hemisphere.groundColor.set(lighting.hemisphere.ground);
      hemisphere.intensity = lighting.hemisphere.intensity * Math.PI;
    }
    const light = lighting.sun;
    if (light) {
      // The shadow box: a cube of half-width `distance` around the camera
      // target, seen from the sun. Native uses the same placement.
      const distance = light.shadows?.distance ?? 20, center = camera3d?.target ?? {x: 0, y: 0, z: 0};
      direction.set(light.direction.x, light.direction.y, light.direction.z).normalize();
      sun.target.position.set(center.x, center.y, center.z);
      sun.position.set(center.x - direction.x * 2 * distance, center.y - direction.y * 2 * distance, center.z - direction.z * 2 * distance);
      sun.color.set(light.color);
      sun.intensity = light.intensity * Math.PI;
      if (light.shadows) {
        state.shadows = true;sun.castShadow = true;
        const camera = sun.shadow.camera;
        camera.left = camera.bottom = -distance;camera.right = camera.top = distance;
        camera.near = 0;camera.far = 4 * distance;camera.updateProjectionMatrix();
        if (sun.shadow.mapSize.x !== light.shadows.size) {
          sun.shadow.mapSize.set(light.shadows.size, light.shadows.size);
          sun.shadow.map?.dispose();sun.shadow.map = null;
        }
        // The contract's bias pushes the receiver towards the light.
        sun.shadow.bias = -light.shadows.bias;
      }
    }
    return state;
  }

  // Lit content draws with Lambert materials and, under a shadowing sun,
  // casts and receives shadows; unlit content keeps its basic material.
  function dress(mesh, unlit, lit) {
    mesh.material = state.lit ? lit : unlit;
    mesh.castShadow = mesh.receiveShadow = state.shadows;
  }

  return {
    apply, dress, state,
    get lit() { return state.lit; },
    get shadows() { return state.shadows; },
    metrics() { return {lit: state.lit, shadows: state.shadows, point_lights: points.filter(light => light.visible).length}; },
    dispose() { sun.shadow.map?.dispose();for (const light of [ambient, hemisphere, sun, sun.target, ...points]) world.remove(light); },
  };
}

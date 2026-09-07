// Core supplies deterministic 3D samples. This host only draws billboards.
export function createParticleRenderer(THREE, scene) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d");
  const glow = context.createRadialGradient(16,16,0,16,16,16);
  glow.addColorStop(0,"rgba(255,255,255,1)"); glow.addColorStop(0.3,"rgba(255,255,255,0.9)"); glow.addColorStop(1,"rgba(255,255,255,0)");
  context.fillStyle=glow; context.fillRect(0,0,32,32);
  const texture = new THREE.CanvasTexture(canvas); const live = new Map();
  return {
    draw(samples = []) {
      const alive = new Set();
      for (const particle of samples) {
        let sprite = live.get(particle.id);
        if (!sprite) {
          sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));
          scene.add(sprite); live.set(particle.id,sprite);
        }
        sprite.position.set(particle.position.x,particle.position.y,particle.position.z);
        sprite.scale.set(particle.size,particle.size,1);
        sprite.material.color.setRGB(...particle.color.slice(0,3));
        sprite.material.opacity=particle.color[3];
        sprite.material.blending=particle.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
        alive.add(particle.id);
      }
      for (const [id,sprite] of live) if (!alive.has(id)) { scene.remove(sprite); sprite.material.dispose(); live.delete(id); }
    },
    get count() { return live.size; },
  };
}

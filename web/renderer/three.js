import { createParticleRenderer } from "./particles.js";
import { meshGeometry, validateMesh } from "./mesh.js";
import {createBloom} from './bloom.js';
import {createEffects} from './effekseer.js';
import { compareSpriteEntities, worldOf } from "../shared/webgpu-snapshot.js";

const LOCAL_THREE_URL = new URL("../vendor/three/three.module.js", import.meta.url).href;
const LOCAL_THREE_WEBGPU_URL = new URL("../vendor/three/three.webgpu.js", import.meta.url).href;

function aspectOf(canvas) {
  return (canvas.clientWidth || canvas.width || 16) / (canvas.clientHeight || canvas.height || 9);
}

function colorFor(entity, THREE) {
  if (entity.rigidbody?.body_type === "dynamic") return new THREE.Color(0xe63326);
  if (entity.rigidbody?.body_type === "static") return new THREE.Color(0x4da6e6);
  return new THREE.Color(0xe6bf33);
}

function visibleSprites(snapshot) {
  return Object.values(worldOf(snapshot).entities ?? {})
    .filter((entity) => entity.sprite && entity.sprite.visible !== false)
    .sort(compareSpriteEntities);
}

function visibleSize(world) {
  const camera = world.camera ?? { view_height: 10, zoom: 1 };
  return {
    height: (camera.view_height ?? 10) / (camera.zoom || 1),
    width: ((camera.view_height ?? 10) / (camera.zoom || 1)) * (world.__aspect || 16 / 9),
  };
}

async function loadThree(url) {
  return import(url);
}

/**
 * Three.js presentation adapter.
 *
 * WorldSnapshot is the only input. Ordinary 2D sprites become textured Three
 * planes; SVG/PNG/JPG/WebP bytes are decoded by the browser and uploaded to
 * the selected Three.js GPU backend. No Three.js object crosses into Rust.
 */
export async function createThreeRenderer(canvas, options = {}) {
  const forceWebGpu = options.kind === "three-webgpu";
  const forceWebGl = options.kind === "three-webgl";
  const useWebGpu = !forceWebGl && (forceWebGpu || Boolean(navigator.gpu));
  let THREE = await loadThree(options.threeModuleUrl ?? (useWebGpu ? LOCAL_THREE_WEBGPU_URL : LOCAL_THREE_URL));
  let backend = useWebGpu ? "webgpu" : "webgl";
  let renderer;
  if (useWebGpu && THREE.WebGPURenderer) {
    try {
      renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
      await renderer.init();
    } catch (error) {
      if (forceWebGpu) throw error;
      // A browser can expose navigator.gpu but still reject adapter/device
      // creation. Three.js WebGL is the safe host fallback.
      THREE = await loadThree(options.threeModuleUrl ?? LOCAL_THREE_URL);
      backend = "webgl";
    }
  }
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x111827, 1);
  renderer.info.autoReset=false;
  const bloom=backend==='webgl'?createBloom(THREE,renderer):null;
  bloom?.setEnabled(options.bloom??false);
  const effects=await createEffects(renderer.getContext?.(),options.getAssetManifest?.()?.assets??[],options.loadAssetUrl);

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const camera3d = new THREE.PerspectiveCamera(60,1,0.05,2000);
  const meshes3d = new Map();
  const meshAssets = new Map();
  const particles = createParticleRenderer(THREE,scene);
  const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, -1000, 1000);
  camera.position.z = 10;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const records = new Map();
  const textureRecords = new Map();
  const specsOf = () => new Map((options.getAssetManifest?.()?.assets ?? []).map((asset) => [String(asset.id), asset]));

  function resize(world) {
    const width = Math.max(1, canvas.clientWidth || canvas.width || 16);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 9);
    renderer.setSize(width, height, false);
    const visible = visibleSize({ ...world, __aspect: width / height });
    camera.left = -visible.width / 2;
    camera.right = visible.width / 2;
    camera.top = visible.height / 2;
    camera.bottom = -visible.height / 2;
    camera.position.x = world.camera?.position?.x ?? 0;
    camera.position.y = world.camera?.position?.y ?? 0;
    camera.updateProjectionMatrix();
  }

  function textureFor(asset) {
    const id = String(asset?.id ?? "");
    if (!id || typeof options.loadAssetUrl !== "function") return null;
    const existing = textureRecords.get(id);
    if (existing) return existing;
    const record = { state: "loading", texture: null, error: null };
    record.promise = options.loadAssetUrl(asset)
      .then((url) => new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(url, resolve, undefined, reject);
      }))
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        record.texture = texture;
        record.state = "ready";
      })
      .catch((error) => {
        record.state = "error";
        record.error = error;
      });
    textureRecords.set(id, record);
    return record;
  }

  function recordFor(entity) {
    const id = String(entity.id);
    let record = records.get(id);
    if (record) return record;
    const material = new THREE.MeshBasicMaterial({ color: colorFor(entity, THREE), transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    record = { mesh, material, assetId: null };
    records.set(id, record);
    root.add(mesh);
    return record;
  }

  function meshAssetFor(id, specs) {
    if (meshAssets.has(id)) return meshAssets.get(id);
    const asset = specs.get(id);
    if (asset?.kind !== 'mesh3d' || !asset.source.endsWith('.mesh.json')) throw new Error(`MESH_DECODER_UNAVAILABLE: ${id}`);
    const record = {geometry:null, material:null, error:null};
    record.promise = options.loadAssetUrl(asset).then(url => fetch(url)).then(response => {
      if (!response.ok) throw new Error(`MESH_LOAD_FAILED: ${id} (${response.status})`);
      return response.json();
    }).then(async raw => {
      const data = validateMesh(raw);
      const spec = specs.get(data.texture);
      if (spec?.kind !== 'texture2d') throw new Error(`MESH_TEXTURE_MISSING: ${data.texture}`);
      const texture = textureFor(spec);
      if (!texture) throw new Error(`MESH_TEXTURE_LOADER_MISSING: ${data.texture}`);
      await texture.promise;
      if (texture.error) throw texture.error;
      record.geometry = meshGeometry(THREE, data);
      record.material = new THREE.MeshBasicMaterial({map:texture.texture, side:THREE.DoubleSide, alphaTest:0.05});
    }).catch(error => { record.error = error; });
    meshAssets.set(id, record);
    return record;
  }

  function draw(snapshot) {
    renderer.info.reset();
    const world = worldOf(snapshot);
    resize(world);
    const specs = specsOf();
    const alive = new Set();
    for (const entity of visibleSprites(snapshot)) {
      const id = String(entity.id);
      const record = recordFor(entity);
      const sprite = entity.sprite;
      const scale = entity.scale ?? { x: 1, y: 1 };
      record.mesh.position.set(entity.transform.x, entity.transform.y, (sprite.layer ?? 0) / 1000);
      record.mesh.scale.set((sprite.size?.x ?? 1) * (scale.x ?? 1), (sprite.size?.y ?? 1) * (scale.y ?? 1), 1);
      record.mesh.rotation.z = entity.rotation ?? 0;
      record.mesh.visible = true;
      record.assetId = String(sprite.asset ?? "");
      const texture = textureFor(specs.get(record.assetId));
      if (texture?.state === "ready") {
        record.material.map = texture.texture;
        record.material.color.set(0xffffff);
        record.material.needsUpdate = true;
      } else {
        record.material.map = null;
        record.material.color.copy(colorFor(entity, THREE));
        record.material.needsUpdate = true;
      }
      record.mesh.renderOrder = Number(sprite.layer ?? 0);
      alive.add(id);
    }
    for (const [id, record] of records) {
      if (alive.has(id)) continue;
      record.mesh.visible = false;
    }
    let activeCamera = camera;
    if (world.camera3d) {
      const c = world.camera3d; camera3d.position.set(c.position.x,c.position.y,c.position.z);
      camera3d.lookAt(c.target.x,c.target.y,c.target.z); camera3d.fov=c.fov_degrees;
      camera3d.aspect=aspectOf(canvas); camera3d.updateProjectionMatrix(); activeCamera=camera3d;
    }
    const alive3d = new Set();
    for (const entity of Object.values(world.entities ?? {})) {
      if (!entity.mesh3d || !entity.transform3d || !entity.mesh3d.visible) continue;
      let mesh=meshes3d.get(entity.id);
      if (mesh && mesh.userData.asset !== entity.mesh3d.asset) {
        scene.remove(mesh);
        if (mesh.userData.asset.startsWith('mesh://primitive/')) { mesh.geometry.dispose(); mesh.material.dispose(); }
        meshes3d.delete(entity.id); mesh=null;
      }
      if (!mesh) {
        const shape=entity.mesh3d.asset;
        if (['mesh://primitive/box','mesh://primitive/sphere'].includes(shape)) {
          const geometry=shape.endsWith('/sphere') ? new THREE.SphereGeometry(0.5,16,12) : new THREE.BoxGeometry(1,1,1);
          mesh=new THREE.Mesh(geometry,new THREE.MeshNormalMaterial());
        } else {
          const asset=meshAssetFor(shape,specs);
          if(asset.error) throw asset.error;
          if(!asset.geometry) continue;
          mesh=new THREE.Mesh(asset.geometry,asset.material);
        }
        mesh.userData.asset=shape; scene.add(mesh); meshes3d.set(entity.id,mesh);
      }
      const t=entity.transform3d;
      mesh.position.set(t.position.x,t.position.y,t.position.z); mesh.rotation.set(t.rotation.x,t.rotation.y,t.rotation.z);
      const physicsRotation=world.physics3d?.bodies?.[entity.id]?.rotation;
      if(physicsRotation) mesh.quaternion.set(...physicsRotation);
      mesh.scale.set(t.scale.x,t.scale.y,t.scale.z); mesh.visible=true; alive3d.add(entity.id);
    }
    for (const [id,mesh] of meshes3d) mesh.visible=alive3d.has(id);
    particles.draw(world.particles);
    const overlay=effects?()=>{effects.draw(world,activeCamera);renderer.resetState();}:null;
    if(bloom) bloom.draw(scene,activeCamera,overlay);
    else {renderer.render(scene,activeCamera);overlay?.();}
  }

  function clearTextures() {
    for (const mesh of meshes3d.values()) {
      scene.remove(mesh);
      if (mesh.userData.asset.startsWith('mesh://primitive/')) { mesh.geometry.dispose(); mesh.material.dispose(); }
    }
    meshes3d.clear();
    for (const record of meshAssets.values()) { record.geometry?.dispose(); record.material?.dispose(); }
    meshAssets.clear();
    for (const record of textureRecords.values()) record.texture?.dispose();
    textureRecords.clear();
    for (const record of records.values()) {
      record.material.map = null;
      record.material.needsUpdate = true;
    }
  }

  return {
    draw,
    async ready() { await Promise.all([...meshAssets.values(),...textureRecords.values()].map(r=>r.promise)); for(const r of [...meshAssets.values(),...textureRecords.values()]) if(r.error) throw r.error; },
    clearTextures,
    usesGpuSprites: true,
    setBloom:enabled=>bloom?.setEnabled(enabled),
    resetMeasurements:()=>bloom?.resetMeasurements(),
    implementation: "three.js",
    backend,
    metrics: () => ({draw_calls:renderer.info.render.calls, triangles:renderer.info.render.triangles, textures:renderer.info.memory.textures, particles:particles.count,effects:effects?.count??0,...bloom?.metrics()}),
  };
}


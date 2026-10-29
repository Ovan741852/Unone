import {createShaderMaterials} from './shader-materials.js';
import {createTextureCachePolicy,parseTextureCache} from './texture-cache-policy.js';
import { createParticleRenderer } from "./particles.js?build=particle-texture-colorbins-v1";
import { meshGeometry, validateMesh } from "./mesh.js";
import {createInstanceRenderer} from './instances3d.js';
import {createBloom,normalizePostProcessing} from './bloom.js';
import {createEffects} from './effekseer.js';
import { compareSpriteEntities, worldOf } from "../shared/webgpu-snapshot.js";
import {heightfieldEntries,createHeightfieldRenderer} from '../shared/heightfields.js';
import {configureTexture,createPerspectiveCamera} from './presentation3d.js';
import {createProjectedRenderer,projectedEntries,assertProjectedBackend} from './projected.js';
import {normalizeAntialias} from '../shared/renderer-selection.mjs';
import {parseProjectedRaster,assertRasterBackend,assertRasterProfile,assertRasterSnapshot} from './projected-raster-policy.js';
import {createRasterCapability} from './projected-raster-capability.js';
import {createProjectedRasterPass} from './projected-raster.js';
import {createProjectedFrameDecoder} from '../shared/projected-frame.mjs';
import {parseFrameProfile,assertFrameOptions,assertFrameSnapshot} from './projected-frame-policy.js';
import {createFrameDraws} from './projected-frame-draws.js';
import {createFramePass} from './projected-frame-pass.js';
import {framePresentationIdentity} from './projected-frame-publication.js';
import {assertFrameGpuError} from './projected-frame-target-query.js';
import {FRAME_CONFORMANCE,frameConformance,validateFrameTarget} from './projected-frame-validator.js';
import {RASTER_PROFILE,validateRasterTarget} from './projected-raster-validator.js';
import {installContextClearRecovery} from './renderer-clear-lifecycle.js';
import {createStartupPresentationState} from './startup-presentation-state.js';
import {assetCatalogSpecs} from '../shared/asset-encoding.js';

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
  parseTextureCache(options.textureCache);
  const antialias=normalizeAntialias(options.antialias);
  const rasterPolicy=parseProjectedRaster(options.projectedRaster),checkedRaster=rasterPolicy.requested==='upper_left_checked';
  const frameProfile=parseFrameProfile(options.projectedMaterialProfile);let framePublication=null,framePublicationIdentity=null;
  const postprocessing=normalizePostProcessing(options.postprocessing);
  const forceWebGpu = options.kind === "three-webgpu";
  const forceWebGl = options.kind === "three-webgl";
  if(forceWebGpu&&postprocessing)throw Error('POSTPROCESSING_BACKEND_UNSUPPORTED: select the official WebGL player');
  const useWebGpu = !forceWebGl && !postprocessing && (forceWebGpu || Boolean(navigator.gpu));
  assertRasterBackend(rasterPolicy,useWebGpu?'webgpu':'webgl');
  assertFrameOptions(frameProfile,{backend:useWebGpu?'webgpu':'webgl',raster:rasterPolicy.requested,antialias,bloom:options.bloom??false,ao:options.ao??false});
  let THREE = await loadThree(options.threeModuleUrl ?? (useWebGpu ? LOCAL_THREE_WEBGPU_URL : LOCAL_THREE_URL));
  let backend = useWebGpu ? "webgpu" : "webgl";
  let renderer;
  if (useWebGpu && THREE.WebGPURenderer) {
    try {
      renderer = new THREE.WebGPURenderer({ canvas, antialias, alpha: false });
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
    renderer = new THREE.WebGLRenderer({ canvas, antialias, alpha: false });
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x111827, 1);
  const clearRecovery=backend==='webgl'?installContextClearRecovery(THREE,renderer,canvas):null;
  renderer.info.autoReset=false;
  const contextAntialias=renderer.getContext?.()?.getContextAttributes?.()?.antialias;
  const raster=Object.freeze({antialias_requested:antialias,context_antialias:typeof contextAntialias==='boolean'?contextAntialias:null,
    scope:'default_framebuffer',reconfigure:'relaunch',offscreen_antialias:'not_configured'});
  const bloom=backend==='webgl'?createBloom(THREE,renderer,options.postprocessing):null;
  bloom?.setEnabled(options.bloom??false);
  bloom?.setAO(options.ao??false);
  let bloomEnabled=options.bloom??false,aoEnabled=options.ao??false;
  const effects=await createEffects(renderer.getContext?.(),options.getAssetManifest?.()?.assets??[],options.loadAssetUrl);

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const camera3d = createPerspectiveCamera(THREE);
  const meshes3d = new Map();
  const meshAssets = new Map();
  const instances = createInstanceRenderer(THREE,scene,meshAssetFor,options.instanceMemory);
  const particles = createParticleRenderer(THREE,scene);
  const projected = createProjectedRenderer(THREE,textureFor,{raster:rasterPolicy.requested});
  const rasterPass=checkedRaster?createProjectedRasterPass(THREE,renderer):null;
  // Retained across redraws: unchanged packed geometry is validated once, not on every frame.
  const frameDecoder=createProjectedFrameDecoder();
  const frameDraws=frameProfile?createFrameDraws(THREE,textureFor):null,framePass=frameProfile?createFramePass(THREE,renderer):null;
  // Explicit opt-in player profiling only (options.profiler); null keeps every site a single branch.
  const profile=options.profiler?.renderer??null;
  if(options.profiler)profileProviders(options.profiler);
  let startupPresentation=null;
  const conformance=frameProfile?frameConformance(frameProfile):RASTER_PROFILE;
  const rasterCapability=createRasterCapability({policy:rasterPolicy,profile:conformance,
    validate:view=>{const original=validateRasterTarget(THREE,renderer,rasterPass,view);if(!frameProfile||original.lost||original.passed!==original.samples)return original;
     const next=validateFrameTarget(THREE,renderer,framePass,{...view,material_profile:frameProfile});if(next.lost)return next;
     return {samples:original.samples+next.samples,passed:original.passed+next.passed,failures:[...original.failures,...next.failures].slice(0,8)};},
    onState:()=>{startupPresentation?.changed();publishRasterState();}});
  function rasterMetrics(){
    const actual=renderer.getContext?.()?.getContextAttributes?.()?.antialias;
    return {...raster,context_antialias:typeof actual==='boolean'?actual:null,
      projected:{...rasterCapability.metrics(),...(frameProfile?{material_profile:frameProfile,frame_probe_hash:conformance.hash,raster_probe_hash:RASTER_PROFILE.hash,frame_revision:framePublication?.revision??null,frame_target:framePass.metrics()}:{}),
       ...(startupPresentation?{completed_game_draw:startupPresentation.metrics()}:{})},clear_state_recovery:clearRecovery?.metrics()??null};
  }
  function publishRasterState(){options.onRasterState?.(rasterMetrics());}
  function validateRaster(){
    if(!rasterAvailable())return false;
    const gl=renderer.getContext?.();
    if(checkedRaster&&(typeof globalThis.WebGL2RenderingContext!=='function'||!(gl instanceof globalThis.WebGL2RenderingContext)))throw Error('PROJECTED_RASTER_PROFILE_UNSUPPORTED: WebGL2 required');
    const effectiveAA=gl?.getContextAttributes?.()?.antialias;
    if(!rasterAvailable())return false;
    assertRasterProfile(rasterPolicy,{antialias,effectiveAA,
      bloom:bloomEnabled,ao:aoEnabled,postprocessing:options.postprocessing,
      outputSupported:renderer.outputColorSpace===THREE.SRGBColorSpace&&renderer.toneMapping===THREE.NoToneMapping&&!renderer.capabilities?.reversedDepthBuffer});
    const size=renderer.getDrawingBufferSize(new THREE.Vector2());
    const valid=rasterCapability.ensure({width:size.x,height:size.y,dpr:renderer.getPixelRatio()});
    return rasterAvailable()&&valid;
  }
  function rasterLost(){
    if(['lost','failed','disposed'].includes(rasterCapability.metrics().status))return;
    projected.clear();frameDraws?.clear();framePass?.invalidate();rasterPass?.invalidate();rasterCapability.lost();
    profile?.record('context','lost',{context_epoch:rasterCapability.metrics().context_epoch});
  }
  function rasterRestored(){
    if(rasterCapability.metrics().status!=='lost')return;
    projected.clear();frameDraws?.clear();framePass?.invalidate();rasterPass?.invalidate();rasterCapability.restored();
    profile?.record('context','restored',{context_epoch:rasterCapability.metrics().context_epoch});
  }
  function rasterAvailable(){
    // The raw flag can change before webglcontextlost is dispatched.
    if(renderer.getContext?.()?.isContextLost?.()){rasterLost();return false;}
    return !['lost','disposed'].includes(rasterCapability.metrics().status);
  }
  canvas.addEventListener('webglcontextlost',rasterLost);canvas.addEventListener('webglcontextrestored',rasterRestored);
  if(checkedRaster)startupPresentation=createStartupPresentationState({available:rasterAvailable,metrics:rasterCapability.metrics,
    view:()=>{const size=renderer.getDrawingBufferSize(new THREE.Vector2());return {width:size.x,height:size.y,dpr:renderer.getPixelRatio(),
     ...(frameProfile?{material_profile:frameProfile,frame_revision:framePublication?.revision??null}:{})};}});
  const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, -1000, 1000);
  camera.position.z = 10;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const records = new Map();
  const shaderMaterials = createShaderMaterials(THREE, renderer, backend);
  const textureRecords = new Map();
  const textureCache = createTextureCachePolicy(textureRecords,options.textureCache);
  const heightfields = createHeightfieldRenderer(THREE,scene,textureFor);
  // An explicit immutable catalog grant (getAssetCatalog) reuses one index across draws; callers that only
  // pass getAssetManifest keep the exact legacy per-draw rebuild, so their in-place edits stay visible.
  if(options.getAssetCatalog!==undefined&&typeof options.getAssetCatalog!=='function')throw Error('ASSET_CATALOG_PROVIDER_INVALID: getAssetCatalog must be a function');
  const specsOf = options.getAssetCatalog ? () => assetCatalogSpecs(options.getAssetCatalog()) : () => new Map((options.getAssetManifest?.()?.assets ?? []).map((asset) => [String(asset.id), asset]));
  const presentationHooks = new Set();
  const disposeHooks = [];
  let lastDrawTime = null;

  function attachPresentation(value) {
    const hook = typeof value === "function" ? { beforeRender: value } : value;
    if (typeof hook?.beforeRender !== "function") throw new Error("presentation hook requires beforeRender(context)");
    presentationHooks.add(hook);
    if (typeof hook.onDispose === "function") disposeHooks.push(hook.onDispose);
    return () => presentationHooks.delete(hook);
  }

  if (typeof options.beforeRender === "function") attachPresentation({ beforeRender: options.beforeRender });

  function presentationContext(snapshot, dt) {
    return { snapshot, dt, THREE, scene, renderer, backend, root, camera, camera3d, attachPresentation };
  }

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

  function textureFor(asset,owner='persistent') {
    const id = String(asset?.id ?? "");
    if (!id || typeof options.loadAssetUrl !== "function") return null;
    const existing = textureRecords.get(id);
    if (existing) {textureCache.touch(id,existing,{persistent:owner!=='sprite'});return existing;}
    const record = { state: "loading", texture: null, error: null };
    record.promise = options.loadAssetUrl(asset)
      .then((url) => new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(url, resolve, undefined, reject);
      }))
      .then((texture) => {
        if(record.discarded||textureRecords.get(id)!==record){texture.dispose();return;}
        record.texture = configureTexture(THREE,texture);
        record.state = "ready";
      })
      .catch((error) => {
        record.state = "error";
        record.error = error;
      });
    textureRecords.set(id, record);
    textureCache.touch(id,record,{persistent:owner!=='sprite'});
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
      if(record.discarded||meshAssets.get(id)!==record)return null;
      if (!response.ok) throw new Error(`MESH_LOAD_FAILED: ${id} (${response.status})`);
      return response.json();
    }).then(async raw => {
      if(record.discarded||meshAssets.get(id)!==record)return;
      const data = validateMesh(raw);
      const spec = specs.get(data.texture);
      if (spec?.kind !== 'texture2d') throw new Error(`MESH_TEXTURE_MISSING: ${data.texture}`);
      const texture = textureFor(spec);
      if (!texture) throw new Error(`MESH_TEXTURE_LOADER_MISSING: ${data.texture}`);
      await texture.promise;
      if(record.discarded||meshAssets.get(id)!==record)return;
      if (texture.error) throw texture.error;
      if(texture.discarded||!texture.texture)return;
      record.geometry = meshGeometry(THREE, data);
      record.material = new THREE.MeshBasicMaterial({map:texture.texture, side:THREE.DoubleSide, alphaTest:0.05});
    }).catch(error => { if(!record.discarded&&meshAssets.get(id)===record)record.error = new Error(`${error.message} [/${asset.source}]`); });
    meshAssets.set(id, record);
    return record;
  }

  // Opt-in profiling: resource counters copied at each draw scope entry/exit by the player profiler.
  function profileProviders(profiler){
    if(frameDraws)profiler.provide('frame_resources',()=>frameDraws.metrics());
    profiler.provide('frame_decoder',()=>frameDecoder.metrics());
    profiler.provide('texture_cache',()=>{const m=textureCache.metrics();return {entries:m.entries,loading:m.loading,evicted:m.evicted,decoded_texture_bytes_estimate:m.decoded_texture_bytes_estimate};});
    profiler.provide('gl',()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}),'after');
    profiler.provide('raster',()=>{const m=rasterCapability.metrics();return {status:m.status,context_epoch:m.context_epoch,target_generation:m.target_generation};},'after');
  }
  function frameShape(frame){
    let bytes=0;for(const d of frame.draws)bytes+=d.vertex_count*40+d.index_count*4;
    return {frame_revision:String(frame.revision),frame_draws:frame.draws.length,frame_geometry_bytes:bytes};
  }
  function draw(snapshot, drawOptions = {}) {
    textureCache.begin();
    assertProjectedBackend(snapshot,backend);
    assertRasterSnapshot(rasterPolicy,snapshot);
    profile?.mark('snapshot_policy');
    const frame=frameDecoder.decode(snapshot);assertFrameSnapshot(frameProfile,snapshot,frame);
    profile?.mark('frame_decode_validate');if(profile&&frame)profile.attach(()=>frameShape(frame));
    if(frameProfile){const identity=framePresentationIdentity(frame);if(identity!==framePublicationIdentity)startupPresentation?.invalidate();framePublicationIdentity=identity;}
    framePublication=frame;
    profile?.mark('frame_identity');
    if(!rasterAvailable()){profile?.outcome('skipped_raster_unavailable');return;}
    const projectedBatches=projectedEntries(snapshot);
    const worldVisible=(snapshot?.world??snapshot)?.projected_world_visible!==false;
    if(projectedBatches.length&&bloom&&worldVisible)throw Error('PROJECTED_POSTPROCESSING_UNSUPPORTED: disable Bloom or hide normal world3D');
    const terrain=heightfieldEntries(snapshot);
    if(worldVisible&&terrain.length&&!(snapshot?.world??snapshot)?.camera3d)throw new Error('HEIGHTFIELD_CAMERA3D_REQUIRED');
    profile?.mark('legacy_projected_terrain_validate');
    const now = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
    const inferredDt = lastDrawTime === null ? 0 : Math.max(0, (now - lastDrawTime) / 1000);
    const dt = Number.isFinite(Number(drawOptions.dt)) ? Math.max(0, Number(drawOptions.dt)) : inferredDt;
    lastDrawTime = now;
    const context = presentationContext(snapshot, dt);
    for (const hook of presentationHooks) hook.beforeRender(context);
    profile?.mark('presentation_hooks');
    if(!rasterAvailable()){profile?.outcome('skipped_raster_unavailable');return;}
    renderer.info.reset();
    const world = worldOf(snapshot);
    resize(world);
    assertRasterSnapshot(rasterPolicy,snapshot);
    if(checkedRaster&&!validateRaster()){profile?.outcome('skipped_raster_validation');return;}
    if(frameProfile)assertFrameGpuError(renderer.getContext(),'official.post-validation');
    profile?.mark('resize_raster_validate');
    const specs = specsOf();
    if(profile)profile.attach(()=>({asset_index:specs instanceof Map?'legacy_rebuild':'catalog',asset_index_size:specs.size,...(options.getAssetCatalog?{asset_catalog_generation:options.getAssetCatalog().generation}:{})}));
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
      const texture = textureFor(specs.get(record.assetId),'sprite');
      if (texture?.state === "ready") {
        record.material.map = texture.texture;
        record.material.color.set(0xffffff);
        record.material.needsUpdate = true;
      } else {
        record.material.map = null;
        record.material.color.copy(colorFor(entity, THREE));
        record.material.needsUpdate = true;
      }
      record.mesh.material = shaderMaterials.assign(entity, record.material, world);
      record.mesh.renderOrder = Number(sprite.layer ?? 0);
      alive.add(id);
    }
    for (const [id, record] of records) {
      if (alive.has(id)) continue;
      record.mesh.visible = false;
      record.material.map = null;
    }
    shaderMaterials.retain(new Set([...alive].filter(id => Boolean(world.entities[id]?.shader_material))));
    let activeCamera = camera;
    if (world.camera3d) {
      const c = world.camera3d; camera3d.position.set(c.position.x,c.position.y,c.position.z);
      camera3d.lookAt(c.target.x,c.target.y,c.target.z); camera3d.fov=c.fov_degrees;
      camera3d.aspect=aspectOf(canvas); camera3d.updateProjectionMatrix(); activeCamera=camera3d;
    }
    const alive3d = new Set();
    for (const entity of Object.values(world.entities ?? {})) {
      if (!worldVisible || !entity.mesh3d || !entity.transform3d || !entity.mesh3d.visible) continue;
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
    profile?.mark('scene_sync');
    heightfields.draw(worldVisible?terrain:[],specs);
    instances.draw(worldVisible?world.instances3d:{},specs);
    particles.draw(worldVisible?world.particles:[], activeCamera);
    profile?.mark('subrenderer_prepare');
    projected.prepare(projectedBatches,specs);
    textureCache.sweep();
    profile?.mark('projected_prepare_texture_sweep');
    const prepared=!frameProfile||frameDraws.prepare(frame,specs);
    if(frameProfile)profile?.mark('frame_resource_prepare');
    if(!prepared){profile?.outcome('pending_frame_resources');return;}
    if(frameProfile)assertFrameGpuError(renderer.getContext(),'official.prepare');
    const overlay=worldVisible&&effects?()=>{effects.draw(world,activeCamera);renderer.resetState();}:null;
    if(bloom) bloom.draw(scene,activeCamera,overlay);
    else {renderer.render(scene,activeCamera);overlay?.();}
    if(frameProfile)assertFrameGpuError(renderer.getContext(),'official.ordinary-render');
    profile?.mark('ordinary_render_submit');
    if(frameProfile){const passed=framePass.draw(frameDraws,activeCamera,frame);profile?.mark('frame_pass_submit');if(!passed){profile?.outcome('incomplete_frame_pass');return;}}
    else{if(rasterPass){if(projectedBatches.length)rasterPass.draw(projected,activeCamera);}
    else projected.draw(renderer,activeCamera,!worldVisible);profile?.mark('projected_pass_submit');}
    startupPresentation?.drawn();
    profile?.outcome('completed');
  }

  function clearTextures() {
    if(frameProfile)startupPresentation?.invalidate();
    frameDecoder.clear();
    frameDraws?.clear();
    shaderMaterials.clear();
    for (const record of records.values()) record.mesh.material = record.material;
    instances.clear();
    projected.clear();
    heightfields.clear();
    for (const mesh of meshes3d.values()) {
      scene.remove(mesh);
      if (mesh.userData.asset.startsWith('mesh://primitive/')) { mesh.geometry.dispose(); mesh.material.dispose(); }
    }
    meshes3d.clear();
    for (const record of meshAssets.values()) { record.discarded=true;record.geometry?.dispose(); record.material?.dispose(); }
    meshAssets.clear();
    textureCache.clear();
    for (const record of records.values()) {
      record.material.map = null;
      record.material.needsUpdate = true;
    }
  }

  function dispose() {
    canvas.removeEventListener('webglcontextlost',rasterLost);canvas.removeEventListener('webglcontextrestored',rasterRestored);
    rasterCapability.dispose();startupPresentation?.dispose();rasterPass?.dispose();framePass?.dispose();clearRecovery?.dispose();
    for (const hook of [...disposeHooks].reverse()) {
      try { hook(); } catch { /* disposal must not break host teardown */ }
    }
    disposeHooks.length = 0;
    presentationHooks.clear();
    particles.dispose();
    bloom?.dispose();
    shaderMaterials.dispose();
    clearTextures();
    for (const record of records.values()) { root.remove(record.mesh); record.material.dispose(); }
    records.clear();
    geometry.dispose();
    window.removeEventListener("resize", resize);
    renderer.dispose?.();
  }

  const readyContext = presentationContext(null, 0);
  if (typeof options.onReady === "function") {
    const cleanup = await options.onReady(readyContext);
    if (typeof cleanup === "function") disposeHooks.push(cleanup);
    else if (typeof cleanup?.dispose === "function") disposeHooks.push(() => cleanup.dispose());
  }
  if(checkedRaster){try{resize({});validateRaster();}catch(error){dispose();throw error;}}

  return {
    draw,
    startupPresentation,
    async ready() { await Promise.all([...meshAssets.values(),...textureRecords.values()].map(r=>r.promise)); for(const r of [...meshAssets.values(),...textureRecords.values()]) if(r.error) throw r.error; },
    clearTextures,
    attachPresentation,
    dispose,
    usesGpuSprites: true,
    setBloom:enabled=>{if(checkedRaster&&enabled)throw Error('PROJECTED_RASTER_PROFILE_UNSUPPORTED: Bloom must stay off');bloomEnabled=enabled;bloom?.setEnabled(enabled);},
    setAO:enabled=>{if(checkedRaster&&enabled)throw Error('PROJECTED_RASTER_PROFILE_UNSUPPORTED: AO must stay off');aoEnabled=enabled;bloom?.setAO(enabled);},
    resetMeasurements:()=>bloom?.resetMeasurements(),
    implementation: "three.js",
    backend,
      metrics: () => ({texture_cache:textureCache.metrics(),raster:rasterMetrics(),shader_materials:shaderMaterials.count,instances:instances.count,...instances.metrics(),...heightfields.metrics(),...projected.metrics(),...(frameDraws?frameDraws.metrics():{}),draw_calls:renderer.info.render.calls, triangles:renderer.info.render.triangles, textures:renderer.info.memory.textures, particles:particles.count,particle_batches:particles.debugBatches,effects:effects?.count??0,...bloom?.metrics()}),
  };
}


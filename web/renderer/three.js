import {createShaderMaterials} from './shader-materials.js';
import {createTextureCachePolicy,parseTextureCache} from './texture-cache-policy.js';
import { createParticleRenderer } from "./particles.js?build=particle-texture-colorbins-v1";
import { meshGeometry, validateMesh } from "./mesh.js";
import {createInstanceRenderer} from './instances3d.js';
import {createGeometry3DRenderer} from './geometry3d.js';
import {createWorldCurvature} from './world-curvature.js';
import {createMeshEntityRenderer} from './mesh-entities.js';
import {createBloom,normalizePostProcessing} from './bloom.js';
import {createEffects} from './effekseer.js';
import { compareSpriteEntities, worldOf } from "../shared/webgpu-snapshot.js";
import { syncSpriteCell } from "./sprite-cells.js";
import {createSpriteResourcePool,parseSpriteResourceBudget} from './sprite-resources.js';
import {createSpritePresentation} from './sprite-presentation.js';
import {heightfieldEntries,createHeightfieldRenderer} from '../shared/heightfields.js';
import {configureTexture,createPerspectiveCamera} from './presentation3d.js';
import {createProjectedRenderer,assertProjectedBackend} from './projected.js';
import {createUiImageBatchPrefix} from './ui-image-batch-prefix.js';
import {createGpuUi} from './ui-gpu.js';
import {DRAW_COMPLETED,DRAW_SKIPPED} from '../shared/player-completion.mjs';
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
  parseSpriteResourceBudget(options.spriteResourceBudget);
  let spriteResources=null,spritePresentation=null;
  if(options.getImageAssets!==undefined&&typeof options.getImageAssets!=='function')throw Error('IMAGE_ASSET_PROVIDER_INVALID: getImageAssets must be a function');
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
  // Extension pass kinds a host registered (render_extensions), and one
  // instance per declared pass id, created on first use.
  const passKinds=options.renderPasses??{};
  if(typeof passKinds!=='object'||Array.isArray(passKinds)||Object.values(passKinds).some(create=>typeof create!=='function'))throw Error('RENDER_PASSES_INVALID: expected {kind: createPass}');
  const passInstances=new Map();
  function extensionRunner(pass){
    let instance=passInstances.get(pass.id);
    if(instance&&instance.kind!==pass.kind){instance.runner.dispose?.();passInstances.delete(pass.id);instance=null;}
    if(!instance){
      const create=passKinds[pass.kind];
      if(!create)throw Error(`RENDER_PASS_KIND_UNAVAILABLE: pass '${pass.id}' needs kind '${pass.kind}'; declare it in render_extensions`);
      const runner=create({THREE,renderer,id:pass.id,params:pass.params??{}});
      if(typeof runner?.draw!=='function')throw Error(`RENDER_PASS_INVALID: '${pass.kind}' createPass must return {draw, dispose?}`);
      instance={kind:pass.kind,runner};passInstances.set(pass.id,instance);
    }
    return instance.runner;
  }
  // Per-frame settings for a declared pipeline (ADR 0048); absent params use
  // the same defaults as presentation Bloom.
  function pipelineFrame(pipeline){
    const passes=pipeline.passes,find=kind=>passes.find(pass=>pass.kind===kind),on=pass=>Boolean(pass&&pass.enabled);
    const number=(pass,key,fallback)=>typeof pass?.params?.[key]==='number'?pass.params[key]:fallback;
    const ao=find('ao'),glow=find('bloom'),tone=find('tonemap'),projectedPass=find('projected');
    return {
      ids:passes.filter(pass=>pass.enabled).map(pass=>pass.id),
      scene:on(find('scene')),
      ao:{on:on(ao),strength:number(ao,'strength',1.7)},
      bloom:{on:on(glow),threshold:number(glow,'threshold',.55),strength:number(glow,'strength',.75)},
      tone:on(tone)?{mode:tone.params?.mode==='aces'?'aces':'none',exposure:number(tone,'exposure',1)}:null,
      extensions:passes.filter(pass=>!['scene','ao','bloom','tonemap','projected','ui'].includes(pass.kind)&&pass.enabled)
        .map(pass=>({id:pass.id,params:pass.params??{},runner:extensionRunner(pass)})),
      projected:!projectedPass||projectedPass.enabled,
    };
  }
  const effects=await createEffects(renderer.getContext?.(),options.getAssetManifest?.()?.assets??[],options.loadAssetUrl);

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  // World objects share one group, so a left-handed camera mirrors the whole
  // world (three flips face culling for its negative scale).
  const world3d = new THREE.Group(),bufferSize = new THREE.Vector2();
  scene.add(world3d);
  const camera3d = createPerspectiveCamera(THREE);
  const meshAssets = new Map();
  const instances = createInstanceRenderer(THREE,world3d,meshAssetFor,options.instanceMemory);
  const meshEntities = createMeshEntityRenderer(THREE,world3d,meshAssetFor);
  const particles = createParticleRenderer(THREE,world3d);
  const projected = createProjectedRenderer(THREE,textureFor,{raster:rasterPolicy.requested});
  const uiImageBatchPrefix=createUiImageBatchPrefix(THREE,renderer,{enabled:backend==='webgl'&&!checkedRaster&&!frameProfile});
  // The render pipeline's ui stage: game UI drawn into this frame after the world.
  let worldSubmitted=false;
  const ui=backend==='webgl'?createGpuUi(THREE,renderer,{available:()=>worldSubmitted&&rasterAvailable()}):null;
  let assetRequestPending=false;
  const rasterPass=checkedRaster?createProjectedRasterPass(THREE,renderer):null;
  // Retained across redraws: unchanged packed geometry is validated once, not on every frame.
  const frameDecoder=createProjectedFrameDecoder({copyGeometry:false});
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
    spriteResources?.contextLost();retireWorldGpuBindings();ui?.contextLost();
    projected.clear();uiImageBatchPrefix.clear();frameDraws?.clear();framePass?.contextLost?.();rasterPass?.contextLost?.();framePass?.invalidate();rasterPass?.invalidate();rasterCapability.lost();
    profile?.record('context','lost',{context_epoch:rasterCapability.metrics().context_epoch});
  }
  function rasterRestored(){
    if(rasterCapability.metrics().status!=='lost')return;
    projected.clear();uiImageBatchPrefix.clear();frameDraws?.clear();framePass?.invalidate();rasterPass?.invalidate();rasterCapability.restored();
    spriteResources?.contextRestored();profile?.record('context','restored',{context_epoch:rasterCapability.metrics().context_epoch});
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
  spriteResources=backend==='webgl'&&options.getImageAssets&&options.getAssetCatalog?createSpriteResourcePool({THREE,renderer,
    getCatalog:options.getAssetCatalog,getImages:options.getImageAssets,budget:options.spriteResourceBudget,backend,
    onReset:()=>spritePresentation?.reset(),withPreparationTargets:compile=>bloom?bloom.withWorldPreparationTargets(compile):compile()}):null;
  if(spriteResources)spritePresentation=createSpritePresentation({THREE,root,geometry,records,recordFor,resources:spriteResources,legacy:drawLegacySprite});
  const heightfields = createHeightfieldRenderer(THREE,world3d,textureFor);
  const curvature = createWorldCurvature(),rectSize = new THREE.Vector2();
  const geometry3d = createGeometry3DRenderer(THREE,world3d,{textureFor,memory:options.instanceMemory,curvature});
  // A camera rect (normalized, lower-left origin) renders the world into part of
  // the surface; the rest of the surface is still cleared.
  function drawInRect(rect,render){
    const size=renderer.getSize(rectSize),autoClear=renderer.autoClear;
    renderer.setScissorTest(false);if(autoClear)renderer.clear();
    const x=rect.x*size.x,y=rect.y*size.y,w=rect.width*size.x,h=rect.height*size.y;
    renderer.setViewport(x,y,w,h);renderer.setScissor(x,y,w,h);renderer.setScissorTest(true);renderer.autoClear=false;
    try{render();}finally{renderer.autoClear=autoClear;renderer.setScissorTest(false);renderer.setViewport(0,0,size.x,size.y);}
  }
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
    const imageAssets=options.getImageAssets?.();
    if (!id || (!imageAssets&&typeof options.loadAssetUrl !== "function")) {assetRequestPending=true;return null;}
    const existing = textureRecords.get(id);
    if (existing) {if(existing.state!=='ready')assetRequestPending=true;textureCache.touch(id,existing,{persistent:owner!=='sprite'});return existing;}
    const record = { state: "loading", texture: null, error: null };
    if(imageAssets){
      textureRecords.set(id,record);textureCache.touch(id,record,{persistent:owner!=='sprite'});
      const current=()=>!record.discarded&&textureRecords.get(id)===record;
      const fail=error=>{if(current()){record.state='error';record.error=error;}};
      const attach=()=>{
        if(!current())return;
        const lease=record.imageLease;
        if(lease.state==='error')throw lease.error??Error('IMAGE_ASSET_FAILED: '+id);
        if(lease.state!=='ready'||!lease.image)throw Error('IMAGE_ASSET_NOT_READY: '+id);
        // GPU sampler/color ownership remains local; the immutable CPU image
        // is kept leased across context restoration and never closed here.
        const texture=new THREE.Texture(lease.image);
        try{record.texture=configureTexture(THREE,texture);}catch(error){texture.dispose();throw error;}
        record.state='ready';
      };
      try{
        record.imageLease=imageAssets.acquire(id);
        if(record.imageLease.state==='ready'){attach();record.promise=Promise.resolve();}
        else if(record.imageLease.state==='error'){fail(record.imageLease.error??Error('IMAGE_ASSET_FAILED: '+id));record.promise=record.imageLease.promise.catch(fail);}
        else record.promise=record.imageLease.promise.then(attach).catch(fail);
      }catch(error){fail(error);record.promise=Promise.resolve();}
      if(record.state!=='ready')assetRequestPending=true;
      return record;
    }
    assetRequestPending=true;
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
    textureRecords.set(id,record);textureCache.touch(id,record,{persistent:owner!=='sprite'});
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

  function drawLegacySprite(record,entity,world) {
    record.material??=new THREE.MeshBasicMaterial({color:colorFor(entity,THREE),transparent:true,opacity:1});
    const sprite=entity.sprite,scale=entity.scale??{x:1,y:1};
    record.mesh.position.set(entity.transform.x,entity.transform.y,(sprite.layer??0)/1000);
    record.mesh.scale.set((sprite.size?.x??1)*(scale.x??1),(sprite.size?.y??1)*(scale.y??1),1);
    record.mesh.rotation.z=entity.rotation??0;syncSpriteCell(record,sprite,geometry);record.mesh.visible=true;
    const id=String(sprite.asset??''),texture=textureFor(specsOf().get(id),'sprite');
    record.assetId=id;
    if(texture?.state==='ready'){record.material.map=texture.texture;record.material.color.set(0xffffff);}
    else{record.material.map=null;record.material.color.copy(colorFor(entity,THREE));}
    record.material.needsUpdate=true;record.mesh.material=shaderMaterials.assign(entity,record.material,world);record.mesh.renderOrder=Number(sprite.layer??0);
    return texture?.state==='ready';
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

  function retireWorldGpuBindings() {
    // Three replaces its WebGL managers on restore. Detach their listeners
    // while the old context is lost, keeping CPU arrays, images and owners.
    // Only explicit engine resources participate; presentation hooks own theirs.
    const seen=new Set(),retire=value=>{if(value&&!seen.has(value)){seen.add(value);value.dispose();}};
    retire(geometry);
    for(const record of records.values()){retire(record.material);retire(record.cellGeometry);}
    meshEntities.contextLost(retire);
    for(const record of meshAssets.values()){retire(record.geometry);retire(record.material);}
    for(const record of textureRecords.values())retire(record.texture);
    shaderMaterials.contextLost(retire);
    instances.contextLost(retire);
    particles.contextLost(retire);
    heightfields.contextLost(retire);
    geometry3d.contextLost(retire);
    bloom?.contextLost(retire);
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
    assetRequestPending=false;worldSubmitted=false;
    textureCache.begin();
    assertProjectedBackend(snapshot,backend);
    assertRasterSnapshot(rasterPolicy,snapshot);
    profile?.mark('snapshot_policy');
    const frame=frameDecoder.decode(snapshot);assertFrameSnapshot(frameProfile,snapshot,frame);
    profile?.mark('frame_decode_validate');if(profile&&frame)profile.attach(()=>frameShape(frame));
    if(frameProfile){const identity=framePresentationIdentity(frame,framePublicationIdentity);if(identity!==framePublicationIdentity)startupPresentation?.invalidate();framePublicationIdentity=identity;}
    framePublication=frame;
    profile?.mark('frame_identity');
    if(!rasterAvailable()){profile?.outcome('skipped_raster_unavailable');return DRAW_SKIPPED.raster_unavailable;}
    const projectedBatches=projected.entries(snapshot);
    const worldVisible=(snapshot?.world??snapshot)?.projected_world_visible!==false;
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
    if(!rasterAvailable()){profile?.outcome('skipped_raster_unavailable');return DRAW_SKIPPED.raster_unavailable;}
    renderer.info.reset();
    const world = worldOf(snapshot);
    resize(world);
    assertRasterSnapshot(rasterPolicy,snapshot);
    if(checkedRaster&&!validateRaster()){profile?.outcome('skipped_raster_validation');return DRAW_SKIPPED.raster_validation;}
    if(frameProfile)assertFrameGpuError(renderer.getContext(),'official.post-validation');
    profile?.mark('resize_raster_validate');
    const specs = specsOf();
    if(profile)profile.attach(()=>({asset_index:specs instanceof Map?'legacy_rebuild':'catalog',asset_index_size:specs.size,...(options.getAssetCatalog?{asset_catalog_generation:options.getAssetCatalog().generation}:{})}));
    if(spritePresentation){if(!spritePresentation.draw(world,worldVisible))assetRequestPending=true;shaderMaterials.retain(spritePresentation.legacyEntities());}
    else {
    const alive = new Set();
    for (const entity of visibleSprites(snapshot)) {
      const id = String(entity.id);
      const record = recordFor(entity);
      const sprite = entity.sprite;
      const scale = entity.scale ?? { x: 1, y: 1 };
      record.mesh.position.set(entity.transform.x, entity.transform.y, (sprite.layer ?? 0) / 1000);
      record.mesh.scale.set((sprite.size?.x ?? 1) * (scale.x ?? 1), (sprite.size?.y ?? 1) * (scale.y ?? 1), 1);
      record.mesh.rotation.z = entity.rotation ?? 0;
      syncSpriteCell(record, sprite, geometry);
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
      if (!world.entities?.[id]?.sprite) {
        root.remove(record.mesh);record.material.dispose();record.cellGeometry?.dispose();records.delete(id);
      }
    }
    shaderMaterials.retain(new Set([...alive].filter(id => Boolean(world.entities[id]?.shader_material))));
    }
    let activeCamera = camera;
    world3d.scale.z=world.camera3d?.handedness==='left'?-1:1;
    if (world.camera3d) {
      const c = world.camera3d,z = world3d.scale.z; camera3d.position.set(c.position.x,c.position.y,c.position.z*z);
      camera3d.lookAt(c.target.x,c.target.y,c.target.z*z); camera3d.fov=c.fov_degrees;
      camera3d.aspect=aspectOf(canvas)*(c.rect?c.rect.width/c.rect.height:1); camera3d.updateProjectionMatrix(); activeCamera=camera3d;
    }
    if(meshEntities.draw(world,worldVisible,specs))assetRequestPending=true;
    profile?.mark('scene_sync');
    heightfields.draw(worldVisible?terrain:[],specs);
    if(geometry3d.draw(worldVisible?world.geometry3d:{},world.geometry3d_placements,specs))assetRequestPending=true;
    instances.draw(worldVisible?world.instances3d:{},specs);
    particles.draw(worldVisible?world.particles:[], activeCamera);
    profile?.mark('subrenderer_prepare');
    projected.prepare(projectedBatches,specs);
    textureCache.sweep();
    profile?.mark('projected_prepare_texture_sweep');
    const prepared=!frameProfile||frameDraws.prepare(frame,specs);
    if(frameProfile)profile?.mark('frame_resource_prepare');
    if(!prepared){profile?.outcome('pending_frame_resources');return DRAW_SKIPPED.frame_resources_pending;}
    if(frameProfile)assertFrameGpuError(renderer.getContext(),'official.prepare');
    const overlay=worldVisible&&effects?()=>{effects.draw(world,activeCamera);renderer.resetState();}:null;
    const pipeline=world.render_pipeline?pipelineFrame(world.render_pipeline):null;
    // Projected batches composite after the world, so they cannot follow an
    // active post-processing pass; plain world rendering is fine.
    if(projectedBatches.length&&worldVisible&&bloom?.active(pipeline))throw Error('PROJECTED_POSTPROCESSING_UNSUPPORTED: disable Bloom or hide normal world3D');
    if(pipeline&&!bloom)throw Error('RENDER_PIPELINE_BACKEND_UNSUPPORTED: render_pipeline needs the official WebGL renderer');
    curvature.prepare(scene,world.camera3d);
    const rect=world.camera3d?.rect;
    if(renderer.getDrawingBufferSize){renderer.getDrawingBufferSize(bufferSize);curvature.viewport(bufferSize.x*(rect?rect.width:1),bufferSize.y*(rect?rect.height:1));}
    if(rect){
      if(bloom?.active(pipeline)||pipeline&&!pipeline.scene)throw Error('CAMERA_RECT_UNSUPPORTED: a camera rect cannot combine with bloom, tone mapping or render pipeline passes yet');
      drawInRect(rect,()=>{renderer.render(scene,activeCamera);overlay?.();});
    }
    else if(bloom) bloom.draw(scene,activeCamera,overlay,pipeline);
    else {renderer.render(scene,activeCamera);overlay?.();}
    worldSubmitted=true;
    if(frameProfile)assertFrameGpuError(renderer.getContext(),'official.ordinary-render');
    profile?.mark('ordinary_render_submit');
    if(frameProfile){const passed=framePass.draw(frameDraws,activeCamera,frame);profile?.mark('frame_pass_submit');if(!passed){profile?.outcome('incomplete_frame_pass');return DRAW_SKIPPED.frame_pass_incomplete;}}
    else if(!pipeline||pipeline.projected){if(rasterPass){if(projectedBatches.length)rasterPass.draw(projected,activeCamera);}
    else projected.draw(renderer,activeCamera,!worldVisible);profile?.mark('projected_pass_submit');}
    if(!rasterAvailable()){startupPresentation?.invalidate();profile?.outcome('skipped_raster_unavailable');return DRAW_SKIPPED.raster_unavailable;}
    if(assetRequestPending){profile?.outcome('pending_world_assets');return DRAW_SKIPPED.world_assets_pending;}
    spritePresentation?.submitted(worldVisible&&(!pipeline||pipeline.scene));
    startupPresentation?.drawn();
    profile?.outcome('completed');
    return DRAW_COMPLETED;
  }

  function clearTextures() {
    spriteResources?.public.reset();
    if(frameProfile)startupPresentation?.invalidate();
    framePublication=null;framePublicationIdentity=null;
    frameDecoder.clear();
    frameDraws?.clear();
    shaderMaterials.clear();
    for (const record of records.values()) record.mesh.material = record.material;
    instances.clear();
    projected.clear();
    uiImageBatchPrefix.clear();
    ui?.clear();
    heightfields.clear();
    geometry3d.clear();
    meshEntities.clear();
    for (const record of meshAssets.values()) { record.discarded=true;record.geometry?.dispose(); record.material?.dispose(); }
    meshAssets.clear();
    textureCache.clear();
    for (const record of records.values()) {
      record.material.map = null;
      record.material.needsUpdate = true;
    }
  }

  function dispose() {
    spriteResources?.dispose();
    canvas.removeEventListener('webglcontextlost',rasterLost);canvas.removeEventListener('webglcontextrestored',rasterRestored);
    rasterCapability.dispose();startupPresentation?.dispose();rasterPass?.dispose();framePass?.dispose();clearRecovery?.dispose();uiImageBatchPrefix.dispose();ui?.dispose();
    for (const hook of [...disposeHooks].reverse()) {
      try { hook(); } catch { /* disposal must not break host teardown */ }
    }
    disposeHooks.length = 0;
    presentationHooks.clear();
    particles.dispose();
    for(const {runner} of passInstances.values()){try{runner.dispose?.();}catch{/* teardown continues */}}
    passInstances.clear();
    bloom?.dispose();
    shaderMaterials.dispose();
    clearTextures();
    for (const record of records.values()) { root.remove(record.mesh); record.material.dispose(); record.cellGeometry?.dispose(); }
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
    uiImageBatchPrefix,
    ui,
    isPresentationAvailable:()=>rasterAvailable(),
    startupPresentation,
    spriteResources:spriteResources?.public??Object.freeze({prepare(){throw Error('SPRITE_RESOURCE_BACKEND_UNSUPPORTED');},reset(){},takeUpdates(){return {resources:[],appearances:[]};}}),
    async ready() { await Promise.all([...meshAssets.values(),...textureRecords.values()].map(r=>r.promise));await spriteResources?.ready(); for(const r of [...meshAssets.values(),...textureRecords.values()]) if(r.error) throw r.error; },
    clearTextures,
    attachPresentation,
    dispose,
    usesGpuSprites: true,
    setBloom:enabled=>{if(checkedRaster&&enabled)throw Error('PROJECTED_RASTER_PROFILE_UNSUPPORTED: Bloom must stay off');bloomEnabled=enabled;bloom?.setEnabled(enabled);},
    setAO:enabled=>{if(checkedRaster&&enabled)throw Error('PROJECTED_RASTER_PROFILE_UNSUPPORTED: AO must stay off');aoEnabled=enabled;bloom?.setAO(enabled);},
    resetMeasurements:()=>bloom?.resetMeasurements(),
    implementation: "three.js",
    backend,
      metrics: () => ({sprite_resources:spriteResources?{...spriteResources.metrics(),legacy_fallback_sprites:spritePresentation.legacyEntities().size}:{supported:false},texture_cache:textureCache.metrics(),world_image_leases:{enabled:!!options.getImageAssets?.(),active:[...textureRecords.values()].filter(r=>r.imageLease).length},raster:rasterMetrics(),ui_image_batches:uiImageBatchPrefix.metrics(),shader_materials:shaderMaterials.count,instances:instances.count,...instances.metrics(),mesh_entities:meshEntities.count,mesh_entity_batches:meshEntities.batches,...heightfields.metrics(),...geometry3d.metrics(),curvature:curvature.curvature,...projected.metrics(),...(frameDraws?frameDraws.metrics():{}),draw_calls:renderer.info.render.calls, triangles:renderer.info.render.triangles, textures:renderer.info.memory.textures, particles:particles.count,particle_pool:particles.metrics(),particle_batches:particles.debugBatches,effects:effects?.count??0,...bloom?.metrics()}),
  };
}


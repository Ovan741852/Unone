import { createWebGpuRenderer, frameOf, semanticSummary, worldFromPointer } from "../shared/webgpu-snapshot.js?v=3";
import { installGeneration, readActiveAsset, readActiveText } from "../live/bundle-store.js?v=3";
import { readSave, writeSave } from "./save-store.js?v=1";

const canvas = document.querySelector("#game");
const assetLayer = document.querySelector("#asset-layer");
const uiLayer = document.querySelector("#ui-layer");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
const query = new URLSearchParams(location.search);
const DEFAULT_ENTRY_SCRIPT = "scripts/main.luau";
const requestedProject = query.get("project") || "/Unone_Games/3d-racing/";
const projectRoot = new URL(requestedProject, location.origin);
if (!projectRoot.pathname.endsWith("/")) projectRoot.pathname += "/";
const seed = BigInt(query.get("seed") || "42");
const saveProjectKey = projectRoot.pathname;
const bundleDatabaseName = `unone-runner-bundles:${encodeURIComponent(projectRoot.pathname)}`;
let snapshot = null;
let renderer = null;
let bundleManifest = null;
let generationState = null;
let pointer = { position: { x: 0, y: 0 }, screen_position: { x: 0, y: 0 }, down: false };
let heldActions = {};
let pendingActions = {};
let renderedUi = null;
let loadedSave = false;
let lastStoredSaveText = null;
let pendingSaveText = null;
let saveWrite = Promise.resolve();
let assetManifest = null;
const assetUrls = new Map();
const assetUrlLoads = new Map();
const assetElements = new Map();

function readSnapshot() {
  const module = window.Module;
  const pointerAddress = module._unone_web_observation_ptr();
  const length = module._unone_web_observation_len();
  const bytes = module.HEAPU8.slice(pointerAddress, pointerAddress + length);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function bridgeBytes(text) {
  const bytes = new TextEncoder().encode(text);
  const pointerAddress = window.Module._unone_web_alloc(bytes.length);
  window.Module.HEAPU8.set(bytes, pointerAddress);
  return { pointerAddress, length: bytes.length };
}

function bridgeError(result, fallback) {
  const diagnostic = result?.diagnostic ?? null;
  const message = diagnostic
    ? `${diagnostic.code}: ${diagnostic.explanation}`
    : (result?.error ?? fallback);
  const error = new Error(message);
  error.diagnostic = diagnostic;
  return error;
}

function showFailure(error) {
  status.textContent = `failed: ${error.message}`;
  output.textContent = JSON.stringify({
    error: error.message,
    diagnostic: error.diagnostic ?? null,
  }, null, 2);
}

async function readJson(relativePath) {
  const response = await fetch(new URL(relativePath, projectRoot), { cache: "no-store" });
  if (!response.ok) throw new Error(`project file request failed: ${response.status} ${relativePath}`);
  return response.json();
}

async function readText(relativePath) {
  const response = await fetch(new URL(relativePath, projectRoot), { cache: "no-store" });
  if (!response.ok) throw new Error(`script request failed: ${response.status} ${relativePath}`);
  return response.text();
}

async function readManifest(manifestUrl) {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`bundle manifest request failed: ${response.status} ${manifestUrl}`);
  const manifest = await response.json();
  return {
    ...manifest,
    bundles: (manifest.bundles ?? []).map((spec) => ({
      ...spec,
      // BundleSpec.source is project-root relative for native and Web. The
      // host resolves it here instead of making the engine know URL layout.
      source: new URL(spec.source, projectRoot).href,
    })),
  };
}

async function readPackagedProject(bootstrapConfig) {
  const manifestPath = query.get("manifest") || bootstrapConfig.bundle_manifest;
  if (!manifestPath || query.get("bundle") === "0") return null;
  const manifestUrl = new URL(manifestPath, projectRoot);
  const manifest = await readManifest(manifestUrl);
  generationState = await installGeneration(manifest, {
    module: window.Module,
    databaseName: bundleDatabaseName,
  });
  const config = JSON.parse(await readActiveText(generationState, "project", window.Module, manifest));
  const script = await readActiveText(generationState, "script", window.Module, manifest);
  const scene = config.main_scene
    ? JSON.parse(await readActiveText(generationState, "scene", window.Module, manifest))
    : null;
  const packagedAssets = config.asset_manifest
    ? JSON.parse(await readActiveText(generationState, "asset-manifest", window.Module, manifest))
    : null;
  bundleManifest = { manifest, manifestUrl };
  return { config, script, scene, assetManifest: packagedAssets };
}

function assetMime(asset) {
  const source = asset.source.toLowerCase();
  if (source.endsWith(".svg")) return "image/svg+xml";
  if (source.endsWith(".webp")) return "image/webp";
  if (source.endsWith(".jpg") || source.endsWith(".jpeg")) return "image/jpeg";
  if (source.endsWith(".png")) return "image/png";
  return asset.kind === "texture2d" ? "image/*" : "application/octet-stream";
}

function releaseAssetUrls() {
  for (const url of assetUrls.values()) URL.revokeObjectURL(url);
  assetUrls.clear();
  assetUrlLoads.clear();
  assetElements.clear();
  assetLayer?.replaceChildren();
}

function loadAssetUrl(asset) {
  if (assetUrls.has(asset.id)) return Promise.resolve(assetUrls.get(asset.id));
  if (assetUrlLoads.has(asset.id)) return assetUrlLoads.get(asset.id);
  const load = (async () => {
    let bytes;
    if (generationState) {
      bytes = await readActiveAsset(generationState, asset, window.Module, bundleManifest.manifest);
    } else {
      const response = await fetch(new URL(asset.source, projectRoot), { cache: "no-store" });
      if (!response.ok) throw new Error(`asset request failed: ${response.status} ${asset.source}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: assetMime(asset) }));
    assetUrls.set(asset.id, url);
    return url;
  })();
  assetUrlLoads.set(asset.id, load);
  return load;
}

function renderAssets(nextSnapshot) {
  if (!assetLayer || !assetManifest?.assets) return;
  const world = nextSnapshot?.world ?? nextSnapshot;
  if (!world?.camera || !world.entities) return;
  const specs = new Map(assetManifest.assets.map((asset) => [asset.id, asset]));
  const alive = new Set();
  const zoom = world.camera.zoom;
  const camera = world.camera.position;
  for (const entity of Object.values(world.entities)) {
    const sprite = entity.sprite;
    const asset = sprite && specs.get(sprite.asset);
    if (!asset || sprite.visible === false) continue;
    alive.add(entity.id);
    let element = assetElements.get(entity.id);
    if (!element) {
      element = document.createElement("img");
      element.className = "unone-asset-sprite";
      element.draggable = false;
      element.alt = entity.name || entity.id;
      assetElements.set(entity.id, element);
      assetLayer.appendChild(element);
    }
    const clipX = -0.8 + (entity.transform.x - camera.x) * 0.2 * zoom;
    const clipY = -0.1 + (entity.transform.y - camera.y) * 0.2 * zoom;
    element.style.left = `${(clipX + 1) * 50}%`;
    element.style.bottom = `${(clipY + 1) * 50}%`;
    element.style.width = `${sprite.size.x * 10 * zoom}%`;
    element.style.height = `${sprite.size.y * 10 * zoom}%`;
    element.dataset.assetId = asset.id;
    if (element.src === "") {
      loadAssetUrl(asset)
        .then((url) => { element.src = url; })
        .catch(showFailure);
    }
  }
  for (const [entityId, element] of assetElements) {
    if (!alive.has(entityId)) {
      element.remove();
      assetElements.delete(entityId);
    }
  }
}

function screenFromPointer(canvasElement, event) {
  const rect = canvasElement.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  return { x: x * 100, y: (1 - y) * 100 };
}

function renderUi(nextSnapshot) {
  const ui = nextSnapshot?.world?.ui ?? null;
  const serialized = JSON.stringify(ui);
  if (serialized === renderedUi) return;
  renderedUi = serialized;
  uiLayer.replaceChildren();
  if (!ui) return;
  for (const node of ui.children ?? []) {
    const element = document.createElement(node.kind === "button" ? "button" : "div");
    element.className = `unone-ui-node unone-ui-${node.kind}`;
    element.textContent = node.text;
    element.dataset.nodeId = node.id;
    if (node.kind === "button") element.dataset.action = node.action;
    element.style.left = `${node.rect.x}%`;
    element.style.bottom = `${node.rect.y}%`;
    element.style.width = `${node.rect.width}%`;
    element.style.height = `${node.rect.height}%`;
    uiLayer.appendChild(element);
  }
}

function showState() {
  output.textContent = JSON.stringify({
    project_root: projectRoot.pathname,
    save_store: { backend: "indexeddb", loaded: loadedSave },
    bundle: generationState && {
      status: generationState.status,
      generation: generationState.generation,
      manifest_version: generationState.manifest_version,
      bundles: generationState.bundles,
    },
    assets: assetManifest && {
      manifest_version: assetManifest.version,
      count: assetManifest.assets?.length ?? 0,
      resolved: assetUrls.size,
    },
    ...semanticSummary(snapshot, pointer),
    save_payload: snapshot?.save_payload ?? null,
  }, null, 2);
  renderUi(snapshot);
  renderAssets(snapshot);
}

function queueAction(action) {
  if (typeof action === "string" && action.length > 0) pendingActions[action] = true;
}

function storeSave() {
  const payload = snapshot?.save_payload;
  if (payload == null) return;
  const serialized = JSON.stringify(payload);
  if (serialized === lastStoredSaveText || serialized === pendingSaveText) return;
  pendingSaveText = serialized;
  saveWrite = saveWrite.then(async () => {
    const next = pendingSaveText;
    pendingSaveText = null;
    if (next == null) return;
    await writeSave(saveProjectKey, JSON.parse(next));
    lastStoredSaveText = next;
  }).catch((error) => {
    status.textContent = `save store failed: ${error.message}`;
  });
}

async function loadProject() {
  const bootstrapConfig = await readJson("project.unone.json");
  const packaged = await readPackagedProject(bootstrapConfig);
  const config = packaged?.config ?? bootstrapConfig;
  const script = packaged?.script ?? await readText(config.entry_script ?? DEFAULT_ENTRY_SCRIPT);
  const scene = packaged?.scene ?? (config.main_scene ? await readJson(config.main_scene) : null);
  assetManifest = packaged?.assetManifest
    ?? (config.asset_manifest ? await readJson(config.asset_manifest) : null);
  const payload = bridgeBytes(JSON.stringify({ project: config.name, script, scene }));
  if (window.Module._unone_web_load_project(payload.pointerAddress, payload.length, seed) !== 0) {
    throw bridgeError(readSnapshot(), "generic project load failed");
  }
  snapshot = readSnapshot();
  const stored = await readSave(saveProjectKey);
  if (stored != null) {
    loadedSave = true;
    const savePayload = bridgeBytes(JSON.stringify(stored));
    if (window.Module._unone_web_set_save_payload(savePayload.pointerAddress, savePayload.length) !== 0) {
      throw new Error("stored save payload was rejected by the engine");
    }
    snapshot = readSnapshot();
  }
  const mode = packaged ? `bundle generation ${generationState.generation}` : "source files";
  status.textContent = `loaded ${config.name} from ${projectRoot.pathname} (${mode})`;
}

async function reloadActiveBundle() {
  if (!bundleManifest) {
    status.textContent = "bundle reload skipped: project has no configured bundle manifest";
    return;
  }
  const manifest = await readManifest(bundleManifest.manifestUrl);
  const nextGeneration = await installGeneration(manifest, {
    module: window.Module,
    databaseName: bundleDatabaseName,
  });
  const script = await readActiveText(nextGeneration, "script", window.Module, manifest);
  const nextConfig = JSON.parse(await readActiveText(nextGeneration, "project", window.Module, manifest));
  const nextAssets = nextConfig.asset_manifest
    ? JSON.parse(await readActiveText(nextGeneration, "asset-manifest", window.Module, manifest))
    : null;
  const input = bridgeBytes(script);
  if (window.Module._unone_web_reload_script(input.pointerAddress, input.length) !== 0) {
    throw bridgeError(readSnapshot(), "bundle script reload failed");
  }
  generationState = nextGeneration;
  bundleManifest = { manifest, manifestUrl: bundleManifest.manifestUrl };
  assetManifest = nextAssets;
  releaseAssetUrls();
  snapshot = readSnapshot();
  showState();
  status.textContent = `bundle generation ${generationState.generation} active; Luau hot reload accepted`;
}

function step() {
  const actions = { ...heldActions, ...pendingActions };
  pendingActions = {};
  window.Module._unone_web_set_pointer(pointer.position.x, pointer.position.y, pointer.down ? 1 : 0);
  if (window.Module._unone_web_set_screen_pointer(pointer.screen_position.x, pointer.screen_position.y) !== 0) {
    throw new Error("generic host screen pointer update failed");
  }
  for (const [action, isDown] of Object.entries(actions)) {
    if (isDown) queueAction(action);
  }
  const frameActions = { ...pendingActions };
  pendingActions = {};
  const inputPayload = JSON.stringify({ actions: frameActions, pointer });
  const input = bridgeBytes(inputPayload);
  if (window.Module._unone_web_set_input_frame(input.pointerAddress, input.length) !== 0) {
    throw new Error("generic host input frame update failed");
  }
  if (window.Module._unone_web_tick() !== 0) throw new Error("generic host tick failed");
  snapshot = readSnapshot();
  storeSave();
  renderer.draw(snapshot);
  showState();
  status.textContent = `running ${projectRoot.pathname} / frame ${frameOf(snapshot)}`;
  window.requestAnimationFrame(step);
}

function keyAction(event) {
  if (event.key === "ArrowLeft") return "Left";
  if (event.key === "ArrowRight") return "Right";
  if (event.key === "ArrowUp" || event.key.toLowerCase() === "a") return "Accelerate";
  if (event.key === " ") return "Shoot";
  if (event.key.toLowerCase() === "s") return "Save";
  if (event.key.toLowerCase() === "m") return "Move";
  if (event.key.toLowerCase() === "b") return "Build";
  if (event.key.toLowerCase() === "r") return "Roll";
  if (event.key.toLowerCase() === "t") return "Battle";
  return null;
}

async function start() {
  if (window.Module._unone_web_init() !== 0) throw new Error("generic host engine init failed");
  await loadProject();
  renderer = await createWebGpuRenderer(canvas);
  document.querySelector("#bundle-reload")?.addEventListener("click", () => reloadActiveBundle().catch((error) => {
    status.textContent = `bundle reload failed: ${error.message}`;
    output.textContent = JSON.stringify({
      error: error.message,
      diagnostic: error.diagnostic ?? null,
    }, null, 2);
  }));
  uiLayer.addEventListener("click", (event) => queueAction(event.target?.dataset?.action));
  window.addEventListener("keydown", (event) => {
    const action = keyAction(event);
    if (action) { event.preventDefault(); heldActions[action] = true; }
  });
  window.addEventListener("keyup", (event) => {
    const action = keyAction(event);
    if (action) { event.preventDefault(); delete heldActions[action]; }
  });
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointer = { position: worldFromPointer(canvas, event, snapshot), screen_position: screenFromPointer(canvas, event), down: true };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons & 1) pointer = { position: worldFromPointer(canvas, event, snapshot), screen_position: screenFromPointer(canvas, event), down: true };
  });
  canvas.addEventListener("pointerup", (event) => {
    pointer = { position: worldFromPointer(canvas, event, snapshot), screen_position: screenFromPointer(canvas, event), down: false };
  });
  showState();
  renderer.draw(snapshot);
  window.requestAnimationFrame(step);
}

window.addEventListener("unone-runtime-ready", () => start().catch(showFailure));
if (window.unoneRuntimeReady) start().catch(showFailure);

import { frameOf, semanticSummary, worldFromPointer } from "../shared/webgpu-snapshot.js?v=5";
import { createRenderer } from "../renderer/index.js?v=1";
import { activateGeneration, readActiveAsset, readActiveText, rollbackGeneration, stageGeneration } from "../live/bundle-store.js?v=5";
import { createAudioPlayback } from "../shared/audio-playback.js?v=2";
import { createFixedStepScheduler } from "../shared/fixed-step-scheduler.mjs?v=2";
import { createHostInput } from "../shared/host-input.js?v=2";
import { assertScriptOnlyUpdate } from "../shared/script-reload.js?v=2";
import { readSave, writeSave } from "./save-store.js?v=1";
import { createSpriteLayer } from "./sprite-layer.js?v=3";

const canvas = document.querySelector("#game");
const assetLayer = document.querySelector("#asset-layer");
const uiLayer = document.querySelector("#ui-layer");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
const query = new URLSearchParams(location.search);
const rendererKind = query.get("renderer") || "three";
const threeModuleUrl = query.get("three") ? new URL(query.get("three"), location.href).href : undefined;
const DEFAULT_ENTRY_SCRIPT = "scripts/main.luau";
const requestedProject = query.get("project") || "/Unone_Games/3d-racing/";
const projectRoot = new URL(requestedProject, location.origin);
if (!projectRoot.pathname.endsWith("/")) projectRoot.pathname += "/";
const seed = BigInt(query.get("seed") || "42");
const saveProjectKey = projectRoot.pathname;
const bundleDatabaseName = `unone-runner-bundles:${encodeURIComponent(projectRoot.pathname)}`;
let snapshot = null;
let renderer = null;
// Set when the host has no usable GPU. The semantic loop keeps running.
let rendererError = null;
let bundleManifest = null;
let generationState = null;
let activePackage = null;
let audioState = null;
let scheduler = null;
let schedulerResult = null;
const hostInput = createHostInput();
let renderedUi = null;
let loadedSave = false;
let lastStoredSaveText = null;
let pendingSaveText = null;
let saveWrite = Promise.resolve();
let assetManifest = null;
const assetUrls = new Map();
const assetUrlLoads = new Map();
let assetEpoch = 0;
let reportedAssetErrors = [];

export function semanticOutput(nextSnapshot, nextPointer = null) {
  const world = nextSnapshot?.world ?? nextSnapshot ?? {};
  return {
    ...semanticSummary(nextSnapshot, nextPointer),
    observations: world.observations ?? {},
  };
}

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
  const stagedGeneration = await stageGeneration(manifest, {
    module: window.Module,
    databaseName: bundleDatabaseName,
  });
  const config = JSON.parse(await readActiveText(stagedGeneration, "project", window.Module, manifest));
  const script = await readActiveText(stagedGeneration, "script", window.Module, manifest);
  const scene = config.main_scene
    ? JSON.parse(await readActiveText(stagedGeneration, "scene", window.Module, manifest))
    : null;
  const packagedAssets = config.asset_manifest
    ? JSON.parse(await readActiveText(stagedGeneration, "asset-manifest", window.Module, manifest))
    : null;
  return {
    config,
    script,
    scene,
    assetManifest: packagedAssets,
    generationState: stagedGeneration,
    manifest,
    manifestUrl,
  };
}

async function readPackagedGeneration(nextGeneration, manifest) {
  const config = JSON.parse(await readActiveText(nextGeneration, "project", window.Module, manifest));
  const script = await readActiveText(nextGeneration, "script", window.Module, manifest);
  const scene = config.main_scene
    ? JSON.parse(await readActiveText(nextGeneration, "scene", window.Module, manifest))
    : null;
  const packagedAssets = config.asset_manifest
    ? JSON.parse(await readActiveText(nextGeneration, "asset-manifest", window.Module, manifest))
    : null;
  return {
    config,
    script,
    scene,
    assetManifest: packagedAssets,
    generationState: nextGeneration,
    manifest,
  };
}

function assetMime(asset) {
  const source = asset.source.toLowerCase();
  if (source.endsWith(".svg")) return "image/svg+xml";
  if (source.endsWith(".webp")) return "image/webp";
  if (source.endsWith(".jpg") || source.endsWith(".jpeg")) return "image/jpeg";
  if (source.endsWith(".png")) return "image/png";
  return asset.kind === "texture2d" ? "image/*" : "application/octet-stream";
}

export function releaseAssetUrls() {
  assetEpoch += 1;
  for (const url of assetUrls.values()) URL.revokeObjectURL(url);
  assetUrls.clear();
  assetUrlLoads.clear();
  spriteLayer.clear();
  reportedAssetErrors = [];
}

export function loadAssetUrl(asset) {
  const assetId = String(asset.id);
  const requestEpoch = assetEpoch;
  const requestGeneration = generationState;
  const requestManifest = bundleManifest?.manifest;
  if (assetUrls.has(assetId)) return Promise.resolve(assetUrls.get(assetId));
  if (assetUrlLoads.has(assetId)) return assetUrlLoads.get(assetId);
  const load = (async () => {
    let bytes;
    if (requestGeneration) {
      bytes = await readActiveAsset(requestGeneration, asset, window.Module, requestManifest);
    } else {
      const response = await fetch(new URL(asset.source, projectRoot), { cache: "no-store" });
      if (!response.ok) throw new Error(`asset request failed: ${response.status} ${asset.source}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (requestEpoch !== assetEpoch) {
      const error = new Error(`asset load discarded after bundle generation changed: ${assetId}`);
      error.code = "ASSET_GENERATION_STALE";
      throw error;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: assetMime(asset) }));
    assetUrls.set(assetId, url);
    return url;
  })();
  assetUrlLoads.set(assetId, load);
  // Failed and completed requests are no longer in-flight. The identity
  // guard prevents an old promise from deleting a newer retry's entry.
  load.then(
    () => { if (assetUrlLoads.get(assetId) === load) assetUrlLoads.delete(assetId); },
    () => { if (assetUrlLoads.get(assetId) === load) assetUrlLoads.delete(assetId); },
  );
  return load;
}

const spriteLayer = createSpriteLayer({
  element: assetLayer,
  loadAssetUrl,
  onAssetErrors: (errors) => {
    reportedAssetErrors = errors;
    if (snapshot) writeOutput();
  },
});

async function retryFailedAssets() {
  await spriteLayer.retry();
  showState();
  return {
    asset_errors: reportedAssetErrors,
    resolved_assets: assetUrls.size,
  };
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

function writeOutput() {
  output.textContent = JSON.stringify({
    project_root: projectRoot.pathname,
    renderer: rendererError
      ? { available: false, requested: rendererKind, error: rendererError }
      : { available: true, requested: rendererKind, implementation: renderer?.implementation ?? null, backend: renderer?.backend ?? null },
    save_store: { backend: "indexeddb", loaded: loadedSave },
    bundle: generationState && {
      status: generationState.status,
      generation: generationState.generation,
      manifest_version: generationState.manifest_version,
      bundles: generationState.bundles,
    },
    scheduler: scheduler && {
      running: scheduler.running,
      visible: scheduler.visible,
      fixed_step_seconds: scheduler.fixedStepSeconds,
      max_catch_up_steps: scheduler.maxCatchUpSteps,
      last_steps: schedulerResult?.steps ?? 0,
      last_dropped_steps: schedulerResult?.droppedSteps ?? 0,
      total_dropped_steps: scheduler.totalDroppedSteps,
    },
    audio: audioState?.report?.() ?? null,
    assets: assetManifest && {
      manifest_version: assetManifest.version,
      count: assetManifest.assets?.length ?? 0,
      resolved: assetUrls.size,
    },
    asset_errors: reportedAssetErrors,
    ...semanticOutput(snapshot, hostInput.pointer),
    save_payload: snapshot?.save_payload ?? null,
  }, null, 2);
}

function showState() {
  renderUi(snapshot);
  spriteLayer.render(snapshot, assetManifest, canvas);
  audioState?.sync(snapshot?.world);
  writeOutput();
}

function queueAction(action) {
  hostInput.queueAction(action);
}

function queuePointerFrame(nextPointer, kind) {
  hostInput.updatePointer(nextPointer, kind);
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
  // The project's own declarations have to travel with it. Without them this
  // host runs a different game than the CLI does: systems the project turned
  // off stay on, and audio categories have no rules.
  const payload = bridgeBytes(
    JSON.stringify({
      project: config.name,
      script,
      scene,
      systems: config.systems ?? {},
      audio: config.audio ?? null,
    })
  );
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
  if (packaged) {
    generationState = await activateGeneration(packaged.generationState);
    bundleManifest = { manifest: packaged.manifest, manifestUrl: packaged.manifestUrl };
  }
  activePackage = {
    config,
    script,
    scene,
    assetManifest,
    manifest: packaged?.manifest ?? null,
    generationState,
  };
  const mode = packaged ? `bundle generation ${generationState.generation}` : "source files";
  status.textContent = `loaded ${config.name} from ${projectRoot.pathname} (${mode})`;
}

async function reloadActiveBundle() {
  if (!bundleManifest) {
    status.textContent = "bundle reload skipped: project has no configured bundle manifest";
    return;
  }
  const manifestUrl = bundleManifest.manifestUrl;
  const manifest = await readManifest(manifestUrl);
  const nextGeneration = await stageGeneration(manifest, {
    module: window.Module,
    databaseName: bundleDatabaseName,
  });
  const nextPackage = await readPackagedGeneration(nextGeneration, manifest);
  const inspection = assertScriptOnlyUpdate(activePackage, nextPackage);
  if (!inspection.scriptChanged) {
    status.textContent = `bundle generation ${generationState.generation} unchanged; no script reload needed`;
    return;
  }

  // A bundle generation is the durable source of truth. Commit it first with
  // CAS, then ask the Wasm runtime to adopt the script. The runtime reload is
  // transactional, so a rejected script leaves the old world and script live;
  // storage can then be restored without executing the old script a second
  // time (which could repeat onReload side effects).
  const previousGeneration = generationState;
  if (!previousGeneration || (nextGeneration.status === "already_active" && nextGeneration.generation !== previousGeneration.generation)) {
    const error = new Error("BUNDLE_ACTIVATION_STALE: the active bundle changed outside this session");
    error.diagnostic = {
      code: "BUNDLE_ACTIVATION_STALE",
      summary: "the active bundle changed outside this session",
      explanation: "Reload was cancelled because the page no longer owns the generation it started from; retry from a fresh page state.",
      facts: {
        expected_generation: previousGeneration?.generation ?? null,
        actual_generation: nextGeneration.generation,
      },
    };
    throw error;
  }

  const activated = await activateGeneration(nextGeneration);
  let reloadError = null;
  try {
    const input = bridgeBytes(nextPackage.script);
    if (window.Module._unone_web_reload_script(input.pointerAddress, input.length) !== 0) {
      reloadError = bridgeError(readSnapshot(), "bundle script reload failed");
    }
  } catch (error) {
    reloadError = error;
  }

  if (reloadError) {
    if (activated.status === "activated") {
      try {
        await rollbackGeneration(activated, previousGeneration);
      } catch (rollbackError) {
        reloadError.diagnostic = {
          ...(reloadError.diagnostic ?? {}),
          code: "BUNDLE_RELOAD_RECOVERY_REQUIRED",
          summary: "bundle reload failed and storage rollback was not committed",
          explanation: "The Wasm runtime kept the previous script, but another storage update won the rollback race. Reload the page before continuing.",
          facts: {
            ...(reloadError.diagnostic?.facts ?? {}),
            rollback_error: rollbackError.message,
            rollback_diagnostic: rollbackError.diagnostic ?? null,
          },
        };
      }
    }
    throw reloadError;
  }

  generationState = activated;
  bundleManifest = { manifest, manifestUrl };
  assetManifest = nextPackage.assetManifest;
  activePackage = { ...nextPackage, generationState: activated };
  releaseAssetUrls();
  renderer?.clearTextures?.();
  snapshot = readSnapshot();
  showState();
  status.textContent = `bundle generation ${generationState.generation} active; Luau hot reload accepted`;
}

// Report the canvas shape so anchored UI nodes resolve against the real screen.
let reportedAspect = 0;
function syncViewportAspect() {
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  if (!width || !height) return;
  const aspect = width / height;
  if (Math.abs(aspect - reportedAspect) < 0.001) return;
  if (window.Module._unone_web_set_viewport_aspect?.(aspect) === 0) reportedAspect = aspect;
}

function tickSimulation() {
  const frame = hostInput.consumeFrame();
  const framePointer = frame.pointer;
  window.Module._unone_web_set_pointer(framePointer.position.x, framePointer.position.y, framePointer.down ? 1 : 0);
  if (window.Module._unone_web_set_screen_pointer(framePointer.screen_position.x, framePointer.screen_position.y) !== 0) {
    throw new Error("generic host screen pointer update failed");
  }
  const inputPayload = JSON.stringify(frame);
  const input = bridgeBytes(inputPayload);
  if (window.Module._unone_web_set_input_frame(input.pointerAddress, input.length) !== 0) {
    throw new Error("generic host input frame update failed");
  }
  syncViewportAspect();
  if (window.Module._unone_web_tick() !== 0) {
    throw bridgeError(readSnapshot(), "generic host tick failed");
  }
  snapshot = readSnapshot();
  storeSave();
}

function renderFrame(result = {}) {
  schedulerResult = result;
  renderer?.draw(snapshot);
  showState();
  status.textContent = rendererError
    ? `running ${projectRoot.pathname} / frame ${frameOf(snapshot)} — no renderer: ${rendererError}`
    : `running ${projectRoot.pathname} / frame ${frameOf(snapshot)}${result.droppedSteps ? ` — dropped ${result.droppedSteps} late steps` : ""}`;
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
  // A missing GPU must not cost the semantic gate. Everything this host is
  // asked to prove — snapshot, UI tree, save store, bundle generation — is
  // already computed before anything is drawn, so a renderer failure degrades
  // to "no picture" instead of stopping the loop.
  try {
    renderer = await createRenderer(canvas, {
      kind: rendererKind,
      threeModuleUrl,
      suppress2dSprites: true,
      loadAssetUrl,
      getAssetManifest: () => assetManifest,
    });
    // A successful WebGPU renderer owns sprite compositing. Keep the DOM layer
    // available as the fallback only when WebGPU is unavailable.
    assetLayer.hidden = Boolean(renderer.usesGpuSprites);
  } catch (error) {
    renderer = null;
    rendererError = error.message ?? String(error);
    assetLayer.hidden = false;
    canvas.replaceChildren();
  }
  audioState = await createAudioPlayback({
    assetManifest,
    config: activePackage?.config,
    projectRoot,
    loadAssetBytes: (asset) => {
      if (generationState && bundleManifest) {
        return readActiveAsset(generationState, asset, window.Module, bundleManifest.manifest);
      }
      return fetch(new URL(asset.source, projectRoot), { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(`audio asset request failed: ${response.status} ${asset.source}`);
        return new Uint8Array(await response.arrayBuffer());
      });
    },
  });
  if (audioState) {
    document.addEventListener("pointerdown", () => audioState.unlock());
    document.addEventListener("keydown", () => audioState.unlock());
  }
  document.querySelector("#bundle-reload")?.addEventListener("click", () => reloadActiveBundle().catch((error) => {
    status.textContent = `bundle reload failed: ${error.message}`;
    output.textContent = JSON.stringify({
      error: error.message,
      diagnostic: error.diagnostic ?? null,
    }, null, 2);
  }));
  window.unoneHost = {
    retryFailedAssets,
    reloadActiveBundle,
  };
  document.querySelector("#asset-retry")?.addEventListener("click", () => retryFailedAssets().catch(showFailure));
  uiLayer.addEventListener("click", (event) => queueAction(event.target?.dataset?.action));
  window.addEventListener("keydown", (event) => {
    const action = keyAction(event);
    if (action) {
      event.preventDefault();
      hostInput.setHeld(action, true);
      // A key press is also an edge. This preserves a quick press that lands
      // entirely between two display callbacks while held input still drives
      // continuous movement on later fixed ticks.
      hostInput.queueAction(action);
    }
  });
  window.addEventListener("keyup", (event) => {
    const action = keyAction(event);
    if (action) { event.preventDefault(); hostInput.setHeld(action, false); }
  });
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    const nextPointer = { position: worldFromPointer(canvas, event, snapshot), screen_position: screenFromPointer(canvas, event), down: true };
    queuePointerFrame(nextPointer, "edge");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons & 1) {
      const nextPointer = { position: worldFromPointer(canvas, event, snapshot), screen_position: screenFromPointer(canvas, event), down: true };
      queuePointerFrame(nextPointer, "move");
    }
  });
  const releasePointer = (event) => {
    const nextPointer = { position: worldFromPointer(canvas, event, snapshot), screen_position: screenFromPointer(canvas, event), down: false };
    queuePointerFrame(nextPointer, "edge");
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  showState();
  renderer?.draw(snapshot);
  scheduler = createFixedStepScheduler({
    tick: () => tickSimulation(),
    render: renderFrame,
    onError: showFailure,
    onVisibilityChange: ({ visible, reason }) => {
      schedulerResult = null;
      if (!visible) {
        hostInput.releaseAll();
        audioState?.setVisibility(false);
        status.textContent = `paused ${projectRoot.pathname} while hidden`;
      } else if (reason !== "start") {
        audioState?.setVisibility(true);
        status.textContent = `resuming ${projectRoot.pathname}`;
      }
      writeOutput();
    },
    visibilityTarget: document,
  });
  scheduler.start();
}

window.addEventListener("unone-runtime-ready", () => start().catch(showFailure));
if (window.unoneRuntimeReady) start().catch(showFailure);

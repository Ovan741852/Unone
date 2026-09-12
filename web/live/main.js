import {loadProject as loadHostProject} from '../shared/load-project.js';
import { frameOf, semanticSummary, worldFromPointer } from "../shared/webgpu-snapshot.js?v=2";
import { createRenderer } from "../renderer/index.js?v=1";
import { createUiTree } from "../shared/ui-tree.js";
import { installGeneration, readActiveAsset, readActiveText } from "./bundle-store.js?v=1";

const canvas = document.querySelector("#game");
const uiLayer = document.querySelector("#ui-layer");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
const reloadButton = document.querySelector("#reload-script");
const bundleUpdateButton = document.querySelector("#bundle-update");
let snapshot = null;
let renderer = null;
let pointer = { position: { x: 0, y: 0 }, screen_position: { x: 0, y: 0 }, down: false };
let pendingPointerFrames = [];
let started = false;
let reloadNotice = null;
let manifest = null;
let generationState = null;
let assetManifest = null;
const uiAssetUrls = new Map();
const renderUi = createUiTree(uiLayer, {
  resolveAsset: (assetId) => {
    const asset = assetManifest?.assets?.find((candidate) => candidate.id === assetId);
    if (!asset) throw new Error(`UI asset ${assetId} is not declared in the active asset manifest`);
    if (!uiAssetUrls.has(assetId)) {
      uiAssetUrls.set(assetId, readActiveAsset(generationState, asset, window.Module, manifest).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: asset.source.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/*" }))));
    }
    return uiAssetUrls.get(assetId);
  },
});

function showState() {
  const state = semanticSummary(snapshot, pointer);
  state.bundle = generationState
    ? {
        generation: generationState.generation,
        manifest_version: generationState.manifest_version,
        status: generationState.status,
      }
    : null;
  output.textContent = JSON.stringify(state, null, 2);
  renderUi(snapshot);
}

function readSnapshot() {
  const module = window.Module;
  const pointerAddress = module._unone_web_observation_ptr();
  const length = module._unone_web_observation_len();
  const bytes = module.HEAPU8.slice(pointerAddress, pointerAddress + length);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function screenFromPointer(canvasElement, event) {
  const rect = canvasElement.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  return { x: x * 100, y: (1 - y) * 100 };
}

async function writeBridgePayload(text) {
  const bytes = new TextEncoder().encode(text);
  const pointerAddress = window.Module._unone_web_alloc(bytes.length);
  window.Module.HEAPU8.set(bytes, pointerAddress);
  return { pointerAddress, length: bytes.length };
}

async function readManifest(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`manifest request failed: ${response.status}`);
  return response.json();
}

async function loadProject() {
  manifest = await readManifest("./bundle-manifest-v1.json");
  generationState = await installGeneration(manifest, { module: window.Module });
  const project = JSON.parse(await readActiveText(generationState, "project", window.Module, manifest));
  assetManifest = project.asset_manifest
    ? JSON.parse(await readActiveText(generationState, "asset-manifest", window.Module, manifest))
    : null;
  snapshot=loadHostProject(window.Module,project,42n);
}

async function reloadScriptFromActiveBundle() {
  const source = await readActiveText(generationState, "script", window.Module, manifest);
  const input = await writeBridgePayload(source);
  if (window.Module._unone_web_reload_script(input.pointerAddress, input.length) !== 0) {
    throw new Error("Luau hot reload was rejected");
  }
  snapshot = readSnapshot();
  reloadNotice = `script hot reload accepted at frame ${frameOf(snapshot)}`;
  renderer.draw(snapshot);
  showState();
}

async function reloadScript() {
  await reloadScriptFromActiveBundle();
}

async function updateBundle() {
  const nextManifest = await readManifest("./bundle-manifest-v2.json");
  const cacheOnly = generationState?.manifest_version === nextManifest.version;
  const nextGeneration = await installGeneration(nextManifest, {
    module: window.Module,
    fetchImpl: cacheOnly
      ? async () => { throw new Error("offline smoke fetch must not be called for an active generation"); }
      : fetch,
  });
  manifest = nextManifest;
  generationState = nextGeneration;
  const nextProject = JSON.parse(await readActiveText(nextGeneration, "project", window.Module, manifest));
  assetManifest = nextProject.asset_manifest
    ? JSON.parse(await readActiveText(nextGeneration, "asset-manifest", window.Module, manifest))
    : null;
  for (const url of uiAssetUrls.values()) Promise.resolve(url).then((value) => { if (typeof value === "string") URL.revokeObjectURL(value); });
  uiAssetUrls.clear();
  await reloadScriptFromActiveBundle();
  const mode = cacheOnly ? "cache-only reopen" : "bundle update";
  reloadNotice = `${mode}: generation ${generationState.generation} ${generationState.status}; ${reloadNotice}`;
  showState();
}

function queuePointerFrame(nextPointer, kind) {
  const last = pendingPointerFrames[pendingPointerFrames.length - 1];
  if (kind === "move" && last?.kind === "move") {
    last.pointer = nextPointer;
    return;
  }
  pendingPointerFrames.push({ kind, pointer: nextPointer });
}

function step() {
  const framePointer = pendingPointerFrames.shift()?.pointer ?? pointer;
  window.Module._unone_web_set_pointer(framePointer.position.x, framePointer.position.y, framePointer.down ? 1 : 0);
  if (window.Module._unone_web_set_screen_pointer(framePointer.screen_position.x, framePointer.screen_position.y) !== 0) {
    throw new Error("live engine screen pointer update failed");
  }
  if (window.Module._unone_web_tick() !== 0) throw new Error("live engine tick failed");
  snapshot = readSnapshot();
  renderer.draw(snapshot);
  showState();
  status.textContent = reloadNotice ?? `passed: live WASM frame ${frameOf(snapshot)}`;
  window.requestAnimationFrame(step);
}

async function start() {
  if (started) return;
  started = true;
  if (window.Module._unone_web_init() !== 0) throw new Error("live engine init failed");
  await loadProject();
  renderer = await createRenderer(canvas, { kind: "webgpu-raw" });
  reloadButton.disabled = false;
  bundleUpdateButton.disabled = false;
  reloadButton.addEventListener("click", () => reloadScript().catch((error) => {
    status.textContent = `failed: ${error.message}`;
  }));
  bundleUpdateButton.addEventListener("click", () => updateBundle().catch((error) => {
    status.textContent = `failed: ${error.message}`;
  }));
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointer = { position: worldFromPointer(canvas, event, snapshot), screen_position: screenFromPointer(canvas, event), down: true };
    queuePointerFrame(pointer, "edge");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons & 1) {
      pointer = { position: worldFromPointer(canvas, event, snapshot), screen_position: screenFromPointer(canvas, event), down: true };
      queuePointerFrame(pointer, "move");
    }
  });
  const releasePointer = (event) => {
    pointer = { position: worldFromPointer(canvas, event, snapshot), screen_position: screenFromPointer(canvas, event), down: false };
    queuePointerFrame(pointer, "edge");
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  showState();
  await reloadScriptFromActiveBundle();
  window.requestAnimationFrame(step);
}

window.addEventListener("unone-runtime-ready", () => start().catch((error) => {
  status.textContent = `failed: ${error.message}`;
  output.textContent = JSON.stringify({ error: error.message }, null, 2);
}));
if (window.unoneRuntimeReady) start().catch((error) => {
  status.textContent = `failed: ${error.message}`;
  output.textContent = JSON.stringify({ error: error.message }, null, 2);
});

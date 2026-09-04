import { createWebGpuRenderer, frameOf, semanticSummary, worldFromPointer } from "../shared/webgpu-snapshot.js?v=2";
import { installGeneration, readActiveText } from "./bundle-store.js?v=1";

const canvas = document.querySelector("#game");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
const reloadButton = document.querySelector("#reload-script");
const bundleUpdateButton = document.querySelector("#bundle-update");
let snapshot = null;
let renderer = null;
let pointer = { position: { x: 0, y: 0 }, down: false };
let started = false;
let reloadNotice = null;
let manifest = null;
let generationState = null;

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
}

function readSnapshot() {
  const module = window.Module;
  const pointerAddress = module._unone_web_observation_ptr();
  const length = module._unone_web_observation_len();
  const bytes = module.HEAPU8.slice(pointerAddress, pointerAddress + length);
  return JSON.parse(new TextDecoder().decode(bytes));
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
  const payload = await readActiveText(generationState, "project", window.Module, manifest);
  const input = await writeBridgePayload(payload);
  if (window.Module._unone_web_load_project(input.pointerAddress, input.length, 42n) !== 0) {
    throw new Error("host-provided project load failed");
  }
  snapshot = readSnapshot();
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
  await reloadScriptFromActiveBundle();
  const mode = cacheOnly ? "cache-only reopen" : "bundle update";
  reloadNotice = `${mode}: generation ${generationState.generation} ${generationState.status}; ${reloadNotice}`;
  showState();
}

function step() {
  window.Module._unone_web_set_pointer(pointer.position.x, pointer.position.y, pointer.down ? 1 : 0);
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
  renderer = await createWebGpuRenderer(canvas);
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
    pointer = { position: worldFromPointer(canvas, event, snapshot), down: true };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons & 1) pointer = { position: worldFromPointer(canvas, event, snapshot), down: true };
  });
  canvas.addEventListener("pointerup", (event) => {
    pointer = { position: worldFromPointer(canvas, event, snapshot), down: false };
  });
  showState();
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

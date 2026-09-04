import { createWebGpuRenderer, frameOf, semanticSummary, worldFromPointer } from "../shared/webgpu-snapshot.js?v=2";

const canvas = document.querySelector("#game");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
const reloadButton = document.querySelector("#reload-script");
let snapshot = null;
let renderer = null;
let pointer = { position: { x: 0, y: 0 }, down: false };
let started = false;
let reloadNotice = null;

function showState() {
  output.textContent = JSON.stringify(semanticSummary(snapshot, pointer), null, 2);
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

async function loadProject() {
  const response = await fetch("./project.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`project request failed: ${response.status}`);
  const payload = await response.text();
  const input = await writeBridgePayload(payload);
  if (window.Module._unone_web_load_project(input.pointerAddress, input.length, 42n) !== 0) {
    throw new Error("host-provided project load failed");
  }
  snapshot = readSnapshot();
}

async function reloadScript() {
  const response = await fetch("./reload.luau", { cache: "no-store" });
  if (!response.ok) throw new Error(`reload script request failed: ${response.status}`);
  const input = await writeBridgePayload(await response.text());
  if (window.Module._unone_web_reload_script(input.pointerAddress, input.length) !== 0) {
    throw new Error("Luau hot reload was rejected");
  }
  snapshot = readSnapshot();
  reloadNotice = `script hot reload accepted at frame ${frameOf(snapshot)}`;
  renderer.draw(snapshot);
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
  reloadButton.addEventListener("click", () => reloadScript().catch((error) => {
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

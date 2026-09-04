import { createWebGpuRenderer, semanticSummary, worldFromPointer } from "../shared/webgpu-snapshot.js";

const canvas = document.querySelector("#game");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
let snapshot = null;
let renderer = null;
let pointer = { position: { x: 0, y: 0 }, down: false };
let started = false;

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

function step() {
  window.Module._unone_web_set_pointer(pointer.position.x, pointer.position.y, pointer.down ? 1 : 0);
  if (window.Module._unone_web_tick() !== 0) throw new Error("live engine tick failed");
  snapshot = readSnapshot();
  renderer.draw(snapshot);
  showState();
  status.textContent = `passed: live WASM frame ${snapshot.frame}`;
  window.requestAnimationFrame(step);
}

async function start() {
  if (started) return;
  started = true;
  if (window.Module._unone_web_init() !== 0) throw new Error("live engine init failed");
  snapshot = readSnapshot();
  renderer = await createWebGpuRenderer(canvas);
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

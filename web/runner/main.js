import { createWebGpuRenderer, frameOf, semanticSummary, worldFromPointer } from "../shared/webgpu-snapshot.js?v=3";

const canvas = document.querySelector("#game");
const uiLayer = document.querySelector("#ui-layer");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
const query = new URLSearchParams(location.search);
const requestedProject = query.get("project") || "/Unone_Games/3d-racing/";
const projectRoot = new URL(requestedProject, location.origin);
if (!projectRoot.pathname.endsWith("/")) projectRoot.pathname += "/";
const seed = BigInt(query.get("seed") || "42");
const saveKey = `unone-runner-save:${projectRoot.pathname}`;
let snapshot = null;
let renderer = null;
let pointer = { position: { x: 0, y: 0 }, screen_position: { x: 0, y: 0 }, down: false };
let heldActions = {};
let pendingActions = {};
let renderedUi = null;

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
    ...semanticSummary(snapshot, pointer),
    save_payload: snapshot?.save_payload ?? null,
  }, null, 2);
  renderUi(snapshot);
}

function queueAction(action) {
  if (typeof action === "string" && action.length > 0) pendingActions[action] = true;
}

function storeSave() {
  const payload = snapshot?.save_payload;
  if (payload != null) localStorage.setItem(saveKey, JSON.stringify(payload));
}

async function loadProject() {
  const config = await readJson("project.unone.json");
  const script = await readText(config.entry_script);
  const scene = config.main_scene ? await readJson(config.main_scene) : null;
  const payload = bridgeBytes(JSON.stringify({ project: config.name, script, scene }));
  if (window.Module._unone_web_load_project(payload.pointerAddress, payload.length, seed) !== 0) {
    const result = readSnapshot();
    throw new Error(result.error ?? "generic project load failed");
  }
  snapshot = readSnapshot();
  const stored = localStorage.getItem(saveKey);
  if (stored != null) {
    const savePayload = bridgeBytes(stored);
    if (window.Module._unone_web_set_save_payload(savePayload.pointerAddress, savePayload.length) !== 0) {
      throw new Error("stored save payload was rejected by the engine");
    }
    snapshot = readSnapshot();
  }
  status.textContent = `loaded ${config.name} from ${projectRoot.pathname}`;
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

window.addEventListener("unone-runtime-ready", () => start().catch((error) => {
  status.textContent = `failed: ${error.message}`;
  output.textContent = JSON.stringify({ error: error.message }, null, 2);
}));
if (window.unoneRuntimeReady) start().catch((error) => {
  status.textContent = `failed: ${error.message}`;
  output.textContent = JSON.stringify({ error: error.message }, null, 2);
});

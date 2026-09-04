import { createWebGpuRenderer, semanticSummary, worldFromPointer } from "../shared/webgpu-snapshot.js";

const canvas = document.querySelector("#game");
const status = document.querySelector("#status");
const output = document.querySelector("#output");

function showState(snapshot, pointer = null) {

  output.textContent = JSON.stringify(semanticSummary(snapshot, pointer), null, 2);
}

async function main() {
  const response = await fetch("./snapshot.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`snapshot request failed: ${response.status}`);
  const snapshot = await response.json();
  showState(snapshot);
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    showState(snapshot, { position: worldFromPointer(canvas, event, snapshot), down: true });
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons & 1) showState(snapshot, { position: worldFromPointer(canvas, event, snapshot), down: true });
  });
  canvas.addEventListener("pointerup", (event) => {
    showState(snapshot, { position: worldFromPointer(canvas, event, snapshot), down: false });
  });
  const renderer = await createWebGpuRenderer(canvas);
  renderer.draw(snapshot);
  status.textContent = `passed: WebGPU rendered ${Object.keys(snapshot.world.entities).length} engine entities`;
}

main().catch((error) => {
  status.textContent = `failed: ${error.message}`;
  output.textContent = JSON.stringify({ error: error.message }, null, 2);
});

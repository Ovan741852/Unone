const canvas = document.querySelector("#game");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
const pointerFrames = [];

function showState(snapshot, pointer = null) {
  output.textContent = JSON.stringify({
    project: snapshot.project,
    observation_digest: snapshot.observation_digest,
    entities: Object.values(snapshot.world.entities).map((entity) => ({
      id: entity.id,
      asset: entity.sprite?.asset ?? null,
      size: entity.sprite?.size ?? null,
      position: entity.transform,
    })),
    pointer,
  }, null, 2);
}

function worldFromPointer(event, snapshot) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  const clipX = x * 2 - 1;
  const clipY = 1 - y * 2;
  const zoom = snapshot.world.camera.zoom;
  return {
    x: snapshot.world.camera.position.x + (clipX + 0.8) / (0.2 * zoom),
    y: snapshot.world.camera.position.y + (clipY + 0.1) / (0.2 * zoom),
  };
}

function recordPointer(event, snapshot, down) {
  const pointer = { position: worldFromPointer(event, snapshot), down };
  pointerFrames.push(pointer);
  while (pointerFrames.length > 12) pointerFrames.shift();
  showState(snapshot, pointer);
}

function colorFor(entity) {
  if (entity.rigidbody?.body_type === "dynamic") return [0.9, 0.2, 0.15, 1];
  if (entity.rigidbody?.body_type === "static") return [0.3, 0.65, 0.9, 1];
  return [0.9, 0.75, 0.2, 1];
}

function verticesFor(snapshot) {
  const zoom = snapshot.world.camera.zoom;
  const camera = snapshot.world.camera.position;
  const vertices = [];
  for (const entity of Object.values(snapshot.world.entities)) {
    if (entity.sprite && !entity.sprite.visible) continue;
    const x = Math.max(-0.95, Math.min(0.75, -0.8 + (entity.transform.x - camera.x) * 0.2 * zoom));
    const y = Math.max(-0.9, Math.min(0.7, -0.1 + (entity.transform.y - camera.y) * 0.2 * zoom));
    const width = Math.max(0.01, (entity.sprite?.size.x ?? 1) * 0.2 * zoom);
    const height = Math.max(0.01, (entity.sprite?.size.y ?? 1) * 0.2 * zoom);
    const color = colorFor(entity);
    vertices.push(
      x, y, ...color, x + width, y, ...color, x + width, y + height, ...color,
      x, y, ...color, x + width, y + height, ...color, x, y + height, ...color,
    );
  }
  return new Float32Array(vertices);
}

async function renderWebGpu(snapshot) {
  if (!navigator.gpu) throw new Error("WebGPU is not available in this browser");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU adapter is not available");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("WebGPU canvas context is not available");

  const format = navigator.gpu.getPreferredCanvasFormat();
  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) canvas.width = width, canvas.height = height;
    context.configure({ device, format, alphaMode: "opaque" });
  };
  resize();
  window.addEventListener("resize", resize);

  const shader = device.createShaderModule({ code: `
    struct VertexOut { @builtin(position) position: vec4f, @location(0) color: vec4f }
    @vertex fn vs(@location(0) position: vec2f, @location(1) color: vec4f) -> VertexOut {
      var out: VertexOut; out.position = vec4f(position, 0.0, 1.0); out.color = color; return out;
    }
    @fragment fn fs(@location(0) color: vec4f) -> @location(0) vec4f { return color; }
  ` });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "vs",
      buffers: [{ arrayStride: 24, attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x4" },
      ] }],
    },
    fragment: { module: shader, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const data = verticesFor(snapshot);
  const buffer = device.createBuffer({ size: Math.max(4, data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data);

  const frame = () => {
    resize();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.067, g: 0.094, b: 0.153, a: 1 },
        loadOp: "clear", storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, buffer);
    pass.draw(data.length / 6);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };
  frame();
  return frame;
}

async function main() {
  const response = await fetch("./snapshot.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`snapshot request failed: ${response.status}`);
  const snapshot = await response.json();
  showState(snapshot);
  canvas.addEventListener("pointerdown", (event) => recordPointer(event, snapshot, true));
  canvas.addEventListener("pointermove", (event) => { if (event.buttons & 1) recordPointer(event, snapshot, true); });
  canvas.addEventListener("pointerup", (event) => recordPointer(event, snapshot, false));
  await renderWebGpu(snapshot);
  status.textContent = `passed: WebGPU rendered ${Object.keys(snapshot.world.entities).length} engine entities`;
}

main().catch((error) => {
  status.textContent = `failed: ${error.message}`;
  output.textContent = JSON.stringify({ error: error.message, pointer_frames: pointerFrames }, null, 2);
});

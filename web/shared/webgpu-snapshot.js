export function worldOf(snapshot) {
  return snapshot.world ?? snapshot;
}

export function frameOf(snapshot) {
  return worldOf(snapshot).frame;
}

const utf8Encoder = new TextEncoder();

function entityId(entity) {
  return String(entity?.id ?? "");
}

function spriteLayer(entity) {
  return entity?.sprite?.layer ?? 0;
}

/** Compare identifiers by their UTF-8 bytes, never by locale or JS key order. */
export function compareUtf8Ids(left, right) {
  const leftBytes = utf8Encoder.encode(String(left ?? ""));
  const rightBytes = utf8Encoder.encode(String(right ?? ""));
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

/** Sort ordinary sprites by the shared signed layer and UTF-8 id contract. */
export function compareSpriteEntities(left, right) {
  const layerDifference = spriteLayer(left) - spriteLayer(right);
  return layerDifference || compareUtf8Ids(entityId(left), entityId(right));
}

export function semanticSummary(snapshot, pointer = null) {
  const world = worldOf(snapshot);
  return {
    project: snapshot.project ?? "engine-snapshot",
    observation_digest: snapshot.observation_digest ?? null,
    frame: world.frame,
    entities: Object.values(world.entities ?? {})
      .sort(compareSpriteEntities)
      .map((entity) => ({
        id: entity.id,
        asset: entity.sprite?.asset ?? null,
        size: entity.sprite?.size ?? null,
        rotation: entity.rotation ?? 0,
        scale: entity.scale ?? { x: 1, y: 1 },
        layer: entity.sprite ? (entity.sprite.layer ?? 0) : null,
        position: entity.transform,
        transform3d: entity.transform3d ?? null,
        mesh3d: entity.mesh3d ?? null,
      })),
    camera3d: world.camera3d ?? null,
    ui: world.ui ?? null,
    pointer,
  };
}


/**
 * Map a world point into the same normalized 0..100 view space the UI uses.
 *
 * The camera declares how much world a frame shows, so every host frames a
 * scene identically instead of inventing its own constants. y points up.
 */
export function worldToView(point, camera, aspect) {
  const visibleHeight = (camera.view_height ?? 10) / (camera.zoom || 1);
  const visibleWidth = visibleHeight * aspect;
  return {
    x: 50 + ((point.x - camera.position.x) / visibleWidth) * 100,
    y: 50 + ((point.y - camera.position.y) / visibleHeight) * 100,
  };
}

/** Inverse of worldToView, for turning a pointer back into world space. */
export function viewToWorld(view, camera, aspect) {
  const visibleHeight = (camera.view_height ?? 10) / (camera.zoom || 1);
  const visibleWidth = visibleHeight * aspect;
  return {
    x: camera.position.x + ((view.x - 50) / 100) * visibleWidth,
    y: camera.position.y + ((view.y - 50) / 100) * visibleHeight,
  };
}

/** Size of one world-space extent in view units. */
export function worldSizeToView(size, camera, aspect, scale = { x: 1, y: 1 }) {
  const visibleHeight = (camera.view_height ?? 10) / (camera.zoom || 1);
  return {
    x: ((size.x * (scale?.x ?? 1)) / (visibleHeight * aspect)) * 100,
    y: ((size.y * (scale?.y ?? 1)) / visibleHeight) * 100,
  };
}

function aspectOf(canvas) {
  const width = canvas.clientWidth || canvas.width || 16;
  const height = canvas.clientHeight || canvas.height || 9;
  return width / height;
}

export function worldFromPointer(canvas, event, snapshot) {
  const world = worldOf(snapshot);
  const rect = canvas.getBoundingClientRect();
  const view = {
    x: ((event.clientX - rect.left) / rect.width) * 100,
    y: (1 - (event.clientY - rect.top) / rect.height) * 100,
  };
  return viewToWorld(view, world.camera, aspectOf(canvas));
}

function colorFor(entity) {
  if (entity.rigidbody?.body_type === "dynamic") return [0.9, 0.2, 0.15, 1];
  if (entity.rigidbody?.body_type === "static") return [0.3, 0.65, 0.9, 1];
  return [0.9, 0.75, 0.2, 1];
}

function rotate2d(point, rotation) {
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function worldSpriteCorners(entity) {
  const size = entity.sprite?.size ?? { x: 1, y: 1 };
  const scale = entity.scale ?? { x: 1, y: 1 };
  const half = {
    x: size.x * (scale.x ?? 1) * 0.5,
    y: size.y * (scale.y ?? 1) * 0.5,
  };
  const rotation = entity.rotation ?? 0;
  const local = [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
  ];
  return local.map((point) => {
    const rotated = rotate2d(point, rotation);
    return {
      x: entity.transform.x + rotated.x,
      y: entity.transform.y + rotated.y,
    };
  });
}

export function verticesFor(snapshot, aspect, options = {}) {
  const world = worldOf(snapshot);
  if (world.camera3d) return verticesFor3d(world);
  const vertices = [];
  const entities = Object.values(world.entities ?? {})
    .filter((entity) => !(entity.sprite && !entity.sprite.visible))
    .sort(compareSpriteEntities);
  for (const entity of entities) {
    if (options?.suppress2dSprites && entity.sprite) continue;
    // Transform the visual rectangle in world space before projecting it. An
    // entity outside the view stays outside the view, making bad framing visible.
    const corners = worldSpriteCorners(entity).map((point) => worldToView(point, world.camera, aspect));
    const clipCorners = corners.map((point) => ({ x: point.x / 50 - 1, y: point.y / 50 - 1 }));
    const color = colorFor(entity);
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const point = clipCorners[index];
      vertices.push(point.x, point.y, ...color);
    }
  }
  return new Float32Array(vertices);
}

function add3(left, right) {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function sub3(left, right) {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function dot3(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross3(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalize3(value) {
  const length = Math.sqrt(dot3(value, value));
  if (length <= Number.EPSILON) return null;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function rotateEuler3(point, rotation) {
  const [sinX, cosX] = [Math.sin(rotation.x), Math.cos(rotation.x)];
  const [sinY, cosY] = [Math.sin(rotation.y), Math.cos(rotation.y)];
  const [sinZ, cosZ] = [Math.sin(rotation.z), Math.cos(rotation.z)];
  const aroundX = {
    x: point.x,
    y: point.y * cosX - point.z * sinX,
    z: point.y * sinX + point.z * cosX,
  };
  const aroundY = {
    x: aroundX.x * cosY + aroundX.z * sinY,
    y: aroundX.y,
    z: -aroundX.x * sinY + aroundX.z * cosY,
  };
  return {
    x: aroundY.x * cosZ - aroundY.y * sinZ,
    y: aroundY.x * sinZ + aroundY.y * cosZ,
    z: aroundY.z,
  };
}

function colorFor3d(entity) {
  if (entity.id.includes("track")) return [0.18, 0.2, 0.24, 1];
  if (entity.id.includes("rival")) return [0.18, 0.45, 0.9, 1];
  return [0.9, 0.18, 0.12, 1];
}

function project3d(camera, point, aspect) {
  const forward = normalize3(sub3(camera.target, camera.position));
  const right = forward && normalize3(cross3(forward, { x: 0, y: 1, z: 0 }));
  if (!forward || !right) return null;
  const up = cross3(right, forward);
  const relative = sub3(point, camera.position);
  const depth = dot3(relative, forward);
  if (depth <= 0.05) return null;
  const f = 1 / Math.tan((camera.fov_degrees * Math.PI / 180) * 0.5);
  return [dot3(relative, right) * f / aspect / depth, dot3(relative, up) * f / depth];
}

function verticesFor3d(world) {
  const camera = world.camera3d;
  const forward = normalize3(sub3(camera.target, camera.position));
  if (!forward) return new Float32Array();
  const aspect = 16 / 9;
  const faces = [];
  for (const entity of Object.values(world.entities)) {
    const transform = entity.transform3d;
    if (!transform || entity.mesh3d?.visible === false) continue;
    const half = {
      x: transform.scale.x * 0.5,
      y: transform.scale.y * 0.5,
      z: transform.scale.z * 0.5,
    };
    const local = [
      { x: -half.x, y: -half.y, z: -half.z }, { x: half.x, y: -half.y, z: -half.z },
      { x: half.x, y: half.y, z: -half.z }, { x: -half.x, y: half.y, z: -half.z },
      { x: -half.x, y: -half.y, z: half.z }, { x: half.x, y: -half.y, z: half.z },
      { x: half.x, y: half.y, z: half.z }, { x: -half.x, y: half.y, z: half.z },
    ];
    const corners = local.map((point) => add3(transform.position, rotateEuler3(point, transform.rotation)));
    const indices = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [1, 5, 6, 2], [0, 3, 7, 4]];
    const color = colorFor3d(entity);
    for (const [a, b, c, d] of indices) {
      const depth = (dot3(sub3(corners[a], camera.position), forward)
        + dot3(sub3(corners[b], camera.position), forward)
        + dot3(sub3(corners[c], camera.position), forward)
        + dot3(sub3(corners[d], camera.position), forward)) / 4;
      faces.push({ depth, triangle: [corners[a], corners[b], corners[c]], color });
      faces.push({ depth, triangle: [corners[a], corners[c], corners[d]], color });
    }
  }
  faces.sort((left, right) => right.depth - left.depth);
  const vertices = [];
  for (const face of faces) {
    const projected = face.triangle.map((point) => project3d(camera, point, aspect));
    if (projected.some((point) => point === null)) continue;
    for (const point of projected) vertices.push(point[0], point[1], ...face.color);
  }
  return new Float32Array(vertices);
}

export async function createWebGpuRenderer(canvas, options = {}) {
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
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
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

  let vertexBuffer = null;
  let vertexCapacity = 0;
  const draw = (snapshot) => {
    resize();
    const data = verticesFor(snapshot, aspectOf(canvas), options);
    if (!vertexBuffer || data.byteLength > vertexCapacity) {
      vertexBuffer?.destroy();
      vertexCapacity = Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(4, data.byteLength))));
      vertexBuffer = device.createBuffer({
        size: vertexCapacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    device.queue.writeBuffer(vertexBuffer, 0, data);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.067, g: 0.094, b: 0.153, a: 1 },
        loadOp: "clear", storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(data.length / 6);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };
  return { draw };
}

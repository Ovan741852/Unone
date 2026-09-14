// Unone Lottie v1: a deliberately small, renderer-hosted Canvas2D player.
// It owns playback/lifecycle and shape evaluation only. It does not decide
// rewards, wallet state, input settlement or game pause policy.

export const LOTTIE_CONTRACT = {
  protocol: "unone.plugin.v1",
  runtime: "org.unone.lottie/runtime/lottie.mjs",
  version: "unone.lottie.v1",
  subset: "shape-only-canvas2d",
  methods: ["mount", "play", "pause", "resume", "stop", "restart", "seekFrame", "seekMarker", "setSpeed", "setSource", "dispose", "update", "render", "inspect"],
  states: ["ready", "playing", "paused", "stopped", "error", "disposed"],
  pointer_events: ["passthrough"],
  boundaries: {
    owns: ["asset validation", "shape evaluation", "frame/marker seek", "playback lifecycle", "generation and completion dedupe"],
    does_not_own: ["reward/economy", "game pause policy", "input settlement", "network loading", "Core ui.setRoot schema", "GPU timing"],
  },
};

const EPSILON = 1e-6;

function issue(code, path, message) {
  return { code, path, message, severity: "ERROR" };
}

function number(value, path, issues, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
    issues.push(issue("UNONE_LOTTIE_NUMBER_INVALID", path, `Expected a finite number${min !== -Infinity ? ` >= ${min}` : ""}${max !== Infinity ? ` <= ${max}` : ""}.`));
    return null;
  }
  return result;
}

function validateProperty(value, path, issues, { vector = false, allowMissing = true } = {}) {
  if (value === undefined || value === null) {
    if (!allowMissing) issues.push(issue("UNONE_LOTTIE_PROPERTY_MISSING", path, "Property is required."));
    return;
  }
  if (!value || typeof value !== "object") {
    issues.push(issue("UNONE_LOTTIE_PROPERTY_INVALID", path, "Property must be a Lottie property object."));
    return;
  }
  const animated = value.a === 1;
  if (value.a !== 0 && value.a !== 1) issues.push(issue("UNONE_LOTTIE_PROPERTY_INVALID", `${path}/a`, "Property animation flag must be 0 or 1."));
  const values = animated ? value.k : [value.k];
  if (!Array.isArray(values)) {
    issues.push(issue("UNONE_LOTTIE_PROPERTY_INVALID", `${path}/k`, "Property keyframes must be an array."));
    return;
  }
  for (const [index, key] of values.entries()) {
    const keyPath = animated ? `${path}/k/${index}` : `${path}/k`;
    const sample = animated ? key?.s : key;
    if (!Array.isArray(sample) && !Number.isFinite(Number(sample))) {
      issues.push(issue("UNONE_LOTTIE_PROPERTY_INVALID", keyPath, "Property value must be a finite number or number array."));
      continue;
    }
    const array = Array.isArray(sample) ? sample : [sample];
    if (vector && array.length < 2) issues.push(issue("UNONE_LOTTIE_PROPERTY_INVALID", keyPath, "Vector property must contain at least two numbers."));
    array.forEach((component, componentIndex) => number(component, `${keyPath}/${componentIndex}`, issues));
    if (animated) number(key?.t, `${keyPath}/t`, issues);
    if (animated && key?.e !== undefined) {
      const end = Array.isArray(key.e) ? key.e : [key.e];
      end.forEach((component, componentIndex) => number(component, `${keyPath}/e/${componentIndex}`, issues));
    }
  }
}

function validatePath(path, pathName, issues) {
  if (!path || typeof path !== "object") {
    issues.push(issue("UNONE_LOTTIE_PATH_INVALID", pathName, "Shape path must be an object."));
    return;
  }
  if (path.a !== 0) issues.push(issue("UNONE_LOTTIE_UNSUPPORTED", `${pathName}/a`, "Animated path geometry is outside the v1 subset."));
  const value = path.k;
  if (!value || typeof value !== "object" || !Array.isArray(value.v) || !Array.isArray(value.i) || !Array.isArray(value.o)) {
    issues.push(issue("UNONE_LOTTIE_PATH_INVALID", `${pathName}/k`, "Path must contain static v/i/o vertex arrays."));
    return;
  }
  if (value.v.length === 0 || value.i.length !== value.v.length || value.o.length !== value.v.length) {
    issues.push(issue("UNONE_LOTTIE_PATH_INVALID", `${pathName}/k`, "Path vertex and tangent arrays must have equal non-zero length."));
  }
  for (const [index, point] of value.v.entries()) {
    if (!Array.isArray(point) || point.length < 2) issues.push(issue("UNONE_LOTTIE_PATH_INVALID", `${pathName}/k/v/${index}`, "Vertex must contain x and y."));
    else for (const component of point) number(component, `${pathName}/k/v/${index}`, issues);
    const inputTangent = value.i[index];
    const outputTangent = value.o[index];
    if (!Array.isArray(inputTangent) || inputTangent.length < 2) issues.push(issue("UNONE_LOTTIE_PATH_INVALID", `${pathName}/k/i/${index}`, "Incoming tangent must contain x and y."));
    else for (const component of inputTangent) number(component, `${pathName}/k/i/${index}`, issues);
    if (!Array.isArray(outputTangent) || outputTangent.length < 2) issues.push(issue("UNONE_LOTTIE_PATH_INVALID", `${pathName}/k/o/${index}`, "Outgoing tangent must contain x and y."));
    else for (const component of outputTangent) number(component, `${pathName}/k/o/${index}`, issues);
  }
  if (value.c !== true) issues.push(issue("UNONE_LOTTIE_PATH_INVALID", `${pathName}/k/c`, "Only closed paths are supported in v1."));
}

export function validateLottieDocument(document) {
  const issues = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return [issue("UNONE_LOTTIE_DOCUMENT_INVALID", "/", "Lottie document must be an object.")];
  const allowedDocumentFields = new Set(["v", "fr", "ip", "op", "w", "h", "nm", "ddd", "assets", "layers", "markers"]);
  for (const field of Object.keys(document)) if (!allowedDocumentFields.has(field)) issues.push(issue("UNONE_LOTTIE_UNSUPPORTED", `/${field}`, `Top-level field '${field}' is outside the v1 subset.`));
  if (typeof document.v !== "string" || !/^5\./.test(document.v)) issues.push(issue("UNONE_LOTTIE_VERSION_UNSUPPORTED", "/v", "Only Lottie 5.x JSON is supported."));
  number(document.fr, "/fr", issues, { min: EPSILON });
  const ip = number(document.ip, "/ip", issues, { min: 0 });
  const op = number(document.op, "/op", issues, { min: 0 });
  if (ip !== null && op !== null && op <= ip) issues.push(issue("UNONE_LOTTIE_TIMELINE_INVALID", "/op", "op must be greater than ip."));
  number(document.w, "/w", issues, { min: 1 });
  number(document.h, "/h", issues, { min: 1 });
  if (document.ddd !== undefined && document.ddd !== 0) issues.push(issue("UNONE_LOTTIE_UNSUPPORTED", "/ddd", "3D layers are not supported."));
  if (!Array.isArray(document.layers)) issues.push(issue("UNONE_LOTTIE_LAYERS_INVALID", "/layers", "layers must be an array."));
  if (document.assets !== undefined && (!Array.isArray(document.assets) || document.assets.length > 0)) issues.push(issue("UNONE_LOTTIE_UNSUPPORTED", "/assets", "Image, precomp and external assets are not supported."));
  if (document.markers !== undefined && !Array.isArray(document.markers)) issues.push(issue("UNONE_LOTTIE_MARKERS_INVALID", "/markers", "markers must be an array."));
  for (const [index, layer] of (document.layers ?? []).entries()) {
    const path = `/layers/${index}`;
    if (!layer || typeof layer !== "object") { issues.push(issue("UNONE_LOTTIE_LAYER_INVALID", path, "Layer must be an object.")); continue; }
    const allowedLayerFields = new Set(["ty", "nm", "sr", "ip", "op", "st", "ks", "shapes", "ao"]);
    for (const field of Object.keys(layer)) if (!allowedLayerFields.has(field)) issues.push(issue("UNONE_LOTTIE_UNSUPPORTED", `${path}/${field}`, `Layer field '${field}' is outside the v1 subset.`));
    if (layer.ty !== 4) issues.push(issue("UNONE_LOTTIE_UNSUPPORTED", `${path}/ty`, "Only 2D shape layers (ty=4) are supported."));
    number(layer.ip, `${path}/ip`, issues, { min: 0 });
    number(layer.op, `${path}/op`, issues, { min: 0 });
    if (layer.ks && typeof layer.ks === "object") {
      const allowedTransformFields = new Set(["o", "r", "rz", "p", "a", "s"]);
      for (const field of Object.keys(layer.ks)) if (!allowedTransformFields.has(field)) issues.push(issue("UNONE_LOTTIE_UNSUPPORTED", `${path}/ks/${field}`, `Transform field '${field}' is outside the v1 subset.`));
      validateProperty(layer.ks.o, `${path}/ks/o`, issues, { allowMissing: true });
      validateProperty(layer.ks.p, `${path}/ks/p`, issues, { vector: true });
      validateProperty(layer.ks.a, `${path}/ks/a`, issues, { vector: true });
      validateProperty(layer.ks.s, `${path}/ks/s`, issues, { vector: true });
      validateProperty(layer.ks.r ?? layer.ks.rz, `${path}/ks/r`, issues);
    } else issues.push(issue("UNONE_LOTTIE_LAYER_INVALID", `${path}/ks`, "Layer transform ks is required."));
    if (!Array.isArray(layer.shapes)) { issues.push(issue("UNONE_LOTTIE_SHAPES_INVALID", `${path}/shapes`, "Shape layer shapes must be an array.")); continue; }
    for (const [shapeIndex, shape] of layer.shapes.entries()) {
      const shapePath = `${path}/shapes/${shapeIndex}`;
      if (shape && typeof shape === "object") {
        const allowedShapeFields = shape.ty === "sh" ? new Set(["ty", "ks", "nm"]) : new Set(["ty", "c", "o", "r", "nm"]);
        for (const field of Object.keys(shape)) if (!allowedShapeFields.has(field)) issues.push(issue("UNONE_LOTTIE_UNSUPPORTED", `${shapePath}/${field}`, `Shape field '${field}' is outside the v1 subset.`));
      }
      if (shape?.ty === "sh") validatePath(shape.ks, `${shapePath}/ks`, issues);
      else if (shape?.ty === "fl") {
        validateProperty(shape.c, `${shapePath}/c`, issues, { vector: true, allowMissing: false });
        validateProperty(shape.o, `${shapePath}/o`, issues, { allowMissing: false });
      } else issues.push(issue("UNONE_LOTTIE_UNSUPPORTED", `${shapePath}/ty`, "Only path (sh) and solid fill (fl) shapes are supported."));
    }
  }
  for (const [index, marker] of (document.markers ?? []).entries()) {
    number(marker?.tm, `/markers/${index}/tm`, issues, { min: 0 });
    if (typeof marker?.cm !== "string" || !marker.cm) issues.push(issue("UNONE_LOTTIE_MARKER_INVALID", `/markers/${index}/cm`, "Marker name must be a non-empty string."));
  }
  return issues;
}

function clone(value) {
  return Array.isArray(value) ? value.map(clone) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
}

function bezier(t, p1, p2) {
  const inv = 1 - t;
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

function ease(progress, keyframe) {
  const out = keyframe?.o;
  const incoming = keyframe?.i;
  if (!out || !incoming) return progress;
  const ox = Array.isArray(out.x) ? Number(out.x[0]) : Number(out.x);
  const oy = Array.isArray(out.y) ? Number(out.y[0]) : Number(out.y);
  const ix = Array.isArray(incoming.x) ? Number(incoming.x[0]) : Number(incoming.x);
  const iy = Array.isArray(incoming.y) ? Number(incoming.y[0]) : Number(incoming.y);
  if (![ox, oy, ix, iy].every(Number.isFinite)) return progress;
  let low = 0; let high = 1;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const middle = (low + high) / 2;
    if (bezier(middle, ox, ix) < progress) low = middle; else high = middle;
  }
  return bezier((low + high) / 2, oy, iy);
}

function lerpValue(start, end, progress) {
  const a = Array.isArray(start) ? start : [start];
  const b = Array.isArray(end) ? end : [end];
  const result = a.map((value, index) => Number(value) + (Number(b[index] ?? value) - Number(value)) * progress);
  return Array.isArray(start) ? result : result[0];
}

function valueAt(property, frame, fallback) {
  if (!property || typeof property !== "object") return clone(fallback);
  if (property.a !== 1) return clone(property.k ?? fallback);
  const keyframes = Array.isArray(property.k) ? property.k : [];
  if (keyframes.length === 0) return clone(fallback);
  let current = keyframes[0];
  let next = null;
  for (let index = 0; index < keyframes.length; index += 1) {
    const key = keyframes[index];
    if (frame >= Number(key?.t ?? 0)) { current = key; next = keyframes[index + 1] ?? null; } else break;
  }
  const start = current?.s ?? fallback;
  if (!next || current?.e === undefined || Number(next.t) <= Number(current.t)) return clone(start);
  const ratio = Math.max(0, Math.min(1, (frame - Number(current.t)) / (Number(next.t) - Number(current.t))));
  return lerpValue(start, current.e, ease(ratio, current));
}

function color(value) {
  const channels = Array.isArray(value) ? value : [value, value, value, 1];
  const [r = 0, g = 0, b = 0, a = 1] = channels;
  return `rgba(${Math.round(Number(r) * 255)},${Math.round(Number(g) * 255)},${Math.round(Number(b) * 255)},${Math.max(0, Math.min(1, Number(a)))})`;
}

function drawPath(context, path) {
  const vertices = path?.v ?? [];
  const incoming = path?.i ?? [];
  const outgoing = path?.o ?? [];
  if (!vertices.length) return;
  context.moveTo(vertices[0][0], vertices[0][1]);
  for (let index = 1; index < vertices.length; index += 1) {
    const previous = vertices[index - 1];
    const current = vertices[index];
    const out = outgoing[index - 1] ?? [0, 0];
    const input = incoming[index] ?? [0, 0];
    const c1 = [previous[0] + out[0], previous[1] + out[1]];
    const c2 = [current[0] + input[0], current[1] + input[1]];
    if ((out[0] || out[1] || input[0] || input[1])) context.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], current[0], current[1]);
    else context.lineTo(current[0], current[1]);
  }
  const previous = vertices.at(-1);
  const current = vertices[0];
  const out = outgoing.at(-1) ?? [0, 0];
  const input = incoming[0] ?? [0, 0];
  const c1 = [previous[0] + out[0], previous[1] + out[1]];
  const c2 = [current[0] + input[0], current[1] + input[1]];
  if ((out[0] || out[1] || input[0] || input[1])) context.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], current[0], current[1]);
  else context.closePath();
}

function renderDocument(context, document, frame, { clear = true } = {}) {
  if (!context) return;
  const width = Number(document.w); const height = Number(document.h);
  if (typeof context.setTransform === "function") context.setTransform(1, 0, 0, 1, 0, 0);
  if (clear) context.clearRect?.(0, 0, context.canvas?.width ?? width, context.canvas?.height ?? height);
  const scaleX = (context.canvas?.width ?? width) / width;
  const scaleY = (context.canvas?.height ?? height) / height;
  context.save?.();
  context.scale?.(scaleX, scaleY);
  // Lottie draws the layer list back-to-front for the shape-only subset.
  for (let index = (document.layers?.length ?? 0) - 1; index >= 0; index -= 1) {
    const layer = document.layers[index];
    if (frame < Number(layer.ip ?? document.ip) || frame >= Number(layer.op ?? document.op)) continue;
    const transform = layer.ks;
    const position = valueAt(transform.p, frame, [0, 0, 0]);
    const anchor = valueAt(transform.a, frame, [0, 0, 0]);
    const scale = valueAt(transform.s, frame, [100, 100, 100]);
    const rotation = Number(valueAt(transform.r ?? transform.rz, frame, 0));
    const opacity = Number(valueAt(transform.o, frame, 100)) / 100;
    context.save?.();
    context.globalAlpha = Math.max(0, Math.min(1, opacity));
    context.translate?.(Number(position[0] ?? 0), Number(position[1] ?? 0));
    context.rotate?.(-rotation * Math.PI / 180);
    context.scale?.(Number(scale[0] ?? 100) / 100, Number(scale[1] ?? 100) / 100);
    context.translate?.(-Number(anchor[0] ?? 0), -Number(anchor[1] ?? 0));
    let paths = [];
    for (const shape of layer.shapes ?? []) {
      if (shape.ty === "sh") paths.push(shape.ks.k);
      if (shape.ty !== "fl") continue;
      context.beginPath?.();
      for (const path of paths) drawPath(context, path);
      const fill = valueAt(shape.c, frame, [0, 0, 0, 1]);
      const fillOpacity = Number(valueAt(shape.o, frame, 100)) / 100;
      context.fillStyle = color(fill);
      context.globalAlpha = Math.max(0, Math.min(1, opacity * fillOpacity));
      context.fill?.();
      paths = [];
    }
    context.restore?.();
  }
  context.restore?.();
}

function responseOk(value) { return { ok: true, value }; }
function responseError(code, message, path = null) { return { ok: false, error: { code, message, path } }; }

export function createLottiePlayer({ data, context, instanceId = "lottie", reducedMotion = false, reducedMotionFrame, pointerEvents = "passthrough", onEvent } = {}) {
  let document = data;
  let issues = validateLottieDocument(document);
  let disposed = false;
  let state = issues.length ? "error" : "ready";
  let frame = Number(document?.ip ?? 0);
  let speed = 1;
  let mode = "once";
  let generation = 1;
  let completionGeneration = null;
  const emit = (event) => { if (!disposed) onEvent?.({ instanceId, generation, ...event }); };
  const error = () => issues[0] ? { code: issues[0].code, path: issues[0].path, message: issues[0].message } : null;
  const terminal = () => Number(document?.op ?? 0);

  function ensureLive() { return disposed ? responseError("UNONE_LOTTIE_DISPOSED", "Lottie instance is disposed.") : null; }
  function snapshot() {
    return { instanceId, generation, frame, state, speed, mode, pointerEvents, durationFrames: Math.max(0, terminal() - Number(document?.ip ?? 0)), error: error() };
  }
  function render() {
    const failure = ensureLive(); if (failure) return failure;
    if (state === "error") return responseError("UNONE_LOTTIE_RENDER_BLOCKED", "Cannot render an invalid Lottie document.", issues[0]?.path);
    const target = reducedMotion ? Number(reducedMotionFrame ?? findMarker(document, "collect") ?? document.ip) : frame;
    renderDocument(context, document, Math.max(Number(document.ip), Math.min(Number(document.op), target)));
    return responseOk(snapshot());
  }
  function play(options = {}) {
    const failure = ensureLive(); if (failure) return failure;
    if (state === "error") return responseError("UNONE_LOTTIE_INVALID_SOURCE", "Cannot play an invalid Lottie document.", issues[0]?.path);
    if (options.mode !== undefined && options.mode !== "once" && options.mode !== "loop") return responseError("UNONE_LOTTIE_MODE_INVALID", "mode must be once or loop.", "/playback/mode");
    if (options.speed !== undefined) { const value = Number(options.speed); if (!Number.isFinite(value) || value < 0) return responseError("UNONE_LOTTIE_SPEED_INVALID", "speed must be finite and non-negative.", "/playback/speed"); speed = value; }
    mode = options.mode ?? mode;
    if (reducedMotion) { state = "paused"; render(); return responseOk(snapshot()); }
    state = "playing"; completionGeneration = null; return responseOk(snapshot());
  }
  function pause() { const failure = ensureLive(); if (failure) return failure; if (state === "playing") state = "paused"; return responseOk(snapshot()); }
  function resume() { const failure = ensureLive(); if (failure) return failure; if (state === "paused") state = "playing"; return responseOk(snapshot()); }
  function stop() { const failure = ensureLive(); if (failure) return failure; state = "stopped"; return responseOk(snapshot()); }
  function restart(options = {}) { const failure = ensureLive(); if (failure) return failure; frame = Number(document.ip); completionGeneration = null; state = "ready"; return play(options); }
  function seekFrame(value) {
    const failure = ensureLive(); if (failure) return failure;
    const next = Number(value); if (!Number.isFinite(next)) return responseError("UNONE_LOTTIE_FRAME_INVALID", "frame must be finite.", "/frame");
    frame = Math.max(Number(document.ip), Math.min(Number(document.op), next));
    completionGeneration = null;
    render();
    return responseOk(snapshot());
  }
  function seekMarker(name) {
    const failure = ensureLive(); if (failure) return failure;
    const marker = (document.markers ?? []).find((candidate) => candidate.cm === name);
    if (!marker) return responseError("UNONE_LOTTIE_MARKER_MISSING", `Marker '${name}' does not exist.`, "/markers");
    return seekFrame(marker.tm);
  }
  function setSpeed(value) {
    const failure = ensureLive(); if (failure) return failure;
    const next = Number(value); if (!Number.isFinite(next) || next < 0) return responseError("UNONE_LOTTIE_SPEED_INVALID", "speed must be finite and non-negative.", "/speed");
    speed = next; return responseOk(snapshot());
  }
  function setSource(nextData, nextAssetId = instanceId) {
    const failure = ensureLive(); if (failure) return failure;
    const nextIssues = validateLottieDocument(nextData);
    document = nextData; issues = nextIssues; generation += 1; frame = Number(document?.ip ?? 0); completionGeneration = null; state = nextIssues.length ? "error" : "ready";
    if (!nextIssues.length) emit({ type: "ready", frame }); else emit({ type: "error", frame, error: error() });
    return nextIssues.length ? responseError("UNONE_LOTTIE_INVALID_SOURCE", "Source replacement is invalid.", nextIssues[0].path) : responseOk(snapshot());
  }
  function update(dt) {
    const failure = ensureLive(); if (failure) return failure;
    const delta = Number(dt); if (!Number.isFinite(delta) || delta < 0) return responseError("UNONE_LOTTIE_DT_INVALID", "dt must be finite and non-negative.", "/dt");
    if (state !== "playing" || reducedMotion || speed === 0) return responseOk(snapshot());
    const start = frame; frame += delta * Number(document.fr) * speed;
    if (mode === "loop") {
      const duration = terminal() - Number(document.ip);
      if (duration > 0 && frame >= terminal()) frame = Number(document.ip) + ((frame - Number(document.ip)) % duration);
    } else if (frame >= terminal()) {
      frame = terminal(); state = "stopped";
      if (completionGeneration !== generation) { completionGeneration = generation; emit({ type: "complete", reason: "natural_end", frame }); }
    }
    if (frame !== start) render();
    return responseOk(snapshot());
  }
  function dispose() { if (disposed) return responseOk(snapshot()); generation += 1; disposed = true; state = "disposed"; return responseOk(snapshot()); }

  if (pointerEvents !== "passthrough") issues = [...issues, issue("UNONE_LOTTIE_POINTER_MODE_UNSUPPORTED", "/pointerEvents", "Only pointerEvents=passthrough is supported in v1.")];
  state = issues.length ? "error" : "ready";
  if (issues.length) emit({ type: "error", frame, error: error() }); else emit({ type: "ready", frame });
  return { play, pause, resume, stop, restart, seekFrame, seekMarker, setSpeed, setSource, update, render, getState: snapshot, inspect: snapshot, dispose, get document() { return document; }, get context() { return context; } };
}

export function findMarker(document, name) {
  return (document?.markers ?? []).find((marker) => marker.cm === name)?.tm ?? null;
}

export function createLottieHost({ assets = {}, createCanvas, onEvent } = {}) {
  const instances = new Map();
  let disposed = false;
  const lookup = (asset) => typeof asset === "string" ? (assets instanceof Map ? assets.get(asset) : assets[asset]) : asset;
  function ensureLive() { if (disposed) throw new Error("Lottie host has been disposed."); }
  function mount(node = {}) {
    ensureLive();
    const instanceId = String(node.instanceId ?? node.id ?? "");
    if (!instanceId) return responseError("UNONE_LOTTIE_INSTANCE_INVALID", "instanceId is required.", "/instanceId");
    if (instances.has(instanceId)) return responseError("UNONE_LOTTIE_INSTANCE_EXISTS", `Instance '${instanceId}' already exists.`, "/instanceId");
    const data = lookup(node.data ?? node.asset);
    const issues = validateLottieDocument(data);
    if (issues.length) return responseError("UNONE_LOTTIE_INVALID_SOURCE", "Cannot mount an invalid Lottie asset.", issues[0].path);
    const canvas = node.canvas ?? createCanvas?.(data?.w ?? 1, data?.h ?? 1);
    const context = node.context ?? canvas?.getContext?.("2d");
    if (!context || typeof context.clearRect !== "function") return responseError("UNONE_LOTTIE_CONTEXT_MISSING", "A Canvas2D context is required for this host.", "/canvas");
    const player = createLottiePlayer({ data, context, instanceId, reducedMotion: node.playback?.reducedMotion === true, reducedMotionFrame: node.playback?.reducedMotionFrame, pointerEvents: node.pointerEvents ?? "passthrough", onEvent: (event) => onEvent?.(event) });
    instances.set(instanceId, { instanceId, canvas, player, bounds: { x: node.rect?.x ?? 0, y: node.rect?.y ?? 0, w: node.rect?.w ?? 100, h: node.rect?.h ?? 100 }, asset: node.asset ?? null });
    if (node.playback?.mode || node.playback?.speed !== undefined) player.play({ mode: node.playback.mode, speed: node.playback.speed });
    return responseOk({ instanceId, generation: player.getState().generation, canvas, state: player.getState() });
  }
  function withPlayer(id, operation) { ensureLive(); const entry = instances.get(String(id)); return entry ? operation(entry.player, entry) : responseError("UNONE_LOTTIE_INSTANCE_MISSING", `Instance '${id}' does not exist.`, "/instanceId"); }
  function dispose(id) { ensureLive(); const entry = instances.get(String(id)); if (!entry) return responseError("UNONE_LOTTIE_INSTANCE_MISSING", `Instance '${id}' does not exist.`, "/instanceId"); entry.player.dispose(); instances.delete(String(id)); return responseOk({ instanceId: String(id), disposed: true }); }
  function update(dt) { ensureLive(); return responseOk([...instances.values()].map((entry) => entry.player.update(dt).value)); }
  function render() { ensureLive(); return responseOk([...instances.values()].map((entry) => entry.player.render().value)); }
  function inspect(id) {
    ensureLive(); const entry = instances.get(String(id)); if (!entry) return responseError("UNONE_LOTTIE_INSTANCE_MISSING", `Instance '${id}' does not exist.`, "/instanceId");
    const state = entry.player.inspect();
    return responseOk({ componentBounds: entry.bounds, clipped: false, assetReady: state.state !== "error", currentFrame: state.frame, state: state.state, generation: state.generation, backend: "canvas-2d", error: state.error });
  }
  function setSource(id, source) { return withPlayer(id, (player) => player.setSource(lookup(source), String(source?.id ?? id))); }
  function disposeHost() { if (disposed) return; for (const entry of instances.values()) entry.player.dispose(); instances.clear(); disposed = true; }
  return { mount, play: (id, options) => withPlayer(id, (player) => player.play(options)), pause: (id) => withPlayer(id, (player) => player.pause()), resume: (id) => withPlayer(id, (player) => player.resume()), stop: (id) => withPlayer(id, (player) => player.stop()), restart: (id, options) => withPlayer(id, (player) => player.restart(options)), seekFrame: (id, frame) => withPlayer(id, (player) => player.seekFrame(frame)), seekMarker: (id, marker) => withPlayer(id, (player) => player.seekMarker(marker)), setSpeed: (id, speed) => withPlayer(id, (player) => player.setSpeed(speed)), setSource, dispose, update, render, inspect, disposeHost };
}

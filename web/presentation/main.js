import { requireAssetEncoding, DECODER_ROUTES } from "../shared/asset-encoding.js";
// Presentation host: the engine decides, this page draws.
//
// Rust/Luau owns the fixed-tick simulation and publishes semantic state:
// which animation clip each entity plays and which effect instances are live.
// This file owns the two runtimes that turn that into pixels — spine-webgl and
// Effekseer for WebGL — plus their asset lifetimes. It never decides a result.
//
// It also owns playback for the audio the engine asked for. The engine decides
// which sound starts, which one an exclusive category stops, and how far into a
// fade each frame is; this file only decodes, mixes and sets a gain.

import { createFixedStepScheduler } from "../shared/fixed-step-scheduler.mjs?v=2";

const statusLine = document.querySelector("#status");
const output = document.querySelector("#output");
const canvas = document.querySelector("#game");
const uiLayer = document.querySelector("#ui-layer");
const spinButton = document.querySelector("#spin");
const autoButton = document.querySelector("#auto");

const params = new URLSearchParams(location.search);
const projectRoot = new URL(
  params.get("project") ?? "/Unone_Games/slot-machine/",
  location.origin
);

// World units the camera shows. The slot scene puts its reels at x = -2, 0, 2.
const VIEW_WIDTH = 8;
const VIEW_HEIGHT = 4.5;
const EFFECT_SCALE = 0.35;
// Effekseer effects are authored in 3D and this sample ring lies on the ground
// plane. A 2D game watches it from +Z, so the host stands it up to face the
// camera. That is a presentation convention, not engine state.
const EFFECT_FACE_CAMERA_X = Math.PI / 2;

let snapshot = null;
let assets = null;
let spineState = null;
let effekseerState = null;
let audioState = null;
let renderedUi = null;
let pendingActions = new Map();
let autoPlay = false;
let autoCooldown = 0;
// While a recorder drives the loop, the page must not also schedule frames.
let recording = false;
let frameScheduler = null;

function fail(error) {
  statusLine.textContent = `failed: ${error.message ?? error}`;
  output.textContent = String(error.stack ?? error);
  throw error;
}

async function fetchText(path) {
  const response = await fetch(new URL(path, projectRoot), { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.text();
}

async function fetchJson(path) {
  return JSON.parse(await fetchText(path));
}

/// Wait for a condition without requestAnimationFrame.
function waitFor(condition, label, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      let ready = false;
      try {
        ready = condition();
      } catch (error) {
        reject(error);
        return;
      }
      if (ready) resolve();
      else if (performance.now() - started > timeoutMs) reject(new Error(`${label} timed out`));
      else setTimeout(poll, 16);
    };
    poll();
  });
}

function readSnapshot() {
  const module = window.Module;
  const address = module._unone_web_observation_ptr();
  const length = module._unone_web_observation_len();
  const bytes = module.HEAPU8.slice(address, address + length);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function writePayload(text) {
  const bytes = new TextEncoder().encode(text);
  const address = window.Module._unone_web_alloc(bytes.length);
  window.Module.HEAPU8.set(bytes, address);
  return { address, length: bytes.length };
}

async function loadProject() {
  const config = await fetchJson("project.unone.json");
  const script = await fetchText(config.entry_script ?? "scripts/main.luau");
  const scene = config.main_scene ? await fetchJson(config.main_scene) : null;
  const manifest = config.asset_manifest ? await fetchJson(config.asset_manifest) : null;
  const payload = writePayload(
    JSON.stringify({
      project: config.name,
      script,
      scene,
      // The same switches project.unone.json declares on disk. Without them the
      // engine would report SYSTEM_DISABLED for animation and effect calls.
      systems: config.systems ?? {},
      // And the same audio categories, or the browser runs the game with no
      // category rules: no exclusive track switch, no fades.
      audio: config.audio ?? null,
    })
  );
  if (window.Module._unone_web_load_project(payload.address, payload.length, 42n) !== 0) {
    throw new Error(`project load rejected: ${JSON.stringify(readSnapshot())}`);
  }
  snapshot = readSnapshot();
  return { config, manifest };
}

function assetByKind(manifest, kind) {
  return manifest?.assets?.find((asset) => asset.kind === kind) ?? null;
}

// --- Spine -----------------------------------------------------------------

async function createSpine(asset) {
  if (!asset) return null;
  requireAssetEncoding(asset, "spine");
  const context = new spine.ManagedWebGLRenderingContext(canvas, { alpha: true, premultipliedAlpha: true });
  const renderer = new spine.SceneRenderer(canvas, context);
  const base = new URL(asset.source, projectRoot);
  const directory = base.href.slice(0, base.href.lastIndexOf("/") + 1);
  const manager = new spine.AssetManager(context, directory);
  const skeletonFile = asset.source.slice(asset.source.lastIndexOf("/") + 1);
  const atlasFile = asset.encoding
    ? asset.encoding.companions.find((file) => file.role === "atlas")?.path
    : (asset.files ?? []).find((file) => file.endsWith(".atlas"));
  if (!atlasFile) throw new Error("spine asset declares no .atlas companion file");
  manager.loadJson(skeletonFile);
  manager.loadTextureAtlas(atlasFile.slice(atlasFile.lastIndexOf("/") + 1));
  // AssetManager.loadAll() waits on requestAnimationFrame, which never fires
  // in a headless pane. Poll the same completion flag on a timer instead.
  await waitFor(() => manager.isLoadingComplete(), "spine assets");
  if (Object.keys(manager.errors ?? {}).length > 0) {
    throw new Error(`spine asset load failed: ${JSON.stringify(manager.errors)}`);
  }
  const atlas = manager.require(atlasFile.slice(atlasFile.lastIndexOf("/") + 1));
  const skeletonJson = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
  const skeletonData = skeletonJson.readSkeletonData(manager.require(skeletonFile));
  return { context, renderer, skeletonData, actors: new Map() };
}

// One skeleton instance per entity, driven entirely by the engine snapshot.
function syncSpineActors(world) {
  if (!spineState) return;
  const seen = new Set();
  for (const [id, entity] of Object.entries(world.entities ?? {})) {
    const animation = entity.animation;
    if (!animation) continue;
    seen.add(id);
    let actor = spineState.actors.get(id);
    if (!actor) {
      const skeleton = new spine.Skeleton(spineState.skeletonData);
      const stateData = new spine.AnimationStateData(spineState.skeletonData);
      stateData.defaultMix = 0.15;
      actor = { skeleton, state: new spine.AnimationState(stateData), playing: null };
      spineState.actors.set(id, actor);
    }
    // started_frame changes only when the engine actually selected a new clip.
    const key = `${animation.animation}@${animation.started_frame}`;
    if (actor.playing !== key) {
      const entry = actor.state.setAnimation(0, animation.animation, animation.loop);
      entry.timeScale = animation.speed;
      actor.playing = key;
    }
    actor.skeleton.x = entity.transform.x;
    actor.skeleton.y = entity.transform.y - 1.35;
    actor.skeleton.scaleX = 0.003;
    actor.skeleton.scaleY = 0.003;
  }
  for (const id of [...spineState.actors.keys()]) {
    if (!seen.has(id)) spineState.actors.delete(id);
  }
}

function drawSpine(delta) {
  if (!spineState) return;
  const renderer = spineState.renderer;
  renderer.camera.position.x = 0;
  renderer.camera.position.y = 0;
  // Not renderer.resize(): it resizes the canvas back to its CSS size, which
  // would fight the explicit size a recording asks for.
  renderer.camera.setViewport(VIEW_WIDTH, VIEW_HEIGHT);
  renderer.camera.update();
  spineState.context.gl.viewport(0, 0, canvas.width, canvas.height);
  renderer.begin();
  for (const actor of spineState.actors.values()) {
    actor.state.update(delta);
    actor.state.apply(actor.skeleton);
    actor.skeleton.update(delta);
    actor.skeleton.updateWorldTransform(spine.Physics.update);
    renderer.drawSkeleton(actor.skeleton, true);
  }
  renderer.end();
}

// --- Effekseer -------------------------------------------------------------

async function createEffekseer(asset, gl) {
  if (!asset) return null;
  requireAssetEncoding(asset, "effekseer");
  await new Promise((resolve, reject) =>
    effekseer.initRuntime("../vendor/effekseer/effekseer.wasm", resolve, () =>
      reject(new Error("effekseer wasm failed to load"))
    )
  );
  const context = effekseer.createContext();
  context.init(gl, { instanceMaxCount: 2000, squareMaxCount: 4000 });
  const effect = await new Promise((resolve, reject) => {
    const loaded = context.loadEffect(
      new URL(asset.source, projectRoot).href,
      1.0,
      () => resolve(loaded),
      () => reject(new Error(`effect load failed: ${asset.source}`))
    );
  });
  return { context, effect, live: new Map() };
}

// The engine owns which effect instances exist; this only mirrors that list.
function syncEffects(world) {
  if (!effekseerState) return;
  const live = new Map((world.effects ?? []).map((effect) => [effect.handle, effect]));
  for (const [handle, played] of [...effekseerState.live]) {
    if (!live.has(handle)) {
      played.stop();
      effekseerState.live.delete(handle);
    }
  }
  for (const [handle, effect] of live) {
    if (effekseerState.live.has(handle)) continue;
    const played = effekseerState.context.play(
      effekseerState.effect,
      effect.position.x,
      effect.position.y,
      0
    );
    const scale = effect.scale * EFFECT_SCALE;
    played.setScale(scale, scale, scale);
    played.setRotation(EFFECT_FACE_CAMERA_X, 0, effect.rotation);
    effekseerState.live.set(handle, played);
  }
}

function drawEffects() {
  if (!effekseerState) return;
  const context = effekseerState.context;
  context.update();
  context.setProjectionOrthographic(VIEW_WIDTH, VIEW_HEIGHT, 0.1, 100);
  context.setCameraLookAt(0, 0, 10, 0, 0, 0, 0, 1, 0);
  context.draw();
}

// --- Audio -----------------------------------------------------------------

// Every "audio" asset the manifest declares, decoded once up front.
//
// A missing or undecodable clip is reported rather than silently skipped: an
// engine that says a sound played and a page that quietly plays nothing is the
// one audio bug nothing else can catch.
async function createAudio(manifest, config) {
  const declared = (manifest?.assets ?? []).filter((asset) => asset.kind === "audio");
  if (declared.length === 0) return null;
  // The declared bus levels. The engine only publishes the mix once the game
  // has moved one of them, so the starting levels come from the project.
  const declaredLevels = Object.fromEntries(
    Object.entries(config?.audio?.categories ?? {}).map(([name, rules]) => [
      name,
      rules.volume ?? 1,
    ])
  );
  const context = new (window.AudioContext ?? window.webkitAudioContext)();
  const master = context.createGain();
  master.connect(context.destination);
  const buffers = new Map();
  const failures = [];
  await Promise.all(
    declared.map(async (asset) => {
      try {
        const response = await fetch(new URL(asset.source, projectRoot));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        buffers.set(asset.id, await context.decodeAudioData(await response.arrayBuffer()));
      } catch (error) {
        failures.push(`${asset.id}: ${error.message ?? error}`);
      }
    })
  );
  return { context, master, buffers, declaredLevels, live: new Map(), failures, missing: new Set() };
}

function audioBuffer(assetId) {
  const buffer = audioState.buffers.get(assetId);
  if (buffer) return buffer;
  if (!audioState.missing.has(assetId)) {
    audioState.missing.add(assetId);
    console.warn(`audio asset '${assetId}' is not declared in the asset manifest`);
  }
  return null;
}

// The bus level a sound in this category is played at, the way a mixer group
// multiplies into a source's own volume.
function busGain(world, category) {
  const mix = world.audio_mix ?? null;
  const master = mix?.master ?? 1;
  if (!category) return master;
  const level =
    mix?.categories?.[category] ?? audioState.declaredLevels[category] ?? 1;
  return master * level;
}

// How loud this loop should be right now.
//
// The engine publishes the phase and how many frames into it we are, so the
// host never has to schedule a ramp or guess when a fade ends — it reads the
// gain off the frame it is drawing.
function loopGain(world, source) {
  if (source.paused) return 0;
  const bus = source.volume * busGain(world, source.category);
  if (source.phase_frames === 0) return bus;
  const elapsed = Math.min(
    Math.max(world.frame - source.phase_started_frame, 0),
    source.phase_frames
  );
  const progress = elapsed / source.phase_frames;
  if (source.phase === "fading_in") return bus * progress;
  if (source.phase === "fading_out") return bus * (1 - progress);
  return bus;
}

// The engine owns which sounds exist; this only mirrors that decision.
function syncAudio(world) {
  // Web Audio permits nodes to be scheduled while the context is suspended;
  // dropping a one-shot here would make a gesture's sound disappear before
  // the unlock promise resolves. Only a closed context is unusable.
  if (!audioState || audioState.context.state === "closed") return;
  const context = audioState.context;

  for (const event of world.audio_events ?? []) {
    if (event.kind !== "play" || event.loop) continue;
    const buffer = audioBuffer(event.asset);
    if (!buffer) continue;
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = event.speed;
    const gain = context.createGain();
    gain.gain.value = event.volume * busGain(world, event.category);
    node.connect(gain).connect(audioState.master);
    node.start();
  }

  const live = new Map((world.audio_loops ?? []).map((source) => [source.handle, source]));
  for (const [handle, playing] of [...audioState.live]) {
    if (live.has(handle)) continue;
    playing.node.stop();
    audioState.live.delete(handle);
  }
  for (const [handle, source] of live) {
    let playing = audioState.live.get(handle);
    if (!playing) {
      const buffer = audioBuffer(source.asset);
      if (!buffer) continue;
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      node.playbackRate.value = source.speed;
      const gain = context.createGain();
      node.connect(gain).connect(audioState.master);
      node.start();
      playing = { node, gain };
      audioState.live.set(handle, playing);
    }
    playing.gain.gain.value = loopGain(world, source);
  }
}

// Browsers keep an AudioContext suspended until a real gesture. The game stays
// playable while it is locked; this only unlocks it when the player acts.
function unlockAudio() {
  if (audioState && audioState.context.state === "suspended") {
    audioState.context.resume().catch((error) => {
      audioState.failures.push(`AudioContext resume failed: ${error.message ?? error}`);
    });
  }
}

function audioStatus(world) {
  if (!audioState) return "no audio assets";
  if (audioState.failures.length > 0) return `audio load failed: ${audioState.failures.join("; ")}`;
  if (audioState.context.state !== "running") return "audio locked until you click";
  return `audio loops ${world.audio_loops?.length ?? 0}`;
}

// --- UI, input and the frame loop -----------------------------------------

function renderUi(world) {
  const ui = world?.ui ?? null;
  const serialized = JSON.stringify(ui);
  if (serialized === renderedUi) return;
  renderedUi = serialized;
  uiLayer.replaceChildren();
  if (!ui) return;
  for (const node of ui.children ?? []) {
    // A button the game published has to be pressable, or the only way to play
    // is the host's own debug controls.
    const element = document.createElement(node.kind === "button" ? "button" : "div");
    element.className = `unone-ui-node unone-ui-${node.kind}`;
    element.textContent = node.text;
    element.dataset.nodeId = node.id;
    if (node.kind === "button" && node.action) element.dataset.action = node.action;
    element.style.left = `${node.rect.x}%`;
    element.style.bottom = `${node.rect.y}%`;
    element.style.width = `${node.rect.width}%`;
    element.style.height = `${node.rect.height}%`;
    uiLayer.appendChild(element);
  }
}

function pressAction(action) {
  // Hold the action for one frame, the same edge a test input sequence sends.
  pendingActions.set(action, 1);
}

function inputFrameJson() {
  const actions = {};
  for (const [action, frames] of [...pendingActions]) {
    actions[action] = true;
    if (frames <= 1) pendingActions.delete(action);
    else pendingActions.set(action, frames - 1);
  }
  return JSON.stringify({ actions });
}

function resizeCanvas() {
  if (recording) return;
  const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
  const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
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

function advanceSimulation() {
  const frame = writePayload(inputFrameJson());
  if (window.Module._unone_web_set_input_frame(frame.address, frame.length) !== 0) {
    fail(new Error("input frame rejected"));
  }
  resizeCanvas();
  syncViewportAspect();
  if (window.Module._unone_web_tick() !== 0) fail(new Error("engine tick failed"));
  snapshot = readSnapshot();
  const world = snapshot.world;

  if (autoPlay) {
    const model = world.observations?.view_model;
    if (model && !model.spinning && autoCooldown <= 0) {
      pressAction("Spin");
      autoCooldown = 90;
    }
    autoCooldown -= 1;
  }

  // These consumers must see every simulation snapshot, including snapshots
  // produced during a bounded catch-up burst between two browser renders.
  syncSpineActors(world);
  syncEffects(world);
  syncAudio(world);
  return world;
}

function renderPresentation(world, steps = 0) {
  resizeCanvas();
  const gl = spineState?.context?.gl ?? effekseerState?.context?.gl;
  if (gl) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.06, 0.09, 0.16, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  drawSpine(steps / 60);
  drawEffects();
  renderUi(world);

  const model = world.observations?.view_model ?? null;
  output.textContent = JSON.stringify(
    {
      frame: world.frame,
      view_model: model,
      animation: Object.fromEntries(
        Object.entries(world.entities ?? {})
          .filter(([, entity]) => entity.animation)
          .map(([id, entity]) => [
            id,
            `${entity.animation.animation} @${entity.animation.started_frame} x${entity.animation.speed}`,
          ])
      ),
      effects: (world.effects ?? []).map((effect) => `${effect.handle} ${effect.asset}`),
      audio_events: (world.audio_events ?? []).map(
        (event) => `${event.kind} ${event.asset}${event.loop ? " (loop)" : ""}`
      ),
      audio_loops: (world.audio_loops ?? []).map(
        (source) => `${source.handle} ${source.asset} ${source.phase}`
      ),
    },
    null,
    2
  );
  statusLine.textContent = `engine frame ${world.frame} — spine actors ${spineState?.actors.size ?? 0}, effects ${world.effects?.length ?? 0}, ${audioStatus(world)}`;
}

// A manual step is intentionally kept for recording and test drivers. The
// live scheduler owns normal browser timing and calls these two phases
// independently.
function step() {
  const world = advanceSimulation();
  renderPresentation(world, 1);
}

/// Render a fixed number of engine frames at an explicit size and post each
/// captured frame to a local recorder.
///
/// A hidden browser pane starves requestAnimationFrame and throttles timers, so
/// a recording drives the loop itself. The engine is fixed-timestep, so frame N
/// is the same frame regardless of how long the wall clock took.
async function record({ frames = 180, width = 960, height = 540, every = 2, endpoint, script = [] } = {}) {
  const resumeLiveScheduler = frameScheduler?.isStarted() ?? false;
  if (resumeLiveScheduler) frameScheduler.pause();
  recording = true;
  try {
    canvas.width = width;
    canvas.height = height;
    const cues = new Map(script.map((cue) => [cue.frame, cue.action]));
    const startFrame = snapshot?.world?.frame ?? 0;
    const states = [];
    let posted = 0;
    for (let index = 0; index < frames; index += 1) {
      const action = cues.get(index);
      if (action) pressAction(action);
      step();
      if (index % every !== 0) continue;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const name = String(startFrame + index).padStart(5, "0");
      const world = snapshot.world;
      const model = world.observations?.view_model ?? {};
      states.push({
        file: `${name}.png`,
        frame: world.frame,
        message: model.message ?? "",
        credits: model.credits ?? 0,
        reels: model.reels ?? [],
        last_win: model.last_win ?? 0,
        clips: Object.entries(world.entities ?? {})
          .filter(([, entity]) => entity.animation)
          .map(([id, entity]) => `${id}:${entity.animation.animation}`),
        effects: (world.effects ?? []).map((effect) => effect.handle),
      });
      const response = await fetch(`${endpoint}/${name}.png`, { method: "POST", body: blob });
      if (!response.ok) throw new Error(`recorder rejected frame ${name}: ${response.status}`);
      posted += 1;
    }
    const stateResponse = await fetch(`${endpoint.replace(/\/frame$/, "")}/states.json`, {
      method: "POST",
      body: JSON.stringify(states),
    });
    if (!stateResponse.ok) throw new Error(`recorder rejected state sidecar: ${stateResponse.status}`);
    return { posted, endFrame: snapshot?.world?.frame ?? null };
  } finally {
    recording = false;
    if (resumeLiveScheduler) frameScheduler.resume();
  }
}

async function start() {
  try {
    if (window.Module._unone_web_init() !== 0) throw new Error("engine init failed");
    const { config, manifest } = await loadProject();
    resizeCanvas();
    spineState = await createSpine(assetByKind(manifest, "spine"));
    effekseerState = await createEffekseer(
      assetByKind(manifest, "effekseer"),
      spineState?.context?.gl ?? canvas.getContext("webgl2")
    );
    audioState = await createAudio(manifest, config);
    assets = manifest;
    // Any click counts as the gesture that unlocks playback, including the ones
    // the game's own buttons already handle.
    document.addEventListener("pointerdown", unlockAudio);
    spinButton.disabled = false;
    autoButton.disabled = false;
    spinButton.addEventListener("click", () => pressAction("Spin"));
    // The game's own buttons carry the action they mean; the host only forwards it.
    uiLayer.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;
      if (action) pressAction(action);
    });
    window.unoneHost = {
      decoderCapabilities: () => ({
        accepted_routes: { spine: DECODER_ROUTES.spine, effekseer: DECODER_ROUTES.effekseer, audio: DECODER_ROUTES.audio },
        format_versions: [],
        decode_success_requires_loading: true,
      }),
      pressAction,
      stepOnce: step,
      record,
      unlockAudio,
      // A page cannot be asked whether it is audible, so it reports what it can
      // check: which clips decoded, what the context is doing, and the gain it
      // set for each live loop.
      audioReport: () =>
        audioState === null
          ? { assets: 0 }
          : {
              assets: audioState.buffers.size,
              failures: audioState.failures,
              missing: [...audioState.missing],
              state: audioState.context.state,
              live: [...audioState.live].map(([handle, playing]) => ({
                handle,
                gain: playing.gain.gain.value,
              })),
            },
    };
    autoButton.addEventListener("click", () => {
      autoPlay = !autoPlay;
      autoCooldown = 0;
      autoButton.textContent = autoPlay ? "Auto: on" : "Auto";
    });
    frameScheduler = createFixedStepScheduler({
      tick: advanceSimulation,
      render: ({ steps }) => renderPresentation(snapshot.world, steps),
      onError: fail,
      // Hidden tabs pause deliberately. An occluded pane that remains visible
      // is protected by the scheduler's bounded watchdog fallback.
      backgroundPolicy: "pause",
    });
    frameScheduler.start();
  } catch (error) {
    fail(error);
  }
}

if (window.unoneRuntimeReady) start();
else window.addEventListener("unone-runtime-ready", start, { once: true });

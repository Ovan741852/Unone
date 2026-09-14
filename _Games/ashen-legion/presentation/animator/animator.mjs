// Browser-safe runtime. Three.js is supplied by the consumer; this module
// never imports a second copy and never owns gameplay movement or damage.

const DEFAULT_TRANSITION = 0.2;
const EPSILON = 1e-4;

export function createAnimator({ THREE, root, clips, controller = {}, mixer, onEvent } = {}) {
  if (!THREE?.AnimationMixer) throw new Error("createAnimator requires the consumer's THREE namespace.");
  if (!root) throw new Error("createAnimator requires a root Object3D.");
  const clipMap = normalizeClips(clips);
  const definition = normalizeController(controller, clipMap);
  const animationMixer = mixer ?? new THREE.AnimationMixer(root);
  const emit = typeof onEvent === "function" ? onEvent : () => {};
  const diagnostics = validateController(clipMap, definition);
  const layers = [];
  let active = null;
  let transition = null;
  let paused = false;
  let disposed = false;
  let serial = 0;

  const onFinished = (event) => {
    const layer = layers.find((candidate) => candidate.action === event.action);
    if (!layer || layer.finishedSerial === layer.serial) return;
    layer.finishedSerial = layer.serial;
    layer.finished = true;
    emit({ type: "finished", state: layer.state, clip: layer.clip.name, serial: layer.serial });
    if (active?.action === event.action && !transition) {
      const state = definition.states[layer.state];
      if (state?.finished) transitionTo(state.finished, { reason: "finished", duration: state.finishedDuration });
    }
  };
  animationMixer.addEventListener("finished", onFinished);

  function ensureLive() {
    if (disposed) throw new Error("Animator has been disposed.");
  }

  function stateDefinition(name) {
    const state = definition.states[name];
    if (!state) throw new Error(`Unknown animation state: ${name}`);
    if (!clipMap.has(state.clip)) throw new Error(`Animation state '${name}' references missing clip '${state.clip}'.`);
    return state;
  }

  function makeLayer(name, options = {}) {
    const state = stateDefinition(name);
    const clip = clipMap.get(state.clip);
    const action = animationMixer.clipAction(clip, root);
    const loop = options.loop ?? state.loop;
    action.reset();
    action.enabled = true;
    action.paused = false;
    action.clampWhenFinished = loop !== true && (options.clamp ?? state.clamp);
    action.setLoop(loop === true ? THREE.LoopRepeat : THREE.LoopOnce, loop === true ? Infinity : 1);
    action.timeScale = options.speed ?? state.speed;
    action.setEffectiveWeight(0);
    const layer = {
      state: name,
      clip,
      action,
      serial: ++serial,
      finishedSerial: null,
      finished: false,
      baseWeight: 0,
    };
    layers.push(layer);
    return layer;
  }

  function pruneLayers() {
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index];
      if (layer === active?.layer || layer === transition?.target) continue;
      if (layer.action.getEffectiveWeight() <= EPSILON) {
        layer.action.stop();
        layers.splice(index, 1);
      }
    }
    // Repeated transitions must not turn into an ever-growing action list.
    while (layers.length > 8) {
      const candidate = layers
        .filter((layer) => layer !== active?.layer && layer !== transition?.target)
        .sort((a, b) => a.action.getEffectiveWeight() - b.action.getEffectiveWeight())[0];
      if (!candidate) break;
      candidate.action.stop();
      layers.splice(layers.indexOf(candidate), 1);
    }
  }

  function transitionTo(name, options = {}) {
    ensureLive();
    const state = stateDefinition(name);
    if (active?.state === name && !options.restart) return false;
    if (active) {
      const current = definition.states[active.state];
      const incomingPriority = options.priority ?? state.priority;
      if (current && current.interruptible === false && incomingPriority < current.priority && !options.force) {
        emit({ type: "rejected", reason: "priority", source: active.state, target: name });
        return false;
      }
    }
    const target = makeLayer(name, options);
    const duration = Math.max(0, options.duration ?? state.transition ?? DEFAULT_TRANSITION);
    const sources = layers.filter((layer) => layer !== target && layer.action.getEffectiveWeight() > EPSILON);
    if (!active || duration === 0) {
      for (const source of sources) source.action.stop();
      target.action.setEffectiveWeight(1).play();
      active = { state: name, layer: target, action: target.action };
      transition = null;
      pruneLayers();
      emit({ type: "transition", source: null, target: name, duration: 0 });
      return true;
    }
    target.action.play();
    target.baseWeight = 0;
    transition = {
      source: active.state,
      target,
      sources: sources.map((layer) => ({ layer, weight: layer.action.getEffectiveWeight() })),
      duration,
      elapsed: 0,
    };
    active = { state: name, layer: target, action: target.action };
    pruneLayers();
    emit({ type: "transition", source: transition.source, target: name, duration });
    return true;
  }

  function update(dt) {
    ensureLive();
    const delta = Number(dt);
    if (!Number.isFinite(delta) || delta < 0) throw new Error("Animator update dt must be a finite non-negative number.");
    if (paused || delta === 0) return getState();
    if (transition) {
      transition.elapsed = Math.min(transition.duration, transition.elapsed + delta);
      const progress = transition.duration === 0 ? 1 : transition.elapsed / transition.duration;
      for (const source of transition.sources) source.layer.action.setEffectiveWeight(source.weight * (1 - progress));
      transition.target.action.setEffectiveWeight(progress);
      animationMixer.update(delta);
      if (progress >= 1 - EPSILON) {
        for (const source of transition.sources) source.layer.action.stop();
        transition.target.action.setEffectiveWeight(1);
        transition = null;
        pruneLayers();
      }
    } else {
      animationMixer.update(delta);
    }
    return getState();
  }

  function play(name, options = {}) {
    return transitionTo(name, options);
  }

  function pause() {
    ensureLive();
    paused = true;
    for (const layer of layers) layer.action.paused = true;
  }

  function resume() {
    ensureLive();
    paused = false;
    for (const layer of layers) layer.action.paused = false;
  }

  function restart(name = active?.state) {
    ensureLive();
    if (!name) return false;
    return transitionTo(name, { restart: true, duration: 0 });
  }

  function seek(seconds) {
    ensureLive();
    const time = Number(seconds);
    if (!Number.isFinite(time) || time < 0) throw new Error("Animator seek time must be a finite non-negative number.");
    for (const layer of layers) {
      layer.action.time = Math.min(time, layer.clip.duration);
      layer.finished = false;
      layer.finishedSerial = null;
    }
    return getState();
  }

  function seekNormalized(normalizedTime) {
    ensureLive();
    const value = Number(normalizedTime);
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Animator normalized seek must be a finite number between 0 and 1.");
    for (const layer of layers) {
      layer.action.time = layer.clip.duration * value;
      layer.finished = false;
      layer.finishedSerial = null;
    }
    return getState();
  }

  function setSpeed(speed) {
    ensureLive();
    const value = Number(speed);
    if (!Number.isFinite(value) || value < 0) throw new Error("Animator speed must be a finite non-negative number.");
    for (const layer of layers) layer.action.timeScale = value;
  }

  function getState() {
    const layer = active?.layer;
    const clip = layer?.clip;
    const time = layer ? Math.min(layer.action.time, clip.duration) : 0;
    return {
      state: active?.state ?? null,
      clip: clip?.name ?? null,
      time,
      duration: clip?.duration ?? 0,
      normalizedTime: clip?.duration ? time / clip.duration : 0,
      speed: layer?.action.timeScale ?? 0,
      loop: layer ? definition.states[layer.state].loop : false,
      playing: Boolean(layer && !layer.action.paused && !layer.finished && !paused),
      finished: Boolean(layer?.finished),
      paused,
      transition: transition
        ? {
            source: transition.source,
            target: transition.target.state,
            progress: transition.duration === 0 ? 1 : transition.elapsed / transition.duration,
            duration: transition.duration,
          }
        : null,
      active_action_count: layers.length,
    };
  }

  function getDiagnostics() {
    return diagnostics.map((entry) => ({ ...entry }));
  }

  function dispose() {
    if (disposed) return;
    animationMixer.removeEventListener("finished", onFinished);
    for (const layer of layers) layer.action.stop();
    animationMixer.stopAllAction();
    layers.length = 0;
    active = null;
    transition = null;
    disposed = true;
  }

  if (definition.initial) transitionTo(definition.initial, { duration: 0 });
  return {
    play,
    transition: transitionTo,
    pause,
    resume,
    restart,
    seek,
    seekNormalized,
    setSpeed,
    update,
    getState,
    getDiagnostics,
    dispose,
    get mixer() { return animationMixer; },
  };
}

export function normalizeController(controller = {}, clips = new Map()) {
  const rawStates = controller.states && typeof controller.states === "object" ? controller.states : {};
  const states = {};
  for (const [name, raw] of Object.entries(rawStates)) {
    const state = typeof raw === "string" ? { clip: raw } : (raw ?? {});
    states[name] = {
      clip: String(state.clip ?? name),
      loop: state.loop !== false,
      clamp: state.clamp !== false,
      speed: Number.isFinite(state.speed) ? state.speed : 1,
      transition: Number.isFinite(state.transition) ? state.transition : DEFAULT_TRANSITION,
      priority: Number.isFinite(state.priority) ? state.priority : 0,
      interruptible: state.interruptible !== false,
      finished: typeof state.finished === "string" ? state.finished : null,
      finishedDuration: Number.isFinite(state.finishedDuration) ? state.finishedDuration : undefined,
    };
  }
  if (Object.keys(states).length === 0) {
    for (const name of clips.keys()) states[name] = { clip: name, loop: true, clamp: false, speed: 1, transition: DEFAULT_TRANSITION, priority: 0, interruptible: true, finished: null };
  }
  return { initial: typeof controller.initial === "string" ? controller.initial : Object.keys(states)[0] ?? null, states };
}

export function validateController(clips, controller) {
  const issues = [];
  if (!(clips instanceof Map)) return [{ code: "CLIPS_INVALID", path: "/clips", message: "clips must be a Map or an array/object accepted by normalizeClips" }];
  const states = controller?.states ?? {};
  for (const [name, state] of Object.entries(states)) {
    if (!clips.has(state.clip)) issues.push({ code: "CLIP_MISSING", path: `/states/${escapeJsonPointer(name)}/clip`, message: `State '${name}' references missing clip '${state.clip}'.` });
    if (!Number.isFinite(state.transition) || state.transition < 0) issues.push({ code: "TRANSITION_INVALID", path: `/states/${escapeJsonPointer(name)}/transition`, message: "Transition must be a finite non-negative number." });
    if (!Number.isFinite(state.speed) || state.speed < 0) issues.push({ code: "SPEED_INVALID", path: `/states/${escapeJsonPointer(name)}/speed`, message: "Speed must be a finite non-negative number." });
    if (state.finished && !states[state.finished]) issues.push({ code: "STATE_TARGET_MISSING", path: `/states/${escapeJsonPointer(name)}/finished`, message: `Finished target '${state.finished}' does not exist.` });
  }
  if (controller?.initial && !states[controller.initial]) issues.push({ code: "INITIAL_STATE_MISSING", path: "/initial", message: `Initial state '${controller.initial}' does not exist.` });
  return issues;
}

function normalizeClips(clips) {
  if (clips instanceof Map) return clips;
  if (Array.isArray(clips)) return new Map(clips.filter((clip) => clip?.name).map((clip) => [clip.name, clip]));
  return new Map(Object.entries(clips ?? {}).filter(([, clip]) => clip));
}

function escapeJsonPointer(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

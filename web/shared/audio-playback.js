function audioError(message) {
  return message instanceof Error ? message.message : String(message);
}

function bytesAsArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return value;
}

function unavailableState(declared, reason) {
  return {
    available: false,
    declared,
    buffers: new Map(),
    live: new Map(),
    failures: reason ? [reason] : [],
    missing: new Set(),
    sync() {},
    unlock() { return Promise.resolve(false); },
    setVisibility() {},
    dispose() {},
    report() {
      return {
        available: false,
        assets: 0,
        declared_assets: declared.length,
        failures: [...this.failures],
        missing: [...this.missing],
        state: "unavailable",
        live: [],
      };
    },
  };
}

/**
 * Decode and play the audio decisions published by the engine.
 *
 * This is deliberately a Web-host concern. Rust/Luau publishes one-shot
 * events, looping-source state, fade phase and mixer levels; this module only
 * maps those values to Web Audio nodes. `loadAssetBytes` lets a runner resolve
 * content-addressed bundle assets without making the engine know URL layout.
 */
export async function createAudioPlayback({
  assetManifest = null,
  config = null,
  loadAssetBytes = null,
  projectRoot = null,
  fetchImpl = globalThis.fetch,
  audioContextFactory = null,
} = {}) {
  const declared = (assetManifest?.assets ?? []).filter((asset) => asset?.kind === "audio");
  if (declared.length === 0) return null;

  const contextFactory = audioContextFactory
    ?? (globalThis.AudioContext
      ? () => new globalThis.AudioContext()
      : globalThis.webkitAudioContext
        ? () => new globalThis.webkitAudioContext()
        : null);
  if (!contextFactory) {
    return unavailableState(declared, "AudioContext is unavailable in this browser");
  }

  let context;
  let master;
  try {
    context = await contextFactory();
    master = context.createGain();
    master.connect(context.destination);
  } catch (error) {
    return unavailableState(declared, `AudioContext setup failed: ${audioError(error)}`);
  }

  const declaredLevels = Object.fromEntries(
    Object.entries(config?.audio?.categories ?? {}).map(([name, rules]) => [name, rules?.volume ?? 1])
  );
  const buffers = new Map();
  const decoded = await Promise.all(declared.map(async (asset) => {
    try {
      let bytes;
      if (loadAssetBytes) {
        bytes = await loadAssetBytes(asset);
      } else {
        if (typeof fetchImpl !== "function" || !projectRoot) throw new Error("no audio asset loader is configured");
        const response = await fetchImpl(new URL(asset.source, projectRoot), { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      const buffer = await context.decodeAudioData(bytesAsArrayBuffer(bytes));
      return { asset, buffer, error: null };
    } catch (error) {
      return { asset, buffer: null, error: audioError(error) };
    }
  }));
  const failures = [];
  for (const result of decoded) {
    if (result.buffer) buffers.set(result.asset.id, result.buffer);
    else failures.push(`${result.asset.id}: ${result.error}`);
  }

  const state = {
    available: true,
    context,
    master,
    declared,
    declaredLevels,
    buffers,
    live: new Map(),
    failures,
    missing: new Set(),
    runtimeFailures: [],
    processedEvents: new Set(),
    processedEventFrame: null,
    lastWorld: null,
  };

  function bufferFor(assetId) {
    const buffer = state.buffers.get(assetId);
    if (buffer) return buffer;
    if (!state.missing.has(assetId)) state.missing.add(assetId);
    return null;
  }

  function recordRuntimeFailure(message) {
    if (!state.runtimeFailures.includes(message)) state.runtimeFailures.push(message);
  }

  function contextUsable() {
    return state.context.state !== "closed";
  }

  state.sync = (world = {}) => {
    state.lastWorld = world;
    if (!contextUsable()) return;
    const contextValue = state.context;

    // `audio_events` are frame-scoped. Keep duplicate protection for repeated
    // publication of the current snapshot (for example when unlocking the
    // browser audio context), but do not retain one key per frame forever.
    const frame = world.frame ?? null;
    if (state.processedEventFrame !== frame) {
      state.processedEvents.clear();
      state.processedEventFrame = frame;
    }

    for (const [index, event] of (world.audio_events ?? []).entries()) {
      if (event.kind !== "play" || (event.loop ?? event.looping)) continue;
      const eventKey = `${event.frame ?? world.frame ?? 0}:${index}:${event.handle ?? ""}:${event.asset ?? ""}`;
      if (state.processedEvents.has(eventKey)) continue;
      state.processedEvents.add(eventKey);
      const buffer = bufferFor(event.asset);
      if (!buffer) continue;
      try {
        const node = contextValue.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = event.speed ?? 1;
        const gain = contextValue.createGain();
        gain.gain.value = (event.volume ?? 1) * audioBusGain(world, event.category, state.declaredLevels);
        node.connect(gain).connect(state.master);
        node.start();
      } catch (error) {
        recordRuntimeFailure(`one-shot ${event.asset}: ${audioError(error)}`);
      }
    }

    const live = new Map((world.audio_loops ?? []).map((source) => [source.handle, source]));
    for (const [handle, playing] of [...state.live]) {
      if (live.has(handle)) continue;
      try { playing.node.stop(); } catch (_error) { /* already stopped */ }
      state.live.delete(handle);
    }
    for (const [handle, source] of live) {
      let playing = state.live.get(handle);
      if (!playing) {
        const buffer = bufferFor(source.asset);
        if (!buffer) continue;
        try {
          const node = contextValue.createBufferSource();
          node.buffer = buffer;
          node.loop = true;
          node.playbackRate.value = source.speed ?? 1;
          const gain = contextValue.createGain();
          node.connect(gain).connect(state.master);
          node.start();
          playing = { node, gain };
          state.live.set(handle, playing);
        } catch (error) {
          recordRuntimeFailure(`loop ${source.asset}: ${audioError(error)}`);
          continue;
        }
      } else if (playing.node.playbackRate) {
        playing.node.playbackRate.value = source.speed ?? 1;
      }
      playing.gain.gain.value = audioLoopGain(world, source, state.declaredLevels);
    }
  };

  state.unlock = async () => {
    if (state.context.state !== "suspended") return state.context.state === "running";
    try {
      await state.context.resume();
      if (state.lastWorld) state.sync(state.lastWorld);
      return state.context.state === "running";
    } catch (error) {
      recordRuntimeFailure(`AudioContext resume failed: ${audioError(error)}`);
      return false;
    }
  };

  state.setVisibility = (visible) => {
    if (!contextUsable()) return;
    if (visible) {
      if (state.context.state === "suspended") state.context.resume().catch((error) => recordRuntimeFailure(`AudioContext resume failed: ${audioError(error)}`));
    } else if (state.context.state === "running") {
      state.context.suspend?.().catch((error) => recordRuntimeFailure(`AudioContext suspend failed: ${audioError(error)}`));
    }
  };

  state.dispose = () => {
    for (const playing of state.live.values()) {
      try { playing.node.stop(); } catch (_error) { /* already stopped */ }
    }
    state.live.clear();
    state.master.disconnect?.();
    state.context.close?.();
  };

  state.report = () => ({
    available: true,
    assets: state.buffers.size,
    declared_assets: state.declared.length,
    failures: [...state.failures, ...state.runtimeFailures],
    missing: [...state.missing].sort(),
    state: state.context.state,
    live: [...state.live].map(([handle, playing]) => ({
      handle,
      gain: playing.gain.gain.value,
    })),
  });
  return state;
}

export function audioBusGain(world = {}, category, declaredLevels = {}) {
  const mix = world.audio_mix ?? null;
  const master = mix?.master ?? 1;
  if (!category) return master;
  return master * (mix?.categories?.[category] ?? declaredLevels[category] ?? 1);
}

export function audioLoopGain(world = {}, source = {}, declaredLevels = {}) {
  if (source.paused) return 0;
  const bus = (source.volume ?? 1) * audioBusGain(world, source.category, declaredLevels);
  if (!source.phase_frames) return bus;
  const elapsed = Math.min(
    Math.max((world.frame ?? 0) - (source.phase_started_frame ?? 0), 0),
    source.phase_frames,
  );
  const progress = elapsed / source.phase_frames;
  if (source.phase === "fading_in") return bus * progress;
  if (source.phase === "fading_out") return bus * (1 - progress);
  return bus;
}

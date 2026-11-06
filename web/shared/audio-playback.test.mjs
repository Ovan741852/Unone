import assert from "node:assert/strict";
import test from "node:test";
import { createAudioPlayback } from "./audio-playback.js";

function fakeContext() {
  const log = [];
  const param = (value = 0) => ({ value });
  const context = {
    state: "running",
    destination: {},
    log,
    createGain: () => ({ gain: param(1), connect(next) { return next; } }),
    createStereoPanner: () => {
      const panner = { pan: param(0), connect(next) { return next; } };
      log.push({ made: "panner", panner });
      return panner;
    },
    createBufferSource: () => {
      const node = {
        playbackRate: param(1),
        loop: false,
        buffer: null,
        connect(next) { return next; },
        start() { log.push({ started: node }); },
        stop() { log.push({ stopped: node }); },
      };
      return node;
    },
    decodeAudioData: async (bytes) => ({ decoded: bytes.byteLength }),
  };
  return context;
}

const wav = { format: "wav", mime: "audio/wav", decoder: "audio" };

async function playback(assets, loads = []) {
  const context = fakeContext();
  const state = await createAudioPlayback({
    assetManifest: { assets },
    audioContextFactory: () => context,
    loadAssetBytes: async (asset) => {
      loads.push(asset.id);
      return new Uint8Array(4);
    },
  });
  return { state, context };
}

const started = (context) => context.log.filter((entry) => entry.started).map((entry) => entry.started);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an on-demand asset is not decoded until something plays it", async () => {
  const loads = [];
  const { state, context } = await playback([
    { id: "a", kind: "audio", source: "a.wav", encoding: wav },
    { id: "b", kind: "audio", source: "b.wav", encoding: { ...wav, on_demand: true } },
  ], loads);
  assert.deepEqual(loads, ["a"]);
  state.sync({ frame: 1, audio_events: [{ kind: "play", asset: "b", handle: "h1", volume: 1, speed: 1 }] });
  assert.equal(started(context).length, 0);
  await settle();
  assert.deepEqual(loads, ["a", "b"]);
  assert.equal(started(context).length, 1, "the one-shot that asked waits for its decode");
  assert.deepEqual(state.report().missing, []);
});

test("a voice plays once, follows pan and volume, and stops with its handle", async () => {
  const { state, context } = await playback([{ id: "a", kind: "audio", source: "a.wav", encoding: wav }]);
  const voice = { handle: "v", asset: "a", volume: 0.5, speed: 1, pan: -0.5, once: true, phase: "playing" };
  state.sync({ frame: 1, audio_loops: [voice] });
  const [node] = started(context);
  assert.equal(node.loop, false);
  const playing = state.live.get("v");
  assert.equal(playing.panner.pan.value, -0.5);
  assert.equal(playing.gain.gain.value, 0.5);
  state.sync({ frame: 2, audio_loops: [{ ...voice, pan: 0.25, volume: 0.1 }] });
  assert.equal(playing.panner.pan.value, 0.25);
  assert.equal(playing.gain.gain.value, 0.1);
  state.sync({ frame: 3, audio_loops: [] });
  assert.ok(context.log.some((entry) => entry.stopped === node));
});

test("a loop still loops and an on-demand voice starts when decoded", async () => {
  const { state, context } = await playback([
    { id: "a", kind: "audio", source: "a.wav", encoding: { ...wav, on_demand: true } },
  ]);
  const loop = { handle: "l", asset: "a", volume: 1, speed: 1, phase: "playing" };
  state.sync({ frame: 1, audio_loops: [loop] });
  assert.equal(started(context).length, 0);
  await settle();
  state.sync({ frame: 2, audio_loops: [loop] });
  const [node] = started(context);
  assert.equal(node.loop, true);
});

test("a browser without a panner still plays", async () => {
  const context = fakeContext();
  delete context.createStereoPanner;
  const state = await createAudioPlayback({
    assetManifest: { assets: [{ id: "a", kind: "audio", source: "a.wav", encoding: wav }] },
    audioContextFactory: () => context,
    loadAssetBytes: async () => new Uint8Array(4),
  });
  state.sync({ frame: 1, audio_events: [{ kind: "play", asset: "a", handle: "h", pan: 1 }] });
  assert.equal(started(context).length, 1);
});

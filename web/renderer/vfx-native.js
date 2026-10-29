// Presentation-only bridge to ParticleDefinition::sample. It owns a separate
// WASM instance and never loads a project, advances a game or reads a save.
const MAX_REQUEST_BYTES = 65536;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const exports = ['particle_alloc', 'particle_sample', 'particle_output_ptr', 'particle_output_len'];

export function createVfxParticleSampler(module, {dispose = () => {}} = {}) {
  for (const name of exports) {
    if (typeof module?.['_unone_web_' + name] !== 'function') {
      throw Error('PARTICLE_SAMPLER_ABI_UNAVAILABLE: rebuild the particle runtime');
    }
  }
  let active = module;
  return {
    sample(definition, {seed = 0, frame = 0, position = [0, 0, 0]} = {}) {
      if (!active) throw Error('PARTICLE_SAMPLER_DISPOSED');
      if (!Number.isSafeInteger(seed) || seed < 0 || !Number.isSafeInteger(frame) || frame < 0) {
        throw Error('PARTICLE_REQUEST_INVALID: seed and frame must be safe nonnegative integers');
      }
      if (!Array.isArray(position) || position.length !== 3 || !position.every(x => Number.isFinite(x) && Math.abs(x) <= 1e9)) {
        throw Error('PARTICLE_REQUEST_INVALID: position requires three finite coordinates within +/- 1e9');
      }
      const bytes = encoder.encode(JSON.stringify({definition, seed, frame, position}, (_key, value) => {
        if (typeof value === 'number' && !Number.isFinite(value)) throw Error('PARTICLE_REQUEST_INVALID: all numbers must be finite');
        return value;
      }));
      if (bytes.length > MAX_REQUEST_BYTES) throw Error('PARTICLE_REQUEST_INVALID: maximum 65536 bytes');
      const pointer = active._unone_web_particle_alloc(bytes.length);
      if (!pointer) throw Error('PARTICLE_REQUEST_INVALID: allocation rejected');
      active.HEAPU8.set(bytes, pointer);
      const status = active._unone_web_particle_sample(pointer, bytes.length);
      // Sampling may grow WASM memory. Read the current view after the call.
      const start = active._unone_web_particle_output_ptr();
      const length = active._unone_web_particle_output_len();
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > active.HEAPU8.length) {
        throw Error('PARTICLE_SAMPLE_FAILED: invalid response memory');
      }
      const response = JSON.parse(decoder.decode(active.HEAPU8.subarray(start, start + length)));
      if (status !== 0 || response.ok !== true || !Array.isArray(response.particles)) {
        throw Error(response.error ?? 'PARTICLE_SAMPLE_FAILED');
      }
      return response.particles;
    },
    dispose() {
      if (!active) return;
      active = null;
      dispose();
    },
  };
}

const hexBytes = hex => Uint8Array.from(hex.match(/../g), byte => parseInt(byte, 16));
const base64 = bytes => btoa(String.fromCharCode(...bytes));
async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`PARTICLE_RUNTIME_LOAD_FAILED: ${url} (${response.status})`);
  return response;
}

export async function loadVfxParticleSampler(baseUrl) {
  const base = new URL(baseUrl, globalThis.location?.href);
  const manifest = await (await fetchOk(new URL('runtime.json', base))).json();
  for (const [name, extension] of [['javascript', 'js'], ['wasm', 'wasm']]) {
    if (typeof manifest[name] !== 'string' || !new RegExp(`^[A-Za-z0-9_-][A-Za-z0-9_.-]*\\.${extension}$`).test(manifest[name]) || !/^[a-f0-9]{64}$/.test(manifest[name + '_sha256'])) {
      throw Error('PARTICLE_RUNTIME_INVALID: filenames and SHA-256 hashes are required');
    }
  }
  if (!manifest.compiled_systems?.includes('particle') || exports.some(name => !manifest.exports?.includes(name))) {
    throw Error('PARTICLE_SAMPLER_ABI_UNAVAILABLE: rebuild the particle runtime');
  }
  const version = `${manifest.wasm_sha256}-${manifest.javascript_sha256}/`;
  const runtimeBase = new URL(version, base);
  const scriptUrl = new URL(manifest.javascript, runtimeBase);
  const wasm = new Uint8Array(await (await fetchOk(new URL(manifest.wasm, runtimeBase))).arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', wasm));
  const expectedDigest = hexBytes(manifest.wasm_sha256);
  if (digest.some((byte, i) => byte !== expectedDigest[i])) throw Error('PARTICLE_RUNTIME_HASH_MISMATCH');
  if (!globalThis.document?.createElement) throw Error('PARTICLE_RUNTIME_LOAD_FAILED: browser document required');

  // Classic Emscripten glue assigns a global Module. Keep it in its own realm
  // so a sampler can coexist with the official gameplay player and be disposed.
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Unone particle sampler';
  document.documentElement.append(frame);
  try {
    const module = await new Promise((resolve, reject) => {
      const realm = frame.contentWindow;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        realm.removeEventListener('error', runtimeError);
        if (error) reject(error); else resolve(value);
      };
      const runtimeError = event => finish(Error('PARTICLE_RUNTIME_LOAD_FAILED: ' + event.message));
      const timeout = setTimeout(() => finish(Error('PARTICLE_RUNTIME_LOAD_TIMEOUT')), 30000);
      realm.addEventListener('error', runtimeError);
      realm.Module = {
        noInitialRun: true,
        wasmBinary: wasm,
        locateFile: path => new URL(path, runtimeBase).href,
        onRuntimeInitialized() { finish(null, realm.Module); },
        onAbort(error) { finish(Error('PARTICLE_RUNTIME_LOAD_FAILED: ' + error)); },
        printErr: (...args) => console.error(...args),
      };
      const script = realm.document.createElement('script');
      script.src = scriptUrl.href;
      script.integrity = 'sha256-' + base64(hexBytes(manifest.javascript_sha256));
      script.crossOrigin = 'anonymous';
      script.onerror = () => finish(Error('PARTICLE_RUNTIME_LOAD_FAILED: ' + scriptUrl));
      realm.document.head.append(script);
    });
    return createVfxParticleSampler(module, {dispose: () => frame.remove()});
  } catch (error) {
    frame.remove();
    throw error;
  }
}

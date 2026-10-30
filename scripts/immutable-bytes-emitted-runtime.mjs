// Shared production provenance and emitted-VM initialization for the functional
// gate and the separate operation-cost diagnostic. No replacement Lua API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

export function within(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function readPinnedRuntime({directory, expected, pinned}) {
  const runtime = fs.realpathSync(path.resolve(directory));
  const metadataBytes = pinned(path.join(runtime, 'runtime.json'), expected.manifest, 'runtime_manifest');
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  assert.equal(metadata.source_commit, expected.source);
  assert.equal(metadata.source_dirty, false, 'Use a clean, explicitly pinned source build');
  assert.equal(metadata.profile, 'release');
  assert.equal(metadata.bytecode_optimization_level, 2);
  for (const flag of ['dev_tools', 'preview_tools', 'phase_profile', 'sampling_profile']) assert.equal(metadata[flag], false, flag);
  function file(name) {
    assert(typeof name === 'string' && name && !path.isAbsolute(name), 'Invalid runtime filename');
    const resolved = fs.realpathSync(path.resolve(runtime, name));
    assert(within(runtime, resolved), 'Runtime filename escapes its directory');
    return resolved;
  }
  const javascriptFile = file(metadata.javascript), wasmFile = file(metadata.wasm);
  const javascript = pinned(javascriptFile, expected.javascript, 'javascript');
  const wasm = pinned(wasmFile, expected.wasm, 'wasm');
  assert.equal(metadata.javascript_sha256, expected.javascript);
  assert.equal(metadata.wasm_sha256, expected.wasm);
  assert(![
    '7510d5016b72fe8d31947caf9097c2c3b2f72df7e0a6176a3ec78f506092503c',
    '28df55e68e5716bbde46df97fd96c70129f50842f7da5f9fa65c58eaf02a1ba6',
  ].includes(expected.wasm), 'Selected Core predates bounded immutable spans');
  const exported = new Set(WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(entry => entry.name));
  const required = ['alloc', 'load_project', 'unload_project', 'set_input_frame', 'tick', 'observation_ptr', 'observation_len'];
  for (const name of required) assert(exported.has(`unone_web_${name}`), `Actual WASM lacks ${name}`);
  assert(!exported.has('unone_web_developer_request'), 'Developer ABI in production gate');
  return {runtime, metadata, metadataBytes, javascriptFile, javascript, wasmFile, wasm, required};
}

export async function instantiateEmittedRuntime({javascriptFile, javascript, wasm, timeoutMs, diagnostics}) {
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      const options = {wasmBinary: new Uint8Array(wasm), noInitialRun: true, print() {},
        printErr(value) {
          if (diagnostics.stderr.length < 512) diagnostics.stderr.push(String(value));
          else diagnostics.stderr_overflow++;
        },
        onAbort(value) {diagnostics.aborts.push(String(value)); reject(new Error(`WASM_ABORT: ${value}`));}};
      const context = {Module: options, crypto: webcrypto, window: {},
        document: {currentScript: {src: pathToFileURL(javascriptFile).href}},
        location: {href: pathToFileURL(javascriptFile).href}, console,
        TextDecoder, TextEncoder, WebAssembly, setTimeout, clearTimeout, performance};
      options.onRuntimeInitialized = () => resolve(context.Module);
      timer = setTimeout(() => reject(new Error('WASM_INIT_TIMEOUT')), timeoutMs);
      vm.runInNewContext(javascript.toString('utf8'), context, {filename: javascriptFile, timeout: timeoutMs});
    });
  } finally {clearTimeout(timer);}
}

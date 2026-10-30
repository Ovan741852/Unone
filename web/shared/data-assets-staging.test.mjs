import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProject, stageDataAssets} from './load-project.js';

// A module double with the ABI the core exports: one shared input buffer for
// ids, one reserved region per staged asset, consumed by the next load.
function core({stage = true} = {}) {
  const heap = new Uint8Array(4096);
  const decoder = new TextDecoder();
  let input = 0, next = 1024;
  const staged = new Map(), loads = [];
  const observation = new TextEncoder().encode('{"ok":true}');
  heap.set(observation, 0);
  const module = {
    HEAPU8: heap,
    _unone_web_alloc: length => (input = 512, length > 0 ? input : input),
    _unone_web_load_project: () => { loads.push(new Map(staged)); staged.clear(); return 0; },
    _unone_web_observation_ptr: () => 0,
    _unone_web_observation_len: () => observation.length,
  };
  if (stage) module._unone_web_stage_data = (idLength, length) => {
    const id = decoder.decode(heap.subarray(input, input + idLength));
    const at = next; next += length;
    staged.set(id, () => [...heap.subarray(at, at + length)]);
    return at;
  };
  return {module, loads};
}

test('data assets are staged by id beside the JSON payload and consumed by the load', () => {
  const {module, loads} = core();
  loadProject(module, {config: {}}, 42n, [
    {id: 'data://rom', bytes: new Uint8Array([1, 2, 3])},
    {id: 'data://見る', bytes: new Uint8Array([9]).buffer},
  ]);
  assert.equal(loads.length, 1);
  assert.deepEqual([...loads[0].keys()], ['data://rom', 'data://見る']);
  assert.deepEqual(loads[0].get('data://rom')(), [1, 2, 3]);
  assert.deepEqual(loads[0].get('data://見る')(), [9]);
});

test('a runtime without the staging export rejects data instead of dropping it', () => {
  const {module} = core({stage: false});
  assert.throws(() => stageDataAssets(module, [{id: 'data://a', bytes: new Uint8Array(1)}]), /RUNTIME_DATA_ASSETS_UNSUPPORTED/);
  assert.doesNotThrow(() => stageDataAssets(module, []));
});

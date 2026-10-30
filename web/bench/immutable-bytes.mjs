// Immutable bytes checks and read-cost cases shared by the Node gate
// (scripts/verify-immutable-bytes-wasm.mjs) and the browser page
// (web/bench/immutable-bytes.html). Native runs the same Luau through
// crates/unone-engine/tests/immutable_bytes.rs and bytes_perf.rs.
const SETUP = `
local N = 65536
local data = buffer.create(N * 4)
for i = 0, N - 1 do buffer.writeu32(data, i * 4, (i * 2654435761) % 4294967296) end
local text = buffer.tostring(data)
`;
const READS = 65536;

const payload = script => ({config: {name: 'immutable-bytes', entry_script: 'main.luau'}, script, scene: null});
const observationsOf = result => result?.world?.observations ?? result?.value?.world?.observations;
function expect(condition, message) { if (!condition) throw new Error(`IMMUTABLE_BYTES_CHECK_FAILED: ${message}`); }

/** Run the shared fixture and require the same observations as native. */
export function verifyFixture({module, loadProject}, fixture) {
  const observed = observationsOf(loadProject(module, payload(fixture)));
  expect(observed, 'fixture published no observations');
  expect(observed.rejected_writes === 14, `rejected_writes ${observed.rejected_writes}`);
  expect(observed.frozen_value === 0xDEADBEEF && observed.copied_value === 0xDEADBEEF, 'frozen read or copy');
  expect(observed.snapshot_whole === 42 && observed.snapshot_tail === 42, 'snapshot aliased its source');
  expect(observed.rejected_ranges === 3 && observed.rejected_types === 3, 'argument checks');
  expect(observed.frozen_input_index >= 0, 'engine API rejected frozen input');
  return observed;
}

/**
 * Mean ns per u32 read over a batch of ticks, median across rounds, minus an
 * empty loop. One discarded pass comes first and the rounds interleave the
 * cases, so no case is measured only while the engine is still tiering up.
 */
export function measureReads({module, loadProject, readObservation, now}, populous, {ticks = 40, rounds = 3} = {}) {
  const input = new TextEncoder().encode(JSON.stringify({actions: {}}));
  const tick = () => {
    const address = module._unone_web_alloc(input.length);
    module.HEAPU8.set(input, address);
    if (module._unone_web_set_input_frame(address, input.length) !== 0 || module._unone_web_tick() !== 0) {
      throw new Error(`WASM_TICK_FAILED: ${JSON.stringify(readObservation(module))}`);
    }
  };
  const tickMs = (setup, body) => {
    loadProject(module, payload(`${SETUP}\n${setup}\nreturn {start=function(api) end, update=function(api)\n local s = 0\n ${body}\n api.observation.set('sum', s)\nend}`));
    for (let i = 0; i < 3; i++) tick();
    // Time the whole batch: browsers coarsen performance.now() to ~100 us
    // outside cross-origin isolation, which is several ns per read per tick.
    const started = now();
    for (let i = 0; i < ticks; i++) tick();
    return (now() - started) / ticks;
  };
  const cases = [
    ['empty loop', '', 'for i = 0, N - 1 do s += i end'],
    ['buffer.readu32', '', 'for i = 0, N - 1 do s += buffer.readu32(data, i * 4) end'],
    ['frozen buffer.readu32', 'local frozen', 'frozen = frozen or api.bytes.snapshot(data)\n for i = 0, N - 1 do s += buffer.readu32(frozen, i * 4) end'],
    ['buffer.writeu32 (writable)', '', 'for i = 0, N - 1 do buffer.writeu32(data, i * 4, i) end'],
    ['string.byte x4', '', 'for i = 0, N - 1 do local a, b, c, d = string.byte(text, i * 4 + 1, i * 4 + 4); s += a + b * 256 + c * 65536 + d * 16777216 end'],
    ['string.unpack <I4', '', "for i = 0, N - 1 do s += string.unpack('<I4', text, i * 4 + 1) end"],
    ['populous readonly_bytes.u32', populous, 'for i = 0, N - 1 do s += R.u32(value, i * 4) end'],
  ];
  for (const [, setup, body] of cases) tickMs(setup, body);
  const runs = Object.fromEntries(cases.map(([name]) => [name, []]));
  for (let round = 0; round < rounds; round++) {
    for (const [name, setup, body] of cases) runs[name].push(tickMs(setup, body));
  }
  const empty = median(runs['empty loop']);
  const ns = {};
  for (const [name] of cases.slice(1)) ns[name] = round2(((median(runs[name]) - empty) * 1e6) / READS);
  const plain = ns['buffer.readu32'], frozen = ns['frozen buffer.readu32'];
  // Frozen reads take the same VM path as plain reads; allow timer noise only.
  expect(frozen <= plain * 1.5 + 1, `frozen reads regressed: ${frozen} vs ${plain} ns`);
  return {empty_loop_ns: round2((empty * 1e6) / READS), ns_per_read: ns};
}

function median(values) { return [...values].sort((a, b) => a - b)[values.length >> 1]; }
function round2(value) { return Number(value.toFixed(2)); }

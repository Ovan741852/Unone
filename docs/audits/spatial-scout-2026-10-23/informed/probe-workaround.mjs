import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// WORKAROUND VARIANT: the original probe and capture remain unchanged.
// Directly publishing spatial.info() faults observation serialization because
// limits.safe_integer is outside its portable integer range. The inline Luau
// below converts exactly that field to a string for observation only.
// The only preexisting files explicitly read are this module, its identity
// descriptor and the named executable. All project fixtures below are inline.
// Projects are retained under a newly allocated OS temp directory for inspection.
const started = performance.now();
const MAX_EVENT_BYTES = 190 * 1024;
const DEADLINE_MS = 50000;
let emittedBytes = 0;
let tempRoot;
let finalIdentity;
const failures = [];
const here = path.dirname(fileURLToPath(import.meta.url));
const identityPath = path.join(here, 'binary.json');
const identity = JSON.parse(await fsp.readFile(identityPath, 'utf8'));

function emit(event) {
  const line = JSON.stringify(event) + '\n';
  emittedBytes += Buffer.byteLength(line);
  if (emittedBytes > MAX_EVENT_BYTES) throw new Error('Probe event budget exceeded');
  process.stdout.write(line);
}
function check(condition, label, detail) {
  if (!condition) failures.push({label, detail});
  emit({event: 'check', label, pass: !!condition, detail});
}
async function binaryIdentity() {
  const stat = await fsp.stat(identity.path);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(identity.path)) hash.update(chunk);
  return {path: identity.path, bytes: stat.size, sha256: hash.digest('hex')};
}
function cli(label, args, selector = x => x) {
  const remaining = DEADLINE_MS - (performance.now() - started);
  if (remaining < 1000) throw new Error('Probe deadline exhausted');
  const t = performance.now();
  const result = spawnSync(identity.path, args, {
    cwd: tempRoot,
    encoding: 'utf8',
    timeout: Math.min(8000, Math.floor(remaining)),
    maxBuffer: 96 * 1024,
    windowsHide: true,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  let parsed;
  let parse_error;
  if (args.includes('--json')) {
    try { parsed = JSON.parse(stdout); }
    catch (error) { parse_error = String(error); }
  }
  emit({
    event: 'cli', label, executable: identity.path, args, cwd: tempRoot,
    elapsed_ms: Math.round((performance.now() - t) * 1000) / 1000,
    status: result.status, signal: result.signal,
    spawn_error: result.error ? String(result.error) : undefined,
    stdout_bytes: Buffer.byteLength(stdout), stderr_bytes: Buffer.byteLength(stderr),
    parsed: parsed === undefined ? undefined : selector(parsed),
    stdout: parsed === undefined ? stdout : undefined,
    stderr: stderr || undefined,
    parse_error,
  });
  return {status: result.status, parsed, stdout, stderr};
}
function findValues(value, key, out = []) {
  if (!value || typeof value !== 'object') return out;
  for (const [name, child] of Object.entries(value)) {
    if (name === key) out.push(child);
    findValues(child, key, out);
  }
  return out;
}
function reportObservation(result, name) {
  return findValues(result.parsed, name)[0];
}
async function makeProject(name, script) {
  const directory = path.join(tempRoot, name);
  await fsp.mkdir(path.join(directory, 'scripts'), {recursive: true});
  const project = {name: `spatial-scout-${name}`, entry_script: 'scripts/main.luau', main_scene: 'scene.json'};
  const scene = {entities: [{id: 'unrelated', name: 'Unrelated synthetic entity', transform: {x: 123, y: 456}}]};
  await fsp.writeFile(path.join(directory, 'project.unone.json'), JSON.stringify(project));
  await fsp.writeFile(path.join(directory, 'scene.json'), JSON.stringify(scene));
  await fsp.writeFile(path.join(directory, 'scripts/main.luau'), script);
  emit({event: 'synthetic_project', name, path: directory, inline_fixtures: true,
    files: ['project.unone.json', 'scene.json', 'scripts/main.luau'],
    script_sha256: crypto.createHash('sha256').update(script).digest('hex')});
  return directory;
}

const representative = String.raw`
local function portableInfo(api)
  local info = api.spatial.info()
  if info.limits and info.limits.safe_integer ~= nil then
    info.limits.safe_integer = tostring(info.limits.safe_integer)
  end
  return info
end
local index, packedIndex, ticket, packedTicket, canceledTicket
local tick = 0
local report = {negative_diagnostics={}}
local bodies = {
  {id=11, position={2,0,0}, radius=0.5, category=1},
  {id=22, position={8,0,0}, radius=1, category=2},
  {id=33, position={5,-4,0}, previous_position={5,4,0}, radius=0.5, category=4},
}
local queries = {
  {kind="nearest", point={0,0,0}, max_distance=20, mask=2},
  {kind="overlap_sphere", center={2,0,0}, radius=0.25, mask=1},
  {kind="sweep_sphere", from={0,0,0}, to={10,0,0}, radius=0.5, mask=4},
}
local function reject(label, fn)
  local ok, err = pcall(fn)
  report.negative_diagnostics[label] = {rejected=not ok, message=tostring(err)}
  assert(not ok, label .. " unexpectedly succeeded")
end
return {
  start=function(api)
    report.info_initial = portableInfo(api)
    index = api.spatial.create({{id=1, position={0,0,0}, radius=1}})
    local packed = api.spatial.pack(bodies)
    report.packed_bytes = buffer.len(packed)
    assert(report.packed_bytes == 128, "USB1 length")
    packedIndex = api.spatial.create(packed)
    reject("duplicate_update", function()
      api.spatial.update(index, {
        {id=7,position={1,0,0},radius=1},
        {id=7,position={2,0,0},radius=1},
      })
    end)
    report.repaired_version = api.spatial.update(index, packed)
    assert(report.repaired_version == 2, "invalid update must preserve version")
    report.info_created = portableInfo(api)
  end,
  update=function(api, dt)
    tick += 1
    if tick == 1 then
      ticket = api.spatial.submit(index, queries)
      packedTicket = api.spatial.submit(packedIndex, queries)
      canceledTicket = api.spatial.submit(packedIndex, queries)
      reject("same_tick_take", function() api.spatial.take(ticket) end)
      api.spatial.cancel(canceledTicket)
      reject("take_canceled", function() api.spatial.take(canceledTicket) end)
      report.live_version_after_submit = api.spatial.update(index, {
        {id=99,position={100,0,0},radius=0.5,category=1},
      })
      assert(report.live_version_after_submit == 3, "version 3")
      api.spatial.destroy(index)
      reject("stale_destroy", function() api.spatial.destroy(index) end)
      report.info_after_submit = portableInfo(api)
    elseif tick == 2 then
      local result = api.spatial.take(ticket)
      local packedResult = api.spatial.take(packedTicket)
      report.delivery_tick = tick
      report.result = result
      report.packed_result = packedResult
      assert(result.version == 2, "frozen version 2 must survive replacement and destroy")
      assert(packedResult.version == 1, "packed create version")
      assert(#result.results == 3, "query order")
      assert(result.results[1].hits[1].id == 22, "nearest category mask")
      assert(result.results[2].hits[1].id == 11, "sphere overlap")
      assert(result.results[3].hits[1].id == 33, "relative moving sphere sweep")
      local expected = (math.sqrt(41) - 1) / math.sqrt(164)
      assert(math.abs(result.results[3].hits[1].fraction - expected) < 0.0001, "relative sweep contact time")
      for i=1,3 do
        assert(result.results[i].hits[1].id == packedResult.results[i].hits[1].id, "table/pack IDs")
        assert(math.abs(result.results[i].hits[1].fraction - packedResult.results[i].hits[1].fraction) < 0.0001, "table/pack fraction")
      end
      reject("one_shot_take", function() api.spatial.take(ticket) end)
      api.spatial.destroy(packedIndex)
      local entity = api.entity.getPosition("unrelated")
      report.unrelated_entity = entity
      assert(entity.x == 123 and entity.y == 456, "spatial must not mutate scene")
      report.info_final = portableInfo(api)
      report.complete = true
    end
    report.tick = tick
    api.observation.set("spatial_probe", report)
  end,
}
`;

function overlapScript(count) {
  return String.raw`
local function portableInfo(api)
  local info = api.spatial.info()
  if info.limits and info.limits.safe_integer ~= nil then
    info.limits.safe_integer = tostring(info.limits.safe_integer)
  end
  return info
end
local index, ticket
local tick = 0
local report = {body_count=${count}}
return {
  start=function(api)
    local bodies = {}
    for i=1,${count} do
      bodies[i] = {id=i,position={0,0,0},radius=1}
    end
    index = api.spatial.create(bodies)
    report.info = portableInfo(api)
  end,
  update=function(api, dt)
    tick += 1
    report.tick = tick
    if tick == 1 then
      ticket = api.spatial.submit(index, {{kind="overlap_sphere",center={0,0,0},radius=1}})
      report.submitted = true
    elseif tick == 2 then
      local result = api.spatial.take(ticket)
      report.version = result.version
      report.hits = result.results[1].hits
      report.hit_count = #report.hits
      assert(report.hit_count == ${count}, "overlap count")
      for i=1,${count} do assert(report.hits[i].id == i, "ascending IDs") end
      report.complete = true
    end
    api.observation.set("spatial_overflow_probe", report)
  end,
}
`;
}

try {
  const initial = await binaryIdentity();
  emit({event: 'identity_before', expected: identity, actual: initial});
  if (initial.sha256 !== identity.sha256 || initial.bytes !== identity.bytes)
    throw new Error('Executable identity does not match captured descriptor');
  tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'unone-spatial-scout-informed-workaround-'));
  emit({event: 'scope', mode: 'public CLI headless CPU', temp_root: tempRoot,
    explicit_preexisting_reads: [fileURLToPath(import.meta.url), identityPath, identity.path],
    no_network_build_install_account_game_edits: true,
    cleanup: 'Preserved fresh OS temp project for inspection; no recursive delete.'});
  emit({event: 'explicit_workaround', original_probe_preserved: true,
    reason: 'Direct spatial.info() publication exceeds observation portable integer range.',
    projection: 'Only info.limits.safe_integer is converted with tostring before observation publication.',
    product_changes: false, other_info_fields_retained: true});

  for (const args of [['--help'], ['api','--help'], ['api','search','--help'], ['run','--help']])
    cli('public-help', args);
  const version = cli('public-version', ['--version']);
  check(version.stdout.trim() === identity.version, 'version matches descriptor', version.stdout.trim());

  for (const query of ['spatial','GPU spatial','batch collision','GPU collision','空間查詢','批次碰撞查詢','nearest']) {
    emit({event: 'search_input', query, utf8_hex: Buffer.from(query).toString('hex')});
    cli('api-search', ['api','search',query,'--json'], output => ({
      ok: output.ok,
      value: {query: output.value?.query, matches: output.value?.matches?.map(x => ({name:x.name,purpose:x.purpose})),
        suggested_next_actions: output.value?.suggested_next_actions},
      diagnostics: output.diagnostics,
    }));
  }
  for (const name of ['spatial.pack','spatial.create','spatial.update','spatial.submit','spatial.take','spatial.destroy','spatial.cancel','spatial.info'])
    cli('api-describe', ['api','describe',name,'--json']);
  cli('canonical-spatial-typings', ['api','typings','--json'], output => {
    // Confirmed against the initial Scout capture and the public CLI: the
    // canonical text is output.value.typings, not a top-level output.typings.
    const text = output.value?.typings || '';
    const start = text.indexOf('export type SpatialBody');
    const end = text.indexOf('export type EngineApi', start);
    return {ok: output.ok, selected_field: 'value.typings', selected_field_type: typeof output.value?.typings,
      typings_bytes: Buffer.byteLength(text),
      spatial_typings: start < 0 ? null : text.slice(start,end < 0 ? undefined : end), diagnostics: output.diagnostics};
  });

  const project = await makeProject('representative', representative);
  const args = ['--project',project,'run','--frames','2','--seed','72023','--json'];
  const first = cli('representative-first', args);
  const second = cli('representative-repeat-same-seed', args);
  const observed = reportObservation(first, 'spatial_probe');
  check(first.status === 0 && first.parsed?.ok === true && observed?.complete === true,
    'representative completed', {status:first.status,ok:first.parsed?.ok,observation:observed});
  const d1 = findValues(first.parsed, 'observation_digest');
  const d2 = findValues(second.parsed, 'observation_digest');
  check(d1.length > 0 && JSON.stringify(d1) === JSON.stringify(d2),
    'same-seed observation digest', {first:d1,repeat:d2});

  const overflowProject = await makeProject('overflow65', overlapScript(65));
  const overflow = cli('terminal-overlap65', ['--project',overflowProject,'run','--frames','2','--seed','72023','--json']);
  check(overflow.parsed?.ok === false,
    '65 contacts explicitly fail', {status:overflow.status,ok:overflow.parsed?.ok,diagnostics:overflow.parsed?.diagnostics});
  const overflowDiagnostic = JSON.stringify(overflow.parsed?.diagnostics || []);
  check(/overlap|contacts/i.test(overflowDiagnostic) && /64|overflow|exceed/i.test(overflowDiagnostic),
    '65-contact failure identifies contact overflow', {diagnostics:overflow.parsed?.diagnostics});

  const repairedProject = await makeProject('repaired64', overlapScript(64));
  const repaired = cli('fresh-runtime-repaired64', ['--project',repairedProject,'run','--frames','2','--seed','72023','--json']);
  const repairedObservation = reportObservation(repaired, 'spatial_overflow_probe');
  check(repaired.status === 0 && repaired.parsed?.ok === true && repairedObservation?.complete === true && repairedObservation?.hit_count === 64,
    'fresh runtime with 64 contacts completes', {status:repaired.status,ok:repaired.parsed?.ok,observation:repairedObservation});
} catch (error) {
  failures.push({label:'probe infrastructure',detail:String(error)});
  emit({event:'probe_error',error:String(error)});
} finally {
  try {
    finalIdentity = await binaryIdentity();
    check(finalIdentity.sha256 === identity.sha256 && finalIdentity.bytes === identity.bytes,
      'executable identity unchanged', finalIdentity);
  } catch (error) {
    failures.push({label:'final identity',detail:String(error)});
    emit({event:'identity_error',error:String(error)});
  }
  emit({event:'task_result',complete:failures.length === 0,failures,temp_root:tempRoot,
    elapsed_ms:Math.round((performance.now()-started)*1000)/1000,
    scope:'Public CLI headless CPU semantics and discoverability only; no GPU execution, timing or rendering claim.'});
  if (failures.length) process.exitCode = 1;
}

import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, webcrypto} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import vm from 'node:vm';

// Adapted from the accepted 2026-10-16 Voidwake package comparison. Each real
// production runtime now receives its own real export in its own VM/module.
// No script, config, package declaration, UI, state or font string is replaced.
const out = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
assert(args.length <= 4, 'Usage: node compare-runtime-ui.mjs [baseline project.json] [current project.json] [baseline runtime directory] [current runtime directory]');
const baselinePath = resolve(args[0] ?? join(out, 'baseline-player/content/project.json'));
const currentPath = resolve(args[1] ?? '_Games/voidwake/dist/player/content/project.json');
const runtimeRoots = {
    baseline: resolve(args[2] ?? join(out, 'baseline-runtime')),
    current: resolve(args[3] ?? 'D:/TSProject/Voidwake/game/runtime'),
};
const loaderPath = resolve('D:/TSProject/Voidwake/game/web/shared/load-project.js');
const hash = data => createHash('sha256').update(data).digest('hex');
const inputs = {
    baseline: {path: baselinePath, bytes: readFileSync(baselinePath)},
    current: {path: currentPath, bytes: readFileSync(currentPath)},
};
const payloads = Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, JSON.parse(input.bytes.toString('utf8'))]));
assert.equal(payloads.baseline.config.runtime_packages?.['@unone/ui'], '0.1.0');
assert.equal(payloads.current.config.runtime_packages?.['@unone/ui'], '0.2.0');
const runtimeInputs = Object.fromEntries(Object.entries(runtimeRoots).map(([name, path]) => {
    const descriptor = readFileSync(join(path, 'runtime.json'));
    const manifest = JSON.parse(descriptor.toString('utf8'));
    const wasm = readFileSync(join(path, manifest.wasm));
    const javascript = readFileSync(join(path, manifest.javascript));
    assert.equal(hash(wasm), manifest.wasm_sha256, name + ' production WASM hash');
    assert.equal(hash(javascript), manifest.javascript_sha256, name + ' production JS hash');
    assert.equal(manifest.runtime_packages?.['@unone/ui'], name === 'baseline' ? '0.1.0' : '0.2.0');
    assert.equal(manifest.dev_tools, false, name + ' production runtime');
    assert(manifest.compiled_systems.includes('ui'));
    return [name, {path, descriptor, manifest, wasm, javascript}];
}));
assert.notEqual(hash(runtimeInputs.baseline.wasm), hash(runtimeInputs.current.wasm), 'Comparison uses two different production WASM modules');
const {loadProject, readObservation} = await import(pathToFileURL(loaderPath));
const report = {
    ok: false,
    started_utc: new Date().toISOString(),
    harness_sha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    official_host_loader: {path: loaderPath, sha256: hash(readFileSync(loaderPath))},
    runtimes: Object.fromEntries(Object.entries(runtimeInputs).map(([name, item]) => [name, {
        path: item.path, descriptor_sha256: hash(item.descriptor), wasm_sha256: hash(item.wasm),
        javascript_sha256: hash(item.javascript), runtime_packages: item.manifest.runtime_packages,
        manifest_source_commit: item.manifest.source_commit, manifest_source_dirty: item.manifest.source_dirty,
        profile: item.manifest.profile, dev_tools: item.manifest.dev_tools,
    }])),
    inputs: Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, {
        path: input.path, sha256: hash(input.bytes), script_sha256: hash(payloads[name].script),
        runtime_packages: payloads[name].config.runtime_packages,
    }])),
    comparison: {mode: 'exact', normalized_fields: [], expected_font_substitutions: []},
    seed: 42,
    viewports: [],
    errors: [],
    limitations: [
        'Headless real-WASM equality proves published semantic UI and game observations. It does not prove browser pixels, font rasterization, browser input routing, shader presentation or GPU behavior.',
        'Each unmodified project export runs on its corresponding production runtime in a separate VM/module. The only added host envelope field is the normal viewport_aspect; input uses the official input-frame ABI.',
        'Package versions are recorded from hashed runtime descriptors and actual project declarations. No script, config, game state or extra observation is injected to query metadata.',
        'Both runtime descriptors report source_dirty=true. Their source_commit values identify build checkout bases, not immutable final source snapshots; exact JS/WASM hashes identify the modules tested.',
    ],
};
let totalFrames = 0;

async function instantiate(item) {
    return new Promise((done, reject) => {
        const options = {wasmBinary: new Uint8Array(item.wasm), noInitialRun: true, print: () => {}, printErr: console.error, onAbort: reject};
        const runtimeJs = join(item.path, item.manifest.javascript);
        const context = {Module: options, crypto: webcrypto, window: {}, document: {currentScript: {src: pathToFileURL(runtimeJs).href}}, location: {href: pathToFileURL(runtimeJs).href}, console, TextDecoder, TextEncoder, WebAssembly, setTimeout, clearTimeout, performance};
        options.onRuntimeInitialized = () => done(context.Module);
        try { vm.runInNewContext(item.javascript.toString('utf8'), context, {timeout: 30000}); }
        catch (error) { reject(error); }
    });
}

function run(module, payload, aspect) {
    let state, frames = 0;
    const checkpoints = [];
    function reload() { state = loadProject(module, {...payload, viewport_aspect: aspect}, 42n); return state; }
    function tick(actions = {}) {
        const bytes = new TextEncoder().encode(JSON.stringify({actions}));
        const address = module._unone_web_alloc(bytes.length);
        module.HEAPU8.set(bytes, address);
        assert.equal(module._unone_web_set_input_frame(address, bytes.length), 0);
        assert.equal(module._unone_web_tick(), 0);
        state = readObservation(module); frames++; totalFrames++;
        assert.equal(state.world.observations.finiteState, true);
        return state;
    }
    function checkpoint(name, phase) {
        if (phase) assert.equal(state.world.observations.phase, phase, name + ' reaches intended phase');
        checkpoints.push({name, frame: state.world.frame, phase: state.world.observations.phase, ui: state.world.ui, observations: state.world.observations});
    }
    reload(); checkpoint('menu-start', 'menu'); tick(); checkpoint('menu-frame-1', 'menu');
    tick({Start: true}); checkpoint('playing-start', 'playing');
    for (let i = 0; i < 45; i++) tick({KeyD: true}); checkpoint('playing-moved', 'playing');
    tick({Pause: true}); checkpoint('paused', 'paused');
    for (let i = 0; i < 120; i++) tick({KeyD: true, Fire: true}); checkpoint('pause-frozen-120-input-frames', 'paused');
    tick({Resume: true}); checkpoint('resumed', 'playing'); tick();
    tick({Pause: true}); tick(); tick({Abandon: true}); checkpoint('abandon-confirmation', 'paused');
    tick(); tick({CancelAbandon: true}); checkpoint('abandon-cancelled', 'paused');
    tick(); tick({Abandon: true}); tick(); tick({Menu: true}); checkpoint('abandoned-menu', 'menu');
    tick(); tick({Start: true}); tick(); tick({AutoFire: true}); checkpoint('auto-fire-disabled', 'playing');
    tick(); tick({Dash: true}); tick(); tick({Burst: true}); checkpoint('abilities-used', 'playing');
    tick(); tick({Sound: true}); checkpoint('sound-toggled', 'playing');
    tick(); tick({Restart: true}); checkpoint('restarted', 'playing');
    reload(); tick({Start: true}); for (let i = 1; i < 2500; i++) tick(); checkpoint('upgrade-2500', 'upgrade');
    tick({Select1: true}); checkpoint('upgrade-selected', 'playing');
    assert.equal(state.world.observations.upgradesInstalled, 1);
    for (let i = 0; i < 10; i++) tick({Select1: true}); checkpoint('held-choice-installs-once', 'playing');
    assert.equal(state.world.observations.upgradesInstalled, 1);
    reload(); tick({Start: true}); tick({AutoFire: true});
    let deathFrames = 0;
    for (; deathFrames < 5000 && state.world.observations.phase !== 'gameover'; deathFrames++) tick();
    assert.equal(state.world.observations.phase, 'gameover', 'Normal combat without autofire reaches gameover within bounded frame budget');
    checkpoint('natural-gameover', 'gameover'); tick({Restart: true}); checkpoint('restart-after-gameover', 'playing');
    assert.equal(checkpoints.length, 19);
    return {frames, death_frames: deathFrames, checkpoints};
}

function firstDifferences(a, b, path = '', result = []) {
    if (isDeepStrictEqual(a, b) || result.length >= 12) return result;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) firstDifferences(a[key], b[key], path + '/' + key, result);
    } else result.push({path, baseline: a, current: b});
    return result;
}

try {
    const modules = {baseline: await instantiate(runtimeInputs.baseline), current: await instantiate(runtimeInputs.current)};
    assert.notEqual(modules.baseline, modules.current, 'Independent production modules');
    for (const viewport of [{name: 'desktop', width: 1440, height: 900}, {name: 'intermediate', width: 1020, height: 884}, {name: 'portrait', width: 390, height: 844}]) {
        const aspect = viewport.width / viewport.height;
        const baseline = run(modules.baseline, payloads.baseline, aspect);
        const current = run(modules.current, payloads.current, aspect);
        assert.equal(current.frames, baseline.frames, 'Equal real tick count');
        assert.equal(current.checkpoints.length, baseline.checkpoints.length);
        const result = {viewport, aspect, frames_per_payload: current.frames, natural_death_frames: current.death_frames, cases: []};
        report.viewports.push(result);
        for (let i = 0; i < baseline.checkpoints.length; i++) {
            const before = baseline.checkpoints[i], after = current.checkpoints[i];
            assert.equal(before.name, after.name);
            const uiEqual = isDeepStrictEqual(before.ui, after.ui);
            const observationsEqual = isDeepStrictEqual(before.observations, after.observations);
            const entry = {name: before.name, frame: before.frame, phase: before.phase, ui_equal: uiEqual, observations_equal: observationsEqual, baseline_ui_sha256: hash(JSON.stringify(before.ui)), current_ui_sha256: hash(JSON.stringify(after.ui)), baseline_observations_sha256: hash(JSON.stringify(before.observations)), current_observations_sha256: hash(JSON.stringify(after.observations))};
            if (!uiEqual) entry.ui_differences = firstDifferences(before.ui, after.ui);
            if (!observationsEqual) entry.observation_differences = firstDifferences(before.observations, after.observations);
            result.cases.push(entry);
        }
        result.ok = result.cases.every(item => item.ui_equal && item.observations_equal);
        console.log(JSON.stringify({viewport: viewport.name, ok: result.ok, cases: result.cases.length, frames_per_payload: result.frames_per_payload, natural_death_frames: result.natural_death_frames}));
    }
    report.inputs_unchanged = Object.fromEntries(Object.entries(inputs).map(([name, item]) => [name, hash(readFileSync(item.path)) === hash(item.bytes)]));
    report.runtimes_unchanged = Object.fromEntries(Object.entries(runtimeInputs).map(([name, item]) => [name,
        hash(readFileSync(join(item.path, 'runtime.json'))) === hash(item.descriptor) &&
        hash(readFileSync(join(item.path, item.manifest.wasm))) === hash(item.wasm) &&
        hash(readFileSync(join(item.path, item.manifest.javascript))) === hash(item.javascript),
    ]));
    assert(Object.values(report.inputs_unchanged).every(Boolean), 'Project inputs unchanged during comparison');
    assert(Object.values(report.runtimes_unchanged).every(Boolean), 'Runtime inputs unchanged during comparison');
    assert.equal(report.viewports.reduce((count, viewport) => count + viewport.cases.length, 0), 57);
    report.ok = report.viewports.every(viewport => viewport.ok);
    if (!report.ok) process.exitCode = 1;
} catch (error) {
    report.errors.push(error.stack); process.exitCode = 1;
} finally {
    report.total_real_wasm_ticks = totalFrames;
    report.finished_utc = new Date().toISOString();
    writeFileSync(join(out, 'runtime-ui-equivalence.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ok: report.ok, total_real_wasm_ticks: totalFrames, compared_cases: report.viewports.reduce((count, viewport) => count + viewport.cases.length, 0), errors: report.errors}));

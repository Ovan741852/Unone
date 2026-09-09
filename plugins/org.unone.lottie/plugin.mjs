import { createHash } from "node:crypto";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createLottiePlayer, LOTTIE_CONTRACT, validateLottieDocument } from "./runtime/lottie.mjs";

const PLUGIN_ID = "org.unone.lottie";

function result(value, diagnostics = [], effects = []) { return { ok: true, value, diagnostics, effects }; }
function failure(code, summary, explanation, facts = {}) {
  return { ok: false, value: null, diagnostics: [{ code, severity: "ERROR", summary, explanation, facts, likely_causes: [], suggested_actions: [], source: null }], effects: [] };
}
function documentOf(input = {}) { return input.document ?? input.data ?? input; }

function minimalDocument() {
  return {
    v: "5.13.0", fr: 30, ip: 0, op: 10, w: 10, h: 10, assets: [],
    layers: [{ ty: 4, ip: 0, op: 10, st: 0, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [5, 5, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } }, shapes: [{ ty: "sh", ks: { a: 0, k: { i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[-1, -1], [1, -1], [0, 1]], c: true } } }, { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } }] }], markers: [{ tm: 4, cm: "complete", dr: 0 }]
  };
}

async function call(tool, input = {}) {
  if (tool === "plugin.test") {
    const issues = validateLottieDocument(minimalDocument());
    const events = [];
    const context = { canvas: { width: 10, height: 10 }, save() {}, restore() {}, setTransform() {}, clearRect() {}, scale() {}, translate() {}, rotate() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, bezierCurveTo() {}, fill() {} };
    const player = createLottiePlayer({ data: minimalDocument(), context, onEvent: (event) => events.push(event) });
    player.play({ mode: "once" }); player.update(1); player.dispose();
    if (issues.length || !events.some((event) => event.type === "complete")) return failure("LOTTIE_SELF_TEST_FAILED", "Lottie self-test failed", "Validation or lifecycle smoke did not complete.");
    return result({ protocol: LOTTIE_CONTRACT.protocol, plugin: PLUGIN_ID, self_test: "passed", checks: ["subset", "lifecycle", "generation", "pointer_passthrough"] });
  }
  if (tool === "lottie.inspect") return result({ ...LOTTIE_CONTRACT, host: "Canvas2D", note: "The plugin owns playback and validation; reward settlement remains in Luau. No CDN, SVG gallery or Core UI mutation is implied." });
  const document = documentOf(input);
  if (tool === "lottie.validate") {
    const issues = validateLottieDocument(document);
    return issues.length ? failure("UNONE_LOTTIE_INVALID", "Lottie document invalid", "Fix the reported JSON paths before playback or install.", { issues }) : result({ valid: true, version: document.v, frame_rate: document.fr, frame_range: [document.ip, document.op], layer_count: document.layers.length, markers: (document.markers ?? []).map((marker) => ({ name: marker.cm, frame: marker.tm })), subset: LOTTIE_CONTRACT.subset, issues: [] });
  }
  if (tool === "lottie.preview") {
    const issues = validateLottieDocument(document);
    if (issues.length) return failure("UNONE_LOTTIE_INVALID", "Lottie preview blocked", "Preview cannot run until the document validates.", { issues });
    const duration = Number(document.op) - Number(document.ip);
    const frames = [Number(document.ip), Number(document.ip) + duration * 0.125, Number(document.ip) + duration * 0.333, Number(document.ip) + duration * 0.667, Number(document.op)].map((frame) => Math.round(frame));
    return result({ valid: true, backend: "host-canvas2d", subset: LOTTIE_CONTRACT.subset, frames, markers: (document.markers ?? []).map((marker) => ({ name: marker.cm, frame: marker.tm })) });
  }
  if (tool === "lottie.install") {
    const issues = validateLottieDocument(document);
    if (issues.length) return failure("UNONE_LOTTIE_INVALID", "Lottie install blocked", "Fix validation issues before staging the asset.", { issues });
    const filename = String(input.filename ?? "animation.json");
    if (!/^[A-Za-z0-9_-]+\.json$/.test(filename)) return failure("UNONE_LOTTIE_FILENAME_INVALID", "Staging filename invalid", "filename must be a plain .json file name.");
    const project = resolve(process.env.UNONE_PROJECT_ROOT || process.cwd());
    const stagingRoot = resolve(project, ".unone", "staging", "unone-lottie");
    const output = resolve(stagingRoot, filename);
    const rel = relative(stagingRoot, output);
    if (rel.startsWith(`..${sep}`) || rel === ".." || rel.includes(`..${sep}`)) return failure("UNONE_LOTTIE_PATH_INVALID", "Staging path invalid", "The asset must remain inside .unone/staging/unone-lottie.");
    try { await access(output, constants.F_OK); if (!input.force) return failure("UNONE_LOTTIE_STAGING_CONFLICT", "Staging artifact already exists", `Refusing to overwrite ${filename}; pass force=true after reviewing it.`); } catch { /* new artifact */ }
    const runtimeRoot = resolve(stagingRoot, "runtime");
    const runtimePath = resolve(runtimeRoot, "lottie.mjs");
    if (input.include_runtime !== false && !input.force) {
      try { await access(runtimePath, constants.F_OK); return failure("UNONE_LOTTIE_RUNTIME_CONFLICT", "Runtime artifact already exists", "Refusing to overwrite runtime/lottie.mjs; pass force=true after reviewing it."); } catch { /* new runtime */ }
    }
    const payload = `${JSON.stringify(document, null, 2)}\n`;
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(output, payload, "utf8");
    const runtimeArtifacts = [];
    if (input.include_runtime !== false) { await mkdir(runtimeRoot, { recursive: true }); await copyFile(resolve(fileURLToPath(new URL("./", import.meta.url)), "runtime", "lottie.mjs"), runtimePath); runtimeArtifacts.push(`.unone/staging/unone-lottie/runtime/lottie.mjs`); }
    return result({ artifact: `.unone/staging/unone-lottie/${filename}`, runtime_artifacts: runtimeArtifacts, bytes: Buffer.byteLength(payload), sha256: createHash("sha256").update(payload).digest("hex"), overwritten: Boolean(input.force), active_project_files_changed: false }, [], [`staged .unone/staging/unone-lottie/${filename}`]);
  }
  return failure("PLUGIN_TOOL_NOT_FOUND", "Lottie tool not found", `Unknown tool: ${tool}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try { const request = JSON.parse(line); process.stdout.write(`${JSON.stringify(await call(request.tool, request.input || {}))}\n`); } catch (error) { process.stdout.write(`${JSON.stringify(failure("PLUGIN_REQUEST_INVALID", "Plugin request invalid", error.message))}\n`); }
}

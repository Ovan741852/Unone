import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGame, openGame } from "../src/index.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fakeEngine = join(repoRoot, "packages", "unone-sdk", "test", "fake-engine.mjs");
let scratch;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "unone-sdk-"));
  await writeFile(fakeEngine, `
    const args = process.argv.slice(2);
    if (process.env.UNONE_TEST_FAIL === "1") {
      process.stdout.write(JSON.stringify({ ok: false, value: null, diagnostics: [{ code: "VERIFY_FAILED", summary: "fix me" }], effects: [] }));
      process.exit(1);
    }
    const result = args.includes("init") && args.includes("project")
      ? { ok: true, value: { project: "Demo", files: ["project.unone.json"] }, diagnostics: [], effects: [] }
      : args.includes("run")
        ? { ok: true, value: { status: "completed", frames: Number(args[args.indexOf("--frames") + 1] || 60) }, diagnostics: [], effects: [] }
        : args.includes("test")
          ? { ok: true, value: { passed: true, cases: [] }, diagnostics: [], effects: [] }
          : { ok: true, value: { passed: true }, diagnostics: [], effects: [] };
    process.stdout.write(JSON.stringify(result));
  `);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
  await rm(fakeEngine, { force: true });
});

function options() {
  return { enginePath: process.execPath, enginePrefixArgs: [fakeEngine] };
}

test("createGame initializes a project and adds npm scripts", async () => {
  const dir = join(scratch, "maid-game");
  const result = await createGame({ dir, name: "Spatial Maid", ...options() });

  assert.equal(result.ok, true);
  assert.equal(result.projectDir, dir);
  const packageJson = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.verify, "unone verify");
  assert.equal(packageJson.scripts.dev, "unone run");
});

test("SDK forwards verify, run, and test through one stable API", async () => {
  const game = openGame({ projectDir: scratch, ...options() });

  assert.equal((await game.verify()).value.passed, true);
  assert.equal((await game.run({ frames: 12 })).value.frames, 12);
  assert.equal((await game.test()).value.passed, true);
});

test("createGame refuses to overwrite a non-empty directory", async () => {
  const dir = join(scratch, "existing");
  await (await import("node:fs/promises")).mkdir(dir);
  await writeFile(join(dir, "keep.txt"), "keep");

  await assert.rejects(
    createGame({ dir, name: "No overwrite", ...options() }),
    /non-empty/i,
  );
});

test("SDK preserves structured engine diagnostics on a failed gate", async () => {
  const game = openGame({ projectDir: scratch, ...options() });
  process.env.UNONE_TEST_FAIL = "1";
  try {
    const result = await game.verify();
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "VERIFY_FAILED");
  } finally {
    delete process.env.UNONE_TEST_FAIL;
  }
});

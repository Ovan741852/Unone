import { execFile } from "node:child_process";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

/**
 * Resolve the native engine without making callers know where a checkout keeps
 * its Cargo target. A released npm package can set UNONE_GAME to its bundled
 * binary; a source checkout uses target/debug/game.exe.
 */
export async function resolveEnginePath(explicit) {
  const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const binaryName = process.platform === "win32" ? "game.exe" : "game";
  const candidates = [
    explicit,
    process.env.UNONE_GAME,
    join(process.cwd(), "bin", binaryName),
    join(process.cwd(), "target", "debug", binaryName),
    join(sdkRoot, "bin", binaryName),
    join(sdkRoot, "target", "debug", binaryName),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const path = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Try the next conventional location.
    }
  }
  throw new Error(
    "Unone engine binary not found. Build it with `cargo build -p unone-cli` " +
      "or set UNONE_GAME to game.exe.",
  );
}

async function resolveAnalyzerPath(enginePath) {
  const engineDir = dirname(enginePath);
  const engineRoot = dirname(dirname(engineDir));
  const candidates = [
    join(engineDir, process.platform === "win32" ? "luau-analyze.exe" : "luau-analyze"),
    join(engineRoot, ".toolcache", "luau-analyze.exe"),
  ];
  try {
    for (const entry of await readdir(join(engineRoot, ".toolcache"))) {
      candidates.push(join(engineRoot, ".toolcache", entry, process.platform === "win32" ? "luau-analyze.exe" : "luau-analyze"));
    }
  } catch {
    // A released SDK may ship the analyzer next to the engine instead.
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next conventional location.
    }
  }
  return undefined;
}

function parseEngineOutput(stdout, stderr, command) {
  const text = stdout.trim();
  if (!text) {
    throw new Error(`Unone command returned no JSON: ${command}\n${stderr.trim()}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Unone command returned invalid JSON: ${command}\n${text}\n${stderr.trim()}`, {
      cause: error,
    });
  }
}

async function runCommand({ enginePath, enginePrefixArgs = [], projectDir, args }) {
  const fullArgs = [...enginePrefixArgs, "--project", projectDir, "--json", ...args];
  const command = `${enginePath} ${fullArgs.join(" ")}`;
  let stdout = "";
  let stderr = "";
  const env = { ...process.env };
  if (!env.UNONE_LUAU_ANALYZER) {
    const analyzer = await resolveAnalyzerPath(enginePath);
    if (analyzer) env.UNONE_LUAU_ANALYZER = analyzer;
  }
  try {
    ({ stdout, stderr } = await execFileAsync(enginePath, fullArgs, { cwd: projectDir, env }));
  } catch (error) {
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? error.message ?? "";
    if (!stdout.trim()) throw new Error(`Unone command failed: ${command}\n${stderr.trim()}`, { cause: error });
  }
  const result = parseEngineOutput(stdout, stderr, command);
  return result;
}

export class UnoneGame {
  constructor({ projectDir, enginePath, enginePrefixArgs = [] }) {
    this.projectDir = resolve(projectDir);
    this.enginePath = enginePath;
    this.enginePrefixArgs = enginePrefixArgs;
  }

  async invoke(args) {
    return runCommand({
      enginePath: this.enginePath || await resolveEnginePath(),
      enginePrefixArgs: this.enginePrefixArgs,
      projectDir: this.projectDir,
      args,
    });
  }

  verify() {
    return this.invoke(["verify"]);
  }

  test() {
    return this.invoke(["test"]);
  }

  run({ frames = 60, seed = 42, action, inputSequence } = {}) {
    const args = ["run", "--frames", String(frames), "--seed", String(seed)];
    if (action) args.push("--action", action);
    if (inputSequence) args.push("--input-sequence", inputSequence);
    return this.invoke(args);
  }

  pack() {
    return this.invoke(["bundle", "pack"]);
  }

  inspect() {
    return this.invoke(["project", "inspect"]);
  }

  pluginList() {
    return this.invoke(["plugin", "list"]);
  }

  pluginInspect(id) {
    if (!id?.trim()) throw new Error("pluginInspect requires a plugin id");
    return this.invoke(["plugin", "inspect", "--id", id]);
  }

  pluginTest(id) {
    if (!id?.trim()) throw new Error("pluginTest requires a plugin id");
    return this.invoke(["plugin", "test", "--id", id]);
  }

  pluginCall({ id, tool, input } = {}) {
    if (!id?.trim() || !tool?.trim()) throw new Error("pluginCall requires id and tool");
    // Plugin calls are intentionally kept JSON-only. A caller that needs a
    // large input should write a project-local file and invoke the CLI, while
    // normal AI tool calls can stay in one structured request.
    return this.invoke(["plugin", "call", "--id", id, "--tool", tool, ...(input ? ["--input", input] : [])]);
  }
}

export function openGame(options) {
  return new UnoneGame(options);
}

export async function createGame({ dir, name, enginePath, enginePrefixArgs = [], writePackage = true }) {
  if (!dir || !name?.trim()) throw new Error("createGame requires a directory and a non-empty name");
  const projectDir = resolve(dir);
  await mkdir(projectDir, { recursive: true });
  const entries = await readdir(projectDir);
  if (entries.length > 0) {
    throw new Error(`Cannot initialize a non-empty directory: ${projectDir}`);
  }

  const game = openGame({ projectDir, enginePath, enginePrefixArgs });
  const result = await game.invoke(["project", "init", "--name", name]);
  if (writePackage) {
    await writeFile(
      join(projectDir, "package.json"),
      `${JSON.stringify({
        name: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unone-game",
        private: true,
        type: "module",
        scripts: {
          dev: "unone run",
          verify: "unone verify",
          test: "unone test",
        },
        devDependencies: { "@unone/sdk": "^0.1.0" },
      }, null, 2)}\n`,
      "utf8",
    );
  }
  return { ...result, projectDir, game };
}

export const unone = { createGame, openGame, resolveEnginePath, UnoneGame };

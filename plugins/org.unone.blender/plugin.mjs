import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const project = process.env.UNONE_PROJECT_ROOT || process.cwd();

function result(value, diagnostics = [], effects = []) {
  return { ok: true, value, diagnostics, effects };
}

function failure(code, summary, explanation, facts = {}) {
  return {
    ok: false,
    value: null,
    diagnostics: [{
      code,
      severity: "ERROR",
      summary,
      explanation,
      facts,
      likely_causes: [],
      suggested_actions: [],
      source: null,
    }],
    effects: [],
  };
}

async function blenderAvailable() {
  return new Promise((resolve) => {
    const child = spawn("blender", ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

function validateEntities(entities) {
  if (!Array.isArray(entities)) return "entities must be an array";
  const ids = new Set();
  for (const [index, entity] of entities.entries()) {
    if (!entity || typeof entity !== "object" || typeof entity.id !== "string" || !entity.id.trim()) {
      return `entities[${index}].id must be a non-empty string`;
    }
    if (ids.has(entity.id)) return `duplicate entity id: ${entity.id}`;
    ids.add(entity.id);
  }
  return null;
}

async function call(tool, input) {
  if (tool === "plugin.test") {
    return result({ protocol: "unone.plugin.v1", plugin: "org.unone.blender", self_test: "passed" });
  }
  if (tool === "blender.inspect") {
    return result({
      blender_available: await blenderAvailable(),
      project,
      import_formats: ["glb", "gltf"],
      canonical_output: "scenes/*.scene.json",
      note: "Blender is optional; semantic scene validation does not require Blender.",
    });
  }
  if (tool === "blender.preview") {
    const error = validateEntities(input.entities);
    if (error) return failure("BLENDER_SCENE_INVALID", "示意場景無效", error);
    return result({
      preview: "semantic",
      entity_count: input.entities.length,
      ids: input.entities.map((entity) => entity.id),
      next_action: "blender.export_scene",
    });
  }
  if (tool === "blender.export_scene") {
    const error = validateEntities(input.entities);
    if (error) return failure("BLENDER_SCENE_INVALID", "示意場景無效", error);
    const scene = input.scene || "main";
    const relative = join(".unone", "staging", "blender", `${scene}.scene.json`);
    const output = join(project, relative);
    await mkdir(join(project, ".unone", "staging", "blender"), { recursive: true });
    const payload = {
      entities: input.entities.map((entity) => ({
        id: entity.id,
        transform: entity.transform || {position: {x: 0, y: 0, z: 0}},
        ...(entity.sprite ? {sprite: entity.sprite} : {}),
        ...(entity.mesh3d ? {mesh3d: entity.mesh3d} : {}),
      })),
    };
    await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return result({
      scene,
      artifact: relative.replaceAll("\\", "/"),
      entities: payload.entities.length,
    }, [], [`staged ${relative.replaceAll("\\", "/")}`]);
  }
  return failure("PLUGIN_TOOL_NOT_FOUND", "找不到插件工具", `Unknown tool: ${tool}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const request = JSON.parse(line);
    process.stdout.write(`${JSON.stringify(await call(request.tool, request.input || {}))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(failure("PLUGIN_REQUEST_INVALID", "插件請求無效", error.message))}\n`);
  }
}

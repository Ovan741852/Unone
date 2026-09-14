export const ANIMATOR_CONTRACT = {
  protocol: "unone.plugin.v1",
  runtime: "src/animator.mjs",
  methods: ["play", "transition", "pause", "resume", "restart", "seek", "seekNormalized", "setSpeed", "update", "getState", "getDiagnostics", "dispose"],
  host_methods: ["attach", "remove", "setDistance", "setEquipment", "transition", "update", "getState", "snapshot", "dispose"],
  state: ["state", "clip", "time", "duration", "normalizedTime", "speed", "loop", "playing", "finished", "paused", "transition", "active_action_count"],
  transition: { default_seconds: 0.2, zero_is_immediate: true, restart_required_for_same_state: true },
  boundaries: {
    owns: ["clip selection", "finite transition weights", "pause/resume", "loop/once", "finished event", "presentation LOD scheduling"],
    does_not_own: ["Spine vendor runtime", "root motion", "damage", "death", "skill triggers", "collision", "currency", "simulation tick"]
  }
};

export function validateControllerDocument(input = {}) {
  const clips = Array.isArray(input.clips) ? input.clips : [];
  const controller = input.controller && typeof input.controller === "object" ? input.controller : {};
  const clipSet = new Set(clips.map(String));
  const states = controller.states && typeof controller.states === "object" ? controller.states : {};
  const issues = [];
  const seen = new Set();
  for (const [name, raw] of Object.entries(states)) {
    if (seen.has(name)) issues.push(issue("STATE_DUPLICATE", `/states/${name}`, `Duplicate state '${name}'.`));
    seen.add(name);
    const state = typeof raw === "string" ? { clip: raw } : raw;
    if (!state || typeof state !== "object") { issues.push(issue("STATE_INVALID", `/states/${name}`, "State must be an object or clip string.")); continue; }
    const clip = String(state.clip ?? name);
    if (!clipSet.has(clip)) issues.push(issue("CLIP_MISSING", `/states/${name}/clip`, `Clip '${clip}' is not in clips.`));
    for (const [field, predicate] of [["transition", (value) => Number.isFinite(value) && value >= 0], ["speed", (value) => Number.isFinite(value) && value >= 0], ["priority", (value) => Number.isFinite(value)]]) {
      if (state[field] !== undefined && !predicate(Number(state[field]))) issues.push(issue("NUMBER_INVALID", `/states/${name}/${field}`, `${field} must be a valid non-negative/finite number.`));
    }
    if (state.finished !== undefined && !states[state.finished]) issues.push(issue("STATE_TARGET_MISSING", `/states/${name}/finished`, `Finished target '${state.finished}' is not declared.`));
  }
  if (controller.initial !== undefined && !states[controller.initial]) issues.push(issue("INITIAL_STATE_MISSING", "/initial", `Initial state '${controller.initial}' is not declared.`));
  return issues;
}

function issue(code, path, message) { return { code, path, message, severity: "ERROR" }; }

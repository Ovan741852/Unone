// Presentation-only animation update scheduler. It never changes gameplay
// positions, collision, damage, lifetime or simulation tick frequency.

const DEFAULT_LEVELS = [
  { id: "full", maxDistance: 8, updateHz: 60 },
  { id: "reduced", maxDistance: 24, updateHz: 15 },
  { id: "frozen", maxDistance: Infinity, updateHz: 0 },
];

export function createLodScheduler({ levels = DEFAULT_LEVELS, budgetHz = Infinity } = {}) {
  const normalized = normalizeLevels(levels);
  const assignments = new Map();
  const lastUpdate = new Map();
  let now = 0;

  function assign(instances = []) {
    const sorted = [...instances].sort((a, b) => Number(a.distance ?? Infinity) - Number(b.distance ?? Infinity) || String(a.id).localeCompare(String(b.id)));
    let remaining = Number.isFinite(budgetHz) ? Math.max(0, budgetHz) : Infinity;
    for (const instance of sorted) {
      const distance = Number(instance.distance ?? Infinity);
      if (!Number.isFinite(distance) || distance < 0) throw new Error(`LOD instance '${instance.id}' distance must be finite and non-negative.`);
      const level = normalized.find((candidate) => distance <= candidate.maxDistance) ?? normalized[normalized.length - 1];
      const requested = Math.min(level.updateHz, Number(instance.maxHz ?? level.updateHz));
      const assignedHz = Math.min(requested, remaining);
      assignments.set(String(instance.id), { id: String(instance.id), level: level.id, distance, updateHz: assignedHz, culled: assignedHz === 0 });
      if (Number.isFinite(remaining)) remaining = Math.max(0, remaining - assignedHz);
    }
    return snapshot();
  }

  function tick(dt) {
    const delta = Number(dt);
    if (!Number.isFinite(delta) || delta < 0) throw new Error("LOD tick dt must be a finite non-negative number.");
    now += delta * 1000;
  }

  function shouldUpdate(id, at = now) {
    const assignment = assignments.get(String(id));
    if (!assignment || assignment.updateHz <= 0) return false;
    const interval = 1000 / assignment.updateHz;
    const previous = lastUpdate.get(String(id));
    if (previous !== undefined && at - previous < interval - 1e-6) return false;
    lastUpdate.set(String(id), at);
    return true;
  }

  function levelFor(id) {
    return assignments.get(String(id)) ?? null;
  }

  function snapshot() {
    return {
      budget_hz: budgetHz,
      assigned: [...assignments.values()].sort((a, b) => a.id.localeCompare(b.id)),
      counts: [...assignments.values()].reduce((result, item) => {
        result[item.level] = (result[item.level] ?? 0) + 1;
        return result;
      }, {}),
    };
  }

  return { assign, tick, shouldUpdate, levelFor, snapshot };
}

export function normalizeLevels(levels = DEFAULT_LEVELS) {
  if (!Array.isArray(levels) || levels.length === 0) throw new Error("LOD levels must be a non-empty array.");
  const output = levels.map((level, index) => ({
    id: String(level.id ?? `level-${index}`),
    maxDistance: level.maxDistance === Infinity ? Infinity : Number(level.maxDistance),
    updateHz: Number(level.updateHz),
  }));
  let previous = -Infinity;
  for (const level of output) {
    if (!level.id || !Number.isFinite(level.maxDistance) && level.maxDistance !== Infinity || level.maxDistance <= previous || !Number.isFinite(level.updateHz) || level.updateHz < 0) {
      throw new Error("LOD levels require increasing maxDistance and non-negative finite updateHz.");
    }
    previous = level.maxDistance;
  }
  return output;
}

import { createAnimator } from "./animator.mjs";
import { createLodScheduler } from "./lod.mjs";

// Renderer-owned bridge for skinned presentation objects. The engine's
// instances3d transform batch remains untouched: it is a static/instanced
// transport, while this adapter owns optional per-root skeletal presentation.
export function createAnimatorHost({
  THREE,
  levels,
  budgetHz = Infinity,
  controller,
  onEvent,
  onEquipment,
} = {}) {
  if (!THREE?.AnimationMixer) throw new Error("createAnimatorHost requires the renderer's THREE namespace.");
  const scheduler = createLodScheduler({ levels, budgetHz });
  const entries = new Map();
  let disposed = false;

  function ensureLive() {
    if (disposed) throw new Error("Animator host has been disposed.");
  }

  function plan() {
    return scheduler.assign([...entries.values()].map((entry) => ({
      id: entry.id,
      distance: entry.distance,
      maxHz: entry.maxHz,
    })));
  }

  function attach({ id, root, clips, controller: instanceController = controller, distance = 0, maxHz, equipment = {} } = {}) {
    ensureLive();
    const key = String(id ?? "");
    if (!key) throw new Error("Animator host attach requires a stable id.");
    if (entries.has(key)) throw new Error(`Animator host instance '${key}' already exists.`);
    const player = createAnimator({
      THREE,
      root,
      clips,
      controller: instanceController,
      onEvent: (event) => onEvent?.({ ...event, id: key }),
    });
    const entry = {
      id: key,
      root,
      player,
      distance: Number(distance),
      maxHz,
      elapsed: 0,
      equipment: { ...equipment },
    };
    if (!Number.isFinite(entry.distance) || entry.distance < 0) {
      player.dispose();
      throw new Error(`Animator host instance '${key}' distance must be finite and non-negative.`);
    }
    entries.set(key, entry);
    plan();
    if (Object.keys(entry.equipment).length) onEquipment?.({ id: key, slots: { ...entry.equipment } });
    return handleFor(entry);
  }

  function handleFor(entry) {
    return {
      id: entry.id,
      player: entry.player,
      get root() { return entry.root; },
      get equipment() { return { ...entry.equipment }; },
      transition: (state, options) => entry.player.transition(state, options),
      play: (state, options) => entry.player.play(state, options),
      pause: () => entry.player.pause(),
      resume: () => entry.player.resume(),
      setEquipment: (slots) => setEquipment(entry.id, slots),
      getState: () => getState(entry.id),
      remove: () => remove(entry.id),
    };
  }

  function remove(id) {
    ensureLive();
    const key = String(id);
    const entry = entries.get(key);
    if (!entry) return false;
    entry.player.dispose();
    entries.delete(key);
    plan();
    return true;
  }

  function setDistance(id, distance) {
    ensureLive();
    const entry = entries.get(String(id));
    if (!entry) throw new Error(`Animator host instance '${id}' does not exist.`);
    const value = Number(distance);
    if (!Number.isFinite(value) || value < 0) throw new Error("Animator host distance must be finite and non-negative.");
    entry.distance = value;
    return plan().assigned.find((assignment) => assignment.id === entry.id) ?? null;
  }

  function setEquipment(id, slots = {}) {
    ensureLive();
    const entry = entries.get(String(id));
    if (!entry) throw new Error(`Animator host instance '${id}' does not exist.`);
    if (!slots || typeof slots !== "object" || Array.isArray(slots)) throw new Error("Animator host equipment must be an object.");
    entry.equipment = { ...slots };
    onEquipment?.({ id: entry.id, slots: { ...entry.equipment } });
    return { ...entry.equipment };
  }

  function transition(id, state, options) {
    ensureLive();
    const entry = entries.get(String(id));
    if (!entry) throw new Error(`Animator host instance '${id}' does not exist.`);
    return entry.player.transition(state, options);
  }

  function update(dt) {
    ensureLive();
    const delta = Number(dt);
    if (!Number.isFinite(delta) || delta < 0) throw new Error("Animator host update dt must be a finite non-negative number.");
    scheduler.tick(delta);
    for (const entry of entries.values()) {
      entry.elapsed += delta;
      if (!scheduler.shouldUpdate(entry.id)) continue;
      entry.player.update(entry.elapsed);
      entry.elapsed = 0;
    }
    return snapshot();
  }

  function getState(id) {
    ensureLive();
    const entry = entries.get(String(id));
    if (!entry) return null;
    return {
      id: entry.id,
      distance: entry.distance,
      lod: scheduler.levelFor(entry.id),
      equipment: { ...entry.equipment },
      animation: entry.player.getState(),
    };
  }

  function snapshot() {
    ensureLive();
    return {
      lod: scheduler.snapshot(),
      instances: [...entries.keys()].sort().map((id) => getState(id)),
      semantics: "presentation-only; instances3d/gameplay tick/collision/root motion are unchanged",
    };
  }

  function dispose() {
    if (disposed) return;
    for (const entry of entries.values()) entry.player.dispose();
    entries.clear();
    disposed = true;
  }

  return { attach, remove, setDistance, setEquipment, transition, update, getState, snapshot, dispose, scheduler };
}

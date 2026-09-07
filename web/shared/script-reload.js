function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function equalValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function specsById(manifest) {
  return new Map((manifest?.bundles ?? []).map((spec) => [spec.id, {
    ...spec,
    dependencies: spec.dependencies ?? [],
  }]));
}

/**
 * Describe whether a staged package changes only the hot-reloadable script.
 * The runner's live runtime contract can replace Luau source in place; it
 * cannot safely replace a scene, project systems/audio declaration, or an
 * asset archive while that session is running.
 */
export function inspectScriptOnlyUpdate(active, candidate) {
  const currentSpecs = specsById(active?.manifest);
  const nextSpecs = specsById(candidate?.manifest);
  const changedBundles = [];
  for (const id of new Set([...currentSpecs.keys(), ...nextSpecs.keys()])) {
    if (id === "script") continue;
    if (!equalValue(currentSpecs.get(id) ?? null, nextSpecs.get(id) ?? null)) changedBundles.push(id);
  }
  changedBundles.sort();

  const changedComponents = [];
  if (!equalValue(active?.config ?? null, candidate?.config ?? null)) changedComponents.push("project");
  if (!equalValue(active?.scene ?? null, candidate?.scene ?? null)) changedComponents.push("scene");
  if (!equalValue(active?.assetManifest ?? null, candidate?.assetManifest ?? null)) changedComponents.push("asset-manifest");

  const scriptHash = active?.generationState?.bundles?.script ?? null;
  const nextScriptHash = candidate?.generationState?.bundles?.script ?? null;
  return {
    supported: changedBundles.length === 0 && changedComponents.length === 0,
    scriptChanged: scriptHash !== nextScriptHash,
    changedBundles,
    changedComponents,
  };
}

export function assertScriptOnlyUpdate(active, candidate) {
  const inspection = inspectScriptOnlyUpdate(active, candidate);
  if (inspection.supported) return inspection;
  const changed = [
    ...inspection.changedBundles.map((id) => `bundle:${id}`),
    ...inspection.changedComponents.map((component) => `component:${component}`),
  ];
  const error = new Error(`BUNDLE_RELOAD_UNSUPPORTED_CHANGE: live runner supports script-only reload (${changed.join(", ")})`);
  error.diagnostic = {
    code: "BUNDLE_RELOAD_UNSUPPORTED_CHANGE",
    summary: "bundle reload contains unsupported non-script changes",
    explanation: "The generic runner can hot-reload only the script bundle; project, scene, asset-manifest, and content changes require a new session.",
    facts: {
      changed_bundles: inspection.changedBundles,
      changed_components: inspection.changedComponents,
      active_generation: active?.generationState?.generation ?? null,
      staged_generation: candidate?.generationState?.generation ?? null,
    },
  };
  throw error;
}

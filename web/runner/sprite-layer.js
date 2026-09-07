import {
  compareSpriteEntities,
  compareUtf8Ids,
  worldOf,
  worldSizeToView,
  worldToView,
} from "../shared/webgpu-snapshot.js?v=5";

function aspectOf(canvas) {
  const width = canvas?.clientWidth || canvas?.width || 16;
  const height = canvas?.clientHeight || canvas?.height || 9;
  return width / height;
}

function entityId(entity) {
  return String(entity?.id ?? "");
}

function assetIdOf(entity) {
  const asset = entity?.sprite?.asset;
  return asset == null ? null : String(asset);
}

function labelOf(entity) {
  return String(entity?.name || entityId(entity));
}

function fallbackElement(entity, message = "") {
  const fallback = document.createElement("div");
  fallback.className = "unone-asset-fallback";
  fallback.textContent = labelOf(entity);
  if (message) fallback.title = message;
  return fallback;
}

function missingAssetError(entity, assetId) {
  const reference = assetId == null || assetId.length === 0 ? "(absent)" : `'${assetId}'`;
  return {
    entity_id: entityId(entity),
    asset_id: assetId,
    code: "ASSET_ID_NOT_DECLARED",
    message: `sprite asset ${reference} is not declared in the active asset manifest`,
    diagnostic: null,
  };
}

function loadAssetError(entity, assetId, error) {
  const diagnostic = error?.diagnostic ?? null;
  return {
    entity_id: entityId(entity),
    asset_id: assetId,
    code: diagnostic?.code ?? "ASSET_LOAD_FAILED",
    message: diagnostic?.explanation ?? error?.message ?? String(error),
    diagnostic,
  };
}

function errorKey(error) {
  return error == null ? "" : JSON.stringify(error);
}

function spriteSpecs(assetManifest) {
  return new Map((assetManifest?.assets ?? []).map((asset) => [String(asset.id), asset]));
}

function assetSpecKey(asset) {
  if (!asset) return null;
  return {
    id: String(asset.id ?? ""),
    source: String(asset.source ?? ""),
    kind: String(asset.kind ?? ""),
    bundle: String(asset.bundle ?? ""),
    files: Array.isArray(asset.files) ? asset.files.map((file) => String(file)) : [],
  };
}

function declarationKey(assetManifest, assetId, asset) {
  return JSON.stringify({
    version: assetManifest == null ? null : (assetManifest.version ?? 1),
    asset_id: assetId,
    asset: assetSpecKey(asset),
  });
}

/**
 * Own the single ordinary-sprite DOM painter layer. The WebGPU runner can
 * suppress its matching 2D quads while this layer keeps image and fallback
 * sprites in one deterministic stacking order.
 */
export function createSpriteLayer({ element, loadAssetUrl, onAssetErrors = () => {} }) {
  const records = new Map();
  const errors = new Map();
  let lifecycleEpoch = 0;

  const notifyErrors = () => {
    onAssetErrors([...errors.values()].sort((left, right) => (
      compareUtf8Ids(left.entity_id, right.entity_id)
    )));
  };

  const setError = (record, nextError) => {
    const before = errorKey(record.error);
    const after = errorKey(nextError);
    record.error = nextError;
    if (nextError) errors.set(record.entityId, nextError);
    else errors.delete(record.entityId);
    if (before !== after) notifyErrors();
  };

  const createRecord = (entity, assetId, declaration) => {
    const wrapper = document.createElement("div");
    wrapper.className = "unone-asset-sprite";
    wrapper.draggable = false;
    wrapper.dataset.entityId = entityId(entity);
    if (assetId != null) wrapper.dataset.assetId = assetId;
    wrapper.replaceChildren(fallbackElement(entity));
    return {
      entityId: entityId(entity),
      assetId,
      declaration,
      entity,
      asset: null,
      wrapper,
      error: null,
      loadStarted: false,
      loadPending: false,
      lifecycleEpoch,
    };
  };

  const setGeometry = (record, entity, camera, aspect) => {
    const sprite = entity.sprite;
    const view = worldToView(entity.transform, camera, aspect);
    const extent = worldSizeToView(sprite.size ?? { x: 1, y: 1 }, camera, aspect, entity.scale);
    const rotation = entity.rotation ?? 0;
    record.wrapper.style.left = `${view.x}%`;
    record.wrapper.style.bottom = `${view.y}%`;
    record.wrapper.style.width = `${extent.x}%`;
    record.wrapper.style.height = `${extent.y}%`;
    record.wrapper.style.transform = `translate(-50%, 50%) rotate(${-rotation}rad)`;
    record.wrapper.dataset.layer = String(sprite.layer ?? 0);
    record.wrapper.dataset.assetId = record.assetId ?? "";
  };

  const showFallback = (record, entity, message = "") => {
    record.wrapper.replaceChildren(fallbackElement(entity, message));
  };

  const beginAssetLoad = (record, entity, asset) => {
    if (record.loadStarted || !asset) return;
    const loadEpoch = lifecycleEpoch;
    record.loadStarted = true;
    record.loadPending = true;
    let load;
    try {
      load = loadAssetUrl(asset);
    } catch (error) {
      load = Promise.reject(error);
    }
    return Promise.resolve(load)
      .then((url) => {
        record.loadPending = false;
        if (loadEpoch !== lifecycleEpoch || record.lifecycleEpoch !== loadEpoch || records.get(record.entityId) !== record) return;
        const image = document.createElement("img");
        image.className = "unone-asset-image";
        image.draggable = false;
        image.alt = labelOf(entity);
        image.src = url;
        record.wrapper.replaceChildren(image);
        setError(record, null);
      })
      .catch((error) => {
        record.loadPending = false;
        if (loadEpoch !== lifecycleEpoch || record.lifecycleEpoch !== loadEpoch || records.get(record.entityId) !== record) return;
        const nextError = loadAssetError(entity, record.assetId, error);
        showFallback(record, entity, nextError.message);
        setError(record, nextError);
      });
  };

  // A retry is deliberately caller-driven and performs at most one new
  // attempt per failed record. Ordinary renders never use this path.
  const retry = () => Promise.all([...records.values()]
    .filter((record) => record.error && record.asset && !record.loadPending)
    .map((record) => {
      record.loadStarted = false;
      return beginAssetLoad(record, record.entity, record.asset);
    }));

  const clear = () => {
    lifecycleEpoch += 1;
    records.clear();
    errors.clear();
    element?.replaceChildren();
    notifyErrors();
  };

  const render = (snapshot, assetManifest, canvas) => {
    if (!element) return;
    const world = worldOf(snapshot);
    const camera = world?.camera;
    if (!camera) {
      clear();
      return;
    }
    const specs = spriteSpecs(assetManifest);
    const aspect = aspectOf(canvas);
    const visibleEntities = Object.values(world.entities ?? {})
      .filter((entity) => entity.sprite && entity.sprite.visible !== false)
      .sort(compareSpriteEntities);
    const alive = new Set();
    const children = [];

    for (const entity of visibleEntities) {
      const id = entityId(entity);
      const assetId = assetIdOf(entity);
      const asset = assetId == null ? null : specs.get(assetId);
      const declaration = declarationKey(assetManifest, assetId, asset);
      let record = records.get(id);
      if (!record || record.assetId !== assetId || record.declaration !== declaration) {
        record = createRecord(entity, assetId, declaration);
        records.set(id, record);
      }
      alive.add(id);
      record.entity = entity;
      record.asset = asset;
      setGeometry(record, entity, camera, aspect);
      if (!asset) {
        const nextError = missingAssetError(entity, assetId);
        showFallback(record, entity, nextError.message);
        setError(record, nextError);
      } else {
        beginAssetLoad(record, entity, asset);
      }
      children.push(record.wrapper);
    }

    for (const [id, record] of records) {
      if (alive.has(id)) continue;
      records.delete(id);
      errors.delete(id);
    }
    element.replaceChildren(...children);
    notifyErrors();
  };

  return { render, clear, retry };
}

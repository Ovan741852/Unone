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

/**
 * Own the single ordinary-sprite DOM painter layer. The WebGPU runner can
 * suppress its matching 2D quads while this layer keeps image and fallback
 * sprites in one deterministic stacking order.
 */
export function createSpriteLayer({ element, loadAssetUrl, onAssetErrors = () => {} }) {
  const records = new Map();
  const errors = new Map();

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

  const createRecord = (entity, assetId) => {
    const wrapper = document.createElement("div");
    wrapper.className = "unone-asset-sprite";
    wrapper.draggable = false;
    wrapper.dataset.entityId = entityId(entity);
    if (assetId != null) wrapper.dataset.assetId = assetId;
    wrapper.replaceChildren(fallbackElement(entity));
    return {
      entityId: entityId(entity),
      assetId,
      wrapper,
      error: null,
      loadStarted: false,
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
    record.loadStarted = true;
    loadAssetUrl(asset)
      .then((url) => {
        if (records.get(record.entityId) !== record) return;
        const image = document.createElement("img");
        image.className = "unone-asset-image";
        image.draggable = false;
        image.alt = labelOf(entity);
        image.src = url;
        record.wrapper.replaceChildren(image);
        setError(record, null);
      })
      .catch((error) => {
        if (records.get(record.entityId) !== record) return;
        const nextError = loadAssetError(entity, record.assetId, error);
        showFallback(record, entity, nextError.message);
        setError(record, nextError);
      });
  };

  const render = (snapshot, assetManifest, canvas) => {
    if (!element) return;
    const world = worldOf(snapshot);
    const camera = world?.camera;
    if (!camera) {
      element.replaceChildren();
      records.clear();
      errors.clear();
      notifyErrors();
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
      let record = records.get(id);
      if (!record || record.assetId !== assetId) {
        record = createRecord(entity, assetId);
        records.set(id, record);
      }
      alive.add(id);
      setGeometry(record, entity, camera, aspect);
      const asset = assetId == null ? null : specs.get(assetId);
      if (!asset) {
        const nextError = missingAssetError(entity, assetId);
        showFallback(record, entity, nextError.message);
        setError(record, nextError);
      } else {
        setError(record, null);
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

  const clear = () => {
    records.clear();
    errors.clear();
    element?.replaceChildren();
    notifyErrors();
  };

  return { render, clear };
}

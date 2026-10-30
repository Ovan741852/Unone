import { spriteCellRect } from "../shared/webgpu-snapshot.js";

// Reused for every sprite: a cell step must not allocate in the draw loop.
const cell = {};

/**
 * Point a sprite record's mesh at the geometry for its sheet cell.
 *
 * Sprites without a sheet share one plane. A sheet sprite owns a clone of it
 * whose uv is rewritten only when the sheet or cell changes, so an animation
 * costs one small uv upload per cell step rather than per frame, and the
 * shared texture is never offset. Three's plane uv has v=1 at the image top
 * (sprite textures use flipY), so the image-space cell is flipped here.
 * Shader materials therefore see the cell's uv, not the whole sheet's.
 */
export function syncSpriteCell(record, sprite, shared) {
  const sheet = sprite.sheet;
  if (!sheet) {
    record.cellGeometry?.dispose();
    record.cellGeometry = null;
    record.mesh.geometry = shared;
    return;
  }
  const frame = sprite.frame ?? 0;
  if (!record.cellGeometry) {
    record.cellGeometry = shared.clone();
    record.cellFrame = -1;
  }
  if (record.cellColumns !== sheet.columns || record.cellRows !== sheet.rows || record.cellFrame !== frame) {
    spriteCellRect(sprite, cell);
    const base = shared.attributes.uv;
    const uv = record.cellGeometry.attributes.uv;
    for (let index = 0; index < uv.count; index += 1) {
      uv.setXY(index, cell.u + base.getX(index) * cell.du, 1 - cell.v - cell.dv + base.getY(index) * cell.dv);
    }
    uv.needsUpdate = true;
    record.cellColumns = sheet.columns;
    record.cellRows = sheet.rows;
    record.cellFrame = frame;
  }
  record.mesh.geometry = record.cellGeometry;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../vendor/three/three.module.js';
import {syncSpriteCell} from './sprite-cells.js';
import {spriteCellRect, texturedSpriteVertices} from '../shared/webgpu-snapshot.js';

const corners = geometry => [0, 1, 2, 3].map(index => [geometry.attributes.uv.getX(index), geometry.attributes.uv.getY(index)]);

test('a sheet sprite draws its cell through its own uv, rewritten only when the cell changes', () => {
  const shared = new THREE.PlaneGeometry(1, 1);
  const before = corners(shared);
  const record = {mesh: {geometry: shared}};
  syncSpriteCell(record, {asset: 'a', sheet: {columns: 4, rows: 2}, frame: 6}, shared);
  const own = record.mesh.geometry;
  assert.notEqual(own, shared);
  // Cell 6 is column 2 of the bottom row. Three's plane uv has v=1 at the image
  // top, so the bottom half of the sheet spans v 0..0.5.
  assert.deepEqual(corners(own), [[0.5, 0.5], [0.75, 0.5], [0.5, 0], [0.75, 0]]);
  assert.deepEqual(corners(shared), before, 'the shared plane is never modified');
  const version = own.attributes.uv.version;
  syncSpriteCell(record, {asset: 'a', sheet: {columns: 4, rows: 2}, frame: 6}, shared);
  assert.equal(own.attributes.uv.version, version, 'an unchanged cell uploads nothing');
  syncSpriteCell(record, {asset: 'a', sheet: {columns: 4, rows: 2}, frame: 1}, shared);
  assert.equal(record.mesh.geometry, own, 'stepping cells reuses the record geometry');
  assert.equal(own.attributes.uv.version, version + 1);
  assert.deepEqual(corners(own), [[0.25, 1], [0.5, 1], [0.25, 0.5], [0.5, 0.5]]);
  let disposed = 0;
  own.addEventListener('dispose', () => disposed++);
  syncSpriteCell(record, {asset: 'b'}, shared);
  assert.equal(record.mesh.geometry, shared, 'a sprite without a sheet shares the plane again');
  assert.equal(disposed, 1);
  assert.equal(record.cellGeometry, null);
});

test('cell rectangles match the fixture shared with the engine SpriteData::cell_rect', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../docs/fixtures/sprite-cells.json', import.meta.url), 'utf8'));
  for (const {sprite, rect} of fixture.cases) {
    const {u, v, du, dv} = spriteCellRect(sprite);
    [u, v, du, dv].forEach((value, index) => assert.ok(Math.abs(value - rect[index]) < 1e-6, JSON.stringify(sprite)));
  }
});

test('the shared cell rectangle is image space and rejects cells outside the sheet', () => {
  assert.deepEqual(spriteCellRect({asset: 'a'}), {columns: 1, rows: 1, column: 0, row: 0, u: 0, v: 0, du: 1, dv: 1});
  assert.deepEqual(spriteCellRect({asset: 'a', sheet: {columns: 4, rows: 2}}), {columns: 4, rows: 2, column: 0, row: 0, u: 0, v: 0, du: 0.25, dv: 0.5});
  const out = {};
  assert.equal(spriteCellRect({asset: 'a', sheet: {columns: 4, rows: 2}, frame: 5}, out), out, 'a caller-owned object is filled, not replaced');
  assert.deepEqual(out, {columns: 4, rows: 2, column: 1, row: 1, u: 0.25, v: 0.5, du: 0.25, dv: 0.5});
  for (const frame of [8, -1, 1.5]) {
    assert.throws(() => spriteCellRect({asset: 'a', sheet: {columns: 4, rows: 2}, frame}), /SPRITE_SHEET_INVALID/);
  }
  assert.throws(() => spriteCellRect({asset: 'a', sheet: {columns: 0, rows: 2}}), /SPRITE_SHEET_INVALID/);
});

test('raw WebGPU sprite vertices sample the cell with v pointing down', () => {
  const world = {camera: {position: {x: 0, y: 0}, zoom: 1, view_height: 10}};
  const entity = {id: 'x', transform: {x: 0, y: 0}, sprite: {asset: 'a', sheet: {columns: 2, rows: 2}, frame: 1}};
  const data = texturedSpriteVertices(entity, world, 1);
  const uvs = [];
  for (let index = 0; index < 6; index += 1) uvs.push([data[index * 8 + 2], data[index * 8 + 3]]);
  // Bottom-left, bottom-right, top-right, bottom-left, top-right, top-left of
  // the top-right cell.
  assert.deepEqual(uvs, [[0.5, 0.5], [1, 0.5], [1, 0], [0.5, 0.5], [1, 0], [0.5, 0]]);
});

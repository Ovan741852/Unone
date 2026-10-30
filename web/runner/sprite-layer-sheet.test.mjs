import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpriteLayer} from './sprite-layer.js?v=3';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = '';
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

globalThis.document = {createElement: tagName => new FakeElement(tagName)};

test('a DOM sheet sprite clips its image to the observed cell and resets without a sheet', async () => {
  const root = new FakeElement('div');
  const layer = createSpriteLayer({element: root, loadAssetUrl: asset => Promise.resolve(`blob:${asset.id}`)});
  const manifest = {assets: [{id: 'asset://hero', source: 'hero.png', kind: 'texture2d'}]};
  const canvas = {clientWidth: 800, clientHeight: 600};
  const render = sprite => layer.render({world: {camera: {position: {x: 0, y: 0}, zoom: 1, view_height: 10},
    entities: {hero: {id: 'hero', transform: {x: 0, y: 0}, sprite}}}}, manifest, canvas);
  render({asset: 'asset://hero', sheet: {columns: 4, rows: 2}, frame: 6});
  await Promise.resolve();
  await Promise.resolve();
  const wrapper = root.children[0];
  const image = wrapper.children[0];
  assert.equal(image.className, 'unone-asset-image');
  assert.equal(wrapper.style.overflow, 'hidden');
  assert.deepEqual(
    [image.style.position, image.style.width, image.style.height, image.style.left, image.style.top, image.style.maxWidth, image.style.objectFit],
    ['absolute', '400%', '200%', '-200%', '-100%', 'none', 'fill'],
  );
  render({asset: 'asset://hero', sheet: {columns: 4, rows: 2}, frame: 1});
  assert.equal(root.children[0].children[0], image, 'stepping cells keeps the loaded image');
  assert.deepEqual([image.style.left, image.style.top], ['-100%', '0%']);
  render({asset: 'asset://hero'});
  assert.equal(wrapper.style.overflow, '');
  assert.deepEqual([image.style.position, image.style.width, image.style.left, image.style.objectFit], ['', '', '', '']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import * as bundle from '../vendor/three/three.player.min.js';

// The official player loads a trimmed Three bundle (scripts/build-three-player.mjs).
// Renderer tests import the full build, so a name the renderer starts using
// would be undefined only in the shipped player: rebuild the bundle when this fails.
test('the player Three bundle exports every Three name the renderer references',()=>{
  const directory=new URL('./',import.meta.url),names=new Set();
  for(const file of readdirSync(directory).filter(file=>file.endsWith('.js')))
    for(const match of readFileSync(new URL(file,directory),'utf8').matchAll(/THREE\.([A-Za-z0-9_]+)/g))
      if(match[1]!=='WebGPURenderer')names.add(match[1]);
  const missing=[...names].filter(name=>!(name in bundle)).sort();
  assert.deepEqual(missing,[],'run node scripts/build-three-player.mjs');
});

import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {module,payload,loadProject,readObservation} from './runtime-harness.mjs';
const fixture=readFileSync(new URL('./spear-landing-fixtures.luau',import.meta.url),'utf8');
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const checks=readObservation(module).world.observations.spear_landing_checks;
assert.ok(checks>=30);writeFileSync(new URL('../tests/spear-landing.json',import.meta.url),JSON.stringify({ok:true,checks,scope:'In-memory deterministic fixtures using production WASM and Luau, not exported gameplay'},null,2));
console.log('PASS '+checks+' landing regression checks in actual WASM');

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SKILL_VFX} from '../presentation/skill-vfx.mjs';

const main=readFileSync(new URL('../main.luau',import.meta.url),'utf8');
const gearBlock=main.slice(main.indexOf('local gearCatalog={'),main.indexOf('local function canStoreItem'));
const extendedBlock=main.slice(main.indexOf('// Every skill has a concrete equipment source'),main.indexOf('local function canStoreItem'));
const ids=[...gearBlock.matchAll(/skill="([^"]+)"/g),...extendedBlock.matchAll(/\{"[^"]+",\d+,"([^"]+)"/g)].map(match=>match[1]);
const unique=[...new Set(ids)];
assert.ok(unique.length>40,'equipment skill catalog unexpectedly shrank');
const missing=unique.filter(id=>!SKILL_VFX[id]);
assert.deepEqual(missing,[],'every equipment skill needs a visual language');
assert.match(main,/skillFx=t\.skills\.vfxSkills/,'Luau must publish equipped skill receipts');
const fx=readFileSync(new URL('../presentation/combat-fx.mjs',import.meta.url),'utf8');
assert.match(fx,/skillAttunements/,'combat renderer must draw persistent equipment attunements');
assert.match(fx,/Number\.isFinite\(sx\)/,'lightning must include a caster release tell');
console.log(`PASS ${unique.length} equipment skills have VFX coverage; caster receipts and persistent attunements wired`);


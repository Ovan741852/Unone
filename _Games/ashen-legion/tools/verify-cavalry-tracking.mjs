import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {module,payload,loadProject,readObservation,tick} from './runtime-harness.mjs';
const fixture=readFileSync(new URL('cavalry-tracking-fixtures.luau',import.meta.url),'utf8');
loadProject(module,{...payload,script:payload.script.replace('return Game',fixture+'\nreturn Game')},42n);
const observed=readObservation(module).world.observations;
assert.ok(observed.tracking_checks>=40,'all tracking assertions ran');
console.log('PASS',observed.tracking_checks,'actual WASM tracking checks',observed.tracking_reports);
// Unmodified gameplay: use the same AUTO species menu and LOCK toggle as a player.
const runs=[];
for(const lock of [false,true]){
 loadProject(module,payload,42n);
 const action=name=>{tick({actions:{[name]:true}});tick({});};
 action('Start');for(let i=0;i<92;i++)tick({});action('Choice1');action('LeaveShop');action('Unit3');
 if(lock)action('Mode_lock');
 action('Mode_auto');action('Auto_none');action('Auto_target_elder');action('Auto_apply');
 let s;for(let i=0;i<700;i++)s=tick({});
 assert.ok(s.fired>0&&s.contactHits>0&&s.bounces>0);
 assert.equal(s.lockEnabled,lock);assert.equal(s.autoEnabled,true);assert.equal(s.lockViolations,0);
 action('Pause');const held=tick({});for(let i=0;i<30;i++)s=tick({});assert.deepEqual(s.visualTroops,held.visualTroops);
 runs.push({lock,fired:s.fired,contacts:s.contactHits,bounces:s.bounces,expired:s.expired});
}
console.log('PASS production AUTO / AUTO+LOCK, pause, conservation and bounds',runs);
const out=new URL('../tests/cavalry-tracking/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('runtime-report.json',out),JSON.stringify({sourceSha256:createHash('sha256').update(payload.script).digest('hex'),scope:'Actual WASM: controlled moving-tree/lifetime fixtures plus unmodified production semantic input runs.',checks:observed.tracking_checks,fixtures:observed.tracking_reports,runs},null,2));

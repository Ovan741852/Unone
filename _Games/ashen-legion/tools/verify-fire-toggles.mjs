import {module,payload,tick,loadProject,readObservation} from './runtime-harness.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const state=()=>readObservation(module).world.observations.game;
const step=(n=2,input={})=>{for(let i=0;i<n;i++)tick(input);return state();};
const action=a=>{tick({actions:{[a]:true}});return step();};
loadProject(module,payload,1n);action('Start');step(92);action('Choice1');action('LeaveShop');
const checks=[];function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
check('LOCK toggles on/off; held button only changes once and OFF stops dispatch',()=>{
 action('Mode_lock');assert.equal(state().lockEnabled,true);assert.equal(state().autoEnabled,false);
 const m=state().monsters[0];step(2,{pointer:{position:{x:m.x,y:m.z},down:true}});assert.ok(state().targetId>0);assert.ok(state().fired>0);
 step(20,{actions:{Mode_lock:true}});assert.equal(state().lockEnabled,false);const fired=state().fired;step(40);assert.equal(state().fired,fired);assert.equal(state().targetId,0);
});
check('AUTO opens setup before enabling; second press disables directly',()=>{
 action('Mode_auto');assert.equal(state().autoConfigOpen,true);assert.equal(state().autoEnabled,false);
 action('Auto_apply');assert.equal(state().autoEnabled,true);assert.equal(state().autoConfigOpen,false);step(30);
 action('Mode_auto');const s=state();assert.equal(s.autoEnabled,false);assert.equal(s.autoConfigOpen,false);step(30);assert.equal(state().fired,s.fired);
});
check('Both switches can be ON; AUTO selects species and LOCK binds dispatched troops',()=>{
 action('Mode_lock');action('Mode_auto');action('Auto_none');action('Auto_target_acorn');action('Auto_apply');
 assert.equal(state().lockEnabled,true);assert.equal(state().autoEnabled,true);const before=state().fired;step(40);assert.ok(state().fired>before);
 if(state().targetId)assert.equal(state().targetName,'橡果蹦蹦');
 // Inspect real troop observations through a read-only fixture observation below.
});
check('Disabling LOCK keeps AUTO running; disabling AUTO keeps LOCK',()=>{
 action('Mode_lock');assert.equal(state().lockEnabled,false);assert.equal(state().autoEnabled,true);
 action('Mode_lock');action('Mode_auto');assert.equal(state().lockEnabled,true);assert.equal(state().autoEnabled,false);assert.equal(state().autoConfigOpen,false);
 action('Mode_lock');assert.equal(state().lockEnabled,false);const fired=state().fired;step(30);assert.equal(state().fired,fired);
});
check('Settings cancel and stop preserve the independent LOCK toggle',()=>{
 action('Mode_lock');action('Mode_auto');action('Auto_cancel');assert.equal(state().lockEnabled,true);assert.equal(state().autoEnabled,false);
 action('Mode_auto');action('Auto_apply');action('Auto_settings');assert.equal(state().autoEnabled,true);
 action('Auto_stop');assert.equal(state().autoEnabled,false);assert.equal(state().lockEnabled,true);
 action('Mode_lock');step(20,{actions:{Mode_auto:true}});assert.equal(state().autoConfigOpen,true);assert.equal(state().autoEnabled,false);action('Auto_cancel');
});
check('Hidden paused actions are consumed without delayed toggles; new run resets both',()=>{
 action('Pause');action('Mode_lock');assert.equal(state().lockEnabled,false);action('Pause');assert.equal(state().lockEnabled,false);
 action('Mode_lock');action('Home');assert.equal(state().lockEnabled,false);assert.equal(state().autoEnabled,false);
});
// Add read-only instrumentation to inspect actual target bindings, with no mutation
// of troops, combat, random state, or input. Production behavior is otherwise identical.
const instrumented={...payload,script:payload.script.replace('api.observation.set("game",S)','api.observation.set("test_live_troops",troops)\n api.observation.set("game",S)')};
loadProject(module,instrumented,1n);action('Start');step(92);action('Choice1');action('LeaveShop');action('Mode_lock');action('Mode_auto');action('Auto_apply');step(12);
const live=readObservation(module).world.observations.test_live_troops;assert.ok(live.length>0);assert.ok(live.every(t=>t.targetId>0));
action('Mode_lock');step(25);const mixed=readObservation(module).world.observations.test_live_troops;assert.ok(mixed.some(t=>t.targetId===0),'new unlocked AUTO troops allow incidental contacts');
checks.push('Real spawned troops bind targets with LOCK+AUTO; new AUTO-only troops do not');
writeFileSync(new URL('../tests/fire-toggles.json',import.meta.url),JSON.stringify({ok:true,checks},null,2));

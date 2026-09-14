// Production WASM, semantic input only: no state injection or substitute combat.
import {module,payload,tick,loadProject,readObservation} from './runtime-harness.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const state=()=>readObservation(module).world.observations.game;
const step=(n=2,input={})=>{for(let i=0;i<n;i++)tick(input);return state();};
const action=name=>{tick({actions:{[name]:true}});return step();};
function battle(){loadProject(module,payload,1n);action('Start');step(92);action('Choice1');action('LeaveShop');assert.equal(state().phase,'battle');}
const checks=[];function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
battle();
check('Opening AUTO pauses all combat without activating or spending',()=>{
 const before=state();action('Auto_settings');const opened=state();assert.equal(opened.autoConfigOpen,true);assert.equal(opened.paused,true);assert.equal(opened.fireMode,'manual');
 step(120,{pointer:{position:{x:0,y:0},down:true},actions:{Space:true}});
 assert.equal(state().time,opened.time);assert.equal(state().rewardClock,opened.rewardClock);assert.equal(state().fired,before.fired);assert.equal(state().coins,before.coins);
});
check('Empty selection cannot start, including direct semantic input',()=>{
 action('Auto_none');assert.equal(Object.values(state().autoDraft).filter(Boolean).length,0);action('Auto_apply');assert.equal(state().autoConfigOpen,true);assert.equal(state().fireMode,'manual');
});
check('Multiselect and held toggles are stable; cancel discards draft',()=>{
 action('Auto_target_acorn');action('Auto_target_piglet');step(30,{actions:{Auto_target_moth:true}});assert.equal(Object.values(state().autoDraft).filter(Boolean).length,3);
 action('Auto_cancel');assert.equal(state().paused,false);assert.equal(state().autoConfigOpen,false);assert.equal(Object.values(state().autoTargets).filter(Boolean).length,10);
});
check('Absent selected species waits free, then automatically acquires arriving boss',()=>{
 action('Auto_settings');action('Auto_none');action('Auto_target_stag');action('Auto_apply');const before=state();assert.equal(before.fireMode,'auto');assert.equal(before.targetId,0);
 // Boss is naturally spawned in the last 30 seconds; hordes and specials remain unselected.
 for(let i=0;i<8600;i++){const s=step(1);assert.equal(s.fired,before.fired);assert.equal(s.coins,before.coins);assert.equal(s.targetId,0);}
 let found=false;for(let i=0;i<700;i++){const s=step(1);if(s.fired>before.fired){assert.equal(s.targetName,'冠角白鹿');found=true;break;}}assert.ok(found);
});
battle();
check('Selecting one species restricts AUTO aim; changing selection discards old target',()=>{
 action('Auto_settings');action('Auto_none');action('Auto_target_acorn');action('Auto_apply');
 for(let i=0;i<150;i++){const s=step(1);if(s.targetId)assert.equal(s.targetName,'橡果蹦蹦');}assert.ok(state().fired>0);
 action('Auto_settings');action('Auto_none');action('Auto_target_piglet');action('Auto_apply');
 for(let i=0;i<90;i++){const s=step(1);if(s.targetId)assert.equal(s.targetName,'菇背幼豬');}
 const prior={...state().autoTargets};action('Auto_settings');action('Auto_all');action('Escape');assert.equal(state().fireMode,'auto');assert.deepEqual(state().autoTargets,prior);
});
check('Presets separate small, bosses, and special creatures',()=>{
 action('Auto_settings');action('Auto_small');assert.equal(Object.values(state().autoDraft).filter(Boolean).length,4);
 action('Auto_boss');assert.equal(Object.values(state().autoDraft).filter(Boolean).length,4);assert.equal(state().autoDraft.beetle,false);
 action('Auto_special');assert.equal(Object.values(state().autoDraft).filter(Boolean).length,2);assert.equal(state().autoDraft.beetle,true);assert.equal(state().autoDraft.wheel,true);
 action('Auto_all');assert.equal(Object.values(state().autoDraft).filter(Boolean).length,10);action('Auto_stop');assert.equal(state().fireMode,'manual');assert.equal(state().paused,false);
});
battle();
check('Closing modal while holding fire requires release before manual dispatch',()=>{
 action('Auto_settings');const before=state().fired;
 tick({actions:{Auto_cancel:true,Space:true},pointer:{position:{x:0,y:0},down:true}});
 step(30,{actions:{Space:true},pointer:{position:{x:0,y:0},down:true}});assert.equal(state().fired,before);
 step();step(20,{actions:{Space:true}});assert.ok(state().fired>before);
});
battle();
check('Hidden modal actions cannot alter gameplay; normal pause and LOCK still work',()=>{
 action('Auto_none');assert.equal(Object.values(state().autoTargets).filter(Boolean).length,10);
 action('Pause');action('Auto_settings');assert.equal(state().autoConfigOpen,false);assert.equal(state().paused,true);action('Pause');
 action('Mode_lock');const target=state().monsters[0];step(2,{pointer:{position:{x:target.x,y:target.z},down:true}});assert.equal(state().fireMode,'lock');assert.ok(state().targetId>0);assert.ok(state().fired>0);
});
writeFileSync(new URL('../tests/auto-targets-runtime.json',import.meta.url),JSON.stringify({ok:true,scope:'Actual production Unone WASM, input-only, conservation and bounds asserted each frame',checks},null,2));

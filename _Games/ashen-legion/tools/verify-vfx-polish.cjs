const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/vfx-polish');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto('http://127.0.0.1:8190/?build=skill-vfx-v1&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 const tests=await page.evaluate(async()=>{
  const T=await import('/presentation/vendor/build/three.module.js'),{createCombatFX}=await import('/presentation/combat-fx.mjs');
  const scene=new T.Scene(),fx=createCombatFX(scene),types=['lightning','frost','ember','leaf','cleave','shock'];
  const state={round:1,phase:'battle',rewardClock:1.15,vfx:types.map((kind,i)=>({id:i+1,kind,x:0,z:0,tx:2,tz:1,radius:2,time:1})),skillRuntime:{buffs:[{id:99,kind:'frost',phase:'active',age:.4,x:0,z:0,remaining:.8,radius:.65}]},visualTroops:[],damageEvents:[]};
  const freeze=x=>{Object.freeze(x);for(const v of Object.values(x))if(v&&typeof v==='object')freeze(v)};freeze(state);
  fx.update(state);const first=fx.inspect(),objects=scene.children.slice(),buffers=objects.map(m=>m.geometry.attributes.position.array);
  const shape=()=>JSON.stringify(scene.children.map(m=>Array.from(m.geometry.attributes.position.array.slice(0,m.geometry.drawRange.count*3))));const a=shape();fx.update(state);
  const paused=a===shape(),unchangedBuffers=objects.every((m,i)=>m.geometry.attributes.position.array===buffers[i]);
  const stress={...state,vfx:Array.from({length:300},(_,i)=>({...state.vfx[i%6],id:i+100})),visualTroops:Array.from({length:250},(_,i)=>({id:i,k:3,x:i%10,z:0,state:'run',y:0,bounces:0}))};
  fx.update(stress);fx.update({...stress,rewardClock:1.2,visualTroops:stress.visualTroops.map(t=>({...t,z:1}))});const budget=fx.inspect();
  fx.update({...stress,rewardClock:1.22,visualTroops:stress.visualTroops.map(t=>({...t,z:1.1,bounces:1}))});const bounce=fx.inspect();
  fx.update({round:1,phase:'battle',rewardClock:4,visualTroops:[]});const expired=fx.inspect();
  const moved={round:1,phase:'battle',rewardClock:5,visualTroops:[{id:1,k:3,x:0,z:0,bounces:0,state:'run'}]};fx.update(moved);fx.update({...moved,rewardClock:5.1,visualTroops:[{...moved.visualTroops[0],z:1}]});
  fx.update({round:2,phase:'choice',rewardClock:0});const reset=fx.inspect();
  const dispose=[];objects.forEach(m=>{m.geometry.addEventListener('dispose',()=>dispose.push('geometry'));m.material.addEventListener('dispose',()=>dispose.push('material'))});fx.dispose();fx.dispose();
  const rm=createCombatFX(scene,{reducedMotion:()=>true});rm.update(state);const reduced=rm.inspect();rm.dispose();
  return {first,paused,unchangedBuffers,budget,bounce,expired,reset,dispose,childrenAfterDispose:scene.children.length,reduced};
 });
 assert.equal(tests.paused,true);assert.equal(tests.unchangedBuffers,true);assert.equal(Object.keys(tests.first.kinds).length,7);assert.equal(tests.first.kinds['buff:frost'],1);assert.equal(tests.first.kinds['frost'],1);assert.equal(tests.budget.activeEvents,36);assert.ok(tests.budget.trailSlots<=64);assert.ok(tests.budget.drawCalls<=2);assert.equal(tests.budget.ink.droppedTriangles+tests.budget.core.droppedTriangles,0);assert.equal(tests.bounce.trailSegments,0);assert.equal(tests.expired.drawCalls,0);assert.equal(tests.reset.drawCalls,0);assert.equal(tests.childrenAfterDispose,0);assert.equal(tests.dispose.length,4);assert.equal(tests.reduced.reducedMotion,true);
 async function action(name){await page.evaluate(a=>ashen.action(a),name);await page.waitForTimeout(90)}
 await action('Start');await page.waitForFunction(()=>ashen.state().phase==='menu');await action('Profile1');await page.waitForTimeout(120);await action('LaunchExpedition');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('ViewMap');await action('VisitLocation');
 await page.waitForFunction(()=>ashen.state().phase==='choice');const market=await page.evaluate(()=>Object.values(ashen.state().cards).findIndex(c=>c.id==='market'));assert.ok(market>=0);await action('Choice'+(market+1));await page.waitForFunction(()=>ashen.state().phase==='shop');await action('LeaveShop');await page.waitForFunction(()=>ashen.state().phase==='loadout');await action('Deploy');await page.waitForFunction(()=>ashen.state().phase==='battle');await action('Unit2');await action('Mode_auto');await action('Auto_apply');
 await page.waitForFunction(()=>ashen.metrics().actors.combatFX.kinds.spin>0,null,{timeout:20000});
 await page.screenshot({path:path.join(out,'production-spear.png')});
 await action('Pause');const held=await page.evaluate(()=>ashen.metrics().actors.combatFX.clock);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>ashen.metrics().actors.combatFX.clock),held);await action('Pause');
 await page.evaluate(()=>ashen.setBloom(false));await page.waitForFunction(()=>ashen.metrics().actors.combatFX.kinds.spin>0,null,{timeout:20000});await page.screenshot({path:path.join(out,'production-no-bloom.png')});await page.evaluate(()=>ashen.setBloom(true));
 const live=await page.evaluate(()=>({phase:ashen.state().phase,fired:ashen.state().fired,spinHits:ashen.state().spinHits,fx:ashen.metrics().actors.combatFX}));assert.ok(live.fired>0);
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(400);const mobile=await page.evaluate(()=>ashen.metrics());assert.equal(mobile.actors.combatFX.reducedMotion,true);assert.deepEqual(mobile.ui.diagnostics,[]);await page.screenshot({path:path.join(out,'production-mobile.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({ok:true,tests,live,mobileFx:mobile.actors.combatFX,errors},null,2));console.log('PASS VFX read-only/frozen clock, shared buffers, dense budget, bounce reset, expiry, disposal, actual firing and mobile/reduced motion');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

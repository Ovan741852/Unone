const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/skill-lifecycle');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:1440,height:810},recordVideo:{dir:out,size:{width:1440,height:810}}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const action=async name=>{await page.evaluate(n=>ashen.action(n),name);await page.waitForTimeout(140)};
 await page.goto('http://127.0.0.1:8190/?build=skill-lifecycle-v1&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 await action('UI_builds');for(let i=0;i<3;i++)await action('UI_page_next');
 const ui=await page.evaluate(()=>({tree:ashen.uiTree(),diagnostics:ashen.metrics().ui.diagnostics}));
 assert.ok(JSON.stringify(ui.tree).includes('餘火巡獵')&&JSON.stringify(ui.tree).includes('疾走鍊金'));assert.deepEqual(ui.diagnostics,[]);
 await page.screenshot({path:path.join(out,'new-builds-landscape.png')});
 // Test the actual last-page purchase recommendation, without changing stock or funds.
 await action('Build10');await action('UI_home');await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');
 await action('Choice1');const shop=await page.evaluate(()=>ashen.state());assert.equal(shop.location,'market');assert.equal(shop.stock[0].skill,'flame_cloak');
 await page.screenshot({path:path.join(out,'new-equipment-shop.png')});
 const draw=await page.evaluate(async()=>{
  const T=await import('/presentation/vendor/build/three.module.js'),{createCombatFX}=await import('/presentation/combat-fx.mjs');const scene=new T.Scene(),fx=createCombatFX(scene);
  const state={round:1,phase:'battle',rewardClock:2,skillRuntime:{casts:[{id:1,kind:'flame_cloak',phase:'channel',age:.4,x:-4,z:0,radius:2},{id:2,kind:'phoenix_fire',phase:'windup',age:.18,x:0,z:0}],entities:[{id:3,kind:'phoenix_fire',phase:'flight',age:.15,x:1,z:0,tx:3,tz:2,y:.8},{id:4,kind:'plague_vial',phase:'flight',age:.2,x:2,z:1,tx:3,tz:3,y:1.3},{id:5,kind:'plague_vial',phase:'active',age:1,x:4,z:0,radius:1.8}],buffs:[{id:6,kind:'burn',phase:'active',age:.4,x:2,z:0},{id:7,kind:'poison',phase:'active',age:.5,x:4,z:0}]}};
  const freeze=o=>{Object.freeze(o);for(const v of Object.values(o))if(v&&typeof v==='object')freeze(v)};freeze(state);fx.update(state);
  const first=fx.inspect(),buffers=scene.children.map(m=>m.geometry.attributes.position.array);const geometry=()=>JSON.stringify(scene.children.map(m=>Array.from(m.geometry.attributes.position.array.slice(0,m.geometry.drawRange.count*3))));const before=geometry();fx.update(state);const stable=before===geometry();
  const stress={...state,skillRuntime:Object.fromEntries(Object.entries(state.skillRuntime).map(([k,items])=>[k,Array.from({length:200},(_,i)=>({...items[i%items.length],id:i+1}))]))};fx.update(stress);const budget=fx.inspect(),sameBuffers=scene.children.every((m,i)=>m.geometry.attributes.position.array===buffers[i]);
  fx.update({...state,phase:'clear',skillRuntime:{}});const cleared=fx.inspect();fx.dispose();
  return {first,stable,budget,sameBuffers,cleared};
 });
 assert.ok(draw.first.kinds['cast:flame_cloak']&&draw.first.kinds['effect:phoenix_fire']&&draw.first.kinds['effect:plague_vial']&&draw.first.kinds['buff:poison']);
 assert.equal(draw.stable,true);assert.equal(draw.sameBuffers,true);assert.ok(draw.budget.activeEvents<=36&&draw.budget.drawCalls<=2);assert.equal(draw.budget.ink.droppedTriangles+draw.budget.core.droppedTriangles,0);assert.equal(draw.cleared.drawCalls,0);
 // Controlled loadout only; damage, selection, motion, lifecycle and payout run in production Luau.
 await page.route('**/content/project.json',async route=>{const response=await route.fetch(),payload=await response.json();payload.script=payload.script.replace('local function beginBattle()',`local function beginBattle()
 S.selected=3
 for _,def in ipairs(gearCatalog)do if def.skill=="flame_cloak" or def.skill=="phoenix_fire" or def.skill=="plague_vial"then addItem(def,0);S.worn[3][def.slot]=S.items[#S.items].id end end`);await route.fulfill({response,json:payload})});
 await page.goto('http://127.0.0.1:8190/?build=skill-lifecycle-capture&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');await action('LeaveShop');await action('Mode_auto');await action('Auto_apply');
 await page.waitForFunction(()=>ashen.state().procHits>0&&Object.values(ashen.state().skillRuntime.entities??{}).some(e=>e.kind==='plague_vial'&&e.phase==='active')&&Object.values(ashen.state().skillRuntime.buffs??{}).some(b=>b.kind==='poison'),null,{timeout:25000});
 await page.screenshot({path:path.join(out,'live-skills-landscape.png')});
 const live=await page.evaluate(()=>({skillRuntime:ashen.state().skillRuntime,metrics:ashen.metrics(),fired:ashen.state().fired,procHits:ashen.state().procHits}));
 assert.ok(live.procHits>0);assert.equal(live.metrics.actors.equipment,JSON.parse(fs.readFileSync(path.resolve(__dirname,'../assets/equipment/manifest.json'),'utf8')).length);assert.deepEqual(live.metrics.ui.diagnostics,[]);
 await action('Pause');const held=await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime));await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime)),held);
 await page.screenshot({path:path.join(out,'paused-skills-landscape.png')});await action('Pause');
 await page.evaluate(()=>ashen.setBloom(false));await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'skills-no-bloom-landscape.png')});await page.evaluate(()=>ashen.setBloom(true));
 await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(500);assert.deepEqual(await page.evaluate(()=>ashen.metrics().ui.diagnostics),[]);
 await page.waitForTimeout(2000);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({scope:'Landscape only; production UI/stock, controlled skill loadout in actual combat. No fabricated damage or visual receipts for screenshots.',ui:{diagnostics:ui.diagnostics},draw,live,errors},null,2));
 const video=page.video();await context.close();await video.saveAs(path.join(out,'skill-lifecycle-landscape.webm'));
 console.log('PASS landscape build/shop UI, equipment catalog models, live skills, pause, no-bloom, fixed VFX buffers and budget');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

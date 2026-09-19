const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/elements');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:810}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const action=async name=>{await page.evaluate(n=>ashen.action(n),name);await page.waitForTimeout(140)};
 await page.goto('http://127.0.0.1:8190/?build=elements-v1&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 await action('UI_builds');for(let i=0;i<4;i++)await action('UI_page_next');
 assert.ok((await page.evaluate(()=>JSON.stringify(ashen.uiTree()))).includes('雨幕雷網'));
 assert.deepEqual(await page.evaluate(()=>ashen.metrics().ui.diagnostics),[]);await page.screenshot({path:path.join(out,'build-page-five.png')});
 await action('Build13');await action('UI_home');await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');
 assert.equal(await page.evaluate(()=>ashen.state().stock[0].skill),'rain_strike');
 const fixtures=await page.evaluate(async()=>{
  const T=await import('/presentation/vendor/build/three.module.js'),{createCombatFX}=await import('/presentation/combat-fx.mjs');const scene=new T.Scene(),fx=createCombatFX(scene);
  const field=(kind,id)=>({id,kind,phase:'active',ox:-2,oz:0,tx:2,tz:0,x:0,z:0,radius:1,age:.3,remaining:2});
  const state={phase:'battle',round:1,rewardClock:2,skillRuntime:{clock:2,elements:{fields:['fire','oil','water','charged_water'].map(field),statuses:[{id:7,kind:'oil',x:1,z:1,age:.2,remaining:2},{id:8,kind:'wet',x:2,z:2,age:.2,remaining:2}],events:[{id:9,kind:'ignite',x:1,z:0,time:1.9},{id:10,kind:'conduct',x:1,z:1,tx:3,tz:2,time:1.9}]}}};
  const freeze=o=>{Object.freeze(o);for(const v of Object.values(o))if(v&&typeof v==='object')freeze(v)};freeze(state);fx.update(state);const first=fx.inspect();const buffers=scene.children.map(m=>m.geometry.attributes.position.array);
  const geometry=()=>JSON.stringify(scene.children.map(m=>Array.from(m.geometry.attributes.position.array.slice(0,m.geometry.drawRange.count*3))));const shape=geometry();fx.update(state);const stable=shape===geometry();
  const stress={...state,skillRuntime:{...state.skillRuntime,entities:Array.from({length:400},(_,i)=>({id:i,kind:'plague_vial',phase:'active',x:i%10,z:0,radius:1.8,age:1,progress:.3})),elements:{...state.skillRuntime.elements,fields:Array.from({length:1200},(_,i)=>field(['fire','oil','water','charged_water'][i%4],i)),events:Array.from({length:300},(_,i)=>({...state.skillRuntime.elements.events[i%2],id:i}))}}};
  fx.update(stress);const budget=fx.inspect(),sameBuffers=scene.children.every((m,i)=>m.geometry.attributes.position.array===buffers[i]);fx.update({...state,phase:'celebration',skillRuntime:{}});const ended=fx.inspect();fx.dispose();return {first,stable,budget,sameBuffers,ended};
 });
 assert.equal(Object.keys(fixtures.first.elements.kinds).length,4);assert.ok(fixtures.first.elements.events>0);assert.equal(fixtures.stable,true);assert.equal(fixtures.sameBuffers,true);assert.ok(fixtures.budget.activeEvents<=36&&fixtures.budget.drawCalls<=2);assert.ok(fixtures.budget.fieldFootprints+fixtures.budget.elements.surfaces<=400);assert.equal(fixtures.budget.ink.droppedTriangles+fixtures.budget.core.droppedTriangles,0);assert.equal(fixtures.ended.drawCalls,0);
 const reports=[];
 for(const [name,skills]of [['fire-oil',['ember_trail','slick_oil','oil_legacy']],['water-lightning',['rain_strike','storm_touch']]]){
  await page.unroute('**/content/project.json');
  await page.route('**/content/project.json',async route=>{const response=await route.fetch(),payload=await response.json();const condition=skills.map(id=>`def.skill=="${id}"`).join(' or ');
   payload.script=payload.script.replace('local function beginBattle()',`local function beginBattle()\nS.selected=3;for _,def in ipairs(gearCatalog)do if ${condition}then addItem(def,0);local k=${name==='water-lightning'?'def.skill=="storm_touch" and 1 or 3':'3'};S.worn[k][def.slot]=S.items[#S.items].id end end`);await route.fulfill({response,json:payload});});
  await page.goto('http://127.0.0.1:8190/?build=elements-capture-'+name+'&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
  await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');await action('LeaveShop');await action('Mode_auto');await action('Auto_apply');
  if(name==='water-lightning'){
   await page.waitForFunction(()=>Object.values(ashen.state().skillRuntime.elements.statuses??{}).filter(s=>s.kind==='wet').length>=6,null,{timeout:20000});
   await action('Unit1');
   await page.waitForFunction(()=>{const r=ashen.state().skillRuntime;return Object.values(r.elements.events??{}).some(e=>e.kind==='conduct'&&r.clock-e.time<.18)},null,{timeout:25000});
  }
  await page.waitForFunction(()=>ashen.state().skillRuntime.elements.reactions>=3,null,{timeout:25000});if(name==='fire-oil')await page.waitForTimeout(700);
  await page.screenshot({path:path.join(out,name+'-landscape.png')});
  const live=await page.evaluate(()=>({state:ashen.state().skillRuntime.elements,metrics:ashen.metrics(),fired:ashen.state().fired}));
  assert.ok(live.state.reactions>=3);assert.equal(live.metrics.actors.equipment,53);assert.deepEqual(live.metrics.ui.diagnostics,[]);assert.equal(live.metrics.actors.combatFX.ink.droppedTriangles+live.metrics.actors.combatFX.core.droppedTriangles,0);
  await action('Pause');const held=await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime));await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime)),held);await action('Pause');
  await page.evaluate(()=>ashen.setBloom(false));await page.waitForTimeout(350);await page.screenshot({path:path.join(out,name+'-no-bloom.png')});await page.evaluate(()=>ashen.setBloom(true));
  reports.push({name,live});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({scope:'Landscape only. Actual UI/stock; battle screenshots use in-memory equipment grants with production combat, reactions and lottery. Frozen receipt fixture is only for render bounds/pause tests.',fixtures,reports,errors},null,2));
 console.log('PASS landscape build/acquisition, 53 equipment models, real fire/oil and water/lightning reactions, pause/no-bloom, shared buffers and dense VFX bounds');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

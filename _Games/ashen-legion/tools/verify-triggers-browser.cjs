const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/triggers');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:810}}),errors=[],reports=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const action=async name=>{await page.evaluate(n=>ashen.action(n),name);await page.waitForTimeout(140)};
 const open=async()=>{await page.goto('http://127.0.0.1:8190/?build=trigger-builds-v1&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000})};
 await open();await action('UI_builds');for(let i=0;i<4;i++)await action('UI_page_next');
 assert.ok((await page.evaluate(()=>JSON.stringify(ashen.uiTree()))).includes('疾掠騎團'));
 assert.deepEqual(await page.evaluate(()=>ashen.metrics().ui.diagnostics),[]);await page.screenshot({path:path.join(out,'builds-page-five.png')});
 await action('Build14');await action('UI_home');await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');
 assert.equal(await page.evaluate(()=>ashen.state().stock[0].skill),'plunder');await action('Unit3');await action('Buy1');await action('Equip1');
 assert.equal(await page.evaluate(()=>ashen.state().items[0].skill),'plunder');await action('LeaveShop');await action('Mode_auto');await action('Auto_apply');
 await page.waitForFunction(()=>ashen.state().plunderEarned>0,null,{timeout:15000});
 const actual=await page.evaluate(()=>({plunder:ashen.state().plunderEarned,lives:Object.values(ashen.state().visualTroops??{}).map(t=>t.life)}));
 assert.ok(actual.lives.length>0&&actual.lives.every(l=>l===4));
 for(const [name,skills]of [['plunder-rush',['plunder','firstborn','momentum']],['trigger-chain',['march_capacitor','third_pulse','delayed_bloom','battle_elegy','grave_bloom','last_echo']]]){
  await page.unroute('**/content/project.json');
  await page.route('**/content/project.json',async route=>{const response=await route.fetch(),payload=await response.json();
   const condition=skills.map(id=>`def.skill=="${id}"`).join(' or ');
   payload.script=payload.script.replace('local function beginBattle()',`local function beginBattle()\nS.selected=3;S.skillSources[3]={${skills.map(id=>`{id="${id}"}`).join(',')}};for _,def in ipairs(gearCatalog)do if ${condition}then addItem(def,0);S.worn[3][def.slot]=S.items[#S.items].id end end`);
   // Sources supply the controlled build; ornaments carry appearance without double grants.
   payload.script=payload.script.replace('if item then table.insert(list,{id=item.skill});','if item and false then table.insert(list,{id=item.skill});');
   await route.fulfill({response,json:payload});
  });
  await open();await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');await action('LeaveShop');await action('Mode_auto');await action('Auto_apply');
  if(name==='plunder-rush')await page.waitForFunction(()=>ashen.state().plunderEarned>=8&&ashen.metrics().actors.combatFX.boostedTrails>0,null,{timeout:20000});
  else await page.waitForFunction(()=>ashen.state().skillRuntime.triggers.counts.last_echo>0&&ashen.metrics().actors.combatFX.triggers.events>0,null,{timeout:25000});
  await page.screenshot({path:path.join(out,name+'.png')});
  const capture=await page.evaluate(()=>({counts:ashen.state().skillRuntime.triggers.counts,plunder:ashen.state().plunderEarned,metrics:ashen.metrics()}));
  assert.equal(capture.metrics.actors.equipment,61);assert.deepEqual(capture.metrics.ui.diagnostics,[]);
  assert.equal(capture.metrics.actors.combatFX.ink.droppedTriangles+capture.metrics.actors.combatFX.core.droppedTriangles,0);
  await page.evaluate(()=>ashen.setBloom(false));await page.waitForTimeout(250);await page.screenshot({path:path.join(out,name+'-no-bloom.png')});
  await action('Pause');const paused=await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime));await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime)),paused);
  reports.push({name,capture});
 }
 const render=await page.evaluate(async()=>{
  const T=await import('/presentation/vendor/build/three.module.js'),{createCombatFX}=await import('/presentation/combat-fx.mjs');const scene=new T.Scene(),fx=createCombatFX(scene,{reducedMotion:()=>false,compact:()=>false});
  const frame=n=>({phase:'battle',round:1,rewardClock:n/60,visualTroops:Array.from({length:100},(_,i)=>({id:i,k:3,state:'run',x:i%10+n*.05,z:Math.floor(i/10),y:0,bounces:0,birthRush:1.8})),skillRuntime:{clock:n/60,triggers:{events:Array.from({length:200},(_,i)=>({id:i,kind:['firstborn','delayed_bloom','third_pulse','grave_bloom','last_echo'][i%5],time:n/60-.2,x:i%10,z:Math.floor(i/10),radius:2.3})),buffs:Array.from({length:100},(_,i)=>({kind:'march_capacitor',sourceId:i,x:i%10,z:0,stacks:2}))}}});
  const freeze=o=>{Object.freeze(o);for(const v of Object.values(o))if(v&&typeof v==='object')freeze(v)};
  for(let n=0;n<12;n++)fx.update(frame(n));const dense=fx.inspect(),s=frame(12);freeze(s);fx.update(s);
  const geometry=()=>JSON.stringify(scene.children.map(m=>Array.from(m.geometry.attributes.position.array.slice(0,m.geometry.drawRange.count*3))));const before=geometry();fx.update(s);const stable=before===geometry();
  fx.update({phase:'clear',round:1,rewardClock:2,skillRuntime:{}});const cleared=fx.inspect();fx.dispose();return {dense,stable,cleared};
 });
 assert.ok(render.dense.boostedTrails>0&&render.dense.triggers.events<=4&&render.dense.trailSlots<=64&&render.dense.drawCalls<=2);
 assert.equal(render.dense.ink.droppedTriangles+render.dense.core.droppedTriangles,0);assert.equal(render.stable,true);assert.equal(render.cleared.drawCalls,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({scope:'Landscape 1440x810. First test buys real plunder gear through normal UI. Captures then use disclosed in-memory build grants; last test uses frozen render receipts only.',actual,reports,render,errors},null,2));
 console.log('PASS landscape acquisition, 61 gear assets, live plunder/rush/trigger visuals, no-bloom, pause and dense pooled effects');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

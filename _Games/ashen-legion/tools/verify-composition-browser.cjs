const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/composition');fs.mkdirSync(out,{recursive:true});
const catalog=JSON.parse(fs.readFileSync(path.join(root,'design-v1/equipment-manifest.json'),'utf8'));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:810}}),errors=[],reports=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const action=async name=>{await page.evaluate(n=>ashen.action(n),name);await page.waitForTimeout(160)};
 const open=async()=>{await page.goto('http://127.0.0.1:8190/?build=composition-v1&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000})};
 const cleanUI=async()=>assert.deepEqual(await page.evaluate(()=>ashen.metrics().ui.diagnostics),[]);
 await open();if(!process.argv.includes('--render-only')){
 await action('UI_builds');for(let i=0;i<6;i++)await action('UI_page_next');
 assert.ok((await page.evaluate(()=>JSON.stringify(ashen.uiTree()))).includes('引力雷田'));await cleanUI();
 await page.screenshot({path:path.join(out,'builds-new.png')});await action('Build21');await action('UI_home');await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');
 assert.equal(await page.evaluate(()=>ashen.state().stock[0].skill),'gravity_law');await cleanUI();await page.screenshot({path:path.join(out,'shop-icons.png')});
 await action('Unit3');await action('Buy1');await action('Equip1');await action('UI_gear');await cleanUI();await page.screenshot({path:path.join(out,'equipment-icons.png')});
 const gearTree=await page.evaluate(()=>JSON.stringify(ashen.uiTree()));assert.ok(gearTree.includes('ui_icon-attack')&&gearTree.includes('ui_icon-helmet'));
 await action('UI_runes');await cleanUI();await page.screenshot({path:path.join(out,'rune-icons.png')});
 await action('UI_home');await action('LeaveShop');await action('Mode_auto');await action('Auto_apply');
 await page.waitForFunction(()=>ashen.state().skillRuntime.composition.counts.gravity_law>0,null,{timeout:18000});
 reports.push({name:'normal-purchase',counts:await page.evaluate(()=>ashen.state().skillRuntime.composition.counts)});
 for(const [name,skills,kind]of [
  ['gravity-mine',['gravity_law','contact_mine','quick_chant'],'contact_mine'],
  ['overloaded-orbs',['step_orb','overload_script','firstborn'],'step_orb'],
  ['oath-debt',['comrade_oath','resonant_debt','phoenix_fire'],'resonant_debt'],
  ['lightning-payload',['storm_payload','step_orb','rain_strike'],'step_orb']]){
  await page.unroute('**/content/project.json');
  await page.route('**/content/project.json',async route=>{const response=await route.fetch(),payload=await response.json();
   const condition=skills.map(id=>`def.skill=="${id}"`).join(' or ');
   payload.script=payload.script.replace('local function beginBattle()',`local function beginBattle()\nS.selected=3;S.skillSources[3]={${skills.map(id=>`{id="${id}"}`).join(',')}};for _,def in ipairs(gearCatalog)do if ${condition}then addItem(def,0);S.worn[3][def.slot]=S.items[#S.items].id end end`);
   payload.script=payload.script.replace('if item then table.insert(list,{id=item.skill});','if item and false then table.insert(list,{id=item.skill});');
   await route.fulfill({response,json:payload});
  });
  await open();await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');await action('LeaveShop');await action('Mode_auto');await action('Auto_apply');
  await page.waitForFunction(k=>ashen.state().fired>24&&ashen.metrics().actors.combatFX.composition.kinds[k]>0,kind,{timeout:25000});
  await page.screenshot({path:path.join(out,name+'.png')});await cleanUI();
  const capture=await page.evaluate(()=>({counts:ashen.state().skillRuntime.composition.counts,metrics:ashen.metrics()}));
  assert.equal(capture.metrics.actors.equipment,catalog.length);assert.equal(capture.metrics.actors.combatFX.ink.droppedTriangles+capture.metrics.actors.combatFX.core.droppedTriangles,0);
  await page.evaluate(()=>ashen.setBloom(false));await page.waitForTimeout(250);await page.screenshot({path:path.join(out,name+'-no-bloom.png')});
  await action('Pause');const paused=await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime));await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime)),paused);
  reports.push({name,capture});
 }
 }
 const render=await page.evaluate(async()=>{
  const T=await import('/presentation/vendor/build/three.module.js'),{createCombatFX}=await import('/presentation/combat-fx.mjs');const scene=new T.Scene(),fx=createCombatFX(scene,{reducedMotion:()=>false,compact:()=>false});
  const state={phase:'battle',round:1,rewardClock:1,skillRuntime:{clock:1,composition:{nodes:Array.from({length:256},(_,i)=>({id:i,kind:i%2?'step_orb':'contact_mine',x:i%10,z:Math.floor(i/10),radius:2,triggerRadius:.9,remaining:1,progress:.6,armed:true,element:i%2?'lightning':'fire'})),marks:Array.from({length:100},(_,i)=>({id:i,x:i%10,z:0,hits:i%5,remaining:2})),wells:Array.from({length:80},(_,i)=>({id:i,x:0,z:0,radius:4.2,active:true,progress:.6})),buffs:Array.from({length:150},(_,i)=>({x:i%10,z:0,remaining:2})),events:Array.from({length:200},(_,i)=>({id:i,kind:['contact_mine','step_orb','resonant_debt','comrade_oath'][i%4],x:i%10,z:Math.floor(i/10),radius:2,time:.8,element:'lightning',power:2}))}}};
  const freeze=o=>{Object.freeze(o);for(const v of Object.values(o))if(v&&typeof v==='object')freeze(v)};freeze(state);fx.update(state);
  const dense=fx.inspect(),geometry=()=>JSON.stringify(scene.children.map(m=>Array.from(m.geometry.attributes.position.array.slice(0,m.geometry.drawRange.count*3))));const before=geometry();fx.update(state);const stable=before===geometry();
  fx.update({phase:'clear',round:1,rewardClock:2,skillRuntime:{}});const cleared=fx.inspect();fx.dispose();return {dense,stable,cleared};
 });
 assert.ok(render.dense.drawCalls<=2&&render.dense.composition.events<=6&&render.dense.composition.nodes<=128&&render.dense.composition.wells<=6);
 assert.equal(render.dense.ink.droppedTriangles+render.dense.core.droppedTriangles,0);assert.equal(render.stable,true);assert.equal(render.cleared.drawCalls,0);assert.deepEqual(errors,[]);
 // Each family can fit alone while their shared pool still overflows together.
 // Keep the combined field + telegraph + trail case as a regression fixture.
 const mixed=await page.evaluate(async()=>{
  const T=await import('/presentation/vendor/build/three.module.js'),{createCombatFX}=await import('/presentation/combat-fx.mjs');
  const results=[];
  for(const fieldKind of ['fire','oil','wet']){
   const scene=new T.Scene(),fx=createCombatFX(scene,{reducedMotion:()=>false,compact:()=>false});
   for(let frame=0;frame<14;frame++){
    const now=frame/60,make=(n,fn)=>Array.from({length:n},(_,i)=>({id:i,x:i%10,z:Math.floor(i/10),...fn(i)}));
    fx.update({phase:'battle',round:1,rewardClock:now,visualTroops:make(64,i=>({k:3,state:'run',x:i%10+frame*.1,birthRush:1.8})),skillRuntime:{clock:now,
     composition:{nodes:make(256,()=>({kind:'step_orb',radius:1.8,remaining:1,progress:.8,element:'lightning'})),wells:make(12,()=>({radius:4.2,active:true,progress:.6})),marks:make(100,()=>({hits:4,remaining:2})),buffs:make(100,()=>({remaining:2})),events:make(50,()=>({kind:'step_orb',radius:1.8,time:now-.2,element:'lightning',power:2}))},
     resonance:{jobs:make(80,()=>({kind:'chain_fuse',radius:2.1,remaining:.2,progress:.8})),ghosts:make(30,()=>({dx:1,dz:0})),events:make(50,()=>({kind:'chain_fuse',radius:2.1,time:now-.2}))},
     triggers:{events:make(50,()=>({kind:'third_pulse',radius:1.8,time:now-.2})),buffs:make(30,()=>({kind:'battle_elegy',remaining:1}))},
     entities:make(200,()=>({kind:'plague_vial',phase:'active',age:.3,progress:.2,radius:1.8})),
     elements:{fields:make(400,i=>({kind:fieldKind,phase:'active',remaining:2,ox:i%10,oz:Math.floor(i/10),tx:i%10+1,tz:Math.floor(i/10),radius:.48}))}
    }});
   }
   results.push({fieldKind,...fx.inspect()});fx.dispose();if(scene.children.length)throw new Error('Mixed renderer leaked meshes');
  }
  return results;
 });
 fs.writeFileSync(path.join(out,'mixed-render-report.json'),JSON.stringify(mixed,null,2));
 for(const m of mixed){assert.equal(m.ink.droppedTriangles+m.core.droppedTriangles,0,`Shared pool overflow: ${m.fieldKind} ${JSON.stringify({ink:m.ink,core:m.core})}`);assert.equal(m.drawCalls,2);assert.equal(m.boostedTrails,48);assert.equal(m.fieldFootprints,200);assert.ok(m.activeEvents<=m.eventBudget);}
 if(process.argv.includes('--render-only')){console.log('PASS isolated and mixed fixed VFX buffers; no overflow.');return;}
 // Review original SVG assets at their intended 48px/96px sizes; this sheet is QA only.
 const sheet=await browser.newPage({viewport:{width:1200,height:900}});
 const groups=[['新技能',catalog.slice(-8).map(g=>['skill-'+g.id,({'comrade_oath':'交鋒戰誓','resonant_debt':'共鳴債印','contact_mine':'獵星伏雷','step_orb':'流明步雷','gravity_law':'引力法則','quick_chant':'迅咒齒輪','overload_script':'過載秘法','storm_payload':'雷紋接枝'})[g.id]])],['可換裝配件',catalog.slice(-8).map(g=>['gear-'+g.id,g.name])]];
 let html='<body style="margin:0;background:#29332f;color:#eddfbc;font:18px sans-serif;padding:24px"><h2>切面繪本 · 圖示檢視（96 / 48 px）</h2>';
 for(const [name,entries]of groups){html+='<h3>'+name+'</h3><div style="display:flex;gap:14px;flex-wrap:wrap">';for(const [id,label]of entries){const data=fs.readFileSync(path.join(root,'assets/formal-ui',id+'.svg')).toString('base64');html+=`<div style="width:166px;background:#414a40;padding:5px"><div><img width="96" height="96" src="data:image/svg+xml;base64,${data}"><img width="48" height="48" src="data:image/svg+xml;base64,${data}"></div><small>${label}</small></div>`;}html+='</div>';}html+='</body>';
 await sheet.setContent(html);await sheet.screenshot({path:path.join(out,'icon-sheet.png'),fullPage:true});
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({scope:'Landscape 1440x810. Real build selection, purchase and equipment flow, then in-memory starting-loadout VFX captures. Dense render input is frozen synthetic receipts; mixed fields exercise the shared pool. No production cheats.',equipment:catalog.length,reports,render,mixed,errors},null,2));
 console.log('PASS native UI/shop/gear/runes, eight skills in landscape, no-bloom, pause and bounded two-batch VFX. Equipment:',catalog.length);
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

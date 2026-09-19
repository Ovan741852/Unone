const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/resonance');fs.mkdirSync(out,{recursive:true});
const catalog=JSON.parse(fs.readFileSync(path.join(root,'design-v1/equipment-manifest.json'),'utf8'));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:810}}),errors=[],reports=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const action=async name=>{await page.evaluate(n=>ashen.action(n),name);await page.waitForTimeout(160)};
 const open=async()=>{await page.goto('http://127.0.0.1:8190/?build=resonance-icons-v1&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000})};
 const cleanUI=async()=>assert.deepEqual(await page.evaluate(()=>ashen.metrics().ui.diagnostics),[]);
 await open();await action('UI_builds');for(let i=0;i<5;i++)await action('UI_page_next');
 assert.ok((await page.evaluate(()=>JSON.stringify(ashen.uiTree()))).includes('紅蓮時爆'));await cleanUI();
 await page.screenshot({path:path.join(out,'builds-new.png')});await action('Build18');await action('UI_home');await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');
 assert.equal(await page.evaluate(()=>ashen.state().stock[0].skill),'cinder_seal');await cleanUI();await page.screenshot({path:path.join(out,'shop-icons.png')});
 await action('Unit3');await action('Buy1');await action('Equip1');await action('UI_gear');await cleanUI();await page.screenshot({path:path.join(out,'equipment-icons.png')});
 const gearTree=await page.evaluate(()=>JSON.stringify(ashen.uiTree()));assert.ok(gearTree.includes('ui_icon-attack')&&gearTree.includes('ui_icon-helmet'));
 await action('UI_runes');await cleanUI();await page.screenshot({path:path.join(out,'rune-icons.png')});
 await action('UI_home');await action('LeaveShop');await action('Mode_auto');await action('Auto_apply');
 await page.waitForFunction(()=>ashen.state().skillRuntime.resonance.counts.cinder_seal>0,null,{timeout:18000});
 reports.push({name:'normal-purchase',counts:await page.evaluate(()=>ashen.state().skillRuntime.resonance.counts)});
 for(const [name,skills,kind]of [
  ['cinder-chain',['cinder_seal','chain_fuse','pierce'],'chain_fuse'],
  ['thunder-starfall',['thunder_fan','rain_strike','starfall'],'thunder_fan'],
  ['echo-return',['echo_blade','soul_return','firstborn'],'echo_blade']]){
  await page.unroute('**/content/project.json');
  await page.route('**/content/project.json',async route=>{const response=await route.fetch(),payload=await response.json();
   const condition=skills.map(id=>`def.skill=="${id}"`).join(' or ');
   payload.script=payload.script.replace('local function beginBattle()',`local function beginBattle()\nS.selected=3;S.skillSources[3]={${skills.map(id=>`{id="${id}"}`).join(',')}};for _,def in ipairs(gearCatalog)do if ${condition}then addItem(def,0);S.worn[3][def.slot]=S.items[#S.items].id end end`);
   payload.script=payload.script.replace('if item then table.insert(list,{id=item.skill});','if item and false then table.insert(list,{id=item.skill});');
   await route.fulfill({response,json:payload});
  });
  await open();await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');await action('LeaveShop');await action('Mode_auto');await action('Auto_apply');
  await page.waitForFunction(k=>ashen.state().fired>24&&ashen.metrics().actors.combatFX.resonance.kinds[k]>0,kind,{timeout:25000});
  await page.screenshot({path:path.join(out,name+'.png')});await cleanUI();
  const capture=await page.evaluate(()=>({counts:ashen.state().skillRuntime.resonance.counts,metrics:ashen.metrics()}));
  assert.equal(capture.metrics.actors.equipment,catalog.length);assert.equal(capture.metrics.actors.combatFX.ink.droppedTriangles+capture.metrics.actors.combatFX.core.droppedTriangles,0);
  await page.evaluate(()=>ashen.setBloom(false));await page.waitForTimeout(250);await page.screenshot({path:path.join(out,name+'-no-bloom.png')});
  await action('Pause');const paused=await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime));await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>JSON.stringify(ashen.state().skillRuntime)),paused);
  reports.push({name,capture});
 }
 const render=await page.evaluate(async()=>{
  const T=await import('/presentation/vendor/build/three.module.js'),{createCombatFX}=await import('/presentation/combat-fx.mjs');const scene=new T.Scene(),fx=createCombatFX(scene,{reducedMotion:()=>false,compact:()=>false});
  const kinds=['cinder_seal','chain_fuse','thunder_fan','echo_blade','starfall'];
  const state={phase:'battle',round:1,rewardClock:1,skillRuntime:{clock:1,resonance:{jobs:Array.from({length:240},(_,i)=>({id:i,kind:kinds[i%5],x:i%10,z:Math.floor(i/10),dx:1,dz:0,radius:1.8,range:4.8,angle:Math.PI*100/180,progress:.6,remaining:.3,ax:0,az:0,bx:3.2,bz:0})),ghosts:Array.from({length:90},(_,i)=>({id:i,x:i%10,z:0,dx:1,dz:0})),events:Array.from({length:200},(_,i)=>({id:i,kind:kinds[i%5],time:.8,x:i%10,z:Math.floor(i/10),radius:2.1,ax:0,az:0,bx:3.2,bz:0,rays:Array.from({length:5},(_,n)=>({x:0,z:0,tx:n,tz:3,hit:true}))}))}}};
  const freeze=o=>{Object.freeze(o);for(const v of Object.values(o))if(v&&typeof v==='object')freeze(v)};freeze(state);fx.update(state);
  const dense=fx.inspect(),geometry=()=>JSON.stringify(scene.children.map(m=>Array.from(m.geometry.attributes.position.array.slice(0,m.geometry.drawRange.count*3))));const before=geometry();fx.update(state);const stable=before===geometry();
  fx.update({phase:'clear',round:1,rewardClock:2,skillRuntime:{}});const cleared=fx.inspect();fx.dispose();return {dense,stable,cleared};
 });
 assert.ok(render.dense.drawCalls<=2&&render.dense.resonance.events<=6&&render.dense.resonance.markers<=24&&render.dense.resonance.ghosts<=16);
 assert.equal(render.dense.ink.droppedTriangles+render.dense.core.droppedTriangles,0);assert.equal(render.stable,true);assert.equal(render.cleared.drawCalls,0);assert.deepEqual(errors,[]);
 // Review original SVG assets at their intended 48px/96px sizes; this sheet is QA only.
 const sheet=await browser.newPage({viewport:{width:1200,height:900}});
 const groups=[['新技能',catalog.slice(-6).map(g=>['skill-'+g.id,({'cinder_seal':'燼刻時印','chain_fuse':'紅蓮導火','thunder_fan':'雷羽開屏','echo_blade':'斷界回斬','starfall':'星隕追獵','soul_return':'英魂返刃'})[g.id]])],['裝備',catalog.slice(-6).map(g=>['gear-'+g.id,g.name])],['屬性與物品',['attack','life','speed','crit','potion-haste','potion-life','potion-recall','rune','helmet','body','boots','gloves'].map(n=>['icon-'+n,n])],['建築與操作',['building-market','building-forge','building-alchemy','building-barracks','symbol-auto','symbol-lock'].map(n=>[n,n])]];
 let html='<body style="margin:0;background:#29332f;color:#eddfbc;font:18px sans-serif;padding:24px"><h2>切面繪本 · 圖示檢視（96 / 48 px）</h2>';
 for(const [name,entries]of groups){html+='<h3>'+name+'</h3><div style="display:flex;gap:14px;flex-wrap:wrap">';for(const [id,label]of entries){const data=fs.readFileSync(path.join(root,'assets/formal-ui',id+'.svg')).toString('base64');html+=`<div style="width:166px;background:#414a40;padding:5px"><div><img width="96" height="96" src="data:image/svg+xml;base64,${data}"><img width="48" height="48" src="data:image/svg+xml;base64,${data}"></div><small>${label}</small></div>`;}html+='</div>';}html+='</body>';
 await sheet.setContent(html);await sheet.screenshot({path:path.join(out,'icon-sheet.png'),fullPage:true});
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({scope:'Landscape 1440x810. Real build selection, purchase and equipment flow, then in-memory starting-loadout VFX captures. Dense render input is frozen synthetic receipts. No production cheats.',equipment:catalog.length,reports,render,errors},null,2));
 console.log('PASS native UI/shop/gear/runes, six skills in landscape, no-bloom, pause and bounded two-batch VFX. Equipment:',catalog.length);
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

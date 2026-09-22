// Actual game navigation; no fixture mutations or renderer substitutes.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const uiPoint=require('./ui-test-pointer.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});const report={ok:false,checks:[],errors:[]};
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:8190/?seed=42');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
  const state=()=>page.evaluate(()=>window.ashen.state());
  const exists=id=>page.locator(`[data-shop-control="${id}"]`).count();
  const focus=()=>page.evaluate(()=>document.activeElement?.dataset.shopControl);
  async function key(id,code='Enter'){
   assert.ok(await exists(id),'Missing accessible control '+id);
   await page.locator(`[data-shop-control="${id}"]`).evaluate(e=>e.focus());await page.keyboard.press(code);await page.waitForTimeout(180);
  }
  await key('settings');const volume=(await state()).settings.music;await key('settings_music_down');assert.ok((await state()).settings.music<volume);await key('settings_music_up');
  await key('settings_back');await key('start');await key('profile_create_3');assert.equal((await state()).uiRoute,'town');
  await key('town_1');assert.equal(await focus(),'town_upgrade_cancel');
  await page.keyboard.press('Shift+Tab');assert.equal(await focus(),'town_upgrade_cancel','disabled confirmation excluded from trap');
  await page.keyboard.press('Escape');await page.waitForTimeout(180);assert.equal((await state()).townUpgradePending,false);assert.equal(await focus(),'town_1');
  report.checks.push('Menu, saved audio settings, profile creation, town detail focus trap, Escape cancellation and focus return');
  await key('town_back');await key('start');await key('profile_delete_3');assert.equal(await focus(),'delete_cancel');
  await page.keyboard.press('Escape');await page.waitForTimeout(180);assert.equal((await state()).deleteCandidate,0);await key('profile_load_3');
  report.checks.push('Delete confirmation defaults to Keep and Escape does not delete the save');
  await key('launch_expedition');await page.waitForFunction(()=>window.ashen.state().phase==='choice');
  const cardsBefore=JSON.stringify((await state()).cards);
  await key('view_map');assert.equal((await state()).phase,'map');
  const mapTree=await page.evaluate(()=>window.ashen.uiTree());
  assert.equal(mapTree.children.find(n=>n.id==='map_back')?.asset,'texture://ui_forest-map-v2');
  assert.ok(mapTree.children.some(n=>n.id==='map_current_title'&&n.text));
  const mapStatus=await page.locator('#shop-accessible-status').textContent();
  assert.ok(mapStatus.includes('第 1 / 7 站')&&mapStatus.includes('已抵達'));
  assert.ok(!/金幣|結晶/.test(mapStatus),'Map announces arrival, not irrelevant balances');
  await page.waitForTimeout(350);
  fs.mkdirSync(path.resolve(__dirname,'../tests/map-layout'),{recursive:true});
  await page.screenshot({path:path.resolve(__dirname,'../tests/map-layout/live-map-desktop.png')});
  await key('visit_location');assert.equal((await state()).phase,'choice');
  assert.equal(JSON.stringify((await state()).cards),cardsBefore,'Viewing map must not reroll destinations');
  report.checks.push('Expedition auto-arrival, keyboard map entry/return, painted map assets and unchanged offered destinations');
  const choices=Object.values((await state()).cards),market=choices.findIndex(c=>c.id==='market');await key('choice_'+(market+1));
  await key('stock_hit_1');await key('shop_detail_buy');assert.equal(await focus(),'stock_hit_1');assert.equal(await page.locator('[data-shop-control="shop_detail_close"]').count(),0);await key('ready');
  await key('inspect_1');assert.equal(await focus(),'gear_detail_close');await key('gear_detail_equip');
  assert.ok((await state()).worn.flat().some(x=>x>0));await page.keyboard.press('Escape');await page.waitForTimeout(180);assert.equal(await focus(),'inspect_1');
  // Click the upper icon half of a slot, not only its text caption.
  const slot=await page.evaluate(()=>window.ashen.uiTree().children.find(n=>n.id==='slot_hit_1').rect);
  const slotPoint=await uiPoint(page,slot,.5,.15);await page.mouse.click(slotPoint.x,slotPoint.y);await page.waitForTimeout(160);assert.equal((await state()).equipSlot,1);
  report.checks.push('Keyboard purchase, inventory detail/equip, modal return, and full equipment-slot icon hit area');
  await key('tab_runes');const runeThumbBefore=await page.evaluate(()=>window.ashen.uiTree().children.find(n=>n.id==='rune_scroll_thumb')?.rect.y??-1);await key('rune_scroll_down');const runeThumbAfter=await page.evaluate(()=>window.ashen.uiTree().children.find(n=>n.id==='rune_scroll_thumb')?.rect.y??-1);assert.ok(runeThumbAfter>runeThumbBefore,'Rune grid must scroll instead of paginate');assert.equal(await exists('rune_next'),0,'Rune grid must not paginate');await key('deploy');
  await key('pause');await key('guide');await key('guide_back');await key('quit');assert.equal(await focus(),'abandon_cancel');
  await page.keyboard.press('Escape');await page.waitForTimeout(180);await key('resume');
  await key('auto_settings');assert.equal(await focus(),'auto_cancel');await key('auto_preset_small');await key('auto_apply');assert.equal((await state()).autoEnabled,true);
  report.checks.push('Rune grid scrolling, deployment, pause/guide, protected abandon confirmation and AUTO selection');
  // Independent fresh profile: exercise the new route through real controls.
  const quick=await browser.newPage({viewport:{width:1280,height:720}});
  quick.on('pageerror',e=>report.errors.push(e.message));
  await quick.goto('http://127.0.0.1:8190/?seed=42');await quick.waitForSelector('body[data-ready="true"]',{timeout:60000});
  async function quickKey(id){const b=quick.locator(`[data-shop-control="${id}"]`);await b.focus();await b.press('Enter');await quick.waitForTimeout(180);}
  await quickKey('start');await quickKey('profile_create_1');await quickKey('launch_expedition');
  await quick.waitForFunction(()=>window.ashen.state().phase==='choice');
  const marketIndex=await quick.evaluate(()=>Object.values(window.ashen.state().cards).findIndex(c=>c.id==='market'));
  await quickKey('choice_'+(marketIndex+1));
  assert.equal(await quick.locator('[data-shop-control="ready"]').count(),1,'Preparation remains available alongside direct deployment');
  assert.match(await quick.locator('[data-shop-control="quick_deploy"]').textContent(),/使用目前配裝/);
  const coreEffect=await quick.evaluate(()=>window.ashen.uiTree().children.find(n=>n.id==='stock_desc_1').text.replaceAll('\n',''));
  assert.ok((await quick.locator('[data-shop-control="stock_hit_1"]').textContent()).includes(coreEffect),'Card accessibility includes the visible core effect');
  const oldEquipment=await quick.evaluate(()=>JSON.stringify(window.ashen.state().worn));
  await quickKey('quick_deploy');
  assert.equal(await quick.evaluate(()=>window.ashen.state().phase),'battle');
  assert.equal(await quick.evaluate(()=>JSON.stringify(window.ashen.state().worn)),oldEquipment);
  await quick.close();report.checks.push('Fresh-profile keyboard direct deployment reaches battle without changing equipment; preparation remains available');
  // Adapter hold contract: synthetic canvas state only, no gameplay mutation.
  const hold=await page.evaluate(async()=>{
   const {createShopAccessibility}=await import('./presentation/shop-accessibility.mjs');
   const canvas=document.createElement('canvas'),stage=document.createElement('div');stage.append(canvas);document.body.append(stage);
   const events=[],adapter=createShopAccessibility({canvas,stage,onAction:a=>events.push(['press',a]),onHold:(a,v)=>events.push([a,v])});
   adapter.sync({children:[{kind:'button',id:'qa_chest',text:'按住開啟寶箱',action:'OpenChest',rect:{x:10,y:10,width:30,height:15}}]}, {phase:'clear',coins:320,crystals:18});
   const button=canvas.querySelector('button');button.focus();
   button.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true,cancelable:true}));
   button.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',repeat:true,bubbles:true,cancelable:true}));
   button.dispatchEvent(new KeyboardEvent('keyup',{code:'Space',bubbles:true,cancelable:true}));
   adapter.dispose();stage.remove();return events;
  });
  assert.deepEqual(hold,[['OpenChest',true],['OpenChest',false]]);report.checks.push('Chest keyboard hold emits one down/up transition, not repeated purchases (adapter test)');
  assert.deepEqual(report.errors,[]);report.ok=true;
 }finally{
  fs.writeFileSync(path.resolve(__dirname,'../tests/all-ui/interactions.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));
 }
})().catch(e=>{console.error(e);process.exitCode=1});

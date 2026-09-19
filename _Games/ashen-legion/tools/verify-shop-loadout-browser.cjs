const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/shop-loadout');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const results=[];
 for(const viewport of [{width:1440,height:810},{width:844,height:390}]){
  const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const state=()=>page.evaluate(()=>ashen.state());
  async function click(action,id){const r=await page.evaluate(({a,id})=>ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a&&(!id||n.id===id))?.rect,{a:action,id});assert.ok(r,'Missing UI action '+action);await page.mouse.click((r.x+r.width/2)*viewport.width/100,(100-r.y-r.height/2)*viewport.height/100);await page.waitForTimeout(260);}
  async function capture(name){await page.waitForFunction(()=>ashen.metrics().ui.assets.every(a=>a.state==='ready'));await page.screenshot({path:path.join(out,`${name}-${viewport.width}.png`)});const m=await page.evaluate(()=>ashen.metrics().ui);assert.deepEqual(m.diagnostics,[]);const within=await page.evaluate(()=>ashen.uiTree().children.every(n=>n.rect.x>=0&&n.rect.y>=0&&n.rect.x+n.rect.width<=100.01&&n.rect.y+n.rect.height<=100.01));assert.ok(within,'UI stays inside landscape');}
  async function start(seed){await page.goto('http://127.0.0.1:8190/?build=shops-loadout-v2&seed='+seed);await page.waitForSelector('body[data-ready=true]',{timeout:45000});await click('Start');assert.equal((await state()).phase,'menu');await click('LaunchExpedition');await page.waitForFunction(()=>ashen.state().phase==='choice');await page.waitForTimeout(350);}
  await start(42);await capture('locations');let s=await state();assert.equal(new Set(Object.values(s.cards).map(c=>c.id)).size,3);
  await click('OpenLoadout');assert.equal((await state()).phase,'loadout');assert.ok(!await page.evaluate(()=>ashen.uiTree().children.some(n=>n.action==='Deploy')));await click('ReturnFromLoadout');
  const market=Object.values((await state()).cards).findIndex(c=>c.id==='market');await click('Choice'+(market+1));await capture('equipment-shop');
  let actions=await page.evaluate(()=>ashen.uiTree().children.filter(n=>n.kind==='button').map(n=>n.action));assert.ok(!actions.some(a=>a.startsWith('Equip')||a.startsWith('Rune')||a==='UI_gear'));
  const hitRects=await page.evaluate(()=>ashen.uiTree().children.filter(n=>n.kind==='button'&&(/Buy\d+/.test(n.action)||n.action==='RefreshShop')).map(n=>({action:n.action,...n.rect})));const reroll=hitRects.find(n=>n.action==='RefreshShop');for(const buy of hitRects.filter(n=>n.action.startsWith('Buy'))){if(reroll)assert.ok(buy.x+buy.width<=reroll.x||reroll.x+reroll.width<=buy.x||buy.y+buy.height<=reroll.y||reroll.y+reroll.height<=buy.y,`${buy.action} purchase hit area overlaps reroll`);}
  const quote=(await state()).stock[0];await click('Buy1');s=await state();assert.ok(s.stock[0].sold&&s.items.length===1,'Buy1 must purchase the first displayed stock item');assert.ok(Object.values(s.worn).every(w=>Object.values(w).every(id=>id===0)));const stock=JSON.stringify(s.stock);
  await click('LeaveShop');assert.equal((await state()).phase,'loadout');assert.equal((await state()).equipSlot,quote.slot);await click('Equip1');await capture('equipped');
  await click('Unit3');await click('Equip1');s=await state();assert.equal(s.worn[0][quote.slot-1],0);assert.equal(s.worn[2][quote.slot-1],s.items[0].id);
  await click('Slot1','slot_1');assert.equal((await state()).equipSlot,1);await click('Slot'+quote.slot);
  await click('UI_runes');await capture('rune-config-empty');await click('UI_gear');await click('ReturnFromLoadout');assert.equal(JSON.stringify((await state()).stock),stock);
  await click('UI_sell');await capture('equipment-resale');actions=await page.evaluate(()=>ashen.uiTree().children.filter(n=>n.kind==='button').map(n=>n.action));assert.ok(!actions.some(a=>a.startsWith('Equip')));await click('LeaveShop');await click('Deploy');assert.equal((await state()).phase,'battle');
  await start(1);const rune=Object.values((await state()).cards).findIndex(c=>c.id==='rune');await click('Choice'+(rune+1));assert.ok(Object.values((await state()).stock).every(x=>x.kind==='rune'));await capture('rune-shop');const runeValue=(await state()).stock[0].value;await click('Buy1');assert.equal((await state()).runeBag[runeValue-1],1);
  await click('LeaveShop');await click('UI_runes');await click('Rune'+runeValue);await click('Unit2');await click('Rune'+runeValue);s=await state();assert.equal(s.runes[0],0);assert.equal(s.runes[1],runeValue);await capture('rune-transfer');
  await click('RuneOff');await click('ReturnFromLoadout');await click('UI_sell');await click('SellRune'+runeValue);assert.equal((await state()).runeBag[runeValue-1],0);await click('LeaveShop');await click('Deploy');assert.equal((await state()).phase,'battle');
  assert.equal(await page.locator('button:visible,section:visible,aside:visible,dialog:visible').count(),0,'all actual game controls remain native Unone UI');assert.deepEqual(errors,[]);results.push({viewport,errors,clickFlow:'random location -> specialized purchase -> loadout -> transfer -> return preserved shop -> resale -> deploy'});await page.close();
 }
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({passed:true,results},null,2));console.log('PASS real pointer purchase, five slots, gear/rune transfer, resale, preserved stock and deploy at desktop + landscape phone');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});


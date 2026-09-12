const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/nearwin-ui');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const samples=[];
 for(const [width,height] of [[1440,900],[390,844]]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8190/?build=nearwin-v1&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
  async function click(a){const r=await page.evaluate(a=>ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,a);assert.ok(r,a);await page.touchscreen.tap((r.x+r.width/2)*width/100,(100-r.y-r.height/2)*height/100);await page.waitForTimeout(140);}
  await click('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await page.waitForTimeout(650);await click('Choice1');await page.waitForTimeout(650);await click('LeaveShop');
  assert.deepEqual(await page.evaluate(()=>ashen.state().costs),[4,10,20]);
  await click('Mode_auto');await page.waitForTimeout(650);await click('Auto_small');await click('Auto_apply');
  await page.waitForFunction(()=>ashen.metrics().labels.guards.some(g=>g.recentMiss),null,{timeout:15000});
  const miss=await page.evaluate(()=>({guards:ashen.metrics().labels.guards,monsters:ashen.state().monsters,results:ashen.state().lotteryResults,coins:ashen.state().coins}));
  for(const g of miss.guards.filter(g=>g.recentMiss))assert.ok(Object.values(miss.monsters).some(m=>m.id===g.id),'missed monster remains on field');
  await page.screenshot({path:path.join(out,`miss-${width}x${height}.png`)});
  await page.waitForFunction(()=>ashen.metrics().labels.guards.some(g=>g.near),null,{timeout:20000});
  const near=await page.evaluate(()=>ashen.metrics().labels);assert.ok(near.guards.filter(g=>g.near).every(g=>g.progress>=.7&&g.progress<1&&g.label==='即將破防'));
  await page.screenshot({path:path.join(out,`progress-${width}x${height}.png`)});
  await click('Pause');assert.equal(await page.evaluate(()=>ashen.metrics().labels.guards.length),0);
  assert.deepEqual(near.diagnostics,[]);assert.deepEqual(errors,[]);samples.push({width,height,miss,near});console.log('PASS actual miss survival + true guard progress '+width+'x'+height);await page.close();
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,scope:'Actual production browser inputs and lottery outcomes, no state injection',samples},null,2));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

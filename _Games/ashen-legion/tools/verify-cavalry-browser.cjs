const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8190/?build=cavalry-v1&seed=42');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
 async function click(action){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,action);assert.ok(r,action);await page.mouse.click((r.x+r.width/2)*14.4,(100-r.y-r.height/2)*9);await page.waitForTimeout(120);}
 await click('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await click('Choice1');await click('LeaveShop');await click('Unit3');await click('Mode_auto');await page.waitForTimeout(650);await click('Auto_apply');await page.waitForTimeout(4200);
 const result=await page.evaluate(()=>({state:window.ashen.state(),metrics:window.ashen.metrics()}));
 assert.equal(result.state.loadouts[2].pierce,20);assert.equal(result.state.selected,3);assert.ok(result.state.fired>0);assert.ok(result.state.piercesUsed>result.state.fired,'AUTO cavalry must make multiple contacts');
 assert.ok(result.state.visualTroops.length>0);assert.ok(result.state.visualTroops.every(t=>t.life===8));assert.deepEqual(errors,[]);assert.deepEqual(result.metrics.ui.diagnostics,[]);
 await page.screenshot({path:path.resolve(__dirname,'../cavalry-v1.png')});
 fs.writeFileSync(path.resolve(__dirname,'../tests/cavalry-browser.json'),JSON.stringify({ok:true,errors,...result},null,2));
 console.log(JSON.stringify({ok:true,fired:result.state.fired,pierces:result.state.piercesUsed,life:result.state.visualTroops[0].life,coins:result.state.coins,errors}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../../docs/reviews/2026-09-11-gamedesignos');fs.mkdirSync(path.join(out,'images'),{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),events=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8190/?build=gamedesignos-review&seed=42');
 await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
 const started=Date.now();
 async function capture(id){await page.waitForFunction(()=>window.ashen.metrics().ui.assets.every(a=>a.state==='ready'));const data=await page.evaluate(()=>({state:window.ashen.state(),ui:window.ashen.uiTree()}));await page.screenshot({path:path.join(out,'images',id+'.png')});events.push({id,wallSeconds:(Date.now()-started)/1000,...data});}
 async function click(action){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,action);assert.ok(r,action);await page.mouse.click((r.x+r.width/2)*14.4,(100-r.y-r.height/2)*9);await page.waitForTimeout(150);}
 await capture('menu');await click('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await capture('choice');
 await click('Choice1');await capture('shop');await click('Buy1');await click('UI_gear');await click('Equip1');await capture('gear');
 await click('LeaveShop');await capture('battle-entry');await click('Mode_auto');await page.waitForTimeout(4500);await capture('battle-auto');
 await click('Pause');await capture('pause');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'browser-sample.json'),JSON.stringify({scope:'Fresh isolated browser context, real Canvas clicks; sampled opening only. No town persistence or game state injection.',errors,events},null,2));
 console.log(JSON.stringify({screens:events.map(e=>({id:e.id,phase:e.state.phase,wallSeconds:e.wallSeconds,battleSeconds:e.state.battleSeconds,gold:e.state.coins,crystals:e.state.crystals})),errors}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

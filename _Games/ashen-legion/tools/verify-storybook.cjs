const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],samples=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
 page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,900))});
 await page.goto('http://127.0.0.1:8190/?build=storybook-v1&seed=42');
 await page.waitForSelector('body[data-ready="true"]',{timeout:45000});console.log('READY');
 async function click(action){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,action);assert.ok(r,action);const v=page.viewportSize();await page.mouse.click((r.x+r.width/2)*v.width/100,(100-r.y-r.height/2)*v.height/100);await page.waitForTimeout(150);}
 async function capture(id){await page.waitForFunction(()=>window.ashen.metrics().ui.assets.every(a=>a.state==='ready'),null,{timeout:12000});await page.screenshot({path:path.resolve(__dirname,'../storybook-'+id+'.png')});samples.push({id,...await page.evaluate(()=>({state:window.ashen.state(),metrics:window.ashen.metrics(),ui:window.ashen.uiTree()}))});console.log('CAPTURE',id);}
 await capture('menu');await click('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await capture('choice');await click('Choice1');await capture('shop');await click('LeaveShop');await capture('quiet');
 if(process.argv.includes('--horde')){
  await page.waitForFunction(()=>window.ashen.state().hordeCount>0,null,{timeout:60000});await page.waitForTimeout(1200);await capture('horde');
  assert.ok(samples.at(-1).state.monsters.length>=90);assert.ok(samples.at(-1).metrics.labels.labels<=3);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.resolve(__dirname,'../tests/storybook-horde.json'),JSON.stringify({ok:true,scope:'Natural first monster wave, seed 42, no state injection, no firing',sample:samples.at(-1),errors},null,2));console.log('PASS natural monster horde');return;
 }
 const startShots=await page.evaluate(()=>window.ashen.state().fired);
 for(const action of ['Unit2','Mode_lock','Mode_auto','Auto_small','Auto_cancel','Unit3','Mode_lock'])await click(action);
 assert.equal(await page.evaluate(()=>window.ashen.state().fired),startShots,'UI clicks must never leak into firing');
 await click('Mode_auto');await page.waitForTimeout(650);await click('Auto_apply');await page.waitForTimeout(3200);await capture('battle');
 const metrics=await page.evaluate(()=>window.ashen.metrics());assert.equal(metrics.ao,true);assert.equal(metrics.bloom,true);assert.deepEqual(metrics.ui.diagnostics,[]);
 await click('Pause');assert.equal(await page.evaluate(()=>window.ashen.state().paused),true);await click('Pause');
 for(const [width,height]of [[1280,720],[844,390]]){await page.setViewportSize({width,height});await capture(width+'x'+height);assert.equal(await page.evaluate(()=>window.ashen.uiTree().children.every(n=>n.rect.x>=0&&n.rect.y>=0&&n.rect.x+n.rect.width<=100&&n.rect.y+n.rect.height<=100)),true);}
 assert.deepEqual(errors,[]);fs.writeFileSync(path.resolve(__dirname,'../tests/storybook-browser.json'),JSON.stringify({ok:true,errors,samples},null,2));console.log('PASS storybook art + real Canvas controls + desktop/phone landscape');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

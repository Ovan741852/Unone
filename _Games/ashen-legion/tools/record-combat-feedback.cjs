// Real production play, recorded before any video trimming. No reward injection.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/combat-video');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}}),page=await context.newPage(),started=Date.now(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8190/?build=combat-feedback-v1&seed=1');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 async function click(a){const r=await page.evaluate(a=>ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,a);assert.ok(r,a);await page.mouse.click((r.x+r.width/2)*14.4,(100-r.y-r.height/2)*9);await page.waitForTimeout(140);}
 await click('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await page.waitForTimeout(650);await click('Choice1');await page.waitForTimeout(650);await click('LeaveShop');
 await click('Mode_auto');await page.waitForTimeout(650);await click('Auto_small');await click('Auto_apply');
 const combatAt=(Date.now()-started)/1000;await page.mouse.move(1370,400);
 await page.waitForFunction(()=>ashen.metrics().labels.criticals>0,null,{timeout:15000});const criticalAt=(Date.now()-started)/1000;
 await page.waitForTimeout(400);await click('Mode_auto');await click('Unit3');await click('Auto_settings');await page.waitForTimeout(600);await click('Auto_boss');await click('Auto_apply');await page.mouse.move(1370,400);
 await page.waitForFunction(()=>ashen.metrics().lottie.celebrationVisible,null,{timeout:20000});const winAt=(Date.now()-started)/1000;
 const receipt=await page.evaluate(()=>({prizes:ashen.state().rewards,fx:ashen.metrics().lottie}));await page.waitForTimeout(1750);
 await page.screenshot({path:path.resolve(out,'../combat-feedback-preview.png')});await page.waitForTimeout(1500);
 const video=page.video();await context.close();await video.saveAs(path.join(out,'combat-feedback-raw.webm'));
 assert.deepEqual(errors,[]);const report={scope:'Actual production play and actual lottery results, no state injection',combatAt,criticalAt,winAt,receipt,errors};fs.writeFileSync(path.join(out,'recording.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({combatAt,criticalAt,winAt}));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

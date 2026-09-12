const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Test-only exported payload fixture: shorten battle clock. Production files stay unchanged.
 await page.route('**/content/project.json',async route=>{const r=await route.fetch(),p=await r.json();p.script=p.script.replace('S.time=S.roundDuration;','S.time=3;');await route.fulfill({response:r,json:p});});
 await page.goto('https://node.tail044891.ts.net:8444/?build=defeat-result');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
 async function click(a){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,a);assert.ok(r,'missing '+a);await page.mouse.click((r.x+r.width/2)*14.4,(100-r.y-r.height/2)*9);await page.waitForTimeout(120);}
 await click('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await click('Choice1');await click('LeaveShop');
 await page.waitForFunction(()=>window.ashen.state().phase==='defeat');
 assert.equal(await page.evaluate(()=>window.ashen.uiTree().children.some(n=>n.kind==='button'&&n.action==='Start')),false);
 await page.waitForTimeout(1400);await page.waitForFunction(()=>window.ashen.metrics().ui.assets.every(a=>a.state==='ready'));
 const s=await page.evaluate(()=>window.ashen.state()),tree=await page.evaluate(()=>window.ashen.uiTree());assert.match(s.message,/時間耗盡/);
 assert.equal(tree.children.find(n=>n.id==='defeat_stat_value_4').text,String(s.earned));
 await page.screenshot({path:path.resolve(__dirname,'../defeat-result.png')});
 await click('ReturnTown');assert.equal(await page.evaluate(()=>window.ashen.state().phase),'menu');assert.ok(await page.evaluate(()=>window.ashen.uiTree().children.some(n=>n.action==='Town1')));
 await click('UI_home');await click('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await click('Choice1');await click('LeaveShop');await page.waitForFunction(()=>window.ashen.state().phase==='defeat');await page.waitForTimeout(1300);await click('Start');assert.equal(await page.evaluate(()=>window.ashen.state().phase),'map');assert.equal(await page.evaluate(()=>window.ashen.state().round),1);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.resolve(__dirname,'../tests/defeat-browser.json'),JSON.stringify({ok:true,fixture:'battle time shortened to 3 seconds by intercepted test payload; production unchanged',errors,tree},null,2));console.log('PASS defeat staged reveal, statistics, return to town, retry via map; remote browser, no errors.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

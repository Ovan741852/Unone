// Integration QA only: intercept the project in this browser, then call the
// real Luau hit path with disclosed selected awards. Never write this fixture
// into the published project or alter the player's town save.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const portrait=process.argv.includes('--portrait'),width=portrait?390:1440,height=portrait?844:900;
const out=path.resolve(__dirname,'../tests/juicy-wins'+(portrait?'/portrait':''));fs.mkdirSync(out,{recursive:true});
const fixture=`
local originalUpdate=Game.update
function Game.start(api:any)
 apiRef=api;reset();beginBattle();publish(api)
end
function Game.update(api:any,dt:number)
 originalUpdate(api,dt)
 local rank=${portrait?'frame==90 and 5 or 0':'frame==90 and 3 or (frame==230 and 4 or (frame==370 and 5 or 0))'}
 if rank>0 then
  cooldown=0;S.selected=1;fire();local t=troops[#troops];t.skills.critChance=0
  addMonster(rank,-1.5,-1.5);local m=monsters[#monsters];m.guard=1
  apiRef={random={nextFloat=function()return rank==5 and 0 or .1 end},save=api.save}
  contactHit(t,m);if S.phase~="battle" then settleSurvivors()end
  apiRef=api;publish(api)
 end
end
`;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width,height},recordVideo:{dir:out,size:{width,height}}});const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/content/project.json',async route=>{const response=await route.fetch(),payload=await response.json();payload.script=payload.script.replace('return Game',fixture+'\nreturn Game');await route.fulfill({response,json:payload});});
 await page.goto('http://127.0.0.1:8190/?build=juicy-wins-qa&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 await page.evaluate(()=>{const note=document.createElement('div');note.textContent='演出驗證 · 指定 BIG / MEGA / LEGENDARY 獎項';note.style.cssText='position:fixed;left:20px;bottom:12px;z-index:100;color:#eedbbc;background:#102426bb;padding:6px 10px;font:12px sans-serif;pointer-events:none';document.body.append(note);});
 const samples={};
 for(const [id,asset]of (portrait?[]:[['big','big-win'],['mega','mega-win']])){
  await page.waitForFunction(asset=>ashen.metrics().lottie.activeAsset===asset&&ashen.metrics().lottie.celebrationVisible,asset,{timeout:20000,polling:16});
  samples[id+'Impact']=await page.evaluate(()=>ashen.metrics().lottie.impact);
  await page.waitForFunction(()=>ashen.metrics().lottie.stage==='count',null,{timeout:10000});
  await page.screenshot({path:path.join(out,id+'-actual-host.png')});samples[id]=await page.evaluate(()=>ashen.metrics().lottie);
 }
 await page.waitForFunction(()=>ashen.state().phase==='celebration'&&ashen.metrics().lottie.stage==='count'&&ashen.state().roundOutro.elapsed>2,null,{timeout:25000});
 samples.ultimate=await page.evaluate(()=>({s:ashen.state(),fx:ashen.metrics().lottie,ui:ashen.uiTree()}));
 assert.ok(!samples.ultimate.ui.children.some(n=>n.id==='result_earned'));assert.equal(samples.ultimate.fx.fullscreen,true);
 await page.screenshot({path:path.join(out,'ultimate-actual-host.png')});
 if(portrait){
  await page.evaluate(()=>ashen.action('Pause'));await page.waitForFunction(()=>ashen.state().paused);await page.waitForTimeout(400);
  const held=await page.evaluate(()=>ashen.state().roundOutro.elapsed);await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>ashen.state().roundOutro.elapsed),held);
  const r=await page.evaluate(()=>ashen.uiTree().children.find(n=>n.action==='Pause').rect);
  await page.mouse.click((r.x+r.width/2)*width/100,(100-r.y-r.height/2)*height/100);await page.waitForFunction(()=>!ashen.state().paused);
 }
 await page.waitForFunction(()=>ashen.state().phase==='clear',null,{timeout:20000});await page.waitForTimeout(700);
 samples.result=await page.evaluate(()=>({s:ashen.state(),fx:ashen.metrics().lottie,ui:ashen.uiTree(),metrics:ashen.metrics()}));
 assert.equal(samples.result.s.roundOutro.elapsed,6.4);assert.ok(samples.result.ui.children.some(n=>n.id==='result_earned'));assert.equal(samples.result.fx.celebrationVisible,false);
 assert.equal(samples.result.s.coins,samples.ultimate.s.coins);assert.deepEqual(samples.result.metrics.ui.diagnostics,[]);assert.deepEqual(samples.result.fx.diagnostics,[]);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(out,'result-after-ultimate.png')});await page.waitForTimeout(700);
 const video=page.video();await context.close();await video.saveAs(path.join(out,'juicy-wins-qa.webm'));
 fs.writeFileSync(path.join(out,'integration-report.json'),JSON.stringify({ok:true,scope:'Production host/rendering and actual WASM award function; browser-only fixture selects known awards for recording. No production payout or RNG edits.',samples,errors},null,2));console.log('PASS live host BIG → MEGA → LEGENDARY → result; preview recorded');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

// Real screen clicks -> official input -> production WASM -> observed spin center.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const samples=[],errors=[];
 for(const viewport of [{width:1440,height:900},{width:844,height:390},{width:390,height:844}]){
  const page=await browser.newPage({viewport});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8190/?build=dual-light-v1&seed=42');await page.waitForSelector('body[data-ready="true"]',{timeout:45000});
  async function action(name){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,name);assert.ok(r,name);await page.mouse.click((r.x+r.width/2)*viewport.width/100,(100-r.y-r.height/2)*viewport.height/100);await page.waitForTimeout(100);}
  await action('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await action('Choice1');await action('LeaveShop');await action('Unit2');
  for(const [x,z]of [[0,9],[0,0],[8,-7],[-12.2,-12.2],[12.2,-11.8]]){
   const before=await page.evaluate(()=>window.ashen.state().fired);
   const pixel=await page.evaluate(({x,z})=>window.ashen.projectPoint(x,z),{x,z});
   await page.mouse.move(pixel.x,pixel.y);await page.mouse.down();
   await page.waitForFunction(n=>window.ashen.state().fired>n,before,{timeout:2000});await page.mouse.up();
   const shot=await page.evaluate(()=>{const s=window.ashen.state(),t=[...s.visualTroops].sort((a,b)=>b.id-a.id)[0];return {id:t.id,aimX:s.aimX,aimZ:s.aimZ}});
   assert.ok(Math.hypot(shot.aimX-x,shot.aimZ-z)<.025,'screen-to-world input must match clicked point');
   // Shift the pointer away while the troop is flying: the saved destination must hold.
   const away=await page.evaluate(()=>window.ashen.projectPoint(-3,5));await page.mouse.move(away.x,away.y);
   await page.waitForFunction(id=>window.ashen.state().visualTroops.some(t=>t.id===id&&t.state==='spin'),shot.id,{timeout:3500});
   const landed=await page.evaluate(id=>window.ashen.state().visualTroops.find(t=>t.id===id),shot.id);
   const error=Math.hypot(landed.x-x,landed.z-z);assert.ok(error<.025,`landing error ${error} at ${x},${z}`);assert.equal(landed.y,0);
   samples.push({viewport,click:{x,z,pixel},input:shot,landed:{x:landed.x,z:landed.z,y:landed.y,state:landed.state},error});
   if(x===8&&viewport.width===1440)await page.screenshot({path:path.resolve(__dirname,'../spear-landing-v1.png')});
   await page.waitForTimeout(100);
  }
  assert.deepEqual(await page.evaluate(()=>window.ashen.metrics().ui.diagnostics),[]);await page.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.resolve(__dirname,'../tests/spear-pointer.json'),JSON.stringify({ok:true,scope:'Real Canvas clicks, current square arena with normal perspective, no state injection',samples,errors},null,2));
 console.log(JSON.stringify({ok:true,landings:samples.length,maxWorldError:Math.max(...samples.map(s=>s.error)),errors}));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

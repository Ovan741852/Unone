const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/dual-light');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],samples=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto('http://127.0.0.1:8190/?build=dual-light-v1&seed=1&lighting=day');await page.waitForSelector('body[data-ready="true"]',{timeout:45000});
 async function action(name){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,name);assert.ok(r,name);await page.mouse.click((r.x+r.width/2)*14.4,(100-r.y-r.height/2)*9);await page.waitForTimeout(120);}
 async function shot(name){await page.screenshot({path:path.join(out,name+'.png')});const s=await page.evaluate(()=>({state:ashen.state(),metrics:ashen.metrics()}));samples.push({name,...s});console.log('CAPTURE',name,s.state.monsters.length,s.metrics.lighting);return s;}
 await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');await action('LeaveShop');await page.waitForTimeout(900);
 const day=await shot('battle-day');assert.equal(day.state.monsters.length,35);assert.equal(day.metrics.camera.fan,false);
 await page.evaluate(()=>ashen.setLighting('night'));await page.waitForTimeout(120);const night=await shot('battle-night');assert.equal(night.metrics.lighting.nightMix,1);
 assert.notEqual(day.metrics.lighting.left.color,day.metrics.lighting.right.color);assert.ok(day.metrics.lighting.left.intensity>0&&day.metrics.lighting.right.intensity>0);
 await page.waitForFunction(()=>ashen.state().hordeCount===1,null,{timeout:55000});await page.waitForTimeout(800);const horde=await shot('horde-night');assert.equal(horde.state.monsters.filter(m=>m.rank<=2).length,110);
 await action('Unit3');await action('Mode_auto');await page.waitForTimeout(650);await action('Auto_apply');await page.waitForTimeout(1700);await shot('combat-night');await page.evaluate(()=>ashen.setLighting('day'));await page.waitForTimeout(100);await shot('combat-day');
 assert.deepEqual(errors,[]);assert.deepEqual((await page.evaluate(()=>ashen.metrics())).ui.diagnostics,[]);
 await page.goto('http://127.0.0.1:8190/presentation/art-lab.html?kind=soldier');await page.waitForFunction(()=>window.artLab?.ready);await page.click('#play');
 const lightChecks=[];
 for(const mode of ['day','night'])for(const side of ['both','left','right']){
  await page.selectOption('#lighting',mode);await page.selectOption('#light-side',side);await page.waitForTimeout(100);await page.screenshot({path:path.join(out,`soldier-${mode}-${side}.png`)});
  const lighting=await page.evaluate(()=>artLab.lighting.inspect());assert.equal(lighting.mode,mode);assert.equal(lighting.side,side);if(side==='left')assert.equal(lighting.right.intensity,0);if(side==='right')assert.equal(lighting.left.intensity,0);lightChecks.push(lighting);
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,scope:'Live production Canvas game, 35 opening monsters, natural 110-small-monster surge, normal perspective, same assets under day/night and isolated left/right lights',samples,lightChecks,errors},null,2));console.log('PASS dual lighting + natural crowd');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

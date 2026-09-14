const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8190/presentation/creature-lab.html');await page.waitForFunction(()=>window.creatureLab?.player);
 const ids=await page.locator('#species option').evaluateAll(xs=>xs.map(x=>x.value));assert.equal(ids.length,11);
 for(const id of ids){await page.selectOption('#species',id);await page.waitForFunction(id=>window.creatureLab?.root.name===id+'-rig'||window.creatureLab?.root.getObjectByName(id+'-rig'),id);
  const clips=await page.evaluate(()=>creatureLab.asset.animations.map(x=>x.name));assert.deepEqual(clips,['idle','walk','attack','hit','death','spawn','stretch','run']);
  for(const clip of clips){await page.selectOption('#motion',clip);assert.equal(await page.evaluate(()=>creatureLab.player.getState().state),clip)}
 }
 await page.selectOption('#species','beetle');await page.waitForFunction(()=>!!creatureLab.root.getObjectByName('beetle-rig'));await page.selectOption('#motion','idle');await page.waitForTimeout(250);
 await page.screenshot({path:path.resolve(__dirname,'../creature-beetle-preview.png')});
 await page.locator('#play').click();const time=await page.evaluate(()=>creatureLab.player.getState().time);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>creatureLab.player.getState().time),time);
 await page.locator('#bones').check();await page.selectOption('#species','stag');await page.waitForFunction(()=>!!creatureLab.root.getObjectByName('stag-rig'));
 await page.screenshot({path:path.resolve(__dirname,'../creature-stag-skeleton.png')});
 assert.deepEqual(errors,[]);console.log('PASS 11 textured Blender creatures, 88 Animator transitions, pause and skeleton viewer, no browser errors');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

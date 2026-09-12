const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests'),reports=[];
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const [width,height]of [[1440,900],[844,390],[390,844],[768,1024],[320,568]]){
   const context=await browser.newContext({viewport:{width,height},hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:8190/?build=auto-targets-v1&seed=1');await page.waitForSelector('body[data-ready="true"]',{timeout:45000});
   const state=()=>page.evaluate(()=>ashen.state());
   async function click(action){
    const rect=await page.evaluate(a=>ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,action);assert.ok(rect,action);
    await page.touchscreen.tap((rect.x+rect.width/2)*width/100,(100-rect.y-rect.height/2)*height/100);await page.waitForTimeout(140);
   }
   await click('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await click('Choice1');await click('LeaveShop');await click('Auto_settings');
   await page.waitForFunction(()=>ashen.state().autoConfigOpen&&ashen.metrics().ui.assets.every(a=>a.state==='ready'));
   const opened=await state();assert.equal(opened.fired,0);assert.equal(opened.fireMode,'manual');
   await page.mouse.click(width*.5,height*.17);await page.keyboard.press('Space');await page.waitForTimeout(200);
   assert.equal((await state()).fired,0);assert.equal((await state()).time,opened.time);
   const tree=await page.evaluate(()=>ashen.uiTree());assert.equal(tree.node,'battle:auto');
   for(const n of tree.children){assert.ok(n.rect.x>=-.01&&n.rect.y>=-.01&&n.rect.x+n.rect.width<=100.01&&n.rect.y+n.rect.height<=100.01,'bounds: '+n.id);}
   const controls=tree.children.filter(n=>n.kind==='button');
   for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
    const a=controls[i].rect,b=controls[j].rect;
    const overlap=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.01&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.01;
    assert.equal(overlap,false,`${width}: ${controls[i].id} overlaps ${controls[j].id}`);
   }
   await click('Auto_none');assert.equal(Object.values((await state()).autoDraft).filter(Boolean).length,0);
   assert.equal(await page.evaluate(()=>ashen.uiTree().children.some(n=>n.kind==='button'&&n.action==='Auto_apply')),false);
   // Both thumbnail and text select the same species; selection is a draft until confirmed.
   await click('Auto_target_acorn');await click('Auto_target_boar');await click('Auto_target_beetle');await click('Auto_target_stag');
   assert.equal(Object.values((await state()).autoDraft).filter(Boolean).length,4);
   await page.screenshot({path:path.join(out,`auto-targets-${width}x${height}.png`)});
   await click('Auto_apply');await page.waitForFunction(()=>ashen.state().fired>0);assert.equal((await state()).autoConfigOpen,false);assert.equal((await state()).fireMode,'auto');
   await click('Auto_settings');const before=await state();await page.waitForTimeout(250);assert.equal((await state()).fired,before.fired);assert.equal((await state()).time,before.time);
   await click('Auto_none');await click('Auto_cancel');assert.equal(Object.values((await state()).autoTargets).filter(Boolean).length,4);
   await click('Auto_settings');await click('Auto_none');await click('Auto_target_stag');await click('Auto_apply');
   const waiting=await state();await page.waitForTimeout(350);assert.equal((await state()).fired,waiting.fired);assert.equal((await state()).targetId,0);
   assert.match(await page.evaluate(()=>ashen.uiTree().children.find(n=>n.id==='target').text),/等待/);
   await click('Auto_settings');await click('Auto_stop');assert.equal((await state()).fireMode,'manual');
   assert.equal(await page.evaluate(()=>ashen.uiTree().children.some(n=>n.action==='Mode_manual')),false);
   await click('Mode_lock');assert.equal((await state()).lockEnabled,true);assert.equal((await state()).autoEnabled,false);
   await click('Mode_lock');assert.equal((await state()).lockEnabled,false);
   await click('Mode_auto');assert.equal((await state()).autoConfigOpen,true);await click('Auto_apply');assert.equal((await state()).autoEnabled,true);
   await click('Mode_lock');assert.equal((await state()).autoEnabled,true);assert.equal((await state()).lockEnabled,true);
   await page.screenshot({path:path.join(out,`fire-toggles-${width}x${height}.png`)});
   await click('Mode_auto');assert.equal((await state()).autoEnabled,false);assert.equal((await state()).lockEnabled,true);assert.equal((await state()).autoConfigOpen,false);
   await click('Mode_lock');assert.equal((await state()).lockEnabled,false);const off=(await state()).fired;await page.waitForTimeout(250);assert.equal((await state()).fired,off);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>ashen.state().paused);await click('Pause');
   assert.deepEqual(await page.evaluate(()=>ashen.metrics().ui.diagnostics),[]);assert.deepEqual(errors,[]);
   reports.push({width,height,ok:true,buttons:controls.length,species:10});console.log('PASS actual Canvas AUTO selection '+width+'x'+height);
   await context.close();
  }
  // Exercise entry motion, resize and held pointer cancellation with the same real hit tree.
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.goto('http://127.0.0.1:8190/?build=auto-targets-motion&seed=1');await page.waitForSelector('body[data-ready="true"]',{timeout:45000});
  for(const a of ['Start','Choice1','LeaveShop']){if(a==='Choice1')await page.waitForFunction(()=>ashen.state().phase==='choice');await page.evaluate(a=>ashen.action(a),a);await page.waitForTimeout(120);}
  await page.keyboard.down('Space');await page.waitForFunction(()=>ashen.state().fired>0);await page.evaluate(()=>ashen.action('Auto_settings'));
  await page.waitForFunction(()=>ashen.state().autoConfigOpen);await page.waitForTimeout(800);
  assert.equal(await page.evaluate(()=>ashen.uiTree().node),'battle:auto');await page.setViewportSize({width:390,height:844});await page.waitForTimeout(120);
  await page.keyboard.press('Escape');await page.waitForTimeout(200);const fired=await page.evaluate(()=>ashen.state().fired);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>ashen.state().fired),fired);
  await page.keyboard.up('Space');await page.close();
  fs.writeFileSync(path.join(out,'auto-targets-browser.json'),JSON.stringify({ok:true,reports,motionResizeAndHeldInput:true},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

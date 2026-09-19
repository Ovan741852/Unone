const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/cavalry-tracking');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:810}}),errors=[],reports=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  // Keep the natural moving tree alive long enough to observe a full crossing.
  // Only its guard value changes in memory; actual AUTO, physics and rendering run.
  await page.route('**/content/project.json',async route=>{
   const response=await route.fetch(),payload=await response.json();
   payload.script=payload.script.replace('addMonster(4,0,-8)','addMonster(4,0,-8);monsters[#monsters].guard=1e9');
   await route.fulfill({response,json:payload});
  });
  const action=async name=>{await page.evaluate(n=>ashen.action(n),name);await page.waitForTimeout(140)};
  for(const lock of [false,true]){
   await page.goto('http://127.0.0.1:8190/?build=cavalry-tracking-fix&seed=42');
   await page.waitForSelector('body[data-ready=true]',{timeout:45000});
   await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await action('Choice1');await action('LeaveShop');await action('Unit3');
   if(lock)await action('Mode_lock');
   await action('Mode_auto');await action('Auto_none');await action('Auto_target_elder');await action('Auto_apply');
   await page.waitForFunction(()=>Object.values(ashen.state().visualTroops??{}).some(t=>t.k===3),null,{timeout:15000});
   const result=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const start=performance.now(),state=ashen.state(),treeId=state.targetId;
    const id=Object.values(state.visualTroops).find(t=>t.k===3).id;let enter=null,exit=null;const samples=[];
    function sample(){
     const s=ashen.state(),t=Object.values(s.visualTroops??{}).find(t=>t.id===id),tree=Object.values(s.monsters??{}).find(m=>m.id===treeId);
     if(!t||!tree)return reject(Error('Tracked cavalry or tree vanished before crossing'));
     const distance=Math.hypot(t.x-tree.x,t.z-tree.z),inside=distance<=.4+tree.scale*.5;
     if(inside&&enter===null)enter=t.age;
     if(enter!==null&&!inside&&exit===null)exit=t.age;
     if(!samples.length||t.age-samples.at(-1).age>=.09)samples.push({age:t.age,x:t.x,z:t.z,distance,pierce:t.pierce,bounces:t.bounces});
     if(exit!==null&&t.bounces>=1)return resolve({id,treeId,enter,exit,samples,lock:s.lockEnabled,auto:s.autoEnabled,metrics:ashen.metrics()});
     if(performance.now()-start>20000)return reject(Error('Cavalry never left the tree and reached a wall'));
     requestAnimationFrame(sample);
    }sample();
   }));
   assert.ok(result.enter!==null&&result.exit-result.enter<.45);assert.equal(result.lock,lock);assert.equal(result.auto,true);
   assert.deepEqual(result.metrics.ui.diagnostics,[]);assert.ok(result.metrics.actors.actors>0);
   await page.screenshot({path:path.join(out,lock?'auto-lock-after.png':'auto-after.png')});reports.push(result);
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({scope:'1440x810 actual browser. Natural tree guard increased only in memory; production AUTO menu, moving monsters, physics, rendering and accounting.',reports,errors},null,2));
  console.log('PASS actual landscape AUTO / AUTO+LOCK cavalry exits the tree and rebounds',reports.map(r=>({lock:r.lock,entered:r.enter,exited:r.exit})));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

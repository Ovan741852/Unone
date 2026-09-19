const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../tests/landscape');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const state=()=>page.evaluate(()=>ashen.state());
 const tap=async action=>{
  await page.waitForFunction(a=>ashen.uiTree()?.children.some(n=>n.kind==='button'&&n.action===a),action);
  await page.waitForTimeout(300);
  const p=await page.evaluate(a=>{
   const nodes=ashen.uiTree().children.filter(n=>n.kind==='button'&&n.action===a),n=nodes.find(n=>n.text)||nodes[0];
   const c=document.querySelector('#game'),r=c.getBoundingClientRect(),u=(n.rect.x+n.rect.width/2)/100,v=1-(n.rect.y+n.rect.height/2)/100;
   return innerHeight>innerWidth?{x:r.left+(1-v)*r.width,y:r.top+u*r.height}:{x:r.left+u*r.width,y:r.top+v*r.height};
  },action);await page.touchscreen.tap(p.x,p.y);await page.waitForTimeout(180);
 };
 await page.goto('http://127.0.0.1:8190/?build=forced-landscape-v1&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});await page.waitForTimeout(650);
 const portrait=await page.evaluate(()=>({viewport:ashen.metrics().viewport,gate:!!document.querySelector('#landscape-gate'),layers:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,parent:c.parentElement.id,width:c.clientWidth,height:c.clientHeight})),overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight}));
 assert.equal(portrait.viewport.width,844);assert.equal(portrait.viewport.height,390);assert.equal(portrait.viewport.rotationDegrees,90);assert.equal(portrait.gate,false);assert.equal(portrait.overflow,false);assert.ok(portrait.layers.every(c=>c.parent==='stage'));
 await page.screenshot({path:path.join(out,'portrait-menu.png')});
 await tap('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await tap('Choice1');await tap('LeaveShop');await tap('Unit2');
 assert.equal((await state()).selected,2);
 const target={x:3,z:2},p=await page.evaluate(({x,z})=>{
  const q=ashen.projectPoint(x,z),c=document.querySelector('#game'),r=c.getBoundingClientRect();
  return {x:r.left+(1-q.y/c.clientHeight)*r.width,y:r.top+q.x/c.clientWidth*r.height};
 },target);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});
 await page.waitForTimeout(450);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
 const aim=await state();assert.ok(Math.abs(aim.aimX-target.x)<.05&&Math.abs(aim.aimZ-target.z)<.05,JSON.stringify({aimX:aim.aimX,aimZ:aim.aimZ,target}));assert.ok(aim.fired>0);
 await page.screenshot({path:path.join(out,'portrait-battle.png')});
 const fired=aim.fired;await page.waitForTimeout(250);assert.equal((await state()).fired,fired);
 await tap('Mode_auto');assert.ok((await state()).autoConfigOpen);await page.screenshot({path:path.join(out,'portrait-auto.png')});await tap('Auto_apply');
 await page.waitForFunction(()=>ashen.state().fired>0&&ashen.state().autoEnabled);const before=await state();
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(600);const wide=await state();
 assert.equal(wide.phase,'battle');assert.equal(wide.paused,false);assert.ok(wide.time<before.time);assert.equal(wide.round,before.round);assert.equal(wide.selected,2);
 assert.equal(await page.evaluate(()=>ashen.metrics().viewport.rotationDegrees),0);
 await tap('Pause');assert.equal((await state()).paused,true);await page.setViewportSize({width:390,height:844});await page.waitForTimeout(450);assert.equal((await state()).paused,true);await tap('Pause');assert.equal((await state()).paused,false);
 await page.evaluate(()=>{const s=document.documentElement.style;s.setProperty('--safe-top','20px');s.setProperty('--safe-right','3px');s.setProperty('--safe-bottom','10px');s.setProperty('--safe-left','4px');window.dispatchEvent(new Event('resize'))});
 assert.deepEqual(await page.evaluate(()=>ashen.metrics().viewport.safeInsets),{left:20,top:3,right:10,bottom:4});
 await page.setViewportSize({width:1440,height:810});await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>ashen.metrics().viewport.rotationDegrees),0);await page.screenshot({path:path.join(out,'desktop-battle.png')});
 assert.deepEqual(await page.evaluate(()=>ashen.metrics().ui.diagnostics),[]);assert.deepEqual(errors,[]);
 await page.setViewportSize({width:390,height:844});
 // Frozen presentation receipts exercise layers independently of lottery RNG.
 const prizes=await page.evaluate(async()=>{
  const {createRewardPresentation}=await import('/presentation/rewards.mjs');
  const container=document.createElement('div');container.style.cssText='position:absolute;inset:0;pointer-events:none';document.querySelector('#stage').append(container);
  const fx=await createRewardPresentation({container}),frame=()=>new Promise(requestAnimationFrame);
  let s={phase:'battle',round:1,seat:1,event:1,rewards:[{id:1,tier:3,title:'BIG WIN',amount:180,playerId:1}],rewardClock:1};
  for(let i=0;i<8;i++){fx.update(s,.08);await frame()}
  const big=fx.inspect(),c=container.querySelector('#official-lottie'),r=c.getBoundingClientRect(),size={width:c.clientWidth,height:c.clientHeight,physicalWidth:r.width,physicalHeight:r.height};
  s={...s,event:2,rewards:[{id:2,tier:4,title:'LEGENDARY WIN',amount:1800,playerId:1}]};for(let i=0;i<12;i++){fx.update(s,.08);await frame()}
  const ultimate=fx.inspect();
  s={...s,event:3,rewards:[],roulette:{time:0,result:1,label:'豐收祝福'}};fx.update(s,.08);await frame();
  const chest=container.querySelector('#special-reward'),bounds=chest.getBoundingClientRect();
  const special={width:chest.clientWidth,height:chest.clientHeight,physicalWidth:bounds.width,physicalHeight:bounds.height};fx.dispose();container.remove();return {big,ultimate,size,special};
 });
 assert.equal(prizes.size.width,844);assert.equal(prizes.size.height,390);assert.equal(prizes.size.physicalWidth,390);assert.equal(prizes.size.physicalHeight,844);
 assert.ok(prizes.big.celebrationVisible);assert.ok(prizes.ultimate.fullscreen);assert.equal(prizes.special.width,150);assert.ok(Math.abs(prizes.special.physicalHeight-prizes.special.width)<1);
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({portrait,aim:{x:aim.aimX,z:aim.aimZ,fired:aim.fired},wide:{time:wide.time,paused:wide.paused},prizes,errors},null,2));
 console.log('PASS auto-rotated portrait, native touch menu and spear aim, AUTO sheet, release, rotation preserves battle/pause, safe insets, desktop and all canvas layers');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../tests/juicy-wins');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[],reports=[];try{
 for(const [width,height,reduced]of [[1440,900,false],[844,390,false],[390,844,false],[320,568,true]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8190/?build=juicy-wins-v1');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
  await page.evaluate(async()=>{
   const {createRewardPresentation}=await import('./presentation/rewards.mjs');const container=document.createElement('div');container.style.cssText='position:fixed;inset:0;z-index:100;pointer-events:none';document.body.append(container);
   const fx=await createRewardPresentation({container,getInsets:()=>({left:12,right:8,top:24,bottom:20})}),s={phase:'battle',seat:1,event:0,rewards:[],rewardClock:0,paused:false,audioMuted:true,fired:0,criticalHits:0};
   const step=(n=1)=>{for(let i=0;i<n;i++){if(!s.paused)s.rewardClock+=1/60;fx.update(s,1/60);}return fx.inspect();};
   const add=(id,tier,title,amount,playerId=1)=>{s.event=id;s.rewards.push({id,tier,title,amount,playerId,time:s.rewardClock});fx.update(s,0);return fx.inspect();};
   window.juiceQA={fx,s,step,add,container};
  });
  const early=await page.evaluate(()=>{const q=juiceQA,a=q.add(1,3,'BIG WIN',110);q.step(7);const big=q.fx.inspect();q.step(190);q.add(2,3,'MEGA WIN',250);q.step(7);const mega=q.fx.inspect();q.step(190);q.add(3,4,'LEGENDARY WIN',1100);q.step(30);return {big,mega,impact:q.fx.inspect()};});
  assert.equal(early.big.fullscreen,false);assert.equal(early.mega.fullscreen,false);assert.equal(early.impact.fullscreen,true);
  if(reduced){assert.equal(early.big.impact.peak,0);assert.equal(early.mega.impact.peak,0);assert.equal(early.impact.impact.peak,0);}
  else {assert.ok(early.mega.impact.peak>early.big.impact.peak);assert.ok(early.impact.impact.peak>early.mega.impact.peak);}
  const middle=await page.evaluate(()=>juiceQA.step(102));assert.equal(middle.stage,'count');assert.ok(middle.rolledAmount>0&&middle.rolledAmount<1100);
  await page.screenshot({path:path.join(out,`ultimate-${width}x${height}.png`)});
  const result=await page.evaluate(()=>{
   const q=juiceQA,before=q.fx.inspect();q.s.paused=true;const paused=q.step(60);q.s.paused=false;q.step(1);q.add(4,1,'',28);q.add(5,4,'LEGENDARY WIN',9000,2);q.step(170);const hold=q.fx.inspect();q.step(110);const done=q.fx.inspect();
   q.s.phase='menu';q.s.event=0;q.s.rewards=[];const reset=q.step();q.fx.dispose();q.container.remove();return {before,paused,hold,done,reset};
  });
  assert.equal(result.paused.rolledAmount,result.before.rolledAmount);assert.equal(result.paused.celebrationVisible,false);assert.deepEqual(result.paused.impact.offset,{x:0,y:0});
  assert.equal(result.hold.rolledAmount,1100);assert.equal(result.hold.targetAmount,1100);assert.equal(result.done.celebrationVisible,false);assert.equal(result.done.fullscreen,false);assert.equal(result.reset.rolledAmount,0);
  assert.deepEqual(result.hold.diagnostics,[]);assert.deepEqual(result.hold.impact.diagnostics,[]);reports.push({width,height,reduced,early,middle,result});await page.close();console.log('PASS juicy presentation '+width+'x'+height+' reduced='+reduced);
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({ok:true,scope:'Isolated presentation receipts; not evidence of lottery rates',reports,errors},null,2));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

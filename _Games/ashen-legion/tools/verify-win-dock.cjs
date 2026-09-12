// Synthetic presentation receipts only: no simulated winnings injected into game.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const samples=[];
 for(const [width,height,reduced]of [[1440,900,false],[844,390,false],[390,844,false],[320,568,true]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference'});await page.goto('http://127.0.0.1:8190/');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
  const result=await page.evaluate(async()=>{
   const {createWinDock}=await import('./presentation/win-dock.mjs');
   const container=document.createElement('div');container.style.cssText='position:fixed;inset:0;pointer-events:none';document.body.append(container);
   const fx=await createWinDock({container,getInsets:()=>({left:12,right:8,top:4,bottom:6})});
   const s={phase:'battle',seat:1,paused:false,event:0,rewards:[]};
   const states=[],step=(n=1)=>{for(let i=0;i<n;i++)fx.update(s,1/60);return fx.inspect();};
   const add=(id,tier,title,amount,playerId=1)=>{s.event=id;s.rewards.push({id,tier,title,amount,playerId});fx.update(s,0);return fx.inspect();};
   states.push(add(1,1,'',16));states.push(add(2,3,'BIG WIN',110));states.push(step(8));states.push(step(30));
   states.push(step(80));const before=fx.inspect();step(4);const same=fx.inspect();
   states.push(add(3,3,'MEGA WIN',250));states.push(add(4,4,'LEGENDARY WIN',1100));states.push(add(5,3,'BIG WIN',110));
   states.push(add(6,1,'',28));states.push(add(7,4,'LEGENDARY WIN',9000,2));
   s.paused=true;const paused=step(20);s.paused=false;step(290);const exact=fx.inspect();
   s.event=0;s.rewards=[];s.phase='menu';const reset=step();fx.dispose();container.remove();
   return {states,before,same,paused,exact,reset};
  });
  assert.equal(result.states[0].celebrationVisible,false);assert.equal(result.states[1].targetAmount,110);
  assert.ok(result.states[3].rolledAmount>0&&result.states[3].rolledAmount<110);assert.equal(result.states[3].stage,'count');assert.deepEqual(result.states[3].visualRect,result.states[3].dockRect);
  assert.equal(result.before.targetAmount,result.same.targetAmount,'duplicate snapshots do not count again');
  assert.equal(result.states[5].activeAsset,'mega-win');assert.equal(result.states[6].activeAsset,'legendary-win');assert.equal(result.states[6].fullscreen,true);assert.equal(result.states[6].dockRect,null);assert.equal(result.states[7].activeAsset,'legendary-win');
  assert.equal(result.states[9].targetAmount,1570,'ordinary / other-player awards excluded from this major batch');assert.equal(result.paused.rolledAmount,result.states[9].rolledAmount);
  assert.equal(result.exact.rolledAmount,1570);assert.equal(result.reset.celebrationVisible,false);assert.equal(result.reset.rolledAmount,0);
  for(const x of result.states.filter(x=>x.visualRect)){const r=x.visualRect;assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=width+.01&&r.y+r.height<=height+.01);}
  if(reduced)assert.deepEqual(result.states[1].visualRect,result.states[1].dockRect,'reduced motion goes directly to the dock');
  samples.push({width,height,reduced,result});await page.close();console.log('PASS badge accumulation, timing, pause and viewport '+width+'x'+height);
 }
 fs.writeFileSync(path.resolve(__dirname,'../tests/win-dock-contract.json'),JSON.stringify({ok:true,scope:'Isolated synthetic presentation events, not game lottery evidence',samples},null,2));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

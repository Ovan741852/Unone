import fs from 'node:fs';
import assert from 'node:assert/strict';
import {CdpClient} from './cdp-client.mjs';
const url=process.argv[2]||'http://127.0.0.1:8240/release-005/';
const out='artifacts/playable/qa-credit';fs.mkdirSync(out,{recursive:true});
const cdp=await CdpClient.connect(),{targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
const {sessionId:s}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
const errors=[],checks=[],captures=[];
cdp.listeners.add(e=>{if(e.sessionId===s&&e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails);});
const ev=x=>cdp.evaluate(s,x),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>ev('window.hotChickDebug?.snapshot()');
const vals=v=>Object.values(v||{});
const wait=async(fn,label,timeout=6000)=>{const end=Date.now()+timeout;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(30);}throw Error(label);};
const click=selector=>ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'},s);fs.writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'));};
const clickTarget=async target=>{
 const pos=await ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.left+((${target.x})/17.77777778+.5)*r.width,y:r.top+(.5-(${target.y})/10)*r.height}})()`);
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...pos},s);
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',buttons:1,clickCount:1},s);await sleep(65);
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',buttons:0,clickCount:1},s);
};
const startMonitor=()=>ev(`(()=>{window.__creditQa={running:true,samples:[]};function frame(){if(!window.__creditQa.running)return;const x=window.hotChickDebug.snapshot(),f=Object.values(x.rewardFx||{});window.__creditQa.samples.push({time:x.time,balance:x.balance,display:x.displayBalance,pending:x.pendingWin,collected:x.collectedWin,won:x.stats.won,spent:x.stats.spent,stage:x.reveal?.stage||null,revealSerial:x.reveal?.serial||null,arrivals:x.walletArrivalsSerial,increment:x.walletLastIncrement,incrementSerial:x.walletLastIncrementSerial,incrementAge:x.walletLastIncrementAge,dom:Number(document.querySelector('[data-value=balance]').textContent.replace(/,/g,'')),hearts:Object.values(x.fxHearts||{}).length,fx:f.map(a=>({id:a.id,count:a.count,arrived:a.arrivedCount,collected:a.collectedAmount,amount:a.amount,age:a.age,preview:a.preview}))});if(window.__creditQa.samples.length<15000)requestAnimationFrame(frame)}requestAnimationFrame(frame);return true})()`);
const stopMonitor=()=>ev('(()=>{window.__creditQa.running=false;return window.__creditQa.samples})()');
try{
 await cdp.send('Runtime.enable',{},s);await cdp.send('Page.enable',{},s);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},s);
 await cdp.send('Page.navigate',{url},s);await wait(()=>ev('Boolean(window.hotChickDebug?.ready)'),'game not ready',45000);
 for(const tier of ['small','medium','large']){
  let won=null,before=null;
  for(let attempt=0;attempt<50;attempt++){
   await wait(async()=>{const x=await state();return x.canShoot&&!x.reveal&&vals(x.rewardFx).length===0&&x.rewardFxPendingCount===0;},'board did not become available',18000);
   before=await state();
   const eligible=before.targets.filter(t=>t.tier===tier&&t.state==='swimming'&&t.x>-7.2&&t.x<6.5&&Math.abs(t.y)<2.7);
   const target=eligible.find(t=>before.targets.every(o=>o.id===t.id||Math.hypot(o.x-t.x,o.y-t.y)>.23));
   if(!target){await sleep(450);continue;}
   await startMonitor();await clickTarget(target);
   await wait(async()=>(await state()).stats.shots>before.stats.shots,'pointer click did not fire');
   const result=await wait(async()=>{const x=await state();return x.time-before.time>.6?x:null;},'attack did not resolve');
   if(result.stats.won>before.stats.won){won=result;break;}
   await stopMonitor();
  }
  assert(won,`failed to obtain normal ${tier} win`);
  const amount=won.stats.won-before.stats.won,postBet=before.displayBalance-before.bet;
  assert.equal(won.balance,before.balance-before.bet+amount);assert.equal(won.displayBalance,postBet);assert.equal(won.pendingWin,amount);
  await shot(`${tier}-before-collection`);
  const owner=won.reveal?.serial;
  const reward=await wait(async()=>{const x=await state();return vals(x.rewardFx).some(f=>!f.preview)?x:null;},`${tier} did not reach reward`,16000);
  const fx=vals(reward.rewardFx).find(f=>!f.preview);assert.equal(fx.amount,amount);
  await wait(async()=>{const x=await state();return x.displayBalance>postBet?x:null;},'wallet did not increment on arrivals');
  await shot(`${tier}-count-up`);
  const finished=await wait(async()=>{const x=await state();return x.pendingWin===0&&!x.reveal&&vals(x.rewardFx).length===0&&x.rewardFxPendingCount===0?x:null;},'reward ended without completing collection',20000);
  await shot(`${tier}-completed`);
  const samples=await stopMonitor(),changes=[];
  for(let i=0;i<samples.length;i++){
   const x=samples[i];assert.equal(x.display+x.pending,x.balance);assert.equal(x.dom,x.display,'visible HUD diverged from Lua display balance');
   if(i>0){const p=samples[i-1];if(x.display>p.display){assert(x.arrivals>p.arrivals,'credit appeared without a heart arrival');changes.push(x.display);}}
  }
  assert(samples.filter(x=>x.stage==='intro'||x.stage==='video').every(x=>x.display===postBet),'wallet changed during the performance');
  const creditStates=samples.filter(x=>x.display>postBet&&x.display<postBet+amount);
  assert(creditStates.length>0,'wallet jumped directly to the full award');assert(new Set(creditStates.map(x=>x.display)).size>=2,'wallet did not count up in multiple batches');
  const beforeArrival=samples.filter(x=>x.arrivals===before.walletArrivalsSerial&&x.spent>before.stats.spent);
  assert(beforeArrival.every(x=>x.display===postBet),'award was shown before hearts arrived');
  assert.equal(finished.displayBalance,postBet+amount);assert.equal(finished.displayBalance,finished.balance);
  const completeFx=samples.some(x=>x.fx.some(f=>f.id===fx.id&&f.arrived===f.count&&f.collected===f.amount));assert(completeFx,'effect disappeared before all hearts and the exact award were collected');
  if(owner){const last=samples.filter(x=>x.revealSerial===owner).at(-1);assert.equal(last.stage,'reward');assert.equal(last.display,postBet+amount);assert.equal(last.hearts,0);}
  captures.push({tier,amount,postBet,finalBalance:finished.displayBalance,updates:[...new Set(changes)],samples});
  checks.push(`${tier}: no credit before arrival; multiple exact HUD increments; all hearts collected before reveal closes`);
  console.log(JSON.stringify({tier,amount,postBet,finalBalance:finished.displayBalance,updates:[...new Set(changes)]}));
 }
 const previewBefore=await state();await click('[data-action="PreviewMedium"]');
 await wait(async()=>(await state()).reveal?.stage==='video','preview video');await click('.hc-reveal [data-ui="close-reveal"]');
 await wait(async()=>!(await state()).reveal,'preview cleanup',6000);const previewAfter=await state();
 assert.equal(previewAfter.displayBalance,previewBefore.displayBalance);assert.equal(previewAfter.balance,previewBefore.balance);assert.equal(previewAfter.stats.won,previewBefore.stats.won);assert.equal(previewAfter.pendingWin,0);checks.push('preview skip does not create or display credit');
 await click('[data-ui="gallery"]');await wait(async()=>ev('Boolean(document.querySelector("[data-replay=medium]"))'),'gallery unlock render');
 const replayBefore=await state();await click('[data-replay="medium"]');await sleep(1300);const replayAfter=await state();assert.equal(replayAfter.displayBalance,replayBefore.displayBalance);assert.equal(replayAfter.balance,replayBefore.balance);assert.equal(replayAfter.stats.won,replayBefore.stats.won);checks.push('gallery replay does not count up or award again');
 await click('[data-ui="close-gallery"]');assert.equal(errors.length,0);checks.push('no uncaught browser exceptions');
 const report={url,browser:cdp.version.Browser,checks,captures,errors,final:await state()};fs.writeFileSync(`${out}/win-credit-acceptance.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){await shot('failure').catch(()=>{});fs.writeFileSync(`${out}/failure.json`,JSON.stringify({error:String(error),state:await state().catch(()=>null),samples:await stopMonitor().catch(()=>null),errors},null,2));throw error;}
finally{await cdp.send('Target.closeTarget',{targetId});cdp.close();}

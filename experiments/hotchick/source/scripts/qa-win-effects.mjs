import fs from 'node:fs';
import assert from 'node:assert/strict';
import {CdpClient} from './cdp-client.mjs';
const url=process.argv[2]||'http://127.0.0.1:8240/';
const out='artifacts/playable/qa-v2';fs.mkdirSync(out,{recursive:true});
const cdp=await CdpClient.connect(),{targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
const {sessionId:s}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
const errors=[],checks=[],effects=[];
cdp.listeners.add(e=>{if(e.sessionId===s&&e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails);});
const ev=x=>cdp.evaluate(s,x),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>ev('window.hotChickDebug?.snapshot()');
const wait=async(fn,label,timeout=6000)=>{const end=Date.now()+timeout;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(35);}throw Error(label);};
const click=selector=>ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'},s);fs.writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'));};
const economy=x=>({balance:x.balance,spent:x.stats.spent,won:x.stats.won,unlocked:x.unlocked});
const activeFx=x=>Object.values(x.rewardFx||{});
try{
 await cdp.send('Runtime.enable',{},s);await cdp.send('Page.enable',{},s);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},s);
 await cdp.send('Page.navigate',{url},s);
 await wait(()=>ev('Boolean(window.hotChickDebug?.ready)'),'game not ready',45000);
 await sleep(250);await shot('playfield');
 for(const [tier,count] of [['small',4],['medium',16],['large',32]]){
  const before=await state(),start=Date.now();
  await ev(`(()=>{window.__fxQa={samples:[],running:true};let last=-1;function frame(n){if(!window.__fxQa.running)return;if(n-last>45){last=n;const x=window.hotChickDebug.snapshot(),h=Object.values(x.fxHearts||{}),f=Object.values(x.rewardFx||{});window.__fxQa.samples.push({time:x.time,stage:x.reveal?.stage||null,pulse:x.walletPulse,arrivals:x.walletArrivalsSerial,count:h.length,age:f[0]?.age||0,meanDistance:h.length?h.reduce((s,p)=>s+Math.hypot(p.x+7.2,p.y+4.3),0)/h.length:0});}requestAnimationFrame(frame)}requestAnimationFrame(frame);return true})()`);
  await click(`[data-action="Preview${tier[0].toUpperCase()+tier.slice(1)}"]`);
  if(tier==='large'){
   const intro=await wait(async()=>{const x=await state();return x.reveal?.stage==='intro'?x:null;},'large intro not shown');
   assert.equal(intro.reveal.symbolTier,'large');
   const video=await ev('window.hotChickDebug.metadata().video');assert(video.paused||video.currentTime===0);
   await sleep(250);await shot('large-intro');
   const advance=await wait(async()=>{const x=await state();return x.reveal?.stage==='video'?x:null;},'large intro never becomes video');
   assert(advance.time-intro.time>.8);checks.push('large anticipation plays before the video');
  }
  if(tier!=='small'){
   await wait(()=>ev('(()=>{const v=document.querySelector(".hc-reveal video");return Boolean(v&&v.currentTime>.15&&!v.paused&&!v.error)})()'),`${tier} video not playing`);
   const md=await ev('window.hotChickDebug.metadata()');assert(Math.abs(md.video.duration-(tier==='large'?8.041667:5.041667))<.03);
   if(tier==='large')await shot('large-video');
  }
  const first=await wait(async()=>{const x=await state();return activeFx(x).some(f=>f.preview&&f.rewardTier===tier)?x:null;},`${tier} reward never starts`,12000);
  const fx=activeFx(first).find(f=>f.preview&&f.rewardTier===tier);assert.equal(fx.count,count);
  await wait(async()=>{const x=await state(),f=activeFx(x).find(f=>f.id===fx.id);return f&&f.age>.20?x:null;},'burst did not advance');
  await shot(`${tier}-burst`);
  const burst=await state(),burstHearts=Object.values(burst.fxHearts||{});assert.equal(burstHearts.length,count);
  const actual=await ev('document.querySelectorAll(".hc-reward-heart:not([hidden])").length');
  const burstMetadata=await ev('window.hotChickDebug.metadata()');
  assert.equal(actual,count,'visible DOM heart count must match Luau');
  const fxTiming=await ev('new Promise(resolve=>{const t=[];function frame(n){t.push(n);if(t.length<19)requestAnimationFrame(frame);else resolve({fps:18000/(t[18]-t[0]),worstFrameMs:Math.max(...t.slice(1).map((n,i)=>n-t[i]))})}requestAnimationFrame(frame)})');
  await wait(async()=>{const x=await state(),f=activeFx(x).find(f=>f.id===fx.id);return f&&f.age>.75?x:null;},'heart collection did not advance');
  await shot(`${tier}-collection`);
  const flight=await state(),flightHearts=Object.values(flight.fxHearts||{});
  const destination={x:-7.2,y:-4.3};
  const dist=hs=>hs.reduce((sum,h)=>sum+Math.hypot(h.x-destination.x,h.y-destination.y),0)/Math.max(1,hs.length);
  assert(dist(flightHearts)<dist(burstHearts),'hearts did not fly toward the wallet');
  const arrived=await wait(async()=>{const x=await state();return x.walletArrivalsSerial>before.walletArrivalsSerial?x:null;},'wallet never received hearts');
  assert.deepEqual(economy(arrived),economy(before));
  await wait(async()=>{const x=await state();return !x.reveal&&activeFx(x).length===0;},'effect did not clean up');
  const after=await state();assert.deepEqual(economy(after),economy(before));assert.equal(Object.values(after.fxHearts||{}).length,0);
  const sampled=await ev('(()=>{window.__fxQa.running=false;return window.__fxQa.samples})()');
  assert(sampled.some(x=>x.pulse>0),'no wallet arrival pulse was presented');
  assert(sampled.some(x=>x.count===count),'full burst never appeared');
  assert(sampled.some(x=>x.count>0&&x.age>.9&&x.meanDistance<2.6),'visible hearts never reached the wallet area');
  effects.push({tier,count,actual,elapsedMs:Date.now()-start,fxTiming,burstMetadata,arrivals:after.walletArrivalsSerial-before.walletArrivalsSerial,samples:sampled});
  checks.push(`${tier}: ${count} hearts burst, collect at wallet, pulse, clean up; no preview settlement`);
 }
 // Skipping the video must still lead through the same reward collection phase.
 await click('[data-action="PreviewLarge"]');await wait(async()=>(await state()).reveal?.stage==='intro','skip setup');
  const beforeSkip=economy(await state());await click('.hc-reveal-intro [data-ui="close-reveal"]');
 await wait(async()=>(await state()).reveal?.stage==='reward','skip discarded reward stage');
 await wait(async()=>!(await state()).reveal,'skip reward cleanup');assert.deepEqual(economy(await state()),beforeSkip);checks.push('skip leads to reward collection without changing settlement');
 await click('[data-action="PreviewSmall"]');await wait(async()=>activeFx(await state()).length>0,'reset setup');
 // Reset is reached through the product settings; no hidden mutation hook.
 await click('[data-ui="settings"]');await wait(async()=>(await state()).galleryOpen,'settings open');
 await wait(()=>ev('Boolean(document.querySelector("[data-action=DemoReset]"))'),'settings controls did not render');
 await click('[data-action="DemoReset"]');await wait(async()=>Object.values((await state()).fxHearts||{}).length===0,'reset did not clear hearts');
 const reset=await state();assert.equal(reset.balance,10000);assert.equal(reset.walletPulse,0);checks.push('reset clears active effects and wallet pulse');
 await click('[data-ui="close-gallery"]');
 await sleep(120);
 const spamBefore=economy(await state());
 for(let i=0;i<12;i++){await click('[data-action="PreviewSmall"]');await sleep(110);const x=await state();assert(activeFx(x).length<=1);assert(x.rewardFxPendingCount<=1);}
 await wait(async()=>{const x=await state();return activeFx(x).length===0&&x.rewardFxPendingCount===0;},'preview clicks built an unbounded queue',2200);
 assert.deepEqual(economy(await state()),spamBefore);checks.push('repeated small preview clicks coalesce and leave no delayed playback backlog');
 assert.equal(errors.length,0);checks.push('no uncaught browser exceptions');
 await shot('final-playfield');
 const report={url,browser:cdp.version.Browser,checks,effects,errors,metadata:await ev('window.hotChickDebug.metadata()')};
 fs.writeFileSync(`${out}/win-effects-acceptance.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks,effects:effects.map(x=>({tier:x.tier,count:x.count,actual:x.actual,elapsedMs:x.elapsedMs,arrivals:x.arrivals})),errors},null,2));
}catch(error){await shot('failure').catch(()=>{});fs.writeFileSync(`${out}/failure.json`,JSON.stringify({message:String(error),state:await state().catch(()=>null),errors},null,2));throw error;}
finally{await cdp.send('Target.closeTarget',{targetId});cdp.close();}

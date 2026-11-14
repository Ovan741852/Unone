import fs from 'node:fs';
import assert from 'node:assert/strict';
import {CdpClient} from './cdp-client.mjs';

// Run only after the release and the shared visible CDP browser are ready.
// Observers below read input/state; they never replace entropy or game rules.
const address=new URL(process.argv[2]||'http://127.0.0.1:8241/release-024/');
address.searchParams.delete('debug');
const out=process.env.QA_OUTPUT||'artifacts/playable/qa-runtime-fixes-024';
fs.mkdirSync(out,{recursive:true});
const cdp=await CdpClient.connect(Number(process.env.CDP_PORT||9237));
const checks=[],evidence={},errors=[],targets=new Set();
let active=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const values=value=>Object.values(value||{});
const wait=async(fn,label,timeout=10000)=>{const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(45);}throw Error(label);};
const observer=`(()=>{
 const q=window.__runtimeFixQa={seed:[],events:[],visibility:[],bits:[],samples:[],monitor:false};
 const held=new Set();
 for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
   const at=performance.now(),code=event.code;
   if(/^CardSeedBit\\d+$/.test(code)){
     const bit=Number(code.slice(11));q.bits.push({type,bit,at});
     if(type==='keydown')held.add(bit);else held.delete(bit);
   }
   if(code==='CardSeedReady')q.seed.push({type,at,bits:[...held].sort((a,b)=>a-b),seed:type==='keydown'?[...held].reduce((sum,bit)=>sum+2**bit,0):null,visible:document.visibilityState,focused:document.hasFocus()});
   if(type==='keydown'&&/^(LargeVideoCompleted:|GalleryLargeCompleted:|RevealVideoStarted$|GalleryLargeStarted:|GalleryLargeCancelled$)/.test(code))q.events.push({code,at});
 },{passive:true});
 for(const type of ['blur','focus','visibilitychange'])window.addEventListener(type,()=>q.visibility.push({type,at:performance.now(),visibility:document.visibilityState}),{passive:true});
})()`;
cdp.listeners.add(event=>{if(event.sessionId===active?.sessionId&&event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails);});
const ev=expression=>cdp.evaluate(active.sessionId,expression);
const state=()=>ev('window.hotChickDebug.snapshot()');
const meta=()=>ev('window.hotChickDebug.metadata()');
async function open(url){
 const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});targets.add(targetId);
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});active={targetId,sessionId};
 await cdp.send('Target.activateTarget',{targetId});
 await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:observer},sessionId);
 await cdp.send('Page.navigate',{url},sessionId);
 await wait(()=>ev('document.body?.dataset.hotChickReady==="true"'),'game ready',45000);
 return active;
}
async function close(){if(!active)return;const id=active.targetId;await cdp.send('Target.closeTarget',{targetId:id});targets.delete(id);active=null;}
async function screenshot(name){const result=await cdp.send('Page.captureScreenshot',{format:'png'},active.sessionId);fs.writeFileSync(`${out}/${name}.png`,Buffer.from(result.data,'base64'));}
async function click(selector){
 const point=await ev(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.closest('[hidden]'))throw Error('hidden/missing button');const r=n.getBoundingClientRect();const p={x:r.x+r.width/2,y:r.y+r.height/2};if(!r.width||!r.height||!n.contains(document.elementFromPoint(p.x,p.y)))throw Error('button obstructed');return p})()`);
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point},active.sessionId);
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1},active.sessionId);
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1},active.sessionId);
 await sleep(135);
}
const fieldPoint=(x,y)=>ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.left+((${x})/17.77777778+.5)*r.width,y:r.top+(.5-(${y})/10)*r.height}})()`);
async function fieldMove(x,y,buttons=0){await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...await fieldPoint(x,y),buttons},active.sessionId);}
async function pointerUp(x=0,y=0){await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...await fieldPoint(x,y),button:'left',buttons:0,clickCount:1},active.sessionId);}
const allClips=x=>values(x.gallery.characters).flatMap(c=>values(c.styles).flatMap(s=>values(s.items)));
async function clearAwards(){
 const end=Date.now()+30000;let quietSince=null;
 while(Date.now()<end){const x=await state();const clean=!x.reveal&&!x.revealQueueCount&&!values(x.mediumReveals).length&&!x.mediumQueueCount&&!values(x.rewardFx).length&&!x.rewardFxPendingCount&&!values(x.shots).length;
  if(clean){quietSince??=Date.now();if(Date.now()-quietSince>=450)return x;}else quietSince=null;
  // Public skip controls: never mark these performances as watched.
  await ev(`(()=>{for(const b of document.querySelectorAll('.hc-medium-card [data-medium-action=skip]'))b.click();document.querySelector('.hc-reveal-intro:not([hidden]) [data-ui=close-reveal],.hc-reveal:not([hidden]) [data-ui=close-reveal]')?.click()})()`);await sleep(90);
 }throw Error('award queues did not settle');
}
async function watchNaturalLarge(){
 let x=await state();
 if(!x.reveal){
  if(!x.auto){if(x.lock)await click('[data-action=ToggleAuto]');else await click('[data-action=ToggleLock]');}
  x=await wait(async()=>{const next=await state();return next.reveal&&!next.reveal.preview?next:null;},'natural large capture',45000);
 }
 assert.equal(x.reveal.preview,false);const clipId=x.reveal.clipId,serial=x.reveal.serial;
 const playing=await wait(async()=>{const m=await meta();return m.reveal?.serial===serial&&m.video.currentTime>.1&&m.video.startNotice.notified?{state:await state(),metadata:m}:null;},'real natural video starts',12000);
 const wallStart=Date.now();await cdp.send('Emulation.setCPUThrottlingRate',{rate:6},active.sessionId);
 let completed;
 try{completed=await wait(async()=>{const next=await state();return values(next.watchedLargeClipIds).includes(clipId)?next:null;},'verified natural completion marks exact clip',25000);}finally{await cdp.send('Emulation.setCPUThrottlingRate',{rate:1},active.sessionId);}
 const event=await ev(`window.__runtimeFixQa.events.find(e=>e.code===${JSON.stringify(`LargeVideoCompleted:${serial}:${clipId}`)})`);
 assert(event,'actual media completed event missing');
 assert.equal(completed.balance,completed.displayBalance+completed.pendingWin);
 evidence.natural={clipId,serial,duration:playing.metadata.video.duration,wallElapsedMs:Date.now()-wallStart,gameElapsed:completed.time-playing.state.time,event,started:playing.metadata.video.startNotice};
 await screenshot('natural-large-completed');
 await wait(async()=>{const next=await state();return !next.reveal&&!next.revealQueueCount?next:null;},'natural hearts complete',15000);
 x=await state();if(x.auto)await click('[data-action=ToggleAuto]');
 await wait(async()=>!(await state()).auto,'AUTO off after collection');
 await clearAwards();
 checks.push('a real full natural large video emits exact serial/clip media completion and updates watched state under CPU throttling');
 return clipId;
}
try{
 const seeds=[];
 for(let index=0;index<2;index++){
  await open(address.href);
  assert.equal(await ev('typeof window.hotChickDebug'),'undefined');
  assert.equal(await ev('document.querySelectorAll("[data-ui=tools],[data-action=DemoReset],[data-action^=Preview]").length'),0);
  const q=await wait(()=>ev(`(()=>{const q=window.__runtimeFixQa;return q.seed.some(e=>e.type==='keyup')?q:null})()`),'normal seed acknowledgment');
  const starts=q.seed.filter(e=>e.type==='keydown'),ends=q.seed.filter(e=>e.type==='keyup');
  assert.equal(starts.length,1);assert.equal(ends.length,1);
  const start=starts[0],end=ends[0];assert(start.seed>=1&&start.seed<=2147483646);
  assert(start.bits.every(bit=>Number.isInteger(bit)&&bit>=0&&bit<=30));assert.equal(new Set(start.bits).size,start.bits.length);
  assert(q.bits.every(e=>e.bit>=0&&e.bit<=30));assert(start.visible==='visible'&&end.visible==='visible');
  assert(!q.visibility.some(e=>e.at>=start.at&&e.at<=end.at&&(e.type==='blur'||e.visibility==='hidden')),'seed release must be an acknowledgment, not a visibility cancellation');
  seeds.push({seed:start.seed,bitCount:start.bits.length,ackMs:end.at-start.at,events:q.seed,visibility:q.visibility});
  await close();
 }
 assert.notEqual(seeds[0].seed,seeds[1].seed);evidence.normalSeedHandshakes=seeds;
 checks.push('two fresh normal pages use distinct valid 31-bit crypto seeds and release held seed keys only after visible handshake acknowledgment; debug tools remain absent');

 const debug=new URL(address);debug.searchParams.set('debug','1');await open(debug.href);
 await wait(()=>ev('window.hotChickDebug?.ready'),'debug observation bridge');
 assert((await wait(async()=>{const x=await state();return x.cards.seedReady?x:null;},'native seedReady acknowledgment')).cards.seedReady);
 while((await state()).bet>1)await click('[data-action=BetDown]');
 await click('[data-ui=skip-seen-large]');assert((await state()).preferences.skipSeenLargeVideos);
 await click('[data-action=ToggleLock]');await wait(async()=>{const x=await state();return x.lock&&x.auto;},'Lock starts AUTO');
 await click('[data-action=ToggleAuto]');let off=await state();assert(off.lock&&!off.auto);
 const stoppedShots=off.stats.shots;await sleep(650);off=await state();assert.equal(off.stats.shots,stoppedShots);assert(off.lock&&!off.auto);
 evidence.explicitAutoOff={shots:stoppedShots,after:off.stats.shots,lock:off.lock,auto:off.auto};
 checks.push('turning AUTO off while Lock stays on stops new paid shooting');

 const clipId=await watchNaturalLarge();
 await click('[data-ui=gallery]');await wait(async()=>(await state()).galleryOpen,'gallery acknowledgment');
 const characterId=allClips(await state()).find(c=>c.clipId===clipId)?.clipId.split('-')[0];assert(characterId);
 await click(`[data-gallery-character="${characterId}"]`);await click('[data-gallery-section=movies]');
 const beforeReplay=await state();await click(`[data-gallery-clip="${clipId}"]`);
 await wait(()=>ev('document.querySelector(".hc-gallery-player video")?.currentTime>.1'),'gallery replay plays');
 const replayStart=await state(),replayWall=Date.now();await cdp.send('Emulation.setCPUThrottlingRate',{rate:6},active.sessionId);
 let replayEnd;
 try{await wait(()=>ev(`window.__runtimeFixQa.events.some(e=>e.code===${JSON.stringify('GalleryLargeCompleted:'+clipId)})`),'actual full replay completed event',25000);replayEnd=await state();}finally{await cdp.send('Emulation.setCPUThrottlingRate',{rate:1},active.sessionId);}
 assert(values(replayEnd.watchedLargeClipIds).includes(clipId));
 assert.equal(replayEnd.stats.spent,beforeReplay.stats.spent);assert.equal(replayEnd.stats.won,beforeReplay.stats.won);assert.deepEqual(replayEnd.cards,beforeReplay.cards);
 evidence.replay={clipId,wallElapsedMs:Date.now()-replayWall,gameElapsed:replayEnd.time-replayStart.time,events:await ev('window.__runtimeFixQa.events')};
 await screenshot('full-gallery-replay-completed');await click('[data-ui=close-gallery]');await wait(async()=>!(await state()).galleryOpen,'gallery closes');
 assert((await state()).preferences.skipSeenLargeVideos);assert(values((await state()).watchedLargeClipIds).includes(clipId));
 checks.push('a full actual large replay emits the verified completion event without charges/rewards/card changes; watched preference survives modal close');

 await clearAwards();let x=await state();if(x.lock)await click('[data-action=ToggleLock]');
 await click('[data-weapon=rocket]');assert.equal((await state()).roundInterval,.2);
 await ev(`(()=>{const q=window.__runtimeFixQa;q.samples=[];q.monitor=true;let previous=-1;function sample(){if(!q.monitor)return;const x=window.hotChickDebug.snapshot();if(x.stats.shots!==previous){q.samples.push({time:x.time,shots:x.stats.shots,spent:x.stats.spent,firedAt:x.lastRound.firedAt,interval:x.roundInterval,reveal:Boolean(x.reveal),queue:x.revealQueueCount,targets:x.lastRound.targetIds});previous=x.stats.shots;}requestAnimationFrame(sample)}requestAnimationFrame(sample)})()`);
 const beforeRocket=await state(),rocketStart=beforeRocket.time,deadline=Date.now()+10000;let down=false,lastPoint={x:0,y:0};
 try{
  while(Date.now()<deadline){x=await state();if(x.time-rocketStart>=3||x.reveal||x.revealQueueCount)break;
   const all=values(x.targets),large=all.filter(t=>t.tier==='large'&&t.state==='swimming');
   const safe=all.filter(t=>t.tier==='small'&&t.state==='swimming'&&Math.abs(t.x)<6.6&&Math.abs(t.y)<2.75&&large.every(b=>Math.hypot(t.x-b.x,t.y-b.y)>x.demoConfig.rocketRadius+.12)&&all.every(other=>other.id===t.id||other.tier==='small'||Math.hypot(t.x-other.x,t.y-other.y)>other.diameter*.56+.12));
   const target=safe.find(t=>t.id===x.lockedTargetId)||safe[0];
   if(!target){if(down){await pointerUp(lastPoint.x,lastPoint.y);down=false;}await sleep(50);continue;}
   lastPoint=target;await fieldMove(target.x,target.y,down?1:0);
   if(!down){await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...await fieldPoint(target.x,target.y),button:'left',buttons:1,clickCount:1},active.sessionId);down=true;}
   await sleep(35);
  }
 }finally{if(down)await pointerUp(lastPoint.x,lastPoint.y);await ev('window.__runtimeFixQa.monitor=false');}
 const afterRocket=await state(),samples=await ev('window.__runtimeFixQa.samples');
 const fired=samples.filter(sample=>sample.shots>beforeRocket.stats.shots),intervals=fired.slice(1).map((item,index)=>({delta:(item.firedAt-fired[index].firedAt)/(item.shots-fired[index].shots),rounds:item.shots-fired[index].shots}));
 assert(fired.length>=6,'not enough real valid-target rocket rounds');
 assert(intervals.filter(i=>Math.abs(i.delta-.2)<.035).length>=5,'actual rocket firing cadence is not 200ms');
 assert.equal(afterRocket.stats.spent-beforeRocket.stats.spent,(afterRocket.stats.shots-beforeRocket.stats.shots)*beforeRocket.bet*15);
 assert(fired.every(item=>values(item.targets).length<=5&&new Set(values(item.targets)).size===values(item.targets).length));
 evidence.rocket={samples,intervals,gameSeconds:afterRocket.time-beforeRocket.time,rounds:afterRocket.stats.shots-beforeRocket.stats.shots,cost:afterRocket.stats.spent-beforeRocket.stats.spent};
 await screenshot('rocket-200ms');checks.push('actual valid-target rockets fire at 200ms with one base-bet×15 charge and at most five distinct targets per round');
 evidence.nativeCoverage='AUTO waits through insufficient spendable balance, resumes after real medium/large heart credit, 300 rocket rounds/minute, and repeated exact-seen skips are separately covered by the current native suites; no browser wallet or award injection was used.';
 x=await state();assert.equal(x.balance,x.displayBalance+x.pendingWin);assert.equal(x.balance,10000-x.stats.spent+x.stats.won);assert.equal(errors.length,0);
 const report={ok:true,url:debug.href,checks,evidence,errors,final:x,metadata:await meta()};
 fs.writeFileSync(`${out}/acceptance.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks,seeds:seeds.map(s=>s.seed),rocketRounds:evidence.rocket.rounds,errors},null,2));
}catch(error){
 if(active){await screenshot('failure').catch(()=>{});fs.writeFileSync(`${out}/failure.json`,JSON.stringify({error:String(error),checks,evidence,errors,state:await state().catch(()=>null),metadata:await meta().catch(()=>null),observer:await ev('window.__runtimeFixQa').catch(()=>null)},null,2));}
 throw error;
}finally{
 if(active)await cdp.send('Emulation.setCPUThrottlingRate',{rate:1},active.sessionId).catch(()=>{});
 for(const targetId of targets)await cdp.send('Target.closeTarget',{targetId}).catch(()=>{});
 cdp.close();
}

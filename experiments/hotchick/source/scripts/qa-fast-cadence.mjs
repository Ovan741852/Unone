import fs from 'node:fs';
import assert from 'node:assert/strict';
import {CdpClient} from './cdp-client.mjs';
const url=process.argv[2]||'http://127.0.0.1:8241/release-010/';
const out='artifacts/playable/qa-cadence';fs.mkdirSync(out,{recursive:true});
const cdp=await CdpClient.connect(),{targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
const {sessionId:s}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
const errors=[],checks=[],evidence={};
cdp.listeners.add(e=>{if(e.sessionId===s&&e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails);});
const ev=x=>cdp.evaluate(s,x),sleep=ms=>new Promise(r=>setTimeout(r,ms)),vals=v=>Object.values(v||{});
const state=()=>ev('window.hotChickDebug.snapshot()'),meta=()=>ev('window.hotChickDebug.metadata()');
const wait=async(fn,label,ms=7000)=>{const end=Date.now()+ms;while(Date.now()<end){const x=await fn();if(x)return x;await sleep(25);}throw Error(label);};
const click=sel=>ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'},s);fs.writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'));};
const point=(x,y)=>ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.left+((${x})/17.77777778+.5)*r.width,y:r.top+(.5-(${y})/10)*r.height}})()`);
const move=async(x,y,buttons=0)=>cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(x,y),buttons},s);
const down=async(x,y)=>{await move(x,y);await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...await point(x,y),button:'left',buttons:1,clickCount:1},s);};
const up=async(x,y)=>cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...await point(x,y),button:'left',buttons:0,clickCount:1},s);
const tap=async(x,y)=>{await down(x,y);await sleep(65);await up(x,y);};
const reset=async()=>{const end=Date.now()+30000;while((await state()).reveal){if(Date.now()>end)throw Error('reveal queue did not finish');const r=(await state()).reveal;if(r.stage==='intro')await click('.hc-reveal-intro [data-ui="close-reveal"]');else if(r.stage==='video')await click('.hc-reveal [data-ui="close-reveal"]');await sleep(100);}await click('[data-ui="settings"]');await wait(async()=>(await state()).galleryOpen,'settings model');await wait(()=>ev('Boolean(document.querySelector("[data-action=DemoReset]"))&&!document.querySelector(".hc-modal").hidden'),'reset controls');await click('[data-action="DemoReset"]');await wait(async()=>{const x=await state();return x.stats.shots===0&&!x.galleryOpen&&!x.reveal;},'reset');await sleep(110);};
const startMonitor=()=>ev(`(()=>{const initial=window.hotChickDebug.snapshot();window.__rateQa={running:true,frames:[],events:[{time:initial.time,shots:initial.stats.shots,spent:initial.stats.spent}],samples:[],last:initial.stats.shots};function frame(n){const q=window.__rateQa;if(!q.running)return;const x=window.hotChickDebug.snapshot();q.frames.push(n);if(q.last!==x.stats.shots){q.events.push({time:x.time,shots:x.stats.shots,spent:x.stats.spent,weapon:x.weapon,interval:x.roundInterval,cooldownDuration:x.cooldownDuration});q.last=x.stats.shots;}q.samples.push({time:x.time,rounds:x.stats.shots,canShoot:x.canShoot,medium:x.mediumVideoCount,remaining:x.cooldownProgress,display:x.displayBalance,pending:x.pendingWin,balance:x.balance,hearts:Object.values(x.fxHearts||{}).length});requestAnimationFrame(frame)}requestAnimationFrame(frame);return true})()`);
const stopMonitor=()=>ev('(()=>{const q=window.__rateQa;q.running=false;return q})()');
const validateCadence=(log,interval,minEvents)=>{const fired=log.events.slice(1);assert(fired.length>=minEvents);for(let i=1;i<fired.length;i++)assert(Math.abs((fired[i].time-fired[i-1].time)-interval)<.036,'wrong actual fire interval');return fired;};
try{
 await cdp.send('Runtime.enable',{},s);await cdp.send('Page.enable',{},s);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},s);await cdp.send('Page.navigate',{url},s);await wait(()=>ev('Boolean(window.hotChickDebug?.ready)'),'load',45000);
 for(let i=0;i<6;i++){await click('[data-action="PreviewMedium"]');await sleep(135);}await wait(async()=>(await meta()).activeMediumDecoders===6,'six medium videos');
 const before=await state();assert(Math.abs(before.roundInterval-.12)<1e-9);assert(Math.abs(before.roundsPerSecond-1/.12)<1e-8);
 await startMonitor();await down(.8,-4.349);await sleep(3600);await up(.8,-4.349);await sleep(80);const after=await state();const log=await stopMonitor();
 const fired=validateCadence(log,.12,28);assert.equal(after.stats.spent-before.stats.spent,(after.stats.shots-before.stats.shots)*10);
 const actualRate=(fired.length-1)/(fired.at(-1).time-fired[0].time);assert(Math.abs(actualRate-1/.12)<.25);assert(log.samples.every(x=>x.display+x.pending===x.balance));assert(log.samples.every(x=>x.remaining>=0&&x.remaining<=1));assert(log.samples.some(x=>x.medium===6));
 const dt=log.frames.slice(1).map((n,i)=>n-log.frames[i]).sort((a,b)=>a-b);evidence.held={log,actualRate,frames:{fps:1000/(dt.reduce((a,b)=>a+b,0)/dt.length),medianMs:dt[Math.floor(dt.length*.5)],p95Ms:dt[Math.floor(dt.length*.95)]}};
 await shot('fast-like-with-mediums');await sleep(650);assert.equal((await state()).stats.shots,after.stats.shots);checks.push('held like fires at DT2 0.12s cadence while six medium videos play, with one ×1 charge per round');checks.push('releasing stops firing; cooldown progress remains normalized');
 await reset();await tap(.8,-4.349);await sleep(300);const autoBefore=await state();await startMonitor();await click('[data-action="ToggleAuto"]');await sleep(2400);await click('[data-action="ToggleAuto"]');await sleep(110);const autoAfter=await state(),autoLog=await stopMonitor();validateCadence(autoLog,.12,18);assert.equal(autoAfter.stats.spent-autoBefore.stats.spent,(autoAfter.stats.shots-autoBefore.stats.shots)*10);evidence.auto=autoLog;checks.push('AUTO uses the same fast cadence and exact round charging');
 await sleep(600);const resumed=await state();await click('[data-action="Fire"]');await sleep(300);assert.equal((await state()).stats.shots,resumed.stats.shots+1);checks.push('a ready single press after idle fires once without banking catch-up rounds');
 for(const [weapon,interval,cost] of [['flower',.12/.45,60],['rocket',.4,150]]){
  await reset();await click(`[data-weapon="${weapon}"]`);await sleep(130);let x=await state();assert(Math.abs(x.roundInterval-interval)<1e-9);assert(Math.abs(x.roundsPerSecond-1/interval)<1e-8);
  const big=x.targets.filter(t=>t.tier==='large');const safe=x.targets.filter(t=>t.tier==='small'&&t.state==='swimming'&&t.y<-.9&&Math.abs(t.x)<6.6&&big.every(b=>Math.hypot(t.x-b.x,t.y-b.y)>3.1)&&x.targets.every(o=>o.id===t.id||o.tier==='small'||Math.hypot(t.x-o.x,t.y-o.y)>o.diameter*.56+.1));
  assert(safe.length>0,'no safe small target');const target=safe.sort((a,b)=>a.y-b.y)[0];const baseline=x.stats.shots,spent=x.stats.spent;await startMonitor();await tap(target.x,target.y);await click('[data-action="ToggleAuto"]');await sleep(weapon==='flower'?800:680);await click('[data-action="ToggleAuto"]');await sleep(80);x=await state();const specialLog=await stopMonitor();const events=validateCadence(specialLog,interval,2);assert.equal(x.stats.spent-spent,(x.stats.shots-baseline)*cost);evidence[weapon]={log:specialLog,metadata:await meta()};checks.push(`${weapon}: DT2 interval ${interval}s and a single ${cost} charge per round`);
  await shot(`${weapon}-rate`);
 }
 await reset();assert.equal(errors.length,0);checks.push('no uncaught browser exceptions');const report={url,checks,evidence,errors,metadata:await meta(),final:await state()};fs.writeFileSync(`${out}/fast-cadence-acceptance.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks,heldRate:evidence.held.actualRate,frames:evidence.held.frames,errors},null,2));
}catch(error){await shot('failure').catch(()=>{});fs.writeFileSync(`${out}/failure.json`,JSON.stringify({error:String(error),state:await state().catch(()=>null),metadata:await meta().catch(()=>null),monitor:await stopMonitor().catch(()=>null),errors},null,2));throw error;}
finally{await cdp.send('Target.closeTarget',{targetId});cdp.close();}

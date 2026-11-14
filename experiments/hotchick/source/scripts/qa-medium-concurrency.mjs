import fs from 'node:fs';
import assert from 'node:assert/strict';
import {CdpClient} from './cdp-client.mjs';
const url=process.argv[2]||'http://127.0.0.1:8241/release-008/';
const out='artifacts/playable/qa-medium';fs.mkdirSync(out,{recursive:true});
const cdp=await CdpClient.connect(),{targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
const {sessionId:s}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
const errors=[],checks=[],evidence={};
cdp.listeners.add(e=>{if(e.sessionId===s&&e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails);});
const ev=x=>cdp.evaluate(s,x),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const vals=x=>Object.values(x||{}),state=()=>ev('window.hotChickDebug.snapshot()'),meta=()=>ev('window.hotChickDebug.metadata()');
const wait=async(fn,label,ms=7000)=>{const end=Date.now()+ms;while(Date.now()<end){const x=await fn();if(x)return x;await sleep(25);}throw Error(label);};
const click=sel=>ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot=async name=>{const x=await cdp.send('Page.captureScreenshot',{format:'png'},s);fs.writeFileSync(`${out}/${name}.png`,Buffer.from(x.data,'base64'));};
const mouse=async(type,x,y,buttons=0)=>cdp.send('Input.dispatchMouseEvent',{type,x,y,...(type==='mouseMoved'?{buttons}:{button:'left',buttons,clickCount:1})},s);
const tapPixel=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await sleep(70);await mouse('mouseReleased',x,y);};
const tapWorld=async(x,y)=>{const p=await ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.left+((${x})/17.77777778+.5)*r.width,y:r.top+(.5-(${y})/10)*r.height}})()`);await tapPixel(p.x,p.y);};
const reset=async()=>{await click('[data-ui="settings"]');await wait(async()=>(await state()).galleryOpen,'settings open');await wait(()=>ev('Boolean(document.querySelector("[data-action=DemoReset]"))&&!document.querySelector(".hc-modal").hidden'),'reset visible');await click('[data-action="DemoReset"]');await wait(async()=>{const x=await state();return x.stats.shots===0&&!x.galleryOpen&&vals(x.mediumReveals).length===0&&!x.reveal;},'reset cleanup');await sleep(100);};
const spawnPreviews=async count=>{for(let i=0;i<count;i++){await click('[data-action="PreviewMedium"]');await sleep(135);}};
try{
 await cdp.send('Runtime.enable',{},s);await cdp.send('Page.enable',{},s);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},s);
 await cdp.send('Page.navigate',{url},s);await wait(()=>ev('Boolean(window.hotChickDebug?.ready)'),'game load',45000);
 await spawnPreviews(6);
 const six=await wait(async()=>{const m=await meta();return m.activeMediumDecoders===6&&vals(m.mediumPlayers).filter(p=>!p.released&&p.readyState>=2&&p.currentTime>.05&&!p.paused).length===6?m:null;},'six medium videos did not play concurrently');
 let x=await state();assert(!x.reveal);assert.equal(x.canShoot,true);assert.equal(x.stats.spent,0);assert.equal(x.stats.won,0);assert.equal(x.displayBalance,10000);
 const players=vals(six.mediumPlayers).filter(p=>!p.released),ids=players.map(p=>String(p.serial));assert.equal(new Set(players.map(p=>p.slot)).size,6);
 await shot('six-medium-videos');evidence.six=six;checks.push('six independent medium videos play near the cannon without blocking shooting');
 await sleep(250);const advanced=await meta();for(const p of players){const q=vals(advanced.mediumPlayers).find(q=>String(q.serial)===String(p.serial));assert(q&&q.currentTime>p.currentTime+.08);assert(!q.paused);}
 checks.push('all six playback clocks advance independently');
 if(process.env.MEDIUM_SMOKE==='1'){
  const report={url,checks,evidence,errors,metadata:await meta(),final:await state()};
  assert.equal(errors.length,0);fs.writeFileSync(`${out}/medium-release-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({url,checks,errors},null,2));
 }else{
 const point=await ev(`(()=>{const c=document.querySelector('.hc-medium-card[data-slot="6"]'),r=c.getBoundingClientRect(),x=r.left+8,y=r.bottom-9,e=document.elementFromPoint(x,y);return{x,y,tag:e?.tagName}})()`);assert.equal(point.tag,'CANVAS','medium body blocks pointer input');
 const before=await state();await tapPixel(point.x,point.y);await wait(async()=>(await state()).stats.shots===before.stats.shots+1,'click through medium video did not fire');assert.equal((await state()).stats.spent-before.stats.spent,before.bet);checks.push('clicking through a medium card fires exactly one paid round');
 await tapWorld(.8,-4.34);await sleep(100);await click('[data-action="ToggleAuto"]');
 const autoBefore=await state();await sleep(1200);const autoAfter=await state();assert(autoAfter.auto);assert(autoAfter.stats.shots>autoBefore.stats.shots);assert(!autoAfter.reveal);await click('[data-action="ToggleAuto"]');checks.push('AUTO continues firing while medium performances play');
 const liveBefore=vals((await meta()).mediumPlayers).filter(p=>!p.released&&p.stage==='video');assert(liveBefore.length>=3);
 const closed=liveBefore[0];await click(`.hc-medium-card[data-serial="${closed.serial}"] [data-medium-action="skip"]`);
 await wait(async()=>{const m=await meta();return !vals(m.mediumPlayers).some(p=>String(p.serial)===String(closed.serial)&&!p.released);},'single skip did not release its decoder');
 const otherBefore=liveBefore.slice(1);await sleep(150);const afterSkip=await meta();for(const p of otherBefore){const q=vals(afterSkip.mediumPlayers).find(q=>String(q.serial)===String(p.serial));assert(q&&!q.released&&!q.paused&&q.currentTime>p.currentTime);assert.equal(q.slot,p.slot);}
 await shot('one-skipped-others-playing');checks.push('skipping one medium video leaves the other playback clocks and slots unchanged');
 await wait(async()=>{const g=await state();return vals(g.mediumReveals).length===0&&g.mediumQueueCount===0&&vals(g.rewardFx).length===0&&!g.reveal;},'parallel medium rewards did not finish',18000);
 x=await state();assert.equal(x.balance,x.displayBalance);assert.equal(x.pendingWin,0);assert.equal(x.balance,10000-x.stats.spent+x.stats.won);assert.equal((await meta()).activeMediumDecoders,0);assert.equal(await ev('document.querySelectorAll(".hc-medium-card").length'),0);
 evidence.afterCollection=x;checks.push('each award collects fully and releases its player without losing or duplicating points');
 await reset();await spawnPreviews(3);await wait(async()=>(await meta()).activeMediumDecoders===3,'second set medium play');
 const original=vals((await meta()).mediumPlayers).filter(p=>!p.released).map(p=>String(p.serial));await click('[data-action="PreviewLarge"]');
 await sleep(150);x=await state();assert(!x.reveal);assert(x.revealQueueCount>0);assert.equal(x.canShoot,false);for(const id of original)assert(vals((await meta()).mediumPlayers).some(p=>String(p.serial)===id&&!p.released));
 await shot('large-waits-for-medium');
 await wait(async()=>{const g=await state();return g.reveal?.tier==='large'&&g.reveal.stage==='intro';},'large reveal did not wait and start',15000);
 assert.equal(vals((await state()).mediumReveals).length,0);assert.equal((await meta()).activeMediumDecoders,0);checks.push('large reveal waits for active medium videos and their hearts to finish before taking the screen');
 await wait(async()=>{const m=await meta();return m.video.currentTime>.2&&m.largeVideoFade.phase==='complete';},'large video/fade regressed');await shot('large-after-medium');
 await wait(async()=>!(await state()).reveal,'large full playback did not finish',13000);x=await state();assert.equal(x.displayBalance,10000);assert.equal(x.stats.won,0);checks.push('large full video and zero-credit preview behavior remain intact');
 await spawnPreviews(2);await wait(async()=>(await meta()).activeMediumDecoders===2,'reset set medium');await reset();assert.equal((await meta()).activeMediumDecoders,0);assert.equal(vals((await state()).mediumReveals).length,0);checks.push('reset disposes all concurrent medium players');
 assert.equal(errors.length,0);checks.push('no uncaught browser exceptions');
 const report={url,checks,evidence,errors,metadata:await meta(),final:await state()};fs.writeFileSync(`${out}/medium-concurrency-acceptance.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks,errors},null,2));
 }
}catch(error){await shot('failure').catch(()=>{});fs.writeFileSync(`${out}/failure.json`,JSON.stringify({message:String(error),state:await state().catch(()=>null),metadata:await meta().catch(()=>null),errors},null,2));throw error;}
finally{await cdp.send('Target.closeTarget',{targetId});cdp.close();}

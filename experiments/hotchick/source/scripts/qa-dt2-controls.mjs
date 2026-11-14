import fs from 'node:fs';
import assert from 'node:assert/strict';
import {CdpClient} from './cdp-client.mjs';
const url=process.argv[2]||'http://127.0.0.1:8240/';
const out='artifacts/playable/qa-dt2';fs.mkdirSync(out,{recursive:true});
const cdp=await CdpClient.connect(),{targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
const {sessionId:s}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
const errors=[],checks=[],evidence={};
cdp.listeners.add(e=>{if(e.sessionId===s&&e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails);});
const ev=x=>cdp.evaluate(s,x),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>ev('window.hotChickDebug.snapshot()'),meta=()=>ev('window.hotChickDebug.metadata()'),values=v=>Object.values(v||{});
const wait=async(fn,label,timeout=6000)=>{const end=Date.now()+timeout;while(Date.now()<end){const x=await fn();if(x)return x;await sleep(25);}throw Error(label);};
const click=sel=>ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'},s);fs.writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'));};
const point=async(x,y)=>ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.left+((${x})/17.77777778+.5)*r.width,y:r.top+(.5-(${y})/10)*r.height}})()`);
const move=async(x,y,buttons=0)=>cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(x,y),buttons},s);
const down=async(x,y)=>{await move(x,y);await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...await point(x,y),button:'left',buttons:1,clickCount:1},s);};
const up=async(x,y)=>cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...await point(x,y),button:'left',buttons:0,clickCount:1},s);
const tap=async(x,y)=>{await down(x,y);await sleep(70);await up(x,y);};
const reset=async()=>{const end=Date.now()+24000;while((await state()).reveal){if(Date.now()>end)throw Error('reveal queue did not clear before reset');const r=(await state()).reveal;if(r.stage==='intro')await click('.hc-reveal-intro [data-ui="close-reveal"]');else if(r.stage==='video')await click('.hc-reveal [data-ui="close-reveal"]');await sleep(100);}await click('[data-ui="settings"]');await wait(async()=>(await state()).galleryOpen,'settings model open');await wait(()=>ev('Boolean(document.querySelector("[data-action=DemoReset]"))&&!document.querySelector(".hc-modal").hidden'),'reset controls');await click('[data-action="DemoReset"]');await wait(async()=>{const x=await state();return x.balance===10000&&x.stats.shots===0&&!x.reveal&&!x.galleryOpen;},'reset model');await sleep(120);};
const checkLayering=async()=>{
 const bundle=await ev('({state:window.hotChickDebug.snapshot(),meta:window.hotChickDebug.metadata()})');
 const layers=bundle.meta.symbolLayers;assert.equal(layers.length,27);
 for(let i=0;i<layers.length;i++){assert.equal(layers[i].layers.length,5);assert(layers[i].layers.every((v,j,a)=>j===0||v>a[j-1]));if(i>0)assert(Math.max(...layers[i-1].layers)<Math.min(...layers[i].layers),'symbol components interleave');}
 const ranks=new Map(layers.map((x,i)=>[x.id,i]));let overlaps=0;
 for(const a of bundle.state.targets)for(const b of bundle.state.targets){if(a.id>=b.id)continue;if(Math.hypot(a.x-b.x,a.y-b.y)<(a.diameter+b.diameter)/2){overlaps++;if(Math.abs(a.y-b.y)>.02){const front=a.y<b.y?a:b,back=front===a?b:a;assert(ranks.get(front.id)>ranks.get(back.id));}}}
 assert(overlaps>0);evidence.layers={overlaps,policy:bundle.meta.symbolDepthPolicy,entries:layers};checks.push('overlapping symbols render as complete back-to-front groups; each photo stays below its own frame');
};
try{
 await cdp.send('Runtime.enable',{},s);await cdp.send('Page.enable',{},s);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},s);
 await cdp.send('Page.navigate',{url},s);await wait(()=>ev('Boolean(window.hotChickDebug?.ready)'),'game load',45000);
 await sleep(150);await checkLayering();await shot('symbol-layers');
 // Low, unobstructed center gap allows a clear directional shot below the fish lanes.
 let before=await state();await tap(.8,-4.34);
 let fired=await wait(async()=>{const x=await state();return x.stats.shots>before.stats.shots?x:null;},'ordinary click on empty field did not shoot');
 assert.equal(fired.stats.spent-before.stats.spent,before.bet);assert.equal(fired.stats.shots-before.stats.shots,1);
 const aim=fired.aim.angle;assert(aim>0&&aim<.08);assert(values(fired.shots).some(x=>Number.isFinite(x.x)&&Number.isFinite(x.y)));
 await move(-4,3);await sleep(170);assert.equal((await state()).aim.angle,aim);checks.push('ordinary shot fires into empty space; hovering does not change cannon aim');
 const reflected=await wait(async()=>{const x=await state();return values(x.shots).some(p=>p.collisionCount>=1)?x:null;},'ordinary shot did not bounce at wall',2500);
 evidence.bounce=reflected.shots;await shot('directional-bounce');checks.push('normal projectile travels through empty space and reflects from a wall');
 await reset();before=await state();await down(.8,-4.34);await sleep(450);await move(-.8,-4.34,1);await sleep(1750);await up(-.8,-4.34);
 const held=await state();assert(held.stats.shots-before.stats.shots>=3);assert(held.stats.shots-before.stats.shots<=4);assert.equal(held.stats.spent-before.stats.spent,(held.stats.shots-before.stats.shots)*before.bet);assert(held.aim.angle>3);
 const heldAngle=held.aim.angle,heldRounds=held.stats.shots;await move(4,3);await sleep(1150);assert.equal((await state()).stats.shots,heldRounds);assert.equal((await state()).aim.angle,heldAngle);
 checks.push('hold and drag updates direction with one round per second; releasing stops manual fire');
 await click('[data-action="ToggleAuto"]');await sleep(1200);const auto=await state();assert(auto.stats.shots>heldRounds);assert.equal(auto.aim.angle,heldAngle);await move(-3,2);await sleep(100);assert.equal((await state()).aim.angle,heldAngle);await click('[data-action="ToggleAuto"]');checks.push('ordinary AUTO retains the last direction instead of selecting a random target');
 await reset();before=await state();const normalTarget=before.targets.find(t=>t.tier==='large'&&t.state==='swimming'&&Math.abs(t.x)<6.4);await tap(normalTarget.x,normalTarget.y);
 const impact=await wait(async()=>{const x=await state();return x.lastRound?.status==='hit'?x:null;},'normal projectile did not physically hit the fish in its path',3000);assert.equal(impact.lastRound.hitTargetIds.length,1);assert.equal(impact.stats.spent,before.bet);evidence.normalImpact=impact.lastRound;checks.push('normal projectile resolves one real collision with one charge, rather than a timed guaranteed target callback');
 await reset();await click('[data-weapon="flower"]');await sleep(140);before=await state();await tap(0,4.1);await sleep(130);assert.equal((await state()).stats.spent,before.stats.spent);checks.push('targeted flower ignores an empty-space click');
 const target=(await state()).targets.find(t=>t.state==='swimming'&&t.tier==='large'&&Math.abs(t.x)<6.5&&Math.abs(t.y)<2.8);
 await tap(target.x,target.y);const flower=await wait(async()=>{const x=await state();return x.stats.shots>before.stats.shots?x:null;},'flower target click');assert.equal(flower.stats.spent-before.stats.spent,before.bet*6);assert(values(flower.shots).every(x=>Number.isFinite(x.x)&&Number.isFinite(x.y)));evidence.flower=flower.lastRound;checks.push('flower selects a girl and launches a targeted projectile with a single ×6 charge');
 await sleep(1100);const retained=await state();if(!retained.reveal&&retained.lockedTargetId&&retained.canShoot){await tap(0,4.1);await sleep(250);assert.equal((await state()).stats.spent,retained.stats.spent);assert.equal((await state()).lockedTargetId,retained.lockedTargetId);checks.push('a new empty-space flower gesture does not shoot the remembered target');}
 await reset();await click('[data-weapon="rocket"]');await sleep(140);before=await state();const rocketTarget=before.targets.find(t=>t.state==='swimming'&&Math.abs(t.x)<6.5&&t.y>1);
 await tap(rocketTarget.x,rocketTarget.y);const rocket=await wait(async()=>{const x=await state();return x.stats.shots>before.stats.shots?x:null;},'rocket target click');assert.equal(rocket.stats.spent-before.stats.spent,before.bet*15);assert(new Set(rocket.lastRound.targetIds).size<=5);assert.equal(new Set(rocket.lastRound.targetIds).size,rocket.lastRound.targetIds.length);evidence.rocket=rocket.lastRound;await shot('targeted-rockets');
 await click('[data-weapon="like"]');assert(values((await state()).shots).every(x=>x.weapon==='rocket'));checks.push('rocket round keeps at most five distinct targets and one ×15 charge after a weapon switch');
 await reset();await click('[data-action="ToggleLock"]');await wait(async()=>(await state()).lock,'lock enabled');let locked=await state();assert(locked.auto);assert(locked.lockedTargetId);await click('[data-action="ToggleAuto"]');await sleep(120);locked=await state();assert(locked.lock&&!locked.auto);await click('[data-action="ToggleLock"]');await sleep(120);assert(!(await state()).lock&&!(await state()).auto);checks.push('Lock and AUTO follow DT2 coupling and unlock stops automatic tracking');
 await reset();await ev(`(()=>{window.__fadeQa={running:true,samples:[]};function frame(){if(!window.__fadeQa.running)return;const m=window.hotChickDebug.metadata(),g=window.hotChickDebug.snapshot();window.__fadeQa.samples.push({time:performance.now(),stage:g.reveal?.stage,fade:m.largeVideoFade,video:m.video});requestAnimationFrame(frame)}requestAnimationFrame(frame);return true})()`);
 const previewBefore=await state();await click('[data-action="PreviewLarge"]');
 await wait(async()=>{const x=await meta();return x.largeVideoFade.phase==='fading'&&x.largeVideoFade.progress>.15&&x.largeVideoFade.progress<.9;},'large video did not fade',5000);await shot('large-video-fade');
 await wait(async()=>{const x=await meta();return x.largeVideoFade.phase==='complete';},'large fade did not finish');const shown=await meta();assert(shown.largeVideoFade.firstFrameMediaTime<.15);assert.equal(shown.largeVideoFade.durationMs,600);assert(shown.largeVideoFade.startedNotified);assert(Math.abs(shown.video.duration-8.041667)<.03);await shot('large-video-visible');
 await wait(async()=>!(await state()).reveal,'large video/reward did not complete',15000);const samples=await ev('(()=>{window.__fadeQa.running=false;return window.__fadeQa.samples})()');
 const fading=samples.filter(x=>x.fade.phase==='fading');assert(fading.length>=4);assert(fading.some(x=>x.fade.opacity>.05&&x.fade.opacity<.95));assert(fading.every(x=>x.fade.introVisible));assert(samples.some(x=>x.video.currentTime>7.8),'video was cut short');
 const previewAfter=await state();assert.equal(previewAfter.displayBalance,previewBefore.displayBalance);assert.equal(previewAfter.balance,previewBefore.balance);evidence.fade=samples;checks.push('large video fades in over 0.6s from its first actual frame, keeps the intro beneath it, and plays the complete clip');
 assert.equal(errors.length,0);checks.push('no uncaught browser exceptions');const final=await state();await shot('final');fs.writeFileSync(`${out}/dt2-controls-acceptance.json`,JSON.stringify({url,checks,evidence,errors,final},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(error){await shot('failure').catch(()=>{});fs.writeFileSync(`${out}/failure.json`,JSON.stringify({error:String(error),state:await state().catch(()=>null),metadata:await meta().catch(()=>null),errors},null,2));throw error;}
finally{await cdp.send('Target.closeTarget',{targetId});cdp.close();}

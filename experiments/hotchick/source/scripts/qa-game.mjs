import fs from 'node:fs';
import assert from 'node:assert/strict';
import {CdpClient} from './cdp-client.mjs';
const base=process.argv[2]||'http://127.0.0.1:8240/';
const out=process.env.QA_OUTPUT||'artifacts/playable/qa';
fs.mkdirSync(out,{recursive:true});
const cdp=await CdpClient.connect();
const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
const {sessionId:s}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
const errors=[];
cdp.listeners.add(e=>{if(e.sessionId===s&&e.method==='Runtime.exceptionThrown') errors.push(e.params.exceptionDetails);});
const ev=x=>cdp.evaluate(s,x);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const snap=()=>ev('window.hotChickDebug?.snapshot()');
const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'},s);fs.writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'));};
const wait=async(fn,message,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(60);}throw Error(message);};
const click=selector=>ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const closeReveals=async()=>{const end=Date.now()+20000;while(Date.now()<end){const r=(await snap()).reveal;if(!r)return;if(r.stage!=='reward')await click('[data-ui="close-reveal"]');await sleep(100);}throw Error('reveal queue did not finish');};
const fieldClick=async target=>{
  const pos=await ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.left+((${target.x})/17.77777778+.5)*r.width,y:r.top+(.5-(${target.y})/10)*r.height}})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...pos},s);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',buttons:1,clickCount:1},s);
  await sleep(80);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',buttons:0,clickCount:1},s);
};
try {
  await cdp.send('Page.enable',{},s); await cdp.send('Runtime.enable',{},s);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},s);
  await cdp.send('Page.navigate',{url:base},s);
  const end=Date.now()+45000;
  while(!await ev('Boolean(window.hotChickDebug?.ready)')){if(Date.now()>end)throw Error(await ev('document.body.innerText'));await sleep(200);}
  await sleep(900);
  const initial=await snap(),metadata=await ev('window.hotChickDebug.metadata()');
  await shot('playfield');
  const checks=[];
  assert.equal(initial.targets.length,27);assert.equal(metadata.fieldVideoPlayers,0);
  await sleep(350);assert.notEqual((await snap()).targets[0].x,initial.targets[0].x);checks.push('27 moving WebP field symbols; no field video players');
  await click('[data-ui="gallery"]');await wait(async()=>(await snap()).galleryOpen,'gallery did not open');
  assert.equal(await ev('document.querySelectorAll(".hc-collection-card.is-locked").length'),2);
  await shot('gallery-locked');await click('[data-ui="close-gallery"]');await sleep(180);
  for(const [weapon,mult,max] of [['like',1,1],['flower',6,6],['rocket',15,5]]){
    await closeReveals();await click(`[data-weapon="${weapon}"]`);await sleep(140);
    await wait(async()=>(await snap()).canShoot,'shooting did not become available');
    const before=await snap(),target=before.targets.find(t=>t.state==='swimming'&&Math.abs(t.x)<6.5&&Math.abs(t.y)<2.6);
    await fieldClick(target);
    const after=await wait(async()=>{const a=await snap();return a.stats.shots>before.stats.shots?a:null;},'field click did not shoot');
    assert.equal(after.stats.shots-before.stats.shots,1);assert.equal(after.stats.spent-before.stats.spent,before.bet*mult);
    const r=after.lastRound;assert.equal(r.weapon,weapon);assert.equal(new Set(r.targetIds).size,r.targetIds.length);assert(r.targetIds.length<=max);
    if(weapon==='flower'){assert(r.secondaryQuota>=2&&r.secondaryQuota<=5);assert.equal(r.searchRadius,1.35);for(const t of r.selection)assert(Math.hypot(t.x-r.primaryX,t.y-r.primaryY)<=1.350001);}
    checks.push(`${weapon}: one round charge ${before.bet*mult}, ${r.targetIds.length} distinct targets`);
    await sleep(800);
  }
  await closeReveals();
  for(const [tier,duration] of [['medium',5.041667],['large',8.041667]]){
    const before=await snap();await click(`[data-action="Preview${tier==='large'?'Large':'Medium'}"]`);
    await wait(async()=>{const x=await ev('window.hotChickDebug.metadata()');return x.reveal?.tier===tier&&x.video.currentTime>.2&&x.video.readyState>=2;},`${tier} video did not play`);
    const md=await ev('window.hotChickDebug.metadata()');assert(Math.abs(md.video.duration-duration)<.05);assert.equal(md.video.error,null);
    const layout=await ev(`(()=>{const el=document.querySelector('.hc-reveal'),r=el.getBoundingClientRect(),v=el.querySelector('video');return{width:r.width,height:r.height,src:v.currentSrc}})()`);
    assert(layout.src.endsWith(`${tier}-reveal-h264.mp4`));if(tier==='large'){assert.equal(layout.width,1280);assert.equal(layout.height,720);}
    await shot(`${tier}-performance`);
    const during=await snap();assert.equal(during.stats.spent,before.stats.spent);assert.equal(during.stats.won,before.stats.won);assert.deepEqual(during.unlocked,before.unlocked);
    await wait(async()=>!(await snap()).reveal,`${tier} video did not return to playfield`,11000);
    checks.push(`${tier} preview: correct H264 clip, full duration ${md.video.duration}s, no charge/payout/unlock, returns automatically`);
  }
  await click('[data-action="ToggleLock"]');await sleep(160);assert((await snap()).lock);
  await click('[data-action="ToggleAuto"]');await wait(async()=>(await snap()).auto,'AUTO not enabled');
  await click('[data-ui="gallery"]');await wait(async()=>(await snap()).galleryOpen,'gallery did not open');
  assert.equal((await snap()).auto,false);const paused=(await snap()).stats.spent;await sleep(1200);assert.equal((await snap()).stats.spent,paused);
  await click('[data-ui="close-gallery"]');await sleep(160);checks.push('LOCK and AUTO work; gallery stops AUTO and prevents new charges');
  // Obtain a normal medium catch through the same pointer path a player uses.
  await click('[data-weapon="like"]');await sleep(140);
  for(let i=0;!(await snap()).unlocked.medium&&i<24;i++){
    await closeReveals();await wait(async()=>(await snap()).canShoot,'cooldown not finished');
    const state=await snap(),target=state.targets.find(t=>t.tier==='medium'&&t.state==='swimming'&&Math.abs(t.x)<6.7&&Math.abs(t.y)<2.8);
    if(!target){await sleep(500);continue;}await fieldClick(target);await sleep(1000);
  }
  await closeReveals();const unlocked=await snap();assert(unlocked.unlocked.medium,'normal medium catches did not unlock gallery');
  await click('[data-ui="gallery"]');await wait(async()=>(await snap()).galleryOpen,'gallery open');await sleep(100);
  await click('[data-replay="medium"]');
  await wait(()=>ev(`(()=>{const v=document.querySelector('.hc-gallery-player video');return Boolean(v&&v.currentTime>.2&&!v.error)})()`),'gallery replay did not play');
  const replayBefore=await snap();await sleep(1000);const replayAfter=await snap();assert.equal(replayAfter.stats.spent,replayBefore.stats.spent);assert.equal(replayAfter.stats.won,replayBefore.stats.won);
  await shot('gallery-replay');await click('[data-ui="close-gallery"]');await sleep(180);checks.push('natural catch unlocks gallery; actual video replay does not charge or pay again');
  const timing=await ev(`new Promise(resolve=>{const t=[];function frame(n){t.push(n);if(t.length<121)requestAnimationFrame(frame);else resolve({fps:120000/(t[120]-t[0]),worstFrameMs:Math.max(...t.slice(1).map((n,i)=>n-t[i]))})}requestAnimationFrame(frame)})`);
  assert.equal(errors.length,0);checks.push('no uncaught browser exceptions');
  const final=await snap(),lastMetadata=await ev('window.hotChickDebug.metadata()');
  await shot('final-playfield');
  const report={browser:cdp.version.Browser,url:base,checks,timing,metadata:lastMetadata,initial,final,errors};
  fs.writeFileSync(`${out}/browser-acceptance.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks,timing,stats:final.stats,metadata:lastMetadata,errors},null,2));
} finally {await cdp.send('Target.closeTarget',{targetId});cdp.close();}

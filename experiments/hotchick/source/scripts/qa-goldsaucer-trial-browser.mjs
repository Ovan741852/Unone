import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CdpClient} from './cdp-client.mjs';
const base=new URL(process.argv[2]||'http://127.0.0.1:8253/release-035/');
const cdp=await CdpClient.connect(9237),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reports=[];
try{for(const mode of ['guest','standalone']){
 let targetId,sessionId;const errors=[];
 const evaluate=expression=>cdp.evaluate(sessionId,expression);
 async function until(read,label,timeout=30000){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await read();if(value)return value;}catch(error){if(!/context.*destroy|Cannot find context/i.test(error.message))throw error;}await sleep(50);}throw Error(label+': '+JSON.stringify(await evaluate('window.hotChickDebug?{trial:hotChickDebug.snapshot().trial,platform:hotChickDebug.metadata().platform}:document.body.innerText')));}
 try{
  ({targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}));({sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
  cdp.listeners.add(event=>{if(event.sessionId===sessionId&&event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.text);});
  const mock=`(()=>{const events=new Map(),calls={init:0,on:0,server:0,wallet:0,saves:0};window.__trialQa={bootId:Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),calls,emit(event,data){for(const cb of events.get(event)||[])cb(data);}};const forbidden=type=>async()=>{calls[type]++;throw Error('forbidden-'+type);};window.GoldSaucer={async init(){calls.init++;${mode==='standalone'?'throw Error("notEmbedded");':'await new Promise(r=>setTimeout(r,120));return{user:null,trial:true,preview:false,balance:null};'}},async getUser(){return null;},async getBalance(){return null;},on(event,cb){calls.on++;const all=events.get(event)||[];all.push(cb);events.set(event,all);return()=>events.set(event,all.filter(x=>x!==cb));},server:{call:forbidden('server')},chips:{get:forbidden('wallet'),buyIn:forbidden('wallet'),cashOut:forbidden('wallet')},saves:{get:forbidden('saves'),set:forbidden('saves')}};})();`;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:mock},sessionId);
  const url=new URL(base);url.searchParams.set('debug','1');if(mode==='standalone')url.searchParams.set('trial','1');
  await cdp.send('Page.navigate',{url:url.href},sessionId);
  const state=()=>evaluate('hotChickDebug.snapshot()'),meta=()=>evaluate('hotChickDebug.metadata().platform'),click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await until(()=>evaluate('Boolean(window.hotChickDebug?.ready)'),'official player boot');
  await until(async()=>{const m=await meta(),x=await state();return m.trial===true&&!m.bootPending&&!x.platform.paused;},'local trial classification and resume');
  assert.equal((await meta()).source,mode==='guest'?'platform-guest':'standalone');
  assert.equal((await state()).displayBalance,10000);assert.equal((await state()).platform.enabled,false);assert.equal((await state()).cards.seedReady,true);
  await until(()=>evaluate(`document.querySelector('.hc-wallet small')?.textContent==='試玩點數'`),'trial wallet label');
  assert.equal(await evaluate(`document.querySelector('[data-ui=trial-refill]')`),null);
  assert.equal(await evaluate(`document.querySelector('[data-ui=platform-wallet]').hidden`),true);
  const point=await evaluate(`(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();return{x:r.left+(.6/17.77777778+.5)*r.width,y:r.top+(.5+4.35/10)*r.height};})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1},sessionId);await sleep(50);await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',buttons:0,clickCount:1},sessionId);
  await click('[data-action=ToggleAuto]');await sleep(500);if((await state()).auto)await click('[data-action=ToggleAuto]');
  await until(async()=>{const x=await state();return x.reservedWager>0&&x.displayBalance<10000;},'trial points are reserved without automatic refilling');
  let x=await state();assert.equal(x.displayBalance,10000-x.reservedWager);assert.equal(x.stats.spent,0);assert.equal(x.cards.progress,0);
  await until(async()=>(await state()).reservedWager===0,'in-flight misses still settle and refund');
  x=await state();assert.equal(x.displayBalance,10000);
  const calls=await evaluate('__trialQa.calls');assert.equal(calls.server,0);assert.equal(calls.wallet,0);assert.equal(calls.saves,0);if(mode==='standalone'){assert.equal(calls.init,0);assert.equal(calls.on,0);}
  if(mode==='guest'){
   await evaluate(`__trialQa.emit('userChanged',{user:{id:'now-signed-in'},trial:false})`);
   await until(async()=>(await meta()).reloadRequired===true,'identity change requires fresh game');assert.equal((await evaluate('__trialQa.calls')).server,0);
  }
  const boot=await evaluate('__trialQa.bootId');await cdp.send('Page.reload',{},sessionId);
  await until(()=>evaluate(`Boolean(window.__trialQa?.bootId&&__trialQa.bootId!==${JSON.stringify(boot)}&&window.hotChickDebug?.ready)`),'fresh trial reload');await until(async()=>{const x=await state(),m=await meta();return m.trial===true&&!m.bootPending&&!x.platform.paused;},'fresh trial ready');
  x=await state();assert.equal(x.displayBalance,10000);assert.equal(x.cards.drawsUsed,0);assert.deepEqual(errors,[]);
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);await fs.writeFile(`artifacts/goldsaucer/qa/trial-${mode}.png`,Buffer.from(shot.data,'base64'));
  reports.push({mode,passed:true,initialBalance:10000,noRefillControl:true,noAutomaticRefill:true,refundPreserved:true,freshReload10000:true,forbiddenCalls:{server:calls.server,wallet:calls.wallet,saves:calls.saves},errors});
 }finally{if(targetId)await cdp.send('Target.closeTarget',{targetId});}
 }
 const report={passed:true,scope:'Official player and synthetic SDK; no real platform funds',cases:reports};await fs.writeFile('artifacts/goldsaucer/qa/trial-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{cdp.close();}

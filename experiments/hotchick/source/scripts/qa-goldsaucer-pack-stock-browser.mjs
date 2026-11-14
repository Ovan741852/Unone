import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CdpClient} from './cdp-client.mjs';
const url=new URL(process.argv[2]||'http://127.0.0.1:8253/release-032/');url.searchParams.set('debug','1');
const initialPacks=Number(process.argv[3]||9999);assert([11,9999].includes(initialPacks));
const key=`pack-stock-fixture-${initialPacks}-${Date.now()}`,source=await fs.readFile('server/goldsaucer/functions.js','utf8');
const cdp=await CdpClient.connect(9237),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let targetId,sessionId;const errors=[];
const evaluate=expression=>cdp.evaluate(sessionId,expression);
async function until(read,label,timeout=30000){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await read();if(value)return value;}catch(error){if(!/context.*destroy|Cannot find context/i.test(error.message))throw error;}await sleep(50);}throw Error(label+': '+JSON.stringify(await evaluate('window.hotChickDebug?{cards:hotChickDebug.snapshot().cards,platform:hotChickDebug.metadata().platform.server}:document.body.innerText')));}
const mock=`(()=>{
 let definitions;const defineFunctions=value=>definitions=value;
 ${source}
 const key=${JSON.stringify(key)},events=new Map(),ctx=()=>({player:{id:'pack-stock-fixture'},chips:10000,currency:{name:'心動幣',perDiamond:50},random:()=>.999,randomInt:(min,max)=>max});
 function read(){let state=JSON.parse(localStorage.getItem(key)||'null');if(!state){state=definitions.init(ctx());const p=state.profiles.paid;p.stats.spent=${initialPacks}*1000;Object.assign(p.cards,{drawsAvailable:${initialPacks},drawsEarned:${initialPacks},creditedSpend:${initialPacks}*1000});localStorage.setItem(key,JSON.stringify(state));}return state;}
 const emit=(event,data)=>{for(const cb of events.get(event)||[])cb(data);};
 window.__packQa={bootId:Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),read,calls:[]};
 window.GoldSaucer={async init(){},async getUser(){return{id:'pack-stock-fixture'};},async getBalance(){return 0;},on(event,cb){const all=events.get(event)||[];all.push(cb);events.set(event,all);return()=>events.set(event,all.filter(x=>x!==cb));},chips:{async get(){return{currency:{name:'心動幣',perDiamond:50},chips:10000,bankBalance:0};},async buyIn(){throw Error('unexpected-currency-action');},async cashOut(){throw Error('unexpected-currency-action');}},server:{async call(name,input){const out=definitions[name](read(),JSON.parse(JSON.stringify(input)),ctx());localStorage.setItem(key,JSON.stringify(out.state));__packQa.calls.push({name,drawId:input.drawId,size:out.result.lastBatch?.size});emit('chipsChanged',{chips:10000});return{result:out.result,chips:10000};}}};
})();`;
try{
 ({targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}));({sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
 cdp.listeners.add(event=>{if(event.sessionId===sessionId&&event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.text);});
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:mock},sessionId);await cdp.send('Page.navigate',{url:url.href},sessionId);
 const state=()=>evaluate('hotChickDebug.snapshot()'),meta=()=>evaluate('hotChickDebug.metadata().platform.server'),click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 await until(()=>evaluate('Boolean(window.hotChickDebug?.ready)'),'official player boot');await until(async()=>(await meta()).ready,'14-bit pack hydration');
 assert.equal((await state()).cards.drawsAvailable,initialPacks);assert.equal((await state()).cards.capacity,9999);
 await until(()=>evaluate(`document.querySelector('.hc-pack-energy strong em')?.textContent.includes(${JSON.stringify(initialPacks.toLocaleString('en-US'))})`),'visible stock counter hydrated');
 const sidebar=await evaluate(`(()=>{const p=document.querySelector('.hc-pack-energy'),s=p.querySelector('strong');return{text:p.innerText,label:p.getAttribute('aria-label'),scrollWidth:s.scrollWidth,clientWidth:s.clientWidth};})()`);
 assert(sidebar.scrollWidth<=sidebar.clientWidth+1,'stock counter fits its sidebar');
 const initialShot=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);await fs.writeFile(`artifacts/goldsaucer/qa/pack-stock-${initialPacks}-sidebar.png`,Buffer.from(initialShot.data,'base64'));
 await click('[data-ui=pack]');await until(()=>evaluate('Boolean(document.querySelector("[data-card-action=open-pack]"))'),'pack window');
 assert.equal(await evaluate('document.querySelectorAll(".hc-sealed-pack").length'),10);
 // Rotating to portrait prevents new bets and new card draws throughout the game.
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
 await until(async()=>{const x=await state();return x.viewportBlocked&&!x.cards.canDraw;},'portrait gate');
 assert.equal(await evaluate(`document.querySelector('.hc-game-ui').inert && !document.querySelector('.hc-orientation-gate').hidden`),true);
 // Real pointer input lands on the orientation gate. DOM click() would bypass
 // inert and would not represent a player interaction.
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:10,y:10,button:'left',buttons:1,clickCount:1},sessionId);
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:10,y:10,button:'left',buttons:0,clickCount:1},sessionId);
 await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code:'Space',key:' '},sessionId);await sleep(80);await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' '},sessionId);await sleep(100);
 assert.equal((await state()).cards.drawsUsed,0);assert.equal((await state()).stats.shots,0);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
 await until(async()=>!(await state()).viewportBlocked&&(await state()).cards.canDraw,'landscape drawing resumes');
 await until(()=>evaluate('Boolean(document.querySelector("[data-card-action=open-pack]"))'),'landscape pack controls');
 await click('[data-card-action=open-pack]');
 await until(async()=>(await state()).cards.drawsUsed===10,'first ten cards');
 assert.equal((await state()).cards.drawsAvailable,initialPacks-10);
 await until(()=>evaluate(`document.querySelector('.hc-card-pack-overlay')?.dataset.phase==='results'`),'first reveal animation');
 assert.equal(await evaluate('document.querySelectorAll(".hc-batch-result").length'),10);
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);await fs.writeFile(`artifacts/goldsaucer/qa/pack-stock-${initialPacks}.png`,Buffer.from(shot.data,'base64'));
 await click('[data-card-action=dismiss]');await until(()=>evaluate('Boolean(document.querySelector("[data-card-action=open-pack]"))'),'next manual batch');
 assert.equal(await evaluate('document.querySelectorAll(".hc-sealed-pack").length'),Math.min(initialPacks-10,10));
 await click('[data-card-action=open-pack]');
 const total=Math.min(initialPacks,20);await until(async()=>(await state()).cards.drawsUsed===total,'second bounded batch');
 assert.equal((await state()).cards.drawsAvailable,initialPacks-total);
 await until(()=>evaluate(`document.querySelector('.hc-card-pack-overlay')?.dataset.phase==='results'`),'second reveal animation');
 assert.equal(await evaluate('document.querySelectorAll(".hc-batch-result").length'),total-10);
 const boot=await evaluate('__packQa.bootId');await cdp.send('Page.reload',{},sessionId);
 await until(()=>evaluate(`Boolean(window.__packQa?.bootId && window.__packQa.bootId!==${JSON.stringify(boot)} && window.hotChickDebug?.ready)`),'new document after reload');await until(async()=>(await meta()).ready,'persistent counts restored');
 const restored=await state();assert.equal(restored.cards.drawsAvailable,initialPacks-total);assert.equal(restored.cards.drawsUsed,total);assert.equal(restored.displayBalance,10000);
 assert.equal(Object.values(restored.cards.catalog).reduce((sum,card)=>sum+card.count,0),total);assert.deepEqual(errors,[]);
 const report={passed:true,scope:'Official player, production functions and synthetic paid profile; no real currency',initialPacks,opened:total,remaining:initialPacks-total,capacity:9999,maxAnimationBatch:10,sidebar,landscapeOnly:true,reloadPreserves:true,errors};await fs.writeFile(`artifacts/goldsaucer/qa/pack-stock-${initialPacks}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(targetId)await cdp.send('Target.closeTarget',{targetId});cdp.close();}

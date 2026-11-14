import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CdpClient} from './cdp-client.mjs';

const url=new URL(process.argv[2]||'http://192.168.165.43:8252/release-031/');url.searchParams.set('debug','1');
const baseline=process.argv.includes('--baseline');
const source=await fs.readFile('server/goldsaucer/functions.js','utf8');
const cdp=await CdpClient.connect(9237),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let targetId,sessionId;const errors=[];
const evaluate=expression=>cdp.evaluate(sessionId,expression);
async function until(read,label,timeout=30000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await read();if(value)return value;await sleep(50);}throw Error(label+': '+JSON.stringify(await evaluate('window.hotChickDebug?{wager:hotChickDebug.snapshot().wagerStatus,server:hotChickDebug.metadata().platform.server}:document.body.innerText')));}
const mock=`(()=>{
 let definitions;const defineFunctions=value=>definitions=value;
 ${source}
 const listeners=new Map();let chips=10000,state=null;
 const context=()=>({player:{id:'smooth-paid-fixture'},chips,currency:{name:'心動幣',perDiamond:50},random:()=>.999,randomInt:(min,max)=>max});
 const emit=(event,data)=>{for(const cb of listeners.get(event)||[])cb(data);};
 window.__smoothQa={gets:0,calls:[],latency:650,samples:[],externalDelta(value){chips+=value;emit('chipsChanged',{chips});},read:()=>({chips,state})};
 window.GoldSaucer={async init(){},async getUser(){return{id:'smooth-paid-fixture'};},async getBalance(){return 0;},on(event,cb){const all=listeners.get(event)||[];all.push(cb);listeners.set(event,all);return()=>listeners.set(event,all.filter(x=>x!==cb));},chips:{async get(){__smoothQa.gets++;return{currency:{name:'心動幣',perDiamond:50},chips,diamondsValue:0,bankBalance:0};},async buyIn(){throw Error('unexpected-currency-action');},async cashOut(){throw Error('unexpected-currency-action');}},server:{async call(name,input){await new Promise(resolve=>setTimeout(resolve,__smoothQa.latency));if(!state){state=definitions.init(context());state.profiles.paid.preferences.bet=1;}const out=definitions[name](state,JSON.parse(JSON.stringify(input)),context());state=out.state;chips+=out.chips.win-out.chips.bet;__smoothQa.calls.push({name,batchId:input.batchId,time:performance.now(),ok:out.result.ok});emit('chipsChanged',{chips});return{result:out.result,chips};}}};
 setInterval(()=>{const x=window.hotChickDebug?.snapshot();if(x)__smoothQa.samples.push({at:performance.now(),shots:x.stats.shots,inflight:x.wagerStatus?.inflightCount??Object.values(x.shots||{}).length,reason:x.wagerStatus?.blockReason,connecting:x.platform.connecting,notice:document.querySelector('.hc-platform-notice')?.hidden===false});},20);
})();`;
try{
 ({targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}));({sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));
 await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
 cdp.listeners.add(event=>{if(event.sessionId===sessionId&&event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.text);});
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:mock},sessionId);await cdp.send('Page.navigate',{url:url.href},sessionId);
 const state=()=>evaluate('hotChickDebug.snapshot()'),meta=()=>evaluate('hotChickDebug.metadata().platform.server');
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 await until(()=>evaluate('Boolean(window.hotChickDebug?.ready)'),'official player boot');await until(async()=>(await meta()).ready,'paid bootstrap');
 const point=await evaluate(`(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),p={x:r.left+(.6/17.77777778+.5)*r.width,y:r.top+(.5+4.35/10)*r.height};return{...p,canvas:document.elementFromPoint(p.x,p.y)===c};})()`);
 assert(point.canvas,'horizontal firing point is unobscured');
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1},sessionId);await sleep(50);await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',buttons:0,clickCount:1},sessionId);
 await click('[data-action=ToggleAuto]');const missStarted=await evaluate('performance.now()');await sleep(3000);
 const miss=await state();if(miss.auto)await click('[data-action=ToggleAuto]');
 if(baseline){
   const samples=await evaluate(`__smoothQa.samples.filter(x=>x.at>=${missStarted})`);
   const report={scope:'Prior release030, identical horizontal AUTO fixture and650ms synthetic SDK',firstThreeSecondShots:miss.stats.shots,maxNormalInflight:Math.max(...samples.map(x=>x.inflight||0)),blockingReasons:[...new Set(samples.map(x=>x.reason))],errors};
   await fs.writeFile('artifacts/goldsaucer/qa/browser-smooth-baseline-v30.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }else{
 assert(miss.stats.shots>=23,`normal flight must sustain cadence, got ${miss.stats.shots}`);
 const misses=await evaluate(`__smoothQa.samples.filter(x=>x.at>=${missStarted})`);
 assert(Math.max(...misses.map(x=>x.inflight||0))>=20,'normal flight can exceed the old twelve-round cap');
 assert(!misses.some(x=>x.reason==='settlementBacklog'),'normal flying projectiles are not a server backlog');
 await until(async()=>(await state()).reservedWager===0,'missed projectiles drain and refund');
 assert.equal((await state()).displayBalance,10000);assert.equal((await state()).stats.spent,0);
 await click('[data-action=ToggleLock]');await until(async()=>(await state()).stats.spent>=1,'tracking hits settle');
 const steadyStarted=await evaluate('performance.now()'),before=await state();await sleep(6000);const after=await state();
 if(after.auto)await click('[data-action=ToggleAuto]');
 assert(after.stats.shots-before.stats.shots>=44,'latency-tolerant firing cadence remains near8.33 rounds/s');
 const steady=await evaluate(`__smoothQa.samples.filter(x=>x.at>=${steadyStarted})`);
 assert(!steady.some(x=>x.connecting),'own settlement events never close the fire gate');
 assert.equal(await evaluate('__smoothQa.gets'),0,'own authoritative receipts never cause redundant wallet reads');
 await until(async()=>{const x=await state();return x.reservedWager===0&&(await meta()).ready;},'final receipts drain');
 const beforeExternal=(await state()).displayBalance;
 await evaluate('__smoothQa.externalDelta(100)');
 await until(async()=>(await state()).displayBalance===beforeExternal+100&&(await meta()).ready,'external wallet change reconciles');
 assert.equal(await evaluate('__smoothQa.gets'),1,'external wallet changes still trigger exactly one read');assert.deepEqual(errors,[]);
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);await fs.writeFile('artifacts/goldsaucer/qa/browser-smooth.png',Buffer.from(shot.data,'base64'));
 const report={passed:true,scope:'Official player, real functions, synthetic paid ledger and650ms server latency',checks:['normal flying shots exceed12 without backlog','continuous cadence during delayed settlement','own balance events cause no wallet read or fire gate','external wallet balance still reconciles','missed rounds refund fully'],firstThreeSecondShots:miss.stats.shots,maxNormalInflight:Math.max(...misses.map(x=>x.inflight||0)),sixSecondTrackingShots:after.stats.shots-before.stats.shots,ownWalletReads:0,externalWalletReads:1,errors};
 await fs.writeFile('artifacts/goldsaucer/qa/browser-smooth.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}finally{if(targetId)await cdp.send('Target.closeTarget',{targetId});cdp.close();}

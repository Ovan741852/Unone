import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CdpClient} from './cdp-client.mjs';

const address = new URL(process.argv[2] || 'http://127.0.0.1:8249/');
address.searchParams.set('debug','1');
const source = await fs.readFile('server/goldsaucer/functions.js','utf8');
const key = `wallet-browser-fixture-${Date.now()}`;
const cdp = await CdpClient.connect(9237);
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
let targetId, sessionId;
const errors=[];
const evaluate=expression=>cdp.evaluate(sessionId,expression);
async function waitFor(read,label,timeout=30000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    try {const value=await read();if(value)return value;}
    catch(error){if(!/context.*destroy|Cannot find context/i.test(error.message))throw error;}
    await sleep(50);
  }
  const detail=await evaluate(`window.hotChickDebug?{wager:hotChickDebug.snapshot().wagerStatus,server:hotChickDebug.metadata().platform.server,notice:document.querySelector('.hc-platform-notice')?.textContent}:document.body.innerText`);
  throw Error(label+': '+JSON.stringify(detail));
}
const mock=`(()=>{
 let definitions;const defineFunctions=value=>definitions=value;
 ${source}
 const key=${JSON.stringify(key)};const listeners=new Map();
 const context=ledger=>({player:{id:'paid-browser-fixture'},chips:ledger.chips,currency:{name:'心動幣',perDiamond:50},random:()=>window.__walletQa.roll,randomInt:(min,max)=>min+Math.floor(window.__walletQa.roll*(max-min+1))});
 function read(){let ledger=JSON.parse(localStorage.getItem(key)||'null');if(!ledger){ledger={chips:61,state:null};ledger.state=definitions.init(context(ledger));ledger.state.profiles.paid.preferences.bet=1;localStorage.setItem(key,JSON.stringify(ledger));}return ledger;}
 const save=ledger=>localStorage.setItem(key,JSON.stringify(ledger));
 const emit=(event,data)=>{for(const cb of listeners.get(event)||[])cb(data);};
 function call(name,input){const ledger=read(),out=definitions[name](ledger.state,input,context(ledger));ledger.state=out.state;ledger.chips+=out.chips.win-out.chips.bet;save(ledger);return{result:out.result,chips:ledger.chips};}
 window.__walletQa={bootId:Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),history:[],notices:[],roll:0,read,setBalance(chips){const ledger=read();ledger.chips=chips;save(ledger);emit('chipsChanged',{chips});},replaceSession(){return call('open',{clientId:'second-fixture-page',mode:'paid'});}};
 window.GoldSaucer={async init(){},async getUser(){return{id:'paid-browser-fixture'};},async getBalance(){return 0;},on(event,cb){const all=listeners.get(event)||[];all.push(cb);listeners.set(event,all);return()=>listeners.set(event,all.filter(x=>x!==cb));},ui:{async alert(message,options){window.__walletQa.notices.push({message,options});return true;}},chips:{async get(){const ledger=read();return{currency:{name:'心動幣',perDiamond:50},chips:ledger.chips,diamondsValue:0,bankBalance:0};},async buyIn(){throw Error('unexpected-currency-action');},async cashOut(){throw Error('unexpected-currency-action');}},server:{async call(name,input){const out=call(name,JSON.parse(JSON.stringify(input)));window.__walletQa.history.push({name,input,out});emit('chipsChanged',{chips:out.chips});return out;}}};
})();`;
try{
 ({targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}));
 ({sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));
 await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
 cdp.listeners.add(event=>{if(event.sessionId===sessionId&&event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.text);});
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:mock},sessionId);
 await cdp.send('Page.navigate',{url:address.href},sessionId);
 const state=()=>evaluate('hotChickDebug.snapshot()');
 const meta=()=>evaluate('hotChickDebug.metadata().platform.server');
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 await waitFor(()=>evaluate('Boolean(window.hotChickDebug?.ready)'),'official player boot');
 await waitFor(async()=>(await meta()).ready&&!(await state()).platform.paused,'paid profile ready and initialization pause released');
 assert.equal((await state()).displayBalance,61);assert.equal((await state()).bet,1);assert.equal((await meta()).mode,'paid');
 await click('[data-action=WeaponFlower]');await sleep(200);
 async function shootSmall({unrestricted=false}={}){
   const point=await waitFor(async()=>{
     const x=await state(),targets=Object.values(x.targets);
     const candidates=targets.filter(t=>(unrestricted||t.tier==='small')&&t.state==='swimming'&&Math.abs(t.x)<6.2&&Math.abs(t.y)<2.9&&(unrestricted||!targets.some(b=>b.tier==='large'&&b.state==='swimming'&&Math.hypot(t.x-b.x,t.y-b.y)<2.9))).sort((a,b)=>Number(b.characterId==='original')-Number(a.characterId==='original'));
     return evaluate(`(()=>{const canvas=document.querySelector('canvas'),r=canvas.getBoundingClientRect();for(const girl of ${JSON.stringify(candidates)}){const p={x:r.left+(girl.x/17.77777778+.5)*r.width,y:r.top+(.5-girl.y/10)*r.height};if(document.elementFromPoint(p.x,p.y)===canvas)return p;}return null;})()`);
   },'unobscured target',15000);
   await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1},sessionId);
   await sleep(50);
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',buttons:0,clickCount:1},sessionId);
 }
 await shootSmall();
 await waitFor(async()=>{const x=await state();return x.stats.won>0&&x.pendingWin>0;},'natural win and collecting hearts');
 const won=(await state()).stats.won;
 await shootSmall();
 await waitFor(async()=>(await state()).stats.spent>=12,'can wager during non-large win');
 await waitFor(async()=>{const x=await state();return x.reservedWager===0&&x.pendingWin===0&&(await meta()).ready;},'post-win wallet refresh completes');
 assert.equal((await state()).platform.packetError,'');
 const originalSmallCaptured=await evaluate(`__walletQa.history.some(entry=>entry.name==='settle'&&entry.out.result.rounds?.some(round=>round.targets.some(target=>target.captured&&entry.input.rounds.find(r=>r.roundId===round.roundId)?.targets.some(t=>t.id===target.id&&t.characterId==='original'&&t.tier==='small'))))`);
 assert(originalSmallCaptured,'the original non-video small capture regression is exercised');
 assert(!(await evaluate('__walletQa.read().state.profiles.paid.unlockedClipIds')).includes('original-classic-small'));
 await click('[data-action=WeaponLike]');await sleep(150);
 await evaluate('__walletQa.setBalance(0)');
 await waitFor(async()=>(await state()).displayBalance===0&&(await meta()).ready,'zero balance reconciles');
 await click('[data-action=Fire]');
 await waitFor(()=>evaluate(`document.querySelector('.hc-platform-notice')?.dataset.code==='insufficientFunds'`),'insufficient funds notice');
 const insufficient=await evaluate(`document.querySelector('.hc-platform-notice').textContent`);
 assert(insufficient.includes('0')&&insufficient.includes('1'));
 await waitFor(()=>evaluate('__walletQa.notices.length===1'),'manual insufficient-funds platform alert');
 await click('[data-action=ToggleAuto]');await sleep(300);
 assert.equal(await evaluate('__walletQa.notices.length'),1,'AUTO does not repeatedly open platform dialogs');
 if((await state()).auto)await click('[data-action=ToggleAuto]');
 await evaluate('__walletQa.setBalance(61)');
 await waitFor(async()=>(await state()).displayBalance===61&&(await meta()).ready,'positive balance reconciles');
 await evaluate('__walletQa.roll=.999;__walletQa.replaceSession()');
 await click('[data-action=WeaponFlower]');await sleep(150);await shootSmall({unrestricted:true});
 await waitFor(async()=>{const value=await meta();return value.lastError==='staleSession'&&value.status==='error';},'stale session classified and reservations drained');
 await waitFor(()=>evaluate(`document.querySelector('.hc-platform-notice')?.dataset.code==='staleSession'`),'persistent reconnect notice');
 const stale=await evaluate(`document.querySelector('.hc-platform-notice').textContent`);
 assert(stale.includes('重新連線'));
 assert.equal(await evaluate(`document.querySelector('[data-value=balance]').textContent`),'待同步');
 const bootBefore=await evaluate('window.__walletQa.bootId');
 await waitFor(()=>evaluate(`document.querySelector('[data-ui=platform-reconnect]')?.disabled===false`),'reconnect enabled after refund acknowledgement');
 await click('[data-ui=platform-reconnect]');
 await waitFor(()=>evaluate(`Boolean(window.__walletQa?.bootId && window.__walletQa.bootId!==${JSON.stringify(bootBefore)} && window.hotChickDebug?.ready)`),'reconnected player boot');
 await waitFor(async()=>(await meta()).ready&&!(await state()).platform.paused,'paid ledger restored after reconnect');
 assert.equal((await state()).displayBalance,61);
 assert.equal((await state()).platform.packetError,'');assert.deepEqual(errors,[]);
 const image=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);
 await fs.writeFile('artifacts/goldsaucer/qa/browser-blocked-restored.png',Buffer.from(image.data,'base64'));
 const report={passed:true,scope:'Official player and production functions, synthetic paid ledger only',checks:['61 chips base1 bootstrap','original non-video small capture and no unavailable unlock','natural win and wager during collection','win then wallet refresh releases gate','zero balance manual-fire notice','one platform alert for manual insufficient funds; AUTO does not spam','external balance update','stale-session classification and persistent reconnect notice','reconnect restores authoritative chips'],won,originalSmallCaptured,insufficient,stale,errors};
 await fs.writeFile('artifacts/goldsaucer/qa/browser-blocked.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(targetId)await cdp.send('Target.closeTarget',{targetId});cdp.close();}

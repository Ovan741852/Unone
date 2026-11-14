import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CdpClient} from './cdp-client.mjs';
import {startRoomsFixture} from './qa-rooms-fixture.mjs';

const base=new URL(process.argv[2]||'http://127.0.0.1:8253/release-036/');base.searchParams.set('debug','1');
const fixture=await startRoomsFixture(),cdp=await CdpClient.connect(9237),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clients=[],errors=[];
const mockSdk=(id,name)=>`(()=>{
 const origin=${JSON.stringify(fixture.origin)},userId=${JSON.stringify(id)},name=${JSON.stringify(name)},events=new Map();
 const emit=(type,data)=>{for(const cb of events.get(type)||[])cb(data);};
 async function request(path,data){const r=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Object.assign(Error(v.message||v.error||'fixture failure'),{code:v.code||v.error});return v;}
 window.GoldSaucer={async init(){return{user:{id:userId,username:userId,displayName:name},trial:false,preview:true,multiplayer:true,game:{id:'fixture-game',slug:'heart-king'}};},async getUser(){return{id:userId,displayName:name};},async getBalance(){return 0;},
 on(type,cb){const s=events.get(type)||new Set();s.add(cb);events.set(type,s);return()=>s.delete(cb);},
 server:{async call(method,input){const out=await request('/call',{userId,name,method,input});emit('chipsChanged',{chips:out.chips});return out;}},
 chips:{async get(){return{chips:0,currency:{name:'心動幣',perDiamond:50}};},async buyIn(){throw Error('unexpected wallet action');},async cashOut(){throw Error('unexpected wallet action');}},
 multiplayer:{async join(options={}){const joined=await request('/join',{userId,name,room:options.room}),listeners=new Map(),closed=new Set(),failures=new Set();let left=false;
 const source=new EventSource(origin+'/events?connectionId='+encodeURIComponent(joined.you));
 source.onmessage=e=>{const message=JSON.parse(e.data);if(message.type==='__close'){source.close();left=true;for(const cb of closed)cb(message.data);return;}for(const cb of listeners.get(message.type)||[])cb(message.data);};
 source.onerror=()=>{if(!left){left=true;source.close();for(const cb of closed)cb('fixture stream closed');}};
 return{id:joined.id,you:joined.you,send(type,data){if(!left)void request('/send',{connectionId:joined.you,type,data}).catch(e=>{for(const cb of failures)cb(e.code,e.message);});},on(type,cb){const s=listeners.get(type)||new Set();s.add(cb);listeners.set(type,s);return()=>s.delete(cb);},onClose(cb){closed.add(cb);},onError(cb){failures.add(cb);},leave(){if(left)return;left=true;source.close();void request('/leave',{connectionId:joined.you});for(const cb of closed)cb('left');}};
 }} };
})();`;
async function until(read,label,timeout=35000){const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await read();if(value)return value;}catch(e){if(!/context.*destroy|Cannot find context/i.test(e.message))throw e;}await sleep(80);}const states=await Promise.all(clients.map(c=>c.eval('window.hotChickDebug?{room:hotChickDebug.snapshot().room,platform:hotChickDebug.metadata().platform}:document.body.innerText')));throw Error(label+': '+JSON.stringify(states));}
async function createClient(id,name){
 const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank',newWindow:true});
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
 await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:mockSdk(id,name)},sessionId);
 const c={id,name,targetId,sessionId,eval:expression=>cdp.evaluate(sessionId,expression)};
 c.state=()=>c.eval('hotChickDebug.snapshot()');c.rooms=()=>c.eval('hotChickDebug.metadata().platform.rooms');
 c.click=selector=>c.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);clients.push(c);
 cdp.listeners.add(event=>{if(event.sessionId===sessionId&&event.method==='Runtime.exceptionThrown')errors.push({id,detail:event.params.exceptionDetails});});
 await cdp.send('Page.navigate',{url:base.href},sessionId);
 await until(()=>c.eval(`Boolean(window.hotChickDebug?.ready&&hotChickDebug.metadata().platform.rooms?.enabled&&hotChickDebug.metadata().platform.server.ready&&!hotChickDebug.metadata().platform.paused&&!hotChickDebug.snapshot().platform.paused)`),'official multiplayer boot '+id);
 return c;
}
async function connected(c,roomId=null){await until(async()=>{const m=await c.rooms(),s=await c.state();return m.status==='connected'&&(!roomId||m.roomId===roomId)&&s.room?.enabled&&!s.room?.switching;},'shared room connected '+c.id);}
async function fireAt(c,target){
 const p=await c.eval(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.left+(${target.x}/17.77777778+.5)*r.width,y:r.top+(.5-${target.y}/10)*r.height};})()`);
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',buttons:1,clickCount:1},c.sessionId);await sleep(45);await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',buttons:0,clickCount:1},c.sessionId);
}
try{
 const a=await createClient('qa-alice','測試玩家 Alice');await until(()=>a.eval(`(()=>{const b=document.querySelector('[data-ui=room-create]');return Boolean(b&&!b.disabled&&!b.closest('[inert]')&&b.offsetParent);})()`),'create room entry');
 await a.click('[data-ui=room-create]');await connected(a);const roomId=(await a.rooms()).roomId;
 const b=await createClient('qa-betty','測試玩家 Betty');
 await until(()=>b.eval(`Boolean(document.querySelector('[data-ui=room-join][data-room-id="${roomId}"]'))`),'existing room listed');
 await b.click(`[data-ui=room-join][data-room-id="${roomId}"]`);await connected(b,roomId);
 await until(async()=>(await a.rooms()).playerCount===2&&(await b.rooms()).playerCount===2,'two authenticated players share the roster');
 const sa=await a.state(),sb=await b.state();
 const targets=value=>Object.values(value.targets).filter(t=>t.state==='swimming').sort((x,y)=>Number(x.id)-Number(y.id));
 assert.equal(targets(sa).length,27);assert.deepEqual(targets(sa).map(t=>[t.id,t.characterId,t.tier]),targets(sb).map(t=>[t.id,t.characterId,t.tier]));
 assert.notEqual((await a.rooms()).selfSeat,(await b.rooms()).selfSeat);
 const target=targets(sa).find(t=>t.tier==='small'&&Math.abs(t.x)<4&&t.y>-.6&&t.y<2.6);assert(target,'unobscured shared target');
 await Promise.all([fireAt(a,target),fireAt(b,target)]);
 await until(()=>{const s=fixture.stats();return s.calls.some(c=>c.method==='settle');},'at least one natural shared wager');
 await until(async()=>{const x=await a.state(),y=await b.state();return x.reservedWager===0&&y.reservedWager===0&&x.pendingWin===0&&y.pendingWin===0;},'natural shots and heart credits drain',45000);
 const shotState=await a.state();assert.equal(shotState.platform.packetError,'');assert.equal((await b.state()).platform.packetError,'');
 const captureKeys=new Set();let totalSpent=0,totalWon=0;
 const seenBatches=new Set();
 for(const call of fixture.stats().calls.filter(c=>c.method==='settle'&&c.result?.ok)){
  const key=[call.userId,call.input.session,call.input.batchId].join(':');if(seenBatches.has(key))continue;seenBatches.add(key);
  totalSpent+=call.result.bet;totalWon+=call.result.win;
  for(const round of call.result.rounds)for(const award of round.targets||[])if(award.captured){const id=call.input.roomId+':'+award.id;assert(!captureKeys.has(id),'a canonical target generation can pay only once');captureKeys.add(id);}
 }
 assert(captureKeys.size>0,'the browser exercised a real captured target');
 assert.equal((await a.state()).balance+(await b.state()).balance,20000-totalSpent+totalWon,'both wallets reconcile to accepted bets and awards');
 await until(()=>a.eval('Boolean(hotChickDebug.metadata().platform.server.ready&&hotChickDebug.metadata().platform.server.pendingPackets===0&&hotChickDebug.snapshot().room.drainReady)'),'financial and presentation state fully drained');
 const before=await a.state(),firstSession=before.platform.session;
 await a.click('[data-ui=room-open]');await until(()=>a.eval(`Boolean(document.querySelector('[data-ui=room-create]'))`),'switch room menu');await a.click('[data-ui=room-create]');
 await until(async()=>{const m=await a.rooms();return m.status==='connected'&&m.roomId!==roomId;},'create and switch to a second room');
 await until(async()=>(await b.rooms()).playerCount===1,'old room removes the departed player');
 const after=await a.state();assert.equal(after.displayBalance,before.displayBalance);assert.equal(after.balance,before.balance);assert.deepEqual(after.cards,before.cards);assert.equal(after.platform.session,firstSession);
 await a.click('[data-ui=room-open]');await until(()=>a.eval(`Boolean(document.querySelector('[data-ui=room-join][data-room-id="${roomId}"]'))`),'old room remains in the directory');await a.click(`[data-ui=room-join][data-room-id="${roomId}"]`);await connected(a,roomId);
 await until(async()=>(await b.rooms()).playerCount===2,'rejoining restores both players');
 assert.deepEqual(errors,[]);
 const metrics=fixture.stats();assert.equal(metrics.walletActions||0,0);
 for(const id of ['qa-alice','qa-betty'])assert.equal(metrics.calls.filter(c=>c.userId===id&&c.method==='open').length,1,'switching does not reopen the financial session');
 const screenshot=await cdp.send('Page.captureScreenshot',{format:'png'},a.sessionId);await fs.writeFile('artifacts/goldsaucer/qa/rooms-browser.png',Buffer.from(screenshot.data,'base64'));
 const report={passed:true,scope:'Two official Unone players, actual production functions and room script, synthetic SDK and virtual preview profiles only',roomId,checks:['room directory/create/join','two authenticated roster members and distinct seats','identical canonical27 targets','natural shared shooting and settlement','one payout per captured generation and reconciled wallets','room switch preserves wallet/cards/session','old-room leave and rejoin'],stats:metrics,errors,realCurrencyActions:0};
 await fs.writeFile('artifacts/goldsaucer/qa/rooms-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks:report.checks,roomId,realCurrencyActions:0}));
}finally{for(const c of clients)await cdp.send('Target.closeTarget',{targetId:c.targetId});cdp.close();await fixture.close();}

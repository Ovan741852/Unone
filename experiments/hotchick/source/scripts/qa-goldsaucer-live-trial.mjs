import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CdpClient} from './cdp-client.mjs';

const address=new URL(process.argv[2]);
assert.equal(address.hostname,'goldsaucer.ovan929.chatgpt.site');
assert(address.pathname.startsWith('/play-content/'));
address.searchParams.set('trial','1');address.searchParams.set('debug','1');
const cdp=await CdpClient.connect(9237),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let targetId,sessionId;const errors=[],apiRequests=[];
const evaluate=expression=>cdp.evaluate(sessionId,expression);
async function until(read,label){const deadline=Date.now()+45000;while(Date.now()<deadline){try{const value=await read();if(value)return value;}catch(error){if(!/context.*destroy|Cannot find context/i.test(error.message))throw error;}await sleep(100);}throw Error(label+': '+JSON.stringify(await evaluate(`window.hotChickDebug?{trial:hotChickDebug.snapshot().trial,balance:hotChickDebug.snapshot().displayBalance,nativePlatform:hotChickDebug.snapshot().platform,platform:hotChickDebug.metadata().platform,hudInert:document.querySelector('.hc-hud')?.inert}:document.body.innerText`)));}
try{
 ({targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}));
 ({sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));
 await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);await cdp.send('Network.enable',{},sessionId);await cdp.send('Debugger.enable',{},sessionId);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
 cdp.listeners.add(event=>{if(event.sessionId!==sessionId)return;if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails);if(event.method==='Network.requestWillBeSent'){const u=new URL(event.params.request.url);if(u.hostname===address.hostname&&u.pathname.startsWith('/api/'))apiRequests.push({method:event.params.request.method,path:u.pathname});}});
 await cdp.send('Page.navigate',{url:address.href},sessionId);
 await until(()=>evaluate('Boolean(window.hotChickDebug?.ready&&hotChickDebug.metadata().platform.trial&&!hotChickDebug.snapshot().platform.paused)'),'deployed trial player');
 const initial=await evaluate('({state:hotChickDebug.snapshot(),platform:hotChickDebug.metadata().platform,sdk:typeof GoldSaucer})');
 assert.equal(initial.platform.source,'standalone');assert.equal(initial.platform.enabled,false);assert.equal(initial.state.platform.enabled,false);assert.equal(initial.state.displayBalance,10000);assert.equal(initial.sdk,'object');
 assert.equal(await evaluate(`document.querySelector('[data-ui=platform-wallet]').hidden`),true);
 assert.equal(await evaluate(`document.querySelector('[data-ui=trial-refill]')`),null);
 const p=await evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.left+(.6/17.77777778+.5)*r.width,y:r.top+.935*r.height};})()`);
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',buttons:1,clickCount:1},sessionId);await sleep(50);await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',buttons:0,clickCount:1},sessionId);
 await until(()=>evaluate('hotChickDebug.snapshot().displayBalance<10000'),'local trial shot');
 assert.equal(await evaluate('hotChickDebug.snapshot().displayBalance===10000-hotChickDebug.snapshot().reservedWager'),true);
 await until(()=>evaluate('hotChickDebug.snapshot().reservedWager===0'),'local refund');
 assert.equal(await evaluate('hotChickDebug.snapshot().displayBalance'),10000);
 const appErrors=[],infrastructureWarnings=[],diagnostics=[];
 for(const e of errors){const script=await cdp.send('Debugger.getScriptSource',{scriptId:e.scriptId},sessionId);diagnostics.push({error:e,source:script.scriptSource});if(script.scriptSource.includes('window.__CF$cv$params')&&script.scriptSource.includes('/cdn-cgi/challenge-platform/')&&e.exception?.className==='DOMException'&&e.exception.description?.startsWith('SecurityError:'))infrastructureWarnings.push({source:'Cloudflare challenge injection',message:e.exception.description});else appErrors.push(e);}
 if(diagnostics.length)await fs.writeFile('artifacts/goldsaucer/qa/trial-deployed-errors.json',JSON.stringify(diagnostics,null,2));
 assert.deepEqual(appErrors,[]);assert.deepEqual(apiRequests,[]);
 const result={passed:true,url:address.href.replace('&debug=1',''),initialBalance:10000,noRefillControl:true,noAutomaticRefill:true,platformSdkInjected:true,source:initial.platform.source,platformApiRequests:apiRequests,appErrors,infrastructureWarnings,realCurrencyActions:0};
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);await fs.writeFile('artifacts/goldsaucer/qa/trial-deployed.png',Buffer.from(shot.data,'base64'));
 await fs.writeFile('artifacts/goldsaucer/qa/trial-deployed.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(targetId)await cdp.send('Target.closeTarget',{targetId});cdp.close();}

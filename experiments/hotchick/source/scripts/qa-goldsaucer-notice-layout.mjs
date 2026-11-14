import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CdpClient} from './cdp-client.mjs';
const cdp=await CdpClient.connect(9237);let targetId,sessionId;
try{
 ({targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}));({sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true}));
 await cdp.send('Page.enable',{},sessionId);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
 await cdp.send('Page.navigate',{url:'http://127.0.0.1:8253/release-031/?debug=1'},sessionId);
 const deadline=Date.now()+30000;while(!await cdp.evaluate(sessionId,'Boolean(window.hotChickDebug?.ready)')){if(Date.now()>deadline)throw Error('player boot timeout');await new Promise(r=>setTimeout(r,80));}
 const result=await cdp.evaluate(sessionId,`(()=>{const original=document.querySelector('.hc-platform-notice'),fixture=original.cloneNode(true);fixture.dataset.qaFixture='true';fixture.hidden=false;fixture.dataset.passive='true';fixture.dataset.tone='info';fixture.querySelector('.hc-platform-notice-title').textContent='投注同步中';fixture.querySelector('.hc-platform-notice-message').textContent='等待在途回合完成。';fixture.querySelector('button').hidden=true;original.parentElement.append(fixture);const r=fixture.getBoundingClientRect(),style=getComputedStyle(fixture);return{left:r.left,top:r.top,width:r.width,height:r.height,pointerEvents:style.pointerEvents,canvasReceivesPointer:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.tagName==='CANVAS'};})()`);
 assert(result.width<384&&result.left<60&&result.top>500);assert.equal(result.pointerEvents,'none');assert.equal(result.canvasReceivesPointer,true);
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);await fs.writeFile('artifacts/goldsaucer/qa/passive-notice-layout.png',Buffer.from(shot.data,'base64'));
 await cdp.evaluate(sessionId,`document.querySelector('[data-qa-fixture=true]').remove()`);
 const report={passed:true,scope:'Passive notice DOM layout fixture in the official player; gameplay state untouched',...result};await fs.writeFile('artifacts/goldsaucer/qa/passive-notice-layout.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(targetId)await cdp.send('Target.closeTarget',{targetId});cdp.close();}

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {CdpClient} from './cdp-client.mjs';

const url=process.argv[2]||'http://127.0.0.1:8241/release-018/';
const out='artifacts/playable/qa-ui-polish';fs.mkdirSync(out,{recursive:true});
const cdp=await CdpClient.connect(),errors=[],checks=[],evidence={},targets=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),vals=x=>Object.values(x||{});
const wait=async(fn,label,ms=8000)=>{const end=Date.now()+ms;while(Date.now()<end){const x=await fn();if(x)return x;await sleep(30)}throw Error(label)};
async function page(address){
 const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});targets.push(targetId);
 const {sessionId:s}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
 cdp.listeners.add(e=>{if(e.sessionId===s&&e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails)});
 await cdp.send('Runtime.enable',{},s);await cdp.send('Page.enable',{},s);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},s);await cdp.send('Page.navigate',{url:address},s);
 const ev=x=>cdp.evaluate(s,x);
 await wait(()=>ev('document.body.dataset.hotChickReady==="true"'),'game ready',45000);
 const click=async sel=>{const p=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p},s);await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1},s);await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1},s);await sleep(160)};
 const key=async(code,key,windowsVirtualKeyCode)=>{await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code,key,windowsVirtualKeyCode},s);await sleep(45);await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code,key,windowsVirtualKeyCode},s);await sleep(130)};
 const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'},s);fs.writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))};
 return {s,ev,click,key,shot,state:()=>ev('window.hotChickDebug.snapshot()'),meta:()=>ev('window.hotChickDebug.metadata()')};
}
try{
 const normal=await page(url);let {ev,click,key,shot}=normal;
 assert.equal(await ev('typeof window.hotChickDebug'),'undefined');
 assert.equal(await ev('document.querySelectorAll(".hc-field-hint,.hc-seat,.hc-preview,.hc-round-rate,.hc-demo,[data-ui=tools],[data-action^=Preview],[data-action=DemoReset]").length'),0);
 assert.equal(await ev('document.querySelectorAll(".hc-weapons button").length'),3);assert(await ev('Boolean(document.querySelector("[data-ui=help]"))'));
 await shot('after-normal-1280');checks.push('normal mode has no debug bridge, preview/reset controls, rate strip, idle instructions or empty-seat labels');
 await click('[data-ui="help"]');await wait(()=>ev('!document.querySelector(".hc-modal").hidden'),'help opens');assert((await ev('document.querySelector(".hc-modal-body").textContent')).includes('底注'));
 const beforeHelp=await ev('document.querySelector("[data-value=balance]").textContent');await key('KeyA','a',65);await key('KeyL','l',76);
 await ev('(()=>{const p=document.querySelector(".hc-help-intro");p.tabIndex=-1;p.focus()})()');await key('Space',' ',32);assert.equal(await ev('document.querySelector("[data-value=balance]").textContent'),beforeHelp);
 await ev('document.querySelector(".hc-close").focus()');await key('Tab','Tab',9);assert(await ev('document.querySelector(".hc-modal").contains(document.activeElement)'));
 await shot('help');await click('[data-ui="close-gallery"]');await sleep(450);assert.equal(await ev('document.querySelector("[data-value=balance]").textContent'),beforeHelp);checks.push('help is on demand, traps focus and A/L/Space cannot arm hidden shooting or resume after close');
 await click('[data-ui="gallery"]');await wait(()=>ev('document.querySelector(".hc-modal-card").classList.contains("is-gallery")'),'gallery');
 const layouts=[];
 for(const [width,height] of [[1280,720],[1024,576],[1920,1080],[844,390]]){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},normal.s);await sleep(150);
  for(const character of ['jiayi','mugi','original']){
   await click(`[data-gallery-character="${character}"]`);
   const r=await ev('(()=>{const b=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};const g=document.querySelector(".hc-game-ui"),c=document.querySelector(".hc-modal-card"),m=document.querySelector(".hc-gallery-main");return{game:b(g),card:b(c),overflow:m.scrollWidth-m.clientWidth}})()');assert(Math.abs(r.card.width-r.game.width*.88)<1);assert(Math.abs(r.card.height-r.game.height*.88)<1);assert(r.overflow<=1);layouts.push({width,height,character,...r});
  }
  await click('[data-gallery-character="jiayi"]');await shot(`gallery-${width}`);
 }
 evidence.layouts=layouts;checks.push('fixed 88% gallery retains all three characters and readable scroll panes across four landscape sizes');
 await cdp.send('Target.closeTarget',{targetId:targets.shift()});
 const debugUrl=new URL(url);debugUrl.searchParams.set('debug','1');const debug=await page(debugUrl.href);({ev,click,key,shot}=debug);const {state,meta}=debug;
 assert.equal(await ev('typeof window.hotChickDebug'),'object');assert.equal(await ev('document.querySelectorAll("[data-action^=Preview],[data-action=DemoReset]").length'),0);
 const tapWorld=async(x,y)=>{const p=await ev(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.left+((${x})/17.77777778+.5)*r.width,y:r.top+(.5-(${y})/10)*r.height}})()`);const before=await state();await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p},debug.s);await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1},debug.s);await wait(async()=>(await state()).stats.shots>before.stats.shots,'paid round fires');await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1},debug.s);await sleep(100);return {before,after:await state()}};
 for(const [weapon,mult] of [['like',1],['flower',6],['rocket',15]]){
  await click(`[data-weapon="${weapon}"]`);await wait(async()=>(await state()).canShoot,'weapon ready');const g=await state();let target={x:.8,y:-4.349};if(weapon!=='like')target=vals(g.targets).filter(t=>t.state==='swimming'&&t.tier==='small'&&Math.abs(t.x)<6.4&&Math.abs(t.y)<2.6).sort((a,b)=>a.y-b.y)[0];assert(target);const r=await tapWorld(target.x,target.y);assert.equal(r.after.stats.spent-r.before.stats.spent,(r.after.stats.shots-r.before.stats.shots)*r.before.bet*mult);
 }
 checks.push('actual field shooting preserves ×1/×6/×15 charging');
 const openTools=async()=>{await click('[data-ui="tools"]');await wait(async()=>(await state()).galleryOpen,'tools model');await wait(()=>ev('Boolean(document.querySelector(".hc-tools"))'),'tools content')};
 const reset=async()=>{await wait(async()=>{const x=await state();if(!x.reveal)return true;if(x.reveal.stage==='intro')await click('.hc-reveal-intro [data-ui="close-reveal"]');else if(x.reveal.stage==='video')await click('.hc-reveal [data-ui="close-reveal"]');return false},'finish active large reveal',16000);await openTools();await click('[data-action="DemoReset"]');await wait(async()=>{const x=await state();return x.stats.spent===0&&!x.galleryOpen&&vals(x.mediumReveals).length===0&&!x.reveal},'reset');await sleep(250)};
 // Real reset also clears any earlier in-flight captures before preview checks.
 await reset();assert.equal((await state()).displayBalance,10000);checks.push('debug reset restores Luau wallet and clears active presentations');
 await click('[data-action="ToggleAuto"]');await sleep(300);await click('[data-ui="help"]');await wait(async()=>(await state()).galleryOpen,'debug help');let x=await state();assert(!x.auto&&!x.lock);await key('KeyA','a',65);await key('KeyL','l',76);await ev('(()=>{const p=document.querySelector(".hc-help-intro");p.tabIndex=-1;p.focus()})()');await key('Space',' ',32);assert.equal((await state()).stats.spent,x.stats.spent);assert(!(await state()).auto&&!(await state()).lock);await click('[data-ui="close-gallery"]');await sleep(350);assert.equal((await state()).stats.spent,x.stats.spent);await reset();
 await openTools();await shot('debug-tools');assert((await ev('document.querySelector("[data-tool-stat=rate]").textContent')).includes('輪'));await click('[data-ui="preview-stack"]');
 const six=await wait(async()=>{const m=await meta();return m.activeMediumDecoders===6&&vals(m.mediumPlayers).filter(p=>!p.released&&p.currentTime>.05&&!p.paused).length===6?m:null},'six medium previews',11000);assert((await state()).canShoot);assert.equal((await state()).stats.spent,0);assert.equal((await state()).stats.won,0);await shot('six-mediums');await sleep(200);const advanced=await meta();for(const p of vals(six.mediumPlayers).filter(p=>!p.released)){const q=vals(advanced.mediumPlayers).find(q=>q.serial===p.serial);assert(q&&q.currentTime>p.currentTime+.05)}
 const pass=await ev('(()=>{const p=document.querySelector(".hc-medium-picture"),r=p.getBoundingClientRect(),x=r.left+8,y=r.bottom-8;return{x,y,tag:document.elementFromPoint(x,y)?.tagName}})()');assert.equal(pass.tag,'CANVAS');evidence.six=six;checks.push('six independently advancing previews have no payout and keep their video bodies click-through');
 await reset();await sleep(800);assert.equal((await meta()).activeMediumDecoders,0);assert.equal(vals((await state()).mediumReveals).length,0);checks.push('reset cancels pending preview intents and releases all six players');
 await openTools();await click('[data-action="PreviewLarge"]');await wait(async()=>{const m=await meta();return m.reveal?.stage==='video'&&m.video.currentTime>.2&&m.largeVideoFade.phase==='complete'},'large fade',10000);await shot('large-preview');assert.equal((await state()).stats.spent,0);assert.equal((await state()).stats.won,0);await click('.hc-reveal [data-ui="close-reveal"]');await wait(async()=>!(await state()).reveal,'large cleanup',7000);assert.equal((await state()).displayBalance,10000);checks.push('tools preview closes the modal first; large intro/fade/heart collection remain zero-credit');
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},debug.s);await click('[data-ui="help"]');const motion=await ev('getComputedStyle(document.querySelector(".hc-modal-card")).animationName');assert.equal(motion,'none');await click('[data-ui="close-gallery"]');evidence.reducedMotion=motion;
 x=await state();assert.equal(x.balance,x.displayBalance+x.pendingWin);assert.equal(errors.length,0);checks.push('reduced-motion preference is respected; wallet conserved; no uncaught browser exceptions');
 fs.writeFileSync(`${out}/ui-polish-acceptance.json`,JSON.stringify({url,debugUrl:debugUrl.href,checks,evidence,errors,final:x},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(error){fs.writeFileSync(`${out}/failure.json`,JSON.stringify({error:String(error),checks,errors},null,2));throw error}
finally{for(const targetId of targets)await cdp.send('Target.closeTarget',{targetId}).catch(()=>{});cdp.close()}

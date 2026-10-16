const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
const {chromium}=require('C:/Users/maverickchiu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url='http://127.0.0.1:8344/?sdk=fresh-ui-verified';
const flatten=(node)=>[node,...(node.children||[]).flatMap(flatten)];
const nodeById=(snapshot,id)=>flatten(snapshot.world.ui).find(n=>n.id===id);
const center=(rect,viewport,fraction=.5)=>({x:(rect.x+rect.width*fraction)*viewport.width/100,y:(100-rect.y-rect.height/2)*viewport.height/100});
const observation=page=>page.evaluate(()=>{const e=window.__mimeQaWasm.find(i=>i.exports.unone_web_observation_ptr).exports;return JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.unone_web_observation_ptr(),e.unone_web_observation_len())));});
const summary=s=>({frame:s.world.frame,tick:s.world.observations.tick,settings:s.world.observations.settings,input_probe:s.world.observations.input_probe,layout:s.world.observations.layout,virtual:nodeById(s,'presets/list')?.scroll?.virtual_items});
async function captureWasm(context){await context.addInitScript(()=>{
  Object.defineProperty(window,'__mimeQaWasm',{value:[],enumerable:false});
  const capture=r=>{const i=r?.instance||r;if(i?.exports&&!window.__mimeQaWasm.includes(i))window.__mimeQaWasm.push(i);return r;};
  const original=WebAssembly.instantiate.bind(WebAssembly);WebAssembly.instantiate=(...a)=>original(...a).then(capture);
  if(WebAssembly.instantiateStreaming){const streaming=WebAssembly.instantiateStreaming.bind(WebAssembly);WebAssembly.instantiateStreaming=(...a)=>streaming(...a).then(capture);}
});}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const report={url,phase:'after',observer:'Only calls unone_web_observation_ptr/len and reads exported memory; every interaction uses Playwright mouse. No game ABI mutator called.',runs:[]};
 for(const viewport of [{width:1440,height:900},{width:1020,height:884},{width:390,height:844}]){
  const label=`${viewport.width}x${viewport.height}`;
  const run={viewport,responses:[],console:[],pageErrors:[],requestFailures:[],snapshots:{},assertions:[]};report.runs.push(run);
  const context=await browser.newContext({viewport,deviceScaleFactor:1});await captureWasm(context);const page=await context.newPage();
  page.on('response',r=>run.responses.push({url:r.url(),status:r.status(),contentType:r.headers()['content-type']||null,cacheControl:r.headers()['cache-control']||null}));
  page.on('console',m=>run.console.push({type:m.type(),text:m.text()}));
  page.on('pageerror',e=>run.pageErrors.push(String(e)));
  page.on('requestfailed',r=>run.requestFailures.push({url:r.url(),error:r.failure()}));
  const check=(condition,message)=>{run.assertions.push({pass:!!condition,message});assert.ok(condition,message);};
  try{
   await page.goto(url,{waitUntil:'networkidle',timeout:30000});
   await page.waitForFunction(()=>document.body.dataset.playerRenderer==='official'&&Number(document.body.dataset.playerFrame)>5&&window.__mimeQaWasm.some(i=>i.exports.unone_web_observation_ptr),{timeout:15000});
   let initial=await observation(page);run.snapshots.initial=summary(initial);
   run.boot=await page.evaluate(()=>({title:document.title,renderer:document.body.dataset.playerRenderer,frame:Number(document.body.dataset.playerFrame),metrics:JSON.parse(document.body.dataset.playerMetrics||'null'),status:document.querySelector('#status')?.textContent,canvases:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,width:c.width,height:c.height})),fatal:document.body.dataset.playerFatal||document.querySelector('[data-player-error]')?.textContent||null}));
   check(run.boot.renderer==='official'&&run.boot.metrics?.renderer==='three-webgl','Official three-webgl renderer booted');
   check(initial.project==='Harbor Settings'&&flatten(initial.world.ui).some(n=>n.id==='probe/hold'),'WASM observation includes rendered public UI tree');
   await page.waitForTimeout(200);let progressed=await observation(page);run.snapshots.progress=summary(progressed);
   check(progressed.world.frame>initial.world.frame&&progressed.world.observations.tick>initial.world.observations.tick,'Real WASM frame and game tick advance');
   const hold=center(nodeById(progressed,'probe/hold').rect,viewport);run.holdCoordinates=hold;
   await page.mouse.move(hold.x,hold.y);await page.mouse.down();await page.waitForTimeout(350);
   const held=await observation(page);run.snapshots.held=summary(held);const hp=held.world.observations.input_probe;
   check(hp.held&&hp.presses===1&&hp.releases===0&&hp.hold_ticks>0,'One real mouse press remains held for multiple WASM ticks');
   await page.mouse.up();await page.waitForTimeout(150);let released=await observation(page);run.snapshots.released=summary(released);const rp=released.world.observations.input_probe;
   check(!rp.held&&rp.presses===1&&rp.releases===1&&rp.reader_a_presses===1&&rp.reader_b_presses===1&&rp.reader_a_releases===1&&rp.reader_b_releases===1&&rp.mismatches===0,'One release observed exactly once by both readers without mismatch');
   const slider=nodeById(released,'audio/level');const dragStart=center(slider.rect,viewport,.72);const dragEnd=center(slider.rect,viewport,.23);run.sliderCoordinates={dragStart,dragEnd};
   await page.mouse.move(dragStart.x,dragStart.y);await page.mouse.down();await page.mouse.move(dragEnd.x,dragEnd.y,{steps:12});await page.waitForTimeout(100);await page.mouse.up();await page.waitForTimeout(150);
   let adjusted=await observation(page);run.snapshots.slider=summary(adjusted);
   check(adjusted.world.observations.settings.volume!==released.world.observations.settings.volume&&adjusted.world.observations.settings.volume<40,'Real slider drag changes WASM setting');
   const combo=center(nodeById(adjusted,'quality/choice').rect,viewport);await page.mouse.click(combo.x,combo.y);await page.waitForTimeout(150);
   const expanded=await observation(page);run.snapshots.expanded=summary(expanded);
   check(expanded.world.observations.settings.expanded,'Real click expands combobox');
   const studio=flatten(expanded.world.ui).find(n=>n.action&&(/Studio/i.test(n.action)||/^Studio/.test(n.text||'')));
   check(!!studio,'Studio option is present in public UI tree');run.studioOption={id:studio.id,action:studio.action,rect:studio.rect};
   const studioPoint=center(studio.rect,viewport);await page.mouse.click(studioPoint.x,studioPoint.y);await page.waitForTimeout(150);
   const selected=await observation(page);run.snapshots.studio=summary(selected);
   check(selected.world.observations.settings.quality==='Studio'&&!selected.world.observations.settings.expanded,'Real click selects Studio and collapses combobox');
   const list=nodeById(selected,'presets/list');const wheelPoint=center(list.rect,viewport);run.wheelCoordinates=wheelPoint;
   const nativeBefore=await page.locator('[data-ui-scrollbar="presets/list"][data-axis="y"]').evaluate(e=>({scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}));
   await page.mouse.move(wheelPoint.x,wheelPoint.y);await page.mouse.wheel(0,560);await page.waitForTimeout(350);
   const scrolled=await observation(page);run.snapshots.scrolled=summary(scrolled);
   const nativeAfter=await page.locator('[data-ui-scrollbar="presets/list"][data-axis="y"]').evaluate(e=>({scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}));run.wheel={nativeBefore,nativeAfter};
   check(nativeAfter.scrollTop>nativeBefore.scrollTop&&nodeById(scrolled,'presets/list').scroll.virtual_items.first>list.scroll.virtual_items.first,'Real wheel scroll changes native scroll offset and WASM virtual range');
   const scriptResponses=run.responses.filter(r=>/\.(?:m?js)(?:\?|$)/i.test(r.url));const wasmResponses=run.responses.filter(r=>/\.wasm(?:\?|$)/i.test(r.url));
   run.mime={javascriptResponses:scriptResponses.length,wasmResponses:wasmResponses.length,bad:scriptResponses.filter(r=>!(/^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i.test(r.contentType||''))).concat(wasmResponses.filter(r=>!/^application\/wasm(?:;|$)/i.test(r.contentType||'')))};
   check(scriptResponses.length>0&&wasmResponses.length===1&&run.mime.bad.length===0,'All actual JS/MJS/WASM responses use correct Content-Type');
   check(run.responses.every(r=>r.status<400)&&run.requestFailures.length===0&&run.pageErrors.length===0&&!run.console.some(c=>c.type==='error')&&!run.boot.fatal&&!run.boot.status,'No HTTP, request, page, console, status or fatal errors');
   await page.screenshot({path:path.join(__dirname,`after-${label}.png`),fullPage:true});
   fs.writeFileSync(path.join(__dirname,`after-${label}-final-observation.json`),JSON.stringify(scrolled,null,2));
   run.pass=true;
  }catch(e){run.pass=false;run.failure=String(e.stack||e);await page.mouse.up().catch(()=>{});await page.screenshot({path:path.join(__dirname,`after-${label}-failure.png`),fullPage:true}).catch(()=>{});}
  await context.close();fs.writeFileSync(path.join(__dirname,'after.json'),JSON.stringify(report,null,2));
 }
 report.pass=report.runs.every(r=>r.pass);fs.writeFileSync(path.join(__dirname,'after.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({pass:report.pass,runs:report.runs.map(r=>({viewport:r.viewport,pass:r.pass,failure:r.failure,assertions:r.assertions,mime:r.mime,errors:{page:r.pageErrors,request:r.requestFailures,console:r.console.filter(c=>c.type==='error')}}))},null,2));
 await browser.close();if(!report.pass)process.exitCode=1;
})();

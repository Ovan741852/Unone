const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {chromium}=require('C:/Users/maverickchiu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.env.RESPONSIVE_QA_URL||'http://127.0.0.1:8344/?sdk=fresh-ui-verified&mime=fixed';
const exportRoot=process.env.RESPONSIVE_QA_EXPORT||'D:/TSProject/Voidwake/engine/_Games/harbor-controls/dist/player';
const flat=n=>[n,...(n.children||[]).flatMap(flat)],find=(s,id)=>flat(s.world.ui).find(n=>n.id===id);
const point=(r,v,fx=.5,fy=.5)=>({x:(r.x+r.width*fx)*v.width/100,y:(100-r.y-r.height*fy)*v.height/100});
const observe=p=>p.evaluate(()=>{const e=window.__responsiveQaWasm.find(i=>i.exports.unone_web_observation_ptr).exports;return JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.unone_web_observation_ptr(),e.unone_web_observation_len())));});
const scroll=p=>p.locator('[data-ui-scrollbar="presets/list"][data-axis="y"]').evaluate(e=>({top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight,at:performance.now()}));
const hashes=root=>{const visit=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?visit(path.join(d,e.name)):[path.join(d,e.name)]);return visit(root).sort().map(f=>({path:path.relative(root,f).replaceAll('\\','/'),bytes:fs.statSync(f).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}));};
const move=async(p,a,b,steps=12)=>{for(let i=1;i<=steps;i++){await p.mouse.move(a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps);await p.waitForTimeout(12);}};
const rect=(x,top,width,height)=>({x,y:100-top-height,width,height});
const expected={
 portrait:{compact:true,titleSize:3.8,cards:{audio:rect(5,19,90,14),quality:rect(5,35,90,17),presets:rect(5,54,90,24.5),probe:rect(5,80.5,90,10.5)},apply:rect(5,93,56,4.8),reset:rect(64,93,31,4.8),slider:rect(8,28,84,3.6),track:rect(8,32.1,84,.28),combo:rect(8,40.2,84,4.8),list:{left:8,top:61.2,width:84,height:13.6}},
 medium:{compact:false,titleSize:5.2,cards:{audio:rect(5,25,43,23),quality:rect(5,51,43,25),presets:rect(51,25,44,42),probe:rect(51,70,44,19)},apply:rect(5,81,26,6),reset:rect(33,81,15,6),slider:rect(7,37,39,5),track:rect(7,44,39,.45),combo:rect(7,59.5,39,5.5),list:{left:53,top:36,width:40,height:25}},
 desktop:{compact:false,titleSize:5.2,cards:{audio:rect(6,25,40,23),quality:rect(6,51,40,25),presets:rect(49,25,45,42),probe:rect(49,70,45,19)},apply:rect(6,81,25,6),reset:rect(33,81,13,6),slider:rect(8,37,36,5),track:rect(8,44,36,.45),combo:rect(8,59.5,36,5.5),list:{left:51,top:36,width:41,height:25}},
};
function near(actual,wanted){return Object.keys(wanted).every(k=>Number.isFinite(actual?.[k])&&Math.abs(actual[k]-wanted[k])<1e-8);}
async function addObserver(context){await context.addInitScript(()=>{Object.defineProperty(window,'__responsiveQaWasm',{value:[],enumerable:false});const capture=r=>{const i=r?.instance||r;if(i?.exports&&!window.__responsiveQaWasm.includes(i))window.__responsiveQaWasm.push(i);return r;};const a=WebAssembly.instantiate.bind(WebAssembly);WebAssembly.instantiate=(...x)=>a(...x).then(capture);if(WebAssembly.instantiateStreaming){const b=WebAssembly.instantiateStreaming.bind(WebAssembly);WebAssembly.instantiateStreaming=(...x)=>b(...x).then(capture);}});}
function visibleRow(s,v,offset){const list=find(s,'presets/list'),top=(100-list.rect.y-list.rect.height)*v.height/100,bottom=top+list.rect.height*v.height/100;for(const n of flat(list)){if(!/^SelectPreset_/.test(n.action||''))continue;const rowTop=top+n.rect.y*v.height/100-offset,rowBottom=top+(n.rect.y+n.rect.height)*v.height/100-offset;if(rowTop>=top+2&&rowBottom<=bottom-2)return {node:n,start:{x:(list.rect.x+n.rect.x+n.rect.width*.5)*v.width/100,y:(rowTop+rowBottom)*.5},top,bottom};}throw Error('No fully visible materialized row');}
(async()=>{
 const report={url,phase:'official-ui-responsive-layout',contract:{package:'0.4.0',observer:'Production WASM observation ptr/len memory reads only; no simulation/input writes or private layout methods',gestures:'Physical Playwright mouse; viewport resize through browser surface only',baseline:'Exact three pre-existing Harbor designs, including control artwork and typography'},assertions:[],responses:[],console:[],pageErrors:[],requestFailures:[],resizes:[],screenshots:[],exportRoot};
 const check=(pass,message)=>{report.assertions.push({pass:!!pass,message});assert.ok(pass,message);};
 report.exportBefore=hashes(exportRoot);
 fs.writeFileSync(path.join(__dirname,'responsive-export-before-sha256.json'),JSON.stringify(report.exportBefore,null,2));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
 await addObserver(context);const page=await context.newPage();
 page.on('response',r=>report.responses.push({url:r.url(),status:r.status(),contentType:r.headers()['content-type']||null}));page.on('console',m=>report.console.push({type:m.type(),text:m.text()}));page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('requestfailed',r=>report.requestFailures.push({url:r.url(),error:r.failure()}));
 async function layout(viewport,name,label,settings){
  await page.setViewportSize(viewport);await page.waitForTimeout(220);
  const s=await observe(page),g=s.world.observations.layout,e=expected[name];
  report.resizes.push({label,viewport,layout:g,settings:s.world.observations.settings,frame:s.world.frame,cards:Object.fromEntries(Object.keys(e.cards).map(id=>[id,find(s,id)?.rect]))});
  check(g.name===name&&g.compact===e.compact&&Math.abs(g.aspect-viewport.width/viewport.height)<1e-10,`${label}: correct declared variant and viewport aspect`);
  check(Object.entries(e.cards).every(([id,r])=>near(find(s,id)?.rect,r)),`${label}: all four shared-partition card bounds preserve the original design`);
  check(near(find(s,'settings/apply')?.rect,e.apply)&&near(find(s,'settings/reset')?.rect,e.reset),`${label}: shared action row preserves both button bounds`);
  check(near(g.slider,e.slider)&&near(g.slider_track,e.track)&&near(g.combobox,e.combo)&&near(g.list,e.list),`${label}: slider artwork, combobox and ScrollView viewport preserve their authored positions`);
  check(find(s,'settings/title')?.style.font_size===e.titleSize,`${label}: project typography tokens remain unchanged`);
  check(Object.values(e.cards).every(r=>r.x>=0&&r.y>=0&&r.x+r.width<=100+1e-8&&r.y+r.height<=100+1e-8),`${label}: authored cards remain inside stage bounds`);
  if(settings)check(JSON.stringify(s.world.observations.settings)===JSON.stringify(settings),`${label}: resize preserves all project settings state`);
  return s;
 }
 try{
  await page.goto(url,{waitUntil:'networkidle',timeout:30000});await page.waitForFunction(()=>document.body.dataset.playerRenderer==='official'&&Number(document.body.dataset.playerFrame)>10&&window.__responsiveQaWasm.some(i=>i.exports.unone_web_observation_ptr),null,{timeout:15000});
  let s=await layout({width:1440,height:900},'desktop','initial desktop');
  check(s.world.observations.ui_package?.version==='0.4.0','Production Core exposes official package 0.4.0');
  const boot=await page.evaluate(()=>({renderer:document.body.dataset.playerRenderer,metrics:JSON.parse(document.body.dataset.playerMetrics||'null')}));report.boot=boot;
  check(boot.renderer==='official'&&boot.metrics?.renderer==='three-webgl','Official three-webgl player remains active');
  const start=point(find(s,'audio/fill').rect,{width:1440,height:900});await page.mouse.move(start.x,start.y);await page.mouse.down();await page.waitForTimeout(90);const held=await observe(page);report.sliderHeld=held.world.observations;
  check(held.world.observations.slider?.dragging===true&&held.world.observations.ui_input?.world_pointer_down===false,'Official slider owns a physical held pointer before reflow');
  s=await layout({width:390,height:844},'portrait','held-slider reflow');
  const cancelled=s.world.observations,heldValue=cancelled.settings.volume;report.sliderAfterResize=cancelled;
  check(cancelled.slider?.dragging===false&&cancelled.ui_input?.world_pointer_down===false,'Reflow cancels slider capture without leaking a world pointer');
  const newTrack=point(find(s,'audio/level').drag.track_rect,{width:390,height:844},.9);await page.mouse.move(newTrack.x,newTrack.y);await page.waitForTimeout(100);const moved=await observe(page);
  check(moved.world.observations.settings.volume===heldValue&&moved.world.observations.slider?.dragging===false,'Still-held motion after reflow cannot reactivate a cancelled slider');await page.mouse.up();await page.waitForTimeout(80);
  const settings=(await observe(page)).world.observations.settings;
  for(const v of [
   {width:390,height:844,name:'portrait',label:'portrait'},
   {width:1020,height:884,name:'medium',label:'medium'},
   {width:1440,height:900,name:'desktop',label:'desktop-restored'},
   {width:799,height:1000,name:'portrait',label:'below-0.8'},
   {width:800,height:1000,name:'medium',label:'exact-0.8'},
   {width:1349,height:1000,name:'medium',label:'below-1.35'},
   {width:1350,height:1000,name:'desktop',label:'exact-1.35'},
  ]){
   s=await layout({width:v.width,height:v.height},v.name,v.label,settings);
   if(['portrait','medium','desktop-restored'].includes(v.label)){const file=`responsive-${v.width}x${v.height}.png`;await page.screenshot({path:path.join(__dirname,file),fullPage:true});report.screenshots.push(file);}
  }
  const viewport={width:1440,height:900};s=await layout(viewport,'desktop','coast prerequisite',settings);const offset=await scroll(page),row=visibleRow(s,viewport,offset.top),end={x:row.start.x,y:row.start.y-125};
  check(offset.height-offset.client-offset.top>viewport.height*.9,'Inertia resize test starts far from the content edge');
  await page.mouse.move(row.start.x,row.start.y);await page.mouse.down();await move(page,row.start,end,10);await page.mouse.up();const a=await scroll(page);await page.waitForTimeout(65);const b=await scroll(page);report.coast={before:offset,released:a,beforeResize:b};check(b.top>a.top+1,'Physical scroll flick produces measurable motion before resize');
  await page.setViewportSize({width:1020,height:884});await page.waitForTimeout(100);const stopped=await scroll(page);await page.waitForTimeout(180);const later=await scroll(page);report.coast.afterResize=stopped;report.coast.later=later;
  check(Math.abs(later.top-stopped.top)<=1,'Changing viewport dimensions cancels inertia instead of reviving old velocity');
  s=await observe(page);check(JSON.stringify(s.world.observations.settings)===JSON.stringify(settings),'Responsive reflow and inertial drag preserve project settings and never select a row');
  const js=report.responses.filter(r=>/\.m?js(?:\?|$)/i.test(r.url)),wasm=report.responses.filter(r=>/\.wasm(?:\?|$)/i.test(r.url));report.mime={javascript:js.length,wasm:wasm.length,bad:[...js.filter(r=>!/^(text|application)\/(javascript|ecmascript)(;|$)/i.test(r.contentType||'')),...wasm.filter(r=>!/^application\/wasm(;|$)/i.test(r.contentType||''))]};
  check(js.length>0&&wasm.length===1&&report.mime.bad.length===0,'Actual JS/MJS/WASM responses retain valid MIME types');
  report.finalStatus=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent||'',fatal:document.body.dataset.playerFatal||document.querySelector('[data-player-error]')?.textContent||null,renderer:document.body.dataset.playerRenderer}));
  check(report.responses.every(r=>r.status<400)&&report.requestFailures.length===0&&report.pageErrors.length===0&&!report.console.some(c=>c.type==='error')&&!report.finalStatus.status&&!report.finalStatus.fatal,'No HTTP, request, page, console or player errors across live reflows');
  report.pass=true;
 }catch(e){report.pass=false;report.failure=String(e.stack||e);await page.mouse.up().catch(()=>{});await page.screenshot({path:path.join(__dirname,'responsive-failure.png'),fullPage:true}).catch(()=>{});}
 await context.close();await browser.close();report.exportAfter=hashes(exportRoot);report.exportUnchanged=JSON.stringify(report.exportBefore)===JSON.stringify(report.exportAfter);report.pass=report.pass&&report.exportUnchanged;
 fs.writeFileSync(path.join(__dirname,'responsive-export-after-sha256.json'),JSON.stringify(report.exportAfter,null,2));fs.writeFileSync(path.join(__dirname,'responsive.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,assertions:report.assertions.length,resizes:report.resizes.length,exportUnchanged:report.exportUnchanged,failure:report.failure},null,2));if(!report.pass)process.exitCode=1;
})();

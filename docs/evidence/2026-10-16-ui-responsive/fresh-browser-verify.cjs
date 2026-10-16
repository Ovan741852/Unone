const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {chromium}=require('C:/Users/maverickchiu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url='http://127.0.0.1:8345/';
const exportRoot='D:/TSProject/Voidwake/engine/_Games/responsive-layout-lab/dist/player';
const flat=n=>[n,...(n.children||[]).flatMap(flat)],find=(s,id)=>flat(s.world.ui).find(n=>n.id===id);
const observe=p=>p.evaluate(()=>{const e=window.__freshLayoutQaWasm.find(i=>i.exports.unone_web_observation_ptr).exports;return JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,e.unone_web_observation_ptr(),e.unone_web_observation_len())));});
const point=(r,v)=>({x:(r.x+r.width*.5)*v.width/100,y:(100-r.y-r.height*.5)*v.height/100});
const hashes=root=>{const visit=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?visit(path.join(d,e.name)):[path.join(d,e.name)]);return visit(root).sort().map(f=>({path:path.relative(root,f).replaceAll('\\','/'),bytes:fs.statSync(f).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}));};
const near=(a,b)=>Math.abs(a-b)<1e-8;
const sameRect=(a,b)=>a&&b&&['x','y','width','height'].every(k=>near(a[k],b[k]));
const positive=r=>r&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.width>0&&r.height>0;
const contains=(outer,r)=>r.x>=outer.x-1e-8&&r.y>=outer.y-1e-8&&r.x+r.width<=outer.x+outer.width+1e-8&&r.y+r.height<=outer.y+outer.height+1e-8;
const overlap=(a,b)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1e-8&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>1e-8;
(async()=>{
 const report={url,exportRoot,phase:'fresh-sdk-only-generic-responsive-example',observer:'Only production WASM observation ptr/len and memory reads. Physical mouse events and browser viewport changes; no input ABI writes, source/export changes or private layout helper calls.',assertions:[],responses:[],console:[],pageErrors:[],requestFailures:[],runs:[],screenshots:[]};
 const check=(pass,message)=>{report.assertions.push({pass:!!pass,message});assert.ok(pass,message);};
 report.exportBefore=hashes(exportRoot);fs.writeFileSync(path.join(__dirname,'export-before-sha256.json'),JSON.stringify(report.exportBefore,null,2));
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
 await context.addInitScript(()=>{Object.defineProperty(window,'__freshLayoutQaWasm',{value:[],enumerable:false});const capture=r=>{const i=r?.instance||r;if(i?.exports&&!window.__freshLayoutQaWasm.includes(i))window.__freshLayoutQaWasm.push(i);return r;};const a=WebAssembly.instantiate.bind(WebAssembly);WebAssembly.instantiate=(...x)=>a(...x).then(capture);if(WebAssembly.instantiateStreaming){const b=WebAssembly.instantiateStreaming.bind(WebAssembly);WebAssembly.instantiateStreaming=(...x)=>b(...x).then(capture);}});
 const page=await context.newPage();page.on('response',r=>report.responses.push({url:r.url(),status:r.status(),contentType:r.headers()['content-type']||null}));page.on('console',m=>report.console.push({type:m.type(),text:m.text()}));page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('requestfailed',r=>report.requestFailures.push({url:r.url(),error:r.failure()}));
 const cardIds=['workspaces','inbox','reports','automations'];let expectedCount=0;
 try{
  await page.goto(url,{waitUntil:'networkidle',timeout:30000});await page.waitForFunction(()=>document.body.dataset.playerRenderer==='official'&&Number(document.body.dataset.playerFrame)>10&&window.__freshLayoutQaWasm.some(i=>i.exports.unone_web_observation_ptr),null,{timeout:15000});
  const initial=await observe(page);report.initial={project:initial.project,observations:initial.world.observations};check(initial.project==='Layout Lab'&&initial.world.observations.refresh_count===0,'Fresh production example boots with zero refreshes');
  check(initial.world.observations.ui_package?.version==='0.4.0'&&initial.world.observations.ui_package?.declared===true,'Production Core confirms declared official UI 0.4.0');
  report.boot=await page.evaluate(()=>({renderer:document.body.dataset.playerRenderer,metrics:JSON.parse(document.body.dataset.playerMetrics||'null'),canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,css:{width:c.getBoundingClientRect().width,height:c.getBoundingClientRect().height}}))}));
  check(report.boot.renderer==='official'&&report.boot.metrics?.renderer==='three-webgl'&&report.boot.canvases.some(c=>c.width>0&&c.height>0),'Official three-webgl and a nonempty actual canvas render the example');
  for(const spec of [
   {width:1440,height:900,name:'wide',columns:4,fixed:17,click:true},
   {width:900,height:900,name:'medium',columns:2,fixed:24,click:true},
   {width:390,height:844,name:'narrow',columns:1,fixed:38,click:true},
   {width:1440,height:900,name:'wide',columns:4,fixed:17,click:false},
  ]){
   const viewport={width:spec.width,height:spec.height};await page.setViewportSize(viewport);await page.waitForTimeout(200);let s=await observe(page),o=s.world.observations;const regions=o.ui_regions;
   const run={viewport,variant:spec.name,expectedCountBefore:expectedCount,before:o};report.runs.push(run);
   check(o.ui_variant===spec.name&&o.ui_columns===spec.columns&&near(o.ui_aspect,spec.width/spec.height),`${spec.name} ${spec.width}×${spec.height}: correct variant, aspect and declared columns`);
   check(o.refresh_count===expectedCount,`${spec.name}: live resize preserves the refresh counter`);
   const cells=cardIds.map(id=>regions[id]);check(positive(regions.cards)&&contains({x:0,y:0,width:100,height:100},regions.cards)&&cells.every(r=>positive(r)&&contains(regions.cards,r)),`${spec.name}: all four grid cells have positive finite bounds inside the stage and cards region`);
   check(cells.every((a,i)=>cells.every((b,j)=>i>=j||!overlap(a,b))),`${spec.name}: grid cells do not overlap`);
   const rows=Math.ceil(cells.length/spec.columns),cellW=(regions.cards.width-1.8*(spec.columns-1))/spec.columns,cellH=(regions.cards.height-1.8*(rows-1))/rows;
   check(cells.every((r,i)=>near(r.width,cellW)&&near(r.height,cellH)&&near(r.x,regions.cards.x+(i%spec.columns)*(cellW+1.8))&&near(r.y,regions.cards.y+regions.cards.height-cellH-Math.floor(i/spec.columns)*(cellH+1.8))),`${spec.name}: equal cells use the declared row-major columns and gaps`);
   check(cardIds.every(id=>sameRect(find(s,'card/'+id)?.rect,regions[id])),`${spec.name}: actual published component bounds match all four shared grid regions`);
   check(cardIds.every(id=>{const parent=regions[id];return ['title','value','description'].every(role=>{const n=find(s,id+'/'+role);return n?.kind==='text'&&positive(n.rect)&&contains(parent,n.rect)&&typeof n.text==='string'&&n.text.length>0;});}),`${spec.name}: each real title, metric and description occupies a positive contained card region`);
   check(positive(regions.toolbar)&&positive(regions.refresh)&&positive(regions.activity)&&contains(regions.toolbar,regions.refresh)&&contains(regions.toolbar,regions.activity)&&near(regions.refresh.width,spec.fixed)&&near(regions.activity.width,regions.toolbar.width-spec.fixed-2)&&near(regions.activity.x,regions.refresh.x+spec.fixed+2)&&!overlap(regions.refresh,regions.activity),`${spec.name}: toolbar keeps the fixed refresh width and gives the remainder to activity`);
   check(sameRect(find(s,'refresh_button')?.rect,regions.refresh)&&find(s,'refresh_button')?.action==='RefreshDashboard'&&sameRect(find(s,'activity')?.rect,regions.activity),`${spec.name}: actual button and activity use those shared toolbar regions`);
   if(spec.click){
    const p=point(regions.refresh,viewport);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(260);expectedCount++;const held=await observe(page);run.held=held.world.observations;
    check(held.world.observations.refresh_count===expectedCount,`${spec.name}: a physical held press refreshes exactly once`);
    await page.mouse.move(viewport.width-2,viewport.height-2);await page.mouse.up();await page.waitForTimeout(130);s=await observe(page);run.after=s.world.observations;
    check(s.world.observations.refresh_count===expectedCount&&find(s,'activity')?.text===`Refreshed ${expectedCount} times`,`${spec.name}: release outside adds no repeat and the visible activity text reflects state`);
    const file=`fresh-${spec.width}x${spec.height}.png`;await page.screenshot({path:path.join(__dirname,file),fullPage:true});report.screenshots.push(file);
   }else run.after=o;
  }
  const js=report.responses.filter(r=>/\.m?js(?:\?|$)/i.test(r.url)),wasm=report.responses.filter(r=>/\.wasm(?:\?|$)/i.test(r.url));report.mime={javascript:js.length,wasm:wasm.length,bad:[...js.filter(r=>!/^(text|application)\/(javascript|ecmascript)(;|$)/i.test(r.contentType||'')),...wasm.filter(r=>!/^application\/wasm(;|$)/i.test(r.contentType||''))]};check(js.length>0&&wasm.length===1&&report.mime.bad.length===0,'All actual JavaScript modules and WASM have correct MIME types');
  report.finalStatus=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent||'',fatal:document.body.dataset.playerFatal||document.querySelector('[data-player-error]')?.textContent||null,renderer:document.body.dataset.playerRenderer}));
  check(report.responses.every(r=>r.status<400)&&report.requestFailures.length===0&&report.pageErrors.length===0&&!report.console.some(c=>c.type==='error')&&!report.finalStatus.status&&!report.finalStatus.fatal,'Live example has no HTTP, request, page, console or player errors');
  report.pass=true;
 }catch(e){report.pass=false;report.failure=String(e.stack||e);await page.mouse.up().catch(()=>{});await page.screenshot({path:path.join(__dirname,'fresh-failure.png'),fullPage:true}).catch(()=>{});}
 await context.close();await browser.close();report.exportAfter=hashes(exportRoot);report.exportUnchanged=JSON.stringify(report.exportBefore)===JSON.stringify(report.exportAfter);report.pass=report.pass&&report.exportUnchanged;
 fs.writeFileSync(path.join(__dirname,'export-after-sha256.json'),JSON.stringify(report.exportAfter,null,2));fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,assertions:report.assertions.length,resizes:report.runs.length,exportUnchanged:report.exportUnchanged,failure:report.failure},null,2));if(!report.pass)process.exitCode=1;
})();

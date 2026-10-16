// Independent real-browser QA. Writes only to the requested QA artifact folder.
// The WASM observer calls only the public observation pointer/length exports.
// Application interaction is actual browser mouse, wheel, and keyboard input.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync} from 'node:fs';
import {resolve, join, relative, extname, sep} from 'node:path';
import {parseArgs, isDeepStrictEqual} from 'node:util';

const {values}=parseArgs({options:{export:{type:'string'},plan:{type:'string'},out:{type:'string'}}});
assert.ok(values.export&&values.plan&&values.out,'Pass frozen --export, --plan, and --out');
const exportRoot=realpathSync(values.export), out=resolve(values.out), plan=JSON.parse(readFileSync(values.plan,'utf8'));
const allowedRoot=resolve('D:/TSProject/Voidwake/engine/artifacts/ui-fresh-round2');
assert.ok(out===allowedRoot||out.startsWith(allowedRoot+sep),'QA output must remain in owned artifact folder');
mkdirSync(out,{recursive:true});
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2));
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/maverickchiu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const report={ok:false,export:exportRoot,plan,requirePackagedGlyphCoverage:plan.requirePackagedGlyphCoverage??true,readOnlyABI:['unone_web_observation_ptr','unone_web_observation_len'],browser:{channel:'msedge',realBrowser:true},viewports:[],checks:[],errors:[],limitations:['Screenshots must be visually inspected independently. Font loading alone does not prove cmap coverage.']};
let browser,server;
const check=(ok,name,detail)=>{report.checks.push({ok:!!ok,name,...(detail===undefined?{}:{detail})});return !!ok;};
const ptr=(value,path)=>path.split('/').filter(Boolean).reduce((v,key)=>v?.[key.replace(/~1/g,'/').replace(/~0/g,'~')],value);
const flatten=(nodes,result=[],owner=null)=>{for(const node of nodes??[]){result.push({...node,componentOwner:owner});flatten(node.children,result,node.kind==='component'?node.component:owner);}return result;};
const nodes=s=>flatten(s?.world?.ui?.children);
const matches=(n,m)=>Object.entries(m).every(([key,value])=>key==='textIncludes'?n.text?.includes(value):isDeepStrictEqual(n[key],value));
function treeHash(root){
 const files=[];
 const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile())files.push({path:relative(root,p).replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(p)).digest('hex')});}};
 walk(root);return {root,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}
const protectedRoots=[...new Set([exportRoot,...(plan.sourceRoots??[]).map(p=>realpathSync(p))])];
const beforeHash=protectedRoots.map(treeHash);save('sha-before.json',beforeHash);
const snapshot=page=>page.evaluate(()=>window.__independentQaSnapshot());
async function collect(page){return page.evaluate(()=>({snapshot:window.__independentQaSnapshot(),renderer:document.body.dataset.playerRenderer,metrics:JSON.parse(document.body.dataset.playerMetrics??'null'),frame:Number(document.body.dataset.playerFrame),fatal:document.body.dataset.playerError??null,fonts:[...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status})),paint:window.__independentQaDrawCalls,canvas:document.querySelector('#game')?.getBoundingClientRect().toJSON(),uiCanvas:(()=>{const c=document.querySelector('#ui-layer canvas');return c?{width:c.width,height:c.height,rect:c.getBoundingClientRect().toJSON()}:null;})()}));}
async function locate(page,matcher){const s=await snapshot(page),found=nodes(s).filter(n=>matches(n,matcher));assert.equal(found.length,1,'Exactly one public UI node required: '+JSON.stringify(matcher));return found[0];}
async function point(page,node,fraction=.5){const stage=await page.locator('#game').boundingBox();assert.ok(stage);return {x:stage.x+(node.rect.x+node.rect.width*fraction)*stage.width/100,y:stage.y+(100-node.rect.y-node.rect.height/2)*stage.height/100};}
async function expectPublic(page,expect,before,timeout=5000){
 const start=Date.now();let s,detail;
 do{
  s=await snapshot(page);const o=s?.world?.observations,b=before?.world?.observations,t=nodes(s).map(n=>n.text).filter(Boolean);
  detail={observations:o,text:t};
  const ok=Object.entries(expect.observations??{}).every(([p,v])=>isDeepStrictEqual(ptr(o,p),v))
   &&(expect.text??[]).every(v=>t.includes(v))&&(expect.textIncludes??[]).every(v=>t.some(a=>a.includes(v)))
   &&(expect.changed??[]).every(p=>!isDeepStrictEqual(ptr(o,p),ptr(b,p)))
   &&(expect.unchanged??[]).every(p=>isDeepStrictEqual(ptr(o,p),ptr(b,p)))
   &&(expect.increased??[]).every(p=>ptr(o,p)>ptr(b,p))&&(expect.decreased??[]).every(p=>ptr(o,p)<ptr(b,p))
   &&(expect.equalPaths??[]).every(([a,b])=>isDeepStrictEqual(ptr(o,a),ptr(o,b)));
  if(ok)return s;await page.waitForTimeout(50);
 }while(Date.now()-start<timeout);
 throw Error('Public expected outcome missing: '+JSON.stringify({expect,detail}));
}
function inspect(state,name){
 check(state.renderer==='official'&&state.metrics?.renderer_mode==='official',name+': official production renderer',state.metrics);
 check(!state.fatal,name+': no fatal player diagnostic',state.fatal);check(state.frame>0,name+': production WASM advances',state.frame);
 return nodes(state.snapshot).map(n=>({id:n.id,kind:n.kind,text:n.text,action:n.action,rect:n.rect,style:n.style,component:n.component}));
}
async function stateRecord(page,entry,name,screenshot=true){const state=await collect(page);entry.states.push({name,state});if(screenshot)await page.screenshot({path:join(out,`${entry.viewport.name}-${name}.png`)});return state;}
function equalityAudit(s,label){
 const o=s?.world?.observations;
 for(const group of plan.equalObservationGroups??[]){const values=group.map(p=>ptr(o,p));check(values.every(v=>v!==undefined)&&values.every(v=>isDeepStrictEqual(v,values[0])),label+': same-tick independent readers agree',group.map((path,i)=>({path,value:values[i]})));}
}
try{
 const frozenChecks=(plan.frozenManifests??[]).map(path=>{const manifest=JSON.parse(readFileSync(path,'utf8')),actual=treeHash(realpathSync(manifest.root)),byPath=new Map(actual.files.map(f=>[f.path,f.sha256]));return {manifest:path,root:manifest.root,expectedFiles:manifest.files.length,actualFiles:actual.files.length,checks:manifest.files.map(f=>({path:f.path,ok:byPath.get(f.path)===f.sha256.toLowerCase()}))};});
 save('frozen-manifest-check.json',frozenChecks);for(const item of frozenChecks){assert.ok(check(item.checks.every(c=>c.ok),'Frozen manifest files match before browser launch',item),'Frozen source/export manifest mismatch');}
 server=createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}const file=resolve(exportRoot,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(exportRoot+sep)||!realpathSync(file).startsWith(exportRoot+sep)){res.writeHead(403).end();return;}res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.ttf':'font/ttf','.otf':'font/otf','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));report.url=`http://127.0.0.1:${server.address().port}/`;
 browser=await chromium.launch({headless:true,channel:'msedge'});report.browser.version=browser.version();
 for(const viewport of [{name:'desktop',width:1440,height:900},{name:'intermediate',width:1020,height:884},{name:'portrait',width:390,height:844}]){
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:1}), page=await context.newPage();
  const entry={viewport,errors:[],failedRequests:[],httpErrors:[],states:[],steps:[]};report.viewports.push(entry);
  page.on('pageerror',e=>entry.errors.push({kind:'pageerror',message:e.message}));page.on('console',m=>{if(m.type()==='error')entry.errors.push({kind:'console',message:m.text()});});
  page.on('requestfailed',r=>entry.failedRequests.push({url:r.url(),failure:r.failure()}));page.on('response',r=>{if(r.status()>=400)entry.httpErrors.push({url:r.url(),status:r.status()});});
  await page.addInitScript(()=>{
   const record=r=>{const e=r?.instance?.exports??r?.exports;if(e?.unone_web_observation_ptr)window.__independentQaWasm=e;return r;};
   for(const method of ['instantiate','instantiateStreaming']){const original=WebAssembly[method];if(original)WebAssembly[method]=async function(...args){return record(await original.apply(WebAssembly,args));};}
   window.__independentQaSnapshot=()=>{const e=window.__independentQaWasm;if(!e)return null;const p=e.unone_web_observation_ptr(),n=e.unone_web_observation_len();return JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,p,n)));};
   window.__independentQaDrawCalls=[];const proto=CanvasRenderingContext2D.prototype,fill=proto.fillText,clear=proto.clearRect,draw=proto.drawImage,byCanvas=new WeakMap();
   const keep=c=>{window.__independentQaDrawCalls.push(c);if(window.__independentQaDrawCalls.length>4000)window.__independentQaDrawCalls.splice(0,window.__independentQaDrawCalls.length-4000);};
   proto.clearRect=function(...args){byCanvas.set(this.canvas,[]);if(this.canvas.closest?.('#ui-layer'))window.__independentQaDrawCalls=[];return clear.apply(this,args);};
   proto.fillText=function(text,x,y,...args){const p=new DOMPoint(x,y).matrixTransform(this.getTransform()),spacing=Number.parseFloat(this.letterSpacing??'0')||0,c={text:String(text),x:p.x,y:p.y,font:this.font,width:this.measureText(String(text)).width-(String(text)?spacing:0),tracking:spacing};const own=byCanvas.get(this.canvas)??[];own.push(c);byCanvas.set(this.canvas,own);if(this.canvas.closest?.('#ui-layer'))keep(c);return fill.call(this,text,x,y,...args);};
   proto.drawImage=function(source,...args){const own=byCanvas.get(source);if(own&&this.canvas.closest?.('#ui-layer')){const [sx,sy,sw,sh,dx,dy,dw,dh]=args.length===8?args:args.length===4?[0,0,source.width,source.height,...args]:[0,0,source.width,source.height,args[0],args[1],source.width,source.height];for(const c of own){const p=new DOMPoint(dx+(c.x-sx)*dw/sw,dy+(c.y-sy)*dh/sh).matrixTransform(this.getTransform());keep({...c,x:p.x,y:p.y});}}return draw.call(this,source,...args);};
  });
  try{
   await page.goto(report.url,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.body.dataset.playerError||(document.body.dataset.playerMetrics&&window.__independentQaSnapshot()?.world?.ui),null,{timeout:45000});await page.waitForTimeout(300);
   if(plan.initialExpect)await expectPublic(page,plan.initialExpect,await snapshot(page));
   const initial=await stateRecord(page,entry,'initial');entry.initialSemanticNodes=inspect(initial,viewport.name);equalityAudit(initial.snapshot,viewport.name+' initial');
   for(const step of plan.steps??[]){
    const before=await snapshot(page),record={name:step.name,beforeObservations:before.world.observations};entry.steps.push(record);
    try{
     if(step.hold){const n=await locate(page,step.hold.control),p=await point(page,n);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(step.hold.delay??180);const down=await stateRecord(page,entry,step.name+'-down');equalityAudit(down.snapshot,viewport.name+' '+step.name+' down');if(step.hold.downExpect)await expectPublic(page,step.hold.downExpect,before);await page.waitForTimeout(step.hold.delay??180);const held=await stateRecord(page,entry,step.name+'-held');equalityAudit(held.snapshot,viewport.name+' '+step.name+' held');if(step.hold.heldExpect)await expectPublic(page,step.hold.heldExpect,down.snapshot);await page.mouse.up();record.interaction={type:'mouse-down-hold-up',id:n.id,point:p};}
     if(step.click){const n=await locate(page,step.click),p=await point(page,n);await page.mouse.click(p.x,p.y,{delay:90});record.interaction={type:'click',id:n.id,point:p};}
     if(step.clickVisibleText){const n=await locate(page,step.clickVisibleText.control),container=await locate(page,step.clickVisibleText.within),state=await collect(page),stage=state.canvas,r=container.rect,clip={left:stage.x+r.x*stage.width/100,right:stage.x+(r.x+r.width)*stage.width/100,top:stage.y+(100-r.y-r.height)*stage.height/100,bottom:stage.y+(100-r.y)*stage.height/100},draws=state.paint.filter(c=>c.text===n.text&&c.x>=clip.left&&c.x<=clip.right&&c.y>clip.top&&c.y<clip.bottom);assert.ok(draws.length,'Target must have actually painted visible text within scroll clip');const p={x:(clip.left+clip.right)/2,y:draws[0].y};await page.mouse.click(p.x,p.y,{delay:90});record.interaction={type:'click-actually-painted-visible-row',id:n.id,text:n.text,point:p,clip,draw:draws[0]};}
     if(step.drag){const n=await locate(page,step.drag.control),start=await point(page,n,step.drag.from??.2),end=await point(page,n,step.drag.to??.8);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:16});await page.mouse.up();record.interaction={type:'drag',id:n.id,start,end};}
     if(step.wheel){const n=await locate(page,step.wheel.control),p=await point(page,n);await page.mouse.move(p.x,p.y);await page.mouse.wheel(step.wheel.deltaX??0,step.wheel.deltaY??500);record.interaction={type:'wheel',id:n.id,point:p,deltaY:step.wheel.deltaY??500};}
     if(step.key){await page.keyboard.press(step.key,{delay:90});record.interaction={type:'key',key:step.key};}
     if(step.resize){await page.setViewportSize({width:step.resize.width,height:step.resize.height});record.interaction={type:'resize',...step.resize};}
     if(step.expect)await expectPublic(page,step.expect,before);else await page.waitForTimeout(200);
     const after=await stateRecord(page,entry,step.name);record.afterObservations=after.snapshot.world.observations;record.ok=true;check(!after.fatal,viewport.name+' '+step.name+': no fatal diagnostic',after.fatal);equalityAudit(after.snapshot,viewport.name+' '+step.name);
    }catch(error){record.ok=false;record.error=error.stack;check(false,viewport.name+' '+step.name+': actual input outcome',error.message);await page.mouse.up().catch(()=>{});await stateRecord(page,entry,step.name+'-FAILED').catch(()=>{});}
   }
  }catch(error){entry.error=error.stack;check(false,viewport.name+': browser session',error.message);await page.screenshot({path:join(out,viewport.name+'-FAILED.png')}).catch(()=>{});}
  check(entry.errors.length===0&&entry.failedRequests.length===0&&entry.httpErrors.length===0,viewport.name+': no page, console, network, or HTTP errors',{errors:entry.errors,failedRequests:entry.failedRequests,httpErrors:entry.httpErrors});
  await context.close();save('browser-report.json',report);
 }
}catch(error){report.errors.push(error.stack);}
finally{
 await browser?.close();await new Promise(r=>server?server.close(r):r());
 const afterHash=protectedRoots.map(treeHash);save('sha-after.json',afterHash);check(isDeepStrictEqual(beforeHash,afterHash),'Source and frozen export SHA-256 trees unchanged',{before:beforeHash.map(({root,sha256})=>({root,sha256})),after:afterHash.map(({root,sha256})=>({root,sha256}))});
 report.ok=report.errors.length===0&&report.checks.every(c=>c.ok)&&report.viewports.length===3;save('browser-report.json',report);
}
console.log(JSON.stringify({ok:report.ok,out,checks:report.checks.length,failed:report.checks.filter(c=>!c.ok),errors:report.errors}));if(!report.ok)process.exitCode=1;

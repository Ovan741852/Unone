// Independent read-only observation of a real production official player.
// Interaction uses actual pointer/keyboard input. No fixture, payload, runtime
// state, renderer or authored source is substituted by this harness.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,join,extname,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
const {values}=parseArgs({options:{export:{type:'string'},url:{type:'string'},out:{type:'string'},plan:{type:'string'},python:{type:'string',default:'python'}}});
if(!values.export&&!values.url)throw Error('Use --export <official-export-directory> or --url <official-player-url>');
const scriptDir=dirname(fileURLToPath(import.meta.url));
const plan=values.plan?JSON.parse(readFileSync(values.plan,'utf8')):{},out=resolve(values.out??join(scriptDir,'../artifacts/ui-usability',`qa-${Date.now()}`));mkdirSync(out,{recursive:true});
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2));
const require=createRequire(import.meta.url),{chromium}=require(process.env.UNONE_PLAYWRIGHT_MODULE||'playwright');
const report={ok:false,title:plan.title??'Fresh official UI authoring QA',requirePackagedGlyphCoverage:plan.requirePackagedGlyphCoverage??false,export:values.export?resolve(values.export):null,url:null,viewports:[],errors:[],checks:[],limitations:['Screenshots require human visual review; geometry and metadata alone do not establish visual quality.','The read-only WASM ABI observer currently requires a main-thread production runtime.','Browser font registration does not prove character coverage; local export fonts are independently audited through their cmap.']};
let server,browser;
function check(condition,message,detail){assert.ok(condition,detail?message+': '+JSON.stringify(detail):message);report.checks.push(message);}
function flatten(nodes,result=[],owner=null){for(const node of nodes??[]){result.push({...node,componentOwner:owner});flatten(node.children,result,node.kind==='component'?node.component:owner);}return result;}
function select(nodes,matcher){return nodes.filter(n=>(!matcher.kind||n.kind===matcher.kind)&&(!matcher.text||n.text===matcher.text)&&(!matcher.textIncludes||n.text?.includes(matcher.textIncludes))&&(!matcher.action||n.action===matcher.action)&&(!matcher.id||n.id===matcher.id));}
const pointer=(value,path)=>path.split('/').filter(Boolean).reduce((v,key)=>v?.[key.replace(/~1/g,'/').replace(/~0/g,'~')],value);
const snapshot=page=>page.evaluate(()=>window.__qaSnapshot());
async function collect(page){
 const value=await page.evaluate(async()=>({snapshot:window.__qaSnapshot(),baseURI:document.baseURI,boot:JSON.parse(document.body.dataset.playerMetrics??'null'),renderer:document.body.dataset.playerRenderer,frame:Number(document.body.dataset.playerFrame),fatal:document.body.dataset.playerError??null,performance:JSON.parse(document.body.dataset.playerPerformance??'null'),fonts:[...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status})),paint:window.__qaDrawCalls,canvas:document.querySelector('#game')?.getBoundingClientRect().toJSON(),uiCanvas:(()=>{const c=document.querySelector('#ui-layer canvas');return c?{width:c.width,height:c.height,rect:c.getBoundingClientRect().toJSON()}:null;})(),presentation:await fetch(new URL('content/presentation.json',document.baseURI)).then(r=>r.json())}));
 return value;
}
async function clickControl(page,matcher){
 const state=await snapshot(page),nodes=flatten(state.world.ui?.children),matches=select(nodes,matcher).filter(n=>['button','combobox'].includes(n.kind));
 assert.equal(matches.length,1,'Expected exactly one public semantic control for '+JSON.stringify(matcher));
 const n=matches[0],stage=await page.locator('#game').boundingBox();
 const x=stage.x+(n.rect.x+n.rect.width/2)*stage.width/100,y=stage.y+(100-n.rect.y-n.rect.height/2)*stage.height/100;
 await page.mouse.click(x,y,{delay:90});return {id:n.id,kind:n.kind,text:n.text,action:n.action,point:{x,y}};
}
async function waitExpect(page,expect,before){
 const began=Date.now();let latest;
 do{latest=await snapshot(page);const texts=flatten(latest?.world?.ui?.children).map(n=>n.text).filter(Boolean);
  const observed=latest.world.observations,previous=before.world.observations;
  const matches=(expect.text??[]).every(t=>texts.includes(t))&&(expect.textIncludes??[]).every(t=>texts.some(v=>v.includes(t)))&&Object.entries(expect.observations??{}).every(([path,value])=>JSON.stringify(pointer(observed,path))===JSON.stringify(value))&&(expect.changed??[]).every(path=>JSON.stringify(pointer(observed,path))!==JSON.stringify(pointer(previous,path)))&&(expect.equalPaths??[]).every(([a,b])=>JSON.stringify(pointer(observed,a))===JSON.stringify(pointer(observed,b)))&&(expect.increased??[]).every(path=>pointer(observed,path)>pointer(previous,path))&&(expect.decreased??[]).every(path=>pointer(observed,path)<pointer(previous,path));
  if(matches)return latest;await page.waitForTimeout(60);
 }while(Date.now()-began<8000);
 throw Error('Public UI outcome did not appear: '+JSON.stringify({expect,observations:latest?.world?.observations,text:flatten(latest?.world?.ui?.children).map(n=>n.text).filter(Boolean)}));
}
function inspectVisualContracts(state,viewportName){
 const nodes=flatten(state.snapshot.world.ui?.children),components=nodes.filter(n=>n.kind==='component'),byType={};
 for(const n of components)(byType[n.component]??=[]).push(n.id);
 const repeated=Object.entries(byType).filter(([,ids])=>ids.length>=2),controls=nodes.filter(n=>['button','combobox','slider'].includes(n.kind)).map(({id,kind,text,action,rect})=>({id,kind,text,action,rect}));
 const textProbes=nodes.filter(n=>n.text&&n.style).map(n=>{
  const r=n.rect,unit=state.uiCanvas.height/100,size=(n.style.font_size??2)*unit;
  const box={x:r.x*state.uiCanvas.width/100,y:(100-r.y-r.height)*state.uiCanvas.height/100,width:r.width*state.uiCanvas.width/100,height:r.height*state.uiCanvas.height/100};
  const calls=state.paint.filter(p=>{const fontSize=Number(p.font.match(/([\d.]+)px/u)?.[1]);const prefix=p.text.replace(/…$/u,'');return prefix&&n.text.includes(prefix)&&Math.abs(fontSize-size)<.05&&p.x>=box.x-1&&p.x<=box.x+box.width+1&&p.y>=box.y-1&&p.y<=box.y+box.height+1;});
  const paintedLineCount=new Set(calls.map(c=>c.y)).size;
  const padding=n.style.padding??{},contentWidth=Math.max(0,box.width-((padding.left??0)+(padding.right??0))*unit),longestPaintWidth=Math.max(0,...calls.map(c=>c.width));
  return {id:n.id,text:n.text,style:n.style,expectedPixelSize:size,contentWidth,longestPaintWidth,horizontalOverflowPixels:Math.max(0,longestPaintWidth-contentWidth),drawnLines:calls.map(({text,x,y,font,width,tracking})=>({text,x,y,font,width,tracking})),actualWrapped:paintedLineCount>1,actualAutomaticWrap:paintedLineCount>n.text.split('\n').length,actualEllipsis:calls.some(c=>c.text.endsWith('…'))};
 });
 check(state.renderer==='official'&&state.boot?.renderer_mode==='official',`${viewportName}: actual official renderer selected`);
 check(!state.fatal,`${viewportName}: no fatal player diagnostic`,state.fatal);
 check(state.frame>0,`${viewportName}: actual production WASM advances`);
 const ui=state.presentation.ui??{},faces=[...(ui.fonts??[])];if(ui.font_source)faces.unshift({family:ui.font_family,source:ui.font_source,weight:400});
 for(const face of faces)check(state.fonts.some(f=>f.family.replace(/^['"]|['"]$/g,'')===face.family&&f.weight===String(face.weight??400)&&f.status==='loaded'),`${viewportName}: declared ${face.family} ${face.weight??400} face loaded`);
 if(plan.requireRepeatedComponent){const min=plan.minimumRepeatedComponentInstances??2;check(typeof plan.requireRepeatedComponent==='string'?(byType[plan.requireRepeatedComponent]?.length??0)>=min:repeated.some(([,ids])=>ids.length>=min),`${viewportName}: repeated component subtree identity exists`,byType);}
 const paintedFamilies=[...new Set(faces.map(f=>f.family))].filter(family=>state.paint.some(call=>call.font.includes(family)));
 if(plan.minimumPaintedFontFamilies)check(paintedFamilies.length>=plan.minimumPaintedFontFamilies,`${viewportName}: multiple packaged families actually paint glyphs`,paintedFamilies);
 for(const weight of plan.requiredPaintedWeights??[])check(state.paint.some(call=>weight===700?/^(?:bold|700) /u.test(call.font):weight===400?!/^(?:bold|[5-9]\d\d) /u.test(call.font):call.font.startsWith(weight+' ')),`${viewportName}: weight ${weight} actually paints glyphs`);
 if(plan.requireWrap===true||Array.isArray(plan.requireWrap)&&plan.requireWrap.includes(viewportName))check(textProbes.some(n=>n.style.wrap==='word'&&n.actualAutomaticWrap),`${viewportName}: text automatically wraps beyond its explicit newlines`);
 if(plan.requireEllipsis)check(textProbes.some(n=>n.style.overflow==='ellipsis'&&n.actualEllipsis),`${viewportName}: overlong label visibly paints ellipsis`);
 for(const matcher of plan.requireTextFits??[]){const probes=select(textProbes,matcher);check(probes.length>0&&probes.every(p=>p.drawnLines.length>0&&Number.isFinite(p.horizontalOverflowPixels)&&p.horizontalOverflowPixels<=1),`${viewportName}: intended complete text fits its authored box`,probes.map(({id,text,contentWidth,longestPaintWidth,horizontalOverflowPixels})=>({id,text,contentWidth,longestPaintWidth,horizontalOverflowPixels})));}
 return {components:byType,repeatedComponents:repeated,paintedFamilies,controls,textProbes};
}
try{
 let url=values.url;
 if(values.export){const root=realpathSync(values.export);server=createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+sep)||!realpathSync(file).startsWith(root+sep)){res.writeHead(403).end();return;}res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.ttf':'font/ttf','.otf':'font/otf'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}/`;}
 report.url=url;
 browser=await chromium.launch({headless:true,...(process.env.UNONE_BROWSER_PATH?{executablePath:process.env.UNONE_BROWSER_PATH}:process.env.UNONE_BROWSER_CHANNEL?{channel:process.env.UNONE_BROWSER_CHANNEL}:{})});
 for(const viewport of [{name:'desktop',width:1440,height:900},{name:'intermediate',width:1020,height:884},{name:'portrait',width:390,height:844}]){
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:1}),page=await context.newPage(),errors=[],failedRequests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>failedRequests.push({url:r.url(),failure:r.failure()}));
  await page.addInitScript(()=>{
   const record=r=>{const e=r?.instance?.exports??r?.exports;if(e?.unone_web_observation_ptr)window.__qaWasm=e;return r;};
   for(const method of ['instantiate','instantiateStreaming']){const original=WebAssembly[method];if(original)WebAssembly[method]=async function(...args){return record(await original.apply(WebAssembly,args));};}
   window.__qaSnapshot=()=>{const e=window.__qaWasm;if(!e)return null;const p=e.unone_web_observation_ptr(),n=e.unone_web_observation_len();return JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,p,n)));};
   window.__qaDrawCalls=[];const proto=CanvasRenderingContext2D.prototype,fill=proto.fillText,clear=proto.clearRect,image=proto.drawImage,byCanvas=new WeakMap();
   const keep=call=>{window.__qaDrawCalls.push(call);if(window.__qaDrawCalls.length>3000)window.__qaDrawCalls.splice(0,window.__qaDrawCalls.length-3000);};
   proto.clearRect=function(...args){byCanvas.set(this.canvas,[]);if(this.canvas.closest?.('#ui-layer'))window.__qaDrawCalls=[];return clear.apply(this,args);};
   proto.fillText=function(text,x,y,...args){const t=this.getTransform(),point=new DOMPoint(x,y).matrixTransform(t),rawTracking=this.letterSpacing,parsed=Number.parseFloat(rawTracking??'0'),spacing=Number.isFinite(parsed)?parsed:0,call={text:String(text),x:point.x,y:point.y,font:this.font,width:this.measureText(String(text)).width-(String(text)?spacing:0),tracking:spacing,rawTracking};const own=byCanvas.get(this.canvas)??[];own.push(call);byCanvas.set(this.canvas,own);if(this.canvas.closest?.('#ui-layer'))keep(call);return fill.call(this,text,x,y,...args);};
   // Reproject recorded text when an isolated opacity surface is composited.
   // The real drawImage call and every argument remain unchanged.
   proto.drawImage=function(source,...args){const own=byCanvas.get(source);if(own&&this.canvas.closest?.('#ui-layer')){
     const [sx,sy,sw,sh,dx,dy,dw,dh]=args.length===8?args:args.length===4?[0,0,source.width,source.height,...args]:[0,0,source.width,source.height,args[0],args[1],source.width,source.height];
     const transform=this.getTransform();for(const call of own){const point=new DOMPoint(dx+(call.x-sx)*dw/sw,dy+(call.y-sy)*dh/sh).matrixTransform(transform);keep({...call,x:point.x,y:point.y});}
   }return image.call(this,source,...args);};
  });
  const entry={viewport,states:[],steps:[],errors,failedRequests};report.viewports.push(entry);
  await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.body.dataset.playerMetrics&&window.__qaSnapshot()?.world?.ui||document.body.dataset.playerError,null,{timeout:45000});await page.waitForTimeout(350);
  if(plan.initialExpect)await waitExpect(page,plan.initialExpect,await snapshot(page));
  let state=await collect(page);const initial={name:'initial',state};entry.states.push(initial);await page.screenshot({path:join(out,`${viewport.name}-initial.png`)});initial.contracts=inspectVisualContracts(state,viewport.name);
  for(const step of plan.steps??[]){const before=await snapshot(page);let interaction;
   if(step.click)interaction=await clickControl(page,step.click);
   if(step.key){await page.keyboard.press(step.key,{delay:90});interaction={key:step.key};}
   if(step.drag){const current=await snapshot(page),matches=select(flatten(current.world.ui?.children),step.drag.control);assert.equal(matches.length,1,'Expected one semantic slider');const n=matches[0],stage=await page.locator('#game').boundingBox(),x=f=>stage.x+(n.rect.x+n.rect.width*f)*stage.width/100,y=stage.y+(100-n.rect.y-n.rect.height/2)*stage.height/100;await page.mouse.move(x(step.drag.from??.25),y);await page.mouse.down();await page.mouse.move(x(step.drag.to??.75),y,{steps:12});await page.mouse.up();interaction={drag:n.id,from:step.drag.from??.25,to:step.drag.to??.75};}
   if(step.expect)await waitExpect(page,step.expect,before);else await page.waitForTimeout(160);
   state=await collect(page);entry.steps.push({name:step.name,interaction,beforeObservations:before.world.observations,afterObservations:state.snapshot.world.observations});entry.states.push({name:step.name,state});if(step.screenshot!==false)await page.screenshot({path:join(out,`${viewport.name}-${step.name.replace(/[^a-z0-9_-]/gi,'-')}.png`)});check(!state.fatal,`${viewport.name}: ${step.name} has no fatal diagnostic`);
  }
  check(errors.length===0&&failedRequests.length===0,`${viewport.name}: no browser, asset or compiler errors`,{errors,failedRequests});await context.close();
 }
 report.ok=true;
}catch(error){report.errors.push(error.stack);process.exitCode=1;}
finally{save('browser-report.json',report);await browser?.close();await new Promise(r=>server?server.close(r):r());}
if(values.export&&report.viewports.length){const audit=spawnSync(values.python,[join(scriptDir,'audit-ui-fonts.py'),'--export',resolve(values.export),'--report',join(out,'browser-report.json'),'--output',join(out,'font-coverage.json')],{encoding:'utf8',timeout:30000});save('font-audit-process.json',{status:audit.status,stdout:audit.stdout,stderr:audit.stderr});if(audit.status!==0){report.ok=false;report.errors.push('Independent font cmap audit failed: '+audit.stderr+' '+audit.stdout);process.exitCode=1;save('browser-report.json',report);}}
console.log(JSON.stringify({ok:report.ok,out,checks:report.checks.length,errors:report.errors}));

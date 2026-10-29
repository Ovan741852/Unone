// Official WASM parser + official Canvas UI pixels. No game-owned renderer.
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const {values}=parseArgs({options:{sdk:{type:'string'},out:{type:'string'},runtimes:{type:'string',default:'web-development-1,web-production-0'},'edge-probe':{type:'boolean',default:false}}});
assert(values.sdk&&values.out,'Usage: --sdk <new official SDK> --out <evidence-directory>');
const sdk=resolve(values.sdk),out=resolve(values.out),names=values.runtimes.split(',');mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url);let playwright;try{playwright=require(process.env.UNONE_PLAYWRIGHT_MODULE||'playwright')}catch{playwright=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')}
const modules=new Map(['canvas-ui.mjs','ui-style.mjs','ui-contract.mjs','ui-geometry.mjs','ui-scroll.mjs'].map(n=>['/'+n,readFileSync(join(sdk,'templates/web/shared',n))]));
const files=new Map();for(const name of names)for(const file of ['unone-player.js','unone_player.wasm'])files.set('/'+name+'/'+file,readFileSync(join(sdk,'runtimes',name,file)));
const html='<style>body{margin:0;background:#ddd}canvas{display:block;width:200px;height:100px}</style><canvas id="ui"></canvas>';
const server=createServer((req,res)=>{const bytes=modules.get(req.url)??files.get(req.url);if(bytes){res.setHeader('Content-Type',req.url.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(bytes)}else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html)}else{res.statusCode=404;res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const script=String.raw`
local R={x=10,y=10,width=80,height=80}
local Q={
 {asset="asset://blue",rect={x=10,y=10,width=80,height=80}},
 {asset="asset://atlas",rect={x=20,y=20,width=20,height=20},source={x=2,y=2,width=4,height=4}},
 {asset="asset://atlas",rect={x=30,y=30,width=20,height=20},source={x=10,y=2,width=4,height=4},opacity=.5},
 {asset="asset://atlas",rect={x=35,y=35,width=5,height=5},source={x=10,y=10,width=4,height=4},opacity=0}}
local function image(id,q)
 return {kind="image",id=id,asset=q.asset,rect=q.rect,fit="stretch",
  slice=if q.source then {left=0,top=0,right=0,bottom=0,pixels_per_unit=1,source=q.source} else nil,
  style=if q.opacity then {opacity=q.opacity} else nil}
end
local function batch() return {kind="image_batch",id="composite",rect=R,quads=Q} end
local function publish(api,mode)
 local nodes={}
 if mode=="internal" then nodes={batch()}
 elseif mode=="external" then nodes={batch(),{kind="button",id="undeclared",rect={x=85,y=85,width=15,height=15},action="Wrong"}}
 elseif mode=="keep" then nodes={image("keep",Q[2])}
 elseif mode=="empty" then nodes={{kind="button",id="empty",rect={x=0,y=0,width=1,height=1},action="NoArt"}}
 elseif mode~="empty" then
  table.insert(nodes,{kind="button",id="lower",rect={x=0,y=0,width=100,height=100},action="Lower"})
  if mode=="normal" then for i,q in Q do table.insert(nodes,image("normal"..i,q)) end else table.insert(nodes,batch()) end
  table.insert(nodes,image("above",{asset="asset://atlas",rect={x=70,y=70,width=10,height=10},source={x=10,y=2,width=4,height=4}}))
  table.insert(nodes,{kind="button",id="upper",rect={x=80,y=80,width=15,height=15},action="Upper"})
 end
 api.ui.setRoot({id="fixture",kind="screen",node="fixture",budget={max_nodes=32},children=nodes})
end
local Game={}
function Game.start(api) publish(api,"START_MODE") end
function Game.update(api,dt)
 for action,mode in {Normal="normal",Batch="batch",Keep="keep",Empty="empty"} do if api.input.wasPressed(action) then publish(api,mode) end end
end
return Game
`;
const config={name:'Official generic image batch browser proof',entry_script:'main.luau',systems:{ui:true,audio:false,particle:false}};
const edgeProbe=values['edge-probe'],activeScript=edgeProbe?script.replaceAll('x=2,y=2,width=4,height=4','x=0,y=0,width=2,height=2').replaceAll('x=10,y=2,width=4,height=4','x=2,y=0,width=2,height=2').replaceAll('x=10,y=10,width=4,height=4','x=2,y=2,width=2,height=2'):script;
const report={ok:false,sdk,fixture:edgeProbe?'unguttered-4px-atlas-edge-diagnostic':'guttered-16px-atlas-analytic-parity',runtimes:[],native:[],errors:[],modules:Object.fromEntries([...modules].map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]))};
const browser=await playwright.chromium.launch(process.env.UNONE_BROWSER_PATH?{executablePath:process.env.UNONE_BROWSER_PATH,headless:true}:{channel:process.env.UNONE_BROWSER_CHANNEL||'msedge',headless:true});
try{
 for(const name of names)for(const dpr of edgeProbe?[1]:[1,2]){
  const page=await browser.newPage({viewport:{width:400,height:250},deviceScaleFactor:dpr});page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async({name,dpr,script,config,edgeProbe})=>{
   const wasmBinary=await (await fetch('/'+name+'/unone_player.wasm')).arrayBuffer();
   await new Promise((resolve,reject)=>{window.Module={noInitialRun:true,wasmBinary:new Uint8Array(wasmBinary),onRuntimeInitialized:resolve,onAbort:reject};const tag=document.createElement('script');tag.src='/'+name+'/unone-player.js';tag.onerror=reject;document.head.append(tag)});
   const engine=window.Module,enc=new TextEncoder(),dec=new TextDecoder();
   const read=()=>JSON.parse(dec.decode(engine.HEAPU8.slice(engine._unone_web_observation_ptr(),engine._unone_web_observation_ptr()+engine._unone_web_observation_len())));
   function send(method,value,...extra){const bytes=enc.encode(JSON.stringify(value)),p=engine._unone_web_alloc(bytes.length);engine.HEAPU8.set(bytes,p);if(engine[method](p,bytes.length,...extra)!==0)throw Error(JSON.stringify(read()))}
   send('_unone_web_load_project',{config,scene:null,script,restored_save:null},42n);
   const {createCanvasUi}=await import('/canvas-ui.mjs'),canvas=document.querySelector('#ui'),closed=[],requested=[];
   async function asset(id){requested.push(id);const c=document.createElement('canvas');c.width=c.height=id==='asset://atlas'?(edgeProbe?4:16):1;const ctx=c.getContext('2d'),half=c.width/2;
    if(id==='asset://atlas'){for(const [x,y,color]of [[0,0,'#ff0000'],[half,0,'#00ff00'],[0,half,'#0000ff'],[half,half,'#ffff00']]){ctx.fillStyle=color;ctx.fillRect(x,y,half,half)}}else{ctx.fillStyle='#0000ff';ctx.fillRect(0,0,1,1)}
    const bitmap=await createImageBitmap(c),close=bitmap.close.bind(bitmap);bitmap.close=()=>{closed.push(id);close()};return bitmap;
   }
   const ui=createCanvasUi(canvas,{resolveAsset:asset}),draw=()=>ui.draw(read(),{width:200,height:100,dpr});
   async function ready(){for(let i=0;i<100;i++){draw();if(ui.report().assets.every(a=>a.state==='ready'))return;await new Promise(r=>setTimeout(r,1))}throw Error('UI assets did not become ready')}
   function step(action){send('_unone_web_set_input_frame',{actions:action?{[action]:true}:{}});if(engine._unone_web_tick()!==0)throw Error(JSON.stringify(read()));draw()}
   await ready();window.batchPixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.slice();const batchPng=canvas.toDataURL('image/png');
   const pixel=(x,y)=>[...canvas.getContext('2d').getImageData(Math.floor(x/100*canvas.width),Math.floor((100-y)/100*canvas.height),1,1).data];
   const pixels={red:pixel(25,25),overRed:pixel(35,35),overBlue:pixel(45,45),above:pixel(75,75),outside:pixel(5,5)};
   const hits={lower:ui.hitTest(35,35),upper:ui.hitTest(85,85),lowerDown:ui.pointer({kind:'down',x:35,y:35})};ui.releaseAll();
   const usage=ui.report().usage;step('Normal');await ready();const normal=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
   let mismatch=0,totalDifference=0,maxDifference=0;const changed=new Map();
   for(let i=0;i<normal.length;i++){const delta=Math.abs(normal[i]-window.batchPixels[i]);if(delta){mismatch++;totalDifference+=delta;maxDifference=Math.max(maxDifference,delta);const at=Math.floor(i/4),x=at%canvas.width,y=Math.floor(at/canvas.width);changed.set(at,{x,y,batch:[...window.batchPixels.slice(at*4,at*4+4)],normal:[...normal.slice(at*4,at*4+4)]});}}
   const difference={changedBytes:mismatch,changedPixels:changed.size,maxRgbaDelta:maxDifference,meanRgbaDelta:totalDifference/normal.length,meanChangedByteDelta:totalDifference/(mismatch||1),bounds:changed.size?{minX:Math.min(...[...changed.values()].map(p=>p.x)),maxX:Math.max(...[...changed.values()].map(p=>p.x)),minY:Math.min(...[...changed.values()].map(p=>p.y)),maxY:Math.max(...[...changed.values()].map(p=>p.y))}:null,pixels:[...changed.values()]};
   const normalPng=canvas.toDataURL('image/png');
   step();step('Batch');await ready();window.ui=ui;window.uiSnapshot=read();
   const errors=ui.report().diagnostics;step();step('Keep');await ready();const keep={assets:ui.report().assets.map(a=>a.id),closed:[...closed]};
   step();step('Empty');const empty={assets:ui.report().assets,closed:[...closed]};ui.dispose();
   return {name,dpr,pixels,hits,usage,mismatch,difference,requested,keep,empty,errors,batchPng,normalPng};
  },{name,dpr,script:activeScript.replace('START_MODE','batch'),config,edgeProbe});
  if(!edgeProbe){assert.equal(result.mismatch,0,JSON.stringify(result));assert.deepEqual(result.pixels,{red:[255,0,0,255],overRed:[127,128,0,255],overBlue:[0,128,127,255],above:[0,255,0,255],outside:[0,0,0,0]});}
  assert.equal(result.hits.lower.action,'Lower');assert.equal(result.hits.upper.action,'Upper');assert.equal(result.hits.lowerDown,true);
  assert.equal(result.usage.logical_nodes,8);assert.equal(result.usage.leaf_nodes,4);assert.equal(result.usage.render_regions_upper_bound,15);
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.requested,['asset://blue','asset://atlas']);assert.deepEqual(result.keep,{assets:['asset://atlas'],closed:['asset://blue']});assert.deepEqual(result.empty,{assets:[],closed:['asset://blue','asset://atlas']});
  const imageFile=name+'-'+dpr+'x.png';writeFileSync(join(out,imageFile),Buffer.from(result.batchPng.split(',')[1],'base64'));delete result.batchPng;result.screenshot=imageFile;
  if(edgeProbe){result.normalScreenshot=name+'-'+dpr+'x-normal.png';writeFileSync(join(out,result.normalScreenshot),Buffer.from(result.normalPng.split(',')[1],'base64'));}delete result.normalPng;
  report.runtimes.push({...result,wasmSha256:createHash('sha256').update(files.get('/'+name+'/unone_player.wasm')).digest('hex')});await page.close();
 }
 const execute=promisify(execFile),project=join(out,'native-project');mkdirSync(project,{recursive:true});writeFileSync(join(project,'project.unone.json'),JSON.stringify(config));
 for(const mode of edgeProbe?[]:['internal','external']){
  writeFileSync(join(project,'main.luau'),script.replace('START_MODE',mode));let stdout;try{({stdout}=await execute(join(sdk,'bin/game.exe'),['--sdk',sdk,'--project',project,'--json','ui','preview','--frames','1','--strict'],{maxBuffer:8*1024*1024}))}catch(e){stdout=e.stdout}
  writeFileSync(join(out,mode+'.native.raw.json'),stdout);const r=JSON.parse(stdout),findings=r.value?.findings??[];
  assert.equal(r.ok,mode==='internal',JSON.stringify(r));if(mode==='external')assert(findings.some(f=>f.code==='UI_NODES_OVERLAP'));
  if(mode==='internal'){assert.equal(r.value.usage.logical_nodes,5);assert.equal(r.value.usage.leaf_nodes,1);assert.equal(r.value.usage.render_regions_upper_bound,4)}
  report.native.push({mode,ok:r.ok,findings});
 }
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.errors.push(error.stack);throw error}
finally{writeFileSync(join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();server.close()}
console.log(JSON.stringify({ok:report.ok,runtimes:report.runtimes.length,native:report.native.length}));

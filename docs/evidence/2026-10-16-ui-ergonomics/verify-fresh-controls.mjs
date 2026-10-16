// Real official-player interaction. Only the observation ABI and pure geometry
// projection are read; input is delivered through Playwright mouse events.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
const out=resolve('artifacts/ui-ergonomics/fresh-controls-browser');
const root=realpathSync('D:/TSProject/UnoneUiErgonomics-20261016/probe/dist/player');
mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/maverickchiu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const report={ok:false,okScope:'Interaction and runtime checks only; saved screenshots require separate visual review.',export:root,browser:'Microsoft Edge / Playwright, headless',interaction:'Actual mouse movement/down/up/wheel only',observation:'Read-only WASM observation ABI; actual exported projectScrollTree pure utility plus DOM scrollbar positions',viewports:[],errors:[],limits:['No runtime/game/payload/renderer or developer API mutations and no direct materialization calls.','Portrait is tested with a mouse at a narrow viewport; this is not a mobile touch-device test.','This probe is one SDK-authored project, not a general guarantee for all layouts.']};
const save=()=>writeFileSync(join(out,'browser-report.json'),JSON.stringify(report,null,2));
let browser;
const server=createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+sep)||!realpathSync(file).startsWith(root+sep)){res.writeHead(403).end();return;}res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.ttf':'font/ttf','.otf':'font/otf'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}});
const read=page=>page.evaluate(()=>window.__qaRead());
const obs=s=>s.world.observations;
function flat(nodes,result=[]){for(const n of nodes??[]){result.push(n);flat(n.children,result);}return result;}
async function until(page,predicate,label){let state;for(let i=0;i<100;i++){state=await read(page);assert.ok(!await page.evaluate(()=>document.body.dataset.playerError),'Fatal player error');if(predicate(state))return state;await page.waitForTimeout(50);}throw Error(label+': '+JSON.stringify(obs(state)));}
async function geometry(page){return page.evaluate(async()=>{
 const snapshot=window.__qaRead(),{projectScrollTree}=await import(new URL('web/shared/ui-scroll.mjs',document.baseURI));
 const zero=projectScrollTree(snapshot.world.ui),offsets=new Map();
 for(const v of zero.views){const bar=[...document.querySelectorAll('[data-ui-scrollbar]')].find(e=>e.dataset.uiScrollbar===v.id&&e.dataset.axis==='y');if(bar){const range=bar.scrollHeight-bar.clientHeight;offsets.set(v.id,{x:0,y:range?bar.scrollTop/range*v.maxY:0});}}
 const projected=projectScrollTree(snapshot.world.ui,offsets),stage=document.querySelector('#game').getBoundingClientRect();
 return {nodes:projected.tree.children,views:projected.views.map(v=>({id:v.id,rect:v.rect,offset:v.offset,maxY:v.maxY})),stage:stage.toJSON()};
 });}
function point(g,node,fraction=.5){const r=node.rect;return{x:g.stage.x+(r.x+r.width*fraction)*g.stage.width/100,y:g.stage.y+(100-r.y-r.height/2)*g.stage.height/100};}
async function control(page,id){const g=await geometry(page),n=g.nodes.find(n=>n.id===id);assert.ok(n,'Missing control '+id);return{g,n,p:point(g,n)};}
async function click(page,id){const {p}=await control(page,id);await page.mouse.click(p.x,p.y,{delay:110});return p;}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;report.url=url;
 browser=await chromium.launch({channel:'msedge',headless:true});
 for(const viewport of [{name:'desktop',width:1440,height:900},{name:'portrait',width:390,height:844}]){
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:1}),page=await context.newPage();
  const entry={viewport,ok:false,checks:[],states:{},interactions:[],errors:[],failedRequests:[]};report.viewports.push(entry);
  page.on('pageerror',e=>entry.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')entry.errors.push(m.text());});page.on('requestfailed',r=>entry.failedRequests.push({url:r.url(),failure:r.failure()}));
  const check=(condition,label,details)=>{assert.ok(condition,label+(details?': '+JSON.stringify(details):''));entry.checks.push(label);};
  await page.addInitScript(()=>{
   const record=result=>{const e=result?.instance?.exports??result?.exports;if(e?.unone_web_observation_ptr)window.__qaExports=e;return result;};
   for(const method of ['instantiate','instantiateStreaming']){const original=WebAssembly[method];if(original)WebAssembly[method]=async function(...args){return record(await original.apply(WebAssembly,args));};}
   window.__qaRead=()=>{const e=window.__qaExports;if(!e)return null;const p=e.unone_web_observation_ptr(),n=e.unone_web_observation_len();return JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,p,n)));};
  });
  try{
   await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__qaRead()?.world?.ui&&document.body.dataset.playerMetrics||document.body.dataset.playerError,null,{timeout:45000});
   const initial=await until(page,s=>obs(s).update_ticks>5,'Runtime did not advance');entry.states.initial=initial;
   entry.boot=await page.evaluate(()=>({renderer:document.body.dataset.playerRenderer,metrics:JSON.parse(document.body.dataset.playerMetrics??'null'),fatal:document.body.dataset.playerError??null}));
   check(entry.boot.renderer==='official'&&entry.boot.metrics?.backend==='main','Official renderer and main-thread WASM actually booted',entry.boot);
   check(obs(initial).ui_package_version==='0.2.0'&&obs(initial).ui_package_declared===true,'Exact @unone/ui 0.2.0 declaration is active');
   check(obs(initial).slider_value===45&&obs(initial).combo_selection==='Balanced'&&obs(initial).list_row_count===120,'Expected initial game state');
   await page.screenshot({path:join(out,viewport.name+'-initial.png')});

   const {p:button}=await control(page,'settings/apply'),before=obs(await read(page));
   await page.mouse.move(button.x,button.y);await page.mouse.down();await page.waitForTimeout(350);
   const held=await until(page,s=>obs(s).button_is_down===true&&obs(s).button_held_ticks>before.button_held_ticks,'Button hold was not observed');entry.states.buttonHeld=held;
   check(obs(held).button_press_count===before.button_press_count+1&&obs(held).button_release_count===before.button_release_count,'350ms hold has exactly one press and no release',obs(held));
   await page.mouse.up();
   const released=await until(page,s=>obs(s).button_release_count===before.button_release_count+1&&obs(s).button_is_down===false,'Button release was not observed');
   await page.waitForTimeout(180);const settled=await read(page);entry.states.buttonReleased=settled;
   check(obs(settled).button_press_count===before.button_press_count+1&&obs(settled).button_release_count===before.button_release_count+1,'Hold/release produces exactly one press and one release');
   check(obs(held).edge_readers_agree&&obs(released).edge_readers_agree&&obs(settled).edge_readers_agree,'Repeated input edge readers agree');
   entry.interactions.push({kind:'hold',id:'settings/apply',point:button,milliseconds:350,heldTicks:obs(held).button_held_ticks-before.button_held_ticks});

   const {g:sg,n:slider}=await control(page,'settings/volume'),start=point(sg,slider,.2),end=point(sg,slider,.8);
   await page.mouse.move(start.x,start.y);await page.mouse.down();
   const dragging=await until(page,s=>obs(s).slider_dragging&&Math.abs(obs(s).slider_value-20)<=1,'Slider did not start the real drag');
   await page.mouse.move(end.x,end.y,{steps:16});await page.waitForTimeout(140);const moved=await read(page);
   check(obs(moved).slider_dragging&&Math.abs(obs(moved).slider_value-80)<=1,'Real pointer drag changes project-owned slider value to 80%',obs(moved));
   await page.mouse.up();entry.states.slider=await until(page,s=>!obs(s).slider_dragging,'Slider drag did not end');
   check(Math.abs(obs(entry.states.slider).slider_value-80)<=1,'Slider value remains after release');
   entry.interactions.push({kind:'drag',id:slider.id,start,end,startValue:obs(dragging).slider_value,endValue:obs(entry.states.slider).slider_value});

   await click(page,'settings/quality');entry.states.comboExpanded=await until(page,s=>obs(s).combo_expanded,'Combobox did not expand');
   check(flat(entry.states.comboExpanded.world.ui.children).some(n=>n.id==='settings/quality-Studio'),'Expanded option is actual authored UI');
   await page.screenshot({path:join(out,viewport.name+'-combo-expanded.png')});
   const choicePoint=await click(page,'settings/quality-Studio');entry.states.comboSelected=await until(page,s=>obs(s).combo_selection==='Studio'&&!obs(s).combo_expanded,'Combobox selection did not apply');
   entry.checks.push('Real combobox click expands, then Studio choice updates and closes');entry.interactions.push({kind:'choose',id:'settings/quality-Studio',point:choicePoint});

   const beforeWheel=await read(page),beforeList=flat(beforeWheel.world.ui.children).find(n=>n.id==='preset-list'),wg=await geometry(page),view=wg.views.find(v=>v.id==='preset-list'),wheelPoint=point(wg,{rect:view.rect});
   await page.mouse.move(wheelPoint.x,wheelPoint.y);await page.mouse.wheel(0,500);
   const scrolled=await until(page,s=>{const n=flat(s.world.ui.children).find(n=>n.id==='preset-list');return n.scroll.virtual_items.first>beforeList.scroll.virtual_items.first&&n.scroll.virtual_items.last>beforeList.scroll.virtual_items.last;},'Real wheel did not change the materialized window');
   entry.states.listScrolled=scrolled;const afterList=flat(scrolled.world.ui.children).find(n=>n.id==='preset-list');
   check(afterList.children.length<obs(scrolled).list_row_count,'Virtual list keeps a bounded materialized subset',{materialized:afterList.children.length,total:obs(scrolled).list_row_count});
   await page.screenshot({path:join(out,viewport.name+'-list-scrolled.png')});
   const rg=await geometry(page),rows=rg.nodes.filter(n=>n.kind==='button'&&n.scrollOwner==='preset-list'&&n.clip&&n.rect.y>=n.clip.y&&n.rect.y+n.rect.height<=n.clip.y+n.clip.height);
   check(rows.length>0,'A fully visible row has a projected real hitbox');
   const row=rows[Math.floor(rows.length/2)],rowPoint=point(rg,row),selectionBefore=obs(await read(page)).list_selection_count;
   await page.mouse.click(rowPoint.x,rowPoint.y,{delay:110});entry.states.listSelected=await until(page,s=>obs(s).list_selected_key===row.virtualKey&&obs(s).list_selection_count===selectionBefore+1,'Real visible-row click did not select the key');
   check(obs(entry.states.listSelected).list_selected_key!=='preset-001','Scrolled visible-row selection uses its stable key');
   entry.interactions.push({kind:'wheel',point:wheelPoint,deltaY:500,beforeWindow:{first:beforeList.scroll.virtual_items.first,last:beforeList.scroll.virtual_items.last},afterWindow:{first:afterList.scroll.virtual_items.first,last:afterList.scroll.virtual_items.last},afterGeometry:rg.views});
   entry.interactions.push({kind:'row-click',id:row.id,key:row.virtualKey,point:rowPoint,rect:row.rect,clip:row.clip});
   await page.screenshot({path:join(out,viewport.name+'-final.png')});
   const endState=await read(page);check(obs(endState).edge_readers_agree===true,'Edge readers remain equal after all interactions');
   check(entry.errors.length===0&&entry.failedRequests.length===0,'No browser or failed-resource errors',{errors:entry.errors,failedRequests:entry.failedRequests});entry.ok=true;
  }catch(error){entry.failure=error.stack;report.errors.push(viewport.name+': '+error.message);await page.screenshot({path:join(out,viewport.name+'-failure.png')}).catch(()=>{});entry.last=await read(page).catch(()=>null);}
  finally{entry.fatal=await page.evaluate(()=>document.body.dataset.playerError??null).catch(()=>null);save();await context.close();}
 }
 report.ok=report.viewports.length===2&&report.viewports.every(v=>v.ok);
}catch(error){report.errors.push(error.stack);}
finally{save();await browser?.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify({ok:report.ok,out,viewports:report.viewports.map(v=>({name:v.viewport.name,ok:v.ok,checks:v.checks.length,failure:v.failure})),errors:report.errors},null,2));
if(!report.ok)process.exitCode=1;

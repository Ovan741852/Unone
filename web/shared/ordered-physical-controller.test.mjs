import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {createOrderedPhysicalRouter} from './ordered-physical-router.mjs';import {createOrderedPhysicalQueue} from './ordered-physical-queue.mjs';
import {createUiPointerRouter} from './canvas-ui.mjs';import {createHostInput} from './host-input.js';import {routeBrowserPointer,routeBrowserKey} from './player-input.js';
const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
class Target{
 events=new Map();addEventListener(k,f){this.events.set(k,[...this.events.get(k)??[],f]);}removeEventListener(k,f){this.events.set(k,(this.events.get(k)??[]).filter(x=>x!==f));}
 emit(type,patch={}){this.onEmit?.(type);const e={type,target:this,preventDefault(){},stopPropagation(){},...patch};for(const fn of [...this.events.get(type)??[]])fn(e);}
}
function fixture(slider=false,{initialFocus=true,focusCallSucceeds=false,synchronousWindowFocus=false,activate=true}={}){
 const canvas=new Target(),win=new Target(),doc=new Target();let actualFocus=initialFocus,focusCalls=0;doc.hidden=false;doc.hasFocus=()=>actualFocus;let clock=0,captureThrows=false;
 const entryTrace=[];for(const [name,target]of [['canvas',canvas],['window',win],['document',doc]])target.onEmit=type=>entryTrace.push({target:name,type,has_focus:actualFocus});
 Object.assign(canvas,{width:200,height:100,getBoundingClientRect:()=>({left:0,top:0,width:200,height:100}),focus:()=>{focusCalls++;if(focusCallSucceeds)actualFocus=true;if(synchronousWindowFocus)win.emit('focus');doc.emit('focusin',{target:canvas});},
  setPointerCapture:id=>{if(captureThrows)throw Error('capture denied');canvas.emit('gotpointercapture',{pointerId:id});}});
 const input=createHostInput(),actions=[],sliders=[],ui=createUiPointerRouter({onAction:e=>{actions.push(e);input.queueActionTransition(e.action,e.phase==='down');},onSlider:e=>{sliders.push(e);input.queueSliderInteraction(e);}});
 const rect={x:0,y:50,width:50,height:50},node=slider?{kind:'slider',id:'gain',rect,drag:{axis:'horizontal',reverse:false,enabled:true,track_rect:rect,hit_rect:rect}}:{kind:'button',id:'button',text:'button',action:'UI',rect};
 const tree=children=>({kind:'screen',id:'screen',node:'screen',children});ui.setTree(tree([node]));
 const errors=[],context={canvas,input,orderedQueue:null,orderedRouter:null,orderedEpoch:0,physicalProfile:'ordered_physical_v1',snapshot:{},hasWorldPointer:false,audio:null,
  uiRenderer:ui,textInputs:{setExternalInput(){},suspend(){},routeKey:()=>false,pointer:()=>false},uiScroll:{cancel(){},setExternalInput(){},pointer:()=>false,routeKey:()=>false,routeWheel:()=>false},routeBrowserPointer,routeBrowserKey,createOrderedPhysicalQueue,
  createOrderedPhysicalRouter:options=>createOrderedPhysicalRouter({...options,window:win,document:doc,nowUs:()=>++clock}),publishPhysical(){},fail:e=>errors.push(e),worldFromPointer:(_,e)=>({x:e.clientX,y:e.clientY})};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function pointer(event,down,kind){'),source.indexOf("canvas.addEventListener('pointerdown'")),context);
 vm.runInContext(source.slice(source.indexOf('function configurePhysical(){'),source.indexOf('async function json(')),context);context.configurePhysical();if(activate)context.orderedRouter.activate();
 const pointer=(phase,patch={})=>canvas.emit('pointer'+phase,{pointerId:-17,pointerType:'mouse',button:0,buttons:1,clientX:25,clientY:25,...patch});
 return{context,canvas,doc,win,input,ui,node,tree,actions,sliders,errors,pointer,entryTrace,setFocus:value=>actualFocus=value,focusCalls:()=>focusCalls,denyCapture:()=>captureThrows=true,rows:()=>context.orderedQueue.lease().events};
}
test('actual configured entry and real UI controller retain engine ownership across chord/outside/layout removal/disabled',()=>{
 for(const slider of [false,true]){
  const h=fixture(slider);h.pointer('down');h.pointer('move',{button:2,buttons:3,clientX:180});
  h.ui.setTree(h.tree(slider?[{...h.node,drag:{...h.node.drag,enabled:false}}]:[]));
  h.pointer('move',{button:2,buttons:1,clientX:190});h.pointer('up',{buttons:0,clientX:190});h.canvas.emit('lostpointercapture',{pointerId:-17});
  const events=h.rows();assert.deepEqual(events.filter(e=>e.kind==='pointer').map(e=>e.route),Array(4).fill('engine_ui'));
  const legacy=h.input.consumeFrame();assert.equal(legacy.pointer.down,false);assert.equal(legacy.actions.MouseRight,undefined);assert.equal(legacy.actions.MouseMiddle,undefined);
  assert.equal((slider?h.sliders:h.actions).filter(e=>e.phase==='cancel').length,1);assert.equal(h.errors.length,0);
 }
});
test('actual configured entry re-focuses canvas without losing first down and suppresses startup-held devices',()=>{
 const h=fixture();h.doc.emit('focusin',{target:{closest:()=>true}});h.pointer('down',{clientX:180,clientY:90});
 assert.equal(h.rows().filter(e=>e.kind==='pointer'&&e.phase==='down').length,1);assert.equal(h.input.consumeFrame().pointer.down,true);
 const held=fixture();held.pointer('move',{button:-1,clientX:180});held.win.emit('keydown',{code:'KeyA',location:0,repeat:true,isComposing:false});
 assert.equal(held.input.consumeFrame().pointer.down,false);assert.equal(held.input.consumeFrame().actions.A,undefined);
 assert.deepEqual(held.rows().filter(e=>e.kind==='pointer'||e.kind==='key').map(e=>e.route),['host_ui','host_ui']);
});
test('actual configured capture exception cancels UI and retains diagnostic reset before terminal shutdown',()=>{
 const h=fixture();h.denyCapture();h.pointer('down');assert.equal(h.errors.length,1);
 const report=h.context.orderedQueue.report();assert.match(report.fault,/capture denied/);assert.equal(report.last_pending.kind,'reset');assert.equal(report.last_pending.reason,'pointer_cancel');
 assert.equal(h.ui.capturedPointers.length,0);assert.equal(h.input.consumeFrame().pointer.down,false);
});
test('UI primary release inside a middle-button chord ends the existing UI stream at that edge',()=>{
 const h=fixture();h.pointer('down');h.pointer('move',{button:1,buttons:5});
 h.pointer('move',{button:0,buttons:4,clientX:180});assert.equal(h.ui.capturedPointers.length,0);
 assert.equal(h.actions.filter(e=>e.phase==='up').length,1);
 h.pointer('up',{button:1,buttons:0});assert.deepEqual(h.rows().filter(e=>e.kind==='pointer').map(e=>e.route),Array(4).fill('engine_ui'));
 assert.equal(h.input.consumeFrame().actions.MouseMiddle,undefined);
});
test('delayed window-focus event cannot drop a down when the document focus already confirms admission',()=>{
 const h=fixture(false,{initialFocus:false});h.setFocus(true);h.pointer('down',{clientX:180});h.win.emit('focus');h.pointer('up',{buttons:0,clientX:180});
 const rows=h.rows(),down=rows.findIndex(e=>e.kind==='pointer'&&e.phase==='down');
 assert.deepEqual(rows.filter(e=>e.kind==='pointer').map(e=>[e.phase,e.route]),[['down','game'],['up','game']]);
 assert.ok(rows.slice(0,down).some(e=>e.kind==='focus'&&e.scope==='window'&&e.focused&&e.origin==='host_synthetic'));
 assert.deepEqual(h.input.pendingPointerFrames.map(e=>e.pointer.down),[true,false]);assert.equal(h.errors.length,0);
});
test('eligible first down attempts canvas focus before reading cached window admission',()=>{
 const h=fixture(false,{initialFocus:false,focusCallSucceeds:true});h.pointer('down',{clientX:180});h.win.emit('focus');h.pointer('up',{buttons:0,clientX:180});
 assert.equal(h.focusCalls(),1);assert.deepEqual(h.rows().filter(e=>e.kind==='pointer').map(e=>[e.phase,e.route]),[['down','game'],['up','game']]);
 assert.deepEqual(h.input.pendingPointerFrames.map(e=>e.pointer.down),[true,false]);
});
test('unfocused rejected down leaves release and cancel host-owned, without inventing a game start',()=>{
 for(const phase of ['up','cancel']){
  const h=fixture(false,{initialFocus:false});h.pointer('down',{clientX:180});h.setFocus(true);h.win.emit('focus');h.pointer(phase,{buttons:0,clientX:180});
  assert.deepEqual(h.rows().filter(e=>e.kind==='pointer').map(e=>[e.phase,e.route]),[[phase,'host_ui']]);assert.equal(h.input.pendingPointerFrames.length,0);
 }
});
test('orphan up and held move are host-owned while normal hover and the next fresh press work',()=>{
 const h=fixture();h.pointer('up',{buttons:0,clientX:180});h.pointer('move',{button:-1,buttons:1,clientX:180});
 h.pointer('up',{buttons:0,clientX:180});h.pointer('move',{button:-1,buttons:0,clientX:180});h.pointer('down',{clientX:180});h.pointer('up',{buttons:0,clientX:180});
 assert.deepEqual(h.rows().filter(e=>e.kind==='pointer').map(e=>e.route),['host_ui','host_ui','host_ui','game','game','game']);
 assert.deepEqual(h.input.pendingPointerFrames.map(e=>[e.kind,e.pointer.down]),[['move',false],['edge',true],['edge',false]]);
});
test('focus acquisition never bypasses pause, hidden, readiness or disposal barriers',()=>{
 for(const gate of ['pause','hidden','disposed','not_ready']){
  const h=fixture(false,{initialFocus:false,focusCallSucceeds:true,activate:gate!=='not_ready'});
  if(gate==='pause')h.context.orderedRouter.setPaused(true);else if(gate==='hidden')h.doc.hidden=true;else h.context.orderedRouter.dispose();
  h.pointer('down',{clientX:180});assert.equal(h.focusCalls(),0);assert.equal(h.input.pendingPointerFrames.length,0);
 }
});
test('keyup without an admitted start stays host-owned after focus; real down/up retain game ownership',()=>{
 const key={code:'Equal',location:0,repeat:false,isComposing:false};
 const h=fixture(false,{initialFocus:false});h.win.emit('keydown',key);h.setFocus(true);h.win.emit('focus');h.win.emit('keyup',key);
 assert.deepEqual(h.rows().filter(e=>e.kind==='key').map(e=>[e.state,e.route]),[['up','host_ui']]);
 const normal=fixture();normal.win.emit('keydown',key);normal.win.emit('keyup',key);
 assert.deepEqual(normal.rows().filter(e=>e.kind==='key').map(e=>[e.state,e.route]),[['down','game'],['up','game']]);
});
test('UI key owner survives reset while prior game keys become host-owned without synthetic releases',()=>{
 const key={code:'ArrowDown',location:0,repeat:false,isComposing:false};
 for(const owner of ['engine_ui','game']){
  const h=fixture();h.context.uiScroll.routeKey=()=>owner==='engine_ui';h.win.emit('keydown',key);h.win.emit('blur');h.win.emit('focus');h.win.emit('keyup',key);
  const rows=h.rows();assert.deepEqual(rows.filter(e=>e.kind==='key').map(e=>[e.state,e.route]),[['down',owner],['up',owner==='engine_ui'?'engine_ui':'host_ui']]);
  assert.equal(rows.filter(e=>e.kind==='reset'&&e.reason==='blur').length,1);
 }
});
test('synchronous focus prelude is normalized before pointer admission, distinct from DOM callback entry order',()=>{
 const h=fixture(false,{initialFocus:false,focusCallSucceeds:true,synchronousWindowFocus:true});h.doc.emit('focusin',{target:{closest:()=>true}});
 h.entryTrace.length=0;h.pointer('down',{clientX:180});const rows=h.rows(),tail=rows.slice(-4);
 assert.deepEqual(h.entryTrace.map(e=>[e.target,e.type]),[['canvas','pointerdown'],['window','focus'],['document','focusin'],['canvas','gotpointercapture']]);
 assert.deepEqual(tail.map(e=>[e.kind,e.scope??e.phase??e.source]),[['focus','window'],['focus','game'],['pointer','down'],['capture','got']]);
 assert.deepEqual(tail.map(e=>e.origin),['browser','browser','browser','browser']);
 assert.deepEqual(tail.map(e=>e.sequence),[7,8,9,10]);assert.deepEqual(tail.map(e=>e.received_us),[7,8,9,10]);
 assert.equal(h.input.pendingPointerFrames[0].pointer.down,true);assert.equal(h.errors.length,0);
});
test('a nested device callback during focus prelude precedes the outer pointer admission without sequence holes',()=>{
 const h=fixture(false,{initialFocus:false,focusCallSucceeds:true,synchronousWindowFocus:true});h.doc.emit('focusin',{target:{closest:()=>true}});
 h.doc.addEventListener('focusin',()=>h.win.emit('keydown',{code:'KeyA',location:0,repeat:false,isComposing:false}));h.entryTrace.length=0;
 h.pointer('down',{clientX:180});const rows=h.rows(),tail=rows.slice(-5);
 assert.deepEqual(h.entryTrace.map(e=>e.type),['pointerdown','focus','focusin','keydown','gotpointercapture']);
 assert.deepEqual(tail.map(e=>e.kind),['focus','focus','key','pointer','capture']);
 assert.deepEqual(tail.map(e=>e.sequence),[7,8,9,10,11]);assert.deepEqual(tail.map(e=>e.received_us),[7,8,9,10,11]);
 assert.equal(tail[2].route,'game');assert.equal(tail[3].route,'game');assert.equal(h.input.consumeFrame().actions.A,true);assert.equal(h.errors.length,0);
});

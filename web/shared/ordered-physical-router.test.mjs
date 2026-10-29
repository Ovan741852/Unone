import {test} from 'node:test';import assert from 'node:assert/strict';
import {createOrderedPhysicalQueue} from './ordered-physical-queue.mjs';
const {createOrderedPhysicalRouter}=await import(process.env.UNONE_ORDERED_ROUTER_SOURCE??new URL('./ordered-physical-router.mjs',import.meta.url));
class Target{
 listeners=new Map();addEventListener(k,fn){const a=this.listeners.get(k)??[];a.push(fn);this.listeners.set(k,a);}
 removeEventListener(k,fn){this.listeners.set(k,(this.listeners.get(k)??[]).filter(x=>x!==fn));}
 emit(type,extra={}){const e={type,target:this,preventDefault(){this.prevented=true;},stopPropagation(){},...extra};for(const fn of [...this.listeners.get(type)??[]])fn(e);return e;}
}
function setup(routes={}){
 const canvas=new Target(),win=new Target(),doc=new Target();let us=0,rect={left:10,top:20,width:100,height:50};
 Object.assign(canvas,{width:400,height:200,getBoundingClientRect:()=>rect});win.devicePixelRatio=2;doc.hidden=false;doc.hasFocus=()=>true;
 const q=createOrderedPhysicalQueue({epoch:3}),calls=[];
 const router=createOrderedPhysicalRouter({canvas,window:win,document:doc,queue:q,nowUs:()=>++us,
  routePointer:(e,k,owner)=>{calls.push(k);return routes.pointer?.(e,k,canvas,owner)??owner??'game';},routeKey:e=>routes.key?.(e)??'game',routeWheel:e=>routes.wheel?.(e)??'game'});
 const rows=()=>q.lease().events;return{canvas,win,doc,q,router,calls,rows,setRect:r=>rect=r};
}
const pointer={pointerId:8,pointerType:'mouse',button:0,buttons:1,clientX:35,clientY:30,shiftKey:true};
test('actual router preserves reservation before nested capture, edge modifiers and continuous physical geometry',()=>{
 const s=setup({pointer:(e,k,c)=>{if(k==='down')c.emit('gotpointercapture',{pointerId:8});return 'engine_ui';}});
 s.canvas.emit('pointerdown',pointer);assert.equal(s.q.report().pending,0,'not admitted before READY');s.router.activate();
 s.canvas.emit('pointerdown',pointer);s.canvas.emit('pointermove',{...pointer,button:2,buttons:3,clientX:35.125,ctrlKey:true});
 const events=s.rows();assert.deepEqual(events.map(e=>e.kind),['reset','viewport','focus','pointer','capture','pointer']);
 assert.deepEqual(events.slice(3).map(e=>e.sequence),[4,5,6]);assert.equal(events[3].route,'engine_ui');
 assert.equal(events[3].point.x,100);assert.equal(events[3].point.y,40);assert.equal(events[5].point.x,100.5);
 assert.equal(events[3].modifiers.shift,true);assert.equal(events[5].modifiers.control,true);assert.equal(events[5].button,2);assert.equal(events[5].buttons,3);assert.deepEqual(s.calls,['down','move']);
});
test('rect position alone changes mapping identity, raw wheel units and key rows retain source order',()=>{
 const s=setup({key:()=> 'engine_ui',wheel:()=> 'engine_ui'});s.router.activate();s.setRect({left:11,top:20,width:100,height:50});
 s.canvas.emit('wheel',{deltaX:2,deltaY:-3,deltaZ:4,deltaMode:1,clientX:35,clientY:30,altKey:true});
 s.win.emit('keydown',{code:'ShiftRight',location:2,repeat:false,isComposing:false,shiftKey:true,getModifierState:k=>k==='AltGraph'});
 const rows=s.rows();assert.deepEqual(rows.slice(3).map(e=>e.kind),['viewport','wheel','key']);assert.equal(rows[3].viewport.revision,2);
 assert.deepEqual([rows[4].delta_y,rows[4].unit,rows[4].point.x],[-3,'line',96]);assert.equal(rows[5].modifiers.alt_graph,true);assert.equal(rows[5].location,2);assert.equal(rows[5].route,'engine_ui');
});
test('blur preserves queued edges and inserts one barrier; cancellation and lost capture do not duplicate release',()=>{
 const s=setup();s.router.activate();s.canvas.emit('pointerdown',pointer);s.canvas.emit('pointercancel',{...pointer,buttons:0});
 s.canvas.emit('lostpointercapture',{pointerId:8});s.win.emit('blur');s.win.emit('keydown',{code:'KeyA',location:0,repeat:false,isComposing:false});
 const rows=s.rows();assert.equal(rows.filter(e=>e.kind==='reset'&&e.scope==='pointer').length,1);
 assert.equal(rows.filter(e=>e.kind==='key').length,0);assert.equal(rows.filter(e=>e.kind==='pointer').length,2);
 assert.deepEqual(rows.slice(-2).map(e=>[e.kind,e.reason??e.focused]),[['focus',false],['reset','blur']]);
 s.router.dispose();const before=s.q.report().pending;s.win.emit('focus');s.canvas.emit('pointerdown',pointer);assert.equal(s.q.report().pending,before);
});
test('ordinary pointerup then capture loss has no synthetic cancel, active capture loss resets once',()=>{
 const s=setup();s.router.activate();s.canvas.emit('pointerdown',pointer);s.canvas.emit('pointerup',{...pointer,buttons:0});s.canvas.emit('lostpointercapture',{pointerId:8});
 s.canvas.emit('pointerdown',pointer);s.canvas.emit('lostpointercapture',{pointerId:8});s.canvas.emit('lostpointercapture',{pointerId:8});
 const rows=s.rows();assert.equal(rows.filter(e=>e.kind==='reset'&&e.reason==='lost_capture').length,1);assert.equal(rows.filter(e=>e.kind==='pointer'&&e.phase==='up').length,1);
});
test('first canvas down after editable focus restores game focus before admitting the down',()=>{
 const s=setup();s.router.activate();s.doc.emit('focusin',{target:{closest:()=>true}});s.canvas.emit('pointerdown',pointer);s.canvas.emit('pointerup',{...pointer,buttons:0});
 const rows=s.rows();assert.equal(rows.filter(e=>e.kind==='pointer'&&e.phase==='down').length,1);
 const down=rows.findIndex(e=>e.kind==='pointer');assert.equal(rows[down-1].kind,'focus');assert.equal(rows[down-1].focused,true);
});
test('signed browser IDs map to positive epoch IDs and reuse starts a fresh gesture after its capture tail',()=>{
 const s=setup();s.router.activate();s.canvas.emit('pointerdown',{...pointer,pointerId:-9});s.canvas.emit('gotpointercapture',{pointerId:-9});
 s.canvas.emit('pointerup',{...pointer,pointerId:-9,buttons:0});s.canvas.emit('lostpointercapture',{pointerId:-9});
 s.canvas.emit('pointerdown',{...pointer,pointerId:-9});const rows=s.rows().filter(e=>e.pointer_id!==undefined);
 assert.deepEqual(rows.map(e=>e.pointer_id),[1,1,1,1,2]);
});
test('UI gesture ownership remains through chord, outside movement and final up even after the hit disappears',()=>{
 let hit=true;const owners=[],s=setup({pointer:(e,k,c,owner)=>{owners.push(owner);return hit?'engine_ui':'game';}});s.router.activate();
 s.canvas.emit('pointerdown',pointer);hit=false;s.canvas.emit('pointermove',{...pointer,button:2,buttons:3,clientX:999});
 s.canvas.emit('pointerup',{...pointer,buttons:0,clientX:999});
 assert.deepEqual(s.rows().filter(e=>e.kind==='pointer').map(e=>e.route),['engine_ui','engine_ui','engine_ui']);assert.deepEqual(owners,[undefined,'engine_ui','engine_ui']);
});
test('capture/routing exception publishes a cancellation barrier then terminal fault without fake capture',()=>{
 const s=setup({pointer:()=>{throw Error('setPointerCapture failed');}});s.router.activate();assert.throws(()=>s.canvas.emit('pointerdown',pointer));
 assert.equal(s.q.report().pending,5);assert.match(s.q.report().fault,/ROUTE_FAILED/);assert.throws(()=>s.q.lease());
});
test('startup or resumed held pointer/repeated key never synthesizes a new game press',()=>{
 const s=setup();s.router.activate();s.canvas.emit('pointermove',{...pointer,button:-1});
 s.win.emit('keydown',{code:'KeyA',location:0,repeat:true,isComposing:false});
 const rows=s.rows();assert.deepEqual(rows.slice(3).map(e=>e.route),['host_ui','host_ui']);
});
test('source failure before row admission is still a visible terminal host fault',()=>{
 const s=setup();s.router.activate();s.canvas.focus=()=>{throw Error('focus failed');};
 assert.throws(()=>s.canvas.emit('pointerdown',pointer),/focus failed/);assert.match(s.q.report().fault,/TERMINAL/);
});
test('source key bookkeeping is bounded even for repeats without admitted starts',()=>{
 const s=setup();s.router.activate();for(let i=0;i<256;i++)s.win.emit('keydown',{code:'Fixture'+i,location:0,repeat:true,isComposing:false});
 assert.throws(()=>s.win.emit('keydown',{code:'Fixture256',location:0,repeat:true,isComposing:false}),/KEY_CAPACITY/);
});

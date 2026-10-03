import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiScrollHost} from './ui-scroll.mjs';

// Minimal DOM surface for controller lifecycle checks. Painted native rails,
// actual keyboard focus and touch dispatch are also exercised by the game UI test.
class Element {
 constructor(){this.style={};this.dataset={};this.children=[];this.events=new Map();this.hidden=false;this.scrollTop=0;this.scrollLeft=0;}
 append(child){child.parent=this;this.children.push(child);}
 remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
 setAttribute(){}
 addEventListener(type,fn){const fns=this.events.get(type)??[];fns.push(fn);this.events.set(type,fns);}
 removeEventListener(type,fn){this.events.set(type,(this.events.get(type)??[]).filter(f=>f!==fn));}
 dispatch(type,event={}){event.target??=this;event.preventDefault=()=>event.prevented=true;event.stopPropagation=()=>event.stopped=true;for(const fn of this.events.get(type)??[])fn(event);return event;}
 closest(){return null;}
 getBoundingClientRect(){return {left:0,top:0,width:1000,height:1000};}
 get clientWidth(){return this.style.width?.endsWith('%')?parseFloat(this.style.width)*10:1000;}
 get clientHeight(){return this.style.height?.endsWith('%')?parseFloat(this.style.height)*10:1000;}
 get scrollWidth(){return Math.max(this.clientWidth,...this.children.map(c=>parseFloat(c.style.width)||0));}
 get scrollHeight(){return Math.max(this.clientHeight,...this.children.map(c=>parseFloat(c.style.height)||0));}
}
const button=(id,y=0)=>({kind:'button',id,text:id,action:id,rect:{x:0,y,width:20,height:10}});
const view=(id,children,options={})=>({kind:'scroll_view',id,rect:{x:10,y:50,width:30,height:40},children,scroll:{axis:'vertical',enabled:true,reset_key:'',...options}});
const screen=children=>({ui:{kind:'screen',id:'screen',node:'screen',children}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t,snapshot,options={}){
 const previousDocument=globalThis.document,previousWindow=globalThis.window;
 const stage=new Element(),canvas=new Element(),win=new Element();
 globalThis.document={createElement:()=>new Element()};globalThis.window=win;
 let host;const state={snapshot,renders:0,focus:'',actions:[],errors:[]};
 host=createUiScrollHost({stage,canvas,onAction:a=>state.actions.push(a),onDiagnostic:e=>state.errors.push(e),getFocusedNode:()=>state.focus,focusNode:id=>{state.focus=id;return true;},requestRender:()=>{state.renders++;host.draw(state.snapshot);},...options});
 const draw=next=>{state.snapshot=next;return host.draw(next);};draw(snapshot);
 t.after(()=>{host.dispose();globalThis.document=previousDocument;globalThis.window=previousWindow;});
 return {host,stage,canvas,win,state,draw};
}
const wheel=(canvas,x,y,deltaY)=>canvas.dispatch('wheel',{clientX:x*10,clientY:(100-y)*10,deltaX:0,deltaY,deltaMode:0});

test('nested wheel chaining, ancestor-clipped rails and control-owned keys',t=>{
 const inner=view('inner',[button('deep',90)]);inner.rect={x:2,y:25,width:20,height:30};
 const outer=view('outer',[inner,button('tail',110)]);
 const slider={...button('slider'),kind:'slider',rect:{x:70,y:70,width:10,height:10}};
 const {host,stage,canvas,win,state}=harness(t,screen([outer,slider]));
 assert(wheel(canvas,15,60,1000).prevented);assert.equal(host.report()[1].offset.y,70);
 assert(wheel(canvas,15,60,100).prevented,'inner edge chains to outer');assert.equal(host.report()[0].offset.y,10);
 const innerRail=stage.children.find(n=>n.dataset.uiScrollbar==='inner'&&n.dataset.axis==='y');
 assert.notEqual(innerRail.style.clipPath,'none');
 const outside=wheel(canvas,90,10,100);assert(!outside.prevented);
 state.focus='slider';const owned=win.dispatch('keydown',{code:'ArrowDown'});assert(!owned.prevented,'slider keeps its keyboard input');
 state.focus='';host.pointer({pointerType:'mouse',pointerId:1},'cancel');assert(win.dispatch('keydown',{code:'End'}).prevented,'normal mouse capture release retains keyboard scroll ownership');
 assert.equal(host.report()[0].offset.y,host.report()[0].max.y);
 assert(innerRail.hidden,'nested rail disappears when completely outside parent clip');
});

test('disable retains offset; reset and unmount clean state, listeners and rails',t=>{
 const node=view('scroll',[button('tail',110)]),{host,stage,canvas,draw,win}=harness(t,screen([node]));
 wheel(canvas,15,70,200);const before=host.report()[0].offset.y;assert.equal(before,20);
 draw(screen([{...node,scroll:{...node.scroll,enabled:false}}]));
 assert(stage.children.every(n=>n.hidden));assert(!wheel(canvas,15,70,200).prevented);assert.equal(host.report()[0].offset.y,before);
 draw(screen([node]));assert.equal(host.report()[0].offset.y,before);
 draw(screen([{...node,scroll:{...node.scroll,reset_key:'new'}}]));assert.equal(host.report()[0].offset.y,0);
 draw(screen([]));assert.equal(stage.children.length,0);assert.deepEqual(host.report(),[]);
 host.dispose();assert.equal(win.events.get('keydown').length,0);assert.equal(canvas.events.get('wheel').length,0);assert.throws(()=>host.draw(screen([])),/UI_SCROLL_DISPOSED/);
});

function virtualNode(keys,first=1,last=3,revision=1){
 const node=view('rows',[]);node.rect.height=20;
 node.scroll.virtual_items={keys,columns:1,column_width:30,row_height:10,gap_x:0,gap_y:0,first,last,revision};
 node.children=keys.slice(first-1,last).map((key,i)=>({kind:'component',id:'row_'+key,rect:{x:0,y:(first-1+i)*10,width:30,height:10},children:[button('item_'+key,(first-1+i)*10)]}));
 return node;
}
test('100000 items use a bounded rail; pending requests coalesce and key focus waits for materialization',async t=>{
 const keys=Array.from({length:100000},(_,i)=>'k'+i),requests=[],pending=[];
 const {host,stage,state,draw}=harness(t,screen([virtualNode(keys)]),{requestWindow:request=>{requests.push(request);return new Promise(resolve=>pending.push(()=>{state.snapshot=screen([virtualNode(keys,request.first,request.last)]);resolve();}));}});
 assert.equal(stage.children.length,2,'only two rail elements, not one DOM row per item');
 assert(parseFloat(stage.children[1].children[0].style.height)<=1e6,'native scrollbar proxy is bounded');
 assert(host.scrollToKey('rows','k5000'));await flush();assert.equal(requests.length,1);
 assert(host.navigate('item_k0','End'));await flush();assert.equal(requests.length,1,'one request at a time');assert(host.isNavigating());
 pending.shift()();await flush();await flush();assert.equal(requests.length,2);assert.equal(requests[1].last,100000);assert(requests[1].last-requests[1].first<6);
 pending.shift()();await flush();await flush();assert.equal(state.focus,'item_k99999');assert(!host.isNavigating());assert(host.report()[0].materialized<=6);
 const oldOffset=host.report()[0].offset.y;
 draw(screen([virtualNode(['inserted',...keys],99998,100001,2)]));
 assert.equal(host.report()[0].offset.y,oldOffset+10,'prepend retains first visible stable key');
 draw(screen([]));await flush();assert.deepEqual(state.errors,[]);assert.equal(stage.children.length,0);
});

test('touch tap/swipe, second-pointer isolation, cancellation and blur do not fire stale actions',t=>{
 const {host,state,win}=harness(t,screen([view('touch',[button('tail',110)])]));
 const event=(id,x=150,y=350)=>({pointerType:'touch',pointerId:id,clientX:x,clientY:y});
 host.pointer(event(1),'down',{action:'tap'});host.pointer(event(2,950,950),'down',{action:'other'});host.pointer(event(2),'cancel');host.pointer(event(1),'up',{action:'tap'});
 assert.deepEqual(state.actions,['tap']);
 host.pointer(event(1),'down',{action:'tap'});host.pointer(event(1,150,100),'move');host.pointer(event(1),'up',{action:'tap'});assert.deepEqual(state.actions,['tap']);assert.equal(host.report()[0].offset.y,25);
 host.pointer(event(1),'down',{action:'tap'});host.pointer(event(1),'cancel');host.pointer(event(1),'up',{action:'tap'});
 host.pointer(event(1),'down',{action:'tap'});win.dispatch('blur');host.pointer(event(1),'up',{action:'tap'});assert.deepEqual(state.actions,['tap']);
});

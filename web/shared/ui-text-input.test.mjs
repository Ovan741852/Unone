import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiTextInputHost} from './ui-text-input.mjs';
import {createHostInput} from './host-input.js';
import {createCanvasUi,createUiPointerRouter} from './canvas-ui.mjs';
import {projectScrollTree} from './ui-scroll.mjs';
import {createOrderedPhysicalQueue} from './ordered-physical-queue.mjs';
import {createOrderedPhysicalRouter} from './ordered-physical-router.mjs';

class Target{
  listeners=new Map();style={};dataset={};children=[];
  addEventListener(type,fn){const a=this.listeners.get(type)??[];a.push(fn);this.listeners.set(type,a);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)??[]).filter(f=>f!==fn));}
  emit(type,props={}){const e={type,target:this,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...props};
    for(const fn of [...this.listeners.get(type)??[]]){fn(e);if(e.stopped)break;}return e;}
  append(el){this.children.push(el);el.parent=this;}
  remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
  setAttribute(key,value){this[key]=value;}
}
function setup(){
  const win=new Target(),doc=new Target(),body=new Target(),canvas=new Target(),input=createHostInput();
  Object.assign(doc,{body,defaultView:win,activeElement:canvas,hidden:false});
  let bounds={left:10,top:146.5,width:1591,height:894.9375},redraws=0,focuses=0;
  canvas.ownerDocument=doc;canvas.getBoundingClientRect=()=>bounds;
  doc.createElement=()=>{const el=new Target();el.value='';el.selectionStart=el.selectionEnd=0;
    el.focus=()=>{focuses++;doc.activeElement=el;};
    el.blur=()=>{if(doc.activeElement===el)doc.activeElement=canvas;el.emit('blur');};
    el.setSelectionRange=(start,end)=>{el.selectionStart=start;el.selectionEnd=end;};return el;};
  const events=[],host=createUiTextInputHost({canvas,onInteraction:e=>{events.push(e);input.queueTextInputInteraction(e);},
    releaseKeyboard:()=>input.releaseKeyboard(),requestRender:()=>redraws++});
  const node=(extra={})=>({kind:'text_input',id:'nickname',rect:{x:30,y:40,width:40,height:10},text:'',placeholder:'你的稱呼',max_length:8,focused:true,...extra});
  const draw=(extra={})=>host.draw({world:{ui:{children:[node(extra)]}}});
  const sink=()=>body.children[0];
  const key=(code,extra={})=>win.emit('keydown',{code,key:code,...extra});
  return {win,doc,body,canvas,input,host,events,node,draw,sink,key,setBounds:v=>bounds=v,
    get redraws(){return redraws;},get focuses(){return focuses;}};
}

test('official native sink accepts IME commit once; Enter chooses candidate before submitting',()=>{
  const s=setup();s.draw();assert.equal(s.events[0].phase,'focus');
  const el=s.sink();el.emit('compositionstart');el.value='小';el.emit('input',{isComposing:true});
  assert.equal(s.key('Enter',{isComposing:true,keyCode:229}).prevented,undefined);
  assert.equal(s.events.filter(e=>e.phase==='submit').length,0);
  el.value='小龍女';el.emit('compositionend');el.emit('input',{isComposing:false});
  assert.equal(s.events.filter(e=>e.phase==='change'&&!e.composing&&e.text==='小龍女').length,1);
  assert.equal(s.key('Enter').prevented,true);s.key('Enter',{repeat:true});
  assert.deepEqual(s.events.filter(e=>e.phase==='submit'),[{id:'nickname',phase:'submit',text:'小龍女',composing:false}]);
  assert.equal(s.host.report().composing,false);s.host.dispose();
});

test('paste, native deletion and selection keep default behavior while shortcuts never reach game',()=>{
  const s=setup();s.input.queuePhysicalAction('W',true);assert.equal(s.input.consumeFrame().actions.W,true);
  s.draw();assert.equal(s.input.consumeFrame().actions.W,undefined);
  let leaked=0;s.win.addEventListener('keydown',()=>leaked++);
  for(const code of ['KeyW','KeyB','KeyC','ArrowLeft','Backspace','KeyV','KeyA'])assert.equal(s.key(code,{ctrlKey:code==='KeyV'||code==='KeyA'}).prevented,undefined);
  assert.equal(leaked,0);const el=s.sink();el.value='任我行42';el.emit('input',{inputType:'insertFromPaste'});
  el.setSelectionRange(0,3);el.emit('select');const view=s.draw();
  assert.equal(view.world.ui.children[0].text,'任我行42');assert.equal(view.world.ui.children[0].text_edit.selection_end,3);
  el.value='42';el.emit('input',{inputType:'deleteContentBackward'});assert.equal(s.events.at(-1).text,'42');
  assert.deepEqual(s.input.consumeFrame().actions,{});s.host.dispose();
});

test('immutable successful-tick echoes do not replace focused draft, selection or composition',()=>{
  const s=setup();s.draw({text:'原名'});const el=s.sink();el.value='原名新';el.setSelectionRange(1,2);el.emit('compositionstart');el.emit('input',{isComposing:true});
  for(let i=0;i<10;i++)s.draw({text:i%2?'原':'原名'});
  assert.equal(s.focuses,1);assert.equal(el.value,'原名新');assert.deepEqual([el.selectionStart,el.selectionEnd],[1,2]);
  assert.equal(s.host.report().composing,true);assert.equal(s.draw({text:'原名新'}).world.ui.children[0].text,'原名新');s.host.dispose();
});

test('max_length counts Unicode scalars and waits until composition finishes',()=>{
  const s=setup();s.draw({max_length:2});const el=s.sink();el.emit('compositionstart');el.value='俠𠮷客';el.emit('input',{isComposing:true});
  assert.equal(el.value,'俠𠮷客');s.draw({text:'俠𠮷客',max_length:2});assert.equal(el.value,'俠𠮷客');
  el.setSelectionRange(4,4);el.emit('compositionend');assert.equal(el.value,'俠𠮷');assert.equal(el.selectionStart,3);
  assert.equal(s.events.at(-1).composing,false);s.host.dispose();
});

test('IME sink follows CSS letterboxing and resize without DPR or duplicate viewport offset',()=>{
  const s=setup();s.draw();const el=s.sink();
  const near=(actual,expected)=>assert(Math.abs(parseFloat(actual)-expected)<1e-8);
  near(el.style.left,10+.3*1591);near(el.style.top,146.5+.5*894.9375);
  near(el.style.width,.4*1591);near(el.style.height,.1*894.9375);
  s.setBounds({left:0,top:0,width:1920,height:1080});s.win.emit('resize');
  assert.equal(parseFloat(el.style.left),576);assert.equal(parseFloat(el.style.top),540);assert.equal(s.focuses,1);s.host.dispose();
});

test('field removal or disable cancels focus, consumes pending pointer release and cleans listeners',async()=>{
  const s=setup();s.draw();const el=s.sink();
  assert.equal(s.host.pointer({pointerId:9,preventDefault(){}},'down',{kind:'text_input',nodeId:'nickname'}),true);
  s.host.draw({world:{ui:{children:[]}}});assert.equal(s.events.at(-1).phase,'cancel');assert.equal(s.host.report().focused,null);
  assert.equal(s.host.pointer({pointerId:9},'up',null),true);s.draw();s.draw({enabled:false});assert.equal(s.host.report().focused,null);
  s.host.dispose();assert.equal(s.body.children.length,0);const count=s.events.length;
  el.emit('input');s.win.emit('blur');await Promise.resolve();assert.equal(s.events.length,count);
  assert.equal([...s.win.listeners.values()].flat().length,0);assert.equal([...s.doc.listeners.values()].flat().length,0);
});

test('Escape during composition belongs to IME; settled Escape cancels without game key leakage',()=>{
  const s=setup();s.draw();s.sink().emit('compositionstart');const ime=s.key('Escape',{isComposing:true});
  assert.equal(ime.prevented,undefined);assert.equal(s.host.report().focused,'nickname');
  s.sink().emit('compositionend');const settled=s.key('Escape');assert.equal(settled.prevented,true);assert.equal(s.host.report().focused,null);
  assert.equal(s.events.at(-1).phase,'cancel');assert.equal(s.win.emit('keyup',{code:'Escape'}).stopped,true);s.host.dispose();
});

test('suspend and blur leave focus closed until fresh pointer or an explicit false-to-true focus request',async()=>{
  const s=setup();s.draw();s.host.suspend();s.draw();assert.equal(s.host.report().focused,null);
  s.draw({focused:false});s.draw();assert.equal(s.host.report().focused,'nickname');
  s.doc.activeElement=s.canvas;s.sink().emit('blur');await Promise.resolve();assert.equal(s.events.at(-1).phase,'blur');
  s.draw();assert.equal(s.host.report().focused,null);s.host.dispose();
});

test('global blur, hidden and pause discard stale pointer capture before the next field gesture',async()=>{
  for(const barrier of ['blur','hidden','pause','sink-blur']){
    const s=setup();s.draw();const pointer={pointerId:11,preventDefault(){}},hit={kind:'text_input',nodeId:'nickname'};
    s.host.pointer(pointer,'down',hit);s.key('KeyB');
    if(barrier==='blur')s.win.emit('blur');
    else if(barrier==='hidden'){s.doc.hidden=true;s.doc.emit('visibilitychange');s.doc.hidden=false;}
    else if(barrier==='pause')s.host.suspend();
    else{s.doc.activeElement=new Target();s.sink().emit('blur');await Promise.resolve();}
    s.draw();assert.equal(s.host.report().focused,null,barrier);
    assert.equal(s.host.routeKey({code:'KeyB'},false),false,`${barrier}: old keys are retired`);
    assert.equal(s.host.pointer(pointer,'down',hit),true);assert.equal(s.host.report().focused,'nickname',`${barrier}: first fresh down focuses`);
    assert.equal(s.host.pointer(pointer,'up',hit),true);s.host.dispose();
  }
});

test('the brief ordered canvas focus prelude does not cancel a same-field edit',async()=>{
  const s=setup();s.draw();const el=s.sink();el.value='黃蓉';el.emit('input');
  s.doc.activeElement=s.canvas;el.emit('blur');s.host.pointer({pointerId:1,preventDefault(){}},'down',{kind:'text_input',nodeId:'nickname'});
  await Promise.resolve();assert.equal(s.events.filter(e=>e.phase==='blur').length,0);assert.equal(s.focuses,2);assert.equal(el.value,'黃蓉');s.host.dispose();
});

test('official IME focus keeps ordered pointer-up admission and repeated field clicks intact',async()=>{
  const s=setup(),queue=createOrderedPhysicalQueue({epoch:1});let clock=0;
  s.doc.hasFocus=()=>true;Object.assign(s.canvas,{width:1920,height:1080,tabIndex:0});
  s.canvas.focus=()=>{if(s.doc.activeElement!==s.canvas)s.doc.activeElement?.emit?.('blur');s.doc.activeElement=s.canvas;s.doc.emit('focusin',{target:s.canvas});};
  const create=s.doc.createElement;s.doc.createElement=()=>{const el=create();const focus=el.focus;
    el.focus=()=>{focus();s.doc.emit('focusin',{target:el});};el.closest=()=>el;return el;};
  const router=createOrderedPhysicalRouter({canvas:s.canvas,window:s.win,document:s.doc,queue,nowUs:()=>++clock,
    routePointer:(e,kind)=>s.host.pointer(e,kind,{kind:'text_input',nodeId:'nickname'})?'engine_ui':'game'});
  router.activate();s.draw();
  const event={pointerId:2,pointerType:'mouse',button:0,buttons:1,clientX:800,clientY:600};
  for(let i=0;i<2;i++){s.canvas.emit('pointerdown',event);s.canvas.emit('pointerup',{...event,buttons:0});await Promise.resolve();
    assert.equal(s.host.report().focused,'nickname');assert.equal(s.doc.activeElement,s.sink());}
  assert.deepEqual(queue.lease().events.filter(e=>e.kind==='pointer').map(e=>[e.phase,e.route]),
    [['down','engine_ui'],['up','engine_ui'],['down','engine_ui'],['up','engine_ui']]);
  assert.equal(queue.lease().events.filter(e=>e.kind==='focus'&&!e.focused).length,0);router.dispose();s.host.dispose();
});

test('ordered mode records UI-owned keys and release tails while preventing gameplay actions',()=>{
  const s=setup(),queue=createOrderedPhysicalQueue({epoch:3});let clock=0;
  s.doc.hasFocus=()=>true;Object.assign(s.canvas,{width:1920,height:1080,tabIndex:0});s.host.setExternalInput(true);
  const router=createOrderedPhysicalRouter({canvas:s.canvas,window:s.win,document:s.doc,queue,nowUs:()=>++clock,
    routeKey:(e,state,owner)=>{
      if(owner==='engine_ui'){s.host.routeKey(e,state==='down');return owner;}
      if(s.host.routeKey(e,state==='down'))return 'engine_ui';
      s.input.queuePhysicalAction(e.code,state==='down');return 'game';
    }});
  router.activate();s.draw();const key=(type,code)=>s.win.emit(type,{code,key:code,location:0,repeat:false,isComposing:false,target:s.sink()});
  key('keydown','KeyB');key('keyup','KeyB');key('keydown','Enter');
  s.host.draw({world:{ui:{children:[]}}});key('keyup','Enter');
  const rows=queue.lease().events.filter(e=>e.kind==='key');
  assert.deepEqual(rows.map(e=>[e.code,e.state,e.route]),[['KeyB','down','engine_ui'],['KeyB','up','engine_ui'],['Enter','down','engine_ui'],['Enter','up','engine_ui']]);
  assert.equal(s.events.filter(e=>e.phase==='submit').length,1);assert.deepEqual(s.input.consumeFrame().actions,{});
  router.dispose();s.host.dispose();
});

test('foreground controls and disabled scroll ancestors preserve semantic hit order',()=>{
  const s=setup(),input=s.node({focused:false}),r=createUiPointerRouter();
  r.setTree({children:[input,{kind:'button',id:'cover',rect:input.rect,text:'OK',action:'Accept'}]});
  assert.equal(r.hitTest(35,45).action,'Accept');
  r.setTree({children:[{kind:'button',id:'cover',rect:input.rect,text:'OK',action:'Accept'},input]});
  assert.equal(r.hitTest(35,45).kind,'text_input');
  const projected=projectScrollTree({children:[{kind:'scroll_view',id:'list',rect:{x:10,y:10,width:80,height:80},
    scroll:{axis:'vertical',enabled:false},children:[s.node({rect:{x:2,y:2,width:40,height:10}})]}]}).tree;
  s.host.draw({ui:projected});assert.equal(s.host.report().focused,null);s.host.dispose();
});

test('text input queue keeps change, submit and lifecycle barriers in per-field order',()=>{
  const i=createHostInput(),q=(phase,text,composing=false,id='name')=>i.queueTextInputInteraction({id,phase,text,composing});
  q('focus','');q('change','a');q('change','ab');q('change','中文',true);q('change','中文');q('submit','中文');i.releaseAll();
  const frames=[];for(let n=0;n<6;n++)frames.push(i.consumeFrame().ui_text_inputs.name);
  assert.deepEqual(frames.map(e=>e.phase),['focus','change','change','change','submit','cancel']);
  assert.equal(frames[1].text,'ab');assert.equal(frames[2].composing,true);assert.equal(i.consumeFrame().ui_text_inputs,undefined);
  q('change','x',false,'__proto__');assert.deepEqual(Object.keys(i.consumeFrame().ui_text_inputs),['__proto__']);
  for(const event of [{id:'',phase:'change',text:'',composing:false},{id:'x',phase:'typing',text:'',composing:false},
    {id:'x',phase:'submit',text:'',composing:true},{id:'x',phase:'change',text:'a'.repeat(65537),composing:false}])assert.throws(()=>i.queueTextInputInteraction(event),/UI_TEXT_INPUT_INVALID/);
});

test('official canvas draws placeholder, draft, selection and caret without mutating model tree',()=>{
  const calls=[],ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},setTransform(){},clearRect(){},
    fillText(text){calls.push(text);},fillRect(...r){calls.push(r);},measureText:text=>({width:text.length*10}),globalAlpha:1};
  const canvas={width:100,height:100,getContext:()=>ctx},ui=createCanvasUi(canvas),s=setup();
  const tree={ui:{children:[s.node({text:'',focused:false})]}};ui.draw(tree,{width:100,height:100,dpr:1});assert(calls.includes('你的稱呼'));
  const draft={ui:{children:[s.node({text:'郭靖',text_edit:{focused:true,selection_start:2,selection_end:2}})]}};
  ui.draw(draft,{width:100,height:100,dpr:1});assert(calls.includes('郭靖'));assert(calls.some(x=>Array.isArray(x)&&x[2]===1));
  assert.equal(tree.ui.children[0].text,'');ui.dispose();s.host.dispose();
});

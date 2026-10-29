// Ordered physical facts only. Device scan codes and command policies are game-owned.
function modifiers(e){
 const m={shift:!!e.shiftKey,control:!!e.ctrlKey,alt:!!e.altKey,meta:!!e.metaKey};
 if(typeof e.getModifierState==='function')for(const [key,name]of [['alt_graph','AltGraph'],['caps_lock','CapsLock'],['num_lock','NumLock']])m[key]=!!e.getModifierState(name);
 return m;
}
function createGeometry(canvas,win,queue,common){
 let revision=0,mapping=null,signature='';
 function viewport(){
  const r=canvas.getBoundingClientRect(),v={width:canvas.width,height:canvas.height,rect_left:r.left,rect_top:r.top,
   css_width:r.width,css_height:r.height,device_pixel_ratio:win.devicePixelRatio||1},next=JSON.stringify(v);
  if(next!==signature){mapping={revision:++revision,...v};queue.append({...common('viewport','control','host_synthetic'),viewport:mapping});signature=next;}
  return mapping;
 }
 function point(e){const v=viewport(),x=(e.clientX-v.rect_left)*v.width/v.css_width,y=(e.clientY-v.rect_top)*v.height/v.css_height;
  return{x,y,inside:x>=0&&y>=0&&x<v.width&&y<v.height,viewport:{...v}};
 }
 return{viewport,point,revision:()=>revision};
}
function createPointerSession({canvas,queue,common,point,active,isReady,beforeDown,listen,reset,routePointer,routeCapture}){
 const pointers=new Map();let serial=0;
 function identity(raw,start=false){
  if(!Number.isInteger(raw)||raw< -2147483648||raw>2147483647)queue.terminate('POINTER_SOURCE_ID_UNSUPPORTED');
  let p=pointers.get(raw);
  if(start&&p){if(p.buttons||p.captured)queue.terminate('POINTER_REUSE_BEFORE_CAPTURE_TAIL');p=null;}
  if(!p){if(pointers.size>=256&&!pointers.has(raw))queue.terminate('POINTER_CAPACITY');
   if(!Number.isSafeInteger(++serial))queue.terminate('POINTER_ID_EXHAUSTED');
   p={id:serial,buttons:0,captured:false,owner:undefined,started:false};pointers.set(raw,p);}
  return p;
 }
 function pointer(e,phase){
  if(phase==='down')beforeDown();
  if(!active())return;const state=identity(e.pointerId,phase==='down'),p=phase==='cancel'?undefined:point(e),buttons=e.buttons??0;
  if(phase==='down')state.started=true;else if(!state.started&&(buttons||phase==='up'||phase==='cancel'))state.owner??='host_ui';
  state.buttons=buttons;
  queue.admit({...common('pointer','game'),pointer_id:state.id,pointer_type:e.pointerType,phase,button:e.button??-1,buttons,
   ...(p?{point:p}:{}),modifiers:modifiers(e)},()=>{
    const owner=routePointer(e,phase,state.owner);state.owner??=owner;return state.owner;
   },()=>{routeCapture(e);reset('pointer_cancel',state.id);});
  if(phase==='cancel')reset('pointer_cancel',state.id);
  if(!buttons&&phase!=='cancel'){state.owner=undefined;state.started=false;}
 }
 function capture(e,captured){
  if(!isReady())return;const p=identity(e.pointerId);p.captured=captured;
  queue.append({...common('capture'),pointer_id:p.id,captured,source:captured?'got':'lost'});
  if(!captured)routeCapture(e);
  if(!captured&&p.buttons!==0)reset('lost_capture',p.id);
 }
 for(const phase of ['down','up','move','cancel'])listen(canvas,'pointer'+phase,e=>pointer(e,phase));
 listen(canvas,'pointerout',e=>{const p=pointers.get(e.pointerId);if(p&&!(e.buttons??p.buttons)&&!p.captured)pointers.delete(e.pointerId);});
 listen(canvas,'gotpointercapture',e=>capture(e,true));listen(canvas,'lostpointercapture',e=>capture(e,false));
 return{reset(id){for(const p of pointers.values())if(id===undefined||p.id===id){p.buttons=0;p.started=false;if(p.owner!=='engine_ui')p.owner='host_ui';}},dispose:()=>pointers.clear()};
}
function createKeySession({win,queue,common,active,listen,routeKey}){
 const keys=new Map();
 function key(e,state){
  if(!active())return;
  const id=e.code+':'+e.location;if(state==='down'&&!e.repeat)keys.delete(id);
  if(!keys.has(id)&&keys.size>=256)queue.terminate('KEY_CAPACITY');
  if((state==='up'||e.repeat)&&!keys.has(id))keys.set(id,'host_ui');
  queue.admit({...common('key','game'),code:e.code||'Unidentified',location:e.location,state,repeat:!!e.repeat,is_composing:!!e.isComposing,modifiers:modifiers(e)},()=>{
   const owner=keys.get(id),routed=routeKey(e,state,owner);keys.set(id,owner??routed);return owner??routed;
  });if(state==='up')keys.delete(id);
 }
 listen(win,'keydown',e=>key(e,'down'),true);listen(win,'keyup',e=>key(e,'up'),true);
 return{reset(){for(const [key,owner]of keys)keys.set(key,owner==='engine_ui'?owner:'host_ui');},dispose:()=>keys.clear()};
}
export function createOrderedPhysicalRouter({canvas,window:win=window,document:doc=document,queue,nowUs=()=>Math.floor(performance.now()*1000),
 routePointer=()=> 'game',routeKey=()=> 'game',routeWheel=()=> 'game',routeCapture=()=>{},onError=error=>{throw error;}}){
 let ready=false,disposed=false,paused=false,focused=true,gameFocused=true;const listeners=[],previousTabIndex=canvas.tabIndex;canvas.tabIndex=0;
 const active=()=>ready&&!disposed&&!paused&&!doc.hidden&&focused&&gameFocused;
 const common=(kind,route='control',origin='browser')=>({kind,route,origin,received_us:nowUs()});
 function listen(target,type,fn,options){
  const wrapped=e=>{if(disposed)return;try{fn(e);}catch(error){
   if(!queue.report().fault)try{queue.terminate(error.message??String(error));}catch{}onError(error);
  }};
  target.addEventListener(type,wrapped,options);listeners.push(()=>target.removeEventListener(type,wrapped,options));
 }
 const geometry=createGeometry(canvas,win,queue,common);
 function reset(reason,id){
  queue.append({...common('reset','control','host_synthetic'),scope:id===undefined?'all':'pointer',...(id===undefined?{}:{pointer_id:id}),reason});
  pointers.reset(id);if(id===undefined)keys.reset();
 }
 function focus(value,scope,reason,origin='browser'){if(!ready)return;queue.append({...common('focus','control',origin),focused:value,scope});if(!value)reset(reason);}
 function beforeDown(){
  if(!ready||disposed||paused||doc.hidden)return;canvas.focus?.({preventScroll:true});
  const current=doc.hasFocus?.()??focused;
  if(current!==focused){focused=current;focus(current,'window','blur','host_synthetic');}
  if(focused&&!gameFocused){gameFocused=true;focus(true,'game',undefined,'host_synthetic');}
 }
 const pointers=createPointerSession({canvas,queue,common,point:geometry.point,active,isReady:()=>ready,beforeDown,listen,reset,routePointer,routeCapture});
 const keys=createKeySession({win,queue,common,active,listen,routeKey});
 function wheel(e){
  if(!active())return;const p=geometry.point(e),unit=['pixel','line','page'][e.deltaMode];
  queue.admit({...common('wheel','game'),delta_x:e.deltaX,delta_y:e.deltaY,delta_z:e.deltaZ,unit,point:p,modifiers:modifiers(e)},()=>routeWheel(e));
 }
 // The official IME sink is still game UI. Its focus must not suspend canvas
 // pointer admission before the owning text-field gesture receives its up.
 const hostTarget=e=>e.target?.dataset?.unoneTextInput===undefined&&!!e.target?.closest?.('input,textarea,select,[contenteditable=true],#unone-developer');
 listen(canvas,'wheel',wheel,{passive:false});
 listen(win,'blur',()=>{focused=false;focus(false,'window','blur');});listen(win,'focus',()=>{focused=true;focus(true,'window');});
 listen(doc,'visibilitychange',()=>{if(ready&&doc.hidden)reset('hidden');});
 listen(win,'unone-host-pause',()=>{paused=true;if(ready)reset('host_pause');});listen(win,'unone-host-resume',()=>{paused=false;});
 listen(doc,'focusin',e=>{const next=!hostTarget(e);if(next===gameFocused)return;gameFocused=next;focus(next,'game','focus_left_game');});
 listen(win,'resize',()=>{if(active())geometry.viewport();});listen(win,'scroll',()=>{if(active())geometry.viewport();},true);
 return{
  activate(){if(disposed||ready)return;ready=true;focused=doc.hasFocus?.()??true;reset('load');geometry.viewport();focus(focused,'window','blur');},
  setPaused(value){if(paused===value)return;paused=value;if(value&&ready)reset('host_pause');},
  report:()=>({...queue.report(),admission:disposed?'disposed':active()?'active':ready?'suspended':'waiting_ready',viewport_revision:geometry.revision()}),
  dispose(){if(disposed)return;disposed=true;for(const remove of listeners)remove();pointers.dispose();keys.dispose();canvas.tabIndex=previousTabIndex;},
 };
}

// Reusable scroll projection/controller. No game identifiers or rules.
import {uiTreeGeneration} from './ui-tree-publication.mjs';
// Authority is private: a caller-frozen object is still a mutable/raw input to
// this contract. Cache only decoded immutable publications or our own sealed
// projections, and retain just the last offset configuration per weak tree.
const projections=new WeakMap(),projectionGenerations=new WeakMap();
export const uiProjectionGeneration=tree=>tree&&typeof tree==='object'?projectionGenerations.get(tree):undefined;
const top=r=>100-r.y-r.height;
const inside=(r,x,y)=>r&&x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height;
const clamp=(v,max)=>Math.max(0,Math.min(max,v));
const intersect=(a,b)=>{if(!a)return b;if(!b)return a;const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};};
export function scrollExtent(node){
 const v=node.scroll.virtual_items;
 if(v){const rows=Math.ceil(v.keys.length/v.columns);return {width:v.columns*v.column_width+(v.columns-1)*v.gap_x,height:rows?rows*v.row_height+(rows-1)*v.gap_y:0};}
 let width=0,height=0;
 function walk(nodes){for(const n of nodes??[]){width=Math.max(width,n.rect.x+n.rect.width);height=Math.max(height,n.rect.y+n.rect.height);if(n.kind==='component')walk(n.children);}}
 walk(node.children);return {width,height};
}
export function virtualWindow(v,offset,height){
 if(!v.keys.length)return {first:0,last:0};
 const pitch=v.row_height+v.gap_y,rows=Math.ceil(v.keys.length/v.columns);
 const start=Math.max(0,Math.floor(offset/pitch)-1),end=Math.min(rows,Math.ceil((offset+height)/pitch)+1);
 return {first:start*v.columns+1,last:Math.min(v.keys.length,end*v.columns)};
}
export function projectScrollTree(tree,offsets=null){
 const generation=uiTreeGeneration(tree)??uiProjectionGeneration(tree),cached=generation&&projections.get(tree);
 if(cached&&cached.generation===generation&&cached.offsets.every(saved=>{const current=offsets?.get(saved.id);return saved.x===(current?.x??0)&&saved.y===(current?.y??0);}))return cached.result;
 const leaves=[],views=[],offsetKeys=generation?[]:null,seal=value=>generation?Object.freeze(value):value;
 function walk(nodes,space=null,clip=null,enabled=true,owner=null,item=null){
  for(const n of nodes??[]){
   if(n.kind==='image_batch'&&space)throw Error(`UI_IMAGE_BATCH_SPACE: ${n.id}; image batches require stage coordinates`);
   const projectRect=rect=>space?seal({...rect,x:space.x+rect.x,y:100-space.top-rect.y-rect.height}):rect;
   const r=projectRect(n.rect),drag=n.drag?seal({...n.drag,track_rect:projectRect(n.drag.track_rect),hit_rect:projectRect(n.drag.hit_rect)}):undefined;
   if(n.kind==='component'){walk(n.children,space,clip,enabled,owner,item);continue;}
   if(n.kind==='scroll_view'){
    const extent=scrollExtent(n),maxX=n.scroll.axis==='vertical'?0:Math.max(0,extent.width-r.width),maxY=n.scroll.axis==='horizontal'?0:Math.max(0,extent.height-r.height);
    const saved=offsets?.get(n.id),x=saved?.x??0,y=saved?.y??0,offset=seal({x:clamp(x,maxX),y:clamp(y,maxY)}),visible=seal(intersect(clip,r)),active=enabled&&n.scroll.enabled;
    if(offsetKeys)offsetKeys.push({id:n.id,x,y});
    views.push(seal({id:n.id,node:n,rect:r,clip:visible,parentClip:clip,extent:seal(extent),maxX,maxY,offset,enabled:active,wheelRect:n.scroll.wheel_rect??visible}));
    if(visible.width>0&&visible.height>0)leaves.push(seal({kind:'text',id:n.id,text:'',rect:r,clip:visible}));
    const v=n.scroll.virtual_items;
    for(const [i,child]of (n.children??[]).entries())walk([child],{x:r.x-offset.x,top:top(r)-offset.y},visible,active,n.id,v?{key:v.keys[v.first-1+i],index:v.first-1+i,count:v.keys.length}:null);
    continue;
   }
   const c=intersect(clip,n.clip);if(c&&(c.width<=0||c.height<=0))continue;
   if(!enabled&&n.kind==='input_region')continue;
   leaves.push(seal({...n,rect:r,...(drag?{drag}:{}),...(c?{clip:seal(c)}:{}),...(!enabled&&['button','slider','combobox'].includes(n.kind)?{kind:'text',action:undefined,drag:undefined}:{}),...(!enabled&&n.kind==='text_input'?{enabled:false,focused:false}:{}),...(owner?{scrollOwner:owner}:{}),...(item?{virtualKey:item.key,virtualIndex:item.index,virtualCount:item.count}:{} )}));
  }
 }
 walk(tree?.children);const projected=tree?seal({...tree,children:seal(leaves)}):tree,result=seal({tree:projected,views:seal(views)});
 if(generation){projectionGenerations.set(projected,Object.freeze({}));projections.set(tree,{generation,offsets:offsetKeys,result});}
 return result;
}

export function createUiScrollHost({canvas,stage,onAction=()=>{},requestWindow=async()=>{},onDiagnostic=console.error,requestRender=()=>{},now=()=>performance.now(),requestFrame=fn=>requestAnimationFrame(fn),cancelFrame=id=>cancelAnimationFrame(id),getFocusedNode=()=>document.activeElement?.dataset?.uiControl,focusNode=id=>{const el=[...stage.querySelectorAll('[data-ui-control]')].find(el=>el.dataset.uiControl===id);if(!el)return false;el.focus();return true;}}){
 const states=new Map(),passthrough=new Set(),ignored=new Set();let views=[],projected=null,hovered='',focused='',gesture=null,disposed=false,pendingFocus=null,momentum=null,frame=null,externalInput=false;
 const point=e=>{const r=stage.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*100,y:100-(e.clientY-r.top)/r.height*100};};
 const ownerAt=p=>[...views].reverse().find(v=>v.enabled&&inside(v.clip,p.x,p.y));
 function makeState(id){
  const rails={};for(const axis of ['x','y']){
   const bar=document.createElement('div'),content=document.createElement('div');bar.dataset.uiScrollbar=id;bar.dataset.axis=axis;bar.tabIndex=-1;bar.setAttribute('aria-hidden','true');
   Object.assign(bar.style,{position:'absolute',zIndex:'7',boxSizing:'border-box',overscrollBehavior:'contain',scrollBehavior:'auto',scrollbarColor:'var(--ui-scroll-thumb, #b4b4b4) var(--ui-scroll-track, #252525)',overflowX:axis==='x'?'scroll':'hidden',overflowY:axis==='y'?'scroll':'hidden'});
   bar.append(content);stage.append(bar);rails[axis]={bar,content,range:0,max:0};
   bar.addEventListener('scroll',()=>{const s=states.get(id),rail=s?.rails[axis];if(!s||bar.hidden||!rail.range)return;s[axis]=(axis==='x'?bar.scrollLeft:bar.scrollTop)/rail.range*rail.max;requestRender();});
   bar.addEventListener('pointerdown',()=>{stopMomentum();focused=id;abandonGesture();});
  }
  return {x:0,y:0,reset:null,rails,pending:false,requested:'',keys:null,pitch:0};
 }
 function setOffset(v,x,y){const s=states.get(v.id);s.x=clamp(x,v.maxX);s.y=clamp(y,v.maxY);for(const axis of ['x','y']){const r=s.rails[axis];if(!r.bar.hidden)r.bar[axis==='x'?'scrollLeft':'scrollTop']=r.max?s[axis]/r.max*r.range:0;}requestRender();}
 // Host-only presentation motion: no simulation tick, action, or game callback.
 // Exponential drag integrates analytically, so 30/60/120 Hz cover the same path.
 const signature=v=>JSON.stringify([v.rect,v.clip,v.maxX,v.maxY,v.node.scroll.axis,v.node.scroll.inertia,v.node.scroll.deceleration??8,v.node.scroll.reset_key,v.node.scroll.virtual_items?.revision]);
 function stopMomentum(){momentum=null;if(frame!==null)cancelFrame(frame);frame=null;}
 function coast(){
  frame=null;const m=momentum;if(!m||disposed)return;
  const v=views.find(v=>v.id===m.id&&v.enabled),r=stage.getBoundingClientRect(),time=now(),dt=(time-m.time)/1000;
  if(!v||signature(v)!==m.signature||r.width!==m.width||r.height!==m.height||!Number.isFinite(dt)||dt<=0||dt>.25){stopMomentum();return;}
  const s=states.get(v.id),exponent=m.deceleration*dt,decay=Math.exp(-exponent);
  // Keep valid very small decay rates moving: 1-exp(-x) otherwise rounds to 0.
  const distance=dt*(exponent===0?1:-Math.expm1(-exponent)/exponent);
  const x=s.x+m.vx*distance,y=s.y+m.vy*distance;
  m.vx=clamp(x,v.maxX)===x?m.vx*decay:0;m.vy=clamp(y,v.maxY)===y?m.vy*decay:0;m.time=time;
  setOffset(v,x,y);
  if(momentum!==m)return;
  if(Math.hypot(m.vx,m.vy)<.5){stopMomentum();return;}
  frame=requestFrame(coast);
 }
 function startMomentum(v,g){
  const time=now();if(!v.node.scroll.inertia||time-g.lastMove>100||Math.hypot(g.vx,g.vy)<.5)return;
  const r=stage.getBoundingClientRect();momentum={id:v.id,vx:g.vx,vy:g.vy,time,deceleration:v.node.scroll.deceleration??8,signature:signature(v),width:r.width,height:r.height};
  frame=requestFrame(coast);
 }
 function refresh(v){
  const s=states.get(v.id),virtual=v.node.scroll.virtual_items;if(!virtual||!v.enabled||s.pending||!virtual.keys.length)return;
  const range=virtualWindow(virtual,s.y,v.rect.height),key=[virtual.revision,range.first,range.last].join(':');
  if(virtual.first<=range.first&&virtual.last>=range.last||s.requested===key)return;s.requested=key;s.pending=true;
  // A slow host request must not retain a former view tree or virtual key list.
  const id=v.id,revision=virtual.revision;
  Promise.resolve().then(()=>{if(!disposed&&states.get(id)===s)return requestWindow({id,revision,...range});}).catch(e=>{if(!disposed&&states.get(id)===s)onDiagnostic(e);}).finally(()=>{s.pending=false;if(!disposed&&states.get(id)===s)requestRender();});
 }
 const retireState=s=>{for(const {bar}of Object.values(s.rails))bar.remove();s.keys=null;s.reset=null;};
 const wheel=e=>{const p=point(e),r=stage.getBoundingClientRect(),scale=e.deltaMode===1?24:e.deltaMode===2?r.height:1,dx=e.deltaX*scale/r.width*100,dy=e.deltaY*scale/r.height*100;
  for(const v of [...views].reverse()){
   if(!v.enabled||!inside(v.wheelRect,p.x,p.y))continue;stopMomentum();const s=states.get(v.id),x=s.x+(v.node.scroll.axis==='horizontal'?(dx||dy):dx),y=s.y+dy;
   if(clamp(x,v.maxX)===s.x&&clamp(y,v.maxY)===s.y)continue;e.preventDefault();hovered=v.id;focused=v.id;setOffset(v,x,y);return true;
  }
  return false;
 };
 const move=e=>{hovered=ownerAt(point(e))?.id??'';},leave=()=>{hovered='';};
 function scrollToKey(id,key){
  const v=views.find(v=>v.id===id&&v.enabled),items=v?.node.scroll.virtual_items;if(!items)return false;
  const index=items.keys.indexOf(key);if(index<0)return false;stopMomentum();const s=states.get(id),start=Math.floor(index/items.columns)*(items.row_height+items.gap_y),end=start+items.row_height;
  setOffset(v,s.x,start<s.y?start:end>s.y+v.rect.height?end-v.rect.height:s.y);focused=id;return true;
 }
 function ensureVisible(id){
  const n=projected?.children?.find(n=>n.id===id),v=views.find(v=>v.id===n?.scrollOwner&&v.enabled);if(!v)return false;stopMomentum();focused=v.id;if(n.virtualKey)return scrollToKey(v.id,n.virtualKey);
  const s=states.get(v.id),r=n.rect;let x=s.x,y=s.y;if(r.x<v.rect.x)x+=r.x-v.rect.x;else if(r.x+r.width>v.rect.x+v.rect.width)x+=r.x+r.width-v.rect.x-v.rect.width;
  if(top(r)<top(v.rect))y+=top(r)-top(v.rect);else if(top(r)+r.height>top(v.rect)+v.rect.height)y+=top(r)+r.height-top(v.rect)-v.rect.height;setOffset(v,x,y);return true;
 }
 function navigate(id,code){
  const n=projected?.children?.find(n=>n.id===id),v=views.find(v=>v.id===n?.scrollOwner&&v.enabled),items=v?.node.scroll.virtual_items;
  if(!items||!['Home','End','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(code))return false;
  const index=code==='Home'?0:code==='End'?items.keys.length-1:clamp(n.virtualIndex+({ArrowUp:-items.columns,ArrowDown:items.columns,ArrowLeft:-1,ArrowRight:1})[code],items.keys.length-1);
  pendingFocus={owner:v.id,key:items.keys[index]};scrollToKey(v.id,items.keys[index]);return true;
 }
 const keydown=e=>{
  if(e.target.closest?.('input,textarea,select,[contenteditable=true],#unone-developer'))return false;
  const nodeId=getFocusedNode(),node=projected?.children?.find(n=>n.id===nodeId);
  if(node&&['slider','combobox'].includes(node.kind))return false;
  if(nodeId&&navigate(nodeId,e.code)){e.preventDefault();e.stopPropagation();return true;}
  const v=views.find(v=>v.id===(focused||hovered)&&v.enabled);if(!v||!['PageDown','PageUp','Home','End','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.code))return false;
  stopMomentum();const s=states.get(v.id);e.preventDefault();e.stopPropagation();if(e.code==='Home')setOffset(v,0,0);else if(e.code==='End')setOffset(v,v.maxX,v.maxY);
  else {const horizontal=e.code==='ArrowLeft'||e.code==='ArrowRight'||v.node.scroll.axis==='horizontal',sign=['PageUp','ArrowUp','ArrowLeft'].includes(e.code)?-1:1;setOffset(v,s.x+(horizontal?sign*v.rect.width*.15:0),s.y+(!horizontal?sign*v.rect.height*(e.code.startsWith('Page')?.85:.15):0));}
  return true;
 };
 const abandonGesture=()=>{if(gesture)ignored.add(gesture.pointer);gesture=null;};
 const cancel=()=>{stopMomentum();abandonGesture();passthrough.clear();focused='';pendingFocus=null;};
 const legacyWheel=e=>{if(!externalInput)wheel(e);},legacyKey=e=>{if(!externalInput)keydown(e);};
 canvas.addEventListener('wheel',legacyWheel,{passive:false});canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerleave',leave);window.addEventListener('keydown',legacyKey,true);window.addEventListener('blur',cancel);
 return {
  setExternalInput(value){externalInput=!!value;},routeWheel:wheel,routeKey:keydown,
  draw(snapshot){
   if(disposed)throw Error('UI_SCROLL_DISPOSED');const tree=(snapshot.world??snapshot).ui,initial=projectScrollTree(tree,states),live=new Set(initial.views.map(v=>v.id));let offsetsChanged=false;
   for(const [id,s]of states)if(!live.has(id)){retireState(s);states.delete(id);if(gesture?.id===id)abandonGesture();}
   for(const v of initial.views){
    if(!v.enabled&&gesture?.id===v.id)abandonGesture();
    let s=states.get(v.id);if(!s){s=makeState(v.id);states.set(v.id,s);}const reset=v.node.scroll.reset_key;
    if(s.reset!==reset){s.x=0;s.y=0;s.reset=reset;s.requested='';s.keys=null;abandonGesture();if(pendingFocus?.owner===v.id)pendingFocus=null;}
    const data=v.node.scroll.virtual_items,keys=data?.keys,pitch=data?data.row_height+data.gap_y:0;
    if(keys&&s.keys&&s.pitch===pitch&&s.columns===data.columns){const oldIndex=Math.floor(s.y/pitch)*data.columns,key=s.keys[oldIndex],index=keys.indexOf(key);if(index>=0)s.y+=(Math.floor(index/data.columns)-Math.floor(oldIndex/data.columns))*pitch;}
    s.keys=keys;s.pitch=pitch;s.columns=data?.columns;s.x=clamp(s.x,v.maxX);s.y=clamp(s.y,v.maxY);
    if(s.x!==v.offset.x||s.y!==v.offset.y)offsetsChanged=true;
    for(const axis of ['x','y']){const {bar,content}=s.rails[axis],vertical=axis==='y';
     const railRect=vertical?{x:Math.min(98,v.rect.x+v.rect.width+.4),y:v.rect.y,width:2,height:v.rect.height}:{x:v.rect.x,y:100-Math.min(98,top(v.rect)+v.rect.height+.4)-2,width:v.rect.width,height:2},visibleRail=intersect(v.parentClip,railRect);
     bar.hidden=!v.enabled||!(vertical?v.maxY:v.maxX)||visibleRail.width<=0||visibleRail.height<=0;
     Object.assign(bar.style,{left:railRect.x+'%',top:top(railRect)+'%',width:railRect.width+'%',height:railRect.height+'%',clipPath:v.parentClip?`inset(${(railRect.y+railRect.height-visibleRail.y-visibleRail.height)/railRect.height*100}% ${(railRect.x+railRect.width-visibleRail.x-visibleRail.width)/railRect.width*100}% ${(visibleRail.y-railRect.y)/railRect.height*100}% ${(visibleRail.x-railRect.x)/railRect.width*100}%)`:'none'});
     // A bounded native scrollbar proxy avoids browser maximum DOM dimensions
     // for very long virtual lists. Logical content coordinates remain exact.
     content.style.width=vertical?'1px':Math.min(1e6,Math.max(v.extent.width,v.rect.width)*stage.clientWidth/100)+'px';content.style.height=vertical?Math.min(1e6,Math.max(v.extent.height,v.rect.height)*stage.clientHeight/100)+'px':'1px';
     const rail=s.rails[axis];rail.max=vertical?v.maxY:v.maxX;rail.range=vertical?bar.scrollHeight-bar.clientHeight:bar.scrollWidth-bar.clientWidth;if(!bar.hidden)bar[vertical?'scrollTop':'scrollLeft']=rail.max?s[axis]/rail.max*rail.range:0;}
   }
   // Projection already clamps saved offsets. Repeat only when reset/anchoring
   // changed their effective values, including a parent of nested scroll views.
   const result=offsetsChanged?projectScrollTree(tree,states):initial;views=result.views;projected=result.tree;
   if(momentum){const v=views.find(v=>v.id===momentum.id&&v.enabled);if(!v||signature(v)!==momentum.signature)stopMomentum();}
   for(const v of views)refresh(v);
   if(pendingFocus){const {owner,key}=pendingFocus,v=views.find(v=>v.id===owner&&v.enabled);if(!v||!v.node.scroll.virtual_items.keys.includes(key))pendingFocus=null;
    else {const n=projected?.children.find(n=>n.scrollOwner===owner&&n.virtualKey===key&&n.action);if(n)queueMicrotask(()=>{if(!disposed&&pendingFocus?.key===key&&pendingFocus?.owner===owner&&focusNode(n.id))pendingFocus=null;});}}
   return snapshot.world?{...snapshot,world:{...snapshot.world,ui:projected}}:{...snapshot,ui:projected};
  },
  scrollToKey,ensureVisible,reveal:ensureVisible,navigate,isNavigating:()=>!!pendingFocus,
  pointer(e,kind,hit){
   if(kind==='down')stopMomentum();
   if(passthrough.has(e.pointerId)){if(kind==='up'||kind==='cancel')passthrough.delete(e.pointerId);return false;}
   if(ignored.has(e.pointerId)){if(kind==='down')ignored.delete(e.pointerId);else{if(kind==='up'||kind==='cancel')ignored.delete(e.pointerId);return true;}}
   if(gesture&&gesture.pointer!==e.pointerId){if(kind==='down')ignored.add(e.pointerId);return true;}
   if(kind==='cancel'){const owned=!!gesture;if(owned||e.type==='pointercancel')stopMomentum();gesture=null;return owned;}
   if(!['touch','mouse','pen'].includes(e.pointerType)){if(kind==='down')passthrough.add(e.pointerId);return false;}
   const p=point(e);
   if(kind==='down'){
    if(gesture)return true;
    if(e.isPrimary===false||(e.button!==undefined&&e.button!==0)){passthrough.add(e.pointerId);return false;}
    const v=ownerAt(p);if(!v){passthrough.add(e.pointerId);return false;}
    const node=projected?.children?.find(n=>n.id===hit?.nodeId);
    // Sliders own their drag values, and comboboxes own the field's full
    // pointer stream. A foreground control outside this scroll projection
    // must also keep its ordinary input even when it overlaps the viewport.
    if(node&&(['slider','combobox'].includes(node.kind)||(node.kind==='button'&&node.scrollOwner!==v.id))){passthrough.add(e.pointerId);return false;}
    const s=states.get(v.id);gesture={id:v.id,pointer:e.pointerId,x:e.clientX,y:e.clientY,startX:s.x,startY:s.y,lastX:s.x,lastY:s.y,time:now(),lastMove:-Infinity,vx:0,vy:0,moved:false,action:hit?.action,nodeId:hit?.nodeId};focused=v.id;return true;
   }
   if(!gesture)return false;const g=gesture,v=views.find(v=>v.id===g.id&&v.enabled);if(!v){abandonGesture();return true;}
   if(kind==='move'&&e.pointerType!=='touch'&&e.buttons===0){abandonGesture();return true;}
   if(kind==='move'||kind==='up'){const r=stage.getBoundingClientRect(),dx=g.x-e.clientX,dy=g.y-e.clientY;g.moved||=Math.hypot(dx,dy)>8;if(g.moved){
    setOffset(v,g.startX+dx/r.width*100,g.startY+dy/r.height*100);
    const s=states.get(v.id),time=now(),dt=(time-g.time)/1000,mx=s.x-g.lastX,my=s.y-g.lastY;
    if((mx||my)&&dt>0){g.vx=Math.max(-300,Math.min(300,mx/dt));g.vy=Math.max(-300,Math.min(300,my/dt));g.lastMove=time;}
    g.lastX=s.x;g.lastY=s.y;g.time=time;
   }}
   if(kind==='up'){if(!g.moved&&g.action&&g.action===hit?.action&&g.nodeId===hit?.nodeId&&inside(v.clip,p.x,p.y))onAction(g.action);gesture=null;if(g.moved)startMomentum(v,g);}return true;
  },
  cancel,
  report(){return views.map(v=>({id:v.id,enabled:v.enabled,viewport:v.rect,extent:v.extent,offset:{x:states.get(v.id).x,y:states.get(v.id).y},max:{x:v.maxX,y:v.maxY},total:v.node.scroll.virtual_items?.keys.length??null,window:v.node.scroll.virtual_items?{first:v.node.scroll.virtual_items.first,last:v.node.scroll.virtual_items.last}:null,materialized:v.node.children?.length??0}));},
  dispose(){if(disposed)return;disposed=true;cancel();ignored.clear();hovered='';views=[];projected=null;canvas.removeEventListener('wheel',legacyWheel);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',leave);window.removeEventListener('keydown',legacyKey,true);window.removeEventListener('blur',cancel);for(const s of states.values())retireState(s);states.clear();},
 };
}

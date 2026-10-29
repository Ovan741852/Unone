// Official host adapter for semantic text_input leaves. The canvas remains the
// renderer. A transparent native editing sink supplies OS IME, paste, selection
// and deletion; no game-specific identifiers, validation or save rules live here.
import {flattenUi} from './canvas-ui.mjs';
import {uiFont} from './ui-style.mjs';
import {UI_CONTRACT} from './ui-geometry.mjs';

const editable=node=>node?.kind==='text_input'&&node.enabled!==false;
const visible=node=>!node.clip||(node.rect.x<node.clip.x+node.clip.width&&node.rect.x+node.rect.width>node.clip.x
  &&node.rect.y<node.clip.y+node.clip.height&&node.rect.y+node.rect.height>node.clip.y);
const scalarLimit=(text,max)=>Array.from(text).slice(0,max).join('');
// Check current contents each draw: hosts also accept caller-owned trees that
// may be edited in place. Image-batch quads are not UI children or edit fields.
function hasTextInput(nodes,depth=1){
  // Let the canonical validator reject excessive/cyclic caller-owned trees.
  if(depth>UI_CONTRACT.max_component_depth)return true;
  for(let i=0;i<(nodes?.length??0);i++){
    const node=nodes[i];if(node?.kind==='text_input')return true;
    if((node?.kind==='component'||node?.kind==='scroll_view')&&hasTextInput(node.children,depth+1))return true;
  }
  return false;
}

export function createUiTextInputHost({canvas,document:doc=canvas.ownerDocument??document,window:win=doc.defaultView??window,
  onInteraction=()=>{},releaseKeyboard=()=>{},requestRender=()=>{},onDiagnostic=error=>{throw error;}}){
  const records=new Map(),captured=new Set(),ownedKeys=new Set(),listeners=[];
  let active=null,sink=null,disposed=false,suppressBlur=false,externalInput=false;
  const listen=(target,type,fn,options)=>{
    const run=event=>{if(disposed)return;try{fn(event);}catch(error){onDiagnostic(error);}};
    target.addEventListener(type,run,options);listeners.push(()=>target.removeEventListener(type,run,options));
  };
  function emit(record,phase){
    if(disposed)return;
    const event={id:record.node.id,phase,text:record.text,composing:record.composing};
    // Browsers may send both compositionend and a matching final input event.
    const key=JSON.stringify(event);
    if(phase==='change'&&record.lastChange===key)return;
    if(phase==='change')record.lastChange=key;
    onInteraction(event);requestRender();
  }
  function selection(record){
    if(!sink)return;
    record.start=sink.selectionStart??record.text.length;record.end=sink.selectionEnd??record.start;
  }
  function read(record,composing){
    record.composing=composing;
    const value=composing?sink.value:scalarLimit(sink.value,record.node.max_length??1024);
    if(value!==sink.value){const start=sink.selectionStart??value.length,end=sink.selectionEnd??start;
      sink.value=value;sink.setSelectionRange(Math.min(start,value.length),Math.min(end,value.length));}
    record.text=value;record.local=true;selection(record);emit(record,'change');
  }
  function close(phase='blur'){
    const record=active;if(!record)return;
    // Never submit a partially composed candidate when focus is lost.
    record.composing=false;active=null;emit(record,phase);
    suppressBlur=true;try{sink?.blur();}finally{suppressBlur=false;}
    requestRender();
  }
  function suspend(phase='cancel'){
    // Global focus/visibility barriers may discard the corresponding physical
    // up. Retire host capture as well, so the next real down can focus again.
    captured.clear();ownedKeys.clear();close(phase);
  }
  function position(){
    if(!active||!sink)return;
    const r=canvas.getBoundingClientRect(),n=active.node,b=n.rect,unit=r.height/100,pad=n.style?.padding??{};
    Object.assign(sink.style,{left:`${r.left+b.x*r.width/100+(pad.left??0)*unit}px`,
      top:`${r.top+(100-b.y-b.height)*r.height/100+(pad.top??0)*unit}px`,
      width:`${Math.max(1,b.width*r.width/100-((pad.left??0)+(pad.right??0))*unit)}px`,
      height:`${Math.max(1,b.height*r.height/100-((pad.top??0)+(pad.bottom??0))*unit)}px`,
      font:uiFont(n.style?.font_family??'sans-serif',(n.style?.font_size??2)*unit,n.style?.font_weight??400)});
  }
  function makeSink(){
    if(sink)return;
    sink=doc.createElement('input');sink.type='text';sink.autocomplete='off';sink.spellcheck=false;
    sink.setAttribute('autocapitalize','off');sink.setAttribute('data-unone-text-input','');
    sink.dataset.unoneTextInput='';
    Object.assign(sink.style,{position:'fixed',opacity:'0',pointerEvents:'none',border:'0',padding:'0',margin:'0',
      boxSizing:'border-box',color:'transparent',caretColor:'transparent',zIndex:'2147483647'});
    doc.body.append(sink);
    listen(sink,'input',e=>{if(active)read(active,active.composing||!!e.isComposing);});
    listen(sink,'compositionstart',()=>{if(active){active.composing=true;read(active,true);}});
    listen(sink,'compositionend',()=>{if(active)read(active,false);});
    listen(sink,'select',()=>{if(active){selection(active);requestRender();}});
    listen(doc,'selectionchange',()=>{if(active&&doc.activeElement===sink){selection(active);requestRender();}});
    listen(sink,'blur',()=>{
      if(suppressBlur)return;
      // Ordered pointer admission briefly focuses the canvas before routing a
      // new click back to this field. Do not destroy its draft/composition.
      queueMicrotask(()=>{if(!disposed&&active&&doc.activeElement!==sink)suspend('blur');});
    });
  }
  function focus(record){
    makeSink();
    if(active!==record){close();active=record;record.composing=false;sink.value=record.text;
      sink.setAttribute('aria-label',record.node.placeholder||record.node.id);
      sink.dataset.uiControl=record.node.id;releaseKeyboard();
      record.start=Math.min(record.start??record.text.length,record.text.length);record.end=Math.min(record.end??record.start,record.text.length);
      sink.setSelectionRange(record.start,record.end);emit(record,'focus');}
    position();sink.focus({preventScroll:true});
  }
  function routeKey(event,down){
    const key=event.code||event.key||'Unidentified';
    if(!active&&!ownedKeys.has(key))return false;
    if(down&&active)ownedKeys.add(key);
    if(!down)ownedKeys.delete(key);
    if(down&&active){
      const composing=active.composing||event.isComposing||event.keyCode===229;
      if((event.key==='Enter'||event.code==='Enter')&&!composing){
        event.preventDefault?.();if(!event.repeat){read(active,false);emit(active,'submit');}
      }else if((event.key==='Escape'||event.code==='Escape')&&!composing){event.preventDefault?.();close('cancel');}
      queueMicrotask(()=>{if(!disposed&&active){selection(active);requestRender();}});
    }
    return true;
  }
  // Capture before gameplay routing. Default editing remains native: suppress
  // propagation, not Backspace, arrow, selection, paste or IME default behavior.
  for(const [type,down]of [['keydown',true],['keyup',false]])listen(win,type,e=>{if(!externalInput&&routeKey(e,down))e.stopImmediatePropagation?.();},true);
  listen(win,'blur',()=>suspend());listen(win,'resize',position);listen(win,'scroll',position,true);
  listen(doc,'visibilitychange',()=>{if(doc.hidden)suspend();});
  function setTree(tree){
    const nodes=flattenUi(tree).filter(n=>n.kind==='text_input'&&visible(n)),live=new Set(nodes.map(n=>n.id));
    if(nodes.length>64)throw Error('UI_TEXT_INPUT_LIMIT: at most 64 fields may be presented');
    for(const [id,record]of records)if(!live.has(id)){if(active===record)close('cancel');records.delete(id);}
    for(const node of nodes){
      let record=records.get(node.id),previous=record?.node;
      if(!record){record={node,text:node.text,composing:false,start:null,end:null,local:false,lastChange:null};records.set(node.id,record);}
      record.node=node;
      // While editing the native draft wins over delayed successful-tick echoes.
      // Outside focus an acknowledged draft returns to ordinary controlled data.
      if(!record.local){
        if(record.text!==node.text){record.text=node.text;
          if(active===record){sink.value=node.text;record.start=record.end=node.text.length;sink.setSelectionRange(record.start,record.end);}}
      }else if(active!==record&&node.text===record.text)record.local=false;
      if(!editable(node)){if(active===record)close('cancel');continue;}
      if(node.focused===true&&previous?.focused!==true)focus(record);
      else if(node.focused===false&&previous?.focused===true&&active===record)close('blur');
    }
    position();
  }
  function draw(value){
    if(disposed)throw Error('UI_TEXT_INPUT_DISPOSED');
    const world=value.world??value,hasFields=hasTextInput(world.ui?.children);
    if(!hasFields&&!records.size)return value;
    setTree(world.ui);
    if(!hasFields)return value;
    const children=(world.ui?.children??[]).map(n=>{
      if(n.kind!=='text_input')return n;
      const r=records.get(n.id);return r?{...n,text:r.text,text_edit:{focused:active===r,selection_start:r.start??r.text.length,
        selection_end:r.end??r.text.length,composing:r.composing}}:n;
    });
    const next={...world,ui:world.ui?{...world.ui,children}:world.ui};return value.world?{...value,world:next}:next;
  }
  function pointer(event,kind,hit){
    const id=event.pointerId??0;
    if(captured.has(id)){if(kind==='up'||kind==='cancel')captured.delete(id);return true;}
    if(kind!=='down')return false;
    if(hit?.kind==='text_input'){
      const record=records.get(hit.nodeId);captured.add(id);
      if(record&&editable(record.node)){event.preventDefault?.();focus(record);}
      return true;
    }
    close('blur');return false;
  }
  return {draw,pointer,routeKey,setExternalInput:value=>{externalInput=!!value;},suspend,
    report:()=>({focused:active?.node.id??null,composing:active?.composing??false,fields:records.size,backend:'native-editing-sink'}),
    dispose(){if(disposed)return;active=null;disposed=true;for(const remove of listeners)remove();listeners.length=0;sink?.remove();sink=null;records.clear();captured.clear();ownedKeys.clear();},
  };
}

// Browser event routing only. InputFrame buffering remains in host-input.js;
// action meanings remain game-owned. Keep key names aligned with native host.
const namedKeys={ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',
  Space:'Space',Enter:'Enter',Escape:'Escape',Insert:'Insert',Home:'Home',PageUp:'PageUp',Delete:'Delete',PageDown:'PageDown',
  ShiftLeft:'ShiftLeft',ShiftRight:'ShiftRight',ControlLeft:'ControlLeft',ControlRight:'ControlRight',AltLeft:'AltLeft',AltRight:'AltRight',
  Minus:'Minus',Equal:'Equal',Numpad8:'Numpad8',Numpad2:'Numpad2',Numpad4:'Numpad4',Numpad6:'Numpad6',Numpad7:'Numpad7',Numpad9:'Numpad9'};

// Gamepad buttons in the W3C "standard" mapping order (crates/unone-engine
// GAMEPAD_BUTTONS); each pressed one becomes Gamepad_<name> and Gamepad<slot>_<name>.
export const GAMEPAD_BUTTONS=['A','B','X','Y','LB','RB','LT','RT','Back','Start','LS','RS','Up','Down','Left','Right','Home'];
const clampUnit=(value,min)=>Number.isFinite(value)?Math.max(min,Math.min(1,value)):0;

// navigator.getGamepads() to the engine's raw gamepad states: slot = index + 1
// (slots 1-4), stick y positive up, triggers 0..1, plus the pressed button names.
export function readGamepads(pads) {
  const states=[];
  for(const pad of pads??[]) {
    if(!pad?.connected||!(pad.index>=0&&pad.index<4))continue;
    const axis=index=>clampUnit(pad.axes?.[index]??0,-1),button=index=>pad.buttons?.[index];
    const trigger=index=>clampUnit(button(index)?.value??(button(index)?.pressed?1:0),0);
    states.push({slot:pad.index+1,left_x:axis(0),left_y:-axis(1),right_x:axis(2),right_y:-axis(3),
      left_trigger:trigger(6),right_trigger:trigger(7),
      buttons:GAMEPAD_BUTTONS.filter((_,index)=>Boolean(button(index)?.pressed))});
  }
  return states.sort((a,b)=>a.slot-b.slot);
}

// An optional browser device must not stop keyboard/pointer/network ticks.
// Policy denial is stable for this document; cache it instead of throwing or
// repeatedly probing a forbidden API (notably third-party WebKit frames).
export function createGamepadPolling({navigator=globalThis.navigator,document=globalThis.document}={}) {
  let disabled=false,policyChecked=false,state='unpolled',reason=null,calls=0;
  function stop(next,why){disabled=true;state=next;reason=why;return [];}
  return Object.freeze({
    poll(){
      if(disabled)return [];
      if(!policyChecked){
        policyChecked=true;
        try{
          const policy=document?.permissionsPolicy??document?.featurePolicy;
          const known=typeof policy?.features==='function'?Array.from(policy.features()):null;
          if(typeof policy?.allowsFeature==='function'&&(!known||known.includes('gamepad'))&&policy.allowsFeature('gamepad')===false)return stop('blocked','permissions_policy');
        }catch{/* Policy introspection is optional; the actual read is guarded. */}
      }
      let pads;
      try{
        const read=navigator?.getGamepads;
        if(typeof read!=='function')return stop('unavailable','api_missing');
        calls++;pads=read.call(navigator);
      }catch(error){
        const name=String(error?.name??'Error').slice(0,64);
        return stop(['SecurityError','NotAllowedError'].includes(name)?'blocked':'error',name);
      }
      state='ready';reason=null;
      // Keep mapping/engine errors visible; only the optional browser API is
      // fault-isolated. An empty result also clears formerly held pad buttons.
      return readGamepads(pads);
    },
    report:()=>Object.freeze({state,reason,browser_calls:calls,scope:'Optional browser gamepad input; denial cached until document reload.'}),
  });
}

export function physicalKeyAction(code) {
  if(/^Key[A-Z]$/.test(code))return code.slice(3);
  if(/^Digit[0-9]$/.test(code))return code.slice(5);
  if(/^[A-Z0-9]$/.test(code))return code;
  return namedKeys[code]??null;
}

export function routeBrowserKey(input,event,down) {
  const action=physicalKeyAction(event.code);
  if(action===null)return;
  const target=event.target;
  if(down&&(target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)))return;
  event.preventDefault?.();
  // Repeats carry no new physical press. In particular, a key still held
  // across a wait/blur reset must not silently restart gameplay movement.
  if(down&&event.repeat)return;
  input.queuePhysicalAction(action,down);
  // Existing Web games may explicitly read KeyboardEvent.code. Retain aliases
  // while exposing the native neutral action as the canonical cross-host name.
  if(action!==event.code)input.queuePhysicalAction(event.code,down);
}

export function routeBrowserPointer(event,kind,handlers) {
  const button=event.button??0;
  if((kind==='down'||kind==='up')&&button!==0&&button!==1&&button!==2)return;
  if(kind==='down'){handlers.capture(event.pointerId);handlers.unlock();}
  if((kind==='down'||kind==='up')&&button===2) {
    event.preventDefault?.();handlers.secondary(event,kind==='down');return;
  }
  if((kind==='down'||kind==='up')&&button===1) {
    event.preventDefault?.();handlers.middle(event,kind==='down');return;
  }
  if(kind==='down') {
    if(!handlers.ui(event,'down'))handlers.primary(event,true,'edge');
  }else if(kind==='up') {
    if(!handlers.ui(event,'up'))handlers.primary(event,false,'edge');
  }else if(kind==='move') {
    // Pointer Events emits later button changes as pointermove during chords,
    // not another pointerdown/up. button=-1 is ordinary movement.
    if(event.pointerType!=='touch'&&event.button===2)handlers.secondary(event,(event.buttons&2)!==0);
    if(event.pointerType!=='touch'&&(event.button===1||(event.buttons&4)!==0)) {
      event.preventDefault?.();handlers.middle(event,(event.buttons&4)!==0);
      if(event.button!==0)return;
    }
    // Optional stalePrimary: a primary button held across a host release-all
    // is not a press; it stays up until a fresh pointerdown starts one.
    const stale=handlers.stalePrimary?.()===true;
    const changedPrimary=!stale&&event.pointerType!=='touch'&&event.button===0;
    const primary=!stale&&(event.buttons&1)!==0;
    const routedKind=changedPrimary?(primary?'down':'up'):'move';
    if(!handlers.ui(event,routedKind))handlers.primary(event,primary,changedPrimary?'edge':'move');
  }else if(kind==='cancel') {
    if(!handlers.ui(event,'cancel'))handlers.cancel();
  }
}

// Unordered routing (no ordered_physical_v1 router) has no gesture owner.
// After the host releases all input, a primary button still held from before
// stays up until a fresh primary pointerdown, and the player gives back the
// pointer captures it still holds. The ordered router routes such gestures to
// host_ui itself and does not use this.
export function createLegacyPointerRouting(canvas,handlers) {
  let stale=false;const captures=new Set();
  const routed={...handlers,stalePrimary:()=>stale,capture(id){handlers.capture(id);captures.add(id);}};
  return {
    route(event,kind){if(kind==='down'&&(event.button??0)===0)stale=false;routeBrowserPointer(event,kind,routed);},
    lostCapture(id){captures.delete(id);},
    release(){
      stale=true;
      for(const id of captures)if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
      captures.clear();
    },
  };
}

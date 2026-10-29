// Browser event routing only. InputFrame buffering remains in host-input.js;
// action meanings remain game-owned. Keep key names aligned with native host.
const namedKeys={ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',
  Space:'Space',Enter:'Enter',Escape:'Escape',Insert:'Insert',Home:'Home',PageUp:'PageUp',Delete:'Delete',PageDown:'PageDown',
  ShiftLeft:'ShiftLeft',ShiftRight:'ShiftRight',ControlLeft:'ControlLeft',ControlRight:'ControlRight',AltLeft:'AltLeft',AltRight:'AltRight',
  Minus:'Minus',Equal:'Equal',Numpad8:'Numpad8',Numpad2:'Numpad2',Numpad4:'Numpad4',Numpad6:'Numpad6',Numpad7:'Numpad7',Numpad9:'Numpad9'};

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
    const changedPrimary=event.pointerType!=='touch'&&event.button===0;
    const primary=(event.buttons&1)!==0;
    const routedKind=changedPrimary?(primary?'down':'up'):'move';
    if(!handlers.ui(event,routedKind))handlers.primary(event,primary,changedPrimary?'edge':'move');
  }else if(kind==='cancel') {
    if(!handlers.ui(event,'cancel'))handlers.cancel();
  }
}

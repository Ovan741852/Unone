// Keep native canvas coordinates unchanged: portrait viewports are gated until
// they become landscape, with an optional user-initiated native screen lock.
export function installLandscape({canvas,hud,action}) {
  const gate=document.createElement('section');
  gate.className='hc-orientation-gate'; gate.hidden=true; gate.tabIndex=-1;
  gate.setAttribute('role','dialog'); gate.setAttribute('aria-modal','true');
  gate.setAttribute('aria-labelledby','hc-orientation-title');
  gate.innerHTML='<div class="hc-orientation-card"><div class="hc-orientation-phone" aria-hidden="true">↻</div><h1 id="hc-orientation-title">請橫向遊玩</h1><p>海王只支援橫向畫面。<br>請將裝置橫放後繼續遊玩。</p><button type="button">橫向全螢幕</button><small>若未自動轉向，請將裝置橫放。</small></div>';
  document.body.append(gate);
  const button=gate.querySelector('button'),hint=gate.querySelector('small');
  const orientation=window.matchMedia('(orientation: portrait)');
  const nativeUi=document.getElementById('ui-layer');
  const surfaces=[canvas,hud,nativeUi].filter(Boolean);
  const originalInert=surfaces.map(node=>node.inert);
  const pointers=new Set();
  let portrait=null,disposed=false,busy=false,lockStatus='idle',pointerNeedsPress=true;
  const rememberPointer=e=>{pointerNeedsPress=false;pointers.add(e.pointerId);};
  const forgetPointer=e=>pointers.delete(e.pointerId);
  const requireFreshPointer=e=>{
    if(pointerNeedsPress&&e.buttons){e.stopImmediatePropagation();if(e.cancelable)e.preventDefault();}
  };
  canvas.addEventListener('pointerdown',rememberPointer,true);
  canvas.addEventListener('pointerup',forgetPointer,true);
  canvas.addEventListener('pointercancel',forgetPointer,true);
  canvas.addEventListener('pointermove',requireFreshPointer,true);
  function releaseInput() {
    const ids=[...pointers];pointerNeedsPress=true;
    canvas.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:ids[0]??1}));
    for(const id of ids) if(canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
  }
  function update() {
    if(disposed) return;
    const next=orientation.matches;
    if(next===portrait) return;
    portrait=next; gate.hidden=!portrait;
    surfaces.forEach((node,i)=>{node.inert=portrait||originalInert[i];});
    releaseInput();
    action(portrait?'ViewportPortrait':'ViewportLandscape');
    if(portrait) button.focus({preventScroll:true});
  }
  async function enterLandscape() {
    if(disposed||busy) return;
    busy=true; button.disabled=true; button.textContent='正在切換…';
    try {
      if(!document.fullscreenElement&&document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      if(disposed) return;
      if(typeof screen.orientation?.lock==='function') {
        await screen.orientation.lock('landscape');
        if(disposed){screen.orientation.unlock?.();return;}
        lockStatus='locked';
      } else lockStatus='unsupported';
    } catch(error) { lockStatus=error?.name||'unavailable'; }
    finally {
      if(!disposed) {
        busy=false; button.disabled=false; button.textContent='橫向全螢幕';
        hint.textContent=portrait?'請將裝置橫放後繼續遊玩。':'已切換為橫向畫面。';
        update();
      }
    }
  }
  button.addEventListener('click',enterLandscape);
  orientation.addEventListener('change',update);
  window.addEventListener('resize',update);
  document.addEventListener('fullscreenchange',update);
  update();
  return {
    sync(state) {
      update();
      // The first renderer frame can follow the initial input edge; retry until
      // Luau acknowledges it rather than depending on browser boot timing.
      if(!disposed&&Boolean(state.viewportBlocked)!==portrait) action(portrait?'ViewportPortrait':'ViewportLandscape');
    },
    metadata(){return {landscapeOnly:true,portrait,blocked:!gate.hidden,fullscreen:Boolean(document.fullscreenElement),lockStatus,pointerNeedsPress};},
    dispose(){
      disposed=true; orientation.removeEventListener('change',update);window.removeEventListener('resize',update);
      document.removeEventListener('fullscreenchange',update);button.removeEventListener('click',enterLandscape);
      canvas.removeEventListener('pointerdown',rememberPointer,true);canvas.removeEventListener('pointerup',forgetPointer,true);
      canvas.removeEventListener('pointercancel',forgetPointer,true);canvas.removeEventListener('pointermove',requireFreshPointer,true);
      surfaces.forEach((node,i)=>{node.inert=originalInert[i];});gate.remove();
      if(lockStatus==='locked') screen.orientation?.unlock?.();
    }
  };
}

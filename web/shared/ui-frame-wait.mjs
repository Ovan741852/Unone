// Experimental staging barrier: the complete previous presentation is
// covered while incoming UI assets load. It never blurs the native IME sink.
export function createUiFrameWait({document:doc,window:win,onEnter=()=>{},onLeave=()=>{},onRetry=()=>{},onReload=()=>{},delayMs=10000,schedule=setTimeout,cancel=clearTimeout}){
 let active=false,disposed=false,mode='',message='',timer=null;
 const root=doc.createElement('div'),panel=doc.createElement('div'),label=doc.createElement('div'),retry=doc.createElement('button'),reload=doc.createElement('button');
 root.dataset.unoneFrameWait='';root.setAttribute('role','status');root.setAttribute('aria-live','polite');root.hidden=true;
 Object.assign(root.style,{position:'fixed',inset:'0',zIndex:'2147483647',display:'none',alignItems:'center',justifyContent:'center',background:'#242822',color:'#f5f1df',pointerEvents:'auto',touchAction:'none'});
 Object.assign(panel.style,{display:'flex',flexDirection:'column',alignItems:'center',gap:'12px',font:'16px system-ui,sans-serif'});
 label.textContent='Loading…';retry.textContent='Retry';reload.textContent='Reload';retry.type=reload.type='button';retry.hidden=reload.hidden=true;
 panel.append(label,retry,reload);root.append(panel);doc.body.append(root);
 function delayed(){timer=null;if(!active||mode!=='pending')return;mode='delayed';label.textContent='Loading is taking longer than expected.';retry.hidden=reload.hidden=false;}
 function arm(){if(timer!==null)cancel(timer);timer=schedule(delayed,delayMs);}
 retry.addEventListener('click',()=>{mode='pending';message='';label.textContent='Loading…';retry.hidden=reload.hidden=true;arm();onRetry();});reload.addEventListener('click',()=>onReload());
 // Existing native IME composition may finish; do not blur or cancel its
 // editing sink. All other key presses during the loading cover are blocked.
 const block=event=>{if(!active||event.target===retry||event.target===reload)return;
  if(event.isComposing||event.keyCode===229)return;
  event.preventDefault?.();event.stopImmediatePropagation?.();};
 win.addEventListener('keydown',block,true);win.addEventListener('keyup',block,true);win.addEventListener('beforeinput',block,true);
 function show(next='pending',error=''){
  const nextMessage=String(error??'').slice(0,512);
  if(active&&(next==='pending'&&mode!=='error'||next==='error'&&mode==='error'&&message===nextMessage))return;
  if(disposed)return;if(!active){active=true;mode='pending';onEnter();arm();}
  if(next==='error'){mode='error';message=nextMessage;if(timer!==null){cancel(timer);timer=null;}}
  else if(mode==='error'){mode='pending';message='';arm();}
  label.textContent=mode==='error'?`Unable to load the next screen. ${message}`:mode==='delayed'?'Loading is taking longer than expected.':'Loading…';
  retry.hidden=reload.hidden=mode==='pending';root.hidden=false;root.style.display='flex';
 }
 function hide(){if(!active)return;active=false;mode='';message='';if(timer!==null){cancel(timer);timer=null;}root.hidden=true;root.style.display='none';onLeave();}
 return {show,hide,isActive:()=>active,report:()=>({active,mode,message}),dispose(){if(disposed)return;hide();disposed=true;win.removeEventListener('keydown',block,true);win.removeEventListener('keyup',block,true);win.removeEventListener('beforeinput',block,true);root.remove();}};
}

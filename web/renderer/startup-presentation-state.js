// Private renderer observations. A counted request is not a completed game pass.
export function createStartupPresentationState({available,metrics,view}){
 let sequence=0,token=null,disposed=false;const listeners=new Set();
 const clone=()=>token?structuredClone(token):null;
 function matches(m,t){const size=view();return t&&m.status==='validated'&&m.last_validation&&
  t.context_epoch===m.context_epoch&&t.target_generation===m.target_generation&&
  m.last_validation.context_epoch===m.context_epoch&&m.last_validation.target_generation===m.target_generation&&
  t.physical_size[0]===size.width&&t.physical_size[1]===size.height&&t.dpr===size.dpr&&
  m.last_validation.physical_size[0]===size.width&&m.last_validation.physical_size[1]===size.height&&m.last_validation.dpr===size.dpr&&
  (size.material_profile===undefined||(t.material_profile===size.material_profile&&t.frame_revision===size.frame_revision));}
 function sample(){
  if(disposed)throw Error('PROJECTED_RASTER_DISPOSED');
  const ready=available(),m=metrics();
  if(m.status==='disposed')throw Error('PROJECTED_RASTER_DISPOSED');
  if(m.status==='failed')throw Error('PROJECTED_RASTER_CAPABILITY_FAILED: '+JSON.stringify(m.failure));
  if(!ready||m.status==='lost'){token=null;return {state:'lost',token:null};}
  if(!matches(m,token)){token=null;return {state:'needs_draw',token:null};}
  return {state:'presented',token:clone()};
 }
 function changed(){
  if(!matches(metrics(),token))token=null;
  for(const notify of [...listeners])notify();
 }
 return {sample,changed,metrics:clone,
  invalidate(){token=null;},
  drawn(){if(!available()){token=null;return;}const m=metrics(),size=view();
   const next={context_epoch:m.context_epoch,target_generation:m.target_generation,physical_size:[size.width,size.height],dpr:size.dpr,game_draw_sequence:sequence+1};
   if(size.material_profile!==undefined){next.material_profile=size.material_profile;next.frame_revision=size.frame_revision;}
   if(matches(m,next)){sequence++;token=next;}else token=null;},
  subscribe(notify){if(disposed)throw Error('PROJECTED_RASTER_DISPOSED');listeners.add(notify);let subscribed=true;
   return()=>{if(subscribed){subscribed=false;listeners.delete(notify);}};},
  dispose(){if(disposed)return;disposed=true;token=null;for(const notify of [...listeners])notify();listeners.clear();}};
}

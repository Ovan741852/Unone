// Context-local observations. No Core/World clock, input or simulation state lives here.
export function createRasterCapability({policy,profile,validate,onState=()=>{}}){
 const checked=policy.requested==='upper_left_checked';let status=checked?'unchecked':'host',epoch=1,counter=0,generation=null;
 let key=null,size=null,dpr=null,last=null,failure=null,terminal=null,disposed=false;
 const metrics=()=>({requested:policy.requested,declared:policy.declared,status,context_epoch:epoch,target_generation:generation,
  physical_size:size?.slice()??null,dpr,profile_version:checked?profile.version:null,probe_hash:checked?profile.hash:null,
  last_validation:last?structuredClone(last):null,failure:failure?structuredClone(failure):null,
  limitations:checked?(profile.limitations??'opaque/cutout only; worldhidden; WebGL2 AAfalse; Bloom/AOoff; isolated depth; bounded target conformance'):'host raster; no upper-left validation claim'});
 const emit=()=>onState(metrics());
 function fail(error,detail){
  status='failed';failure=detail??{reason:String(error?.message??error)};
  terminal=Error('PROJECTED_RASTER_CAPABILITY_FAILED: '+JSON.stringify({...metrics(),reason:String(error?.message??error)}));emit();throw terminal;
 }
 function lost(){if(disposed||terminal||status==='lost')return;key=null;generation=null;status='lost';emit();}
 function ensure(view){
  if(disposed)throw Error('PROJECTED_RASTER_DISPOSED');
  if(terminal)throw terminal;if(status==='lost')return false;if(!checked)return true;
  const {width,height,dpr:ratio}=view;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||!Number.isFinite(ratio)||ratio<=0)
   return fail('minimum physical validation footprint8x8 and finite positive DPR required');
  const next=`${epoch}:${width}:${height}:${ratio}`;
  if(status==='validated'&&key===next)return true;
  key=null;size=[width,height];dpr=ratio;generation=++counter;status='checking';emit();
  try{
   const result=validate({context_epoch:epoch,target_generation:generation,physical_size:size.slice(),dpr,profile});
   if(result?.lost){lost();return false;}
   if(!result||!Number.isInteger(result.samples)||result.samples<1||result.passed!==result.samples)
    return fail('target conformance mismatch',result??{reason:'missing readback result'});
   last={context_epoch:epoch,target_generation:generation,physical_size:size.slice(),dpr,samples:result.samples,passed:result.passed,
    profile_version:profile.version,probe_hash:profile.hash};
   key=next;status='validated';failure=null;emit();return true;
  }catch(error){if(error===terminal)throw error;return fail(error);}
 }
 return {ensure,metrics,
  lost,
  restored(){if(disposed||terminal||status!=='lost')return;epoch++;key=null;generation=null;status=checked?'unchecked':'host';emit();},
  dispose(){if(disposed)return;disposed=true;key=null;generation=null;status='disposed';emit();}};
}

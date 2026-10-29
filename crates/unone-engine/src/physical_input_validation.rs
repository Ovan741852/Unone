use crate::physical_input::*;
fn need(ok:bool,message:&str)->Result<(),String>{if ok{Ok(())}else{Err(format!("INPUT_PHYSICAL_INVALID: {message}"))}}
fn finite(n:f64)->bool{n.is_finite()&&n.abs()<=1e9}
fn viewport(v:&Viewport)->Result<(),String>{need(v.revision>0&&v.revision<=MAX_SAFE&&v.width>0&&v.height>0&&v.width<=32768&&v.height<=32768
 &&finite(v.rect_left)&&finite(v.rect_top)&&finite(v.css_width)&&v.css_width>0.&&finite(v.css_height)&&v.css_height>0.
 &&v.device_pixel_ratio.is_finite()&&v.device_pixel_ratio>0.&&v.device_pixel_ratio<=16.,"viewport")}
fn point(p:&Point)->Result<(),String>{need(finite(p.x)&&finite(p.y),"point")?;viewport(&p.viewport)}
fn event(e:&PhysicalEvent)->Result<(),String>{
 let c=&e.common;need(["browser","host_synthetic","fixture"].contains(&c.origin.as_str()),"origin")?;
 let control=matches!(e.data,EventData::Capture{..}|EventData::Focus{..}|EventData::Reset{..}|EventData::Viewport{..});
 need(if control{c.route=="control"}else{["game","engine_ui","host_ui"].contains(&c.route.as_str())},"route")?;
 match &e.data {
  EventData::Key{code,location,state,..}=>need(!code.is_empty()&&code.len()<=128&&*location<=3&&["down","up"].contains(&state.as_str()),"key"),
  EventData::Pointer{pointer_id,pointer_type,phase,button,buttons,point:p,..}=>{
   need(*pointer_id<=MAX_SAFE&&["mouse","pen","touch"].contains(&pointer_type.as_str())&&["down","up","move","cancel"].contains(&phase.as_str())&&(-1..=4).contains(button)&&*buttons<=31,"pointer")?;
   if let Some(p)=p{point(p)?;}else{need(phase=="cancel","pointer position missing")?;}Ok(())
  },
  EventData::Wheel{delta_x,delta_y,delta_z,unit,point:p,..}=>{need([*delta_x,*delta_y,*delta_z].into_iter().all(finite)&&["pixel","line","page"].contains(&unit.as_str()),"wheel")?;point(p)},
  EventData::Capture{pointer_id,source,captured}=>need(*pointer_id<=MAX_SAFE&&["got","lost"].contains(&source.as_str())&&*captured==(source=="got"),"capture"),
  EventData::Focus{scope,..}=>need(["game","window"].contains(&scope.as_str()),"focus"),
  EventData::Reset{scope,pointer_id,reason}=>need(["all","pointer"].contains(&scope.as_str())&&
   (scope=="pointer")==pointer_id.is_some()&&pointer_id.is_none_or(|id|id<=MAX_SAFE)&&
   ["blur","hidden","host_pause","focus_left_game","pointer_cancel","lost_capture","load"].contains(&reason.as_str()),"reset"),
  EventData::Viewport{viewport:v}=>viewport(v),
 }
}
pub(crate) fn validate(b:&PhysicalBatch)->Result<(),String>{
 need(b.profile==PROFILE&&b.epoch>0&&b.epoch<=MAX_SAFE&&b.after_sequence<=b.through_sequence&&b.through_sequence<=MAX_SAFE,"header")?;
 need(b.events.len()<=256&&b.through_sequence-b.after_sequence==b.events.len() as u64,"dense bounded sequence")?;
 let mut time=0;
 for (i,e) in b.events.iter().enumerate(){
  need(e.common.sequence==b.after_sequence+i as u64+1&&e.common.received_us<=MAX_SAFE&&e.common.received_us>=time,"sequence/time")?;
  time=e.common.received_us;event(e)?;
 }
 need(serde_json::to_vec(b).map_err(|e|e.to_string())?.len()<=262144,"256KiB batch limit")
}

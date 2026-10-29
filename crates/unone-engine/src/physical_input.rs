use serde::{Serialize,Deserialize};
pub(crate) fn present<'de,D:serde::Deserializer<'de>,T:Deserialize<'de>>(d:D)->Result<Option<T>,D::Error>{T::deserialize(d).map(Some)}
pub const PROFILE:&str="ordered_physical_v1";
pub const MAX_SAFE:u64=9_007_199_254_740_991;
#[cfg(feature="dev-tools")]
fn closed_event_schema(schema:&mut schemars::Schema){schema.insert("unevaluatedProperties".into(),serde_json::json!(false));}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct PhysicalBatch {pub profile:String,pub epoch:u64,pub after_sequence:u64,pub through_sequence:u64,pub events:Vec<PhysicalEvent>}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Common {pub sequence:u64,pub received_us:u64,pub origin:String,pub route:String}
#[derive(Debug,Clone,Serialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[cfg_attr(feature="dev-tools",schemars(transform=closed_event_schema))]
pub struct PhysicalEvent {#[serde(flatten)]pub common:Common,#[serde(flatten)]pub data:EventData}
impl<'de> Deserialize<'de> for PhysicalEvent {
 fn deserialize<D:serde::Deserializer<'de>>(d:D)->Result<Self,D::Error> {
  use serde::de::Error;
  let mut value=serde_json::Value::deserialize(d)?;
  let object=value.as_object_mut().ok_or_else(||D::Error::custom("physical event object required"))?;
  let mut common=serde_json::Map::new();
  for key in ["sequence","received_us","origin","route"] {
   common.insert(key.into(),object.remove(key).ok_or_else(||D::Error::custom(format!("missing {key}")))?);
  }
  Ok(Self{common:serde_json::from_value(common.into()).map_err(D::Error::custom)?,data:serde_json::from_value(value).map_err(D::Error::custom)?})
 }
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Modifiers {pub shift:bool,pub control:bool,pub alt:bool,pub meta:bool,
 #[cfg_attr(feature="dev-tools",schemars(with="bool"))]
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="present")]pub alt_graph:Option<bool>,
 #[cfg_attr(feature="dev-tools",schemars(with="bool"))]
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="present")]pub caps_lock:Option<bool>,
 #[cfg_attr(feature="dev-tools",schemars(with="bool"))]
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="present")]pub num_lock:Option<bool>}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Viewport {pub revision:u64,pub width:u32,pub height:u32,pub rect_left:f64,pub rect_top:f64,pub css_width:f64,pub css_height:f64,pub device_pixel_ratio:f64}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Point {pub x:f64,pub y:f64,pub inside:bool,pub viewport:Viewport}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(tag="kind",rename_all="snake_case",deny_unknown_fields)]
pub enum EventData {
 Key {code:String,location:u8,state:String,repeat:bool,is_composing:bool,modifiers:Modifiers},
 Pointer {pointer_id:u64,pointer_type:String,phase:String,button:i8,buttons:u8,
  #[cfg_attr(feature="dev-tools",schemars(with="Point"))]
  #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="present")]point:Option<Point>,modifiers:Modifiers},
 Wheel {delta_x:f64,delta_y:f64,delta_z:f64,unit:String,point:Point,modifiers:Modifiers},
 Capture {pointer_id:u64,captured:bool,source:String},
 Focus {focused:bool,scope:String},
 Reset {scope:String,
  #[cfg_attr(feature="dev-tools",schemars(with="u64"))]
  #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="present")]pointer_id:Option<u64>,reason:String},
 Viewport {viewport:Viewport},
}
#[derive(Debug,Clone,Serialize,PartialEq,Eq)]
pub struct PhysicalReceipt {pub profile:&'static str,pub epoch:u64,pub through_sequence:u64}
impl PhysicalBatch {
 pub fn validate(&self)->Result<(),String>{crate::physical_input_validation::validate(self)}
 pub fn canonical(self)->Result<Self,String>{
  fn zeros(v:&mut serde_json::Value){match v {
   serde_json::Value::Array(a)=>for v in a{zeros(v)},
   serde_json::Value::Object(o)=>for v in o.values_mut(){zeros(v)},
   serde_json::Value::Number(n) if n.as_f64()==Some(0.)=>*v=serde_json::json!(0),_=>{}
  }}
  let mut v=serde_json::to_value(self).map_err(|e|e.to_string())?;zeros(&mut v);serde_json::from_value(v).map_err(|e|e.to_string())
 }
}

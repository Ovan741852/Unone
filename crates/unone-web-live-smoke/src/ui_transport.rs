//! Optional official-player wire. Full canonical snapshots/digests are unchanged.
use super::*;
use std::{cell::Cell, collections::BTreeMap};
thread_local! {
    static ENABLED: Cell<bool> = const { Cell::new(false) };
    static EPOCH: Cell<u64> = const { Cell::new(1) };
    // JSON views remain readable until the next successful world publication.
    static LEASES: RefCell<Vec<unone_engine::UiImageBatchResource>> = const { RefCell::new(Vec::new()) };
    static CANONICAL: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}
pub(super) fn enabled()->bool { ENABLED.with(Cell::get) }
pub(super) fn retire(){
    let had_cache=CANONICAL.with(|v|{let mut bytes=v.borrow_mut();let retained=bytes.capacity()>0;*bytes=Vec::new();retained});
    let had_leases=LEASES.with(|v|{let mut leases=v.borrow_mut();let retained=!leases.is_empty();*leases=Vec::new();retained});
    // Only the retained-wire retirement boundary drops the hash prefix too.
    // Ordinary non-UI publications keep their normal bounded prefix reuse.
    if had_cache||had_leases{CANONICAL_HASHER.with(|v|*v.borrow_mut()=unone_engine::CanonicalHasher::default());}
}
pub(super) fn unload(){
    LEASES.with(|v|*v.borrow_mut()=Vec::new());
    CANONICAL.with(|v|*v.borrow_mut()=Vec::new());
    ENABLED.with(|v|v.set(false));
}
pub(super) fn new_runtime()->Result<(),String>{
    let next=EPOCH.with(|e|e.get().checked_add(1)).ok_or("UI_IMAGE_TRANSPORT_EPOCH_LIMIT")?;
    EPOCH.with(|e|e.set(next));ENABLED.with(|v|v.set(false));Ok(())
}
#[derive(Serialize)]
struct Memory {offset:usize,byte_length:usize}
#[derive(Serialize)]
struct Resource {revision:String,memory:Memory}
#[derive(Serialize)]
struct Transport {format:&'static str,epoch:String,resources:BTreeMap<String,Resource>}
#[derive(Serialize)]
struct Observation<'a,W:Serialize+?Sized>{
    compiled_systems:&'static [String],project:&'a str,world:&'a W,
    observation_digest:&'a str,save_payload:Option<&'a serde_json::value::RawValue>,
    #[serde(skip_serializing_if="Option::is_none")]
    instance_transport:Option<&'static str>,
    ui_transport:Transport,
}

// Delegate the complete canonical struct and filter only its top-level registry
// field. Nested values serialize through the original serializer, so this does
// not require a second field inventory or a hidden serialization mode.
struct Presentation<'a>(&'a WorldSnapshot);
impl Serialize for Presentation<'_>{
    fn serialize<S:serde::Serializer>(&self,serializer:S)->Result<S::Ok,S::Error>{
        self.0.serialize(WithoutRegistry{serializer,field_count:usize::from(!self.0.ui_image_batches.is_empty())})
    }
}
struct WithoutRegistry<S>{serializer:S,field_count:usize}
struct FilterStruct<S>(S);
impl<S:serde::ser::SerializeStruct> serde::ser::SerializeStruct for FilterStruct<S>{
    type Ok=S::Ok;type Error=S::Error;
    fn serialize_field<T:Serialize+?Sized>(&mut self,key:&'static str,value:&T)->Result<(),Self::Error>{
        if key=="ui_image_batches"{Ok(())}else{self.0.serialize_field(key,value)}
    }
    fn skip_field(&mut self,key:&'static str)->Result<(),Self::Error>{
        if key=="ui_image_batches"{Ok(())}else{self.0.skip_field(key)}
    }
    fn end(self)->Result<Self::Ok,Self::Error>{self.0.end()}
}
macro_rules! forward_values{
    ($($name:ident($($argument:ident:$kind:ty),*));*$(;)?)=>{$(
        fn $name(self,$($argument:$kind),*)->Result<Self::Ok,Self::Error>{self.serializer.$name($($argument),*)}
    )*};
}
impl<S:serde::Serializer> serde::Serializer for WithoutRegistry<S>{
    type Ok=S::Ok;type Error=S::Error;
    type SerializeSeq=S::SerializeSeq;type SerializeTuple=S::SerializeTuple;
    type SerializeTupleStruct=S::SerializeTupleStruct;type SerializeTupleVariant=S::SerializeTupleVariant;
    type SerializeMap=S::SerializeMap;type SerializeStruct=FilterStruct<S::SerializeStruct>;
    type SerializeStructVariant=S::SerializeStructVariant;
    forward_values!{
        serialize_bool(value:bool);serialize_i8(value:i8);serialize_i16(value:i16);serialize_i32(value:i32);serialize_i64(value:i64);serialize_i128(value:i128);
        serialize_u8(value:u8);serialize_u16(value:u16);serialize_u32(value:u32);serialize_u64(value:u64);serialize_u128(value:u128);
        serialize_f32(value:f32);serialize_f64(value:f64);serialize_char(value:char);serialize_str(value:&str);serialize_bytes(value:&[u8]);
        serialize_none();serialize_unit();serialize_unit_struct(name:&'static str);serialize_unit_variant(name:&'static str,index:u32,variant:&'static str)
    }
    fn serialize_some<T:Serialize+?Sized>(self,value:&T)->Result<Self::Ok,Self::Error>{self.serializer.serialize_some(value)}
    fn serialize_newtype_struct<T:Serialize+?Sized>(self,name:&'static str,value:&T)->Result<Self::Ok,Self::Error>{self.serializer.serialize_newtype_struct(name,value)}
    fn serialize_newtype_variant<T:Serialize+?Sized>(self,name:&'static str,index:u32,variant:&'static str,value:&T)->Result<Self::Ok,Self::Error>{self.serializer.serialize_newtype_variant(name,index,variant,value)}
    fn serialize_seq(self,len:Option<usize>)->Result<Self::SerializeSeq,Self::Error>{self.serializer.serialize_seq(len)}
    fn serialize_tuple(self,len:usize)->Result<Self::SerializeTuple,Self::Error>{self.serializer.serialize_tuple(len)}
    fn serialize_tuple_struct(self,name:&'static str,len:usize)->Result<Self::SerializeTupleStruct,Self::Error>{self.serializer.serialize_tuple_struct(name,len)}
    fn serialize_tuple_variant(self,name:&'static str,index:u32,variant:&'static str,len:usize)->Result<Self::SerializeTupleVariant,Self::Error>{self.serializer.serialize_tuple_variant(name,index,variant,len)}
    fn serialize_map(self,len:Option<usize>)->Result<Self::SerializeMap,Self::Error>{self.serializer.serialize_map(len)}
    fn serialize_struct(self,name:&'static str,len:usize)->Result<Self::SerializeStruct,Self::Error>{
        self.serializer.serialize_struct(name,len.saturating_sub(self.field_count)).map(FilterStruct)
    }
    fn serialize_struct_variant(self,name:&'static str,index:u32,variant:&'static str,len:usize)->Result<Self::SerializeStructVariant,Self::Error>{self.serializer.serialize_struct_variant(name,index,variant,len)}
    fn collect_str<T:std::fmt::Display+?Sized>(self,value:&T)->Result<Self::Ok,Self::Error>{self.serializer.collect_str(value)}
    fn is_human_readable(&self)->bool{self.serializer.is_human_readable()}
}
fn envelope<W:Serialize+?Sized>(project:&str,world:&W,digest:&str,save:Option<&serde_json::value::RawValue>,resources:BTreeMap<String,Resource>)->Result<(),String>{
    let observation=Observation{compiled_systems:unone_engine::compiled_systems(),project,world,
        observation_digest:digest,save_payload:save,
        instance_transport:INSTANCE_MEMORY.with(|m|m.get().then_some("wasm-memory-v1")),
        ui_transport:Transport{format:"retained-image-batches-v1",epoch:EPOCH.with(|e|e.get().to_string()),resources}};
    OUTPUT.with(|out|{let mut bytes=out.borrow_mut();bytes.clear();
        serde_json::to_writer(&mut *bytes,&observation).map_err(|error|error.to_string())})
}
pub(super) fn write(project:&str,snapshot:&WorldSnapshot,save:Option<&serde_json::value::RawValue>)->Result<(),String>{
    let digest=CANONICAL.with(|cache|{
        let mut bytes=cache.borrow_mut();bytes.clear();
        serde_json::to_writer(&mut *bytes,snapshot).map_err(|e|e.to_string())?;
        Ok::<_,String>(CANONICAL_HASHER.with(|h|h.borrow_mut().hash(&bytes).0))
    })?;
    let mut resources=BTreeMap::new();let mut leases=Vec::new();
    for (id,resource) in &snapshot.ui_image_batches {
        let bytes=resource.encoded_json().get().as_bytes();
        resources.insert(id.clone(),Resource{revision:resource.revision().to_string(),memory:Memory{offset:bytes.as_ptr() as usize,byte_length:bytes.len()}});
        leases.push(resource.clone());
    }
    let mut instances=Vec::new();
    if snapshot.instances3d.is_empty(){
        envelope(project,&Presentation(snapshot),&digest,save,resources)?;
    }else{
        // Instance-bearing worlds retain the established transport rewrite.
        let mut world=serde_json::to_value(Presentation(snapshot)).map_err(|e|e.to_string())?;
        for (id,batch) in &snapshot.instances3d {
            if INSTANCE_MEMORY.with(|m|m.get()) {
                world["instances3d"][id]=serde_json::json!({"asset":batch.asset,"count":batch.count,"format":batch.format,
                    "memory":{"offset":batch.packed.as_ptr() as usize,"byte_length":batch.packed.len(),"revision":batch.revision.to_string()}});
                instances.push(batch.packed.clone());
            }else{world["instances3d"][id]["data"]=serde_json::Value::String(batch.data().to_string());}
        }
        envelope(project,&world,&digest,save,resources)?;
    }
    // Retire previous leases only after the complete envelope was written.
    INSTANCE_BUFFERS.with(|out|*out.borrow_mut()=instances);
    LEASES.with(|out|*out.borrow_mut()=leases);Ok(())
}
/// Enable the optional immutable-resource memory wire; 0 restores complete JSON.
#[unsafe(no_mangle)]
pub extern "C" fn unone_web_set_ui_transport(mode:i32)->i32{
    if ![0,1].contains(&mode){write_error("UI_IMAGE_TRANSPORT_INVALID: use 0 (complete JSON) or 1 (retained-image-batches-v1)");return -1;}
    RUNTIME.with(|runtime|{
        let runtime=runtime.borrow();let Some(runtime)=runtime.as_ref() else{write_error("runtime is not initialized");return -1;};
        let previous=ENABLED.with(|v|v.replace(mode==1));let result=write_runtime_snapshot(runtime);
        if result!=0{ENABLED.with(|v|v.set(previous));}result
    })
}

#[cfg(test)]
mod tests{
 use super::*;
 fn output()->serde_json::Value{OUTPUT.with(|o|serde_json::from_slice(&o.borrow()).unwrap())}
 fn load(asset:&str){
  let script=format!(r#"local q={{asset='{asset}',rect={{x=0,y=0,width=100,height=100}},opacity=0.5}}
   return {{start=function(api)
    api.ui.imageBatch.define('art',{{bounds={{x=0,y=0,width=100,height=100}},quads={{q}}}})
    api.ui.setRoot({{kind='screen',id='s',node='s',children={{{{kind='image_batch',id='i',rect={{x=0,y=0,width=100,height=100}},content='art'}}}}}})
   end,update=function(api)api.ui.setRoot({{kind='screen',id='s',node='s',children={{{{kind='image_batch',id='i',rect={{x=0,y=0,width=100,height=100}},content='art',transform={{a=1,b=0,c=0,d=1,tx=5,ty=0}}}}}}}})end}}"#);
  let bytes=serde_json::to_vec(&serde_json::json!({"config":{"name":"retained","entry_script":"main.luau"},"script":script})).unwrap();
  assert_eq!(unsafe{unone_web_load_project(bytes.as_ptr(),bytes.len(),42)},0,"{}",output());
 }
 fn definition(value:&serde_json::Value)->serde_json::Value{
  let memory=&value["ui_transport"]["resources"]["art"]["memory"];
  let pointer=memory["offset"].as_u64().unwrap() as usize as *const u8;
  let length=memory["byte_length"].as_u64().unwrap() as usize;
  serde_json::from_slice(unsafe{std::slice::from_raw_parts(pointer,length)}).unwrap()
 }
 #[test]
 fn retained_memory_wire_is_complete_digest_equivalent_and_camera_updates_reuse_lease(){
  load("texture://a");let full=output();assert!(full["world"]["ui_image_batches"].is_object());
  assert_eq!(unone_web_set_ui_transport(1),0);let wire=output();let resource=definition(&wire);
  assert!(wire["world"].get("ui_image_batches").is_none());assert_eq!(wire["observation_digest"],full["observation_digest"]);
  let mut restored=wire["world"].clone();restored["ui_image_batches"]=serde_json::json!({"art":resource});assert_eq!(restored,full["world"]);
  assert_eq!(super::super::unone_web_tick(),0);let moved=output();assert_eq!(moved["ui_transport"],wire["ui_transport"]);
  assert_eq!(moved["world"]["ui"]["children"][0]["transform"]["tx"],5.0);
  RUNTIME.with(|r|assert_eq!(moved["observation_digest"],unone_engine::observation_digest(&r.borrow().as_ref().unwrap().observe()).unwrap()));
  assert_eq!(unone_web_set_ui_transport(9),-1);assert!(enabled());
  assert_eq!(unone_web_set_ui_transport(0),0);assert_eq!(output()["observation_digest"],moved["observation_digest"]);LEASES.with(|v|assert!(v.borrow().is_empty()));
  CANONICAL.with(|v|assert_eq!(v.borrow().capacity(),0));
 }
 #[test]
 fn reload_with_reused_resource_revisions_changes_epoch_and_old_generation_is_retired(){
  load("texture://before");assert_eq!(unone_web_set_ui_transport(1),0);let before=output();let owned=definition(&before);
  load("texture://after");assert_eq!(unone_web_set_ui_transport(1),0);let after=output();
  assert_ne!(before["ui_transport"]["epoch"],after["ui_transport"]["epoch"]);assert_eq!(definition(&after)["quads"][0]["asset"],"texture://after");
  assert_eq!(owned["quads"][0]["asset"],"texture://before");LEASES.with(|v|assert_eq!(v.borrow().len(),1));assert_eq!(unone_web_set_ui_transport(0),0);
 }
 #[test]
 fn borrowed_presentation_filters_only_the_registry_and_reuses_output_storage(){
  load("texture://borrowed");
  let mut snapshot=RUNTIME.with(|runtime|runtime.borrow().as_ref().unwrap().observe());
  snapshot.frame=321;snapshot.time_seconds=100.-3.1-3.1;
  snapshot.observations.insert("nested".into(),serde_json::json!({"ui_image_batches":{"retain":true},"small":1e-220,"escaped":"繁中\n\"\\","array":[]}));
  snapshot.physical_input_receipt=Some(unone_engine::PhysicalReceipt{profile:"ordered_physical_v1",epoch:2,through_sequence:9});
  snapshot.ui_cursor=Some(serde_json::from_value(serde_json::json!({"kind":"hidden"})).unwrap());
  let mut expected=serde_json::to_value(&snapshot).unwrap();expected.as_object_mut().unwrap().remove("ui_image_batches");
  assert_eq!(serde_json::to_value(Presentation(&snapshot)).unwrap(),expected);
  let save=serde_json::value::to_raw_value(&serde_json::json!({"large":"x".repeat(64*1024)})).unwrap();
  for memory in [false,true]{
   INSTANCE_MEMORY.with(|v|v.set(memory));write("borrowed",&snapshot,Some(&save)).unwrap();
   let value=output();assert_eq!(value["world"],expected);assert_eq!(value["observation_digest"],unone_engine::observation_digest(&snapshot).unwrap());
   assert_eq!(value.get("instance_transport").is_some(),memory);
   assert_eq!(definition(&value)["quads"][0]["asset"],"texture://borrowed");
   let pointer=OUTPUT.with(|v|v.borrow().as_ptr());
   for _ in 0..8{write("borrowed",&snapshot,Some(&save)).unwrap();assert_eq!(OUTPUT.with(|v|v.borrow().as_ptr()),pointer);}
  }
 }
 #[test]
 fn unload_retires_leases_and_releases_the_canonical_cache(){
  load("texture://unload");assert_eq!(unone_web_set_ui_transport(1),0);
  CANONICAL.with(|v|assert!(v.borrow().capacity()>0));LEASES.with(|v|assert!(!v.borrow().is_empty()));
  unload();assert!(!enabled());CANONICAL.with(|v|assert_eq!(v.borrow().capacity(),0));LEASES.with(|v|assert_eq!(v.borrow().capacity(),0));
 }
 #[test]
 fn removing_the_last_resource_retires_wire_bytes_and_hash_capacity(){
  let script=r#"return {start=function(api)
   api.ui.imageBatch.define('art',{bounds={x=0,y=0,width=100,height=100},quads={{asset='texture://release',rect={x=0,y=0,width=100,height=100}}}})
   api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='image_batch',id='i',rect={x=0,y=0,width=100,height=100},content='art'}}})
   end,update=function(api)
   api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='panel',id='empty',rect={x=0,y=0,width=1,height=1}}}})
   assert(api.ui.imageBatch.remove('art'))
   end}"#;
  let bytes=serde_json::to_vec(&serde_json::json!({"config":{"name":"release","entry_script":"main.luau"},"script":script})).unwrap();
  assert_eq!(unsafe{unone_web_load_project(bytes.as_ptr(),bytes.len(),42)},0);assert_eq!(unone_web_set_ui_transport(1),0);
  CANONICAL_HASHER.with(|v|assert!(v.borrow_mut().hash(&vec![0;1024*1024]).1.cache_storage_bytes>0));
  assert_eq!(super::super::unone_web_tick(),0);let value=output();assert!(value.get("ui_transport").is_none());
  CANONICAL.with(|v|assert_eq!(v.borrow().capacity(),0));LEASES.with(|v|assert_eq!(v.borrow().capacity(),0));
  CANONICAL_HASHER.with(|v|assert_eq!(v.borrow_mut().hash(b"").1.cache_storage_bytes,0));
  RUNTIME.with(|v|assert_eq!(value["observation_digest"],unone_engine::observation_digest(&v.borrow().as_ref().unwrap().observe()).unwrap()));
 }
 #[test]
 fn retained_resources_and_instances_share_both_transports_without_digest_or_lease_changes(){
  let script=r#"return {start=function(api)
   api.ui.imageBatch.define('art',{bounds={x=0,y=0,width=100,height=100},quads={{asset='texture://mixed',rect={x=0,y=0,width=100,height=100}}}})
   api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='image_batch',id='i',rect={x=0,y=0,width=100,height=100},content='art'}}})
   local b=buffer.create(40);buffer.writef32(b,24,1);buffer.writef32(b,28,1);buffer.writef32(b,32,1);buffer.writef32(b,36,1)
   api.instances3d.set('crowd','mesh://unit',b)
   end,update=function()end}"#;
  let bytes=serde_json::to_vec(&serde_json::json!({"config":{"name":"mixed","entry_script":"main.luau"},"script":script})).unwrap();
  assert_eq!(unsafe{unone_web_load_project(bytes.as_ptr(),bytes.len(),42)},0);let full=output();assert_eq!(unone_web_set_ui_transport(1),0);
  for memory in [false,true]{
   assert_eq!(super::super::unone_web_set_instance_transport(i32::from(memory)),0);let value=output();
   assert_eq!(value["observation_digest"],full["observation_digest"]);assert_eq!(definition(&value)["quads"][0]["asset"],"texture://mixed");
   assert_eq!(value["world"]["instances3d"]["crowd"].get("memory").is_some(),memory);
   assert_eq!(value["world"]["instances3d"]["crowd"].get("data").is_some(),!memory);
   INSTANCE_BUFFERS.with(|v|assert_eq!(v.borrow().len(),usize::from(memory)));LEASES.with(|v|assert_eq!(v.borrow().len(),1));
  }
 }
}

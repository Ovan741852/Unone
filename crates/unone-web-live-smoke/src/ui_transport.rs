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
pub(super) fn epoch()->u64 { EPOCH.with(Cell::get) }
pub(super) fn retire(){
    let had_ui=super::ui_tree_transport::clear();
    let had_fields=super::world_transport::clear();
    let had_cache=CANONICAL.with(|v|{let mut bytes=v.borrow_mut();let retained=bytes.capacity()>0;*bytes=Vec::new();retained});
    let had_leases=LEASES.with(|v|{let mut leases=v.borrow_mut();let retained=!leases.is_empty();*leases=Vec::new();retained});
    // Only the retained-wire retirement boundary drops the hash prefix too.
    // Complete-JSON publications keep their normal bounded prefix reuse.
    if had_cache||had_leases||had_ui||had_fields{CANONICAL_HASHER.with(|v|*v.borrow_mut()=unone_engine::CanonicalHasher::default());}
}
pub(super) fn unload(){
    super::save_transport::clear();
    super::ui_tree_transport::clear();
    super::world_transport::clear();
    LEASES.with(|v|*v.borrow_mut()=Vec::new());
    CANONICAL.with(|v|*v.borrow_mut()=Vec::new());
    ENABLED.with(|v|v.set(false));
}
pub(super) fn new_runtime()->Result<(),String>{
    let next=EPOCH.with(|e|e.get().checked_add(1)).ok_or("UI_IMAGE_TRANSPORT_EPOCH_LIMIT")?;
    EPOCH.with(|e|e.set(next));ENABLED.with(|v|v.set(false));super::save_transport::clear();Ok(())
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
    observation_digest:&'a str,
    #[serde(flatten)]
    save:&'a super::save_transport::Prepared<'a>,
    #[serde(skip_serializing_if="Option::is_none")]
    instance_transport:Option<&'static str>,
    #[serde(skip_serializing_if="Option::is_none")]
    ui_transport:Option<Transport>,
    #[serde(flatten)]
    ui_tree:&'a super::ui_tree_transport::Prepared,
    #[serde(flatten)]
    world_fields:&'a super::world_transport::Prepared,
}

// Delegate the complete canonical struct and filter only its top-level
// registry, UI and leased fields. Nested values serialize through the original
// serializer, so this needs no second field inventory or hidden serialization mode.
struct Presentation<'a>(&'a WorldSnapshot,bool,&'a super::world_transport::Prepared);
impl Serialize for Presentation<'_>{
    fn serialize<S:serde::Serializer>(&self,serializer:S)->Result<S::Ok,S::Error>{
        let hidden=usize::from(!self.0.ui_image_batches.is_empty())+usize::from(self.1&&self.0.ui.is_some())+self.2.len();
        self.0.serialize(WorldSerializer{serializer,fields:Fields{hide_registry:true,hide_ui:self.1,capture:None,instances:Some(self.0),leased:Some(self.2)},field_count:hidden})
    }
}
/// The canonical world with only its instance batches in transport form, for
/// publications without the retained UI wire.
pub(super) struct InstanceWorld<'a>(pub(super) &'a WorldSnapshot);
impl Serialize for InstanceWorld<'_>{
    fn serialize<S:serde::Serializer>(&self,serializer:S)->Result<S::Ok,S::Error>{
        self.0.serialize(WorldSerializer{serializer,fields:Fields{hide_registry:false,hide_ui:false,capture:None,instances:Some(self.0),leased:None},field_count:0})
    }
}
// Instance batches publish their presentation transport in place of the
// canonical {asset,count,format} entries: a Wasm memory view or base64 bytes,
// encoded directly instead of re-parsing and re-encoding the whole world.
struct InstanceTransport<'a>(&'a WorldSnapshot);
impl Serialize for InstanceTransport<'_>{
    fn serialize<S:serde::Serializer>(&self,serializer:S)->Result<S::Ok,S::Error>{
        use serde::ser::SerializeMap;
        #[derive(Serialize)]
        struct View{offset:usize,byte_length:usize,revision:String}
        #[derive(Serialize)]
        struct Entry<'a>{asset:&'a str,count:usize,format:&'static str,
            #[serde(skip_serializing_if="Option::is_none")]memory:Option<View>,
            #[serde(skip_serializing_if="Option::is_none")]data:Option<&'a str>}
        let memory=INSTANCE_MEMORY.with(|m|m.get());
        let mut map=serializer.serialize_map(Some(self.0.instances3d.len()))?;
        for (id,batch) in &self.0.instances3d{
            map.serialize_entry(id,&Entry{asset:&batch.asset,count:batch.count,format:batch.format,
                memory:memory.then(||View{offset:batch.packed.as_ptr() as usize,byte_length:batch.packed.len(),revision:batch.revision.to_string()}),
                data:(!memory).then(||batch.data())})?;
        }
        map.end()
    }
}
// Canonical meshes carry no bytes. The wire adds them to each entry: memory
// views of the immutable bytes, or base64 encoded once per mesh generation.
struct Geometry3DTransport<'a>(&'a WorldSnapshot);
impl Serialize for Geometry3DTransport<'_>{
    fn serialize<S:serde::Serializer>(&self,serializer:S)->Result<S::Ok,S::Error>{
        use serde::ser::SerializeMap;
        #[derive(Serialize)]
        struct View{offset:usize,byte_length:usize}
        #[derive(Serialize)]
        struct Views{vertices:View,indices:View}
        #[derive(Serialize)]
        struct Entry<'a>{format:&'static str,#[serde(skip_serializing_if="Option::is_none")]texture:Option<&'a str>,
            material:&'a unone_engine::Geometry3DMaterial,
            vertex_count:usize,index_count:usize,revision:u64,
            #[serde(skip_serializing_if="Option::is_none")]memory:Option<Views>,
            #[serde(skip_serializing_if="Option::is_none")]vertices:Option<&'a str>,
            #[serde(skip_serializing_if="Option::is_none")]indices:Option<&'a str>}
        let view=|bytes:&[u8]|View{offset:bytes.as_ptr() as usize,byte_length:bytes.len()};
        let memory=INSTANCE_MEMORY.with(|m|m.get());
        let mut map=serializer.serialize_map(Some(self.0.geometry3d.len()))?;
        for (id,mesh) in &self.0.geometry3d{
            let encoded=(!memory).then(||mesh.encoded());
            map.serialize_entry(id,&Entry{format:mesh.format(),texture:mesh.texture.as_deref(),material:&mesh.material,
                vertex_count:mesh.vertex_count(),index_count:mesh.index_count(),revision:mesh.revision,
                memory:memory.then(||Views{vertices:view(&mesh.vertices),indices:view(&mesh.indices)}),
                vertices:encoded.map(|[vertices,_]|vertices.as_str()),indices:encoded.map(|[_,indices]|indices.as_str())})?;
        }
        map.end()
    }
}
/// Packed instance and mesh bytes the published memory views point into; kept
/// alive until the next complete publication.
pub(super) fn instance_leases(snapshot:&WorldSnapshot)->Vec<std::sync::Arc<[u8]>>{
    if !INSTANCE_MEMORY.with(|m|m.get()){return Vec::new();}
    snapshot.instances3d.values().map(|batch|batch.packed.clone())
        .chain(snapshot.geometry3d.values().flat_map(|mesh|[mesh.vertices.clone(),mesh.indices.clone()])).collect()
}
/// Byte span of each top-level field value in the canonical encoding.
type Spans=Vec<(&'static str,usize,usize)>;
fn span(spans:&Spans,key:&str)->Option<(usize,usize)>{spans.iter().find(|(k,..)|*k==key).map(|&(_,start,end)|(start,end))}
#[derive(Clone,Copy)]
struct Capture<'a>{position:&'a Cell<usize>,spans:&'a RefCell<Spans>}
#[derive(Clone,Copy)]
struct Fields<'a>{hide_registry:bool,hide_ui:bool,capture:Option<Capture<'a>>,instances:Option<&'a WorldSnapshot>,leased:Option<&'a super::world_transport::Prepared>}
impl Fields<'_>{fn skips(self,key:&str)->bool{(self.hide_registry&&key=="ui_image_batches")||(self.hide_ui&&key=="ui")||self.leased.is_some_and(|l|l.leases(key))}}
struct CapturedValue<'a,T:?Sized>{key:&'static str,value:&'a T,capture:Capture<'a>}
impl<T:Serialize+?Sized> Serialize for CapturedValue<'_,T>{
    fn serialize<S:serde::Serializer>(&self,serializer:S)->Result<S::Ok,S::Error>{
        // SerializeStruct has already written the key and colon. Only
        // top-level values pass through this wrapper; nested fields are untouched.
        let start=self.capture.position.get();let result=self.value.serialize(serializer)?;
        self.capture.spans.borrow_mut().push((self.key,start,self.capture.position.get()));Ok(result)
    }
}
struct WorldSerializer<'a,S>{serializer:S,fields:Fields<'a>,field_count:usize}
struct FilterStruct<'a,S>{serializer:S,fields:Fields<'a>}
impl<S:serde::ser::SerializeStruct> serde::ser::SerializeStruct for FilterStruct<'_,S>{
    type Ok=S::Ok;type Error=S::Error;
    fn serialize_field<T:Serialize+?Sized>(&mut self,key:&'static str,value:&T)->Result<(),Self::Error>{
        if self.fields.skips(key){Ok(())}
        else if let Some(capture)=self.fields.capture{self.serializer.serialize_field(key,&CapturedValue{key,value,capture})}
        else if key=="instances3d"&&let Some(world)=self.fields.instances{self.serializer.serialize_field(key,&InstanceTransport(world))}
        else if key=="geometry3d"&&let Some(world)=self.fields.instances{self.serializer.serialize_field(key,&Geometry3DTransport(world))}
        else{self.serializer.serialize_field(key,value)}
    }
    fn skip_field(&mut self,key:&'static str)->Result<(),Self::Error>{
        if self.fields.skips(key){Ok(())}else{self.serializer.skip_field(key)}
    }
    fn end(self)->Result<Self::Ok,Self::Error>{self.serializer.end()}
}
macro_rules! forward_values{
    ($($name:ident($($argument:ident:$kind:ty),*));*$(;)?)=>{$(
        fn $name(self,$($argument:$kind),*)->Result<Self::Ok,Self::Error>{self.serializer.$name($($argument),*)}
    )*};
}
impl<'a,S:serde::Serializer> serde::Serializer for WorldSerializer<'a,S>{
    type Ok=S::Ok;type Error=S::Error;
    type SerializeSeq=S::SerializeSeq;type SerializeTuple=S::SerializeTuple;
    type SerializeTupleStruct=S::SerializeTupleStruct;type SerializeTupleVariant=S::SerializeTupleVariant;
    type SerializeMap=S::SerializeMap;type SerializeStruct=FilterStruct<'a,S::SerializeStruct>;
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
        self.serializer.serialize_struct(name,len.saturating_sub(self.field_count)).map(|serializer|FilterStruct{serializer,fields:self.fields})
    }
    fn serialize_struct_variant(self,name:&'static str,index:u32,variant:&'static str,len:usize)->Result<Self::SerializeStructVariant,Self::Error>{self.serializer.serialize_struct_variant(name,index,variant,len)}
    fn collect_str<T:std::fmt::Display+?Sized>(self,value:&T)->Result<Self::Ok,Self::Error>{self.serializer.collect_str(value)}
    fn is_human_readable(&self)->bool{self.serializer.is_human_readable()}
}
struct CountingWriter<'a>{bytes:&'a mut Vec<u8>,position:&'a Cell<usize>}
impl std::io::Write for CountingWriter<'_>{
    fn write(&mut self,bytes:&[u8])->std::io::Result<usize>{self.bytes.extend_from_slice(bytes);self.position.set(self.bytes.len());Ok(bytes.len())}
    fn flush(&mut self)->std::io::Result<()>{Ok(())}
}
fn canonical<T:Serialize+?Sized>(bytes:&mut Vec<u8>,snapshot:&T)->Result<Spans,String>{
    bytes.clear();let position=Cell::new(0);let spans=RefCell::new(Vec::with_capacity(40));
    let mut serializer=serde_json::Serializer::new(CountingWriter{bytes,position:&position});
    snapshot.serialize(WorldSerializer{serializer:&mut serializer,fields:Fields{hide_registry:false,hide_ui:false,capture:Some(Capture{position:&position,spans:&spans}),instances:None,leased:None},field_count:0}).map_err(|e|e.to_string())?;
    Ok(spans.into_inner())
}
fn finish_ui_publication(ui_tree:super::ui_tree_transport::Prepared,oversized:bool){
    let released_ui=ui_tree.releases_large_bytes();ui_tree.commit();
    // Inline fallback already lives in OUTPUT. Keeping another >64 MiB copy
    // as scratch would defeat the lease budget, even while that UI is current.
    let shrunk=CANONICAL.with(|cache|{let mut bytes=cache.borrow_mut();
        if oversized{*bytes=Vec::new();true}
        else if bytes.capacity()>1024*1024&&bytes.len()<bytes.capacity()/4{bytes.shrink_to_fit();true}
        else{false}});
    if released_ui||shrunk{CANONICAL_HASHER.with(|v|*v.borrow_mut()=unone_engine::CanonicalHasher::default());}
}
fn envelope<W:Serialize+?Sized>(project:&str,world:&W,digest:&str,save:&super::save_transport::Prepared<'_>,resources:BTreeMap<String,Resource>,ui_tree:&super::ui_tree_transport::Prepared,world_fields:&super::world_transport::Prepared)->Result<(),String>{
    let observation=Observation{compiled_systems:unone_engine::compiled_systems(),project,world,
        observation_digest:digest,save,
        instance_transport:INSTANCE_MEMORY.with(|m|m.get().then_some("wasm-memory-v1")),
        ui_transport:(!resources.is_empty()).then(||Transport{format:"retained-image-batches-v1",epoch:EPOCH.with(|e|e.get().to_string()),resources}),ui_tree,world_fields};
    OUTPUT.with(|out|{let mut bytes=out.borrow_mut();bytes.clear();
        serde_json::to_writer(&mut *bytes,&observation).map_err(|error|error.to_string())})
}
pub(super) fn write(project:&str,snapshot:&WorldSnapshot,save:&super::save_transport::Prepared<'_>)->Result<(),String>{
    #[cfg(any(feature="dev-tools",feature="preview-tools"))]
    let measuring=PUBLICATION_PROFILE.with(|p|p.borrow().active);
    #[cfg(not(any(feature="dev-tools",feature="preview-tools")))]
    let measuring=false;
    let (digest,_work,_encode_ms,_hash_ms,spans,oversized)=CANONICAL.with(|cache|{
        let started=measuring.then(std::time::Instant::now);
        let mut bytes=cache.borrow_mut();let spans=canonical(&mut bytes,snapshot)?;
        let encode_ms=started.map_or(0.,|t|t.elapsed().as_secs_f64()*1000.);
        let started=measuring.then(std::time::Instant::now);
        let (digest,work)=CANONICAL_HASHER.with(|h|h.borrow_mut().hash(&bytes));
        let hash_ms=started.map_or(0.,|t|t.elapsed().as_secs_f64()*1000.);
        let oversized=span(&spans,"ui").is_some_and(|(start,end)|end-start>super::ui_tree_transport::MAX_ENCODED_BYTES);
        Ok::<_,String>((digest,work,encode_ms,hash_ms,spans,oversized))
    })?;
    let presentation_started=measuring.then(std::time::Instant::now);
    let (ui_tree,world_fields)=CANONICAL.with(|cache|{let bytes=cache.borrow();
        let ui_tree=super::ui_tree_transport::prepare(span(&spans,"ui").map(|(start,end)|&bytes[start..end]),epoch())?;
        let world_fields=super::world_transport::prepare(spans.iter().map(|&(key,start,end)|(key,&bytes[start..end])),epoch())?;
        Ok::<_,String>((ui_tree,world_fields))})?;
    let mut resources=BTreeMap::new();let mut leases=Vec::new();
    for (id,resource) in &snapshot.ui_image_batches {
        let bytes=resource.encoded_json().get().as_bytes();
        resources.insert(id.clone(),Resource{revision:resource.revision().to_string(),memory:Memory{offset:bytes.as_ptr() as usize,byte_length:bytes.len()}});
        leases.push(resource.clone());
    }
    let instances=instance_leases(snapshot);
    let _presentation_ms=presentation_started.map_or(0.,|t|t.elapsed().as_secs_f64()*1000.);
    let envelope_started=measuring.then(std::time::Instant::now);
    envelope(project,&Presentation(snapshot,ui_tree.has_lease(),&world_fields),&digest,save,resources,&ui_tree,&world_fields)?;
    let _envelope_ms=envelope_started.map_or(0.,|t|t.elapsed().as_secs_f64()*1000.);
    // Retire previous leases only after the complete envelope was written.
    INSTANCE_BUFFERS.with(|out|*out.borrow_mut()=instances);
    LEASES.with(|out|*out.borrow_mut()=leases);
    world_fields.commit();
    // A cleared/oversized UI must not leave its former large scratch allocation
    // or hash-prefix contents reachable indefinitely. Keep normal reuse while
    // the current complete canonical world still needs that capacity.
    finish_ui_publication(ui_tree,oversized);
    #[cfg(any(feature="dev-tools",feature="preview-tools"))]
    if measuring{PUBLICATION_PROFILE.with(|p|p.borrow_mut().record([_encode_ms,_hash_ms,_presentation_ms,_envelope_ms],_work,snapshot.frame,if snapshot.instances3d.is_empty(){"retained"}else{"retained-instances"}));}
    Ok(())
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
 fn write(project:&str,snapshot:&WorldSnapshot,save:Option<&serde_json::value::RawValue>)->Result<(),String>{
  let prepared=super::super::save_transport::prepare(save,true,epoch())?;
  super::write(project,snapshot,&prepared)?;prepared.commit();Ok(())
 }
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
 fn ui(value:&serde_json::Value)->serde_json::Value{
  let memory=&value["ui_tree_transport"]["memory"];
  let pointer=memory["offset"].as_u64().unwrap() as usize as *const u8;
  let length=memory["byte_length"].as_u64().unwrap() as usize;
  serde_json::from_slice(unsafe{std::slice::from_raw_parts(pointer,length)}).unwrap()
 }
 fn restored_world(value:&serde_json::Value)->serde_json::Value{
  let mut world=value["world"].clone();if value.get("ui_tree_transport").is_some(){world["ui"]=ui(value);}
  for (key,field) in value["world_transport"]["fields"].as_object().into_iter().flatten(){world[key]=leased(field);}world
 }
 fn leased(field:&serde_json::Value)->serde_json::Value{
  let pointer=field["memory"]["offset"].as_u64().unwrap() as usize as *const u8;
  let length=field["memory"]["byte_length"].as_u64().unwrap() as usize;
  serde_json::from_slice(unsafe{std::slice::from_raw_parts(pointer,length)}).unwrap()
 }
 #[test]
 fn retained_memory_wire_is_complete_digest_equivalent_and_camera_updates_reuse_lease(){
  load("texture://a");let full=output();assert!(full["world"]["ui_image_batches"].is_object());
  assert_eq!(unone_web_set_ui_transport(1),0);let wire=output();let resource=definition(&wire);
  assert!(wire["world"].get("ui_image_batches").is_none());assert_eq!(wire["observation_digest"],full["observation_digest"]);
  let mut restored=restored_world(&wire);restored["ui_image_batches"]=serde_json::json!({"art":resource});assert_eq!(restored,full["world"]);
  assert_eq!(super::super::unone_web_tick(),0);let moved=output();assert_eq!(moved["ui_transport"],wire["ui_transport"]);
  assert_eq!(ui(&moved)["children"][0]["transform"]["tx"],5.0);
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
  let fields=super::super::world_transport::prepare(std::iter::empty(),epoch()).unwrap();
  assert_eq!(serde_json::to_value(Presentation(&snapshot,false,&fields)).unwrap(),expected);
  let save=serde_json::value::to_raw_value(&serde_json::json!({"large":"x".repeat(64*1024)})).unwrap();
  for memory in [false,true]{
   INSTANCE_MEMORY.with(|v|v.set(memory));write("borrowed",&snapshot,Some(&save)).unwrap();
   let value=output();assert_eq!(restored_world(&value),expected);assert_eq!(value["observation_digest"],unone_engine::observation_digest(&snapshot).unwrap());
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
 fn removing_the_last_resource_retires_resource_bytes_without_clearing_the_ui_lease(){
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
  CANONICAL.with(|v|v.borrow_mut().reserve(4*1024*1024));
  assert_eq!(super::super::unone_web_tick(),0);let value=output();assert!(value.get("ui_transport").is_none());
  CANONICAL.with(|v|assert!(v.borrow().capacity()<1024*1024));LEASES.with(|v|assert_eq!(v.borrow().len(),0));
  assert!(value["world"].get("ui").is_none());assert_eq!(ui(&value)["children"][0]["id"],"empty");
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
 #[test]
 fn large_world_fields_lease_by_revision_and_unchanged_fields_keep_their_view(){
  load("texture://fields");assert_eq!(unone_web_set_ui_transport(1),0);
  let mut snapshot=RUNTIME.with(|r|r.borrow().as_ref().unwrap().observe());
  snapshot.observations.insert("terrain".into(),serde_json::json!("x".repeat(4096)));
  write("fields",&snapshot,None).unwrap();let first=output();
  let observations=first["world_transport"]["fields"]["observations"].clone();
  assert_eq!(first["world_transport"]["format"],"world-fields-memory-v1");assert!(first["world"].get("observations").is_none());
  assert!(first["world_transport"]["fields"].get("frame").is_none());assert_eq!(first["world"]["frame"],snapshot.frame);
  let mut expected=serde_json::to_value(&snapshot).unwrap();expected.as_object_mut().unwrap().remove("ui_image_batches");
  assert_eq!(restored_world(&first),expected);assert_eq!(first["observation_digest"],unone_engine::observation_digest(&snapshot).unwrap());
  snapshot.frame+=1;write("fields",&snapshot,None).unwrap();let same=output();
  assert_eq!(same["world_transport"]["fields"]["observations"],observations);
  snapshot.observations.insert("terrain".into(),serde_json::json!("y".repeat(4096)));write("fields",&snapshot,None).unwrap();let changed=output();
  assert_ne!(changed["world_transport"]["fields"]["observations"]["revision"],observations["revision"]);
  assert_eq!(restored_world(&changed)["observations"]["terrain"].as_str().unwrap().as_bytes()[0],b'y');
  // Complete JSON restores every field inline and retires the leases.
  assert_eq!(unone_web_set_ui_transport(0),0);let full=output();assert!(full.get("world_transport").is_none());assert!(full["world"]["observations"].is_object());
 }
 #[test]
 fn retained_meshes_publish_stable_memory_views_and_complete_base64_without_memory(){
  let script=r#"local v=buffer.create(3*36);local ix=buffer.create(12)
   for i=0,2 do buffer.writef32(v,i*36,i);for c=0,3 do buffer.writef32(v,i*36+20+c*4,1) end;buffer.writeu32(ix,i*4,i) end
   return {start=function(api)api.geometry3d.set('tri',{vertices=v,indices=ix})end,
    update=function(api)api.geometry3d.setTransform('tri',{position={x=1,y=0,z=0}})end}"#;
  let bytes=serde_json::to_vec(&serde_json::json!({"config":{"name":"mesh","entry_script":"main.luau"},"script":script})).unwrap();
  assert_eq!(unsafe{unone_web_load_project(bytes.as_ptr(),bytes.len(),42)},0,"{}",output());
  // Without memory views the wire inlines base64; the canonical entry and its digest never carry bytes.
  let full=output();let inline=full["world"]["geometry3d"]["tri"].clone();assert!(inline["vertices"].is_string()&&inline["indices"].is_string());
  assert_eq!(unone_web_set_ui_transport(1),0);assert_eq!(super::super::unone_web_set_instance_transport(1),0);
  let wire=output();let mesh=&wire["world"]["geometry3d"]["tri"];
  assert!(mesh.get("vertices").is_none());assert_eq!(mesh["revision"],inline["revision"]);assert_eq!(wire["observation_digest"],full["observation_digest"]);
  let read=|view:&serde_json::Value|{let pointer=view["offset"].as_u64().unwrap() as usize as *const u8;
   unsafe{std::slice::from_raw_parts(pointer,view["byte_length"].as_u64().unwrap() as usize)}.to_vec()};
  let snapshot=RUNTIME.with(|r|r.borrow().as_ref().unwrap().observe());let owned=&snapshot.geometry3d["tri"];
  assert!(serde_json::to_value(owned).unwrap().get("vertices").is_none());
  assert_eq!(read(&mesh["memory"]["vertices"]),owned.vertices.to_vec());assert_eq!(read(&mesh["memory"]["indices"]),owned.indices.to_vec());
  assert!(wire.get("world_transport").is_none_or(|t|t["fields"].get("geometry3d").is_none()),"meshes are never leased as JSON");
  // A placement-only tick keeps the same bytes and memory views.
  assert_eq!(super::super::unone_web_tick(),0);let moved=output();
  assert_eq!(moved["world"]["geometry3d"]["tri"]["memory"],mesh["memory"]);assert_eq!(moved["world"]["geometry3d_placements"]["tri"]["transforms"][0]["position"]["x"],1.0);
  assert_eq!(super::super::unone_web_set_instance_transport(0),0);assert!(output()["world"]["geometry3d"]["tri"]["vertices"].is_string());
 }
 #[test]
 fn ordinary_ui_without_registry_uses_a_stable_current_lease_and_complete_canonical_bytes(){
  let script=r#"return {start=function(api)api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='text',id='text',rect={x=0,y=0,width=1,height=1},text='中文\\n\"\\'}}})end,update=function()end}"#;
  let bytes=serde_json::to_vec(&serde_json::json!({"config":{"name":"ordinary","entry_script":"main.luau"},"script":script})).unwrap();
  assert_eq!(unsafe{unone_web_load_project(bytes.as_ptr(),bytes.len(),42)},0,"{}",output());let full=output();
  assert_eq!(unone_web_set_ui_transport(1),0);let first=output();
  assert!(first.get("ui_transport").is_none());assert!(first["world"].get("ui").is_none());assert_eq!(ui(&first),full["world"]["ui"]);
  assert_eq!(first["observation_digest"],full["observation_digest"]);
  for _ in 0..8{assert_eq!(super::super::unone_web_tick(),0);assert_eq!(output()["ui_tree_transport"],first["ui_tree_transport"]);}
  let mut snapshot=RUNTIME.with(|r|r.borrow().as_ref().unwrap().observe());
  snapshot.observations.insert("nested".into(),serde_json::json!({"ui":{"ui_image_batches":"retain"},"ui_image_batches":{"ui":"retain"},"escape":"\\\"\n中文","number":1e-220}));
  let mut encoded=Vec::new();let (start,end)=span(&canonical(&mut encoded,&snapshot).unwrap(),"ui").unwrap();
  assert_eq!(encoded,serde_json::to_vec(&snapshot).unwrap());assert_eq!(&encoded[start..end],serde_json::to_vec(snapshot.ui.as_ref().unwrap()).unwrap());
  snapshot.ui=None;assert!(span(&canonical(&mut encoded,&snapshot).unwrap(),"ui").is_none());assert_eq!(encoded,serde_json::to_vec(&snapshot).unwrap());
 }
 #[test]
 fn identical_ui_bytes_do_not_reuse_private_resource_usage_or_hide_registry_updates(){
  let script=r#"local q={asset='texture://usage',rect={x=0,y=0,width=1,height=1}}
   return {start=function(api)
    api.ui.imageBatch.define('art',{bounds={x=0,y=0,width=100,height=100},quads={q}})
    api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='image_batch',id='i',rect={x=0,y=0,width=100,height=100},content='art'}}})
   end,update=function(api)
    api.ui.imageBatch.define('art',{bounds={x=0,y=0,width=100,height=100},quads={q,q}})
    api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='image_batch',id='i',rect={x=0,y=0,width=100,height=100},content='art'}}})
   end}"#;
  let bytes=serde_json::to_vec(&serde_json::json!({"config":{"name":"usage","entry_script":"main.luau"},"script":script})).unwrap();
  assert_eq!(unsafe{unone_web_load_project(bytes.as_ptr(),bytes.len(),42)},0);assert_eq!(unone_web_set_ui_transport(1),0);let before=output();
  let usage=RUNTIME.with(|r|r.borrow().as_ref().unwrap().observe().ui.unwrap().usage().logical_nodes);
  assert_eq!(super::super::unone_web_tick(),0);let after=output();assert_eq!(after["ui_tree_transport"],before["ui_tree_transport"]);
  assert_ne!(after["ui_transport"]["resources"]["art"]["revision"],before["ui_transport"]["resources"]["art"]["revision"]);
  assert_eq!(definition(&after)["quads"].as_array().unwrap().len(),2);
  assert_eq!(RUNTIME.with(|r|r.borrow().as_ref().unwrap().observe().ui.unwrap().usage().logical_nodes),usage+1);
 }
 #[test]
 fn no_ui_world_retires_the_previous_ui_lease_and_reuses_retained_scratch(){
  load("texture://direct");assert_eq!(unone_web_set_ui_transport(1),0);let first=output();
  let snapshot=RUNTIME.with(|r|r.borrow().as_ref().unwrap().observe());let mut no_ui=snapshot.clone();no_ui.ui=None;no_ui.ui_image_batches.clear();
  assert_eq!(publish_snapshot("direct",&no_ui,None),0);let direct=output();assert!(enabled());assert!(direct.get("ui_tree_transport").is_none());assert!(direct.get("ui_transport").is_none());
  assert_eq!(restored_world(&direct),serde_json::to_value(&no_ui).unwrap());assert_eq!(direct["observation_digest"],unone_engine::observation_digest(&no_ui).unwrap());
  // Later no-UI frames reuse the retained canonical scratch instead of reallocating it.
  let scratch=CANONICAL.with(|v|v.borrow().as_ptr());
  assert_eq!(publish_snapshot("direct",&no_ui,None),0);CANONICAL.with(|v|assert_eq!(v.borrow().as_ptr(),scratch));
  assert_eq!(publish_snapshot("restore",&snapshot,None),0);let restored=output();assert_eq!(restored["ui_tree_transport"]["epoch"],first["ui_tree_transport"]["epoch"]);let revision=first["ui_tree_transport"]["revision"].as_str().unwrap().parse::<u64>().unwrap();assert_eq!(restored["ui_tree_transport"]["revision"],(revision+1).to_string());
 }
 #[test]
 fn failed_envelope_preserves_previous_ui_generation_and_clear_disable_reload_are_monotonic(){
  load("texture://transaction");assert_eq!(unone_web_set_ui_transport(1),0);let first=output();
  let old=ui(&first);let old_pointer=first["ui_tree_transport"]["memory"]["offset"].clone();
  let epoch=epoch();let candidate=super::super::ui_tree_transport::prepare(Some(b"{\"changed\":true}"),epoch).unwrap();
  struct Fails;impl Serialize for Fails{fn serialize<S:serde::Serializer>(&self,_:S)->Result<S::Ok,S::Error>{Err(serde::ser::Error::custom("injected envelope failure"))}}
  let save=super::super::save_transport::prepare(None,true,epoch).unwrap();
  let fields=super::super::world_transport::prepare(std::iter::empty(),epoch).unwrap();
  assert!(envelope("failed",&Fails,"digest",&save,BTreeMap::new(),&candidate,&fields).is_err());drop(candidate);
  assert_eq!(ui(&first),old);
  let snapshot=RUNTIME.with(|r|r.borrow().as_ref().unwrap().observe());write("transaction",&snapshot,None).unwrap();let retry=output();assert_eq!(retry["ui_tree_transport"]["memory"]["offset"],old_pointer);assert_eq!(retry["ui_tree_transport"]["revision"],first["ui_tree_transport"]["revision"]);
  let revision=first["ui_tree_transport"]["revision"].as_str().unwrap().parse::<u64>().unwrap();
  let mut cleared=snapshot.clone();cleared.ui=None;CANONICAL.with(|v|v.borrow_mut().reserve(4*1024*1024));write("clear",&cleared,None).unwrap();assert!(output().get("ui_tree_transport").is_none());CANONICAL.with(|v|assert!(v.borrow().capacity()<1024*1024));
  write("restore",&snapshot,None).unwrap();assert_eq!(output()["ui_tree_transport"]["revision"],(revision+1).to_string());
  assert_eq!(unone_web_set_ui_transport(0),0);assert!(output().get("ui_tree_transport").is_none());assert_eq!(unone_web_set_ui_transport(1),0);assert_eq!(output()["ui_tree_transport"]["revision"],(revision+2).to_string());
  load("texture://transaction");assert_eq!(unone_web_set_ui_transport(1),0);let reloaded=output();assert_ne!(reloaded["ui_tree_transport"]["epoch"],first["ui_tree_transport"]["epoch"]);assert_eq!(reloaded["ui_tree_transport"]["revision"],"1");
 }
 #[test]
 fn escaped_oversized_ui_falls_back_inline_and_releases_duplicate_scratch_after_success(){
  #[derive(Serialize)]struct Fixture<'a>{before:u32,ui:&'a str,after:u32}
  let text="\u{1}".repeat(super::super::ui_tree_transport::MAX_ENCODED_BYTES/6+1);let fixture=Fixture{before:1,ui:&text,after:2};
  let prepared=CANONICAL.with(|cache|{let mut bytes=cache.borrow_mut();let (start,end)=span(&canonical(&mut bytes,&fixture).unwrap(),"ui").unwrap();assert!(end-start>super::super::ui_tree_transport::MAX_ENCODED_BYTES);super::super::ui_tree_transport::prepare(Some(&bytes[start..end]),epoch()).unwrap()});assert!(!prepared.has_lease());
  let save=super::super::save_transport::prepare(None,true,epoch()).unwrap();let fields=super::super::world_transport::prepare(std::iter::empty(),epoch()).unwrap();envelope("oversized",&fixture,"digest",&save,BTreeMap::new(),&prepared,&fields).unwrap();
  finish_ui_publication(prepared,true);CANONICAL.with(|v|assert_eq!(v.borrow().capacity(),0));
  let value=output();assert!(value.get("ui_tree_transport").is_none());assert_eq!(value["world"]["ui"].as_str().unwrap().len(),text.len());assert_eq!(value["world"]["before"],1);assert_eq!(value["world"]["after"],2);
  // Test-only large output is not a runtime lease after the test ends.
  OUTPUT.with(|v|*v.borrow_mut()=Vec::new());
 }
 #[cfg(feature="dev-tools")]
 #[test]
 fn developer_reload_commits_new_resources_and_ui_only_after_success(){
  load("texture://reload-before");assert_eq!(unone_web_set_ui_transport(1),0);let before=output();let owned=ui(&before);
  let success=r#"return {start=function()end,update=function()end,onReload=function(api)
   api.ui.imageBatch.define('art',{bounds={x=0,y=0,width=100,height=100},quads={{asset='texture://reload-after',rect={x=0,y=0,width=100,height=100}}}})
   api.ui.setRoot({kind='screen',id='changed',node='s',children={{kind='image_batch',id='new',rect={x=0,y=0,width=100,height=100},content='art'}}})end}"#;
  assert_eq!(unsafe{super::super::unone_web_reload_script(success.as_ptr(),success.len())},0,"{}",output());let changed=output();
  assert_eq!(changed["ui_tree_transport"]["epoch"],before["ui_tree_transport"]["epoch"]);assert_ne!(changed["ui_tree_transport"]["revision"],before["ui_tree_transport"]["revision"]);assert_eq!(ui(&changed)["id"],"changed");assert_eq!(owned["id"],"s");
  assert_eq!(definition(&changed)["quads"][0]["asset"],"texture://reload-after");assert_ne!(changed["ui_transport"]["resources"]["art"]["revision"],before["ui_transport"]["resources"]["art"]["revision"]);
  let failure=success.replace("texture://reload-after","texture://must-rollback").replace("end}","error('reload rollback')end}");
  assert_eq!(unsafe{super::super::unone_web_reload_script(failure.as_ptr(),failure.len())},-1);
  // A failed reload emits diagnostics, but cannot retire the last successful
  // UI/resource memory views. The next observation must reuse both generations.
  assert_eq!(ui(&changed)["id"],"changed");assert_eq!(definition(&changed)["quads"][0]["asset"],"texture://reload-after");
  RUNTIME.with(|r|assert_eq!(write_runtime_snapshot(r.borrow().as_ref().unwrap()),0));let retry=output();assert_eq!(retry["ui_tree_transport"],changed["ui_tree_transport"]);assert_eq!(retry["ui_transport"],changed["ui_transport"]);assert_eq!(retry["observation_digest"],changed["observation_digest"]);
 }
}

//! One immutable save lease for the official player. Canonical inspection keeps
//! the complete save; the player borrows encoded bytes only when they change.
use super::*;
use std::rc::Rc;

#[derive(Clone)]
struct Lease { epoch:u64, revision:u64, bytes:Rc<str> }
thread_local! { static CURRENT:RefCell<Option<Lease>>=const{RefCell::new(None)}; }
pub(super) fn clear(){CURRENT.with(|v|*v.borrow_mut()=None);}
#[derive(Serialize)]
struct Memory {offset:usize,byte_length:usize}
#[derive(Serialize)]
struct Descriptor {format:&'static str,epoch:String,revision:String,memory:Memory}
#[derive(Serialize)]
pub(super) struct Prepared<'a>{
    #[serde(skip_serializing_if="Option::is_none")]
    save_payload:Option<Option<&'a serde_json::value::RawValue>>,
    #[serde(skip_serializing_if="Option::is_none")]
    save_transport:Option<Descriptor>,
    #[serde(skip)]
    lease:Option<Lease>,
}
pub(super) fn prepare(save:Option<&serde_json::value::RawValue>,enabled:bool,epoch:u64)->Result<Prepared<'_>,String>{
    if !enabled{return Ok(Prepared{save_payload:Some(save),save_transport:None,lease:None});}
    let text=save.map_or("null",serde_json::value::RawValue::get);
    let old=CURRENT.with(|v|v.borrow().clone()).filter(|v|v.epoch==epoch);
    let lease=match old{
        Some(old) if old.bytes.as_ref()==text=>old,
        old=>Lease{epoch,revision:old.as_ref().map_or(Some(1),|v|v.revision.checked_add(1)).ok_or("SAVE_TRANSPORT_REVISION_LIMIT")?,bytes:Rc::from(text)},
    };
    let descriptor=Descriptor{format:"save-memory-v1",epoch:epoch.to_string(),revision:lease.revision.to_string(),
        memory:Memory{offset:lease.bytes.as_ptr() as usize,byte_length:lease.bytes.len()}};
    Ok(Prepared{save_payload:None,save_transport:Some(descriptor),lease:Some(lease)})
}
impl Prepared<'_>{
    pub(super) fn append_fields(&self,bytes:&mut Vec<u8>)->Result<(),String>{
        if let Some(descriptor)=&self.save_transport{
            bytes.extend_from_slice(b",\"save_transport\":");append_json(bytes,descriptor)
        }else{
            bytes.extend_from_slice(b",\"save_payload\":");append_json(bytes,&self.save_payload.flatten())
        }
    }
    // Keep the previous lease alive until publication of the entire envelope
    // succeeds. A failed candidate must not invalidate borrowed old bytes.
    pub(super) fn commit(self){CURRENT.with(|v|*v.borrow_mut()=self.lease);}
}

#[cfg(test)]
mod tests{
    use super::*;
    fn pointer(value:&Prepared<'_>)->usize{value.save_transport.as_ref().unwrap().memory.offset}
    #[test]
    fn unchanged_save_reuses_one_owned_lease_and_failed_candidate_preserves_old_bytes(){
        clear();let raw=serde_json::value::to_raw_value(&serde_json::json!({"large":"x".repeat(112*1024),"escaped":"繁中\n\""})).unwrap();
        let first=prepare(Some(&raw),true,7).unwrap();let address=pointer(&first);first.commit();
        for _ in 0..120{let next=prepare(Some(&raw),true,7).unwrap();assert_eq!(pointer(&next),address);assert_eq!(next.save_transport.as_ref().unwrap().revision,"1");next.commit();}
        let changed=serde_json::value::RawValue::from_string("{\"coins\":9}".into()).unwrap();
        let failed=prepare(Some(&changed),true,7).unwrap();assert_ne!(pointer(&failed),address);drop(failed);
        CURRENT.with(|v|assert_eq!(v.borrow().as_ref().unwrap().bytes.as_ref(),raw.get()));
        let changed=prepare(Some(&changed),true,7).unwrap();assert_eq!(changed.save_transport.as_ref().unwrap().revision,"2");changed.commit();
        let cleared=prepare(None,true,7).unwrap();assert_eq!(cleared.lease.as_ref().unwrap().bytes.as_ref(),"null");assert_eq!(cleared.save_transport.as_ref().unwrap().revision,"3");cleared.commit();
        let reloaded=prepare(Some(&raw),true,8).unwrap();assert_eq!(reloaded.save_transport.as_ref().unwrap().revision,"1");assert_eq!(reloaded.save_transport.as_ref().unwrap().epoch,"8");reloaded.commit();
        prepare(Some(&raw),false,8).unwrap().commit();CURRENT.with(|v|assert!(v.borrow().is_none()));
    }
    #[test]
    fn actual_abi_leases_saves_with_and_without_artwork_and_preserves_full_inspection(){
        for artwork in [false,true]{
            let script=if artwork{"return {start=function(api) api.ui.imageBatch.define('art',{bounds={x=0,y=0,width=1,height=1},quads={{asset='texture://x',rect={x=0,y=0,width=1,height=1}}}}) end,update=function()end}"}else{"return {start=function()end,update=function()end}"};
            let input=serde_json::to_vec(&serde_json::json!({"config":{"name":"save lease","entry_script":"main.luau"},"script":script})).unwrap();
            assert_eq!(unsafe{unone_web_load_project(input.as_ptr(),input.len(),42)},0,"{}",OUTPUT.with(|v|String::from_utf8_lossy(&v.borrow()).into_owned()));
            let payload=serde_json::json!({"large":"x".repeat(112*1024),"coins":7});
            RUNTIME.with(|v|v.borrow_mut().as_mut().unwrap().set_save_payload(Some(payload.clone())));
            assert_eq!(ui_transport::unone_web_set_ui_transport(1),0);
            let read=||OUTPUT.with(|v|serde_json::from_slice::<serde_json::Value>(&v.borrow()).unwrap());
            let first=read();assert!(first.get("save_payload").is_none());
            let memory=&first["save_transport"]["memory"];
            let address=memory["offset"].as_u64().unwrap() as usize;
            let bytes=unsafe{std::slice::from_raw_parts(address as *const u8,memory["byte_length"].as_u64().unwrap() as usize)};
            assert_eq!(serde_json::from_slice::<serde_json::Value>(bytes).unwrap(),payload);
            OUTPUT.with(|v|assert!(v.borrow().len()<8192));
            assert_eq!(unone_web_tick(),0);assert_eq!(read()["save_transport"],first["save_transport"]);
            RUNTIME.with(|v|v.borrow_mut().as_mut().unwrap().set_save_payload(None));
            assert_eq!(unone_web_tick(),0);let cleared=read();assert_eq!(cleared["save_transport"]["revision"],"2");
            let p=cleared["save_transport"]["memory"]["offset"].as_u64().unwrap() as usize;
            assert_eq!(unsafe{std::slice::from_raw_parts(p as *const u8,4)},b"null");
            RUNTIME.with(|v|v.borrow_mut().as_mut().unwrap().set_save_payload(Some(payload.clone())));
            assert_eq!(ui_transport::unone_web_set_ui_transport(0),0);let full=read();assert_eq!(full["save_payload"],payload);assert!(full.get("save_transport").is_none());
            CURRENT.with(|v|assert!(v.borrow().is_none()));
            assert_eq!(ui_transport::unone_web_set_ui_transport(1),0);assert_eq!(read()["observation_digest"],full["observation_digest"]);
            unone_web_unload_project();CURRENT.with(|v|assert!(v.borrow().is_none()));
        }
    }
}

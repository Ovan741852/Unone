//! Current-only immutable encoded UI lease. The canonical snapshot remains full;
//! candidates are private until the complete presentation envelope succeeds.
use serde::Serialize;
use std::{cell::RefCell, sync::Arc};

pub(super) const MAX_ENCODED_BYTES:usize=64*1024*1024;

#[derive(Clone)]
struct Lease { revision:u64, bytes:Arc<Vec<u8>> }
#[derive(Default)]
struct State { epoch:u64, revision:u64, current:Option<Lease> }
thread_local! { static CURRENT:RefCell<State>=RefCell::new(State::default()); }

#[derive(Serialize)]
struct Memory { offset:usize, byte_length:usize }
#[derive(Serialize)]
struct Descriptor { format:&'static str, epoch:String, revision:String, memory:Memory }
#[derive(Serialize)]
pub(super) struct Prepared {
    #[serde(skip_serializing_if="Option::is_none")]
    ui_tree_transport:Option<Descriptor>,
    #[serde(skip)]
    epoch:u64,
    #[serde(skip)]
    revision:u64,
    #[serde(skip)]
    lease:Option<Lease>,
    #[serde(skip)]
    releases_large_bytes:bool,
}

/// `encoded` is the exact UI value span captured from trusted canonical serde
/// output, not a second serialization, caller identity or cached Rust UiTree.
pub(super) fn prepare(encoded:Option<&[u8]>,epoch:u64)->Result<Prepared,String>{
    if epoch==0{return Err("UI_TREE_TRANSPORT_EPOCH_INVALID".into());}
    CURRENT.with(|cell|{
        let current=cell.borrow();
        let previous_revision=if current.epoch==epoch{current.revision}else{0};
        let eligible=encoded.filter(|bytes|!bytes.is_empty()&&bytes.len()<=MAX_ENCODED_BYTES);
        let lease=match eligible {
            Some(bytes)=>{
                if let Some(old)=current.current.as_ref().filter(|_|current.epoch==epoch)
                    && old.bytes.as_slice()==bytes {Some(old.clone())}
                else {Some(Lease{revision:previous_revision.checked_add(1).ok_or("UI_TREE_TRANSPORT_REVISION_LIMIT")?,
                    // Arc<Vec> transfers one owned allocation, without the
                    // transient second byte buffer of Vec -> Arc<[u8]>.
                    bytes:Arc::new(bytes.to_vec())})}
            }
            None=>None,
        };
        let revision=lease.as_ref().map_or(previous_revision,|lease|lease.revision);
        let releases_large_bytes=current.current.as_ref().is_some_and(|old|
            old.bytes.capacity()>1024*1024&&lease.as_ref().is_none_or(|new|new.bytes.len()<old.bytes.capacity()/4));
        let descriptor=lease.as_ref().map(|lease|Descriptor {format:"ui-tree-memory-v1",epoch:epoch.to_string(),revision:lease.revision.to_string(),
            memory:Memory {offset:lease.bytes.as_ptr() as usize,byte_length:lease.bytes.len()}});
        Ok(Prepared{ui_tree_transport:descriptor,epoch,revision,lease,releases_large_bytes})
    })
}
impl Prepared {
    pub(super) fn has_lease(&self)->bool{self.lease.is_some()}
    pub(super) fn releases_large_bytes(&self)->bool{self.releases_large_bytes}
    pub(super) fn commit(self){CURRENT.with(|cell|*cell.borrow_mut()=State{epoch:self.epoch,revision:self.revision,current:self.lease});}
}
/// Retire bytes, but never roll a revision back within the same runtime epoch.
pub(super) fn clear()->bool{CURRENT.with(|cell|cell.borrow_mut().current.take().is_some())}

#[cfg(test)]
mod tests {
    use super::*;
    fn descriptor(value:&Prepared)->serde_json::Value{serde_json::to_value(value).unwrap()}
    fn revision(value:&Prepared)->u64{value.revision}
    #[test]
    fn unchanged_bytes_reuse_one_lease_and_failed_candidates_preserve_revision_and_old_bytes(){
        let first=prepare(Some(br#"{"kind":"screen","id":"one"}"#),101).unwrap();
        let address=descriptor(&first)["ui_tree_transport"]["memory"]["offset"].clone();first.commit();
        let old=CURRENT.with(|v|Arc::downgrade(&v.borrow().current.as_ref().unwrap().bytes));
        for _ in 0..120{let same=prepare(Some(br#"{"kind":"screen","id":"one"}"#),101).unwrap();assert_eq!(descriptor(&same)["ui_tree_transport"]["memory"]["offset"],address);assert_eq!(revision(&same),1);same.commit();}
        let failed=prepare(Some(br#"{"kind":"screen","id":"two"}"#),101).unwrap();assert_eq!(revision(&failed),2);drop(failed);
        let failed_clear=prepare(None,101).unwrap();drop(failed_clear);
        CURRENT.with(|v|{let state=v.borrow();assert_eq!(state.revision,1);assert_eq!(state.current.as_ref().unwrap().bytes.as_slice(),br#"{"kind":"screen","id":"one"}"#);});
        assert!(old.upgrade().is_some());
        prepare(Some(br#"{"kind":"screen","id":"two"}"#),101).unwrap().commit();assert!(old.upgrade().is_none());
    }
    #[test]
    fn clear_disable_and_new_epoch_do_not_alias_generations(){
        prepare(Some(b"{}"),201).unwrap().commit();assert_eq!(revision(&prepare(Some(b"{}"),201).unwrap()),1);
        prepare(None,201).unwrap().commit();let next=prepare(Some(b"{}"),201).unwrap();assert_eq!(revision(&next),2);next.commit();
        clear();let next=prepare(Some(b"{}"),201).unwrap();assert_eq!(revision(&next),3);next.commit();
        let next=prepare(Some(b"{}"),202).unwrap();assert_eq!(revision(&next),1);next.commit();
        clear();CURRENT.with(|v|{let state=v.borrow();assert!(state.current.is_none());assert_eq!(state.revision,1);});
    }
    #[test]
    fn escaped_output_over_64_mib_falls_back_and_retires_only_on_commit(){
        prepare(Some(b"{}"),301).unwrap().commit();
        let old=CURRENT.with(|v|Arc::downgrade(&v.borrow().current.as_ref().unwrap().bytes));
        let text="\u{1}".repeat(MAX_ENCODED_BYTES/6+1);assert!(text.len()<MAX_ENCODED_BYTES);
        let encoded=serde_json::to_vec(&text).unwrap();assert!(encoded.len()>MAX_ENCODED_BYTES);
        let fallback=prepare(Some(&encoded),301).unwrap();assert!(!fallback.has_lease());assert!(descriptor(&fallback).get("ui_tree_transport").is_none());
        assert!(old.upgrade().is_some());fallback.commit();assert!(old.upgrade().is_none());
        let restored=prepare(Some(b"{}"),301).unwrap();assert_eq!(revision(&restored),2);restored.commit();
    }
}

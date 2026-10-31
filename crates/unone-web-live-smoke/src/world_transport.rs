//! Retained top-level world fields for the official player wire. Each large
//! field publishes its exact canonical JSON span as a leased memory view with a
//! revision; an unchanged field keeps its lease and revision, so the player
//! neither decodes nor parses it again. The canonical snapshot and digest stay
//! complete, and candidates are private until the envelope succeeds.
use serde::{Serialize, ser::SerializeMap};
use std::{cell::RefCell, collections::BTreeMap, sync::Arc};

/// Smaller fields stay inline: a descriptor costs about as much as they do.
pub(super) const MIN_LEASED_BYTES: usize = 1024;
/// Fields with their own presentation transport are never leased here.
pub(super) fn leasable(key: &str) -> bool { !matches!(key, "ui" | "ui_image_batches" | "instances3d" | "geometry3d" | "data_textures") }

#[derive(Clone)]
struct Lease { revision: u64, bytes: Arc<Vec<u8>> }
#[derive(Default)]
struct State { epoch: u64, revision: u64, fields: BTreeMap<&'static str, Lease> }
thread_local! { static CURRENT: RefCell<State> = RefCell::new(State::default()); }

pub(super) struct Prepared { epoch: u64, revision: u64, fields: BTreeMap<&'static str, Lease> }

/// `spans` are exact top-level field values from trusted canonical serde
/// output, never a second serialization of the world.
pub(super) fn prepare<'a>(spans: impl Iterator<Item = (&'static str, &'a [u8])>, epoch: u64) -> Result<Prepared, String> {
    if epoch == 0 { return Err("WORLD_TRANSPORT_EPOCH_INVALID".into()); }
    CURRENT.with(|cell| {
        let current = cell.borrow();
        let same_epoch = current.epoch == epoch;
        let mut revision = if same_epoch { current.revision } else { 0 };
        let mut fields = BTreeMap::new();
        for (key, bytes) in spans {
            if !leasable(key) || bytes.len() < MIN_LEASED_BYTES { continue; }
            let lease = match current.fields.get(key).filter(|old| same_epoch && old.bytes.as_slice() == bytes) {
                Some(old) => old.clone(),
                None => {
                    revision = revision.checked_add(1).ok_or("WORLD_TRANSPORT_REVISION_LIMIT")?;
                    Lease { revision, bytes: Arc::new(bytes.to_vec()) }
                }
            };
            fields.insert(key, lease);
        }
        Ok(Prepared { epoch, revision, fields })
    })
}
impl Prepared {
    pub(super) fn leases(&self, key: &str) -> bool { self.fields.contains_key(key) }
    pub(super) fn len(&self) -> usize { self.fields.len() }
    pub(super) fn commit(self) {
        CURRENT.with(|cell| *cell.borrow_mut() = State { epoch: self.epoch, revision: self.revision, fields: self.fields });
    }
}
#[derive(Serialize)]
struct Memory { offset: usize, byte_length: usize }
#[derive(Serialize)]
struct Field { revision: String, memory: Memory }
struct Fields<'a>(&'a BTreeMap<&'static str, Lease>);
impl Serialize for Fields<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, lease) in self.0 {
            map.serialize_entry(key, &Field { revision: lease.revision.to_string(),
                memory: Memory { offset: lease.bytes.as_ptr() as usize, byte_length: lease.bytes.len() } })?;
        }
        map.end()
    }
}
#[derive(Serialize)]
struct Descriptor<'a> { format: &'static str, epoch: String, fields: Fields<'a> }
impl Serialize for Prepared {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        if !self.fields.is_empty() {
            map.serialize_entry("world_transport", &Descriptor { format: "world-fields-memory-v1", epoch: self.epoch.to_string(), fields: Fields(&self.fields) })?;
        }
        map.end()
    }
}
/// Retire bytes, but never roll a revision back within the same runtime epoch.
pub(super) fn clear() -> bool { CURRENT.with(|cell| !std::mem::take(&mut cell.borrow_mut().fields).is_empty()) }

#[cfg(test)]
mod tests {
    use super::*;
    fn big(tag: u8) -> Vec<u8> { vec![tag; MIN_LEASED_BYTES] }
    fn descriptor(value: &Prepared) -> serde_json::Value { serde_json::to_value(value).unwrap() }
    #[test]
    fn unchanged_fields_keep_lease_and_revision_while_changed_fields_advance() {
        let (a, b) = (big(b'a'), big(b'b'));
        let first = prepare([("heightfields", &a[..]), ("entities", &b[..]), ("frame", &b"7"[..])].into_iter(), 11).unwrap();
        let wire = descriptor(&first);
        assert_eq!(wire["world_transport"]["format"], "world-fields-memory-v1");
        assert!(wire["world_transport"]["fields"].get("frame").is_none());
        let terrain = wire["world_transport"]["fields"]["heightfields"].clone();
        first.commit();
        let c = big(b'c');
        let next = prepare([("heightfields", &a[..]), ("entities", &c[..])].into_iter(), 11).unwrap();
        let wire = descriptor(&next);
        assert_eq!(wire["world_transport"]["fields"]["heightfields"], terrain);
        assert_eq!(wire["world_transport"]["fields"]["entities"]["revision"], "3");
        next.commit();
        // A failed candidate never advances the committed revision.
        drop(prepare([("entities", &a[..])].into_iter(), 11).unwrap());
        assert_eq!(CURRENT.with(|v| v.borrow().revision), 3);
    }
    #[test]
    fn own_transports_small_fields_and_new_epochs_are_not_aliased() {
        let a = big(b'a');
        let only = prepare([("ui", &a[..]), ("instances3d", &a[..]), ("ui_image_batches", &a[..]), ("camera", &a[..MIN_LEASED_BYTES - 1])].into_iter(), 21).unwrap();
        assert_eq!(only.len(), 0); assert!(descriptor(&only).get("world_transport").is_none()); only.commit();
        prepare([("entities", &a[..])].into_iter(), 21).unwrap().commit();
        let reload = prepare([("entities", &a[..])].into_iter(), 22).unwrap();
        assert_eq!(descriptor(&reload)["world_transport"]["fields"]["entities"]["revision"], "1");
        reload.commit(); assert!(clear()); assert!(!clear());
        let after = prepare([("entities", &a[..])].into_iter(), 22).unwrap();
        assert_eq!(descriptor(&after)["world_transport"]["fields"]["entities"]["revision"], "2");
    }
}

//! Packed presentation instances. Simulation and individual identity remain game-owned.
use base64::Engine;
use serde::Serialize;
use std::sync::{Arc, OnceLock};
#[derive(Debug, Clone)]
pub struct InstanceBatch3D {
    pub asset: String,
    pub count: usize,
    pub format: &'static str,
    encoded: Arc<OnceLock<String>>,
    // Host presentation storage. Pose bytes are not part of canonical JSON or
    // observation digests; renderers read `packed` or a host-specific transport.
    pub packed: Arc<[u8]>,
    pub revision: u64,
}
impl InstanceBatch3D {
    pub fn data(&self) -> &str {
        self.encoded
            .get_or_init(|| base64::engine::general_purpose::STANDARD.encode(self.packed.as_ref()))
    }
    pub fn same_payload(&self, asset: &str, bytes: &[u8]) -> bool {
        self.asset == asset && self.packed.as_ref() == bytes
    }
}
impl Serialize for InstanceBatch3D {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("InstanceBatch3D", 3)?;
        state.serialize_field("asset", &self.asset)?;
        state.serialize_field("count", &self.count)?;
        state.serialize_field("format", &self.format)?;
        state.end()
    }
}
fn validate_packed(asset: &str, bytes: &[u8]) -> Result<(), String> {
    if asset.is_empty() || asset.len() > 256 {
        return Err("INSTANCE_INVALID: asset ID required (1..256 bytes)".into());
    }
    if !bytes.len().is_multiple_of(40) || bytes.len() > 40 * 262_144 {
        return Err(
            "INSTANCE_INVALID: buffer must contain at most 262144 records of 40 bytes".into(),
        );
    }
    for record in bytes.chunks_exact(40) {
        let mut quaternion = 0.;
        for i in 0..10 {
            let value = f32::from_le_bytes(record[i * 4..i * 4 + 4].try_into().unwrap());
            if !value.is_finite() || value.abs() > 100000. || (i >= 7 && value < 0.) {
                return Err(
                    "INSTANCE_INVALID: finite bounded transforms and nonnegative scales required"
                        .into(),
                );
            }
            if (3..7).contains(&i) {
                quaternion += value * value;
            }
        }
        if (quaternion - 1.).abs() > 0.002 {
            return Err("INSTANCE_INVALID: quaternion must be normalized".into());
        }
    }
    Ok(())
}
impl InstanceBatch3D {
    pub fn new(asset: String, bytes: &[u8]) -> Result<Self, String> {
        Self::from_vec(asset, bytes.to_vec())
    }
    pub fn from_vec(asset: String, bytes: Vec<u8>) -> Result<Self, String> {
        validate_packed(&asset, &bytes)?;
        static NEXT_REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        Ok(Self {
            asset,
            count: bytes.len() / 40,
            format: "f32le-p3-q4-s3-v1",
            encoded: Arc::new(OnceLock::new()),
            packed: Arc::from(bytes),
            revision: NEXT_REVISION.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_clones_share_immutable_encoded_storage() {
        let mut bytes=vec![0;40];bytes[24..28].copy_from_slice(&1f32.to_le_bytes());
        let a=InstanceBatch3D::new("mesh://test".into(),&bytes).unwrap();let b=a.clone();
        assert!(Arc::ptr_eq(&a.encoded,&b.encoded));
        let json=serde_json::to_value(&a).unwrap();
        assert_eq!(json["asset"], "mesh://test");
        assert_eq!(json["count"], 1);
        assert!(json.get("data").is_none());
        assert_eq!(a.data(), base64::engine::general_purpose::STANDARD.encode(&bytes));
        assert!(Arc::ptr_eq(&a.encoded,&b.encoded));
        assert_eq!(a.data(), b.data());
    }
    #[test]
    fn packed_transforms_reject_invalid_payloads() {
        let mut bytes = vec![0; 40];
        bytes[24..28].copy_from_slice(&1f32.to_le_bytes());
        assert_eq!(
            InstanceBatch3D::new("mesh://test".into(), &bytes)
                .unwrap()
                .count,
            1
        );
        assert!(InstanceBatch3D::new("mesh://test".into(), &bytes[..39]).is_err());
        bytes[0..4].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(InstanceBatch3D::new("mesh://test".into(), &bytes).is_err());
    }
    #[test]
    fn luau_buffer_is_copied_and_invalid_replacement_is_atomic() {
        let runtime=crate::EngineRuntime::load_source("instances","main.luau",r#"
local Game={}
function Game.start(api)
 local b=buffer.create(40);buffer.writef32(b,24,1);buffer.writef32(b,28,1);buffer.writef32(b,32,1);buffer.writef32(b,36,1)
 api.instances3d.set("units","mesh://test",b)
 buffer.writef32(b,0,0/0)
 assert(not pcall(api.instances3d.set,"units","mesh://test",b))
end
function Game.update() end
return Game
"#,None).unwrap();
        let snapshot = runtime.observe();
        let batch = &snapshot.instances3d["units"];
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(batch.data().as_bytes())
            .unwrap();
        assert_eq!(f32::from_le_bytes(bytes[..4].try_into().unwrap()), 0.);
    }
    #[test]
    fn packed_pose_bytes_are_not_in_canonical_json() {
        let identity=|x:f32|{let mut b=vec![0;40];b[0..4].copy_from_slice(&x.to_le_bytes());b[24..28].copy_from_slice(&1f32.to_le_bytes());b};
        let left=InstanceBatch3D::new("mesh://test".into(),&identity(0.)).unwrap();
        let right=InstanceBatch3D::new("mesh://test".into(),&identity(3.)).unwrap();
        assert_eq!(serde_json::to_value(&left).unwrap(), serde_json::to_value(&right).unwrap());
        assert_ne!(left.packed, right.packed);
        assert_ne!(left.data(), right.data());
    }
    #[test]
    fn canonical_json_skips_base64_until_requested() {
        let mut bytes=vec![0;40];bytes[24..28].copy_from_slice(&1f32.to_le_bytes());
        let batch=InstanceBatch3D::new("mesh://test".into(),&bytes).unwrap();
        assert!(batch.encoded.get().is_none());
        let _=serde_json::to_value(&batch).unwrap();
        assert!(batch.encoded.get().is_none());
        let _=batch.data();
        assert!(batch.encoded.get().is_some());
    }
    #[test]
    fn from_vec_moves_storage_without_a_second_copy() {
        let mut bytes=vec![0;40];bytes[24..28].copy_from_slice(&1f32.to_le_bytes());
        let batch=InstanceBatch3D::from_vec("mesh://test".into(),bytes.clone()).unwrap();
        assert_eq!(batch.packed.as_ref(), bytes.as_slice());
    }
    #[test]
    fn unchanged_luau_set_keeps_revision() {
        let mut runtime=crate::EngineRuntime::load_source("instances","main.luau",r#"
local Game={}
local function publish(api)
 local b=buffer.create(40);buffer.writef32(b,24,1);buffer.writef32(b,28,1);buffer.writef32(b,32,1);buffer.writef32(b,36,1)
 api.instances3d.set("units","mesh://test",b)
end
function Game.start(api) publish(api) end
function Game.update(api) publish(api) end
return Game
"#,None).unwrap();
        let first=runtime.observe().instances3d["units"].clone();
        runtime.tick().unwrap();
        let second=&runtime.observe().instances3d["units"];
        assert_eq!(first.revision, second.revision);
        assert!(Arc::ptr_eq(&first.packed,&second.packed));
    }
    #[test]
    fn observation_digest_ignores_instance_pose_bytes() {
        let source=|x:&str| format!(r#"
return {{start=function(api)
 local b=buffer.create(40);buffer.writef32(b,0,{x});buffer.writef32(b,24,1);buffer.writef32(b,28,1);buffer.writef32(b,32,1);buffer.writef32(b,36,1)
 api.instances3d.set("units","mesh://test",b)
end,update=function()end}}
"#);
        let left=crate::EngineRuntime::load_source("pose-a","main.luau",source("0"),None).unwrap();
        let right=crate::EngineRuntime::load_source("pose-b","main.luau",source("3"),None).unwrap();
        let left_snap=left.observe();
        let right_snap=right.observe();
        assert_ne!(left_snap.instances3d["units"].packed, right_snap.instances3d["units"].packed);
        assert_eq!(
            crate::observation_digest(&left_snap).unwrap(),
            crate::observation_digest(&right_snap).unwrap()
        );
    }
}

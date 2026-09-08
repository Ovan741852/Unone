//! Packed presentation instances. Simulation and individual identity remain game-owned.
use base64::Engine;
use serde::Serialize;
#[derive(Debug, Clone, Serialize)]
pub struct InstanceBatch3D {
    pub asset: String,
    pub count: usize,
    pub format: &'static str,
    #[serde(serialize_with="serialize_shared_data")]
    pub data: std::sync::Arc<String>,
    // Host presentation storage; excluded from canonical snapshots and replay.
    #[serde(skip)]
    pub packed: std::sync::Arc<[u8]>,
    #[serde(skip)]
    pub revision: u64,
}
fn serialize_shared_data<S:serde::Serializer>(value:&std::sync::Arc<String>,serializer:S)->Result<S::Ok,S::Error>{serializer.serialize_str(value.as_str())}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_clones_share_immutable_encoded_storage() {
        let mut bytes=vec![0;40];bytes[24..28].copy_from_slice(&1f32.to_le_bytes());
        let a=InstanceBatch3D::new("mesh://test".into(),&bytes).unwrap();let b=a.clone();
        assert!(std::sync::Arc::ptr_eq(&a.data,&b.data));
        let json=serde_json::to_value(&a).unwrap();assert_eq!(json["data"],base64::engine::general_purpose::STANDARD.encode(&bytes));
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
            .decode(batch.data.as_bytes())
            .unwrap();
        assert_eq!(f32::from_le_bytes(bytes[..4].try_into().unwrap()), 0.);
    }
}
impl InstanceBatch3D {
    pub fn new(asset: String, bytes: &[u8]) -> Result<Self, String> {
        if asset.is_empty() || asset.len() > 256 {
            return Err("INSTANCE_INVALID: asset ID required (1..256 bytes)".into());
        }
        if bytes.len() % 40 != 0 || bytes.len() > 40 * 262_144 {
            return Err(
                "INSTANCE_INVALID: buffer must contain at most 262144 records of 40 bytes".into(),
            );
        }
        for record in bytes.chunks_exact(40) {
            let v: [f32; 10] = std::array::from_fn(|i| {
                f32::from_le_bytes(record[i * 4..i * 4 + 4].try_into().unwrap())
            });
            if v.iter().any(|v| !v.is_finite() || v.abs() > 100000.)
                || v[7..].iter().any(|v| *v < 0.)
            {
                return Err(
                    "INSTANCE_INVALID: finite bounded transforms and nonnegative scales required"
                        .into(),
                );
            }
            let q = v[3..7].iter().map(|v| v * v).sum::<f32>();
            if (q - 1.).abs() > 0.002 {
                return Err("INSTANCE_INVALID: quaternion must be normalized".into());
            }
        }
        static NEXT_REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        Ok(Self {
            asset,
            count: bytes.len() / 40,
            format: "f32le-p3-q4-s3-v1",
            data: std::sync::Arc::new(base64::engine::general_purpose::STANDARD.encode(bytes)),
            packed: bytes.into(),
            revision: NEXT_REVISION.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        })
    }
}

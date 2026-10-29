//! Exact SHA-256 prefix reuse. No schema, pointer or revision assumptions.
use sha2::{Digest, Sha256};

const BLOCK: usize = 16 * 1024;
const MAX_PREFIX: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default)]
pub struct CanonicalHashWork {
    pub input_bytes: usize,
    pub reused_bytes: usize,
    pub hashed_bytes: usize,
    pub cache_storage_bytes: usize,
}

/// Caches at most 4 MiB of exact input bytes and SHA states at 16 KiB boundaries.
/// Every reused block is compared byte-for-byte, so arbitrary edits are safe.
#[derive(Default)]
pub struct CanonicalHasher {
    prefix: Vec<u8>,
    states: Vec<Sha256>,
}

impl CanonicalHasher {
    pub const MAX_PREFIX_BYTES: usize = MAX_PREFIX;
    pub fn hash(&mut self, bytes: &[u8]) -> (String, CanonicalHashWork) {
        let retained = (bytes.len().min(MAX_PREFIX) / BLOCK) * BLOCK;
        let mut reused = 0;
        for (old, new) in self
            .prefix
            .chunks_exact(BLOCK)
            .zip(bytes[..retained].chunks_exact(BLOCK))
        {
            if old != new {
                break;
            }
            reused += BLOCK;
        }
        let mut hash = if reused == 0 {
            Sha256::new()
        } else {
            self.states[reused / BLOCK - 1].clone()
        };
        self.states.truncate(reused / BLOCK);
        if self.states.capacity() < retained / BLOCK {
            self.states
                .reserve_exact(retained / BLOCK - self.states.len());
        }
        for chunk in bytes[reused..retained].chunks_exact(BLOCK) {
            hash.update(chunk);
            self.states.push(hash.clone());
        }
        hash.update(&bytes[retained..]);
        self.prefix.truncate(reused);
        if self.prefix.capacity() < retained {
            self.prefix.reserve_exact(retained - self.prefix.len());
        }
        self.prefix.extend_from_slice(&bytes[reused..retained]);
        (
            format!("sha256:{:x}", hash.finalize()),
            CanonicalHashWork {
                input_bytes: bytes.len(),
                reused_bytes: reused,
                hashed_bytes: bytes.len() - reused,
                cache_storage_bytes: self.prefix.capacity()
                    + self.states.capacity() * std::mem::size_of::<Sha256>(),
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_snapshots_reuse_static_artwork_prefix_when_input_receipt_and_frame_change() {
        let mut world=crate::world::World::default();
        let rect=crate::UiRect{x:0.,y:0.,width:100.,height:100.};
        world.define_ui_image_batch("art".into(),crate::UiImageBatchDefinition{
            bounds:rect,
            quads:vec![crate::UiImageQuad{asset:"texture://".to_owned()+&"a".repeat(3*BLOCK),rect,source:None,opacity:None}],
        },None).unwrap();
        let mut snapshot=world.snapshot();
        let mut cached=CanonicalHasher::default();
        let initial=serde_json::to_vec(&snapshot).unwrap();
        let (initial_digest,first)=cached.hash(&initial);
        assert_eq!(first.reused_bytes,0);
        assert_eq!(initial_digest,format!("sha256:{:x}",Sha256::digest(&initial)));
        let mut previous=initial_digest;
        for frame in [1,2,9,10] {
            snapshot.frame=frame;
            snapshot.time_seconds=frame as f64/60.;
            snapshot.physical_input_receipt=Some(crate::PhysicalReceipt{
                profile:"ordered_physical_v1".into(),epoch:7,through_sequence:frame*3,
            });
            snapshot.application.escape_behavior=if frame%2==0 {crate::EscapeBehavior::Action}else{crate::EscapeBehavior::Quit};
            let bytes=serde_json::to_vec(&snapshot).unwrap();
            let (actual,work)=cached.hash(&bytes);
            assert_eq!(actual,format!("sha256:{:x}",Sha256::digest(&bytes)));
            assert_ne!(actual,previous,"changed input/frame metadata remains part of the exact digest");
            assert!(work.reused_bytes>=BLOCK,"static resource prefix must survive receipt/application changes");
            assert_eq!(work.input_bytes,bytes.len());
            assert_eq!(work.hashed_bytes+work.reused_bytes,bytes.len());
            previous=actual;
        }
    }

    #[test]
    fn arbitrary_edits_growth_shrink_and_boundaries_match_full_sha256() {
        let mut cached = CanonicalHasher::default();
        for len in [
            0,
            1,
            BLOCK - 1,
            BLOCK,
            BLOCK + 1,
            3 * BLOCK + 17,
            MAX_PREFIX + 129,
        ] {
            let mut bytes: Vec<u8> = (0..len).map(|i| (i.wrapping_mul(31) % 251) as u8).collect();
            for index in [
                None,
                Some(0),
                Some(BLOCK - 1),
                Some(BLOCK),
                Some(len.saturating_sub(1)),
            ] {
                if let Some(index) = index
                    && index < len {
                        bytes[index] ^= 0x55;
                }
                let (actual, work) = cached.hash(&bytes);
                assert_eq!(actual, format!("sha256:{:x}", Sha256::digest(&bytes)));
                assert_eq!(work.hashed_bytes + work.reused_bytes, len);
                assert!(cached.prefix.len() <= MAX_PREFIX);
                assert!(
                    work.cache_storage_bytes
                        <= MAX_PREFIX + (MAX_PREFIX / BLOCK) * std::mem::size_of::<Sha256>()
                );
                assert!(cached.states.len() <= MAX_PREFIX / BLOCK);
                let (again, repeated) = cached.hash(&bytes);
                assert_eq!(again, actual);
                assert_eq!(repeated.reused_bytes, (len.min(MAX_PREFIX) / BLOCK) * BLOCK);
            }
        }
        assert_eq!(
            cached.hash(b"").0,
            format!("sha256:{:x}", Sha256::digest(b""))
        );
    }
}

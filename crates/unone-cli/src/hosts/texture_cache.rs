//! Optional Web renderer budget. No game-, world- or navigation-specific policy.
use anyhow::{Result, ensure};
use serde::Deserialize;
pub fn declared<'de,D:serde::Deserializer<'de>>(d:D)->Result<Option<TextureCachePolicy>,D::Error> {
    TextureCachePolicy::deserialize(d).map(Some)
}
#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct TextureCachePolicy {
    pub max_bytes: u64,
    pub max_entries: u32,
    pub idle_frames: u32,
}
impl TextureCachePolicy {
    pub fn validate(self) -> Result<()> {
        ensure!((1..=1_073_741_824).contains(&self.max_bytes), "TEXTURE_CACHE_INVALID: max_bytes out of range");
        ensure!((1..=65_536).contains(&self.max_entries), "TEXTURE_CACHE_INVALID: max_entries out of range");
        ensure!((1..=36_000).contains(&self.idle_frames), "TEXTURE_CACHE_INVALID: idle_frames out of range");
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{PresentationSettings, native_wgpu_export_gate, lookup};
    use serde_json::json;

    fn policy_json() -> serde_json::Value {
        json!({"max_bytes":67_108_864,"max_entries":128,"idle_frames":120})
    }

    #[test]
    fn texture_cache_presentation_roundtrip_and_omission() {
        let omitted: PresentationSettings = serde_json::from_value(json!({})).unwrap();
        assert!(omitted.texture_cache.is_none());
        assert!(serde_json::to_value(&omitted).unwrap().get("texture_cache").is_none());

        let settings: PresentationSettings = serde_json::from_value(json!({"texture_cache":policy_json()})).unwrap();
        settings.validate_renderer().unwrap();
        let encoded = serde_json::to_value(&settings).unwrap();
        assert_eq!(encoded["texture_cache"], policy_json());
        let roundtrip: PresentationSettings = serde_json::from_value(encoded).unwrap();
        roundtrip.validate_renderer().unwrap();
        assert_eq!(roundtrip.texture_cache.unwrap().max_bytes, 67_108_864);
    }

    #[test]
    fn texture_cache_presentation_rejects_explicit_null_and_invalid_shapes() {
        for value in [json!(null),json!(false),json!("default"),json!([]),json!({}),
            json!({"max_bytes":1,"max_entries":1,"idle_frames":1,"unknown":true})] {
            assert!(serde_json::from_value::<PresentationSettings>(json!({"texture_cache":value})).is_err());
        }
        for (key, value) in [("max_bytes",0),("max_bytes",1_073_741_825),("max_entries",0),
            ("max_entries",65_537),("idle_frames",0),("idle_frames",36_001)] {
            let mut policy=policy_json();policy[key]=json!(value);
            let settings: PresentationSettings = serde_json::from_value(json!({"texture_cache":policy})).unwrap();
            assert!(settings.validate_renderer().unwrap_err().to_string().contains("TEXTURE_CACHE_INVALID"));
        }
    }

    #[test]
    fn texture_cache_custom_renderer_cannot_ignore_policy() {
        let settings: PresentationSettings = serde_json::from_value(json!({
            "renderer_mode":"custom","renderer_module":"renderer.mjs","renderer_files":["renderer.mjs"],
            "texture_cache":policy_json()
        })).unwrap();
        assert!(settings.validate_renderer().unwrap_err().to_string().contains("TEXTURE_CACHE_OFFICIAL_ONLY"));
    }

    #[test]
    fn texture_cache_native_gate_rejects_the_policy_itself() {
        let blocked = lookup("windows").unwrap().export_blocked_systems.iter()
            .map(|id|(id.to_string(),false)).collect();
        let quiet = unone_engine::SystemSettings::resolve(&blocked).unwrap();
        native_wgpu_export_gate(&quiet,None).unwrap();
        native_wgpu_export_gate(&quiet,Some(&PresentationSettings::default())).unwrap();
        let settings: PresentationSettings = serde_json::from_value(json!({"texture_cache":policy_json()})).unwrap();
        settings.validate_renderer().unwrap();
        let diagnostic = native_wgpu_export_gate(&quiet,Some(&settings)).unwrap_err().to_string();
        assert!(diagnostic.starts_with("HOST_PRESENTATION_UNSUPPORTED:"));
        assert!(diagnostic.contains("fields texture_cache are not supported by native wgpu"));
    }

    #[test]
    fn texture_cache_contract() {
        let valid = r#"{"max_bytes":67108864,"max_entries":128,"idle_frames":120}"#;
        assert!(serde_json::from_str::<TextureCachePolicy>(valid).unwrap().validate().is_ok());
        for invalid in [r#"{}"#, r#"{"max_bytes":-1,"max_entries":1,"idle_frames":1}"#,
            r#"{"max_bytes":1,"max_entries":1,"idle_frames":1,"game":"wuxia"}"#] {
            assert!(serde_json::from_str::<TextureCachePolicy>(invalid).is_err());
        }
        for policy in [TextureCachePolicy{max_bytes:0,max_entries:1,idle_frames:1},
            TextureCachePolicy{max_bytes:1,max_entries:0,idle_frames:1},
            TextureCachePolicy{max_bytes:1,max_entries:1,idle_frames:36001}] {
            assert!(policy.validate().is_err());
        }
    }
}

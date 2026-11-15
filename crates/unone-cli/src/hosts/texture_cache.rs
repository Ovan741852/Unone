//! Optional Web renderer budget. No game-, world- or navigation-specific policy.
use anyhow::{Result, ensure};
use serde::Deserialize;
pub fn declared<'de,D:serde::Deserializer<'de>>(d:D)->Result<Option<TextureCachePolicy>,D::Error> {
    TextureCachePolicy::deserialize(d).map(Some)
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct TextureCachePolicy {
    pub max_bytes: u64,
    pub max_entries: u32,
    pub idle_frames: u32,
    #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="declared_overrides")]
    pub idle_overrides: Option<Vec<TextureIdleOverride>>,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct TextureIdleOverride {
    #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="declared_prefix")]
    pub asset_prefix: Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="declared_ids")]
    pub asset_ids: Option<Vec<String>>,
    pub idle_frames: u32,
}
fn declared_prefix<'de,D:serde::Deserializer<'de>>(d:D)->Result<Option<String>,D::Error> {String::deserialize(d).map(Some)}
fn declared_ids<'de,D:serde::Deserializer<'de>>(d:D)->Result<Option<Vec<String>>,D::Error> {Vec::<String>::deserialize(d).map(Some)}
fn declared_overrides<'de,D:serde::Deserializer<'de>>(d:D)->Result<Option<Vec<TextureIdleOverride>>,D::Error> {
    Vec::<TextureIdleOverride>::deserialize(d).map(Some)
}
impl TextureCachePolicy {
    pub fn validate(&self) -> Result<()> {
        ensure!((1..=1_073_741_824).contains(&self.max_bytes), "TEXTURE_CACHE_INVALID: max_bytes out of range");
        ensure!((1..=65_536).contains(&self.max_entries), "TEXTURE_CACHE_INVALID: max_entries out of range");
        ensure!((1..=36_000).contains(&self.idle_frames), "TEXTURE_CACHE_INVALID: idle_frames out of range");
        if let Some(rules)=&self.idle_overrides {
            ensure!(rules.len()<=64,"TEXTURE_CACHE_INVALID: idle_overrides exceeds 64 rules");
            let mut seen=std::collections::HashSet::new();let mut seen_ids=std::collections::HashSet::new();let mut total_ids=0;
            let valid=|s:&str|s.contains("://") && s.len()<=2048 && !s.chars().any(|c|c<='\u{1f}' || c=='\u{7f}');
            for rule in rules {
                ensure!(rule.asset_prefix.is_some()!=rule.asset_ids.is_some(),"TEXTURE_CACHE_INVALID: idle override requires exactly one selector");
                if let Some(prefix)=&rule.asset_prefix {ensure!(valid(prefix)&&prefix.ends_with('/')&&seen.insert(prefix),"TEXTURE_CACHE_INVALID: invalid or duplicate asset_prefix");}
                if let Some(ids)=&rule.asset_ids {total_ids+=ids.len();ensure!(!ids.is_empty()&&total_ids<=1024,"TEXTURE_CACHE_INVALID: asset_ids must contain 1..1024 total IDs");for id in ids {ensure!(valid(id)&&seen_ids.insert(id),"TEXTURE_CACHE_INVALID: invalid or duplicate asset ID");}}
                ensure!((1..=36_000).contains(&rule.idle_frames),"TEXTURE_CACHE_INVALID: idle override idle_frames out of range");
            }
        }
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
    fn idle_overrides_roundtrip_and_reject_invalid_rules() {
        let value=json!({"max_bytes":67108864,"max_entries":128,"idle_frames":1800,
            "idle_overrides":[{"asset_prefix":"texture://a/tiles/","idle_frames":300}]});
        let settings:PresentationSettings=serde_json::from_value(json!({"texture_cache":value})).unwrap();
        settings.validate_renderer().unwrap();assert_eq!(serde_json::to_value(&settings).unwrap()["texture_cache"],value);
        for bad in [json!(null),json!({}),json!([{}]),json!([{"asset_prefix":"texture://a","idle_frames":1}]),
            json!([{"asset_prefix":"texture://a/","idle_frames":0}]),
            json!([{"asset_prefix":"texture://a/","idle_frames":1,"extra":true}]),
            json!([{"asset_prefix":"texture://a/","idle_frames":1},{"asset_prefix":"texture://a/","idle_frames":2}])] {
            let mut v=value.clone();v["idle_overrides"]=bad;
            if let Ok(s)=serde_json::from_value::<PresentationSettings>(json!({"texture_cache":v})) {assert!(s.validate_renderer().is_err());}
        }
        let mut v=value.clone();v["idle_overrides"]=json!((0..65).map(|i|json!({"asset_prefix":format!("texture://a/{i}/"),"idle_frames":1})).collect::<Vec<_>>());
        let settings:PresentationSettings=serde_json::from_value(json!({"texture_cache":v})).unwrap();assert!(settings.validate_renderer().is_err());
        let mut v=value.clone();v["idle_overrides"]=json!([{"asset_ids":["texture://a/tile"],"idle_frames":300}]);
        let settings:PresentationSettings=serde_json::from_value(json!({"texture_cache":v})).unwrap();settings.validate_renderer().unwrap();assert_eq!(serde_json::to_value(&settings).unwrap()["texture_cache"]["idle_overrides"][0]["asset_ids"][0],"texture://a/tile");
        for bad in [json!([]),json!(["invalid"]),json!(["texture://a/tile","texture://a/tile"])] {
            let mut v=value.clone();v["idle_overrides"]=json!([{"asset_ids":bad,"idle_frames":1}]);let settings:PresentationSettings=serde_json::from_value(json!({"texture_cache":v})).unwrap();assert!(settings.validate_renderer().is_err());
        }
        let mut v=value.clone();v["idle_overrides"]=json!([{"asset_ids":["texture://a/tile"],"asset_prefix":"texture://a/","idle_frames":1}]);let settings:PresentationSettings=serde_json::from_value(json!({"texture_cache":v})).unwrap();assert!(settings.validate_renderer().is_err());
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
        for policy in [TextureCachePolicy{max_bytes:0,max_entries:1,idle_frames:1,idle_overrides:None},
            TextureCachePolicy{max_bytes:1,max_entries:0,idle_frames:1,idle_overrides:None},
            TextureCachePolicy{max_bytes:1,max_entries:1,idle_frames:36001,idle_overrides:None}] {
            assert!(policy.validate().is_err());
        }
    }
}

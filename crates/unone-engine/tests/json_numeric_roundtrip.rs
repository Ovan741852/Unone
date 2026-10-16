use serde_json::Value;
use unone_engine::{EngineRuntime, encode_observation, observation_digest};

#[test]
fn json_numeric_roundtrip_preserves_ieee_binary64_values() {
    // The first three values reproduced an actual host-publication loss of one
    // ULP. Tiny bounds must retain their scale; rounding UI geometry is not a fix.
    for bits in [
        0x4057_7333_3333_3334_u64,
        0x4046_e666_6666_6667,
        0x4043_6666_6666_6667,
        0x0000_0000_0000_0001,
        0x0010_0000_0000_0000,
        0x3f50_624d_d2f1_a9fc,
        0x7fef_ffff_ffff_ffff,
        0x8000_0000_0000_0000,
        0xc057_7333_3333_3334,
    ] {
        let original = f64::from_bits(bits);
        let encoded = serde_json::to_string(&original).unwrap();
        let parsed: f64 = serde_json::from_str(&encoded).unwrap();
        let portable: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(parsed.to_bits(), bits, "typed JSON roundtrip: {encoded}");
        assert_eq!(
            portable.as_f64().unwrap().to_bits(),
            bits,
            "portable JSON value roundtrip: {encoded}"
        );
    }
}

#[test]
fn canonical_observation_json_keeps_runtime_number_bits_and_digest() {
    let runtime = EngineRuntime::load_source(
        "canonical-numeric-roundtrip",
        "main.luau",
        r#"return {start=function(api)
local padding=3.1
api.observation.set('numbers',{
    width=100-padding-padding, title=100-(54.12+.08),
    tiny=1e-220, negative=-38.800000000000004,
})
end,update=function()end}"#,
        None,
    )
    .unwrap();
    let snapshot = runtime.observe();
    let (raw, digest) = encode_observation(&snapshot).unwrap();
    let decoded: Value = serde_json::from_str(raw.get()).unwrap();
    for (name, original) in snapshot.observations["numbers"].as_object().unwrap() {
        assert_eq!(
            decoded["observations"]["numbers"][name]
                .as_f64()
                .unwrap()
                .to_bits(),
            original.as_f64().unwrap().to_bits(),
            "canonical observation changed {name}"
        );
    }
    assert_eq!(digest, observation_digest(&snapshot).unwrap());
}

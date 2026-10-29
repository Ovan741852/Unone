#[test]
fn native_projected_shader_is_valid_wgsl_and_direct_clip_output() {
    let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/projected.wgsl");
    let source=std::fs::read_to_string(path).expect("Missing official projected shader");
    let module=naga::front::wgsl::parse_str(&source).unwrap();
    naga::valid::Validator::new(naga::valid::ValidationFlags::all(),naga::valid::Capabilities::all()).validate(&module).unwrap();
    let material=module.types.iter().find(|(_,ty)|ty.name.as_deref()==Some("Material")).unwrap().1;
    let naga::TypeInner::Struct {members,span}= &material.inner else {panic!("Material must be a struct")};
    assert_eq!(*span,32);assert_eq!(members.iter().find(|field|field.name.as_deref()==Some("alpha_strict")).unwrap().offset,16);
    assert!(source.contains("out.clip=clip"));
    assert!(!source.contains("camera"));
    assert!(!source.contains("world"));
    assert!(source.contains("1.-uv.y"));
    assert!(source.contains("discard"));
    assert!(source.contains("alpha_cutoff"));
    assert!(source.contains("alpha_strict"));
    assert!(source.contains("alpha<=material.alpha_cutoff"));
    assert!(source.contains("alpha<material.alpha_cutoff"));
    assert!(source.contains("encoded_mode"));
    assert!(source.contains("textureLoad(image,position,0)"));
    assert!(source.contains("((p%size)+size)%size"));
    assert!(source.contains("to_linear(encoded.rgb)"));
}

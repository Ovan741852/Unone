#[test]
fn source_bytecode_policy_is_independent_of_native_codegen_eligibility() {
    let mode = unone_engine::execution_mode();
    assert_eq!(mode.bytecode_optimization_level, if cfg!(feature = "preview-tools") { 1 } else { 2 });
    assert_eq!(mode.bytecode_type_info_level,
        if cfg!(all(feature = "native-codegen", not(feature = "preview-tools"))) { 1 } else { 0 });
    if !cfg!(feature = "native-codegen") {
        assert!(!mode.native_codegen_requested);
        assert_eq!(mode.luau_execution, "interpreter");
    }
}

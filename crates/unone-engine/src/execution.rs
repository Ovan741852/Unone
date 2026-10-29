//! Host-visible execution policy, never gameplay state or timing input.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ExecutionMode {
    pub schema_version: u32,
    /// The language runtime used by the engine. This is deliberately explicit:
    /// Luau gameplay and the Rust host are different ownership boundaries.
    pub runtime: &'static str,
    /// The embedded VM implementation. This is not a claim that the VM was
    /// rewritten in Rust; mlua is the Rust binding/host boundary.
    pub vm_implementation: &'static str,
    pub host_binding: &'static str,
    pub target_arch: &'static str,
    pub target_os: &'static str,
    pub rust_profile: &'static str,
    /// Whether this build is intended for diagnosis, development, or a
    /// release-like measurement. It is not a performance result.
    pub build_intent: &'static str,
    pub preview_tools: bool,
    pub native_codegen_compiled: bool,
    pub native_codegen_supported: Option<bool>,
    pub native_codegen_requested: bool,
    pub native_codegen_fallback: &'static str,
    pub luau_execution: &'static str,
    /// Default compiler settings for VM-loaded source chunks. Authored Luau
    /// directives and separately compiled cached job bytecode may differ.
    pub bytecode_optimization_level: u8,
    pub bytecode_type_info_level: u8,
    pub wasm_host_compilation: &'static str,
    /// Replay uses a fixed tick and seed, but cross-target floating point
    /// equivalence still needs an explicit comparison policy.
    pub determinism_contract: &'static str,
    pub limitation: &'static str,
}

pub(crate) fn bytecode_optimization_level() -> u8 {
    if cfg!(feature = "preview-tools") { 1 } else { 2 }
}

pub(crate) fn bytecode_type_info_level() -> u8 {
    if cfg!(all(feature = "native-codegen", not(feature = "preview-tools"))) { 1 } else { 0 }
}

pub fn execution_mode() -> ExecutionMode {
    #[cfg(feature = "native-codegen")]
    // Luau's side-effect-free CPU/ABI support query; no VM or executable memory.
    let supported = Some(unsafe { mlua::ffi::luau_codegen_supported() != 0 });
    #[cfg(not(feature = "native-codegen"))]
    let supported = if cfg!(target_arch = "wasm32") {
        Some(false)
    } else {
        None
    };
    let requested = cfg!(feature = "native-codegen") && !cfg!(feature = "preview-tools");
    ExecutionMode {
        schema_version: 2,
        runtime: "luau",
        vm_implementation: "luau-upstream-vendored",
        host_binding: "rust-mlua",
        target_arch: std::env::consts::ARCH,
        target_os: std::env::consts::OS,
        rust_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        build_intent: if cfg!(feature = "preview-tools") {
            "diagnostic"
        } else if cfg!(debug_assertions) {
            "development"
        } else {
            "shipping-candidate"
        },
        preview_tools: cfg!(feature = "preview-tools"),
        native_codegen_compiled: cfg!(feature = "native-codegen"),
        native_codegen_supported: supported,
        native_codegen_requested: requested,
        native_codegen_fallback: "interpreter",
        luau_execution: if requested && supported == Some(true) {
            "native-codegen-eligible"
        } else {
            "interpreter"
        },
        bytecode_optimization_level: bytecode_optimization_level(),
        bytecode_type_info_level: bytecode_type_info_level(),
        wasm_host_compilation: if cfg!(target_arch = "wasm32") {
            "host-managed-not-probed"
        } else {
            "not-applicable"
        },
        determinism_contract: "fixed-tick-seeded-replay;cross-target-float-policy-explicit",
        limitation: "Eligibility is not per-function compilation proof. Diagnostic preview builds disable Luau codegen and use bytecode optimization 1; non-preview VMs default to bytecode optimization 2, including interpreters and Wasm. Source directives and cached job bytecode can differ. Wasm host JIT does not imply a Luau-to-Wasm JIT backend; pair diagnosis with unsampled production-mode replay.",
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn diagnostic_policy_cannot_claim_native_execution() {
        let mode = super::execution_mode();
        assert_eq!(mode.preview_tools, cfg!(feature = "preview-tools"));
        assert_eq!(mode.runtime, "luau");
        assert_eq!(mode.vm_implementation, "luau-upstream-vendored");
        assert_eq!(mode.host_binding, "rust-mlua");
        assert_eq!(mode.native_codegen_fallback, "interpreter");
        assert_eq!(mode.bytecode_optimization_level, if mode.preview_tools { 1 } else { 2 });
        assert_eq!(mode.bytecode_type_info_level, if mode.native_codegen_requested { 1 } else { 0 });
        if mode.preview_tools {
            assert!(!mode.native_codegen_requested);
            assert_eq!(mode.luau_execution, "interpreter");
            assert_eq!(mode.build_intent, "diagnostic");
        }
    }
}

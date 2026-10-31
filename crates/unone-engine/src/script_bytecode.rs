//! Entry scripts precompiled at export. A production player loads bytecode
//! instead of compiling shipped source: no compile time, no compiler memory
//! peak and no source text in the load payload. Bytecode is accepted only when
//! it was produced with this runtime's exact production compiler settings, so a
//! precompiled game runs the same instructions as one compiled at load.
use serde::{Deserialize, Serialize};

/// Reserved staged-data id that carries the bytes beside the load payload.
pub const SCRIPT_BYTECODE_DATA_ID: &str = "unone:script-bytecode";
/// Bytecode larger than this is rejected before loading.
pub const MAX_SCRIPT_BYTECODE_BYTES: usize = 512 * 1024 * 1024;

/// Declares the precompiled entry script in a host payload in place of `script`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ScriptBytecodeDecl {
    /// Content-relative file the host fetches and stages as SCRIPT_BYTECODE_DATA_ID.
    pub source: String,
    /// Compiler identity; must equal the loading runtime's `script_bytecode_format`.
    pub format: String,
    pub byte_length: usize,
}

/// Bytecode for a production runtime and the format that runtime will require.
pub struct ScriptBytecode { pub bytes: Vec<u8>, pub format: String }

fn compiler(optimization: u8, type_info: u8) -> mlua::Compiler {
    mlua::Compiler::new().set_optimization_level(optimization).set_type_info_level(type_info)
}
fn format(optimization: u8, type_info: u8) -> Result<String, String> {
    // Luau's own bytecode version is the first byte of any compiled chunk.
    let probe = compiler(optimization, type_info).compile("return nil").map_err(|e| e.to_string())?;
    Ok(format!("luau-bytecode-v{}/o{optimization}/t{type_info}/unone-engine-{}", probe[0], env!("CARGO_PKG_VERSION")))
}

/// Compiles an entry script exactly as a production runtime would compile it at
/// load: optimization level 2, and type information only for native codegen.
pub fn compile_production_script(source: &str, native_codegen: bool) -> Result<ScriptBytecode, String> {
    let type_info = u8::from(native_codegen);
    let bytes = compiler(2, type_info).compile(source).map_err(|e| e.to_string())?;
    Ok(ScriptBytecode { format: format(2, type_info)?, bytes })
}

/// The format this runtime loads; None when it compiles source with
/// developer settings and therefore never accepts precompiled bytecode.
pub fn script_bytecode_format() -> Option<String> {
    if cfg!(any(feature = "dev-tools", feature = "preview-tools")) { return None; }
    format(crate::execution::bytecode_optimization_level(), crate::execution::bytecode_type_info_level()).ok()
}

/// Checks declared bytecode against the delivered bytes and this runtime.
pub(crate) fn admit(decl: &ScriptBytecodeDecl, bytes: &[u8]) -> Result<(), String> {
    let expected = script_bytecode_format()
        .ok_or("SCRIPT_BYTECODE_UNSUPPORTED: developer and preview players load script source")?;
    if decl.format != expected {
        return Err(format!("SCRIPT_BYTECODE_INCOMPATIBLE: exported for {}, this runtime loads {expected}; export again with this SDK", decl.format));
    }
    if bytes.len() != decl.byte_length || bytes.is_empty() || bytes.len() > MAX_SCRIPT_BYTECODE_BYTES {
        return Err(format!("SCRIPT_BYTECODE_INVALID: declared {} bytes, received {}", decl.byte_length, bytes.len()));
    }
    // A compile error encodes version 0 followed by its message.
    if bytes[0] == 0 { return Err("SCRIPT_BYTECODE_INVALID: chunk holds a compile error".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_bytecode_declares_its_compiler_and_rejects_compile_errors() {
        let compiled = compile_production_script("return {start=function()end,update=function()end}", false).unwrap();
        assert!(compiled.format.starts_with("luau-bytecode-v") && compiled.format.contains("/o2/t0/"));
        assert_ne!(compiled.bytes[0], 0);
        assert!(compile_production_script("return {", false).is_err());
        assert!(compile_production_script("return 1", true).unwrap().format.contains("/o2/t1/"));
    }
    #[test]
    fn admission_checks_runtime_format_and_length() {
        let compiled = compile_production_script("return 1", false).unwrap();
        let decl = ScriptBytecodeDecl { source: "script.luaubc".into(), format: compiled.format.clone(), byte_length: compiled.bytes.len() };
        match script_bytecode_format() {
            None => assert!(admit(&decl, &compiled.bytes).unwrap_err().starts_with("SCRIPT_BYTECODE_UNSUPPORTED")),
            Some(format) => {
                assert_eq!(admit(&decl, &compiled.bytes).is_ok(), format == compiled.format);
                let mut truncated = ScriptBytecodeDecl { format, ..decl.clone() };
                assert!(admit(&truncated, &compiled.bytes[..1]).unwrap_err().starts_with("SCRIPT_BYTECODE_INVALID"));
                truncated.format.push('x');
                assert!(admit(&truncated, &compiled.bytes).unwrap_err().starts_with("SCRIPT_BYTECODE_INCOMPATIBLE"));
            }
        }
    }
}

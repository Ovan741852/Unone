//! Entry scripts and their modules precompiled at export. A production player
//! loads bytecode instead of compiling shipped source: no compile time, no
//! compiler memory peak and no source text in the load payload. Bytecode is
//! accepted only when it was produced with this runtime's exact production
//! compiler settings, so a precompiled game runs the same instructions as one
//! compiled at load.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Reserved staged-data id that carries the bytes beside the load payload.
pub const SCRIPT_BYTECODE_DATA_ID: &str = "unone:script-bytecode";
/// Reserved staged-data id for the file holding every module's bytecode.
pub const SCRIPT_MODULE_BYTECODE_DATA_ID: &str = "unone:script-module-bytecode";
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

/// Declares precompiled modules in a host payload in place of `script_modules`.
/// One file holds every module's chunk, back to back in key order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ScriptModuleBytecodeDecl {
    /// Content-relative file the host fetches and stages as SCRIPT_MODULE_BYTECODE_DATA_ID.
    pub source: String,
    /// Compiler identity; must equal the loading runtime's `script_bytecode_format`.
    pub format: String,
    pub byte_length: usize,
    /// Each module's chunk length, keyed by its path relative to the entry
    /// script's directory; the lengths add up to `byte_length`.
    pub modules: BTreeMap<String, usize>,
}

/// Bytecode for a production runtime and the format that runtime will require.
pub struct ScriptBytecode { pub bytes: Vec<u8>, pub format: String }

/// Every module's bytecode, concatenated in key order, with each chunk's length.
pub struct ScriptModuleBytecode { pub bytes: Vec<u8>, pub format: String, pub modules: BTreeMap<String, usize> }

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

/// Compiles every module as `compile_production_script` compiles the entry and
/// concatenates the chunks in key order. An error names the module.
pub fn compile_production_modules(sources: &BTreeMap<String, String>, native_codegen: bool) -> Result<ScriptModuleBytecode, String> {
    let type_info = u8::from(native_codegen);
    let compiler = compiler(2, type_info);
    let (mut bytes, mut modules) = (Vec::new(), BTreeMap::new());
    for (key, source) in sources {
        let chunk = compiler.compile(source).map_err(|e| format!("{key}: {e}"))?;
        modules.insert(key.clone(), chunk.len());
        bytes.extend_from_slice(&chunk);
    }
    Ok(ScriptModuleBytecode { bytes, format: format(2, type_info)?, modules })
}

/// The format this runtime loads; None when it compiles source with
/// developer settings and therefore never accepts precompiled bytecode.
pub fn script_bytecode_format() -> Option<String> {
    if cfg!(any(feature = "dev-tools", feature = "preview-tools")) { return None; }
    format(crate::execution::bytecode_optimization_level(), crate::execution::bytecode_type_info_level()).ok()
}

fn admit_format(format: &str) -> Result<(), String> {
    let expected = script_bytecode_format()
        .ok_or("SCRIPT_BYTECODE_UNSUPPORTED: developer and preview players load script source")?;
    if format != expected {
        return Err(format!("SCRIPT_BYTECODE_INCOMPATIBLE: exported for {format}, this runtime loads {expected}; export again with this SDK"));
    }
    Ok(())
}
fn admit_length(declared: usize, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() != declared || bytes.is_empty() || bytes.len() > MAX_SCRIPT_BYTECODE_BYTES {
        return Err(format!("SCRIPT_BYTECODE_INVALID: declared {declared} bytes, received {}", bytes.len()));
    }
    Ok(())
}

/// Checks declared bytecode against the delivered bytes and this runtime.
pub(crate) fn admit(decl: &ScriptBytecodeDecl, bytes: &[u8]) -> Result<(), String> {
    admit_format(&decl.format)?;
    admit_length(decl.byte_length, bytes)?;
    // A compile error encodes version 0 followed by its message.
    if bytes[0] == 0 { return Err("SCRIPT_BYTECODE_INVALID: chunk holds a compile error".into()); }
    Ok(())
}

/// Checks declared module bytecode against the delivered file and this
/// runtime, then splits it into one chunk per module.
pub(crate) fn admit_modules(decl: &ScriptModuleBytecodeDecl, bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, String> {
    admit_format(&decl.format)?;
    if decl.modules.len() > crate::MAX_SCRIPT_MODULES {
        return Err(format!("SCRIPT_MODULE_LIMIT: {} modules exceed the limit of {}", decl.modules.len(), crate::MAX_SCRIPT_MODULES));
    }
    admit_length(decl.byte_length, bytes)?;
    let total = decl.modules.values().try_fold(0usize, |sum, &length| sum.checked_add(length));
    if total != Some(bytes.len()) {
        return Err(format!("SCRIPT_BYTECODE_INVALID: module lengths do not add up to the {} bytes received", bytes.len()));
    }
    let mut offset = 0;
    decl.modules.iter().map(|(key, &length)| {
        let chunk = &bytes[offset..offset + length];
        offset += length;
        match chunk.first() {
            None => Err(format!("SCRIPT_BYTECODE_INVALID: {key} is empty")),
            Some(0) => Err(format!("SCRIPT_BYTECODE_INVALID: {key} holds a compile error")),
            Some(_) => Ok((key.clone(), chunk.to_vec())),
        }
    }).collect()
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

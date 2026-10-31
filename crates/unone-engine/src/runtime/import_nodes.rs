//! Game-authored import nodes: Luau functions that turn source bytes into
//! engine values before hosts read assets (`crate::import`). A module returns a table
//! of node definitions, each declaring typed input and output ports and a
//! `run(inputs, params)` function. Nodes run in the same isolated, pure VM as
//! jobs -- no world, no files, no clock -- so a node's outputs depend only on
//! its inputs, params and source, which is what makes import results cacheable
//! and their provenance meaningful. See docs/import-pipeline.md.
use mlua::{Function, Lua, Table, Value};
use std::collections::BTreeMap;

/// A value flowing between import nodes.
#[derive(Debug, Clone, PartialEq)]
pub enum ImportValue {
    Bytes(Vec<u8>),
    /// Straight RGBA8, row-major, first row at the top.
    Image { width: u32, height: u32, rgba: Vec<u8> },
    Json(serde_json::Value),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportPortType { Bytes, Image, Json }

impl ImportValue {
    pub fn port_type(&self) -> ImportPortType {
        match self { Self::Bytes(_) => ImportPortType::Bytes, Self::Image { .. } => ImportPortType::Image, Self::Json(_) => ImportPortType::Json }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ImportNodeDefinition {
    pub name: String,
    pub inputs: BTreeMap<String, ImportPortType>,
    pub outputs: BTreeMap<String, ImportPortType>,
}

/// Images and byte values are bounded so a faulty node fails instead of
/// exhausting memory; 16384x16384 RGBA is the largest texture any host accepts.
const MAX_IMAGE_SIDE: u32 = 16384;
const VM_BYTES: usize = 2 << 30;

fn invalid(message: impl std::fmt::Display) -> String { format!("IMPORT_NODE_INVALID: {message}") }

fn vm() -> Result<Lua, String> {
    let lua = super::determinism::new_pure_vm().map_err(|e| e.explanation)?;
    lua.set_memory_limit(VM_BYTES).map_err(|e| e.to_string())?;
    Ok(lua)
}

fn ports(table: Option<Table>, what: &str) -> Result<BTreeMap<String, ImportPortType>, String> {
    let mut ports = BTreeMap::new();
    let Some(table) = table else { return Ok(ports) };
    for pair in table.pairs::<String, String>() {
        let (name, kind) = pair.map_err(|e| invalid(format!("{what}: {e}")))?;
        if !crate::shader::valid_identifier(&name) { return Err(invalid(format!("{what} port '{name}' must be an identifier"))); }
        let kind = serde_json::from_value(serde_json::Value::String(kind.clone()))
            .map_err(|_| invalid(format!("{what} port '{name}' has unknown type '{kind}' (bytes, image or json)")))?;
        ports.insert(name, kind);
    }
    Ok(ports)
}

fn module(lua: &Lua, path: &str, source: &str) -> Result<Table, String> {
    lua.load(source).set_name(path).eval::<Table>().map_err(|e| invalid(format!("{path} must return a table of node definitions: {e}")))
}

fn definition(name: &str, node: &Table) -> Result<ImportNodeDefinition, String> {
    node.get::<Function>("run").map_err(|_| invalid(format!("node '{name}' needs a run function")))?;
    Ok(ImportNodeDefinition { name: name.into(), inputs: ports(node.get("inputs").ok(), name)?, outputs: ports(node.get("outputs").ok(), name)? })
}

/// The node definitions a module declares, by name.
pub fn describe_import_nodes(path: &str, source: &str) -> Result<Vec<ImportNodeDefinition>, String> {
    let lua = vm()?;
    let table = module(&lua, path, source)?;
    let mut nodes = Vec::new();
    for pair in table.pairs::<String, Table>() {
        let (name, node) = pair.map_err(|e| invalid(format!("{path}: {e}")))?;
        nodes.push(definition(&name, &node)?);
    }
    nodes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(nodes)
}

fn to_lua(lua: &Lua, value: &ImportValue) -> mlua::Result<Value> {
    Ok(match value {
        ImportValue::Bytes(bytes) => Value::Buffer(lua.create_buffer(bytes)?),
        ImportValue::Image { width, height, rgba } => {
            let table = lua.create_table()?;
            table.set("width", *width)?;table.set("height", *height)?;table.set("rgba", lua.create_buffer(rgba)?)?;
            Value::Table(table)
        }
        ImportValue::Json(value) => super::bindings::value::json_to_lua(lua, value.clone())?,
    })
}

fn from_lua(value: Value, kind: ImportPortType, port: &str) -> Result<ImportValue, String> {
    let wrong = || invalid(format!("output '{port}' must be {kind:?}"));
    match kind {
        ImportPortType::Bytes => match value { Value::Buffer(buffer) => Ok(ImportValue::Bytes(buffer.to_vec())), _ => Err(wrong()) },
        ImportPortType::Image => {
            let Value::Table(table) = value else { return Err(wrong()) };
            let (width, height): (u32, u32) = (table.get("width").map_err(|_| wrong())?, table.get("height").map_err(|_| wrong())?);
            let Value::Buffer(rgba) = table.get::<Value>("rgba").map_err(|_| wrong())? else { return Err(wrong()) };
            if !(1..=MAX_IMAGE_SIDE).contains(&width) || !(1..=MAX_IMAGE_SIDE).contains(&height) || rgba.len() != width as usize * height as usize * 4 {
                return Err(invalid(format!("image '{port}' needs 1..16384 sides and width*height*4 RGBA bytes")));
            }
            Ok(ImportValue::Image { width, height, rgba: rgba.to_vec() })
        }
        ImportPortType::Json => super::bindings::value::lua_value_to_json(value).map(ImportValue::Json).map_err(|e| invalid(format!("output '{port}': {e}"))),
    }
}

/// Runs one node of a module. Inputs must match the node's declared ports and
/// every declared output must be produced with its declared type.
pub fn run_import_node(path: &str, source: &str, name: &str, inputs: &BTreeMap<String, ImportValue>, params: &serde_json::Value)
    -> Result<BTreeMap<String, ImportValue>, String>
{
    let lua = vm()?;
    let table = module(&lua, path, source)?;
    let node: Table = table.get(name).map_err(|_| invalid(format!("{path} has no node '{name}'")))?;
    let declared = definition(name, &node)?;
    for (port, kind) in &declared.inputs {
        let value = inputs.get(port).ok_or_else(|| invalid(format!("node '{name}' input '{port}' is not connected")))?;
        if value.port_type() != *kind { return Err(invalid(format!("node '{name}' input '{port}' needs {kind:?}, got {:?}", value.port_type()))); }
    }
    if let Some(extra) = inputs.keys().find(|port| !declared.inputs.contains_key(*port)) {
        return Err(invalid(format!("node '{name}' has no input '{extra}'")));
    }
    let lua_inputs = lua.create_table().map_err(|e| e.to_string())?;
    for (port, value) in inputs { lua_inputs.set(port.as_str(), to_lua(&lua, value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?; }
    let lua_params = super::bindings::value::json_to_lua(&lua, params.clone()).map_err(|e| invalid(format!("params: {e}")))?;
    let run: Function = node.get("run").map_err(|e| e.to_string())?;
    let result: Table = run.call((lua_inputs, lua_params)).map_err(|e| format!("IMPORT_NODE_FAILED [{path}:{name}]: {e}"))?;
    let mut outputs = BTreeMap::new();
    for (port, kind) in &declared.outputs {
        let value: Value = result.get(port.as_str()).map_err(|e| e.to_string())?;
        if value.is_nil() { return Err(invalid(format!("node '{name}' did not produce output '{port}'"))); }
        outputs.insert(port.clone(), from_lua(value, *kind, port)?);
    }
    Ok(outputs)
}

#[cfg(test)]
mod tests {
    use super::*;
    const MODULE: &str = r#"
return {
  invert = {
    inputs = {image = "image"}, outputs = {image = "image", stats = "json"},
    run = function(inputs, params)
      local src, n = inputs.image.rgba, inputs.image.width * inputs.image.height
      local out = buffer.create(n * 4)
      for i = 0, n - 1 do
        for c = 0, 2 do buffer.writeu8(out, i * 4 + c, 255 - buffer.readu8(src, i * 4 + c)) end
        buffer.writeu8(out, i * 4 + 3, params.alpha)
      end
      return {image = {width = inputs.image.width, height = inputs.image.height, rgba = out}, stats = {pixels = n}}
    end,
  },
  broken = {inputs = {data = "bytes"}, outputs = {data = "bytes"}, run = function() return {data = "text"} end},
}"#;
    #[test]
    fn nodes_declare_typed_ports_and_run_pure() {
        let nodes = describe_import_nodes("nodes.luau", MODULE).unwrap();
        assert_eq!(nodes.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(), ["broken", "invert"]);
        assert_eq!(nodes[1].outputs["stats"], ImportPortType::Json);
        let image = ImportValue::Image { width: 2, height: 1, rgba: vec![0, 10, 20, 255, 255, 255, 255, 255] };
        let outputs = run_import_node("nodes.luau", MODULE, "invert", &BTreeMap::from([("image".into(), image.clone())]), &serde_json::json!({"alpha": 7})).unwrap();
        assert_eq!(outputs["image"], ImportValue::Image { width: 2, height: 1, rgba: vec![255, 245, 235, 7, 0, 0, 0, 7] });
        assert_eq!(outputs["stats"], ImportValue::Json(serde_json::json!({"pixels": 2})));
        let wrong = BTreeMap::from([("image".into(), ImportValue::Bytes(vec![1]))]);
        assert!(run_import_node("nodes.luau", MODULE, "invert", &wrong, &serde_json::json!({})).unwrap_err().contains("needs Image"));
        let bytes = BTreeMap::from([("data".into(), ImportValue::Bytes(vec![1]))]);
        assert!(run_import_node("nodes.luau", MODULE, "broken", &bytes, &serde_json::Value::Null).unwrap_err().contains("must be Bytes"));
        assert!(describe_import_nodes("bad.luau", "return {x = {inputs = {a = 'number'}, run = function() end}}").unwrap_err().contains("unknown type"));
        // Nodes are pure: no clock, no randomness, no output channel.
        let impure = "return {t = {outputs = {v = 'json'}, run = function() return {v = os.clock()} end}}";
        assert!(run_import_node("t.luau", impure, "t", &BTreeMap::new(), &serde_json::Value::Null).unwrap_err().contains("NONDETERMINISTIC"));
    }
}

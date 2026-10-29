use mlua::{Lua, Table, Value};
use std::collections::BTreeMap;

// UI component trees are serialized through the same portable Lua-value
// boundary as observations. Keep this guard above the Core UI component limit
// (16 wrappers plus the tree/children/rect fields) so a valid reusable UI tree
// is not rejected before UiTree validation can produce its specific diagnostic.
const MAX_OBSERVATION_DEPTH: usize = 64;
const PORTABLE_INTEGER_MIN: i64 = i32::MIN as i64;
const PORTABLE_INTEGER_MAX: i64 = i32::MAX as i64;
// A weak-key registry preserves the identity of engine-produced JSON arrays,
// including empty arrays. It does not add a public field or require a table
// metatable, and does not keep discarded authoring tables alive.
const ARRAY_REGISTRY_KEY: &str = "unone.json.arrays";

fn array_registry(lua: &Lua) -> mlua::Result<Table> {
    if let Some(registry) = lua.named_registry_value::<Option<Table>>(ARRAY_REGISTRY_KEY)? {
        return Ok(registry);
    }
    let registry = lua.create_table()?;
    let metatable = lua.create_table()?;
    metatable.raw_set("__mode", "k")?;
    registry.set_metatable(Some(metatable))?;
    lua.set_named_registry_value(ARRAY_REGISTRY_KEY, registry.clone())?;
    Ok(registry)
}

fn mark_array(lua: &Lua, table: &Table) -> mlua::Result<()> {
    array_registry(lua)?.raw_set(table.clone(), true)
}

/// Mark a caller's contiguous serializable table without copying or changing it.
/// Later mutations are validated again when the value crosses the JSON boundary.
pub(super) fn observation_array(lua: &Lua, table: Option<Table>) -> mlua::Result<Table> {
    let table = match table {
        Some(table) => table,
        None => lua.create_table()?,
    };
    let mut keys = Vec::new();
    for pair in table.clone().pairs::<Value, Value>() {
        let (key, _) = pair?;
        let key = match key {
            Value::Integer(key) if key > 0 => luau_integer_to_i64(key),
            Value::Number(key) if key.is_finite() && key > 0.0 && key.fract() == 0.0
                && key <= PORTABLE_INTEGER_MAX as f64 => key as i64,
            _ => return Err(mlua::Error::RuntimeError(
                "observation array keys must be contiguous positive integers starting at 1; string keys are not allowed".into(),
            )),
        };
        ensure_portable_integer(key).map_err(mlua::Error::RuntimeError)?;
        keys.push(key);
    }
    keys.sort_unstable();
    if !keys.iter().copied().eq(1..=keys.len() as i64) {
        return Err(mlua::Error::RuntimeError(
            "observation array keys must be contiguous starting at 1".into(),
        ));
    }
    observation_value_to_json(lua, Value::Table(table.clone()))
        .map_err(mlua::Error::RuntimeError)?;
    mark_array(lua, &table)?;
    Ok(table)
}

pub(in crate::runtime) fn lua_value_to_json(value: Value) -> Result<serde_json::Value, String> {
    lua_value_to_json_at(value, 0, false, None)
}

pub(super) fn portable_value_to_json(lua: &Lua, value: Value) -> Result<serde_json::Value, String> {
    let arrays = array_registry(lua).map_err(|error| error.to_string())?;
    lua_value_to_json_at(value, 0, false, Some(&arrays))
}

// Luau numbers are binary64 on both hosts, but mlua extracts integral numbers
// as target-sized Integers. Preserve the existing portable i32 save/input
// boundary while allowing observations to expose all finite Luau numbers.
// Canonicalize wide integral values to JSON floats, matching WASM's Number path.
pub(in crate::runtime) fn observation_value_to_json(lua: &Lua, value: Value) -> Result<serde_json::Value, String> {
    let arrays = array_registry(lua).map_err(|error| error.to_string())?;
    lua_value_to_json_at(value, 0, true, Some(&arrays))
}

fn lua_value_to_json_at(value: Value, depth: usize, observation: bool, arrays: Option<&Table>) -> Result<serde_json::Value, String> {
    if depth > MAX_OBSERVATION_DEPTH {
        return Err(format!(
            "observation value exceeds maximum nesting depth of {MAX_OBSERVATION_DEPTH}"
        ));
    }
    match value {
        Value::Nil => Ok(serde_json::Value::Null),
        Value::Boolean(value) => Ok(serde_json::Value::Bool(value)),
        Value::Integer(value) => {
            let value = luau_integer_to_i64(value);
            if observation && !(PORTABLE_INTEGER_MIN..=PORTABLE_INTEGER_MAX).contains(&value) {
                return Ok(serde_json::json!(value as f64));
            }
            ensure_portable_integer(value)?;
            Ok(serde_json::json!(value))
        }
        Value::Number(value) if value.is_finite() => Ok(serde_json::json!(value)),
        Value::Number(_) => Err("observation numbers must be finite".to_string()),
        Value::String(value) => value
            .to_str()
            .map(|value| serde_json::Value::String(value.to_string()))
            .map_err(|error| format!("observation string is not valid UTF-8: {error}")),
        Value::Table(table) => table_to_json(table, depth, observation, arrays),
        other => Err(format!(
            "observation value kind '{}' is not serializable",
            other.type_name()
        )),
    }
}

fn table_to_json(table: Table, depth: usize, observation: bool, arrays: Option<&Table>) -> Result<serde_json::Value, String> {
    let explicit_array = arrays.map(|registry| registry.raw_get::<bool>(table.clone()))
        .transpose().map_err(|error| error.to_string())?.unwrap_or(false);
    let mut object = BTreeMap::new();
    let mut array: BTreeMap<i64, serde_json::Value> = BTreeMap::new();
    for pair in table.pairs::<Value, Value>() {
        let (key, value) = pair.map_err(|error| error.to_string())?;
        let value = lua_value_to_json_at(value, depth + 1, observation, arrays)?;
        match key {
            Value::String(key) => {
                if explicit_array {
                    return Err("observation array keys must be contiguous positive integers starting at 1; string keys are not allowed".to_string());
                }
                if !array.is_empty() {
                    return Err("observation table cannot mix string and integer keys".to_string());
                }
                let key = key
                    .to_str()
                    .map_err(|error| format!("observation key is not valid UTF-8: {error}"))?
                    .to_string();
                object.insert(key, value);
            }
            Value::Integer(key) if key > 0 => {
                if !object.is_empty() {
                    return Err("observation table cannot mix string and integer keys".to_string());
                }
                array.insert(ensure_portable_integer(luau_integer_to_i64(key))?, value);
            }
            Value::Number(key) if key.is_finite() && key.fract() == 0.0 && key > 0.0 => {
                if !object.is_empty() {
                    return Err("observation table cannot mix string and integer keys".to_string());
                }
                if key > PORTABLE_INTEGER_MAX as f64 {
                    return Err(
                        "observation array key is outside the portable integer range".to_string(),
                    );
                }
                array.insert(key as i64, value);
            }
            _ => {
                return Err(
                    "observation table keys must be UTF-8 strings or positive integers".to_string(),
                );
            }
        }
    }
    if explicit_array || !array.is_empty() {
        let expected = (1..=array.len() as i64).collect::<Vec<_>>();
        let keys = array.keys().copied().collect::<Vec<_>>();
        if keys != expected {
            return Err("observation array keys must be contiguous starting at 1".to_string());
        }
        return Ok(serde_json::Value::Array(array.into_values().collect()));
    }
    Ok(serde_json::Value::Object(object.into_iter().collect()))
}

#[cfg(target_pointer_width = "64")]
fn luau_integer_to_i64(value: mlua::Integer) -> i64 {
    value
}

#[cfg(not(target_pointer_width = "64"))]
fn luau_integer_to_i64(value: mlua::Integer) -> i64 {
    value as i64
}

fn ensure_portable_integer(value: i64) -> Result<i64, String> {
    if !(PORTABLE_INTEGER_MIN..=PORTABLE_INTEGER_MAX).contains(&value) {
        return Err("observation integer is outside the portable Luau integer range".to_string());
    }
    Ok(value)
}

pub(in crate::runtime) fn json_to_lua(lua: &Lua, value: serde_json::Value) -> mlua::Result<Value> {
    json_to_lua_at(lua, value, false)
}

// Result/observation records use the finite binary64 number boundary, while
// saves and inputs retain their established portable signed-i32 restriction.
pub(super) fn observation_json_to_lua(lua: &Lua, value: serde_json::Value) -> mlua::Result<Value> {
    json_to_lua_at(lua, value, true)
}

fn json_to_lua_at(lua: &Lua, value: serde_json::Value, observation: bool) -> mlua::Result<Value> {
    match value {
        serde_json::Value::Null => Ok(Value::Nil),
        serde_json::Value::Bool(value) => Ok(Value::Boolean(value)),
        serde_json::Value::Number(value) => {
            if observation {
                return value.as_f64().filter(|value| value.is_finite()).map(Value::Number)
                    .ok_or_else(|| mlua::Error::RuntimeError("observation result number is not portable".into()));
            }
            if let Some(value) = value.as_i64() {
                if ensure_portable_integer(value).is_err() {
                    return Err(mlua::Error::RuntimeError(
                        "save payload integer is outside the portable Luau integer range"
                            .to_string(),
                    ));
                }
                Ok(Value::Integer(value as mlua::Integer))
            } else if let Some(value) = value.as_f64() {
                Ok(Value::Number(value))
            } else {
                Err(mlua::Error::RuntimeError(
                    "save payload number is not representable in Luau".to_string(),
                ))
            }
        }
        serde_json::Value::String(value) => Ok(Value::String(lua.create_string(value)?)),
        serde_json::Value::Array(values) => {
            let table = lua.create_table()?;
            for (index, value) in values.into_iter().enumerate() {
                table.raw_set(index + 1, json_to_lua_at(lua, value, observation)?)?;
            }
            mark_array(lua, &table)?;
            Ok(Value::Table(table))
        }
        serde_json::Value::Object(values) => {
            let table = lua.create_table()?;
            for (key, value) in values {
                table.raw_set(key, json_to_lua_at(lua, value, observation)?)?;
            }
            Ok(Value::Table(table))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observation_numbers_match_wasm_classification_and_keep_other_boundaries_strict() {
        let lua = Lua::new();
        for number in [2_147_483_648.0, 4_294_967_295.0, 9_007_199_254_740_991.0, -9_007_199_254_740_991.0, 1e16] {
            let observed = lua.load(format!("return {{value={number:.0}}}")).eval::<Value>().unwrap();
            let native = observation_value_to_json(&lua, observed).unwrap();
            let wasm = observation_value_to_json(&lua, Value::Number(number)).unwrap();
            assert_eq!(serde_json::to_string(&native["value"]).unwrap(), serde_json::to_string(&wasm).unwrap());
        }
        let wide = lua.load("return {value=2147483648}").eval::<Value>().unwrap();
        assert!(lua_value_to_json(wide).unwrap_err().contains("portable"));
        for source in ["return {[2147483648]=1}", "return {callback=function() end}", "return {value=0/0}", "return {value=math.huge}"] {
            assert!(observation_value_to_json(&lua, lua.load(source).eval::<Value>().unwrap()).is_err(), "accepted {source}");
        }
    }

    #[test]
    fn json_arrays_roundtrip_with_empty_nested_arrays_and_objects_distinct() {
        let lua = Lua::new();
        let original = serde_json::json!({
            "empty": [], "object": {}, "nested": [[], {}, [1, true, "a"]],
        });
        let decoded = json_to_lua(&lua, original.clone()).unwrap();
        assert_eq!(observation_value_to_json(&lua, decoded.clone()).unwrap(), original);
        assert_eq!(portable_value_to_json(&lua, decoded).unwrap(), original);
        let wide = serde_json::json!({"array": [[], 9_007_199_254_740_991u64]});
        let decoded = observation_json_to_lua(&lua, wide.clone()).unwrap();
        let observed = observation_value_to_json(&lua, decoded.clone()).unwrap();
        assert_eq!(observed["array"][0], serde_json::json!([]));
        assert_eq!(observed["array"][1].as_f64(), Some(9_007_199_254_740_991.0));
        assert!(portable_value_to_json(&lua, decoded).unwrap_err().contains("portable"));
        assert!(json_to_lua(&lua, wide).is_err());
    }

    #[test]
    fn array_identity_survives_clear_refill_and_does_not_change_plain_tables() {
        let lua = Lua::new();
        let table = lua.load("return {1,2}").eval::<Table>().unwrap();
        let marked = observation_array(&lua, Some(table.clone())).unwrap();
        assert_eq!(marked.to_pointer(), table.to_pointer());
        assert!(table.metatable().is_none());
        table.clear().unwrap();
        assert_eq!(observation_value_to_json(&lua, Value::Table(table.clone())).unwrap(), serde_json::json!([]));
        table.raw_set(1, "refilled").unwrap();
        assert_eq!(observation_value_to_json(&lua, Value::Table(table.clone())).unwrap(), serde_json::json!(["refilled"]));
        table.raw_set("extra", 1).unwrap();
        assert!(observation_value_to_json(&lua, Value::Table(table.clone())).unwrap_err().contains("string keys"));
        table.raw_remove("extra").unwrap();
        table.raw_set(3, true).unwrap();
        assert!(observation_value_to_json(&lua, Value::Table(table)).unwrap_err().contains("contiguous"));
        let plain = lua.create_table().unwrap();
        assert_eq!(observation_value_to_json(&lua, Value::Table(plain)).unwrap(), serde_json::json!({}));
        let fake = lua.load("return setmetatable({}, {__unone_json_array=true})").eval::<Value>().unwrap();
        assert_eq!(observation_value_to_json(&lua, fake).unwrap(), serde_json::json!({}));
    }

    #[test]
    fn explicit_arrays_validate_all_contents_and_allow_protected_or_frozen_tables() {
        let lua = Lua::new();
        for source in [
            "return {[2]=1}", "return {[1]=1, extra=2}", "return {extra=2}",
            "return {[0]=1}", "return {[-1]=1}", "return {[1.5]=1}",
            "return {[2147483648]=1}", "return {function() end}",
            "return {buffer.create(1)}", "return {0/0}", "return {math.huge}",
            "local t={}; t[1]=t; return t", "return {{[2]=1}}",
        ] {
            let table = lua.load(source).eval::<Table>().unwrap();
            assert!(observation_array(&lua, Some(table)).is_err(), "accepted {source}");
        }
        for source in [
            "return setmetatable({}, {__metatable='protected'})",
            "return table.freeze({})",
        ] {
            let table = lua.load(source).eval::<Table>().unwrap();
            let table = observation_array(&lua, Some(table)).unwrap();
            assert_eq!(observation_value_to_json(&lua, Value::Table(table)).unwrap(), serde_json::json!([]));
        }
        let a = observation_array(&lua, None).unwrap();
        let b = observation_array(&lua, None).unwrap();
        assert_ne!(a.to_pointer(), b.to_pointer());
    }

    #[test]
    fn array_registry_does_not_keep_marked_tables_alive() {
        let lua = Lua::new();
        let registry = array_registry(&lua).unwrap();
        let retained = observation_array(&lua, None).unwrap();
        for _ in 0..200 {
            observation_array(&lua, None).unwrap();
        }
        lua.gc_collect().unwrap();
        lua.gc_collect().unwrap();
        assert_eq!(registry.clone().pairs::<Table, bool>().count(), 1);
        drop(retained);
        lua.gc_collect().unwrap();
        lua.gc_collect().unwrap();
        assert_eq!(registry.pairs::<Table, bool>().count(), 0);
    }
}

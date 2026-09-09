use mlua::{Lua, Table, Value};
use std::collections::BTreeMap;

// UI component trees are serialized through the same portable Lua-value
// boundary as observations. Keep this guard above the Core UI component limit
// (16 wrappers plus the tree/children/rect fields) so a valid reusable UI tree
// is not rejected before UiTree validation can produce its specific diagnostic.
const MAX_OBSERVATION_DEPTH: usize = 64;
const PORTABLE_INTEGER_MIN: i64 = i32::MIN as i64;
const PORTABLE_INTEGER_MAX: i64 = i32::MAX as i64;

pub(super) fn lua_value_to_json(value: Value) -> Result<serde_json::Value, String> {
    lua_value_to_json_at(value, 0)
}

fn lua_value_to_json_at(value: Value, depth: usize) -> Result<serde_json::Value, String> {
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
            ensure_portable_integer(value)?;
            Ok(serde_json::json!(value))
        }
        Value::Number(value) if value.is_finite() => Ok(serde_json::json!(value)),
        Value::Number(_) => Err("observation numbers must be finite".to_string()),
        Value::String(value) => value
            .to_str()
            .map(|value| serde_json::Value::String(value.to_string()))
            .map_err(|error| format!("observation string is not valid UTF-8: {error}")),
        Value::Table(table) => table_to_json(table, depth),
        other => Err(format!(
            "observation value kind '{}' is not serializable",
            other.type_name()
        )),
    }
}

fn table_to_json(table: Table, depth: usize) -> Result<serde_json::Value, String> {
    let mut object = BTreeMap::new();
    let mut array: BTreeMap<i64, serde_json::Value> = BTreeMap::new();
    for pair in table.pairs::<Value, Value>() {
        let (key, value) = pair.map_err(|error| error.to_string())?;
        let value = lua_value_to_json_at(value, depth + 1)?;
        match key {
            Value::String(key) => {
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
    if !array.is_empty() {
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

pub(super) fn json_to_lua(lua: &Lua, value: serde_json::Value) -> mlua::Result<Value> {
    match value {
        serde_json::Value::Null => Ok(Value::Nil),
        serde_json::Value::Bool(value) => Ok(Value::Boolean(value)),
        serde_json::Value::Number(value) => {
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
                table.set(index + 1, json_to_lua(lua, value)?)?;
            }
            Ok(Value::Table(table))
        }
        serde_json::Value::Object(values) => {
            let table = lua.create_table()?;
            for (key, value) in values {
                table.set(key, json_to_lua(lua, value)?)?;
            }
            Ok(Value::Table(table))
        }
    }
}

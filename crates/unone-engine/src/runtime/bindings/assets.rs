//! `api.assets`: decode data assets with the loader their manifest entry names.
//! Each asset decodes once per VM; the value is cached and frozen, so every
//! caller shares it and nobody can change it.
use super::{ApiState, Lua, Table};
use crate::data_assets::{BUILTIN_DATA_LOADERS, DataAssets, valid_loader_name};
use mlua::{Function, Value};
use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use std::{cell::RefCell, fmt, rc::Rc};

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let values = lua.create_table()?;
    let loaders = lua.create_table()?;

    let store = Rc::clone(&state.data_assets);
    let (cache, registered) = (values.clone(), loaders.clone());
    api.set("load", lua.create_function(move |lua, id: String| {
        let cached: Value = cache.raw_get(id.as_str())?;
        if !cached.is_nil() {
            return Ok(cached);
        }
        let value = decode(lua, &store, &registered, &id).map_err(mlua::Error::RuntimeError)?;
        cache.raw_set(id.as_str(), value.clone())?;
        Ok(value)
    })?)?;

    let store = Rc::clone(&state.data_assets);
    let view = Rc::clone(&state.pure_view);
    api.set("registerLoader", lua.create_function(move |_, (name, loader): (String, Function)| {
        super::ensure_not_view(&view, "assets.registerLoader")?;
        if BUILTIN_DATA_LOADERS.contains(&name.as_str()) {
            return Err(mlua::Error::RuntimeError(format!(
                "ASSET_LOADER_RESERVED: '{name}' is a built-in loader ({})", BUILTIN_DATA_LOADERS.join(", ")
            )));
        }
        if !valid_loader_name(&name) {
            return Err(mlua::Error::RuntimeError(format!(
                "ASSET_LOADER_INVALID: loader name '{name}' must be 1-64 characters of a-z, 0-9, '.', '_' or '-'"
            )));
        }
        loaders.raw_set(name.as_str(), loader)?;
        // A replaced loader must not leave values decoded by its predecessor.
        for decl in store.borrow().decls().filter(|decl| decl.loader == name) {
            values.raw_set(decl.id.as_str(), Value::Nil)?;
        }
        Ok(())
    })?)?;
    Ok(api)
}

fn decode(lua: &Lua, store: &Rc<RefCell<DataAssets>>, loaders: &Table, id: &str) -> Result<Value, String> {
    let (loader, bytes) = {
        let mut store = store.borrow_mut();
        let Some(decl) = store.decl(id) else {
            let declared: Vec<_> = store.decls().map(|decl| decl.id.as_str()).take(8).collect();
            return Err(format!(
                "ASSET_ID_NOT_DECLARED: '{id}' is not a data asset; declare it with kind \"data\" in the asset manifest. Declared: [{}]",
                declared.join(", ")
            ));
        };
        let loader = decl.loader.clone();
        let bytes = store.take(id).ok_or_else(|| format!(
            "ASSET_DATA_RELEASED: '{id}' was already decoded and its bytes released; register loaders before the first api.assets.load"
        ))?;
        (loader, bytes)
    };
    let failed = |error: mlua::Error| format!("ASSET_LOAD_FAILED: '{id}' with loader '{loader}': {error}");
    match loader.as_str() {
        "bytes" => frozen_buffer(lua, &bytes).map(Value::Buffer).map_err(failed),
        "text" => {
            std::str::from_utf8(&bytes).map_err(|e| format!("ASSET_TEXT_INVALID: '{id}' is not UTF-8: {e}"))?;
            lua.create_string(&bytes).map(Value::String).map_err(failed)
        }
        "json" => {
            let mut parser = serde_json::Deserializer::from_slice(&bytes);
            let value = FrozenJson(lua).deserialize(&mut parser).and_then(|value| parser.end().map(|()| value));
            value.map_err(|e| format!("ASSET_JSON_INVALID: '{id}': {e}"))
        }
        name => {
            let Some(loader) = loaders.raw_get::<Option<Function>>(name).map_err(failed)? else {
                let mut known: Vec<String> = BUILTIN_DATA_LOADERS.iter().map(|name| name.to_string()).collect();
                for pair in loaders.pairs::<String, Value>() {
                    known.push(pair.map_err(failed)?.0);
                }
                return Err(format!(
                    "ASSET_LOADER_UNKNOWN: '{id}' names loader '{name}', which is not registered. Call api.assets.registerLoader(\"{name}\", fn) first. Known: [{}]",
                    known.join(", ")
                ));
            };
            let data = frozen_buffer(lua, &bytes).map_err(failed)?;
            drop(bytes);
            let value: Value = loader.call((data, id)).map_err(failed)?;
            if value.is_nil() {
                return Err(format!("ASSET_LOADER_RESULT_NIL: loader '{name}' returned nil for '{id}'"));
            }
            freeze_deep(lua, &value).map_err(failed)?;
            Ok(value)
        }
    }
}

fn frozen_buffer(lua: &Lua, bytes: &[u8]) -> mlua::Result<mlua::Buffer> {
    let buffer = lua.create_buffer(bytes)?;
    super::bytes::freeze(lua, &buffer)?;
    Ok(buffer)
}

/// Freeze every table and buffer reachable from a loader result. Tables are
/// frozen before their contents are visited, so cycles end at a frozen table.
fn freeze_deep(lua: &Lua, root: &Value) -> mlua::Result<()> {
    let mut pending = vec![root.clone()];
    while let Some(value) = pending.pop() {
        match value {
            Value::Table(table) if !table.is_readonly() => {
                table.set_readonly(true);
                for pair in table.pairs::<Value, Value>() {
                    let (key, value) = pair?;
                    pending.push(key);
                    pending.push(value);
                }
            }
            Value::Buffer(buffer) => super::bytes::freeze(lua, &buffer)?,
            _ => {}
        }
    }
    Ok(())
}

/// Builds frozen Luau values straight from JSON text, without an intermediate
/// serde_json::Value. Objects become tables, arrays sequences from 1, numbers
/// doubles and null nil (an array keeps the hole).
struct FrozenJson<'a>(&'a Lua);

impl<'de> DeserializeSeed<'de> for FrozenJson<'_> {
    type Value = Value;
    fn deserialize<D: de::Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        deserializer.deserialize_any(self)
    }
}

/// An exact double, or an error: a silently rounded id or offset is worse than a failed load.
fn exact<E: de::Error>(value: f64, exact: bool) -> Result<Value, E> {
    if exact { Ok(Value::Number(value)) } else { Err(E::custom("integer is not exactly representable as a Luau number")) }
}

impl<'de> Visitor<'de> for FrozenJson<'_> {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("JSON")
    }
    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Boolean(value))
    }
    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Value, E> {
        exact(value as f64, (value as f64) as i64 == value && value.unsigned_abs() <= 1 << 53)
    }
    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Value, E> {
        exact(value as f64, value <= 1 << 53)
    }
    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Value, E> {
        Ok(Value::Number(value))
    }
    fn visit_str<E: de::Error>(self, value: &str) -> Result<Value, E> {
        self.0.create_string(value).map(Value::String).map_err(E::custom)
    }
    fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Nil)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        let table = self.0.create_table_with_capacity(seq.size_hint().unwrap_or(0), 0).map_err(de::Error::custom)?;
        let mut index = 0usize;
        while let Some(value) = seq.next_element_seed(FrozenJson(self.0))? {
            index += 1;
            if !value.is_nil() {
                table.raw_set(index, value).map_err(de::Error::custom)?;
            }
        }
        table.set_readonly(true);
        Ok(Value::Table(table))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let table = self.0.create_table_with_capacity(0, map.size_hint().unwrap_or(0)).map_err(de::Error::custom)?;
        while let Some(key) = map.next_key_seed(JsonKey(self.0))? {
            let value = map.next_value_seed(FrozenJson(self.0))?;
            if !value.is_nil() {
                table.raw_set(key, value).map_err(de::Error::custom)?;
            }
        }
        table.set_readonly(true);
        Ok(Value::Table(table))
    }
}

/// Object keys go straight to Luau strings, borrowed from the input when unescaped.
struct JsonKey<'a>(&'a Lua);

impl<'de> DeserializeSeed<'de> for JsonKey<'_> {
    type Value = mlua::String;
    fn deserialize<D: de::Deserializer<'de>>(self, deserializer: D) -> Result<mlua::String, D::Error> {
        deserializer.deserialize_str(self)
    }
}

impl<'de> Visitor<'de> for JsonKey<'_> {
    type Value = mlua::String;
    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an object key")
    }
    fn visit_str<E: de::Error>(self, value: &str) -> Result<mlua::String, E> {
        self.0.create_string(value).map_err(E::custom)
    }
}

//! api.texture: runtime data textures that shader materials sample.
use super::{ApiState, Lua, Table, Value};
use crate::{DataTextureFormat, DataTextureRegion, MAX_DATA_TEXTURE_BYTES};
use std::rc::Rc;

fn error(message: impl std::fmt::Display) -> mlua::Error {
    mlua::Error::RuntimeError(format!("DATA_TEXTURE_INVALID: {message}"))
}
fn dimension(t: &Table, key: &str, minimum: u32) -> mlua::Result<u32> {
    match t.get::<Value>(key)? {
        Value::Nil if minimum == 0 => Ok(0),
        // Luau integers are i32 on wasm32 and i64 elsewhere.
        Value::Integer(n) if i64::from(n) >= i64::from(minimum) && i64::from(n) <= i64::from(u32::MAX) => Ok(i64::from(n) as u32),
        Value::Number(n) if n.fract() == 0. && n >= f64::from(minimum) && n <= f64::from(u32::MAX) => Ok(n as u32),
        _ => Err(error(format!("{key} must be an integer of at least {minimum}"))),
    }
}
// Rejects oversized buffers before copying them out of the VM.
fn data(t: &Table) -> mlua::Result<Vec<u8>> {
    let data: mlua::Buffer = t.get("data").map_err(|_| error("data buffer required"))?;
    if data.len() > MAX_DATA_TEXTURE_BYTES { return Err(mlua::Error::RuntimeError("DATA_TEXTURE_LIMIT: at most 16 MiB per texture".into())); }
    Ok(data.to_vec())
}

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let world = Rc::clone(&state.world);
    api.set("set", lua.create_function(move |_, (id, t): (String, Table)| {
        super::reject_unknown_keys(&t, &["width", "height", "format", "data"], "texture.set")?;
        let format: DataTextureFormat = match t.get::<Value>("format")? {
            Value::String(s) => serde_json::from_value(serde_json::Value::String(s.to_str()?.to_owned()))
                .map_err(|_| error("format must be rgba8, r32i, rgba32i, r32f or rgba32f"))?,
            _ => return Err(error("format must be rgba8, r32i, rgba32i, r32f or rgba32f")),
        };
        let (width, height) = (dimension(&t, "width", 1)?, dimension(&t, "height", 1)?);
        world.borrow_mut().set_data_texture(id, width, height, format, data(&t)?).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("update", lua.create_function(move |_, (id, t): (String, Table)| {
        super::reject_unknown_keys(&t, &["x", "y", "width", "height", "data"], "texture.update")?;
        let region = DataTextureRegion { x: dimension(&t, "x", 0)?, y: dimension(&t, "y", 0)?,
            width: dimension(&t, "width", 1)?, height: dimension(&t, "height", 1)? };
        world.borrow_mut().update_data_texture(&id, region, &data(&t)?).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("remove", lua.create_function(move |_, id: String| {
        world.borrow_mut().remove_data_texture(&id).map_err(mlua::Error::RuntimeError)
    })?)?;
    Ok(api)
}

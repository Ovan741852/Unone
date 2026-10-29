use super::{ApiState, Lua, Table, Value};
use std::rc::Rc;

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> mlua::Result<T> {
    let json = super::value::lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
    serde_json::from_value(json)
        .map_err(|error| mlua::Error::RuntimeError(format!("HEIGHTFIELD_INVALID: {error}")))
}

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let world = Rc::clone(&state.world);
    api.set("set", lua.create_function(move |_, (id, value): (String, Value)| {
        let definition = decode::<crate::HeightfieldDefinition>(value)?;
        world.borrow_mut().set_heightfield(id, definition).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("update", lua.create_function(move |_, (id, value): (String, Value)| {
        let patch = decode::<crate::HeightfieldPatch>(value)?;
        world.borrow_mut().update_heightfield(&id, patch).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("remove", lua.create_function(move |_, id: String| {
        world.borrow_mut().remove_heightfield(&id).map_err(mlua::Error::RuntimeError)
    })?)?;
    Ok(api)
}

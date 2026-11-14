//! `api.material`: add, replace or read the scene's surface materials
//! (ADR 0055, docs/materials.md). Materials are engine state, so replays and
//! every host shade the same surfaces.
use super::{ApiState, Lua, Table, Value};
use std::rc::Rc;

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let world = Rc::clone(&state.world);
    let view = Rc::clone(&state.pure_view);
    api.set("set", lua.create_function(move |_, (name, value): (String, Value)| {
        super::ensure_not_view(&view, "material.set")?;
        let invalid = |error: String| mlua::Error::RuntimeError(format!("MATERIAL_INVALID: {error}"));
        let json = super::value::lua_value_to_json(value).map_err(invalid)?;
        let material: crate::Material = serde_json::from_value(json).map_err(|error| invalid(error.to_string()))?;
        material.validate(&name).map_err(invalid)?;
        let mut world = world.borrow_mut();
        if !world.materials.contains_key(&name) && world.materials.len() >= crate::material::MAX_MATERIALS {
            return Err(invalid(format!("at most {} materials", crate::material::MAX_MATERIALS)));
        }
        world.materials.insert(name, material);
        Ok(())
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("get", lua.create_function(move |lua, name: String| match world.borrow().materials.get(&name) {
        None => Ok(Value::Nil),
        Some(material) => {
            super::value::observation_json_to_lua(lua, serde_json::to_value(material).map_err(mlua::Error::external)?)
        }
    })?)?;
    Ok(api)
}

use super::value::{json_to_lua, lua_value_to_json};
use super::{ApiState, Lua, Table, Value};
use crate::world::Vec2;
use std::rc::Rc;

pub(super) fn physics(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let physics = lua.create_table()?;
    let impulse_world = Rc::clone(&world);
    physics.set(
        "applyImpulse",
        lua.create_function(move |_, (id, impulse): (String, Table)| {
            let impulse = Vec2 {
                x: impulse.get("x")?,
                y: impulse.get("y")?,
            };
            impulse_world
                .borrow_mut()
                .apply_impulse(&id, impulse)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(physics)
}

pub(super) fn physics3d(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let physics3d_api = lua.create_table()?;
    let physics3d_world = Rc::clone(&world);
    physics3d_api.set(
        "sweepSphere",
        lua.create_function(move |lua, request: Table| {
            let mut value =
                lua_value_to_json(Value::Table(request)).map_err(mlua::Error::RuntimeError)?;
            if value["targets"].as_object().is_some_and(|v| v.is_empty()) {
                value["targets"] = serde_json::json!([]);
            }
            let request: crate::physics3d::SphereSweep =
                serde_json::from_value(value).map_err(mlua::Error::external)?;
            let result = crate::physics3d::sweep_sphere(&physics3d_world.borrow(), request)
                .map_err(mlua::Error::RuntimeError)?;
            json_to_lua(
                lua,
                serde_json::to_value(result).map_err(mlua::Error::external)?,
            )
        })?,
    )?;
    Ok(physics3d_api)
}

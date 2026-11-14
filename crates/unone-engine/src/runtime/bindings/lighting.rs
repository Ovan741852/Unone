//! `api.lighting`: read or replace the scene lighting (ADR 0054,
//! docs/lighting.md). Lighting is engine state, so replays and every host
//! light the scene the same way.
use super::{ApiState, Lua, Table, Value};
use std::rc::Rc;

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let world = Rc::clone(&state.world);
    let view = Rc::clone(&state.pure_view);
    api.set("set", lua.create_function(move |_, value: Value| {
        super::ensure_not_view(&view, "lighting.set")?;
        let invalid = |error: String| mlua::Error::RuntimeError(format!("LIGHTING_INVALID: {error}"));
        let lighting = match value {
            Value::Nil => None,
            value => {
                let json = super::value::lua_value_to_json(value).map_err(invalid)?;
                let lighting: crate::Lighting = serde_json::from_value(json).map_err(|error| invalid(error.to_string()))?;
                lighting.validate().map_err(invalid)?;
                Some(lighting)
            }
        };
        world.borrow_mut().lighting = lighting;
        Ok(())
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("get", lua.create_function(move |lua, ()| match &world.borrow().lighting {
        None => Ok(Value::Nil),
        Some(lighting) => {
            super::value::observation_json_to_lua(lua, serde_json::to_value(lighting).map_err(mlua::Error::external)?)
        }
    })?)?;
    Ok(api)
}

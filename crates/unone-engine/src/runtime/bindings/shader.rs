use super::{ApiState, Lua, Table, Value};
use std::rc::Rc;

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let world = Rc::clone(&state.world);
    api.set(
        "setMaterial",
        lua.create_function(move |_, (entity, material): (String, String)| {
            world
                .borrow_mut()
                .set_shader_material(&entity, &material)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set(
        "clearMaterial",
        lua.create_function(move |_, entity: String| {
            world
                .borrow_mut()
                .clear_shader_material(&entity)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set("setUniform", lua.create_function(move |_, (material, name, value): (String, String, Value)| {
        let json = super::value::lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
        let value = serde_json::from_value(json).map_err(|_| mlua::Error::RuntimeError("SHADER_UNIFORM_INVALID: expected a finite number or an array of 2, 3, or 4 finite numbers".into()))?;
        world.borrow_mut().set_shader_uniform(&material, &name, value).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("setTexture", lua.create_function(move |_, (material, sampler, source): (String, String, Value)| {
        // nil unbinds; otherwise {asset = "texture://..."} or {data = "<api.texture id>"}.
        let source = match source {
            Value::Nil => None,
            value => {
                let json = super::value::lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
                Some(serde_json::from_value(json).map_err(|_| mlua::Error::RuntimeError(
                    "SHADER_TEXTURE_INVALID: expected nil, {asset = id} or {data = id}".into()))?)
            }
        };
        world.borrow_mut().set_shader_texture(&material, &sampler, source).map_err(mlua::Error::RuntimeError)
    })?)?;
    Ok(api)
}

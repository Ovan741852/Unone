use super::{ApiState, Lua, Table, Value};
use std::rc::Rc;

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let clock = Rc::clone(&state.host_time);
    api.set("sample", lua.create_function(move |_, tag: Value| {
        let tag=match tag { Value::String(value) => value.to_str().ok().map(|s|s.to_owned()), _ => None };
        match tag { Some(tag) => clock.borrow_mut().sample(tag), None => clock.borrow_mut().invalid_tag() }
            .map_err(mlua::Error::RuntimeError)
    })?)?;
    Ok(api)
}

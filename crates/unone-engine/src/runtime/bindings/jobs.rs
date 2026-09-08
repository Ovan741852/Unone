use super::{ApiState, Lua, Table};
use std::rc::Rc;
pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "register",
        lua.create_function(move |_, (id, source): (String, String)| {
            jobs.borrow_mut()
                .register(id, source)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "submit",
        lua.create_function(move |_, (operation, input): (String, mlua::Buffer)| {
            if input.len() > super::super::jobs::MAX_BYTES {
                return Err(mlua::Error::RuntimeError("JOB_INPUT_TOO_LARGE".into()));
            }
            jobs.borrow_mut()
                .submit(operation, input.to_vec())
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "take",
        lua.create_function(move |lua, id: String| {
            let output = jobs
                .borrow_mut()
                .take(id)
                .map_err(mlua::Error::RuntimeError)?;
            lua.create_buffer(output)
        })?,
    )?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "cancel",
        lua.create_function(move |_, id: String| {
            jobs.borrow_mut()
                .cancel(id)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "reset",
        lua.create_function(move |_, ()| {
            jobs.borrow_mut().reset().map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(api)
}

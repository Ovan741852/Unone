use super::{ApiState, Lua, Table};
use std::rc::Rc;

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let world = Rc::clone(&state.world);
    api.set("setEscapeBehavior", lua.create_function(move |_, behavior: String| {
        world.borrow_mut().application.set_escape_behavior(&behavior)
            .map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("requestQuit", lua.create_function(move |_, ()| {
        world.borrow_mut().application.request_quit();
        Ok(())
    })?)?;
    Ok(api)
}

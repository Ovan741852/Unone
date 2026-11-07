use super::{ApiState, Lua, Table};
use std::rc::Rc;

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let world = Rc::clone(&state.world);
    api.set("open", lua.create_function(move |_, options: Table| {
        let room: String = options.get("room")?;
        let url: Option<String> = options.get("url")?;
        let mut world = world.borrow_mut();
        let frame = world.frame;
        world.network.open(frame, room, url).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("send", lua.create_function(move |_, data: String| {
        let mut world = world.borrow_mut();
        let frame = world.frame;
        world.network.send(frame, data).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("close", lua.create_function(move |_, ()| {
        let mut world = world.borrow_mut();
        let frame = world.frame;
        world.network.close(frame).map_err(mlua::Error::RuntimeError)
    })?)?;
    Ok(api)
}

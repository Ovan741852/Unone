use super::{ApiState,Lua,Table,Value};
use super::value::lua_value_to_json;
use crate::ui_cursor::UiCursor;
use std::rc::Rc;

pub(super) fn install(lua:&Lua,state:&ApiState,api:&Table)->mlua::Result<()> {
    let world=Rc::clone(&state.world);
    api.set("setCursor",lua.create_function(move|_,value:Value| {
        let json=lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
        let cursor=UiCursor::from_json(json).map_err(mlua::Error::RuntimeError)?;
        world.borrow_mut().ui_cursor=if cursor==UiCursor::Default {None}else{Some(cursor)};
        Ok(())
    })?)?;
    Ok(())
}

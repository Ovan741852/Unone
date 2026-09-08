use super::{ApiState, Lua, Table};

pub(super) fn bind(lua: &Lua, _state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    api.set("enabled", cfg!(feature = "preview-tools"))?;
    #[cfg(feature = "preview-tools")]
    {
        use super::super::preview::{DebugControl, DebugTab};
        use super::value::lua_value_to_json;
        use mlua::{Function, Value};
        use std::rc::Rc;
        let tools = Rc::downgrade(&_state.debug_tools);
        api.set(
            "registerTab",
            lua.create_function(move |_, value: Table| {
                let value =
                    lua_value_to_json(Value::Table(value)).map_err(mlua::Error::RuntimeError)?;
                let tab: DebugTab = serde_json::from_value(value).map_err(mlua::Error::external)?;
                let tools = tools
                    .upgrade()
                    .ok_or_else(|| mlua::Error::RuntimeError("DEBUG_SESSION_ENDED".into()))?;
                tools.borrow_mut().tab(tab)
            })?,
        )?;
        let tools = Rc::downgrade(&_state.debug_tools);
        api.set(
            "register",
            lua.create_function(move |_, (value, callback): (Table, Option<Function>)| {
                let value =
                    lua_value_to_json(Value::Table(value)).map_err(mlua::Error::RuntimeError)?;
                let control: DebugControl =
                    serde_json::from_value(value).map_err(mlua::Error::external)?;
                let tools = tools
                    .upgrade()
                    .ok_or_else(|| mlua::Error::RuntimeError("DEBUG_SESSION_ENDED".into()))?;
                tools.borrow_mut().register(control, callback)
            })?,
        )?;
        let tools = Rc::downgrade(&_state.debug_tools);
        api.set(
            "set",
            lua.create_function(move |_, (id, value): (String, Value)| {
                let tools = tools
                    .upgrade()
                    .ok_or_else(|| mlua::Error::RuntimeError("DEBUG_SESSION_ENDED".into()))?;
                tools.borrow_mut().set(&id, value)
            })?,
        )?;
    }
    #[cfg(not(feature = "preview-tools"))]
    for name in ["registerTab", "register", "set"] {
        api.set(name,lua.create_function(|_,_:mlua::MultiValue|Err::<(),_>(mlua::Error::RuntimeError("DEVELOPMENT_ONLY: guard tool registration with if api.debug.enabled then; export --development to use tools".into())))?)?;
    }
    Ok(api)
}

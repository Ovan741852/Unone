use super::{ApiState, Lua, Table};

pub(super) fn bind(lua: &Lua, _state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    #[cfg(not(feature = "preview-tools"))]
    api.set("enabled", false)?;
    #[cfg(feature = "preview-tools")]
    {
        use super::super::preview::{DebugControl, DebugTab};
        use super::value::lua_value_to_json;
        use mlua::{Function, Value};
        use std::{cell::Cell, rc::Rc};
        // Release players reject these calls, so a game that never reads
        // api.debug.enabled would pass every development run and fail only
        // after export. Reading the flag is the guard this build requires.
        let guarded = Rc::new(Cell::new(false));
        let meta = lua.create_table()?;
        let read = Rc::clone(&guarded);
        meta.set("__index", lua.create_function(move |_, (_, key): (Table, Value)| {
            let is_enabled = matches!(&key, Value::String(name) if name.as_bytes() == b"enabled");
            if is_enabled {
                read.set(true);
            }
            Ok(is_enabled.then_some(true))
        })?)?;
        api.set_metatable(Some(meta))?;
        let require_guard = move |guarded: &Rc<Cell<bool>>| -> mlua::Result<()> {
            if guarded.get() {
                return Ok(());
            }
            Err(mlua::Error::RuntimeError("DEBUG_UNGUARDED: wrap api.debug calls in `if api.debug.enabled then ... end`; production players reject them with DEVELOPMENT_ONLY".into()))
        };
        let tools = Rc::downgrade(&_state.debug_tools);
        let guard = Rc::clone(&guarded);
        api.set(
            "registerTab",
            lua.create_function(move |_, value: Table| {
                require_guard(&guard)?;
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
        let guard = Rc::clone(&guarded);
        api.set(
            "register",
            lua.create_function(move |_, (value, callback): (Table, Option<Function>)| {
                require_guard(&guard)?;
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
        let guard = guarded;
        api.set(
            "set",
            lua.create_function(move |_, (id, value): (String, Value)| {
                require_guard(&guard)?;
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

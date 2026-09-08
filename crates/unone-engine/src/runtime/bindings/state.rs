use super::super::TraceEvent;
use super::value::{json_to_lua, lua_value_to_json};
use super::{ApiState, Lua, Table, Value};
use crate::ui::UiTree;
use std::rc::Rc;

pub(super) fn observation(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let observations = Rc::clone(&state.observations);
    let observation_api = lua.create_table()?;
    let observation_state = Rc::clone(&observations);
    observation_api.set(
        "set",
        lua.create_function(move |_, (key, value): (String, Value)| {
            if key.trim().is_empty() {
                return Err(mlua::Error::RuntimeError(
                    "observation key must not be empty".to_string(),
                ));
            }
            let value = lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
            observation_state.borrow_mut().insert(key, value);
            Ok(())
        })?,
    )?;
    Ok(observation_api)
}

pub(super) fn ui(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let ui = Rc::clone(&state.ui);
    let viewport_aspect = Rc::clone(&state.viewport_aspect);
    let ui_api = lua.create_table()?;
    let ui_state = Rc::clone(&ui);
    let ui_aspect = Rc::clone(&viewport_aspect);
    ui_api.set(
        "setRoot",
        lua.create_function(move |_, value: Value| {
            let value = lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
            // Anchored nodes resolve against the host's real viewport, so the
            // same declaration lands in the same corner on any screen shape.
            // Name the vocabulary this build accepts. A host binary that is
            // older than the CLI fails here, and without this the message sends
            // the author to debug their game instead of their toolchain.
            let tree = UiTree::from_json_for_viewport(value, *ui_aspect.borrow()).map_err(
                |error| {
                    mlua::Error::RuntimeError(format!(
                        "{error} — this engine build accepts node placement as                          rect{{x,y,width,height}} or anchor+size (anchors: top_left, top,                          top_right, left, center, right, bottom_left, bottom, bottom_right);                          the design space is 0..100 on both axes with y pointing up"
                    ))
                },
            )?;
            *ui_state.borrow_mut() = Some(tree);
            Ok(())
        })?,
    )?;
    Ok(ui_api)
}

pub(super) fn save(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let save_payload = Rc::clone(&state.save_payload);
    let save_api = lua.create_table()?;
    let save_state = Rc::clone(&save_payload);
    save_api.set(
        "set",
        lua.create_function(move |_, value: Value| {
            let value = lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
            *save_state.borrow_mut() = Some(value);
            Ok(())
        })?,
    )?;
    let save_state = Rc::clone(&save_payload);
    save_api.set(
        "get",
        lua.create_function(move |lua, ()| {
            let Some(value) = save_state.borrow().clone() else {
                return Ok(Value::Nil);
            };
            json_to_lua(lua, value)
        })?,
    )?;
    Ok(save_api)
}

pub(super) fn log(lua: &Lua, state: &ApiState, api: &Table) -> mlua::Result<()> {
    let trace = Rc::clone(&state.trace);
    let world = Rc::clone(&state.world);
    let log_trace = Rc::clone(&trace);
    let log_world = Rc::clone(&world);
    api.set(
        "log",
        lua.create_function(move |_, message: String| {
            log_trace.borrow_mut().push(TraceEvent {
                frame: log_world.borrow().frame,
                event: "script_log".to_string(),
                details: serde_json::json!({"message": message}),
            });
            Ok(())
        })?,
    )?;
    Ok(())
}

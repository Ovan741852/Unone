use super::super::TraceEvent;
use super::value::{json_to_lua, lua_value_to_json, observation_value_to_json, observation_array, portable_value_to_json};
use super::{ApiState, Lua, Table, Value};
use crate::ui::UiTree;
use std::rc::Rc;

pub(super) fn observation(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let observations = Rc::clone(&state.observations);
    let observation_api = lua.create_table()?;
    observation_api.set("array", lua.create_function(observation_array)?)?;
    let array_observations = Rc::clone(&observations);
    observation_api.set(
        "setArray",
        lua.create_function(move |lua, (key, values): (String, Option<Table>)| {
            if key.trim().is_empty() {
                return Err(mlua::Error::RuntimeError(
                    "observation key must not be empty".to_string(),
                ));
            }
            let values = observation_array(lua, values)?;
            let value = observation_value_to_json(lua, Value::Table(values))
                .map_err(mlua::Error::RuntimeError)?;
            array_observations.borrow_mut().insert(key, value);
            Ok(())
        })?,
    )?;
    let observation_state = Rc::clone(&observations);
    observation_api.set(
        "set",
        lua.create_function(move |lua, (key, value): (String, Value)| {
            if key.trim().is_empty() {
                return Err(mlua::Error::RuntimeError(
                    "observation key must not be empty".to_string(),
                ));
            }
            let value = observation_value_to_json(lua, value).map_err(mlua::Error::RuntimeError)?;
            observation_state.borrow_mut().insert(key, value);
            Ok(())
        })?,
    )?;
    Ok(observation_api)
}

#[cfg(feature = "ui")]
pub(super) fn ui(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let ui = Rc::clone(&state.ui);
    let viewport_aspect = Rc::clone(&state.viewport_aspect);
    let ui_api = lua.create_table()?;
    let pure_depth=Rc::new(std::cell::Cell::new(0usize));
    let resources=lua.create_table()?;
    let define_world=Rc::clone(&state.world);
    let define_ui=Rc::clone(&ui);
    let define_pure=Rc::clone(&pure_depth);
    resources.set("define",lua.create_function(move |_,(id,value):(String,Value)| {
        if define_pure.get()>0 { return Err(mlua::Error::RuntimeError("UI_PURE_VIEW: image batch resources cannot be defined inside renderItem; define them in Game.start/update".into())); }
        let value=lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
        let definition=serde_json::from_value::<crate::UiImageBatchDefinition>(value)
            .map_err(|e|mlua::Error::RuntimeError(format!("UI_IMAGE_BATCH_DEFINITION: {e}")))?;
        define_world.borrow_mut().define_ui_image_batch(id,definition,define_ui.borrow_mut().as_mut())
            .map_err(mlua::Error::RuntimeError)
    })?)?;
    let remove_world=Rc::clone(&state.world);
    let remove_ui=Rc::clone(&ui);
    let remove_pure=Rc::clone(&pure_depth);
    resources.set("remove",lua.create_function(move |_,id:String| {
        if remove_pure.get()>0 { return Err(mlua::Error::RuntimeError("UI_PURE_VIEW: image batch resources cannot be removed inside renderItem".into())); }
        remove_world.borrow_mut().remove_ui_image_batch(&id,remove_ui.borrow().as_ref()).map_err(mlua::Error::RuntimeError)
    })?)?;
    ui_api.set("imageBatch",resources)?;
    super::ui_cursor::install(lua,state,&ui_api)?;
    let viewport_state = Rc::clone(&viewport_aspect);
    ui_api.set("getViewport", lua.create_function(move |lua, ()| {
        json_to_lua(lua, serde_json::json!({"aspect": *viewport_state.borrow()}))
    })?)?;
    let ui_state = Rc::clone(&ui);
    let inspect_state = Rc::clone(&ui);
    ui_api.set("inspect", lua.create_function(move |lua, ()| {
        json_to_lua(lua, serde_json::json!({"contract": crate::ui::ui_contract(), "usage": inspect_state.borrow().as_ref().map(UiTree::usage)}))
    })?)?;
    let ui_aspect = Rc::clone(&viewport_aspect);
    let resource_world=Rc::clone(&state.world);
    ui_api.set(
        "setRoot",
        lua.create_function(move |_, value: Value| {
            let value = lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
            // Anchored nodes resolve against the host's real viewport, so the
            // same declaration lands in the same corner on any screen shape.
            // Name the vocabulary this build accepts. A host binary that is
            // older than the CLI fails here, and without this the message sends
            // the author to debug their game instead of their toolchain.
            let tree = UiTree::from_json_for_viewport_with_resources(value, *ui_aspect.borrow(),&resource_world.borrow().ui_image_batches).map_err(
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
    let pure=lua.create_function(move |_,(callback,args):(mlua::Function,mlua::Variadic<Value>)| {
        let old=pure_depth.get();
        pure_depth.set(old+1);
        let result=callback.call::<mlua::MultiValue>(args);
        pure_depth.set(old);
        result
    })?;
    let helpers: Table = lua.load(include_str!("scroll.luau")).set_name("@engine/ui-scroll")
        .call((ui_api.get::<mlua::Function>("setRoot")?,pure))?;
    for name in ["scrollView", "virtualList", "virtualGrid", "setRoot"] {
        ui_api.set(name, helpers.get::<mlua::Function>(name)?)?;
    }
    ui_api.set("_materialize", helpers.get::<mlua::Function>("request")?)?;
    let package_info = crate::runtime_packages::ui_components_info();
    let declared = state.runtime_packages.get("@unone/ui")
        .is_some_and(|version| package_info["version"].as_str() == Some(version.as_str()));
    let components: Table = lua.load(crate::runtime_packages::ui_components_source())
        .set_name("@packages/unone-ui")
        .call((json_to_lua(lua, package_info)?, declared,
            helpers.get::<mlua::Function>("isManagedNode")?, helpers))?;
    ui_api.set("components", components)?;
    Ok(ui_api)
}

#[cfg(feature = "save")]
pub(super) fn save(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let save_payload = Rc::clone(&state.save_payload);
    let save_api = lua.create_table()?;
    let save_state = Rc::clone(&save_payload);
    save_api.set(
        "set",
        lua.create_function(move |lua, value: Value| {
            let value = portable_value_to_json(lua, value).map_err(mlua::Error::RuntimeError)?;
            save_state.borrow_mut().replace(Some(value));
            Ok(())
        })?,
    )?;
    let save_state = Rc::clone(&save_payload);
    save_api.set(
        "get",
        lua.create_function(move |lua, ()| {
            let Some(value) = save_state.borrow().owned() else {
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
            if message.len() > 8192 {
                return Err(mlua::Error::RuntimeError(
                    "LOG_MESSAGE_LIMIT: maximum 8192 UTF-8 bytes".into(),
                ));
            }
            let mut trace = log_trace.borrow_mut();
            if trace.len() >= 512 {
                trace.remove(0);
            }
            trace.push(TraceEvent {
                frame: log_world.borrow().frame,
                event: "script_log".to_string(),
                details: serde_json::json!({"message": message}),
            });
            Ok(())
        })?,
    )?;
    Ok(())
}

use super::{ApiState, Lua, Table};
use std::rc::Rc;

pub(super) fn input(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let input = Rc::clone(&state.input);
    let input_api = lua.create_table()?;
    let physical_input=Rc::clone(&input);
    input_api.set("getPhysicalBatch",lua.create_function(move |lua,():()| {
        match &physical_input.borrow().physical.active {
            // Physical v1 validates metadata as safe binary64 integers, including
            // monotonic microseconds past i32::MAX. Keep saves on their own boundary.
            Some(batch)=>super::value::observation_json_to_lua(lua,serde_json::to_value(batch).map_err(mlua::Error::external)?),
            None=>Ok(mlua::Value::Nil),
        }
    })?)?;
    let text_input=Rc::clone(&input);
    input_api.set("getTextInputInteraction",lua.create_function(move |lua,id:String| {
        match text_input.borrow().ui_text_inputs.get(&id) {
            Some(event)=>super::value::observation_json_to_lua(lua,serde_json::to_value(event).map_err(mlua::Error::external)?),
            None=>Ok(mlua::Value::Nil),
        }
    })?)?;
    let slider_input = Rc::clone(&input);
    input_api.set("getSliderInteraction", lua.create_function(move |lua, id: String| {
        let state = slider_input.borrow();
        match state.ui_sliders.get(&id) {
            Some(event) => super::value::json_to_lua(lua, serde_json::to_value(event).map_err(mlua::Error::external)?),
            None => Ok(mlua::Value::Nil),
        }
    })?)?;
    let input_state = Rc::clone(&input);
    input_api.set(
        "isDown",
        lua.create_function(move |_, action: String| {
            Ok(input_state
                .borrow()
                .down
                .get(&action)
                .copied()
                .unwrap_or(false))
        })?,
    )?;

    let pressed_input = Rc::clone(&input);
    input_api.set(
        "wasPressed",
        lua.create_function(move |_, action: String| Ok(pressed_input.borrow().pressed.contains(&action)))?,
    )?;
    let any_pressed_input = Rc::clone(&input);
    input_api.set(
        "hasPressedActions",
        lua.create_function(move |_, arguments: mlua::MultiValue| {
            if !arguments.is_empty() {
                return Err(mlua::Error::RuntimeError(
                    "INPUT_ARGUMENTS_INVALID: input.hasPressedActions takes no arguments or options".into(),
                ));
            }
            Ok(!any_pressed_input.borrow().pressed.is_empty())
        })?,
    )?;
    let released_input = Rc::clone(&input);
    input_api.set(
        "wasReleased",
        lua.create_function(move |_, action: String| Ok(released_input.borrow().released.contains(&action)))?,
    )?;

    let pointer_position_input = Rc::clone(&input);
    input_api.set(
        "getPointerPosition",
        lua.create_function(move |lua, _: ()| {
            let position = pointer_position_input.borrow().pointer.position;
            let table = lua.create_table()?;
            table.set("x", position.x)?;
            table.set("y", position.y)?;
            Ok(table)
        })?,
    )?;

    let screen_pointer_position_input = Rc::clone(&input);
    input_api.set(
        "getScreenPointerPosition",
        lua.create_function(move |lua, _: ()| {
            let position = screen_pointer_position_input
                .borrow()
                .pointer
                .screen_position;
            let table = lua.create_table()?;
            table.set("x", position.x)?;
            table.set("y", position.y)?;
            Ok(table)
        })?,
    )?;

    let pointer_down_input = Rc::clone(&input);
    input_api.set(
        "isPointerDown",
        lua.create_function(move |_, _: ()| Ok(pointer_down_input.borrow().pointer.down))?,
    )?;
    Ok(input_api)
}

#[cfg(feature = "random")]
pub(super) fn random(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let random = Rc::clone(&state.random);
    let random_api = lua.create_table()?;
    let next_float_random = Rc::clone(&random);
    let view = Rc::clone(&state.pure_view);
    random_api.set(
        "nextFloat",
        lua.create_function(move |_, _: ()| {
            super::ensure_not_view(&view, "random.nextFloat")?;
            Ok(next_float_random.borrow_mut().next_float())
        })?,
    )?;

    let next_int_random = Rc::clone(&random);
    let view = Rc::clone(&state.pure_view);
    random_api.set(
        "nextInt",
        lua.create_function(move |_, (min, max): (i64, i64)| {
            super::ensure_not_view(&view, "random.nextInt")?;
            next_int_random
                .borrow_mut()
                .next_int(min, max)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(random_api)
}

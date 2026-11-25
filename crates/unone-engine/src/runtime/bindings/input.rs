use super::{ApiState, Lua, Table};
use std::rc::Rc;

/// Radial stick deadzone for api.input.getGamepad (docs/input-gamepad.md).
const GAMEPAD_DEADZONE: f64 = 0.15;

pub(super) fn input(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let input = Rc::clone(&state.input);
    let input_api = lua.create_table()?;
    let package_info = crate::runtime_packages::gestures_info();
    let declared = state.runtime_packages.get("@unone/gestures")
        .is_some_and(|version| package_info["version"].as_str() == Some(version.as_str()));
    let view = Rc::clone(&state.pure_view);
    let guard = lua.create_function(move |_, ()| {
        super::ensure_not_view(&view, "input.gestures")
    })?;
    let gestures: Table = lua.load(crate::runtime_packages::gestures_source())
        .set_name("@packages/unone-gestures")
        .call((super::value::json_to_lua(lua, package_info)?, declared, guard))?;
    input_api.set("gestures", gestures)?;
    let physical_input=Rc::clone(&input);
    let physical_world=Rc::clone(&state.world);
    input_api.set("getPhysicalBatch",lua.create_function(move |lua,():()| {
        match &physical_input.borrow().physical.active {
            // Physical v1 validates metadata as safe binary64 integers, including
            // monotonic microseconds past i32::MAX. Keep saves on their own boundary.
            // A game in design pixels (display.pixels) gets its points and viewports in them.
            Some(batch)=>{
                let mut value=serde_json::to_value(batch).map_err(mlua::Error::external)?;
                if let Some(design)=physical_world.borrow().projected_design {crate::projected::design_physical_batch(&mut value,design);}
                super::value::observation_json_to_lua(lua,value)
            }
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
    // Host data (docs/host-data.md): the JSON value a custom renderer sent on this channel, as a
    // table, in the tick that consumed it; nil on other ticks. Numbers keep binary64 like observations.
    let host_input=Rc::clone(&input);
    input_api.set("getHostData",lua.create_function(move |lua,channel:String| {
        let value=host_input.borrow().host_data.get(&channel).cloned();
        match value {
            Some(value)=>super::value::observation_json_to_lua(lua,(*value).clone()),
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
            let input = input_state.borrow();
            #[cfg(feature = "dev-tools")]
            input.note_action_read(&action);
            Ok(input.down.get(&action).copied().unwrap_or(false))
        })?,
    )?;

    let pressed_input = Rc::clone(&input);
    input_api.set(
        "wasPressed",
        lua.create_function(move |_, action: String| {
            let input = pressed_input.borrow();
            #[cfg(feature = "dev-tools")]
            input.note_action_read(&action);
            Ok(input.pressed.contains(&action))
        })?,
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
        lua.create_function(move |_, action: String| {
            let input = released_input.borrow();
            #[cfg(feature = "dev-tools")]
            input.note_action_read(&action);
            Ok(input.released.contains(&action))
        })?,
    )?;

    // Gamepads (docs/input-gamepad.md): a radial deadzone keeps resting sticks
    // at zero and rescales the rest to reach 1. Triggers are unchanged.
    let gamepad_table = |lua: &Lua, pad: &crate::project::GamepadInput| -> mlua::Result<Table> {
        let stick = |x: f64, y: f64| -> mlua::Result<Table> {
            let length = (x * x + y * y).sqrt();
            let scale = if length <= GAMEPAD_DEADZONE { 0. } else { ((length - GAMEPAD_DEADZONE) / (1. - GAMEPAD_DEADZONE)).min(1.) / length };
            let table = lua.create_table()?;
            table.set("x", x * scale)?;
            table.set("y", y * scale)?;
            Ok(table)
        };
        let table = lua.create_table()?;
        table.set("slot", pad.slot)?;
        table.set("leftStick", stick(pad.left_x, pad.left_y)?)?;
        table.set("rightStick", stick(pad.right_x, pad.right_y)?)?;
        table.set("leftTrigger", pad.left_trigger)?;
        table.set("rightTrigger", pad.right_trigger)?;
        Ok(table)
    };
    let gamepad_input = Rc::clone(&input);
    input_api.set("getGamepad", lua.create_function(move |lua, slot: Option<u8>| {
        let input = gamepad_input.borrow();
        let pad = match slot {
            Some(slot) if !(1..=crate::project::GAMEPAD_SLOTS).contains(&slot) => {
                return Err(mlua::Error::RuntimeError(format!("INPUT_GAMEPAD_SLOT_INVALID: slot must be 1 to {}, got {slot}", crate::project::GAMEPAD_SLOTS)));
            }
            Some(slot) => input.gamepads.iter().find(|pad| pad.slot == slot),
            None => input.gamepads.iter().min_by_key(|pad| pad.slot),
        };
        pad.map(|pad| gamepad_table(lua, pad).map(mlua::Value::Table)).unwrap_or(Ok(mlua::Value::Nil))
    })?)?;
    let gamepads_input = Rc::clone(&input);
    input_api.set("getGamepads", lua.create_function(move |lua, ()| {
        let input = gamepads_input.borrow();
        let mut pads: Vec<_> = input.gamepads.iter().collect();
        pads.sort_by_key(|pad| pad.slot);
        let list = lua.create_table()?;
        for pad in pads {
            list.push(gamepad_table(lua, pad)?)?;
        }
        Ok(list)
    })?)?;

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

use super::{ApiState, Lua, Table};
use std::rc::Rc;

pub(super) fn input(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let input = Rc::clone(&state.input);
    let input_api = lua.create_table()?;
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

pub(super) fn random(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let random = Rc::clone(&state.random);
    let random_api = lua.create_table()?;
    let next_float_random = Rc::clone(&random);
    random_api.set(
        "nextFloat",
        lua.create_function(move |_, _: ()| Ok(next_float_random.borrow_mut().next_float()))?,
    )?;

    let next_int_random = Rc::clone(&random);
    random_api.set(
        "nextInt",
        lua.create_function(move |_, (min, max): (i64, i64)| {
            next_int_random
                .borrow_mut()
                .next_int(min, max)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(random_api)
}

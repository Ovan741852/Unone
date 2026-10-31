//! `api.profile`: named spans and counters for finding where a game's own time
//! goes. Measurements stay with the host (`game perf`, `run --json`, session
//! `perf`); nothing is returned to the game, so profiling cannot change a run,
//! its observations or its replay. Works in every build, so instrumented code
//! ships unchanged.
use super::{ApiState, Lua, Table};
use mlua::{Function, MultiValue};
use std::{rc::Rc, time::Instant};

fn valid_name(name: &str) -> mlua::Result<()> {
    if (1..=64).contains(&name.len()) && name.chars().all(|c| !c.is_control()) { return Ok(()); }
    Err(mlua::Error::RuntimeError(format!("PROFILE_NAME_INVALID: '{name}' must be 1-64 printable characters")))
}

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let profile = Rc::clone(&state.script_profile);
    api.set("span", lua.create_function(move |lua, (name, work): (String, Function)| -> mlua::Result<MultiValue> {
        valid_name(&name)?;
        let heap = lua.used_memory();
        let started = Instant::now();
        let result = work.call::<MultiValue>(());
        let elapsed = started.elapsed();
        profile.borrow_mut().span(&name, elapsed, lua.used_memory().saturating_sub(heap));
        result
    })?)?;
    let profile = Rc::clone(&state.script_profile);
    api.set("count", lua.create_function(move |_, (name, amount): (String, Option<f64>)| {
        valid_name(&name)?;
        let amount = amount.unwrap_or(1.0);
        if !amount.is_finite() {
            return Err(mlua::Error::RuntimeError(format!("PROFILE_COUNT_INVALID: '{name}' must be counted by a finite number")));
        }
        profile.borrow_mut().count(&name, amount);
        Ok(())
    })?)?;
    Ok(api)
}

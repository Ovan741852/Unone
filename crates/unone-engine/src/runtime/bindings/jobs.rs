use super::{ApiState, Lua, Table};
use std::rc::Rc;
pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "register",
        lua.create_function(move |_, (id, source): (String, String)| {
            jobs.borrow_mut()
                .register(id, source)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "submit",
        lua.create_function(move |_, (operation, input): (String, mlua::Buffer)| {
            if input.len() > super::super::jobs::MAX_BYTES {
                return Err(mlua::Error::RuntimeError("JOB_INPUT_TOO_LARGE".into()));
            }
            jobs.borrow_mut()
                .submit(operation, input.to_vec())
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "take",
        lua.create_function(move |lua, id: String| {
            let output = jobs
                .borrow_mut()
                .take(id)
                .map_err(mlua::Error::RuntimeError)?;
            lua.create_buffer(output)
        })?,
    )?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "cancel",
        lua.create_function(move |_, id: String| {
            jobs.borrow_mut()
                .cancel(id)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "reset",
        lua.create_function(move |_, ()| {
            jobs.borrow_mut().reset().map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let jobs = Rc::clone(&state.jobs);
    api.set(
        "schedule",
        lua.create_function(
            move |lua,
                  (operation, options, prepare, apply): (
                String,
                Table,
                mlua::Function,
                mlua::Function,
            )| {
                for pair in options.clone().pairs::<String, mlua::Value>() {
                    let (key, _) = pair?;
                    if key != "every_ticks" && key != "times" {
                        return Err(mlua::Error::RuntimeError(format!(
                            "JOB_SCHEDULE_UNKNOWN_FIELD: {key}"
                        )));
                    }
                }
                let number = |key: &str, required: bool| -> mlua::Result<Option<u64>> {
                    let value = options.raw_get::<mlua::Value>(key)?;
                    if value.is_nil() && !required {
                        return Ok(None);
                    }
                    let n = match value {
                        mlua::Value::Integer(n) => n as f64,
                        mlua::Value::Number(n) => n,
                        _ => f64::NAN,
                    };
                    if !n.is_finite() || n < 1. || n > 1_000_000_000. || n.fract() != 0. {
                        return Err(mlua::Error::RuntimeError(format!(
                            "JOB_SCHEDULE_OPTIONS_INVALID: {key}"
                        )));
                    }
                    Ok(Some(n as u64))
                };
                let options = super::super::jobs::ScheduleOptions {
                    every_ticks: number("every_ticks", true)?.unwrap(),
                    times: number("times", false)?,
                };
                jobs.borrow_mut()
                    .schedule(
                        operation,
                        options,
                        Rc::new(lua.create_registry_value(prepare)?),
                        Rc::new(lua.create_registry_value(apply)?),
                    )
                    .map_err(mlua::Error::RuntimeError)
            },
        )?,
    )?;
    Ok(api)
}

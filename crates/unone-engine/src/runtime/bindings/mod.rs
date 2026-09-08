//! Luau API assembly. Namespace bindings own marshaling; subsystems own behavior.
use super::ApiState;
use crate::systems::SystemSettings;
use mlua::{Lua, Table, Value};
mod audio;
mod camera;
mod entity;
mod input;
mod physics;
mod presentation;
mod state;
mod value;

pub(super) fn build_api(
    lua: &Lua,
    state: &ApiState,
    systems: &SystemSettings,
) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    state::log(lua, state, &api)?;
    api.set("entity", entity::entity(lua, state)?)?;
    api.set("input", input::input(lua, state)?)?;
    api.set(
        "random",
        disable_if_off(lua, systems, "random", input::random(lua, state)?)?,
    )?;
    api.set(
        "physics",
        disable_if_off(lua, systems, "physics2d", physics::physics(lua, state)?)?,
    )?;
    api.set(
        "physics3d",
        disable_if_off(lua, systems, "physics3d", physics::physics3d(lua, state)?)?,
    )?;
    api.set(
        "camera",
        disable_if_off(lua, systems, "camera2d", camera::camera(lua, state)?)?,
    )?;
    api.set(
        "camera3d",
        disable_if_off(lua, systems, "camera3d", camera::camera3d(lua, state)?)?,
    )?;
    api.set("observation", state::observation(lua, state)?)?;
    api.set(
        "ui",
        disable_if_off(lua, systems, "ui", state::ui(lua, state)?)?,
    )?;
    api.set(
        "save",
        disable_if_off(lua, systems, "save", state::save(lua, state)?)?,
    )?;
    api.set(
        "animation",
        disable_if_off(lua, systems, "spine", presentation::animation(lua, state)?)?,
    )?;
    api.set(
        "effect",
        disable_if_off(lua, systems, "effekseer", presentation::effect(lua, state)?)?,
    )?;
    api.set(
        "particle",
        disable_if_off(
            lua,
            systems,
            "particle",
            presentation::particle(lua, state)?,
        )?,
    )?;
    api.set(
        "audio",
        disable_if_off(lua, systems, "audio", audio::audio(lua, state)?)?,
    )?;
    Ok(api)
}

/// Keep a disabled system's API shape, but make every call say why it failed.
///
/// Removing the table would surface as "attempt to index nil", which tells a
/// game author nothing. A disabled call names the system and the switch.
fn disable_if_off(
    lua: &Lua,
    systems: &SystemSettings,
    system: &'static str,
    table: Table,
) -> mlua::Result<Table> {
    if systems.is_enabled(system) {
        return Ok(table);
    }
    let disabled = lua.create_table()?;
    let names: Vec<String> = table
        .pairs::<String, Value>()
        .filter_map(|pair| pair.ok().map(|(name, _)| name))
        .collect();
    for name in names {
        let message = format!(
            "SYSTEM_DISABLED: system '{system}' is disabled in project.unone.json, so api.{name} is unavailable. To use it, run game systems set --id {system} --enabled true."
        );
        disabled.set(
            name,
            lua.create_function(move |_, _: mlua::MultiValue| {
                Err::<(), _>(mlua::Error::RuntimeError(message.clone()))
            })?,
        )?;
    }
    Ok(disabled)
}

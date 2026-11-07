//! Luau API assembly. Namespace bindings own marshaling; subsystems own behavior.
use super::ApiState;
use crate::systems::SystemSettings;
use mlua::{Lua, Table, Value};
mod application;
mod assets;
mod render;
mod audio;
mod bytes;
mod camera;
mod debug;
mod profile;
mod entity;
mod input;
mod heightfield;
mod geometry3d;
mod texture;
mod host_time;
mod projected;
mod projected_frame;
#[cfg(feature = "jobs")]
mod jobs;
mod physics;
mod presentation;
mod state;
mod ui_cursor;
mod shader;
mod spatial;
mod sprite;
pub(super) mod value;
mod network;

pub(super) fn build_api(
    lua: &Lua,
    state: &ApiState,
    systems: &SystemSettings,
) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    api.set("bytes", bytes::bind(lua)?)?;
    api.set("sprite", sprite::bind(lua, state)?)?;
    api.set("assets", assets::bind(lua, state)?)?;
    api.set("render", render::bind(lua, state)?)?;
    api.set("hostTime", host_time::bind(lua, state)?)?;
    api.set("application", application::bind(lua, state)?)?;
    api.set("network", network::bind(lua, state)?)?;
    api.set("heightfield", heightfield::bind(lua, state)?)?;
    api.set("geometry3d", geometry3d::bind(lua, state)?)?;
    api.set("texture", texture::bind(lua, state)?)?;
    api.set("projected", projected::bind(lua, state)?)?;
    api.set("shader", shader::bind(lua, state)?)?;
    api.set("spatial", spatial::bind(lua, state)?)?;
    #[cfg(feature = "jobs")]
    api.set("jobs",disable_if_off(lua,systems,"jobs",jobs::bind(lua,state)?)?)?;
    #[cfg(not(feature = "jobs"))]
    api.set("jobs",unavailable(lua,"jobs")?)?;
    api.set("instances3d", presentation::instances3d(lua, state)?)?;
    api.set("debug", debug::bind(lua, state)?)?;
    api.set("profile", profile::bind(lua, state)?)?;
    state::log(lua, state, &api)?;
    api.set("entity", entity::entity(lua, state)?)?;
    api.set("input", input::input(lua, state)?)?;
    api.set("observation", state::observation(lua, state)?)?;
    #[cfg(feature = "random")]
    api.set(
        "random",
        disable_if_off(lua, systems, "random", input::random(lua, state)?)?,
    )?;
    #[cfg(not(feature = "random"))]
    api.set("random", unavailable(lua, "random")?)?;
    #[cfg(feature = "physics2d")]
    api.set(
        "physics",
        disable_if_off(lua, systems, "physics2d", physics::physics(lua, state)?)?,
    )?;
    #[cfg(not(feature = "physics2d"))]
    api.set("physics", unavailable(lua, "physics2d")?)?;
    #[cfg(feature = "physics3d")]
    api.set(
        "physics3d",
        disable_if_off(lua, systems, "physics3d", physics::physics3d(lua, state)?)?,
    )?;
    #[cfg(not(feature = "physics3d"))]
    api.set("physics3d", unavailable(lua, "physics3d")?)?;
    #[cfg(any(feature = "camera2d", feature = "camera3d"))]
    api.set(
        "camera",
        camera::camera(lua, state, systems)?,
    )?;
    #[cfg(not(any(feature = "camera2d", feature = "camera3d")))]
    api.set("camera", unavailable(lua, "camera")?)?;
    #[cfg(feature = "camera3d")]
    api.set(
        "camera3d",
        disable_if_off(lua, systems, "camera3d", camera::camera3d(lua, state)?)?,
    )?;
    #[cfg(not(feature = "camera3d"))]
    api.set("camera3d", unavailable(lua, "camera3d")?)?;
    #[cfg(feature = "ui")]
    api.set(
        "ui",
        disable_if_off(lua, systems, "ui", state::ui(lua, state)?)?,
    )?;
    #[cfg(not(feature = "ui"))]
    api.set("ui", unavailable(lua, "ui")?)?;
    #[cfg(feature = "save")]
    api.set(
        "save",
        disable_if_off(lua, systems, "save", state::save(lua, state)?)?,
    )?;
    #[cfg(not(feature = "save"))]
    api.set("save", unavailable(lua, "save")?)?;
    #[cfg(feature = "spine")]
    api.set(
        "animation",
        disable_if_off(lua, systems, "spine", presentation::animation(lua, state)?)?,
    )?;
    #[cfg(not(feature = "spine"))]
    api.set("animation", unavailable(lua, "spine")?)?;
    #[cfg(feature = "effekseer")]
    api.set(
        "effect",
        disable_if_off(lua, systems, "effekseer", presentation::effect(lua, state)?)?,
    )?;
    #[cfg(not(feature = "effekseer"))]
    api.set("effect", unavailable(lua, "effekseer")?)?;
    #[cfg(feature = "particle")]
    api.set(
        "particle",
        disable_if_off(
            lua,
            systems,
            "particle",
            presentation::particle(lua, state)?,
        )?,
    )?;
    #[cfg(not(feature = "particle"))]
    api.set("particle", unavailable(lua, "particle")?)?;
    #[cfg(feature = "audio")]
    api.set(
        "audio",
        disable_if_off(lua, systems, "audio", audio::audio(lua, state)?)?,
    )?;
    #[cfg(not(feature = "audio"))]
    api.set("audio", unavailable(lua, "audio")?)?;
    name_unknown_members(lua, &api, "api".to_string())?;
    Ok(api)
}

/// Make reading a member the API does not have name it.
///
/// A plain table answers nil, which surfaces as "attempt to call a nil value"
/// with no name at all, for the mistake AI authors make most: a method guessed
/// from another engine. Existing members are read directly, so this costs
/// nothing until the read that was about to fail anyway. Tables that already
/// answer unknown reads (api.debug, compiled-out systems) or are frozen keep
/// what they have.
fn name_unknown_members(lua: &Lua, table: &Table, path: String) -> mlua::Result<()> {
    let children: Vec<(String, Table)> = table
        .pairs::<Value, Value>()
        .filter_map(|pair| match pair {
            Ok((Value::String(name), Value::Table(child))) => Some(name.to_str().map(|name| (name.to_string(), child))),
            Ok(_) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<mlua::Result<_>>()?;
    for (name, child) in children {
        if child.metatable().is_none() && !child.is_readonly() {
            name_unknown_members(lua, &child, format!("{path}.{name}"))?;
        }
    }
    let meta = lua.create_table()?;
    meta.set("__index", lua.create_function(move |_, (table, key): (Table, Value)| {
        let Value::String(name) = key else { return Ok(Value::Nil) };
        let name = name.to_str()?.to_string();
        Err(mlua::Error::RuntimeError(unknown_member_message(&path, &name, &table)?))
    })?)?;
    table.set_metatable(Some(meta))
}

fn unknown_member_message(path: &str, name: &str, table: &Table) -> mlua::Result<String> {
    let mut members: Vec<String> = Vec::new();
    for pair in table.pairs::<Value, Value>() {
        if let (Value::String(member), _) = pair? {
            members.push(member.to_str()?.to_string());
        }
    }
    members.sort();
    let closest = crate::suggest::closest(name, members.iter().map(String::as_str), 3);
    let hint = if closest.is_empty() {
        let shown: Vec<&str> = members.iter().map(String::as_str).take(12).collect();
        format!("{path} has: {}", shown.join(", "))
    } else {
        let shown: Vec<String> = closest.iter().map(|member| format!("{path}.{member}")).collect();
        format!("Closest: {}", shown.join(", "))
    };
    Ok(format!(
        "API_UNKNOWN_MEMBER: {path}.{name} does not exist. {hint}. Find the right API with: game api search \"{}\"",
        crate::suggest::words(name).join(" ")
    ))
}

/// Reject option-table keys a binding does not read.
///
/// Hand-parsed Luau option tables otherwise ignore typos (`{loop=true}` for
/// `looping`, snake_case copies of camelCase fields) and silently use defaults,
/// unlike serde DTOs, which deny unknown fields.
pub(super) fn reject_unknown_keys(table: &Table, allowed: &[&str], context: &str) -> mlua::Result<()> {
    for pair in table.pairs::<Value, Value>() {
        let (key, _) = pair?;
        let found = match &key {
            Value::String(name) => {
                let name = name.to_str()?;
                if allowed.contains(&&*name) {
                    continue;
                }
                format!("'{}'", &*name)
            }
            other => format!("a {} key", other.type_name()),
        };
        return Err(mlua::Error::RuntimeError(format!(
            "OPTION_UNKNOWN_FIELD: {context} does not accept {found}; allowed fields: {}",
            allowed.join(", ")
        )));
    }
    Ok(())
}

/// Refuse a simulation mutation from a host-driven UI view callback.
///
/// Hosts run virtual renderItem between fixed ticks (Web scroll requests), so
/// RNG draws, observations, saves or world edits there would happen on one host
/// and not in replay or on another host.
pub(super) fn ensure_not_view(depth: &std::cell::Cell<usize>, name: &str) -> mlua::Result<()> {
    if depth.get() == 0 {
        return Ok(());
    }
    Err(mlua::Error::RuntimeError(format!(
        "UI_PURE_VIEW: api.{name} changes simulation state and cannot run inside renderItem; do it in Game.update and pass the result to the view"
    )))
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
    let entries: Vec<(String, Value)> = table
        .pairs::<String, Value>()
        .collect::<mlua::Result<_>>()?;
    for (name, value) in entries {
        if let Value::Table(child) = value {
            disabled.set(name, disable_if_off(lua, systems, system, child)?)?;
            continue;
        }
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

// No backend or binding closures are constructed for a compiled-out capability.
#[allow(dead_code)] // Used only by feature-selected builds.
fn unavailable(lua: &Lua, system: &'static str) -> mlua::Result<Table> {
    let table = lua.create_table()?;
    let meta = lua.create_table()?;
    meta.set("__index", lua.create_function(move |_, _: mlua::MultiValue| {
        Err::<(), _>(mlua::Error::RuntimeError(format!(
            "SYSTEM_NOT_COMPILED: system '{system}' was excluded from this runtime. Enable it in project.unone.json and rebuild the player for that project."
        )))
    })?)?;
    table.set_metatable(Some(meta))?;
    Ok(table)
}

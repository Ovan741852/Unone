use super::{ApiState, Lua, Table};
use crate::world::{Vec2, Vec3};
use std::rc::Rc;

pub(super) fn animation(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let animation_api = lua.create_table()?;
    let play_world = Rc::clone(&world);
    animation_api.set(
        "play",
        lua.create_function(
            move |_, (id, name, options): (String, String, Option<Table>)| {
                let (asset, looping, speed) = match options {
                    Some(options) => (
                        options.get::<Option<String>>("asset")?,
                        options.get::<Option<bool>>("loop")?,
                        options.get::<Option<f64>>("speed")?,
                    ),
                    None => (None, None, None),
                };
                play_world
                    .borrow_mut()
                    .play_animation(&id, &name, asset, looping, speed)
                    .map_err(mlua::Error::RuntimeError)
            },
        )?,
    )?;
    let stop_animation_world = Rc::clone(&world);
    animation_api.set(
        "stop",
        lua.create_function(move |_, id: String| {
            stop_animation_world
                .borrow_mut()
                .stop_animation(&id)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(animation_api)
}

pub(super) fn particle(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let particle_api = lua.create_table()?;
    let particle_world = Rc::clone(&world);
    particle_api.set(
        "play",
        lua.create_function(
            move |_, (effect, position, seed): (String, Table, Option<u64>)| {
                let position = Vec3 {
                    x: position.get("x")?,
                    y: position.get("y")?,
                    z: position.get("z")?,
                };
                let mut world = particle_world.borrow_mut();
                let frame = world.frame;
                world
                    .particles
                    .play(&effect, position, seed.unwrap_or(0), frame)
                    .map_err(mlua::Error::external)
            },
        )?,
    )?;
    let particle_world = Rc::clone(&world);
    particle_api.set(
        "stop",
        lua.create_function(move |_, handle: String| {
            Ok(particle_world.borrow_mut().particles.stop(&handle))
        })?,
    )?;
    Ok(particle_api)
}

pub(super) fn effect(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let effect_api = lua.create_table()?;
    let spawn_world = Rc::clone(&world);
    effect_api.set(
        "spawn",
        lua.create_function(move |_, (asset, options): (String, Option<Table>)| {
            let (position, scale, rotation) = match options {
                Some(options) => (
                    Vec2 {
                        x: options.get::<Option<f64>>("x")?.unwrap_or(0.0),
                        y: options.get::<Option<f64>>("y")?.unwrap_or(0.0),
                    },
                    options.get::<Option<f64>>("scale")?,
                    options.get::<Option<f64>>("rotation")?,
                ),
                None => (Vec2::default(), None, None),
            };
            spawn_world
                .borrow_mut()
                .spawn_effect(&asset, position, scale, rotation)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let stop_effect_world = Rc::clone(&world);
    effect_api.set(
        "stop",
        lua.create_function(move |_, handle: String| {
            stop_effect_world
                .borrow_mut()
                .stop_effect(&handle)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(effect_api)
}

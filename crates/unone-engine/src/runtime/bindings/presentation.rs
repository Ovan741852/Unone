use super::{ApiState, Lua, Table};
use crate::world::{Vec2, Vec3};
use std::rc::Rc;

#[cfg(feature = "spine")]
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

#[cfg(feature = "particle")]
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
        "move",
        lua.create_function(move |_, (handle, position): (String, Table)| {
            let position = Vec3 {
                x: position.get("x")?,
                y: position.get("y")?,
                z: position.get("z")?,
            };
            let mut world = particle_world.borrow_mut();
            let frame = world.frame;
            world.particles.move_to(&handle, position, frame).map_err(mlua::Error::external)
        })?,
    )?;
    let particle_world = Rc::clone(&world);
    particle_api.set(
        "finish",
        lua.create_function(move |_, handle: String| {
            let mut world = particle_world.borrow_mut();
            let frame = world.frame;
            Ok(world.particles.finish(&handle, frame))
        })?,
    )?;
    let particle_world = Rc::clone(&world);
    particle_api.set(
        "stop",
        lua.create_function(move |_, handle: String| {
            Ok(particle_world.borrow_mut().particles.stop(&handle))
        })?,
    )?;
    let particle_world = Rc::clone(&world);
    particle_api.set(
        "play_batch",
        lua.create_function(
            move |_, (effect, positions, seed): (String, mlua::Buffer, Option<u64>)| {
                if positions.is_empty() || positions.len() % 12 != 0 || positions.len() > 4096 * 12
                {
                    return Err(mlua::Error::RuntimeError(
                        "PARTICLE_BATCH_INVALID: packed f32le xyz positions required".into(),
                    ));
                }
                let bytes = positions.to_vec();
                let origins = bytes
                    .chunks_exact(12)
                    .map(|p| {
                        let v: [f64; 3] = std::array::from_fn(|n| {
                            f32::from_le_bytes(p[n * 4..n * 4 + 4].try_into().unwrap()) as f64
                        });
                        Vec3 {
                            x: v[0],
                            y: v[1],
                            z: v[2],
                        }
                    })
                    .collect();
                let mut world = particle_world.borrow_mut();
                let frame = world.frame;
                world
                    .particles
                    .play_batch(&effect, origins, seed.unwrap_or(0), frame)
                    .map_err(mlua::Error::external)
            },
        )?,
    )?;
    let particle_world = Rc::clone(&world);
    particle_api.set(
        "stats",
        lua.create_function(move |lua, ()| {
            let world = particle_world.borrow();
            let stats = world.particles.stats(world.frame);
            let table = lua.create_table()?;
            for (key, value) in stats.as_object().unwrap() {
                table.set(key.as_str(), value.as_u64().unwrap())?;
            }
            Ok(table)
        })?,
    )?;
    Ok(particle_api)
}

#[cfg(feature = "effekseer")]
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
pub(super) fn instances3d(lua: &mlua::Lua, state: &super::ApiState) -> mlua::Result<mlua::Table> {
    let api = lua.create_table()?;
    let world = std::rc::Rc::clone(&state.world);
    api.set(
        "set",
        lua.create_function(
            move |_, (id, asset, buffer): (String, String, mlua::Buffer)| {
                if id.is_empty() || id.len() > 128 {
                    return Err(mlua::Error::RuntimeError(
                        "INSTANCE_INVALID: batch ID required (1..128 bytes)".into(),
                    ));
                }
                if buffer.len() > 40 * 262_144 {
                    return Err(mlua::Error::RuntimeError(
                        "INSTANCE_LIMIT: at most 262144 instances".into(),
                    ));
                }
                let bytes = buffer.to_vec();
                {
                    let world = world.borrow();
                    if world
                        .instances3d
                        .get(&id)
                        .is_some_and(|batch| batch.same_payload(&asset, &bytes))
                    {
                        return Ok(());
                    }
                }
                let batch = crate::instances3d::InstanceBatch3D::from_vec(asset, bytes)
                    .map_err(mlua::Error::RuntimeError)?;
                let mut w = world.borrow_mut();
                let total: usize = w
                    .instances3d
                    .iter()
                    .filter(|(key, _)| **key != id)
                    .map(|(_, b)| b.count)
                    .sum();
                if total + batch.count > 262_144
                    || (!w.instances3d.contains_key(&id) && w.instances3d.len() >= 256)
                {
                    return Err(mlua::Error::RuntimeError(
                        "INSTANCE_LIMIT: 262144 instances / 256 batches per world".into(),
                    ));
                }
                w.instances3d.insert(id, batch);
                Ok(())
            },
        )?,
    )?;
    let world = std::rc::Rc::clone(&state.world);
    api.set(
        "remove",
        lua.create_function(move |_, id: String| {
            world
                .borrow_mut()
                .instances3d
                .remove(&id)
                .ok_or_else(|| mlua::Error::RuntimeError(format!("INSTANCE_MISSING: {id}")))?;
            Ok(())
        })?,
    )?;
    Ok(api)
}

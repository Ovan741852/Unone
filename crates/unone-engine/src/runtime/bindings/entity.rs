use super::{ApiState, Lua, Table};
use super::value::lua_value_to_json;
use crate::world::{SpriteAnimationData, SpriteData, Transform2DData, Transform3DData, Vec2, Vec3};
use std::rc::Rc;

pub(super) fn entity(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let entity = lua.create_table()?;
    let spawn_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "spawn",
        lua.create_function(move |_, (name, components): (String, Option<mlua::Value>)| {
            super::ensure_not_view(&view, "entity.spawn")?;
            let Some(components) = components else {
                return Ok(spawn_world.borrow_mut().spawn(&name));
            };
            let components = lua_value_to_json(components).map_err(mlua::Error::RuntimeError)?;
            spawn_world.borrow_mut().spawn_with(&name, components).map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let get_world = Rc::clone(&world);
    entity.set(
        "getPosition",
        lua.create_function(move |lua, id: String| {
            let world = get_world.borrow();
            let transform = world.get_transform2d(&id).map_err(mlua::Error::RuntimeError)?;
            let table = lua.create_table()?;
            table.set("x", transform.position.x)?;
            table.set("y", transform.position.y)?;
            Ok(table)
        })?,
    )?;

    let set_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "setPosition",
        lua.create_function(move |_, (id, position): (String, Table)| {
            super::ensure_not_view(&view, "entity.setPosition")?;
            let x: f64 = position.get("x")?;
            let y: f64 = position.get("y")?;
            set_world
                .borrow_mut()
                .set_position(&id, Vec2 { x, y })
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let get_transform2d_world = Rc::clone(&world);
    entity.set(
        "getTransform2D",
        lua.create_function(move |lua, id: String| {
            let transform = get_transform2d_world
                .borrow()
                .get_transform2d(&id)
                .map_err(mlua::Error::RuntimeError)?;
            let result = lua.create_table()?;
            let position = lua.create_table()?;
            position.set("x", transform.position.x)?;
            position.set("y", transform.position.y)?;
            let scale = lua.create_table()?;
            scale.set("x", transform.scale.x)?;
            scale.set("y", transform.scale.y)?;
            result.set("position", position)?;
            result.set("rotation", transform.rotation)?;
            result.set("scale", scale)?;
            Ok(result)
        })?,
    )?;

    let set_transform2d_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "setTransform2D",
        lua.create_function(move |_, (id, value): (String, Table)| {
            super::ensure_not_view(&view, "entity.setTransform2D")?;
            let position: Table = value.get("position")?;
            let scale: Table = value.get("scale")?;
            let transform = Transform2DData {
                position: Vec2 {
                    x: position.get("x")?,
                    y: position.get("y")?,
                },
                rotation: value.get("rotation")?,
                scale: Vec2 {
                    x: scale.get("x")?,
                    y: scale.get("y")?,
                },
            };
            set_transform2d_world
                .borrow_mut()
                .set_transform2d(&id, transform)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let get_transform3d_world = Rc::clone(&world);
    entity.set(
        "getTransform3D",
        lua.create_function(move |lua, id: String| {
            let transform = get_transform3d_world
                .borrow()
                .get_transform3d(&id)
                .map_err(mlua::Error::RuntimeError)?;
            let result = lua.create_table()?;
            let position = lua.create_table()?;
            position.set("x", transform.position.x)?;
            position.set("y", transform.position.y)?;
            position.set("z", transform.position.z)?;
            let rotation = lua.create_table()?;
            rotation.set("x", transform.rotation.x)?;
            rotation.set("y", transform.rotation.y)?;
            rotation.set("z", transform.rotation.z)?;
            let scale = lua.create_table()?;
            scale.set("x", transform.scale.x)?;
            scale.set("y", transform.scale.y)?;
            scale.set("z", transform.scale.z)?;
            result.set("position", position)?;
            result.set("rotation", rotation)?;
            result.set("scale", scale)?;
            Ok(result)
        })?,
    )?;

    let set_transform3d_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "setTransform3D",
        lua.create_function(move |_, (id, value): (String, Table)| {
            super::ensure_not_view(&view, "entity.setTransform3D")?;
            let position: Table = value.get("position")?;
            let rotation: Table = value.get("rotation")?;
            let scale: Table = value.get("scale")?;
            let transform = Transform3DData {
                position: Vec3 {
                    x: position.get("x")?,
                    y: position.get("y")?,
                    z: position.get("z")?,
                },
                rotation: Vec3 {
                    x: rotation.get("x")?,
                    y: rotation.get("y")?,
                    z: rotation.get("z")?,
                },
                scale: Vec3 {
                    x: scale.get("x")?,
                    y: scale.get("y")?,
                    z: scale.get("z")?,
                },
            };
            set_transform3d_world
                .borrow_mut()
                .set_transform3d(&id, transform)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let get_velocity_world = Rc::clone(&world);
    entity.set(
        "getVelocity",
        lua.create_function(move |lua, id: String| {
            let velocity = get_velocity_world
                .borrow()
                .get_velocity(&id)
                .map_err(mlua::Error::RuntimeError)?;
            let table = lua.create_table()?;
            table.set("x", velocity.x)?;
            table.set("y", velocity.y)?;
            Ok(table)
        })?,
    )?;

    let set_velocity_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "setVelocity",
        lua.create_function(move |_, (id, velocity): (String, Table)| {
            super::ensure_not_view(&view, "entity.setVelocity")?;
            let velocity = Vec2 {
                x: velocity.get("x")?,
                y: velocity.get("y")?,
            };
            set_velocity_world
                .borrow_mut()
                .set_velocity(&id, velocity)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let despawn_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "despawn",
        lua.create_function(move |_, id: String| {
            super::ensure_not_view(&view, "entity.despawn")?;
            despawn_world
                .borrow_mut()
                .despawn(&id)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let visibility_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "setSpriteVisible",
        lua.create_function(move |_, (id, visible): (String, bool)| {
            super::ensure_not_view(&view, "entity.setSpriteVisible")?;
            visibility_world
                .borrow_mut()
                .set_sprite_visible(&id, visible)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let sprite_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "setSprite",
        lua.create_function(move |_, (id, sprite): (String, Option<mlua::Value>)| {
            super::ensure_not_view(&view, "entity.setSprite")?;
            let sprite = sprite
                .map(|value| {
                    let value = lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
                    serde_json::from_value::<SpriteData>(value)
                        .map_err(|error| mlua::Error::RuntimeError(format!("ENTITY_SPRITE_INVALID: {error}")))
                })
                .transpose()?;
            sprite_world.borrow_mut().set_sprite(&id, sprite).map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let frame_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "setSpriteFrame",
        lua.create_function(move |_, (id, frame): (String, f64)| {
            super::ensure_not_view(&view, "entity.setSpriteFrame")?;
            if frame.fract() != 0.0 || !(0.0..=f64::from(u32::MAX)).contains(&frame) {
                return Err(mlua::Error::RuntimeError(format!(
                    "SPRITE_FRAME_INVALID: frame must be a whole sheet cell number from 0, got {frame}"
                )));
            }
            frame_world
                .borrow_mut()
                .set_sprite_frame(&id, frame as u32)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let play_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    entity.set(
        "playSpriteAnimation",
        lua.create_function(move |_, (id, clip): (String, mlua::Value)| {
            super::ensure_not_view(&view, "entity.playSpriteAnimation")?;
            let clip = sprite_clip(clip)?;
            play_world
                .borrow_mut()
                .play_sprite_animation(&id, clip)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let read_world = Rc::clone(&world);
    entity.set(
        "getSpriteFrame",
        lua.create_function(move |_, id: String| {
            read_world.borrow().sprite_frame(&id).map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(entity)
}

/// Read a clip straight from its Lua table. Games are told to call
/// playSpriteAnimation every update for their current state, and a JSON round
/// trip there cost about 1 µs per call.
fn sprite_clip(clip: mlua::Value) -> mlua::Result<SpriteAnimationData> {
    let invalid = |detail: String| {
        mlua::Error::RuntimeError(format!(
            "SPRITE_ANIMATION_INVALID: expected {{frames={{0,1,...}}, fps=12, loop=true}}: {detail}"
        ))
    };
    let mlua::Value::Table(clip) = clip else {
        return Err(invalid(format!("got a {}", clip.type_name())));
    };
    // One walk collects the known fields; a misspelled one stops it and is
    // reported with the shared OPTION_UNKNOWN_FIELD wording.
    let (mut list, mut fps, mut looping, mut misspelled) = (None, None, true, false);
    for pair in clip.pairs::<mlua::Value, mlua::Value>() {
        let (key, value) = pair?;
        let mlua::Value::String(name) = &key else {
            misspelled = true;
            break;
        };
        let name = name.as_bytes();
        match (&*name, value) {
            (b"frames", mlua::Value::Table(cells)) => list = Some(cells),
            (b"fps", mlua::Value::Number(value)) => fps = Some(value),
            (b"fps", mlua::Value::Integer(value)) => fps = Some(value as f64),
            (b"loop", mlua::Value::Boolean(value)) => looping = value,
            (b"frames" | b"fps" | b"loop", other) => {
                return Err(invalid(format!("{} must not be a {}", String::from_utf8_lossy(&name), other.type_name())));
            }
            _ => {
                misspelled = true;
                break;
            }
        }
    }
    if misspelled {
        super::reject_unknown_keys(&clip, &["frames", "fps", "loop"], "entity.playSpriteAnimation clip")?;
    }
    let list = list.ok_or_else(|| invalid("missing field `frames` (a list of sheet cells)".into()))?;
    let fps = fps.ok_or_else(|| invalid("missing field `fps`".into()))?;
    let mut frames = Vec::with_capacity(list.raw_len());
    for cell in list.sequence_values::<mlua::Value>() {
        frames.push(match cell? {
            mlua::Value::Integer(cell) if (0..=i64::from(u32::MAX)).contains(&i64::from(cell)) => cell as u32,
            mlua::Value::Number(cell) if cell.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&cell) => cell as u32,
            other => return Err(invalid(format!("frames must be whole sheet cell numbers from 0, got {other:?}"))),
        });
    }
    Ok(SpriteAnimationData { frames, fps, looping })
}

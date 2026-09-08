use super::value::{json_to_lua, lua_value_to_json};
use super::{ApiState, Lua, Table, Value};
use crate::world::Vec2;
use std::rc::Rc;

#[cfg(feature = "physics2d")]
pub(super) fn physics(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let physics = lua.create_table()?;
    let impulse_world = Rc::clone(&world);
    physics.set(
        "applyImpulse",
        lua.create_function(move |_, (id, impulse): (String, Table)| {
            let impulse = Vec2 {
                x: impulse.get("x")?,
                y: impulse.get("y")?,
            };
            impulse_world
                .borrow_mut()
                .apply_impulse(&id, impulse)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(physics)
}

#[cfg(feature = "physics3d")]
pub(super) fn physics3d(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let physics3d_api = lua.create_table()?;
    let physics3d_world = Rc::clone(&world);
    physics3d_api.set(
        "sweepSphere",
        lua.create_function(move |lua, request: Table| {
            let mut value =
                lua_value_to_json(Value::Table(request)).map_err(mlua::Error::RuntimeError)?;
            if value["targets"].as_object().is_some_and(|v| v.is_empty()) {
                value["targets"] = serde_json::json!([]);
            }
            let request: crate::physics3d::SphereSweep =
                serde_json::from_value(value).map_err(mlua::Error::external)?;
            let result = crate::physics3d::sweep_sphere(&physics3d_world.borrow(), request)
                .map_err(mlua::Error::RuntimeError)?;
            json_to_lua(
                lua,
                serde_json::to_value(result).map_err(mlua::Error::external)?,
            )
        })?,
    )?;
    rigid3d(lua, &physics3d_api, state)?;
    Ok(physics3d_api)
}

fn decode<T: serde::de::DeserializeOwned>(value: Table) -> mlua::Result<T> {
    serde_json::from_value(
        lua_value_to_json(Value::Table(value)).map_err(mlua::Error::RuntimeError)?,
    )
    .map_err(mlua::Error::external)
}
fn encode<T: serde::Serialize>(lua: &Lua, value: T) -> mlua::Result<Value> {
    json_to_lua(
        lua,
        serde_json::to_value(value).map_err(mlua::Error::external)?,
    )
}
#[cfg(feature = "physics3d")]
fn rigid3d(lua: &Lua, api: &Table, state: &ApiState) -> mlua::Result<()> {
    use crate::rigid3d::*;
    use crate::world::World;
    fn physics(world: &mut World) -> mlua::Result<&mut PhysicsWorld3D> {
        world.physics3d.as_mut().ok_or_else(|| {
            mlua::Error::RuntimeError(
                "PHYSICS3D_NOT_INITIALIZED: declare scene.physics3d or addBody first".into(),
            )
        })
    }
    let world = Rc::clone(&state.world);
    api.set(
        "getBody",
        lua.create_function(move |lua, id: String| {
            let mut world = world.borrow_mut();
            encode(
                lua,
                physics(&mut world)?
                    .definition(&id)
                    .map_err(mlua::Error::RuntimeError)?,
            )
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set(
        "addJoint",
        lua.create_function(move |_, (id, value): (String, Table)| {
            let joint = decode(value)?;
            let mut world = world.borrow_mut();
            physics(&mut world)?
                .add_joint(id, joint)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set(
        "removeJoint",
        lua.create_function(move |_, id: String| {
            let mut world = world.borrow_mut();
            physics(&mut world)?
                .remove_joint(&id)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set(
        "addBody",
        lua.create_function(move |_, (id, config): (String, Table)| {
            let config: Body3D = decode(config)?;
            let mut world = world.borrow_mut();
            let transform = world
                .get_transform3d(&id)
                .map_err(mlua::Error::RuntimeError)?;
            let pose = Pose3D {
                position: transform.position,
                rotation: transform.rotation,
            };
            if let Some(p) = &mut world.physics3d {
                p.add(id, config, pose).map_err(mlua::Error::RuntimeError)?;
            } else {
                let mut p = PhysicsWorld3D::default();
                p.add(id, config, pose).map_err(mlua::Error::RuntimeError)?;
                world.physics3d = Some(p);
            }
            Ok(())
        })?,
    )?;
    for method in ["removeBody", "clearForces"] {
        let world = Rc::clone(&state.world);
        api.set(
            method,
            lua.create_function(move |_, id: String| {
                let mut world = world.borrow_mut();
                let p = physics(&mut world)?;
                if method == "removeBody" {
                    p.remove(&id)
                } else {
                    p.clear_forces(&id)
                }
                .map_err(mlua::Error::RuntimeError)
            })?,
        )?;
    }
    for method in [
        "setVelocity",
        "setAngularVelocity",
        "applyImpulse",
        "applyTorqueImpulse",
        "addForce",
        "addTorque",
    ] {
        let world = Rc::clone(&state.world);
        api.set(
            method,
            lua.create_function(move |_, (id, value): (String, Table)| {
                let value = decode(value)?;
                let mut world = world.borrow_mut();
                physics(&mut world)?
                    .vector_command(&id, value, method)
                    .map_err(mlua::Error::RuntimeError)
            })?,
        )?;
    }
    for method in ["teleport", "moveKinematic"] {
        let world = Rc::clone(&state.world);
        api.set(
            method,
            lua.create_function(move |_, (id, value): (String, Table)| {
                let pose = decode(value)?;
                let mut world = world.borrow_mut();
                physics(&mut world)?
                    .move_body(&id, pose, method == "moveKinematic")
                    .map_err(mlua::Error::RuntimeError)?;
                if method == "teleport" {
                    let world = &mut *world;
                    world.physics3d.as_ref().unwrap().sync(&mut world.entities);
                }
                Ok(())
            })?,
        )?;
    }
    let world = Rc::clone(&state.world);
    api.set(
        "setGravity",
        lua.create_function(move |_, value: Table| {
            let value = decode(value)?;
            let mut world = world.borrow_mut();
            physics(&mut world)?
                .set_gravity(value)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set(
        "snapshot",
        lua.create_function(move |lua, (): ()| {
            encode(lua, world.borrow().physics3d.as_ref().map(|p| p.snapshot()))
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set(
        "contacts",
        lua.create_function(move |lua, (): ()| {
            let world = world.borrow();
            encode(
                lua,
                world
                    .physics3d
                    .as_ref()
                    .map(|p| p.contacts.clone())
                    .unwrap_or_default(),
            )
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set(
        "raycast",
        lua.create_function(move |lua, value: Table| {
            let request = decode(value)?;
            let mut world = world.borrow_mut();
            encode(
                lua,
                physics(&mut world)?
                    .raycast(request)
                    .map_err(mlua::Error::RuntimeError)?,
            )
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set(
        "castShape",
        lua.create_function(move |lua, value: Table| {
            let request = decode(value)?;
            let mut world = world.borrow_mut();
            encode(
                lua,
                physics(&mut world)?
                    .cast(request)
                    .map_err(mlua::Error::RuntimeError)?,
            )
        })?,
    )?;
    let world = Rc::clone(&state.world);
    api.set(
        "overlap",
        lua.create_function(move |lua, value: Table| {
            let request = decode(value)?;
            let mut world = world.borrow_mut();
            encode(
                lua,
                physics(&mut world)?
                    .overlap(request)
                    .map_err(mlua::Error::RuntimeError)?,
            )
        })?,
    )?;
    Ok(())
}

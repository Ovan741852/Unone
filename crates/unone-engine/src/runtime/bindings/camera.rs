use super::{ApiState, Lua, Table};
use crate::world::{Vec2, Vec3};
use std::rc::Rc;

#[cfg(feature = "camera2d")]
pub(super) fn camera(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let camera = lua.create_table()?;
    let camera_get_world = Rc::clone(&world);
    camera.set(
        "getPosition",
        lua.create_function(move |lua, _: ()| {
            let position = camera_get_world.borrow().get_camera_position();
            let table = lua.create_table()?;
            table.set("x", position.x)?;
            table.set("y", position.y)?;
            Ok(table)
        })?,
    )?;

    let camera_set_world = Rc::clone(&world);
    camera.set(
        "setPosition",
        lua.create_function(move |_, position: Table| {
            let position = Vec2 {
                x: position.get("x")?,
                y: position.get("y")?,
            };
            camera_set_world
                .borrow_mut()
                .set_camera_position(position)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let camera_zoom_world = Rc::clone(&world);
    camera.set(
        "getZoom",
        lua.create_function(move |_, _: ()| Ok(camera_zoom_world.borrow().get_camera_zoom()))?,
    )?;

    let camera_set_zoom_world = Rc::clone(&world);
    camera.set(
        "setZoom",
        lua.create_function(move |_, zoom: f64| {
            camera_set_zoom_world
                .borrow_mut()
                .set_camera_zoom(zoom)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(camera)
}

#[cfg(feature = "camera3d")]
pub(super) fn camera3d(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let camera3d = lua.create_table()?;
    let camera3d_get_world = Rc::clone(&world);
    camera3d.set(
        "getTransform",
        lua.create_function(move |lua, _: ()| {
            let camera = camera3d_get_world
                .borrow()
                .get_camera3d()
                .map_err(mlua::Error::RuntimeError)?;
            let result = lua.create_table()?;
            let position = lua.create_table()?;
            position.set("x", camera.position.x)?;
            position.set("y", camera.position.y)?;
            position.set("z", camera.position.z)?;
            let target = lua.create_table()?;
            target.set("x", camera.target.x)?;
            target.set("y", camera.target.y)?;
            target.set("z", camera.target.z)?;
            result.set("position", position)?;
            result.set("target", target)?;
            result.set("fovDegrees", camera.fov_degrees)?;
            Ok(result)
        })?,
    )?;

    let camera3d_set_position_world = Rc::clone(&world);
    camera3d.set(
        "setPosition",
        lua.create_function(move |_, position: Table| {
            let position = Vec3 {
                x: position.get("x")?,
                y: position.get("y")?,
                z: position.get("z")?,
            };
            camera3d_set_position_world
                .borrow_mut()
                .set_camera3d_position(position)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let camera3d_set_target_world = Rc::clone(&world);
    camera3d.set(
        "setTarget",
        lua.create_function(move |_, target: Table| {
            let target = Vec3 {
                x: target.get("x")?,
                y: target.get("y")?,
                z: target.get("z")?,
            };
            camera3d_set_target_world
                .borrow_mut()
                .set_camera3d_target(target)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    Ok(camera3d)
}

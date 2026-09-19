use super::{ApiState, Lua, Table};
use crate::systems::SystemSettings;
use crate::world::{Vec2, Vec3, validate_vec2, validate_vec3};
use std::rc::Rc;

pub(super) fn camera(
    lua: &Lua,
    state: &ApiState,
    systems: &SystemSettings,
) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let systems = systems.clone();
    let camera = lua.create_table()?;
    let camera_get_world = Rc::clone(&world);
    let camera_get_world_systems = systems.clone();
    camera.set(
        "getPosition",
        lua.create_function(move |lua, _: ()| {
            if !camera_get_world_systems.is_enabled("camera2d") {
                return Err(mlua::Error::RuntimeError(
                    "SYSTEM_DISABLED: system 'camera2d' is disabled; use the unified Camera with an enabled projection system".into(),
                ));
            }
            let position = camera_get_world.borrow().get_camera_position();
            let table = lua.create_table()?;
            table.set("x", position.x)?;
            table.set("y", position.y)?;
            Ok(table)
        })?,
    )?;

    let camera_set_world = Rc::clone(&world);
    let camera_set_world_systems = systems.clone();
    camera.set(
        "setPosition",
        lua.create_function(move |_, position: Table| {
            if !camera_set_world_systems.is_enabled("camera2d") {
                return Err(mlua::Error::RuntimeError(
                    "SYSTEM_DISABLED: system 'camera2d' is disabled".into(),
                ));
            }
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
    let camera_zoom_world_systems = systems.clone();
    camera.set(
        "getZoom",
        lua.create_function(move |_, _: ()| {
            if !camera_zoom_world_systems.is_enabled("camera2d") {
                return Err(mlua::Error::RuntimeError(
                    "SYSTEM_DISABLED: system 'camera2d' is disabled".into(),
                ));
            }
            Ok(camera_zoom_world.borrow().get_camera_zoom())
        })?,
    )?;

    let camera_set_zoom_world = Rc::clone(&world);
    let camera_set_zoom_world_systems = systems.clone();
    camera.set(
        "setZoom",
        lua.create_function(move |_, zoom: f64| {
            if !camera_set_zoom_world_systems.is_enabled("camera2d") {
                return Err(mlua::Error::RuntimeError(
                    "SYSTEM_DISABLED: system 'camera2d' is disabled".into(),
                ));
            }
            camera_set_zoom_world
                .borrow_mut()
                .set_camera_zoom(zoom)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    // Canonical camera API.  It deliberately lives beside the old 2D
    // position/zoom calls so existing Luau keeps running while new projects
    // use one Unity-like Camera with an orthographic or perspective
    // projection. `camera3d.*` below remains a compatibility alias.
    let camera_get_projection_world = Rc::clone(&world);
    camera.set(
        "getProjection",
        lua.create_function(move |_, _: ()| {
            Ok(camera_get_projection_world.borrow().camera_projection())
        })?,
    )?;

    let camera_get_transform_world = Rc::clone(&world);
    camera.set(
        "getTransform",
        lua.create_function(move |lua, _: ()| {
            let world = camera_get_transform_world.borrow();
            let perspective = world.get_camera3d().ok();
            let result = lua.create_table()?;
            result.set("projection", world.camera_projection())?;
            let position = lua.create_table()?;
            let target = lua.create_table()?;
            if let Some(camera) = perspective {
                position.set("x", camera.position.x)?;
                position.set("y", camera.position.y)?;
                position.set("z", camera.position.z)?;
                target.set("x", camera.target.x)?;
                target.set("y", camera.target.y)?;
                target.set("z", camera.target.z)?;
                result.set("fovDegrees", camera.fov_degrees)?;
            } else {
                let camera_position = world.get_camera_position();
                position.set("x", camera_position.x)?;
                position.set("y", camera_position.y)?;
                position.set("z", 0.0)?;
                target.set("x", camera_position.x)?;
                target.set("y", camera_position.y)?;
                target.set("z", -1.0)?;
            }
            result.set("position", position)?;
            result.set("target", target)?;
            if world.camera_projection() == "orthographic" {
                result.set("orthographicSize", world.camera_orthographic_size())?;
            }
            Ok(result)
        })?,
    )?;

    let camera_set_projection_world = Rc::clone(&world);
    let camera_set_projection_systems = systems.clone();
    camera.set(
        "setProjection",
        lua.create_function(move |_, projection: String| {
            let required = match projection.as_str() {
                "orthographic" => "camera2d",
                "perspective" => "camera3d",
                _ => "camera",
            };
            if required != "camera" && !camera_set_projection_systems.is_enabled(required) {
                return Err(mlua::Error::RuntimeError(format!(
                    "SYSTEM_DISABLED: system '{required}' is disabled"
                )));
            }
            camera_set_projection_world
                .borrow_mut()
                .set_camera_projection(&projection)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let camera_set_transform_world = Rc::clone(&world);
    let camera_set_transform_systems = systems.clone();
    camera.set(
        "setTransform",
        lua.create_function(move |_, transform: Table| {
            let projection = match transform.get::<Option<String>>("projection")? {
                Some(projection) => projection,
                None => camera_set_transform_world.borrow().camera_projection().to_string(),
            };
            let required = match projection.as_str() {
                "orthographic" => "camera2d",
                "perspective" => "camera3d",
                _ => "camera",
            };
            if required != "camera" && !camera_set_transform_systems.is_enabled(required) {
                return Err(mlua::Error::RuntimeError(format!(
                    "SYSTEM_DISABLED: system '{required}' is disabled"
                )));
            }
            let position: Table = transform.get("position")?;
            let target: Option<Table> = transform.get("target")?;
            match projection.as_str() {
                "orthographic" => {
                    let position = Vec2 {
                        x: position.get("x")?,
                        y: position.get("y")?,
                    };
                    validate_vec2(position, "Camera position")
                        .map_err(|diagnostic| {
                            mlua::Error::RuntimeError(format!(
                                "{}: {}",
                                diagnostic.code, diagnostic.explanation
                            ))
                        })?;
                    let size = transform.get::<Option<f64>>("orthographicSize")?;
                    if let Some(size) = size {
                        if !size.is_finite() || size <= 0.0 {
                            return Err(mlua::Error::RuntimeError(
                                "CAMERA_ORTHOGRAPHIC_SIZE_INVALID: size must be finite and greater than 0".into(),
                            ));
                        }
                    }
                    if target.is_some()
                        || transform.get::<Option<f64>>("fovDegrees")?.is_some()
                    {
                        return Err(mlua::Error::RuntimeError(
                            "CAMERA_TRANSFORM_INVALID: orthographic cannot declare target or fovDegrees".into(),
                        ));
                    }
                    let mut world = camera_set_transform_world.borrow_mut();
                    world
                        .set_camera_projection(&projection)
                        .map_err(mlua::Error::RuntimeError)?;
                    world
                        .set_camera_position(position)
                        .map_err(mlua::Error::RuntimeError)?;
                    if let Some(size) = size {
                        world
                            .set_camera_orthographic_size(size)
                            .map_err(mlua::Error::RuntimeError)?;
                    }
                }
                "perspective" => {
                    let target = target.ok_or_else(|| {
                        mlua::Error::RuntimeError(
                            "CAMERA_TRANSFORM_INVALID: perspective requires target".into(),
                        )
                    })?;
                    let position = Vec3 {
                        x: position.get("x")?,
                        y: position.get("y")?,
                        z: position.get("z")?,
                    };
                    let target = Vec3 {
                        x: target.get("x")?,
                        y: target.get("y")?,
                        z: target.get("z")?,
                    };
                    validate_vec3(position, "Camera position")
                        .map_err(|diagnostic| {
                            mlua::Error::RuntimeError(format!(
                                "{}: {}",
                                diagnostic.code, diagnostic.explanation
                            ))
                        })?;
                    validate_vec3(target, "Camera target")
                        .map_err(|diagnostic| {
                            mlua::Error::RuntimeError(format!(
                                "{}: {}",
                                diagnostic.code, diagnostic.explanation
                            ))
                        })?;
                    let fov = transform.get::<Option<f64>>("fovDegrees")?;
                    if let Some(fov) = fov {
                        if !(1.0..179.0).contains(&fov) || !fov.is_finite() {
                            return Err(mlua::Error::RuntimeError(
                                "CAMERA_FOV_INVALID: fovDegrees must be finite and between 1 and 179".into(),
                            ));
                        }
                    }
                    if transform.get::<Option<f64>>("orthographicSize")?.is_some()
                        || transform.get::<Option<f64>>("zoom")?.is_some()
                        || transform.get::<Option<f64>>("view_height")?.is_some()
                    {
                        return Err(mlua::Error::RuntimeError(
                            "CAMERA_TRANSFORM_INVALID: perspective cannot declare orthographicSize, zoom, or view_height".into(),
                        ));
                    }
                    let mut world = camera_set_transform_world.borrow_mut();
                    world
                        .set_camera_projection(&projection)
                        .map_err(mlua::Error::RuntimeError)?;
                    let mut camera = world
                        .get_camera3d()
                        .map_err(mlua::Error::RuntimeError)?;
                    camera.position = position;
                    camera.target = target;
                    if let Some(fov) = fov {
                        camera.fov_degrees = fov;
                    }
                    world
                        .set_camera_perspective(camera)
                        .map_err(mlua::Error::RuntimeError)?;
                }
                _ => unreachable!("set_camera_projection validates the value"),
            }
            Ok(())
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

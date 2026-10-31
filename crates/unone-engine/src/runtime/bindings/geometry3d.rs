//! api.geometry3d: retained world-space meshes that the camera places on the GPU.
use super::{ApiState, Lua, Table, Value};
use crate::{GEOMETRY3D_VERTEX_BYTES, MAX_GEOMETRY3D_INDICES, MAX_GEOMETRY3D_VERTICES};
use std::rc::Rc;

fn error(message: impl std::fmt::Display) -> mlua::Error {
    mlua::Error::RuntimeError(format!("GEOMETRY3D_INVALID: {message}"))
}
fn json<T: serde::de::DeserializeOwned>(value: Value, what: &str) -> mlua::Result<T> {
    let json = super::value::lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
    serde_json::from_value(json).map_err(|e| error(format!("{what}: {e}")))
}
fn transform(value: Value) -> mlua::Result<crate::Transform3DData> {
    match value { Value::Nil => Ok(crate::Transform3DData::default()), value => json(value, "transform") }
}
fn decode(t: Table) -> mlua::Result<crate::Geometry3DContent> {
    super::reject_unknown_keys(&t, &["vertices", "indices", "texture", "transform", "material", "visible"], "geometry3d.set")?;
    let vertices: mlua::Buffer = t.get("vertices").map_err(|_| error("vertices buffer required"))?;
    let indices: mlua::Buffer = t.get("indices").map_err(|_| error("indices buffer required"))?;
    // Reject oversized buffers before copying them out of the VM.
    if vertices.len() > GEOMETRY3D_VERTEX_BYTES * MAX_GEOMETRY3D_VERTICES || indices.len() > 4 * MAX_GEOMETRY3D_INDICES {
        return Err(mlua::Error::RuntimeError("GEOMETRY3D_LIMIT: at most 262144 vertices and 1572864 indices per mesh".into()));
    }
    let texture = match t.get::<Value>("texture")? {
        Value::Nil => None,
        Value::String(s) => Some(s.to_str()?.to_owned()),
        _ => return Err(error("texture must be an asset ID string")),
    };
    let material = match t.get::<Value>("material")? { Value::Nil => Default::default(), value => json(value, "material")? };
    let visible = match t.get::<Value>("visible")? {
        Value::Nil => true,
        Value::Boolean(visible) => visible,
        _ => return Err(error("visible must be a boolean")),
    };
    Ok(crate::Geometry3DContent { texture, material, transform: transform(t.get("transform")?)?, visible,
        vertices: vertices.to_vec(), indices: indices.to_vec() })
}

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let world = Rc::clone(&state.world);
    api.set("set", lua.create_function(move |_, (id, t): (String, Table)| {
        let content = decode(t)?;
        world.borrow_mut().set_geometry3d(id, content).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("setTransform", lua.create_function(move |_, (id, value): (String, Value)| {
        let transform = transform(value)?;
        world.borrow_mut().set_geometry3d_transform(&id, transform).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("setVisible", lua.create_function(move |_, (id, visible): (String, bool)| {
        world.borrow_mut().set_geometry3d_visible(&id, visible).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world = Rc::clone(&state.world);
    api.set("remove", lua.create_function(move |_, id: String| {
        world.borrow_mut().remove_geometry3d(&id).map_err(mlua::Error::RuntimeError)
    })?)?;
    Ok(api)
}

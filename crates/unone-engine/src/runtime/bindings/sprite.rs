//! Opaque VM-local sprite resource leases and atomic appearance commits.
use super::{ApiState, Lua, Table, Value};
use super::value::{json_to_lua, lua_value_to_json};
use crate::runtime::sprite_resources::Resource;
use mlua::{MultiValue, UserData, UserDataFields, UserDataMethods, MetaMethod};
use std::rc::Rc;

struct SpriteHandle { resource: Rc<Resource>, _caller: Rc<()> }
impl UserData for SpriteHandle {
    fn add_fields<F: UserDataFields<Self>>(fields: &mut F) {
        fields.add_field_method_get("id", |_, this| Ok(this.resource.id.clone()));
    }
    fn add_methods<M: UserDataMethods<Self>>(methods: &mut M) {
        methods.add_meta_method(MetaMethod::ToString, |_, this, ()| Ok(format!("SpriteResource({})", this.resource.id)));
    }
}

fn arity(args: &MultiValue, min: usize, max: usize, name: &str) -> mlua::Result<()> {
    if args.len() < min || args.len() > max {
        return Err(mlua::Error::RuntimeError(format!("SPRITE_ARGUMENT_INVALID: api.sprite.{name} expects {min}..{max} arguments")));
    }
    Ok(())
}
fn string(value: &Value, name: &str) -> mlua::Result<String> {
    match value { Value::String(s) => Ok(s.to_str()?.to_owned()),
        _ => Err(mlua::Error::RuntimeError(format!("SPRITE_ARGUMENT_INVALID: {name} must be a string"))) }
}
fn handle(value: &Value) -> mlua::Result<Rc<Resource>> {
    let Value::UserData(data) = value else { return Err(mlua::Error::RuntimeError("SPRITE_HANDLE_INVALID: expected Core sprite resource userdata".into())); };
    data.borrow::<SpriteHandle>().map(|h| Rc::clone(&h.resource))
        .map_err(|_| mlua::Error::RuntimeError("SPRITE_HANDLE_INVALID: expected Core sprite resource userdata".into()))
}

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    bind_prepare(lua, state, &api)?;
    bind_commit(lua, state, &api)?;
    bind_status(lua, state, &api)?;
    let registry = Rc::clone(&state.sprite_resources);
    let view = Rc::clone(&state.pure_view);
    api.set("release", lua.create_function(move |_, args: MultiValue| {
        arity(&args, 1, 1, "release")?; super::ensure_not_view(&view, "sprite.release")?;
        registry.borrow_mut().release(&handle(&args[0])?).map_err(mlua::Error::RuntimeError)
    })?)?;
    Ok(api)
}

fn bind_prepare(lua: &Lua, state: &ApiState, api: &Table) -> mlua::Result<()> {
    let registry = Rc::clone(&state.sprite_resources);
    let world = Rc::clone(&state.world); let view = Rc::clone(&state.pure_view);
    api.set("prepare", lua.create_function(move |lua, args: MultiValue| {
        arity(&args, 1, 2, "prepare")?; super::ensure_not_view(&view, "sprite.prepare")?;
        let asset = string(&args[0], "assetId")?;
        let material = args.get(1).filter(|v| !v.is_nil()).map(|v| string(v, "materialId")).transpose()?;
        let (resource, caller) = registry.borrow_mut().prepare(&world.borrow(), asset, material).map_err(mlua::Error::RuntimeError)?;
        lua.create_userdata(SpriteHandle { resource, _caller: caller })
    })?)
}

fn bind_commit(lua: &Lua, state: &ApiState, api: &Table) -> mlua::Result<()> {
    let registry = Rc::clone(&state.sprite_resources);
    let world = Rc::clone(&state.world); let view = Rc::clone(&state.pure_view);
    api.set("commit", lua.create_function(move |_, args: MultiValue| {
        arity(&args, 3, 3, "commit")?; super::ensure_not_view(&view, "sprite.commit")?;
        let entity = string(&args[0], "entityId")?; let resource = handle(&args[1])?;
        let json = lua_value_to_json(args[2].clone()).map_err(mlua::Error::RuntimeError)?;
        let appearance = serde_json::from_value(json).map_err(|e| mlua::Error::RuntimeError(format!("SPRITE_APPEARANCE_INVALID: {e}")))?;
        registry.borrow_mut().commit(&mut world.borrow_mut(), &entity, resource, appearance)
            .map(|revision| revision.map(|v| v as f64)).map_err(mlua::Error::RuntimeError)
    })?)
}

fn bind_status(lua: &Lua, state: &ApiState, api: &Table) -> mlua::Result<()> {
    let registry = Rc::clone(&state.sprite_resources);
    api.set("status", lua.create_function(move |lua, args: MultiValue| {
        arity(&args, 1, 1, "status")?;
        let status = registry.borrow().status(&handle(&args[0])?).map_err(mlua::Error::RuntimeError)?;
        json_to_lua(lua, status)
    })?)?;
    let registry = Rc::clone(&state.sprite_resources); let world = Rc::clone(&state.world);
    api.set("getCommit", lua.create_function(move |lua, args: MultiValue| {
        arity(&args, 1, 1, "getCommit")?;
        let status = registry.borrow().get_commit(&world.borrow(), &string(&args[0], "entityId")?).map_err(mlua::Error::RuntimeError)?;
        json_to_lua(lua, serde_json::to_value(status).map_err(mlua::Error::external)?)
    })?)
}

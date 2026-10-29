use super::{ApiState,Lua,Table,Value};
use std::rc::Rc;
fn error(message:&str)->mlua::Error {mlua::Error::RuntimeError(format!("PROJECTED_INVALID: {message}"))}
fn text(v:Value)->mlua::Result<String> {
    match v {Value::String(s)=>Ok(s.to_str()?.to_owned()),_=>Err(error("string required"))}
}
fn boolean(t:&Table,k:&str)->mlua::Result<bool> {
    match t.get::<Value>(k)? {Value::Nil=>Ok(true),Value::Boolean(b)=>Ok(b),_=>Err(error("boolean required"))}
}
fn decode(t:Table)->mlua::Result<crate::ProjectedBatch> {
    for pair in t.clone().pairs::<Value,Value>() {
        let (key,_)=pair?;let key=text(key)?;
        if !["texture","vertices","indices","order","depth_test","depth_write","scissor","color_mode","filter","sampling_space","address_mode","alpha_cutoff","alpha_compare"].contains(&key.as_str()) {return Err(error("unknown field"));}
    }
    let order=match t.get::<Value>("order")? {
        Value::Nil=>0,Value::Integer(n) if (-32768..=32767).contains(&n)=>n as i32,
        Value::Number(n) if n.is_finite() && n.fract()==0. && (-32768.0..=32767.0).contains(&n)=>n as i32,
        _=>return Err(error("bounded integer order required"))
    };
    let vertices=t.get::<mlua::Buffer>("vertices")?;
    let indices=t.get::<mlua::Buffer>("indices")?;
    if vertices.len()>40*crate::projected::MAX_PROJECTED_VERTICES || indices.len()>4*crate::projected::MAX_PROJECTED_INDICES {return Err(error("packed geometry budget exceeded"));}
    let scissor=match t.get::<Value>("scissor")? {Value::Nil=>None,value=>{
        let value=super::value::lua_value_to_json(value).map_err(mlua::Error::RuntimeError)?;
        Some(serde_json::from_value::<crate::ProjectedScissor>(value).map_err(|_|error("exact scissor{x,y,width,height} integers required"))?)
    }};
    let color_mode=match t.get::<Value>("color_mode")? {Value::Nil=>crate::ProjectedColorMode::Linear,v=>match text(v)?.as_str(){"linear"=>crate::ProjectedColorMode::Linear,"encoded"=>crate::ProjectedColorMode::Encoded,_=>return Err(error("color_mode linear or encoded required"))}};
    let filter=match t.get::<Value>("filter")? {Value::Nil=>crate::ProjectedFilter::Nearest,v=>match text(v)?.as_str(){"nearest"=>crate::ProjectedFilter::Nearest,"linear"=>crate::ProjectedFilter::Linear,_=>return Err(error("filter nearest or linear required"))}};
    let sampling_space=match t.get::<Value>("sampling_space")? {Value::Nil=>crate::ProjectedSamplingSpace::Linear,v=>match text(v)?.as_str(){"linear"=>crate::ProjectedSamplingSpace::Linear,"encoded"=>crate::ProjectedSamplingSpace::Encoded,_=>return Err(error("sampling_space linear or encoded required"))}};
    let address_mode=match t.get::<Value>("address_mode")? {Value::Nil=>crate::ProjectedAddressMode::Clamp,v=>match text(v)?.as_str(){"clamp"=>crate::ProjectedAddressMode::Clamp,"repeat"=>crate::ProjectedAddressMode::Repeat,_=>return Err(error("address_mode clamp or repeat required"))}};
    let alpha_cutoff=match t.get::<Value>("alpha_cutoff")? {Value::Nil=>0.05,Value::Number(n) if n.is_finite()&&(0.0..=1.0).contains(&n)=>n as f32,Value::Integer(n) if (0..=1).contains(&n)=>n as f32,_=>return Err(error("finite alpha_cutoff in0..1 required"))};
    let alpha_compare=match t.get::<Value>("alpha_compare")? {Value::Nil=>crate::ProjectedAlphaCompare::GreaterEqual,v=>match text(v)?.as_str(){"greater_equal"=>crate::ProjectedAlphaCompare::GreaterEqual,"greater"=>crate::ProjectedAlphaCompare::Greater,_=>return Err(error("alpha_compare greater_equal or greater required"))}};
    crate::ProjectedBatch::new(text(t.get("texture")?)?,vertices.to_vec(),indices.to_vec(),order,
        boolean(&t,"depth_test")?,boolean(&t,"depth_write")?).and_then(|batch|batch.with_scissor(scissor))
        .and_then(|batch|batch.with_material(color_mode,filter,alpha_cutoff)).map(|batch|batch.with_sampling_space(sampling_space).with_address_mode(address_mode).with_alpha_compare(alpha_compare)).map_err(mlua::Error::RuntimeError)
}
pub(super) fn bind(lua:&Lua,state:&ApiState)->mlua::Result<Table> {
    let api=lua.create_table()?;let world=Rc::clone(&state.world);
    super::projected_frame::install(lua,state,&api)?;
    api.set("set",lua.create_function(move |_,(id,t):(Value,Table)| {
        let batch=decode(t)?;world.borrow_mut().set_projected(text(id)?,batch).map_err(mlua::Error::RuntimeError)
    })?)?;
    let world=Rc::clone(&state.world);
    api.set("remove",lua.create_function(move |_,id:Value|world.borrow_mut().remove_projected(&text(id)?).map_err(mlua::Error::RuntimeError))?)?;
    let world=Rc::clone(&state.world);
    api.set("getViewport",lua.create_function(move |lua,()| {
        let world=world.borrow();let v=&world.projected_viewport;let t=lua.create_table()?;
        t.set("width",v.width)?;t.set("height",v.height)?;t.set("aspect",v.aspect)?;t.set("revision",v.revision)?;Ok(t)
    })?)?;
    let world=Rc::clone(&state.world);
    api.set("setWorldVisible",lua.create_function(move |_,value:Value| {
        let Value::Boolean(b)=value else{return Err(error("boolean required"));};
        world.borrow_mut().projected_world_hidden=!b;Ok(())
    })?)?;Ok(api)
}

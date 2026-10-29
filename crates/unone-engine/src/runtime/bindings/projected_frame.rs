use super::{ApiState,Lua,Table,Value};
use crate::{ProjectedFrame,ProjectedFrameDraw,projected_frame_material::FrameClipPolicy};
fn error(s:impl std::fmt::Display)->mlua::Error {mlua::Error::RuntimeError(format!("PROJECTED_FRAME_INVALID: {s}"))}
fn text(t:&Table,key:&str)->mlua::Result<String> {
    match t.get::<Value>(key)? {Value::String(s)=>Ok(s.to_str()?.to_owned()),_=>Err(error("string required"))}
}
fn fields(t:&Table,keys:&[&str])->mlua::Result<()> {
    for entry in t.clone().pairs::<Value,Value>() {
        let (key,_)=entry?;let Value::String(key)=key else{return Err(error("string object keys required"));};
        if !keys.contains(&key.to_str()?.as_ref()){return Err(error("unknown field"));}
    }Ok(())
}
fn json<T:serde::de::DeserializeOwned>(value:Value)->mlua::Result<T> {
    let v=super::value::lua_value_to_json(value).map_err(error)?;
    serde_json::from_value(v).map_err(error)
}
fn dense(t:Table,max:usize)->mlua::Result<Vec<Value>> {
    let mut pairs=std::collections::BTreeMap::new();
    for entry in t.pairs::<Value,Value>() {
        let (key,value)=entry?;
        let n=match key {Value::Integer(n) if n>0=>n as usize,
            Value::Number(n) if n.is_finite()&&n>0.&&n.fract()==0.&&n<=max as f64=>n as usize,
            _=>return Err(error("dense bounded sequence required"))};
        if n>max{return Err(error("sequence limit"));}pairs.insert(n,value);
    }
    if !pairs.keys().copied().eq(1..=pairs.len()){return Err(error("dense sequence required"));}
    Ok(pairs.into_values().collect())
}
fn draw(t:Table,profile:&str)->mlua::Result<ProjectedFrameDraw> {
    fields(&t,&["id","texture","vertices","indices","clip_policy","material","scissor"])?;
    let vertices=t.get::<mlua::Buffer>("vertices")?;let indices=t.get::<mlua::Buffer>("indices")?;
    if vertices.len()>40*crate::projected::MAX_PROJECTED_VERTICES||indices.len()>4*crate::projected::MAX_PROJECTED_INDICES {
        return Err(error("geometry limit"));
    }
    let scissor=match t.get::<Value>("scissor")? {Value::Nil=>None,v=>Some(json::<crate::ProjectedScissor>(v)?)};
    ProjectedFrameDraw::new_for_profile(profile,text(&t,"id")?,text(&t,"texture")?,json::<FrameClipPolicy>(t.get("clip_policy")?)?,
        json(t.get("material")?)?,scissor,vertices.to_vec(),indices.to_vec()).map_err(error)
}
fn decode(t:Table)->mlua::Result<ProjectedFrame> {
    fields(&t,&["profile","initial","draws"])?;
    let profile=crate::projected_frame::parse_frame_profile(&text(&t,"profile")?).map_err(error)?;
    let initial=t.get::<Table>("initial")?;fields(&initial,&["rgb8","depth"])?;
    dense(initial.get("rgb8")?,3)?;
    let mut draws=Vec::new();let (mut vertices,mut indices)=(0usize,0usize);
    for v in dense(t.get("draws")?,crate::projected_frame::MAX_PROJECTED_FRAME_DRAWS)? {
        let Value::Table(t)=v else{return Err(error("draw table required"));};
        vertices+=t.get::<mlua::Buffer>("vertices")?.len();indices+=t.get::<mlua::Buffer>("indices")?.len();
        if vertices>1_048_576*40||indices>6_291_456*4{return Err(error("world geometry limit"));}
        draws.push(draw(t,profile)?);
    }
    ProjectedFrame::new_for_profile(profile,json(Value::Table(initial))?,draws).map_err(error)
}
pub(super) fn install(lua:&Lua,state:&ApiState,api:&Table)->mlua::Result<()> {
    let world=std::rc::Rc::clone(&state.world);
    api.set("setFrame",lua.create_function(move |_,t:Table| {
        let frame=decode(t)?;world.borrow_mut().set_projected_frame(frame).map_err(error)
    })?)
}

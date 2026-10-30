//! `api.render`: adjust the passes the project declared in render_pipeline.
use super::{ApiState, Lua, Table};
use crate::RenderParam;
use mlua::Value;
use std::{collections::BTreeMap, rc::Rc};

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let world = Rc::clone(&state.world);
    let view = Rc::clone(&state.pure_view);
    api.set("setPass", lua.create_function(move |_, (id, change): (String, Table)| {
        super::ensure_not_view(&view, "render.setPass")?;
        super::reject_unknown_keys(&change, &["enabled", "params"], "render.setPass change")?;
        let enabled: Option<bool> = change.get("enabled")?;
        let mut params = BTreeMap::new();
        if let Some(table) = change.get::<Option<Table>>("params")? {
            for pair in table.pairs::<String, Value>() {
                let (key, value) = pair?;
                let value = match value {
                    Value::Boolean(value) => RenderParam::Bool(value),
                    Value::Integer(value) => RenderParam::Number(value as f64),
                    Value::Number(value) => RenderParam::Number(value),
                    Value::String(value) => RenderParam::Text(value.to_str()?.to_string()),
                    other => {
                        return Err(mlua::Error::RuntimeError(format!(
                            "RENDER_PIPELINE_INVALID: param '{key}' must be a number, boolean or string, got {}",
                            other.type_name()
                        )));
                    }
                };
                params.insert(key, value);
            }
        }
        let mut world = world.borrow_mut();
        let Some(pipeline) = world.render_pipeline.as_mut() else {
            return Err(mlua::Error::RuntimeError(
                "RENDER_PIPELINE_UNDECLARED: declare render_pipeline in project.unone.json before adjusting passes".into(),
            ));
        };
        pipeline.set_pass(&id, enabled, params).map_err(mlua::Error::RuntimeError)
    })?)?;

    let world = Rc::clone(&state.world);
    api.set("getPass", lua.create_function(move |lua, id: String| {
        let world = world.borrow();
        let pass = world
            .render_pipeline
            .as_ref()
            .and_then(|pipeline| pipeline.passes.iter().find(|pass| pass.id == id))
            .ok_or_else(|| mlua::Error::RuntimeError(format!("RENDER_PASS_UNKNOWN: no pass '{id}' is declared")))?;
        let result = lua.create_table()?;
        result.set("id", pass.id.as_str())?;
        result.set("kind", pass.kind.as_str())?;
        result.set("enabled", pass.enabled)?;
        let params = lua.create_table()?;
        for (key, value) in &pass.params {
            match value {
                RenderParam::Bool(value) => params.set(key.as_str(), *value)?,
                RenderParam::Number(value) => params.set(key.as_str(), *value)?,
                RenderParam::Text(value) => params.set(key.as_str(), value.as_str())?,
            }
        }
        result.set("params", params)?;
        Ok(result)
    })?)?;
    Ok(api)
}

//! Portable table/buffer boundary for the batched geometry API.
use super::{ApiState, Lua, Table, Value};
use crate::diagnostics::InputDiagnostic;
use crate::runtime::spatial::SpatialJobs;
use crate::runtime::spatial_metrics::SpatialBindingSample;
use crate::spatial::{SpatialBody, SpatialQuery, pack_bodies, unpack_bodies_detailed, validate_bodies_detailed};
use serde::{Serialize, de::DeserializeOwned};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc, time::Instant};

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
type InputResult<T> = Result<T, InputDiagnostic>;

fn invalid(message: impl std::fmt::Display, path: &str, actual: serde_json::Value, expected: serde_json::Value) -> InputDiagnostic {
    InputDiagnostic::new(format!("SPATIAL_INPUT_INVALID: {message}"), path, actual, expected)
}

fn value_fact(value: &Value) -> serde_json::Value {
    match value {
        Value::Nil => serde_json::Value::Null,
        Value::Boolean(value) => (*value).into(),
        Value::Integer(value) => serde_json::json!(value),
        Value::Number(value) if value.is_finite() => serde_json::json!(value),
        Value::Number(value) => serde_json::json!(value.to_string()),
        Value::String(value) => serde_json::json!(value.to_string_lossy().chars().take(128).collect::<String>()),
        other => serde_json::json!({"type":other.type_name()}),
    }
}

fn to_json(value: Value, depth: usize, path: &str) -> InputResult<serde_json::Value> {
    if depth > 16 {
        return Err(invalid("table nesting exceeds 16", path, serde_json::json!(depth), serde_json::json!({"max_depth":16})));
    }
    match value {
        Value::Nil => Ok(serde_json::Value::Null),
        Value::Boolean(value) => Ok(value.into()),
        Value::Integer(value) => Ok(serde_json::json!(value)),
        Value::Number(value) if value.is_finite() => {
            if value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER {
                Ok(if value >= 0.0 { serde_json::json!(value as u64) } else { serde_json::json!(value as i64) })
            } else { Ok(serde_json::json!(value)) }
        }
        Value::Number(value) => Err(invalid("numbers must be finite", path, serde_json::json!(value.to_string()), serde_json::json!({"finite":true}))),
        Value::String(value) => value.to_str().map(|value| serde_json::json!(value.to_string()))
            .map_err(|message| invalid(message, path, serde_json::json!({"type":"string"}), serde_json::json!("UTF-8 string"))),
        Value::Table(table) => {
            let mut object = BTreeMap::new(); let mut array = BTreeMap::new();
            for pair in table.pairs::<Value, Value>() {
                let (key, value) = pair.map_err(|message| invalid(message, path, serde_json::json!({"type":"table"}), serde_json::json!("readable table")))?;
                match key {
                    Value::String(key) if array.is_empty() => {
                        let key = key.to_str().map_err(|message| invalid(message, path, serde_json::json!("invalid UTF-8 key"), serde_json::json!("UTF-8 field")))?.to_string();
                        let field_path = format!("{path}.{key}");
                        object.insert(key, to_json(value, depth + 1, &field_path)?);
                    }
                    Value::Integer(key) if key > 0 && object.is_empty() => {
                        array.insert(key as u64, to_json(value, depth + 1, &format!("{path}[{key}]"))?);
                    }
                    Value::Number(key) if key.is_finite() && key > 0.0 && key <= MAX_SAFE_INTEGER && key.fract() == 0.0 && object.is_empty() => {
                        array.insert(key as u64, to_json(value, depth + 1, &format!("{path}[{}]", key as u64))?);
                    }
                    other => return Err(invalid("use string fields or a contiguous array, without mixing keys", path,
                        value_fact(&other), serde_json::json!("string fields or contiguous positive integer array keys, without mixing"))),
                }
            }
            if array.is_empty() { Ok(serde_json::Value::Object(object.into_iter().collect())) }
            else {
                if !array.keys().copied().eq(1..=array.len() as u64) {
                    return Err(invalid("array keys must be contiguous starting at 1", path,
                        serde_json::json!(array.keys().take(16).collect::<Vec<_>>()), serde_json::json!({"first_index":1,"contiguous":true})));
                }
                Ok(serde_json::Value::Array(array.into_values().collect()))
            }
        }
        other => Err(invalid(format!("unsupported value {}", other.type_name()), path, value_fact(&other), serde_json::json!("JSON-compatible table fields"))),
    }
}

// Structural facts are generated from the schema, never by parsing serde's
// wording. The original serde error remains the thrown compatibility message.
trait InputSchema {
    const ROOT: &'static str;
    fn schema_issue(value: &serde_json::Value) -> Option<(String, serde_json::Value, serde_json::Value)>;
}

fn record_issue(value: &serde_json::Value, root: &str, allowed: &[&str], required: &[&str]) -> Option<(String, serde_json::Value, serde_json::Value)> {
    let Some(object) = value.as_object() else { return Some((root.into(), value.clone(), serde_json::json!("record"))); };
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) { return Some((format!("{root}.{key}"), object[key].clone(), serde_json::json!({"allowed_fields":allowed}))); }
    }
    for field in required {
        if !object.contains_key(*field) { return Some((format!("{root}.{field}"), serde_json::Value::Null, serde_json::json!({"required":true}))); }
    }
    for (field, value) in object {
        let path = format!("{root}.{field}");
        if ["id","category","mask","exclude_id"].contains(&field.as_str()) && !(field == "exclude_id" && value.is_null()) {
            if !value.as_u64().is_some_and(|n| n <= u32::MAX as u64) { return Some((path, value.clone(), serde_json::json!({"type":"integer","min":0,"max":u32::MAX}))); }
        }
        if ["position","previous_position","point","center","from","to"].contains(&field.as_str()) && !(field == "previous_position" && value.is_null()) {
            let Some(array) = value.as_array().filter(|array| array.len() == 3) else { return Some((path, value.clone(), serde_json::json!({"type":"number_array","count":3}))); };
            for (index, coordinate) in array.iter().enumerate() {
                if !coordinate.is_number() { return Some((format!("{path}[{}]",index+1), coordinate.clone(), serde_json::json!("finite number"))); }
            }
        }
        if ["radius","max_distance"].contains(&field.as_str()) && !value.is_number() { return Some((path, value.clone(), serde_json::json!("finite number"))); }
    }
    None
}

impl InputSchema for SpatialBody {
    const ROOT: &'static str = "bodies";
    fn schema_issue(value: &serde_json::Value) -> Option<(String, serde_json::Value, serde_json::Value)> {
        record_issue(value, "", &["id","category","position","radius","previous_position"], &["id","position","radius"])
    }
}
impl InputSchema for SpatialQuery {
    const ROOT: &'static str = "queries";
    fn schema_issue(value: &serde_json::Value) -> Option<(String, serde_json::Value, serde_json::Value)> {
        let Some(kind) = value.get("kind").and_then(serde_json::Value::as_str) else { return Some((".kind".into(),value.get("kind").cloned().unwrap_or_default(),serde_json::json!(["nearest","overlap_sphere","sweep_sphere"]))); };
        let (allowed, required): (&[&str], &[&str]) = match kind {
            "nearest" => (&["kind","point","max_distance","mask","exclude_id"], &["kind","point","max_distance"]),
            "overlap_sphere" => (&["kind","center","radius","mask","exclude_id"], &["kind","center","radius"]),
            "sweep_sphere" => (&["kind","from","to","radius","mask","exclude_id"], &["kind","from","to","radius"]),
            _ => return Some((".kind".into(),serde_json::json!(kind),serde_json::json!(["nearest","overlap_sphere","sweep_sphere"]))),
        };
        record_issue(value, "", allowed, required)
    }
}

fn decode_array<T: DeserializeOwned + InputSchema>(value: Value, limit: usize) -> InputResult<Vec<T>> {
    let Value::Table(table) = value else { return Err(invalid("expected an array table", T::ROOT, value_fact(&value), serde_json::json!("array table"))); };
    if table.raw_len() > limit { return Err(invalid(format!("array count exceeds {limit}"), T::ROOT, serde_json::json!(table.raw_len()), serde_json::json!({"max_count":limit}))); }
    let mut value = to_json(Value::Table(table), 0, T::ROOT)?;
    if value.as_object().is_some_and(|object| object.is_empty()) { value = serde_json::Value::Array(Vec::new()); }
    let array: Vec<T> = serde_json::from_value(value.clone()).map_err(|message| {
        if let Some(array) = value.as_array() {
            for (index, record) in array.iter().enumerate() {
                if let Some((path,actual,expected)) = T::schema_issue(record) {
                    return invalid(message, &format!("{}[{}]{path}", T::ROOT,index+1), actual, expected);
                }
            }
        }
        invalid(message, T::ROOT, serde_json::json!({"type":if value.is_array(){"array"}else{"record"}}), serde_json::json!("array of valid records"))
    })?;
    if array.len() > limit { return Err(invalid(format!("array count exceeds {limit}"), T::ROOT, serde_json::json!(array.len()), serde_json::json!({"max_count":limit}))); }
    Ok(array)
}

fn bodies(value: Value) -> InputResult<Vec<SpatialBody>> {
    match value {
        Value::Buffer(buffer) => {
            let maximum = 8 + crate::spatial::MAX_BODIES * crate::spatial::PACKED_BODY_BYTES;
            if buffer.len() > maximum { return Err(invalid("packed body buffer exceeds limit", "bodies.byte_length", serde_json::json!(buffer.len()), serde_json::json!({"max":maximum}))); }
            unpack_bodies_detailed(&buffer.to_vec()).map_err(|mut issue| { issue.message = format!("SPATIAL_INPUT_INVALID: {}",issue.message); issue })
        }
        value => decode_array(value, crate::spatial::MAX_BODIES),
    }
}

fn handle(value: Value) -> InputResult<u64> {
    let actual = value_fact(&value);
    let number = match value { Value::Integer(value) => value as f64, Value::Number(value) => value, _ => f64::NAN };
    if !number.is_finite() || number <= 0.0 || number > MAX_SAFE_INTEGER || number.fract() != 0.0 {
        return Err(invalid("handle must be a positive safe integer", "handle", actual, serde_json::json!({"type":"integer","min":1,"max":9_007_199_254_740_991u64})));
    }
    Ok(number as u64)
}

fn boundary<T>(spatial: &Rc<RefCell<SpatialJobs>>, operation: &str, result: InputResult<T>, index: Option<u64>, ticket: Option<u64>) -> mlua::Result<T> {
    result.map_err(|mut issue| {
        if issue.path == "handle" { issue.path = if matches!(operation,"spatial.take"|"spatial.cancel") {"ticket"} else {"index"}.into(); }
        mlua::Error::RuntimeError(spatial.borrow().record_input(operation, issue, index, ticket))
    })
}

fn encode_json(lua: &Lua, value: serde_json::Value) -> mlua::Result<Value> { super::value::observation_json_to_lua(lua, value) }
fn encode<T: Serialize>(lua: &Lua, value: T) -> mlua::Result<Value> { encode_json(lua, serde_json::to_value(value).map_err(mlua::Error::external)?) }

struct BindingTimer { sample: SpatialBindingSample, started: Instant, phase: u8 }
impl BindingTimer {
    fn decoded(&mut self) { self.sample.input_decode_ms = self.started.elapsed().as_secs_f64()*1000.0; self.phase=0; }
    fn encoding(&mut self) { self.started=Instant::now(); self.phase=2; }
    fn finish(&mut self) {
        if self.phase==1 { self.sample.input_decode_ms=self.started.elapsed().as_secs_f64()*1000.0; }
        if self.phase==2 { self.sample.output_encode_ms=self.started.elapsed().as_secs_f64()*1000.0; }
    }
}
fn measured<T>(spatial: &Rc<RefCell<SpatialJobs>>, operation: &'static str, work: impl FnOnce(&mut BindingTimer)->mlua::Result<T>) -> mlua::Result<T> {
    let mut timer=BindingTimer { sample: SpatialBindingSample {operation,success:false,input_decode_ms:0.0,output_encode_ms:0.0,index:None,ticket:None}, started:Instant::now(),phase:1 };
    let result=work(&mut timer);timer.finish();timer.sample.success=result.is_ok();
    spatial.borrow_mut().record_binding(timer.sample);result
}

pub(super) fn bind(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let api = lua.create_table()?;
    let spatial = Rc::clone(&state.spatial);
    api.set("pack", lua.create_function(move |lua, value: Value| measured(&spatial,"spatial.pack",|timer| {
        let bodies: Vec<SpatialBody> = boundary(&spatial,"spatial.pack",decode_array(value,crate::spatial::MAX_BODIES),None,None)?;
        boundary(&spatial,"spatial.pack",validate_bodies_detailed(&bodies).map_err(|mut issue| {issue.message=format!("SPATIAL_INPUT_INVALID: {}",issue.message);issue}),None,None)?;
        timer.decoded();timer.encoding();
        lua.create_buffer(pack_bodies(&bodies).expect("validated bodies can be packed"))
    }))?)?;
    let spatial = Rc::clone(&state.spatial);
    api.set("create", lua.create_function(move |_, value: Value| measured(&spatial,"spatial.create",|timer| {
        let bodies = boundary(&spatial,"spatial.create",bodies(value),None,None)?;
        timer.decoded();let id=spatial.borrow_mut().create(bodies).map_err(mlua::Error::RuntimeError)?;
        timer.sample.index=Some(id);Ok(id as f64)
    }))?)?;
    let spatial = Rc::clone(&state.spatial);
    api.set("update", lua.create_function(move |_, (id,value):(Value,Value)| measured(&spatial,"spatial.update",|timer| {
        let id=boundary(&spatial,"spatial.update",handle(id),None,None)?;
        timer.sample.index=Some(id);
        let bodies=boundary(&spatial,"spatial.update",bodies(value),Some(id),None)?;
        timer.decoded();
        spatial.borrow_mut().update(id,bodies).map(|version|version as f64).map_err(mlua::Error::RuntimeError)
    }))?)?;
    let spatial = Rc::clone(&state.spatial);
    api.set("destroy", lua.create_function(move |_, id:Value| measured(&spatial,"spatial.destroy",|timer| {
        let id=boundary(&spatial,"spatial.destroy",handle(id),None,None)?;
        timer.sample.index=Some(id);timer.decoded();
        spatial.borrow_mut().destroy(id).map_err(mlua::Error::RuntimeError)
    }))?)?;
    let spatial = Rc::clone(&state.spatial);
    api.set("submit", lua.create_function(move |_, (id,value):(Value,Value)| measured(&spatial,"spatial.submit",|timer| {
        let context_index=handle(id.clone()).ok();
        timer.sample.index=context_index;
        let queries:Vec<SpatialQuery>=boundary(&spatial,"spatial.submit",decode_array(value,crate::spatial::MAX_QUERIES),context_index,None)?;
        let id=boundary(&spatial,"spatial.submit",handle(id),None,None)?;
        timer.decoded();let ticket=spatial.borrow_mut().submit(id,queries).map_err(mlua::Error::RuntimeError)?;
        timer.sample.ticket=Some(ticket);Ok(ticket as f64)
    }))?)?;
    let spatial = Rc::clone(&state.spatial);
    api.set("take", lua.create_function(move |lua,id:Value| measured(&spatial,"spatial.take",|timer| {
        let id=boundary(&spatial,"spatial.take",handle(id),None,None)?;
        timer.sample.ticket=Some(id);timer.decoded();
        let result=spatial.borrow_mut().take(id).map_err(mlua::Error::RuntimeError)?;
        timer.encoding();encode(lua,result)
    }))?)?;
    let spatial = Rc::clone(&state.spatial);
    api.set("cancel", lua.create_function(move |_,id:Value| measured(&spatial,"spatial.cancel",|timer| {
        let id=boundary(&spatial,"spatial.cancel",handle(id),None,None)?;
        timer.sample.ticket=Some(id);timer.decoded();
        spatial.borrow_mut().cancel(id).map_err(mlua::Error::RuntimeError)
    }))?)?;
    let spatial = Rc::clone(&state.spatial);
    api.set("info",lua.create_function(move |lua,()|encode(lua,spatial.borrow().info()))?)?;
    let spatial = Rc::clone(&state.spatial);
    api.set("profile",lua.create_function(move |lua,()|encode(lua,spatial.borrow().profile()))?)?;
    let spatial = Rc::clone(&state.spatial);
    api.set("lastDiagnostic",lua.create_function(move |lua,()|encode(lua,spatial.borrow().last_diagnostic()))?)?;
    Ok(api)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_arrays_and_full_unsigned_ids_are_portable() {
        let lua = Lua::new();
        let empty: Vec<SpatialBody> = decode_array(Value::Table(lua.create_table().unwrap()), 1).unwrap();
        assert!(empty.is_empty());
        let table = lua.load("return {{id=4294967295,position={1,2,3},radius=0,category=4294967295}}")
            .eval::<Value>().unwrap();
        let decoded: Vec<SpatialBody> = decode_array(table, 1).unwrap();
        assert_eq!(decoded[0].id, u32::MAX);
        assert_eq!(decoded[0].category, u32::MAX);
        assert!(matches!(encode(&lua, 9_007_199_254_740_991u64).unwrap(), Value::Number(n) if n == MAX_SAFE_INTEGER));
    }

    #[test]
    fn invalid_array_keys_unknown_fields_and_handles_are_rejected() {
        let lua = Lua::new();
        for source in [
            "return {[2]={id=1,position={0,0,0},radius=0}}",
            "return {[1]={id=1,position={0,0,0},radius=0},extra=1}",
            "return {{id=1,position={0,0,0},radius=0,team=2}}",
        ] {
            assert!(decode_array::<SpatialBody>(lua.load(source).eval().unwrap(), 5).is_err());
        }
        for value in [0.0, -1.0, f64::INFINITY, f64::NAN, 1.5, MAX_SAFE_INTEGER + 1.0] {
            assert!(handle(Value::Number(value)).is_err());
        }
    }
}

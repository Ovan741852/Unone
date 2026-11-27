use serde::{Serialize, Serializer, ser::SerializeMap};
use serde_json::{Value, value::RawValue};
use std::{collections::BTreeMap, ops::Index, sync::{Arc, OnceLock}};

#[derive(Debug)]
struct Field {
    value: Value,
    compact: OnceLock<Box<RawValue>>,
}

/// A snapshot shares both its sorted index and the immutable values it refers
/// to. A write with older snapshots alive copies the index on first write.
/// Replacing one value never copies another field's arrays or objects.
#[derive(Debug, Default, Clone)]
pub struct ObservationFields(Arc<BTreeMap<Arc<str>, Arc<Field>>>);

impl ObservationFields {
    fn replace(&mut self, key: String, value: Value) -> Option<Arc<Field>> {
        let fields = Arc::make_mut(&mut self.0);
        let next = Arc::new(Field { value, compact: OnceLock::new() });
        if let Some(old) = fields.get_mut(key.as_str()) {
            Some(std::mem::replace(old, next))
        } else {
            fields.insert(key.into(), next)
        }
    }

    pub(crate) fn set(&mut self, key: String, value: Value) {
        self.replace(key, value);
    }

    pub fn insert(&mut self, key: String, value: Value) -> Option<Value> {
        self.replace(key, value).map(|old| match Arc::try_unwrap(old) {
            Ok(field) => field.value,
            Err(shared) => shared.value.clone(),
        })
    }
    pub fn clear(&mut self) { *self = Self::default(); }
    pub fn get(&self, key: &str) -> Option<&Value> { self.0.get(key).map(|field| &field.value) }
    pub fn contains_key(&self, key: &str) -> bool { self.0.contains_key(key) }
    pub fn len(&self) -> usize { self.0.len() }
    pub fn is_empty(&self) -> bool { self.0.is_empty() }
    pub fn iter(&self) -> impl ExactSizeIterator<Item = (&str, &Value)> {
        self.0.iter().map(|(key, field)| (key.as_ref(), &field.value))
    }
    pub(crate) fn to_owned_map(&self) -> BTreeMap<String, Value> {
        self.iter().map(|(key, value)| (key.to_owned(), value.clone())).collect()
    }

    /// Exact compact JSON for the official player's canonical byte stream.
    /// Only container-sized values need an encoded copy. All other serializers
    /// continue to see ordinary JSON values (including pretty printers).
    pub fn compact_json(&self) -> impl Serialize + '_ {
        struct Compact<'a>(&'a ObservationFields);
        impl Serialize for Compact<'_> {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                let mut map = serializer.serialize_map(Some(self.0.len()))?;
                for (key, field) in self.0.0.iter() {
                    let retain = match &field.value {
                        Value::Array(values) => values.len() >= 8,
                        Value::Object(values) => values.len() >= 8,
                        Value::String(text) => text.len() >= 1024,
                        _ => false,
                    };
                    if retain {
                        let bytes = field.compact.get_or_init(|| {
                            serde_json::value::to_raw_value(&field.value).expect("JSON value is serializable")
                        });
                        map.serialize_entry(key, bytes)?;
                    } else {
                        map.serialize_entry(key, &field.value)?;
                    }
                }
                map.end()
            }
        }
        Compact(self)
    }
}

impl Index<&str> for ObservationFields {
    type Output = Value;
    fn index(&self, key: &str) -> &Value { &self.0[key].value }
}
impl PartialEq for ObservationFields {
    fn eq(&self, other: &Self) -> bool { Arc::ptr_eq(&self.0, &other.0) || self.iter().eq(other.iter()) }
}
impl Serialize for ObservationFields {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.iter())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn retained_snapshots_share_untouched_fields_and_preserve_exact_bytes() {
        let mut fields = ObservationFields::default();
        fields.set("people".into(), json!([{"名":"字\\\""}, [], {}, null, false, 1.0e-220, -0.0, 2]));
        fields.set("x".into(), json!(1));
        let before = fields.clone();
        let expected = serde_json::to_vec(&fields.to_owned_map()).unwrap();
        assert_eq!(serde_json::to_vec(&before).unwrap(), expected);
        assert_eq!(serde_json::to_vec(&before.compact_json()).unwrap(), expected);
        fields.set("x".into(), json!(2));
        assert!(std::ptr::eq(&before["people"], &fields["people"]));
        assert_eq!(before["x"], 1);
        assert_eq!(fields["x"], 2);
        assert_eq!(serde_json::to_vec(&fields.compact_json()).unwrap(), serde_json::to_vec(&fields).unwrap());
        fields.clear();
        assert_eq!(serde_json::to_vec(&before.compact_json()).unwrap(), expected);
    }
}

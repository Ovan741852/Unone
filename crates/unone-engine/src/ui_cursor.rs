//! Reusable Web-host cursor declaration. Games own sprite choice and timing.
use serde::{Deserialize,Serialize};

#[derive(Debug,Clone,PartialEq,Deserialize,Serialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(rename_all="snake_case")]
pub enum CursorFilter { Nearest, Linear }

#[derive(Debug,Clone,PartialEq,Deserialize,Serialize)]
#[cfg_attr(feature="dev-tools",derive(schemars::JsonSchema))]
#[serde(tag="kind",rename_all="snake_case",deny_unknown_fields)]
pub enum UiCursor {
    Default,
    Hidden,
    Image {asset:String,width:u32,height:u32,hotspot_x:u32,hotspot_y:u32,filter:CursorFilter},
}

impl UiCursor {
    pub fn from_json(value:serde_json::Value)->Result<Self,String> {
        let object=value.as_object().ok_or("UI_CURSOR_INVALID: object required")?;
        let allowed:&[&str]=if object.get("kind").and_then(|v|v.as_str())==Some("image") {
            &["kind","asset","width","height","hotspot_x","hotspot_y","filter"]
        }else {&["kind"]};
        if object.keys().any(|key|!allowed.contains(&key.as_str())) {
            return Err("UI_CURSOR_INVALID: unknown declaration field".into());
        }
        let cursor:Self=serde_json::from_value(value).map_err(|e|format!("UI_CURSOR_INVALID: {e}"))?;
        if let Self::Image {asset,width,height,hotspot_x,hotspot_y,..}=&cursor {
            if !(asset.starts_with("texture://")||asset.starts_with("asset://"))||asset.len()>512
                ||asset.trim()!=asset||*width==0||*height==0||*width>512||*height>512
                ||*hotspot_x>=*width||*hotspot_y>=*height {
                return Err("UI_CURSOR_INVALID: declared image asset, integer1..512 pixel dimensions and in-image hotspot required".into());
            }
        }
        Ok(cursor)
    }
}

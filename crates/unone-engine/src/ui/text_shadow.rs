use serde::{Deserialize, Serialize};
use super::UiRect;

/// A sharp copy of the foreground glyph layout, painted before foreground.
/// Offsets use viewport-height design units (1 = 1% viewport height); positive
/// x is right and positive y is down. No blur, second shaping, or font changes.
/// Each pass clips to its own translated content rectangle, then parent/viewport.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiTextShadow {
    pub offset_x: f64,
    pub offset_y: f64,
    pub color: [f64; 4],
}

impl UiTextShadow {
    pub fn validate(&self) -> Result<(), String> {
        if [self.offset_x,self.offset_y].iter().any(|v|!v.is_finite() || !(-100.0..=100.0).contains(v)) {
            return Err("UI_TEXT_SHADOW_INVALID: offsets must be finite viewport-height units in -100..100".into());
        }
        if self.color.iter().any(|v|!v.is_finite() || !(0.0..=1.0).contains(v)) {
            return Err("UI_TEXT_SHADOW_INVALID: color requires four finite RGBA values in 0..1".into());
        }
        Ok(())
    }

    /// Conservative visible paint envelope. The authored/hit rectangle is
    /// unchanged. Stage y is up, so a positive shadow y extends downward.
    pub fn paint_rect(&self, rect: UiRect, aspect: f64) -> UiRect {
        let dx=self.offset_x/aspect;
        let dy=-self.offset_y;
        let left=rect.x.min(rect.x+dx).max(0.0);
        let bottom=rect.y.min(rect.y+dy).max(0.0);
        let right=(rect.x+rect.width).max(rect.x+rect.width+dx).min(100.0);
        let top=(rect.y+rect.height).max(rect.y+rect.height+dy).min(100.0);
        UiRect{x:left,y:bottom,width:(right-left).max(0.0),height:(top-bottom).max(0.0)}
    }
}

use crate::{Diagnostic, UiInsets, UiRect};

/// Stage coordinates span 0..100 on each axis. Insets are measured inward from
/// their named physical edge, independently of the requested UI rect origin.
#[derive(Debug, Clone, Copy)]
pub(super) struct UiViewportState {
    pub aspect: f64,
    pub revision: u64,
    pub insets: UiInsets,
}

impl UiViewportState {
    pub fn new(aspect: f64) -> Self {
        Self {
            aspect,
            revision: 0,
            insets: UiInsets::default(),
        }
    }

    pub fn set_insets(&mut self, values: [f64; 4]) -> Result<(), Box<Diagnostic>> {
        let [left, top, right, bottom] = values;
        if values.iter().any(|n| !n.is_finite() || *n < 0.0)
            || left + right >= 100.0
            || top + bottom >= 100.0
        {
            return Err(Box::new(Diagnostic::error(
                "VIEWPORT_SAFE_AREA_INVALID",
                "Safe-area insets must be finite and nonnegative, and leave a positive usable width and height",
                format!("The host supplied {values:?} in percent of the stage axes."),
            )));
        }
        let insets = UiInsets {
            left,
            top,
            right,
            bottom,
        };
        if self.insets != insets {
            self.insets = insets;
            self.revision += 1;
        }
        Ok(())
    }

    pub fn safe_rect(self) -> UiRect {
        let UiInsets {
            left,
            right,
            top,
            bottom,
        } = self.insets;
        UiRect {
            x: left,
            y: bottom,
            width: 100.0 - (left + right),
            height: 100.0 - (top + bottom),
        }
    }

    pub fn fit(self, local: UiRect) -> UiRect {
        let safe = self.safe_rect();
        UiRect {
            x: safe.x + local.x * safe.width / 100.0,
            y: safe.y + local.y * safe.height / 100.0,
            width: local.width * safe.width / 100.0,
            height: local.height * safe.height / 100.0,
        }
    }
}

//! Colours of the official players' startup screen (docs/player-export.md#startup-screen).
//! The Web exporter writes them into the player page and the native player
//! draws with them, so both hosts derive them from one place.

/// The players' own dark background and its light text, bar and error colours.
pub const STARTUP_DARK: StartupTheme = StartupTheme {
    background: [0x11, 0x18, 0x27],
    foreground: [0xf3, 0xf4, 0xf6],
    accent: [0x38, 0xbd, 0xf8],
    error: [0xf8, 0x71, 0x71],
};
/// Dark text, and a darker bar and error colour, for a light background.
const LIGHT_FOREGROUND: [u8; 3] = [0x11, 0x18, 0x27];
const LIGHT_ACCENT: [u8; 3] = [0x03, 0x69, 0xa1];
const LIGHT_ERROR: [u8; 3] = [0xb9, 0x1c, 0x1c];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupTheme {
    pub background: [u8; 3],
    pub foreground: [u8; 3],
    pub accent: [u8; 3],
    pub error: [u8; 3],
}

impl StartupTheme {
    /// The theme for a declared `#rrggbb` background, or the players' own
    /// when none is declared. The text turns dark when dark text contrasts
    /// more with the background (WCAG relative luminance).
    pub fn for_background(background: Option<&str>) -> Result<Self, String> {
        let Some(text) = background else { return Ok(STARTUP_DARK) };
        let background = parse_hex_color(text)
            .ok_or_else(|| format!("STARTUP_BACKGROUND_INVALID: startup.background must be a #rrggbb colour: {text}"))?;
        let luminance = relative_luminance(background);
        let dark = (luminance + 0.05) / (relative_luminance(LIGHT_FOREGROUND) + 0.05);
        let light = (relative_luminance(STARTUP_DARK.foreground) + 0.05) / (luminance + 0.05);
        Ok(if dark > light {
            Self { background, foreground: LIGHT_FOREGROUND, accent: LIGHT_ACCENT, error: LIGHT_ERROR }
        } else {
            Self { background, ..STARTUP_DARK }
        })
    }
    /// Whether this theme uses the dark-text colours of a light background.
    pub fn is_light(&self) -> bool {
        self.foreground == LIGHT_FOREGROUND
    }
}

pub fn parse_hex_color(text: &str) -> Option<[u8; 3]> {
    let digits = text.strip_prefix('#').filter(|digits| digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_hexdigit()))?;
    let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

/// Lower-case `#rrggbb`.
pub fn hex_color(color: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2])
}

fn relative_luminance(color: [u8; 3]) -> f64 {
    let channel = |value: u8| {
        let value = f64::from(value) / 255.0;
        if value <= 0.04045 { value / 12.92 } else { ((value + 0.055) / 1.055).powf(2.4) }
    };
    0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn light_backgrounds_get_dark_text_and_darker_colours() {
        let light = StartupTheme::for_background(Some("#F5F0E6")).unwrap();
        assert_eq!(hex_color(light.background), "#f5f0e6");
        assert!(light.is_light());
        assert_eq!([hex_color(light.foreground), hex_color(light.accent), hex_color(light.error)], ["#111827", "#0369a1", "#b91c1c"]);
        let dark = StartupTheme::for_background(Some("#0a0a20")).unwrap();
        assert!(!dark.is_light());
        assert_eq!(StartupTheme { background: STARTUP_DARK.background, ..dark }, STARTUP_DARK);
        assert_eq!(StartupTheme::for_background(None).unwrap(), STARTUP_DARK);
        for invalid in ["teal", "#12345", "#1234567", "123456", "#12345g", "#ééé"] {
            assert!(StartupTheme::for_background(Some(invalid)).unwrap_err().contains("STARTUP_BACKGROUND_INVALID"), "{invalid}");
        }
    }
}

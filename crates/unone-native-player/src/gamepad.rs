//! Gamepads for the native player (docs/input-gamepad.md). On Windows up to
//! four XInput controllers are read each tick; other targets report none yet.
//! Buttons become the actions Gamepad_<name> and Gamepad<slot>_<name>; sticks
//! and triggers go raw into the input frame, where replays record them.
use unone_engine::{GamepadInput, InputFrame};

/// One XInput controller's packed state (XINPUT_GAMEPAD).
#[derive(Clone, Copy, Default, Debug, PartialEq)]
#[repr(C)]
pub struct XInputGamepad {
    pub buttons: u16,
    pub left_trigger: u8,
    pub right_trigger: u8,
    pub thumb_lx: i16,
    pub thumb_ly: i16,
    pub thumb_rx: i16,
    pub thumb_ry: i16,
}

/// XInput button bits by engine button name. XInputGetState does not report
/// the guide button, so Home never arrives from XInput.
const BITS: [(u16, &str); 14] = [
    (0x1000, "A"), (0x2000, "B"), (0x4000, "X"), (0x8000, "Y"), (0x0100, "LB"), (0x0200, "RB"), (0x0020, "Back"),
    (0x0010, "Start"), (0x0040, "LS"), (0x0080, "RS"), (0x0001, "Up"), (0x0002, "Down"), (0x0004, "Left"), (0x0008, "Right"),
];
/// XINPUT_GAMEPAD_TRIGGER_THRESHOLD: a trigger counts as the LT/RT button past it.
const TRIGGER_THRESHOLD: u8 = 30;

/// One controller as the engine sees it: raw axes and the pressed buttons.
#[derive(Clone, Debug, PartialEq)]
pub struct Pad {
    pub state: GamepadInput,
    pub buttons: Vec<&'static str>,
}

/// Engine values from XInput's: thumbs to [-1, 1] (y already up), triggers to [0, 1].
pub fn from_xinput(slot: u8, pad: &XInputGamepad) -> Pad {
    let thumb = |value: i16| (value as f64 / 32767.).clamp(-1., 1.);
    let mut buttons: Vec<&'static str> = BITS.iter().filter(|(bit, _)| pad.buttons & bit != 0).map(|(_, name)| *name).collect();
    if pad.left_trigger > TRIGGER_THRESHOLD { buttons.push("LT"); }
    if pad.right_trigger > TRIGGER_THRESHOLD { buttons.push("RT"); }
    Pad {
        state: GamepadInput {
            slot,
            left_x: thumb(pad.thumb_lx),
            left_y: thumb(pad.thumb_ly),
            right_x: thumb(pad.thumb_rx),
            right_y: thumb(pad.thumb_ry),
            left_trigger: pad.left_trigger as f64 / 255.,
            right_trigger: pad.right_trigger as f64 / 255.,
        },
        buttons,
    }
}

/// Add the pads to a live input frame: their buttons as actions (combined by
/// OR with other sources) and their axes.
pub fn apply(pads: &[Pad], input: &mut InputFrame) {
    for pad in pads {
        for button in &pad.buttons {
            input.actions.insert(format!("Gamepad_{button}"), true);
            input.actions.insert(format!("Gamepad{}_{button}", pad.state.slot), true);
        }
        input.gamepads.push(pad.state.clone());
    }
}

#[cfg(any(target_os="ios", test))]
#[derive(Default)]
pub(crate) struct EmbeddedPads([Option<Pad>; 4]);

#[cfg(any(target_os="ios", test))]
impl EmbeddedPads {
    pub(crate) fn update(&mut self, slot: u8, connected: bool, state: XInputGamepad) {
        if (1..=4).contains(&slot) {
            self.0[(slot-1) as usize] = connected.then(|| from_xinput(slot, &state));
        }
    }
    pub(crate) fn apply(&self, input: &mut InputFrame) {
        for pad in self.0.iter().flatten() { apply(std::slice::from_ref(pad), input); }
    }
}

#[cfg(test)]
#[test]
fn embedded_pads_replace_only_the_addressed_slot_and_release_on_disconnect() {
    let mut pads = EmbeddedPads::default();
    pads.update(1, true, XInputGamepad {buttons:0x1000, ..Default::default()});
    pads.update(2, true, XInputGamepad {buttons:0x4000, thumb_lx:i16::MAX, ..Default::default()});
    pads.update(1, false, Default::default());
    let mut input = InputFrame::default();
    pads.apply(&mut input);
    assert!(!input.actions.contains_key("Gamepad1_A"));
    assert_eq!(input.actions.get("Gamepad2_X"), Some(&true));
    assert_eq!(input.gamepads[0].left_x, 1.);
    assert_eq!(input.gamepads.len(), 1);
}

/// Live controllers. XInput is slow to query an empty slot, so slots that
/// were empty are checked again only every RETRY_TICKS ticks.
pub struct Gamepads {
    #[cfg(windows)]
    xinput: Option<xinput::GetState>,
    connected: [bool; 4],
    ticks: u64,
}

const RETRY_TICKS: u64 = 120;

impl Gamepads {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            xinput: xinput::load(),
            connected: [false; 4],
            ticks: 0,
        }
    }

    pub fn poll(&mut self) -> Vec<Pad> {
        let retry = self.ticks % RETRY_TICKS == 0;
        self.ticks += 1;
        let mut pads = Vec::new();
        for index in 0..4u8 {
            if !self.connected[index as usize] && !retry {
                continue;
            }
            let state = self.read(index);
            self.connected[index as usize] = state.is_some();
            if let Some(state) = state {
                pads.push(from_xinput(index + 1, &state));
            }
        }
        pads
    }

    #[cfg(windows)]
    fn read(&self, index: u8) -> Option<XInputGamepad> {
        let get_state = self.xinput?;
        let mut state = xinput::State::default();
        // SAFETY: XInputGetState writes one XINPUT_STATE for a user index 0-3.
        (unsafe { get_state(index as u32, &mut state) } == 0).then_some(state.gamepad)
    }

    #[cfg(not(windows))]
    fn read(&self, _index: u8) -> Option<XInputGamepad> {
        None
    }
}

#[cfg(windows)]
mod xinput {
    use std::ffi::c_void;

    #[derive(Default)]
    #[repr(C)]
    pub struct State {
        packet: u32,
        pub gamepad: super::XInputGamepad,
    }

    pub type GetState = unsafe extern "system" fn(u32, *mut State) -> u32;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LoadLibraryA(name: *const u8) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
    }

    /// The newest installed XInput; none on a machine without it.
    pub fn load() -> Option<GetState> {
        for dll in [&b"xinput1_4.dll\0"[..], b"xinput1_3.dll\0", b"xinput9_1_0.dll\0"] {
            // SAFETY: null-terminated names; the module stays loaded for the process.
            let module = unsafe { LoadLibraryA(dll.as_ptr()) };
            if module.is_null() {
                continue;
            }
            let function = unsafe { GetProcAddress(module, b"XInputGetState\0".as_ptr()) };
            if !function.is_null() {
                // SAFETY: XInputGetState has exactly this signature.
                return Some(unsafe { std::mem::transmute::<*mut c_void, GetState>(function) });
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xinput_state_maps_to_engine_axes_and_button_names() {
        let pad = from_xinput(2, &XInputGamepad {
            buttons: 0x1000 | 0x0008 | 0x0010,
            left_trigger: 31,
            right_trigger: 10,
            thumb_lx: 32767,
            thumb_ly: -32768,
            thumb_rx: 0,
            thumb_ry: 16384,
        });
        assert_eq!(pad.buttons, ["A", "Start", "Right", "LT"]);
        assert_eq!((pad.state.slot, pad.state.left_x, pad.state.left_y), (2, 1., -1.));
        assert!((pad.state.right_y - 0.5).abs() < 1e-4 && (pad.state.left_trigger - 31. / 255.).abs() < 1e-12);
        assert!(GamepadInput::validate(&[pad.state.clone()]).is_ok());
        let mut frame = InputFrame::default();
        apply(&[pad], &mut frame);
        assert!(frame.actions.contains_key("Gamepad_A") && frame.actions.contains_key("Gamepad2_Start"));
        assert_eq!(frame.gamepads.len(), 1);
    }

    #[test]
    fn empty_slots_are_retried_rarely() {
        let mut pads = Gamepads::new();
        // With no controller (or not Windows) every poll is empty, and only
        // every RETRY_TICKS-th poll touches the empty slots.
        for _ in 0..3 {
            let _ = pads.poll();
        }
        assert_eq!(pads.ticks, 3);
    }
}

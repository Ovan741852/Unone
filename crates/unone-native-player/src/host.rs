//! What the player needs from whoever owns its window and run loop: winit's event loop on
//! desktop and Android, or a host app that owns the view and drives the player itself
//! (embed.rs, the iOS App shell). App and Launcher only talk to these two traits.
use crate::R;
use std::sync::Arc;
use winit::{
    dpi::PhysicalSize,
    event_loop::ActiveEventLoop,
    raw_window_handle::{HasDisplayHandle, HasWindowHandle},
    window::{Window, WindowAttributes, WindowId},
};

/// The surface the player draws into. wgpu creates its surface from the raw handles.
pub(crate) trait PlayerWindow: HasWindowHandle + HasDisplayHandle + Send + Sync {
    fn id(&self) -> WindowId;
    fn inner_size(&self) -> PhysicalSize<u32>;
    /// For a standalone UIKit window. Embedded views receive this from their owning host.
    #[cfg(target_os = "ios")]
    fn system_safe_area(&self) -> Option<[f64; 4]> { None }
    fn scale_factor(&self) -> f64;
    fn request_redraw(&self);
    fn set_visible(&self, visible: bool);
    /// A request only: the host may keep its size (an embedded view always does).
    fn request_inner_size(&self, size: PhysicalSize<u32>);
}

pub(crate) type SharedWindow = Arc<dyn PlayerWindow>;

#[cfg(any(target_os = "ios", test))]
fn window_insets_px(origin: [i32; 2], size: [u32; 2], safe_origin: [i32; 2], safe_size: [u32; 2]) -> [f64; 4] {
    let left = f64::from(safe_origin[0]) - f64::from(origin[0]);
    let top = f64::from(safe_origin[1]) - f64::from(origin[1]);
    // winit rounds each rectangle separately to whole pixels.
    [left.max(0.), top.max(0.), (f64::from(size[0]) - left - f64::from(safe_size[0])).max(0.),
        (f64::from(size[1]) - top - f64::from(safe_size[1])).max(0.)]
}

/// The native UI uses the entire Metal drawable as its stage, measured separately on each axis.
#[cfg(any(target_os = "ios", test))]
pub(crate) fn safe_area_percent(size: PhysicalSize<u32>, pixels: [f64; 4]) -> Option<[f64; 4]> {
    let [left, top, right, bottom] = pixels;
    let (width, height) = (f64::from(size.width), f64::from(size.height));
    if pixels.iter().any(|v| !v.is_finite() || *v < 0.) || left + right >= width || top + bottom >= height {
        return None;
    }
    Some([left / width * 100., top / height * 100., right / width * 100., bottom / height * 100.])
}

#[cfg(test)]
mod safe_area_tests {
    use super::*;

    #[test]
    fn host_safe_area_uses_each_drawable_axis_and_rejects_impossible_geometry() {
        assert_eq!(safe_area_percent(PhysicalSize::new(1200, 600), [60., 12., 30., 24.]), Some([5., 2., 2.5, 4.]));
        assert_eq!(safe_area_percent(PhysicalSize::new(600, 1200), [0., 60., 0., 24.]), Some([0., 5., 0., 2.]));
        assert_eq!(safe_area_percent(PhysicalSize::new(400, 200), [20., 4., 10., 8.]), Some([5., 2., 2.5, 4.]));
        assert_eq!(safe_area_percent(PhysicalSize::new(1200, 600), [0.; 4]), Some([0.; 4]));
        assert_eq!(safe_area_percent(PhysicalSize::new(0, 600), [0.; 4]), None);
        assert_eq!(safe_area_percent(PhysicalSize::new(1200, 600), [0., f64::NAN, 0., 0.]), None);
        assert_eq!(safe_area_percent(PhysicalSize::new(1200, 600), [0., 0., -1., 0.]), None);
        assert_eq!(safe_area_percent(PhysicalSize::new(1200, 600), [650., 0., 600., 0.]), None);
    }

    #[test]
    fn ios_fullscreen_and_safe_window_rects_share_a_screen_origin() {
        assert_eq!(window_insets_px([10, 20], [1200, 600], [70, 32], [1110, 564]), [60., 12., 30., 24.]);
        assert_eq!(window_insets_px([-30, 42], [600, 1200], [-30, 102], [600, 1116]), [0., 60., 0., 24.]);
    }
}

impl PlayerWindow for Window {
    fn id(&self) -> WindowId {
        Window::id(self)
    }
    fn inner_size(&self) -> PhysicalSize<u32> {
        // winit reports the UIKit safe rectangle as its "inner" window, but Metal and
        // touch events use the full view, the size delivered with WindowEvent::Resized.
        #[cfg(target_os = "ios")]
        { Window::outer_size(self) }
        #[cfg(not(target_os = "ios"))]
        { Window::inner_size(self) }
    }
    #[cfg(target_os = "ios")]
    fn system_safe_area(&self) -> Option<[f64; 4]> {
        let size = Window::outer_size(self);
        let safe_size = Window::inner_size(self);
        let origin = Window::outer_position(self).ok()?;
        let safe_origin = Window::inner_position(self).ok()?;
        let pixels = window_insets_px([origin.x, origin.y], [size.width, size.height],
            [safe_origin.x, safe_origin.y], [safe_size.width, safe_size.height]);
        safe_area_percent(size, pixels)
    }
    fn scale_factor(&self) -> f64 {
        Window::scale_factor(self)
    }
    fn request_redraw(&self) {
        Window::request_redraw(self)
    }
    fn set_visible(&self, visible: bool) {
        Window::set_visible(self, visible)
    }
    fn request_inner_size(&self, size: PhysicalSize<u32>) {
        let _ = Window::request_inner_size(self, size);
    }
}

/// The run loop the player lives in.
pub(crate) trait HostLoop {
    fn exit(&self);
    fn create_window(&self, attributes: WindowAttributes) -> R<SharedWindow>;
}

impl HostLoop for ActiveEventLoop {
    fn exit(&self) {
        ActiveEventLoop::exit(self)
    }
    fn create_window(&self, attributes: WindowAttributes) -> R<SharedWindow> {
        Ok(Arc::new(ActiveEventLoop::create_window(self, attributes).map_err(|e| e.to_string())?))
    }
}

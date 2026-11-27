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
    fn scale_factor(&self) -> f64;
    fn request_redraw(&self);
    fn set_visible(&self, visible: bool);
    /// A request only: the host may keep its size (an embedded view always does).
    fn request_inner_size(&self, size: PhysicalSize<u32>);
}

pub(crate) type SharedWindow = Arc<dyn PlayerWindow>;

impl PlayerWindow for Window {
    fn id(&self) -> WindowId {
        Window::id(self)
    }
    fn inner_size(&self) -> PhysicalSize<u32> {
        Window::inner_size(self)
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

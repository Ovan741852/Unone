//! On-demand native renderer readback. No desktop/window automation or steady-state copies.
use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};
use unone_engine::WorldSnapshot;
fn default_width() -> u32 {
    1280
}
fn default_height() -> u32 {
    720
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Method {
    Screenshot,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureRequest {
    #[serde(rename = "method")]
    _method: Method,
    #[serde(default = "default_width")]
    max_width: u32,
    #[serde(default = "default_height")]
    max_height: u32,
}
impl CaptureRequest {
    fn size(&self, width: u32, height: u32) -> Result<(u32, u32), String> {
        if !(16..=2048).contains(&self.max_width) || !(16..=2048).contains(&self.max_height) {
            return Err("CAPTURE_INVALID: max_width/max_height must be integers 16..2048".into());
        }
        let scale = (self.max_width as f64 / width.max(1) as f64)
            .min(self.max_height as f64 / height.max(1) as f64)
            .min(1.);
        Ok((
            (width as f64 * scale).floor().max(1.) as u32,
            (height as f64 * scale).floor().max(1.) as u32,
        ))
    }
}
impl crate::Renderer {
    pub fn capture(
        &mut self,
        snapshot: &WorldSnapshot,
        request: CaptureRequest,
    ) -> Result<Value, String> {
        let (width, height) = request.size(self.config.width, self.config.height)?;
        let bgra = match self.config.format {
            wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb => true,
            wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Rgba8UnormSrgb => false,
            _ => return Err("CAPTURE_UNSUPPORTED: native surface is not RGBA/BGRA8".into()),
        };
        let vertices = self.vertices(snapshot);
        self.ensure_vertex_buffer(vertices.len());
        if !vertices.is_empty() {
            self.queue
                .write_buffer(&self.vertex_buffer, 0, bytemuck::cast_slice(&vertices));
        }
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("unone-capture"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.config.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let stride = (width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("unone-capture-readback"),
            size: stride as u64 * height as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("unone-capture-encoder"),
            });
        self.draw_pass(&mut encoder, &view, vertices.len() as u32);
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: Some(height),
                },
            },
            size,
        );
        let submission = self.queue.submit([encoder.finish()]);
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                let _ = send.send(result);
            });
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: Some(submission),
                timeout: Some(std::time::Duration::from_secs(2)),
            })
            .map_err(|e| e.to_string())?;
        receive
            .recv_timeout(std::time::Duration::from_secs(1))
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        let mapped = buffer
            .slice(..)
            .get_mapped_range()
            .map_err(|e| e.to_string())?;
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        for row in mapped.chunks_exact(stride as usize) {
            pixels.extend_from_slice(&row[..width as usize * 4]);
        }
        drop(mapped);
        buffer.unmap();
        if bgra {
            for pixel in pixels.chunks_exact_mut(4) {
                pixel.swap(0, 2);
            }
        }
        let mut png_bytes = vec![];
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_compression(png::Compression::Fast);
            encoder
                .write_header()
                .map_err(|e| e.to_string())?
                .write_image_data(&pixels)
                .map_err(|e| e.to_string())?;
        }
        Ok(
            json!({"host":"native","mime_type":"image/png","width":width,"height":height,"frame":snapshot.frame,"observation_digest":unone_engine::observation_digest(snapshot).map_err(|e|e.to_string())?,"data_url":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(png_bytes)),"scope":"game_viewport","includes_ui":false,"source":"native_renderer","note":"Fresh render of this simulation frame using the same native draw path; no tick, desktop chrome or developer panel. Native renderer capabilities may differ from Web."}),
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_limits_keep_aspect_and_fail_on_typos() {
        let request: CaptureRequest =
            serde_json::from_value(json!({"method":"screenshot","max_width":640,"max_height":480}))
                .unwrap();
        assert_eq!(request.size(1920, 1080).unwrap(), (640, 360));
        assert!(
            serde_json::from_value::<CaptureRequest>(json!({"method":"screenshot","width":640}))
                .is_err()
        );
        let invalid: CaptureRequest =
            serde_json::from_value(json!({"method":"screenshot","max_width":9000})).unwrap();
        assert!(invalid.size(1920, 1080).is_err());
    }
}

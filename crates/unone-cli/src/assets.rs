//! Host-side asset resolution for the native preview.
//!
//! The engine owns bundle and archive integrity; this module owns the parts a
//! host must own: decoding, pixel format and GPU-ready buffers. It never
//! invents an asset, and it never hides a failed resolve behind a placeholder.

use std::{collections::BTreeMap, path::Path};

use unone_engine::{BundleManager, Diagnostic, load_asset_manifest};

pub struct HostTexture {
    pub id: String,
    pub width: u32,
    pub height: u32,
    /// Premultiplied RGBA8, ready for a texture upload.
    #[allow(
        dead_code,
        reason = "the preview renderer consumes this in the next slice"
    )]
    pub rgba: Vec<u8>,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Default)]
pub struct HostAssets {
    pub textures: BTreeMap<String, HostTexture>,
    pub notes: Vec<String>,
}

/// Resolve every declared 2D texture from the project's active bundle generation.
///
/// A project without an asset manifest is not an error: it simply has no host
/// textures. Every other failure is reported with the engine's semantic code so
/// the preview can say why a sprite is still drawn as a flat rectangle.
pub fn load_textures(project_root: &Path) -> HostAssets {
    let mut assets = HostAssets::default();
    let manifest = load_asset_manifest(project_root);
    let Some(manifest) = manifest.value else {
        for diagnostic in &manifest.diagnostics {
            if diagnostic.code != "ASSET_MANIFEST_MISSING" {
                assets.notes.push(note(diagnostic));
            }
        }
        return assets;
    };
    let manager = match BundleManager::from_project(project_root) {
        Ok(manager) => manager,
        Err(diagnostic) => {
            assets.notes.push(note(&diagnostic));
            return assets;
        }
    };
    for asset in &manifest.assets {
        if asset.kind != "texture2d" {
            continue;
        }
        let bytes = match manager.read_active_asset(asset) {
            Ok(bytes) => bytes,
            Err(diagnostic) => {
                assets
                    .notes
                    .push(format!("{}: {}", asset.id, note(&diagnostic)));
                continue;
            }
        };
        let sha256 = sha256_hex(&bytes);
        match decode_texture(&asset.source, &bytes) {
            Ok((width, height, rgba)) => {
                assets.textures.insert(
                    asset.id.clone(),
                    HostTexture {
                        id: asset.id.clone(),
                        width,
                        height,
                        rgba,
                        size_bytes: bytes.len() as u64,
                        sha256,
                    },
                );
            }
            Err(error) => assets.notes.push(format!(
                "{}: HOST_ASSET_DECODE_FAILED sha256={sha256} {error}",
                asset.id
            )),
        }
    }
    assets
}

/// Longest edge of a rasterized preview texture, in pixels.
const MAX_TEXTURE_EDGE: f32 = 512.0;

/// Decode one asset source into premultiplied RGBA8.
///
/// The native preview host currently understands SVG only. Any other extension
/// is reported instead of silently skipped, because "which host decodes which
/// source format" is an open cross-platform question, not a solved one.
fn decode_texture(source: &str, bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    if !source.to_ascii_lowercase().ends_with(".svg") {
        return Err(format!(
            "native preview host 目前只解碼 SVG source，'{source}' 需要其他 decoder"
        ));
    }
    let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default())
        .map_err(|error| format!("SVG 解析失敗：{error}"))?;
    let size = tree.size();
    let longest = size.width().max(size.height());
    if !longest.is_finite() || longest <= 0.0 {
        return Err("SVG 沒有可用的尺寸".to_string());
    }
    let scale = (MAX_TEXTURE_EDGE / longest).clamp(f32::EPSILON, 1.0);
    let width = (size.width() * scale).ceil().max(1.0) as u32;
    let height = (size.height() * scale).ceil().max(1.0) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| format!("無法建立 {width}x{height} pixmap"))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    Ok((width, height, pixmap.take()))
}

fn note(diagnostic: &Diagnostic) -> String {
    format!("{} {}", diagnostic.code, diagnostic.explanation)
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::decode_texture;

    #[test]
    fn decodes_svg_into_premultiplied_rgba() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#ff0000"/></svg>"##;
        let (width, height, rgba) = decode_texture("assets/red.svg", svg).unwrap();
        assert_eq!((width, height), (8, 4));
        assert_eq!(rgba.len(), 8 * 4 * 4);
        assert_eq!(&rgba[0..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn reports_source_formats_this_host_cannot_decode() {
        let error = decode_texture("assets/bird.png", b"not-a-png").unwrap_err();
        assert!(error.contains("decoder"), "{error}");
    }
}

//! Host-side asset resolution for the native preview.
//!
//! The engine owns bundle and archive integrity; this module owns the parts a
//! host must own: decoding, pixel format and GPU-ready buffers. It never
//! invents an asset, and it never hides a failed resolve behind a placeholder.

use std::{collections::BTreeMap, path::Path};

use unone_engine::{Diagnostic, load_asset_manifest, resolve_asset_bytes};

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
    for asset in &manifest.assets {
        if asset.kind != "texture2d" {
            continue;
        }
        // The decoder must use metadata verified in the same observation as bytes.
        let resolved = match resolve_asset_bytes(project_root, &asset.id, None) {
            Ok(resolved) => resolved,
            Err(diagnostic) => {
                assets
                    .notes
                    .push(format!("{}: {}", asset.id, note(&diagnostic)));
                continue;
            }
        };
        let asset = &resolved.asset;
        if asset.kind != "texture2d" {
            continue;
        }
        let bytes = resolved.bytes;
        let sha256 = sha256_hex(&bytes);
        let source = if let Some(encoding) = &asset.encoding {
            if encoding.decoder != "image" || encoding.format != "svg"
                || encoding.mime != "image/svg+xml" || encoding.format_version.is_some() {
                assets.notes.push(format!("{}: HOST_ASSET_ENCODING_UNSUPPORTED native preview accepts unversioned image/svg", asset.id));
                continue;
            }
            "declared.svg"
        } else { &asset.source };
        match decode_texture(source, &bytes) {
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
/// The native preview host accepts static SVG for UI and PNG for mesh textures.
/// Decoding does not imply that the CLI primitive renderer samples the texture.
fn decode_texture(source: &str, bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    if source.to_ascii_lowercase().ends_with(".png") {
        let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder
            .read_info()
            .map_err(|error| format!("PNG decoder error: {error}"))?;
        if u64::from(reader.info().width) * u64::from(reader.info().height) > 16_777_216 {
            return Err("PNG decoder exceeds the 64 MiB RGBA output limit".into());
        }
        let mut pixels = vec![0; reader.output_buffer_size().ok_or("PNG decoder buffer size unavailable")?];
        let info = reader
            .next_frame(&mut pixels)
            .map_err(|error| format!("PNG decoder error: {error}"))?;
        pixels.truncate(info.buffer_size());
        let mut rgba = match info.color_type {
            png::ColorType::Rgba => pixels,
            png::ColorType::Rgb => pixels
                .chunks_exact(3)
                .flat_map(|value| [value[0], value[1], value[2], 255])
                .collect(),
            png::ColorType::Grayscale => pixels.iter().flat_map(|&gray| [gray, gray, gray, 255]).collect(),
            png::ColorType::GrayscaleAlpha => pixels.chunks_exact(2).flat_map(|v| [v[0], v[0], v[0], v[1]]).collect(),
            _ => return Err("PNG decoder returned an unexpanded indexed image".into()),
        };
        for pixel in rgba.chunks_exact_mut(4) {
            let alpha = u16::from(pixel[3]);
            for channel in &mut pixel[..3] {
                *channel = ((u16::from(*channel) * alpha + 127) / 255) as u8;
            }
        }
        return Ok((info.width, info.height, rgba));
    }
    if !source.to_ascii_lowercase().ends_with(".svg") {
        return Err(format!(
            "The native preview host decodes only PNG or SVG sources; '{source}' needs another decoder"
        ));
    }
    let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default())
        .map_err(|error| format!("SVG parse failed: {error}"))?;
    let size = tree.size();
    let longest = size.width().max(size.height());
    if !longest.is_finite() || longest <= 0.0 {
        return Err("The SVG has no usable dimensions".to_string());
    }
    let scale = (MAX_TEXTURE_EDGE / longest).clamp(f32::EPSILON, 1.0);
    let width = (size.width() * scale).ceil().max(1.0) as u32;
    let height = (size.height() * scale).ceil().max(1.0) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| format!("Could not create a {width}x{height} pixmap"))?;
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
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use unone_engine::{BundleManager, pack_project};

    use super::{decode_texture, load_textures, sha256_hex};

    const RED_SVG: &[u8] = br##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#ff0000"/></svg>"##;

    struct TestProject(PathBuf);

    impl Drop for TestProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn installed_project(kind: &str) -> TestProject {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "unone-host-assets-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&root).unwrap();
        let fixture = TestProject(root);
        let root = &fixture.0;
        for directory in ["assets", "scripts", "scenes"] {
            fs::create_dir(root.join(directory)).unwrap();
        }
        fs::write(
            root.join("project.unone.json"),
            br#"{"name":"HostAssetRead","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json","bundle_manifest":"bundles/manifest.json"}"#,
        ).unwrap();
        fs::write(root.join("scripts/main.luau"), b"return {}\n").unwrap();
        fs::write(root.join("scenes/main.scene.json"), br#"{"entities":[]}"#).unwrap();
        fs::write(root.join("assets/red.svg"), RED_SVG).unwrap();
        fs::write(root.join("assets/red.atlas"), b"atlas").unwrap();
        fs::write(
            root.join("assets/manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "assets": [{"id": "asset://red", "kind": kind, "source": "assets/red.svg",
                    "bundle": "content", "files": ["assets/red.atlas"]}]
            }))
            .unwrap(),
        )
        .unwrap();
        let packed = pack_project(root, None);
        assert!(packed.ok, "{packed:?}");
        let installed = BundleManager::from_project(root)
            .unwrap()
            .install("content");
        assert!(installed.ok, "{installed:?}");
        fixture
    }

    #[test]
    fn loads_verified_active_svg_without_reading_unpacked_source_bytes() {
        let fixture = installed_project("texture2d");
        fs::write(fixture.0.join("assets/red.svg"), b"unpacked-invalid-svg").unwrap();
        let assets = load_textures(&fixture.0);
        assert!(assets.notes.is_empty(), "{:?}", assets.notes);
        assert_eq!(assets.textures.len(), 1);
        let texture = &assets.textures["asset://red"];
        assert_eq!((texture.width, texture.height), (8, 4));
        assert_eq!(&texture.rgba[0..4], &[255, 0, 0, 255]);
        assert_eq!(texture.sha256, sha256_hex(RED_SVG));
        assert_eq!(texture.size_bytes, RED_SVG.len() as u64);
    }

    #[test]
    fn rejects_authoring_metadata_changes_before_host_texture_decode() {
        for (active_kind, field, value) in [
            ("spine", "kind", serde_json::json!("texture2d")),
            ("texture2d", "files", serde_json::json!([])),
            ("texture2d", "source", serde_json::json!("assets/moved.svg")),
            ("texture2d", "bundle", serde_json::json!("other")),
        ] {
            let fixture = installed_project(active_kind);
            let path = fixture.0.join("assets/manifest.json");
            let mut manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            manifest["assets"][0][field] = value;
            fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
            let assets = load_textures(&fixture.0);
            assert!(
                assets.textures.is_empty(),
                "{field} must not reach the decoder"
            );
            assert_eq!(assets.notes.len(), 1, "{field}: {:?}", assets.notes);
            assert!(
                assets.notes[0].contains("BUNDLE_GENERATION_MISMATCH"),
                "{field}: {:?}",
                assets.notes
            );
            assert!(!assets.notes[0].contains("HOST_ASSET_DECODE_FAILED"));
        }
    }

    #[test]
    fn decodes_svg_into_premultiplied_rgba() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#ff0000"/></svg>"##;
        let (width, height, rgba) = decode_texture("assets/red.svg", svg).unwrap();
        assert_eq!((width, height), (8, 4));
        assert_eq!(rgba.len(), 8 * 4 * 4);
        assert_eq!(&rgba[0..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn png_color_modes_use_the_same_premultiplied_contract_as_svg() {
        for (color, input, expected) in [
            (png::ColorType::Rgba, vec![200, 100, 50, 128], vec![100, 50, 25, 128]),
            (png::ColorType::Rgb, vec![200, 100, 50], vec![200, 100, 50, 255]),
            (png::ColorType::Grayscale, vec![100], vec![100, 100, 100, 255]),
            (png::ColorType::GrayscaleAlpha, vec![100, 128], vec![50, 50, 50, 128]),
        ] {
            let mut bytes = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
                encoder.set_color(color);
                encoder.set_depth(png::BitDepth::Eight);
                encoder.write_header().unwrap().write_image_data(&input).unwrap();
            }
            let (width, height, rgba) = decode_texture("test.png", &bytes).unwrap();
            assert_eq!((width, height), (1, 1));
            assert_eq!(rgba, expected);
        }
    }

    #[test]
    fn reports_source_formats_this_host_cannot_decode() {
        let error = decode_texture("assets/bird.png", b"not-a-png").unwrap_err();
        assert!(error.contains("decoder"), "{error}");
    }
}

//! Image-based environment light for the native player (docs/lighting.md):
//! a Radiance .hdr panorama from a data asset becomes a half-float equirect
//! texture with a box-filtered mip chain (rough reflections sample lower
//! mips) and nine spherical-harmonic irradiance coefficients (diffuse light).
//! The Web player gets the same light from Three's PMREM of the same file.

/// Radiance RGBE to linear RGB floats, rows top first.
pub fn decode_hdr(bytes: &[u8]) -> Result<(u32, u32, Vec<f32>), String> {
    let fail = |message: &str| format!("NATIVE_ENVIRONMENT_MAP_INVALID: {message}");
    let mut at = 0usize;
    let mut line = || -> Result<String, String> {
        let start = at;
        while at < bytes.len() && bytes[at] != b'\n' {
            at += 1;
        }
        if at >= bytes.len() {
            return Err(fail("the header ends early"));
        }
        at += 1;
        Ok(String::from_utf8_lossy(&bytes[start..at - 1]).into_owned())
    };
    if !line()?.starts_with("#?") {
        return Err(fail("not a Radiance .hdr file"));
    }
    loop {
        let text = line()?;
        if text.is_empty() {
            break;
        }
        if text.starts_with("FORMAT=") && text != "FORMAT=32-bit_rle_rgbe" {
            return Err(fail(&format!("unsupported {text}")));
        }
    }
    let size = line()?;
    let parts: Vec<&str> = size.split_whitespace().collect();
    let (height, width) = match parts.as_slice() {
        ["-Y", height, "+X", width] => (height.parse::<u32>().map_err(|_| fail("bad height"))?, width.parse::<u32>().map_err(|_| fail("bad width"))?),
        _ => return Err(fail("only the \"-Y height +X width\" orientation is supported")),
    };
    if width == 0 || height == 0 || width > 16384 || height > 16384 {
        return Err(fail("size is outside 1..16384"));
    }
    let (w, h) = (width as usize, height as usize);
    let mut rgb = Vec::with_capacity(w * h * 3);
    let mut row = vec![0u8; w * 4];
    let next = |at: &mut usize| -> Result<u8, String> {
        let value = *bytes.get(*at).ok_or_else(|| fail("pixel data ends early"))?;
        *at += 1;
        Ok(value)
    };
    for _ in 0..h {
        let rle = (8..32768).contains(&w) && bytes.get(at..at + 4).is_some_and(|head| head[0] == 2 && head[1] == 2 && ((head[2] as usize) << 8 | head[3] as usize) == w);
        if rle {
            at += 4;
            for channel in 0..4 {
                let mut x = 0;
                while x < w {
                    let mut count = next(&mut at)? as usize;
                    let run = count > 128;
                    if run {
                        count -= 128;
                    }
                    if count == 0 || x + count > w {
                        return Err(fail("a run overflows its scanline"));
                    }
                    if run {
                        let value = next(&mut at)?;
                        for _ in 0..count {
                            row[x * 4 + channel] = value;
                            x += 1;
                        }
                    } else {
                        for _ in 0..count {
                            row[x * 4 + channel] = next(&mut at)?;
                            x += 1;
                        }
                    }
                }
            }
        } else {
            let data = bytes.get(at..at + w * 4).ok_or_else(|| fail("pixel data ends early"))?;
            row.copy_from_slice(data);
            at += w * 4;
        }
        for pixel in row.chunks_exact(4) {
            let scale = if pixel[3] == 0 { 0. } else { 2f32.powi(pixel[3] as i32 - 136) };
            rgb.extend_from_slice(&[pixel[0] as f32 * scale, pixel[1] as f32 * scale, pixel[2] as f32 * scale]);
        }
    }
    Ok((width, height, rgb))
}

/// The panorama's GPU-ready form: RGB mip levels (largest first) and the nine
/// cosine-convolved irradiance coefficients E(n) = sum(c_i * Y_i(n)).
pub struct EnvironmentMap {
    pub levels: Vec<(u32, u32, Vec<f32>)>,
    pub sh: [[f32; 3]; 9],
}

/// Halve a level with a 2x2 box filter; the panorama wraps horizontally.
fn halve(width: u32, height: u32, rgb: &[f32]) -> (u32, u32, Vec<f32>) {
    let (nw, nh) = ((width / 2).max(1), (height / 2).max(1));
    let mut out = vec![0f32; (nw * nh * 3) as usize];
    for y in 0..nh {
        for x in 0..nw {
            for channel in 0..3 {
                let mut sum = 0.;
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let sx = (x * 2 + dx) % width;
                    let sy = (y * 2 + dy).min(height - 1);
                    sum += rgb[((sy * width + sx) * 3 + channel) as usize];
                }
                out[((y * nw + x) * 3 + channel) as usize] = sum / 4.;
            }
        }
    }
    (nw, nh, out)
}

/// The real spherical-harmonic basis up to l = 2 (y up).
pub fn sh_basis(d: [f32; 3]) -> [f32; 9] {
    let [x, y, z] = d;
    [
        0.282095,
        0.488603 * y,
        0.488603 * z,
        0.488603 * x,
        1.092548 * x * y,
        1.092548 * y * z,
        0.315392 * (3. * z * z - 1.),
        1.092548 * x * z,
        0.546274 * (x * x - y * y),
    ]
}

/// The direction of panorama texel (x, y), rows top first, in Three's
/// equirect convention: u = atan2(z, x) / 2pi + 0.5, v_top = 0.5 - asin(y) / pi.
pub fn texel_direction(x: f32, y: f32, width: f32, height: f32) -> [f32; 3] {
    let phi = ((x + 0.5) / width - 0.5) * std::f32::consts::TAU;
    let latitude = (0.5 - (y + 0.5) / height) * std::f32::consts::PI;
    [latitude.cos() * phi.cos(), latitude.sin(), latitude.cos() * phi.sin()]
}

pub fn prepare(width: u32, height: u32, rgb: Vec<f32>) -> EnvironmentMap {
    let mut level = (width, height, rgb);
    // Keep the base at most 1024 wide: plenty for lighting.
    while level.0 > 1024 {
        level = halve(level.0, level.1, &level.2);
    }
    let mut levels = vec![level];
    while levels.last().unwrap().0 > 4 {
        let (w, h, rgb) = levels.last().unwrap();
        levels.push(halve(*w, *h, rgb));
    }
    // Project a small level onto SH; scale by Ramamoorthi's cosine lobe.
    let (w, h, rgb) = levels.iter().find(|(w, _, _)| *w <= 128).unwrap_or(levels.last().unwrap());
    let mut sh = [[0f32; 3]; 9];
    let cell = (std::f32::consts::TAU / *w as f32) * (std::f32::consts::PI / *h as f32);
    for y in 0..*h {
        for x in 0..*w {
            let d = texel_direction(x as f32, y as f32, *w as f32, *h as f32);
            let weight = cell * (1. - d[1] * d[1]).max(0.).sqrt();
            let basis = sh_basis(d);
            let at = ((y * w + x) * 3) as usize;
            for (i, b) in basis.iter().enumerate() {
                for channel in 0..3 {
                    sh[i][channel] += rgb[at + channel] * b * weight;
                }
            }
        }
    }
    let band = [std::f32::consts::PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398];
    for (coefficient, a) in sh.iter_mut().zip(band) {
        coefficient.iter_mut().for_each(|value| *value *= a);
    }
    EnvironmentMap { levels, sh }
}

/// f32 to IEEE half (round to nearest, saturating to the largest half).
pub fn f32_to_f16(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exponent = ((bits >> 23) & 0xff) as i32;
    let mantissa = bits & 0x7f_ffff;
    if exponent == 0xff {
        return sign | 0x7c00 | if mantissa != 0 { 0x200 } else { 0 };
    }
    let half_exponent = exponent - 127 + 15;
    if half_exponent >= 0x1f {
        return sign | 0x7bff;
    }
    if half_exponent <= 0 {
        if half_exponent < -10 {
            return sign;
        }
        let mantissa = mantissa | 0x80_0000;
        let shift = (14 - half_exponent) as u32;
        let rounded = (mantissa + (1 << (shift - 1))) >> shift;
        return sign | rounded as u16;
    }
    let rounded = (mantissa + 0x1000) >> 13;
    if rounded & 0x400 != 0 {
        let half_exponent = half_exponent + 1;
        if half_exponent >= 0x1f {
            return sign | 0x7bff;
        }
        return sign | ((half_exponent as u16) << 10);
    }
    sign | ((half_exponent as u16) << 10) | rounded as u16
}

/// Upload the mip chain as an Rgba16Float texture.
pub fn upload(device: &wgpu::Device, queue: &wgpu::Queue, map: &EnvironmentMap) -> wgpu::TextureView {
    let (width, height, _) = &map.levels[0];
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("native-environment"),
        size: wgpu::Extent3d { width: *width, height: *height, depth_or_array_layers: 1 },
        mip_level_count: map.levels.len() as u32,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba16Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    for (mip, (w, h, rgb)) in map.levels.iter().enumerate() {
        let mut half = Vec::with_capacity((w * h * 4) as usize);
        for pixel in rgb.chunks_exact(3) {
            half.extend_from_slice(&[f32_to_f16(pixel[0]), f32_to_f16(pixel[1]), f32_to_f16(pixel[2]), f32_to_f16(1.)]);
        }
        queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: mip as u32, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            bytemuck::cast_slice(&half),
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * 8), rows_per_image: Some(*h) },
            wgpu::Extent3d { width: *w, height: *h, depth_or_array_layers: 1 },
        );
    }
    texture.create_view(&Default::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgbe(r: f32, g: f32, b: f32) -> [u8; 4] {
        let max = r.max(g).max(b);
        if max < 1e-32 {
            return [0; 4];
        }
        let exponent = max.log2().floor() as i32 + 1;
        let scale = 256. / 2f32.powi(exponent);
        [(r * scale) as u8, (g * scale) as u8, (b * scale) as u8, (exponent + 128) as u8]
    }

    #[test]
    fn flat_and_run_length_scanlines_decode() {
        let mut flat = b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n".to_vec();
        flat.extend_from_slice(&rgbe(1., 0.5, 0.25));
        flat.extend_from_slice(&rgbe(4., 0., 0.));
        let (w, h, rgb) = decode_hdr(&flat).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(&rgb, &[1., 0.5, 0.25, 4., 0., 0.]);
        // Run-length row of 8: each channel is one run of 8.
        let mut rle = b"#?RGBE\n\n-Y 1 +X 8\n".to_vec();
        rle.extend_from_slice(&[2, 2, 0, 8]);
        for value in rgbe(2., 1., 0.5) {
            rle.extend_from_slice(&[128 + 8, value]);
        }
        let (_, _, rgb) = decode_hdr(&rle).unwrap();
        assert_eq!(&rgb[21..24], &[2., 1., 0.5]);
        assert!(decode_hdr(b"P6\n").unwrap_err().contains("not a Radiance"));
        assert!(decode_hdr(b"#?RADIANCE\n\n+Y 1 +X 1\n\0\0\0\0").unwrap_err().contains("orientation"));
    }

    #[test]
    fn a_uniform_sky_gives_uniform_irradiance_and_halves_round_trip() {
        let (w, h) = (64, 32);
        let map = prepare(w, h, vec![1.; (w * h * 3) as usize]);
        assert_eq!(map.levels.last().unwrap().0, 4);
        // E(n) = pi * L for a uniform environment, in every direction.
        for n in [[0., 1., 0.], [1., 0., 0.], [0., -1., 0.]] {
            let basis = sh_basis(n);
            let irradiance: f32 = (0..9).map(|i| map.sh[i][0] * basis[i]).sum();
            assert!((irradiance - std::f32::consts::PI).abs() < 0.02, "{n:?}: {irradiance}");
        }
        for value in [0., 1., 0.5, 3.14159, 65504., 1e-5, -2.5] {
            let half = f32_to_f16(value);
            let back = half_to_f32(half);
            assert!((back - value).abs() <= value.abs() * 1e-3 + 1e-7, "{value} -> {half:#x} -> {back}");
        }
        // u = 0.5 is +x in Three's equirect convention.
        assert_eq!(texel_direction(31.5, 0., 64., 1.).map(|v| (v * 1e4).round() / 1e4), [1., 0., 0.]);
    }

    fn half_to_f32(half: u16) -> f32 {
        let sign = if half & 0x8000 != 0 { -1. } else { 1. };
        let exponent = ((half >> 10) & 0x1f) as i32;
        let mantissa = (half & 0x3ff) as f32;
        sign * match exponent {
            0 => mantissa * 2f32.powi(-24),
            _ => (1. + mantissa / 1024.) * 2f32.powi(exponent - 15),
        }
    }
}

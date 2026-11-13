//! Cuts a TrueType-outline (`glyf`) font down to the glyphs a set of
//! characters needs. Export tooling, not an engine capability.
//!
//! Glyphs are renumbered in character order (.notdef first, composite parts
//! after the glyphs that use them); `cmap`, `glyf`/`loca`, `hmtx`/`hhea`,
//! `vmtx`/`vhea`, `maxp` and `post` (version 3, no glyph names) are rebuilt.
//! `name` (copyright and license), `OS/2`, the hinting programs, `gasp`,
//! `meta` and `STAT` are kept. Every other table refers to old glyph numbers
//! or to outlines this subsetter does not rewrite; it is dropped and reported,
//! most notably the OpenType layout tables (GSUB, GPOS, GDEF, kern). Callers
//! must refuse text that cannot render without them.
//!
//! A variable TrueType font becomes a static instance: its `wght` axis is set
//! to the face's weight (other axes stay at their defaults), every kept glyph
//! is redrawn from the varied outline as a simple quadratic glyph (composites
//! flattened, glyph instructions not kept), advances follow HVAR/VVAR or the
//! phantom points, and the variation tables are dropped.
//!
//! CFF outlines, collections and color glyphs are refused with
//! `UI_FONT_SUBSET_UNSUPPORTED` rather than written incompletely.

use anyhow::{anyhow, bail, ensure, Context, Result};
use std::borrow::Cow;
use std::collections::BTreeSet;
use ttf_parser::{GlyphId, OutlineBuilder};

pub(crate) struct Subset {
    pub bytes: Vec<u8>,
    pub glyphs: usize,
    pub original_glyphs: usize,
    /// Requested characters the font has, now mapped by the subset.
    pub characters: usize,
    pub dropped_tables: Vec<String>,
}

/// Tables copied unchanged: they never refer to glyph numbers.
const KEPT: [&[u8; 4]; 7] = [b"cvt ", b"fpgm", b"prep", b"gasp", b"name", b"meta", b"STAT"];

/// The characters a TrueType or OpenType font maps to a real glyph, from all
/// of its Unicode cmap subtables.
pub(crate) fn coverage(font: &[u8]) -> Result<BTreeSet<char>> {
    let face = ttf_parser::Face::parse(font, 0).map_err(|error| anyhow!("UI_FONT_INVALID: the font cannot be parsed: {error}"))?;
    let mut chars = BTreeSet::new();
    for subtable in face.tables().cmap.into_iter().flat_map(|cmap| cmap.subtables) {
        if !subtable.is_unicode() { continue; }
        subtable.codepoints(|codepoint| {
            if subtable.glyph_index(codepoint).is_some_and(|glyph| glyph.0 != 0) {
                if let Some(ch) = char::from_u32(codepoint) { chars.insert(ch); }
            }
        });
    }
    Ok(chars)
}

/// Whether the font has a table with this tag (any outline format).
pub(crate) fn has_table(font: &[u8], tag: &[u8; 4]) -> bool {
    directory(font).is_ok_and(|tables| tables.iter().any(|(t, _)| t == tag))
}

/// Whether the font varies; its subsets are static instances, one per weight.
pub(crate) fn is_variable(font: &[u8]) -> bool {
    has_table(font, b"fvar")
}

/// Cuts the font down to `wanted`. A variable font becomes a static instance
/// at `weight`; a static font ignores it.
pub(crate) fn subset(font: &[u8], wanted: &BTreeSet<char>, weight: u16) -> Result<Subset> {
    let tables = directory(font)?;
    let get = |tag: &[u8; 4]| tables.iter().find(|(t, _)| t == tag).map(|(_, data)| *data);
    let need = |tag: &[u8; 4]| get(tag).with_context(|| format!("UI_FONT_INVALID: the font has no {} table", tag_name(tag)));
    for (tag, what) in [(b"CFF ", "CFF outlines"), (b"CFF2", "CFF2 outlines"), (b"COLR", "color glyphs"), (b"sbix", "color bitmap glyphs"),
        (b"CBDT", "color bitmap glyphs"), (b"SVG ", "SVG glyphs")] {
        ensure!(get(tag).is_none(), "UI_FONT_SUBSET_UNSUPPORTED: the font has {what}, which subsetting does not support; set \"subset\": false for this face or package a TrueType (glyf) face");
    }
    let variable = get(b"fvar").is_some();
    if let Some(os2) = get(b"OS/2") {
        let fs_type = be16(os2, 8)?;
        ensure!(fs_type & 0x0100 == 0, "UI_FONT_SUBSET_FORBIDDEN: the font's OS/2 fsType forbids subsetting; set \"subset\": false for this face");
        ensure!(fs_type & 0x0200 == 0, "UI_FONT_SUBSET_FORBIDDEN: the font's OS/2 fsType allows bitmap embedding only; set \"subset\": false for this face");
    }
    let head = need(b"head")?;
    ensure!(head.len() >= 54, "UI_FONT_INVALID: head table is truncated");
    let maxp = need(b"maxp")?;
    let num_glyphs = be16(maxp, 4)? as usize;
    ensure!(num_glyphs > 0, "UI_FONT_INVALID: the font has no glyphs");
    let hhea = need(b"hhea")?;
    let hmtx = need(b"hmtx")?;
    let loca = need(b"loca")?;
    let glyf = need(b"glyf")?;
    let long_loca = be16(head, 50)? != 0;
    let glyph = |gid: usize| -> Result<&[u8]> {
        let (start, end) = if long_loca {
            (be32(loca, gid * 4)? as usize, be32(loca, gid * 4 + 4)? as usize)
        } else {
            (be16(loca, gid * 2)? as usize * 2, be16(loca, gid * 2 + 2)? as usize * 2)
        };
        ensure!(start <= end && end <= glyf.len(), "UI_FONT_INVALID: loca points outside glyf for glyph {gid}");
        Ok(&glyf[start..end])
    };

    let mut face = ttf_parser::Face::parse(font, 0).map_err(|error| anyhow!("UI_FONT_INVALID: the font cannot be parsed: {error}"))?;
    if variable {
        let wght = ttf_parser::Tag::from_bytes(b"wght");
        if let Some(axis) = face.variation_axes().into_iter().find(|axis| axis.tag == wght) {
            let value = f32::from(weight);
            ensure!((axis.min_value..=axis.max_value).contains(&value),
                "UI_FONT_SUBSET_WEIGHT_OUT_OF_RANGE: weight {weight} lies outside the font's wght axis ({}..{}); declare a weight the font covers",
                axis.min_value, axis.max_value);
            face.set_variation(wght, value).context("UI_FONT_INVALID: the variation axes cannot be set")?;
        }
    }
    let mut new_id = vec![u16::MAX; num_glyphs];
    let mut order: Vec<u16> = Vec::new();
    let mut add = |gid: u16, order: &mut Vec<u16>| -> Result<u16> {
        ensure!((gid as usize) < num_glyphs, "UI_FONT_INVALID: glyph {gid} is out of range");
        if new_id[gid as usize] == u16::MAX {
            new_id[gid as usize] = order.len() as u16;
            order.push(gid);
        }
        Ok(new_id[gid as usize])
    };
    add(0, &mut order)?;
    let mut mapping = Vec::new();
    for &ch in wanted {
        // U+FFFF ends every format 4 table and is a noncharacter.
        if ch as u32 == 0xFFFF { continue; }
        if let Some(glyph) = face.glyph_index(ch).filter(|glyph| glyph.0 != 0) {
            mapping.push((ch as u32, glyph.0));
        }
    }
    let mut mapping: Vec<(u32, u16)> = mapping.into_iter().map(|(cp, old)| add(old, &mut order).map(|new| (cp, new))).collect::<Result<_>>()?;
    // Composite glyphs pull in their components, transitively. An instance
    // draws composites flattened, so it needs no components.
    let mut next = 0;
    while next < order.len() && !variable {
        let data = glyph(order[next] as usize)?;
        for position in component_positions(data)? {
            add(be16(data, position)?, &mut order)?;
        }
        next += 1;
    }
    mapping.sort_unstable();

    let drawn: Vec<Option<Drawn>> = if variable {
        order.iter().map(|&old| draw(&face, GlyphId(old), stored_points(&glyph, old as usize, 0))).collect::<Result<_>>()?
    } else {
        Vec::new()
    };
    let mut glyf_out = Vec::new();
    let mut offsets = Vec::with_capacity(order.len() + 1);
    for (index, &old) in order.iter().enumerate() {
        offsets.push(glyf_out.len());
        let data: Cow<[u8]> = if variable {
            drawn[index].as_ref().map_or(Cow::Borrowed(&[][..]), |drawn| Cow::Borrowed(drawn.data.as_slice()))
        } else {
            Cow::Borrowed(glyph(old as usize)?)
        };
        let start = glyf_out.len();
        glyf_out.extend_from_slice(&data);
        for position in component_positions(&data)? {
            let renumbered = new_id[be16(&data, position)? as usize];
            glyf_out[start + position..start + position + 2].copy_from_slice(&renumbered.to_be_bytes());
        }
        while glyf_out.len() % 4 != 0 { glyf_out.push(0); }
    }
    offsets.push(glyf_out.len());
    let short_loca = glyf_out.len() / 2 <= 0xFFFF;
    let mut loca_out = Vec::with_capacity(offsets.len() * if short_loca { 2 } else { 4 });
    for offset in offsets {
        if short_loca { loca_out.extend_from_slice(&((offset / 2) as u16).to_be_bytes()); }
        else { loca_out.extend_from_slice(&(offset as u32).to_be_bytes()); }
    }

    let mut out: Vec<([u8; 4], Vec<u8>)> = Vec::new();
    let mut head_out = head.to_vec();
    head_out[8..12].copy_from_slice(&[0; 4]);
    head_out[50..52].copy_from_slice(&(u16::from(!short_loca)).to_be_bytes());
    let mut maxp_out = maxp.to_vec();
    maxp_out[4..6].copy_from_slice(&(order.len() as u16).to_be_bytes());
    let mut horizontal = read_metrics(hhea, hmtx, num_glyphs, &order).context("UI_FONT_INVALID: horizontal metrics")?;
    let mut vertical = match (get(b"vhea"), get(b"vmtx")) {
        (Some(vhea), Some(vmtx)) => Some((vhea, read_metrics(vhea, vmtx, num_glyphs, &order).context("UI_FONT_INVALID: vertical metrics")?)),
        _ => None,
    };
    if variable {
        // Bounds, metrics and maxima of the redrawn glyphs.
        let boxes: Vec<[i16; 4]> = drawn.iter().flatten().map(|drawn| drawn.bounds).collect();
        if !boxes.is_empty() {
            let bounds = [boxes.iter().map(|b| b[0]).min(), boxes.iter().map(|b| b[1]).min(), boxes.iter().map(|b| b[2]).max(), boxes.iter().map(|b| b[3]).max()];
            for (index, value) in bounds.into_iter().flatten().enumerate() {
                head_out[36 + index * 2..38 + index * 2].copy_from_slice(&value.to_be_bytes());
            }
        }
        if maxp_out.len() >= 32 {
            let points = drawn.iter().flatten().map(|drawn| drawn.points).max().unwrap_or(0);
            let contours = drawn.iter().flatten().map(|drawn| drawn.contours).max().unwrap_or(0);
            for (at, value) in [(6, points), (8, contours), (10, 0), (12, 0), (28, 0), (30, 0)] {
                maxp_out[at..at + 2].copy_from_slice(&(value.min(0xFFFF) as u16).to_be_bytes());
            }
        }
        for (index, (&old, drawn)) in order.iter().zip(&drawn).enumerate() {
            let advance = face.glyph_hor_advance(GlyphId(old)).unwrap_or(horizontal[index].0);
            horizontal[index] = (advance, drawn.as_ref().map_or(0, |drawn| drawn.bounds[0] as u16));
            if let Some((_, values)) = vertical.as_mut() {
                // Keep each glyph's vertical origin (top of its box plus the top bearing).
                let original = glyph(old as usize)?;
                let side = match (drawn, original.len() >= 10) {
                    (Some(drawn), true) => ((be16(original, 8)? as i16 as i32 + values[index].1 as i16 as i32) - drawn.bounds[3] as i32) as i16 as u16,
                    _ => values[index].1,
                };
                values[index] = (face.glyph_ver_advance(GlyphId(old)).unwrap_or(values[index].0), side);
            }
        }
    }
    out.push((*b"head", head_out));
    out.push((*b"maxp", maxp_out));
    let (hhea_out, hmtx_out) = write_metrics(hhea, &horizontal);
    out.push((*b"hhea", hhea_out));
    out.push((*b"hmtx", hmtx_out));
    if let Some((vhea, values)) = vertical {
        let (vhea_out, vmtx_out) = write_metrics(vhea, &values);
        out.push((*b"vhea", vhea_out));
        out.push((*b"vmtx", vmtx_out));
    }
    out.push((*b"loca", loca_out));
    out.push((*b"glyf", glyf_out));
    out.push((*b"cmap", cmap(&mapping)?));
    if let Some(post) = get(b"post") {
        ensure!(post.len() >= 32, "UI_FONT_INVALID: post table is truncated");
        let mut post_out = post[..32].to_vec();
        post_out[0..4].copy_from_slice(&0x0003_0000u32.to_be_bytes());
        out.push((*b"post", post_out));
    }
    if let Some(os2) = get(b"OS/2") {
        let mut os2_out = os2.to_vec();
        if os2_out.len() >= 68 {
            if let (Some(first), Some(last)) = (mapping.first(), mapping.last()) {
                os2_out[64..66].copy_from_slice(&(first.0.min(0xFFFF) as u16).to_be_bytes());
                os2_out[66..68].copy_from_slice(&(last.0.min(0xFFFF) as u16).to_be_bytes());
            }
        }
        if variable && os2_out.len() >= 6 { os2_out[4..6].copy_from_slice(&weight.to_be_bytes()); }
        out.push((*b"OS/2", os2_out));
    }
    for tag in KEPT {
        // STAT describes the axes an instance no longer has.
        if variable && tag == b"STAT" { continue; }
        if let Some(data) = get(tag) { out.push((*tag, data.to_vec())); }
    }
    let written: BTreeSet<[u8; 4]> = out.iter().map(|(tag, _)| *tag).collect();
    let dropped_tables = tables.iter().filter(|(tag, _)| !written.contains(tag)).map(|(tag, _)| tag_name(tag)).collect();
    let bytes = assemble(out);

    // The result must parse and map every kept character to its new glyph.
    let check = ttf_parser::Face::parse(&bytes, 0).map_err(|error| anyhow!("UI_FONT_SUBSET_FAILED: the subset does not parse: {error}"))?;
    ensure!(check.number_of_glyphs() as usize == order.len(), "UI_FONT_SUBSET_FAILED: glyph count mismatch");
    for &(codepoint, glyph) in &mapping {
        let ch = char::from_u32(codepoint).expect("mapped from a char");
        ensure!(check.glyph_index(ch).map(|g| g.0) == Some(glyph), "UI_FONT_SUBSET_FAILED: U+{codepoint:04X} lost its glyph");
    }
    Ok(Subset { bytes, glyphs: order.len(), original_glyphs: num_glyphs, characters: mapping.len(), dropped_tables })
}

fn tag_name(tag: &[u8; 4]) -> String {
    String::from_utf8_lossy(tag).trim_end().to_string()
}

fn be16(data: &[u8], at: usize) -> Result<u16> {
    data.get(at..at + 2).map(|b| u16::from_be_bytes([b[0], b[1]])).context("UI_FONT_INVALID: table is truncated")
}

fn be32(data: &[u8], at: usize) -> Result<u32> {
    data.get(at..at + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]])).context("UI_FONT_INVALID: table is truncated")
}

/// The table directory of a single TrueType font.
fn directory(font: &[u8]) -> Result<Vec<([u8; 4], &[u8])>> {
    match font.get(0..4) {
        Some([0, 1, 0, 0]) | Some(b"true") => {}
        Some(b"OTTO") => bail!("UI_FONT_SUBSET_UNSUPPORTED: the font has CFF outlines (OTF), which subsetting does not support; set \"subset\": false for this face or package a TrueType (glyf) face"),
        Some(b"ttcf") => bail!("UI_FONT_SUBSET_UNSUPPORTED: font collections cannot be packaged; package one face"),
        _ => bail!("UI_FONT_INVALID: not a TrueType or OpenType font"),
    }
    let count = be16(font, 4)? as usize;
    (0..count).map(|index| {
        let record = 12 + index * 16;
        let tag: [u8; 4] = font.get(record..record + 4).context("UI_FONT_INVALID: table directory is truncated")?.try_into()?;
        let offset = be32(font, record + 8)? as usize;
        let length = be32(font, record + 12)? as usize;
        let data = font.get(offset..offset.checked_add(length).context("UI_FONT_INVALID")?)
            .with_context(|| format!("UI_FONT_INVALID: table {} lies outside the file", tag_name(&tag)))?;
        Ok((tag, data))
    }).collect()
}

/// Byte offsets of the component glyph numbers in a composite glyph.
fn component_positions(glyph: &[u8]) -> Result<Vec<usize>> {
    if glyph.len() < 10 || (be16(glyph, 0)? as i16) >= 0 { return Ok(Vec::new()); }
    let mut positions = Vec::new();
    let mut at = 10;
    loop {
        let flags = be16(glyph, at)?;
        be16(glyph, at + 2)?;
        positions.push(at + 2);
        at += 4 + if flags & 0x0001 != 0 { 4 } else { 2 };
        at += if flags & 0x0008 != 0 { 2 } else if flags & 0x0040 != 0 { 4 } else if flags & 0x0080 != 0 { 8 } else { 0 };
        if flags & 0x0020 == 0 { break; }
    }
    Ok(positions)
}

/// The (advance, side bearing) of each glyph in `order` from `hhea`+`hmtx`
/// (or `vhea`+`vmtx`, same layout).
fn read_metrics(header: &[u8], table: &[u8], num_glyphs: usize, order: &[u16]) -> Result<Vec<(u16, u16)>> {
    ensure!(header.len() >= 36, "header is truncated");
    let long = (be16(header, 34)? as usize).min(num_glyphs);
    ensure!(long >= 1, "no long metrics");
    let metric = |gid: usize| -> Result<(u16, u16)> {
        if gid < long { Ok((be16(table, gid * 4)?, be16(table, gid * 4 + 2)?)) }
        else { Ok((be16(table, (long - 1) * 4)?, be16(table, long * 4 + (gid - long) * 2)?)) }
    };
    order.iter().map(|&gid| metric(gid as usize)).collect()
}

/// Rebuilds the header and metrics table, writing one long metric per glyph
/// until the trailing advances repeat.
fn write_metrics(header: &[u8], values: &[(u16, u16)]) -> (Vec<u8>, Vec<u8>) {
    let last = values.last().expect("subset keeps .notdef").0;
    let repeated = values.iter().rev().take_while(|(advance, _)| *advance == last).count();
    let long_out = values.len() - repeated + 1;
    let mut header_out = header.to_vec();
    header_out[34..36].copy_from_slice(&(long_out as u16).to_be_bytes());
    let widest = values.iter().map(|(advance, _)| *advance).max().unwrap_or(0);
    header_out[10..12].copy_from_slice(&widest.to_be_bytes());
    let mut table_out = Vec::with_capacity(long_out * 4 + (values.len() - long_out) * 2);
    for (index, (advance, side)) in values.iter().enumerate() {
        if index < long_out { table_out.extend_from_slice(&advance.to_be_bytes()); }
        table_out.extend_from_slice(&side.to_be_bytes());
    }
    (header_out, table_out)
}

/// A glyph redrawn as a simple TrueType glyph.
struct Drawn {
    data: Vec<u8>,
    /// xMin, yMin, xMax, yMax.
    bounds: [i16; 4],
    points: usize,
    contours: usize,
}

/// Contours as ttf-parser draws them: each on-curve point, each quadratic
/// control point, and the implied on-curve midpoints between two controls.
#[derive(Default)]
struct Contours {
    contours: Vec<Vec<(f32, f32, bool)>>,
    cubic: bool,
}

impl OutlineBuilder for Contours {
    fn move_to(&mut self, x: f32, y: f32) { self.contours.push(vec![(x, y, true)]); }
    fn line_to(&mut self, x: f32, y: f32) {
        if let Some(contour) = self.contours.last_mut() { contour.push((x, y, true)); }
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        if let Some(contour) = self.contours.last_mut() { contour.extend([(x1, y1, false), (x, y, true)]); }
    }
    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) { self.cubic = true; }
    fn close(&mut self) {}
}

/// The on-curve flags of a glyph's stored points, contour by contour, with
/// composites expanded in drawing order. `None` when they cannot be read.
fn stored_points<'a>(glyph: &dyn Fn(usize) -> Result<&'a [u8]>, gid: usize, depth: usize) -> Option<Vec<Vec<bool>>> {
    let data = glyph(gid).ok()?;
    if data.is_empty() { return Some(Vec::new()); }
    let contours = be16(data, 0).ok()? as i16;
    if contours < 0 {
        if depth > 8 { return None; }
        let mut all = Vec::new();
        for position in component_positions(data).ok()? {
            all.extend(stored_points(glyph, be16(data, position).ok()? as usize, depth + 1)?);
        }
        return Some(all);
    }
    let ends: Vec<usize> = (0..contours as usize).map(|index| be16(data, 10 + index * 2).map(usize::from)).collect::<Result<_>>().ok()?;
    let total = ends.last().map_or(0, |end| end + 1);
    let mut at = 12 + contours as usize * 2 + be16(data, 10 + contours as usize * 2).ok()? as usize;
    let mut flags = Vec::with_capacity(total);
    while flags.len() < total {
        let flag = *data.get(at)?;
        at += 1;
        let repeat = if flag & 0x08 != 0 { at += 1; *data.get(at - 1)? as usize } else { 0 };
        flags.extend(std::iter::repeat_n(flag & 0x01 != 0, repeat + 1));
    }
    flags.truncate(total);
    let mut start = 0;
    Some(ends.iter().map(|&end| { let contour = flags.get(start..=end).unwrap_or_default().to_vec(); start = end + 1; contour }).collect())
}

/// What ttf-parser emits for a contour of stored points with these flags:
/// each entry is a stored point's index (`None` for an implied midpoint) and
/// whether it is on the curve. Mirrors its glyf outline builder.
fn emitted(flags: &[bool]) -> Vec<(Option<usize>, bool)> {
    let mut out = Vec::new();
    let (mut first_on, mut first_off, mut last_off): (Option<Option<usize>>, Option<usize>, Option<usize>) = (None, None, None);
    for (index, &on) in flags.iter().enumerate() {
        if first_on.is_none() {
            if on { first_on = Some(Some(index)); out.push((Some(index), true)); }
            else if first_off.is_some() { first_on = Some(None); last_off = Some(index); out.push((None, true)); }
            else { first_off = Some(index); }
        } else {
            match (last_off, on) {
                (Some(control), true) => { last_off = None; out.extend([(Some(control), false), (Some(index), true)]); }
                (Some(control), false) => { last_off = Some(index); out.extend([(Some(control), false), (None, true)]); }
                (None, true) => out.push((Some(index), true)),
                (None, false) => last_off = Some(index),
            }
        }
    }
    if let (Some(_), Some(last)) = (first_off, last_off) {
        last_off = None;
        out.extend([(Some(last), false), (None, true)]);
    }
    match (first_on, first_off, last_off) {
        (Some(start), Some(control), _) | (Some(start), None, Some(control)) => out.extend([(Some(control), false), (start, true)]),
        (Some(start), None, None) => out.push((start, true)),
        _ => {}
    }
    out
}

/// Redraws a glyph at the face's current variation as a simple glyph without
/// instructions. Given the stored points of the glyph, it writes exactly
/// those points (varied and rounded), so implied midpoints stay implied as
/// the font had them; a contour that does not line up falls back to writing
/// what was drawn. `None` is an empty glyph (a space).
fn draw(face: &ttf_parser::Face, glyph: GlyphId, stored: Option<Vec<Vec<bool>>>) -> Result<Option<Drawn>> {
    let mut drawing = Contours::default();
    if face.outline_glyph(glyph, &mut drawing).is_none() { return Ok(None); }
    ensure!(!drawing.cubic, "UI_FONT_SUBSET_UNSUPPORTED: glyph {} has cubic curves", glyph.0);
    let round = |(x, y, on): (f32, f32, bool)| (x.round().clamp(-32768.0, 32767.0) as i32, y.round().clamp(-32768.0, 32767.0) as i32, on);
    let stored = stored.filter(|stored| stored.len() == drawing.contours.len());
    let same = |a: f32, b: f32| (a - b).abs() < 1e-3;
    let mut contours: Vec<Vec<(i16, i16, bool)>> = Vec::new();
    for (index, mut contour) in drawing.contours.into_iter().enumerate() {
        if let Some(flags) = stored.as_ref().map(|stored| &stored[index]) {
            let template = emitted(flags);
            if template.len() == contour.len() && template.iter().zip(&contour).all(|(t, d)| t.1 == d.2) {
                let points: Option<Vec<(i16, i16, bool)>> = (0..flags.len()).map(|point| {
                    let at = template.iter().position(|t| t.0 == Some(point))?;
                    let (x, y, _) = round(contour[at]);
                    Some((x as i16, y as i16, flags[point]))
                }).collect();
                if let Some(points) = points.filter(|points| !points.is_empty()) {
                    contours.push(points);
                    continue;
                }
            }
        }
        // The closing segment ends where the contour began.
        if contour.len() > 1 {
            let (first, last) = (contour[0], contour[contour.len() - 1]);
            if last.2 && same(first.0, last.0) && same(first.1, last.1) { contour.pop(); }
        }
        let rounded: Vec<(i32, i32, bool)> = contour.iter().map(|&point| round(point)).collect();
        // An on-curve point exactly halfway between two control points (after
        // rounding) is implied and need not be written. The first point stays,
        // so the contour starts where it did.
        let count = rounded.len();
        let points: Vec<(i16, i16, bool)> = (0..count).filter(|&index| {
            let (x, y, on) = rounded[index];
            let (before, after) = (rounded[(index + count - 1) % count], rounded[(index + 1) % count]);
            index == 0 || !(on && !before.2 && !after.2 && before.0 + after.0 == 2 * x && before.1 + after.1 == 2 * y)
        }).map(|index| (rounded[index].0 as i16, rounded[index].1 as i16, rounded[index].2)).collect();
        if !points.is_empty() { contours.push(points); }
    }
    if contours.is_empty() { return Ok(None); }
    let all = || contours.iter().flatten();
    let bounds = [all().map(|p| p.0).min().unwrap(), all().map(|p| p.1).min().unwrap(), all().map(|p| p.0).max().unwrap(), all().map(|p| p.1).max().unwrap()];
    let mut data = Vec::new();
    data.extend_from_slice(&(contours.len() as i16).to_be_bytes());
    for value in bounds { data.extend_from_slice(&value.to_be_bytes()); }
    let mut end = 0usize;
    for contour in &contours {
        end += contour.len();
        data.extend_from_slice(&((end - 1) as u16).to_be_bytes());
    }
    data.extend_from_slice(&0u16.to_be_bytes());
    // Flags with short and repeated encodings, then x and y deltas.
    let (mut flags, mut xs, mut ys) = (Vec::new(), Vec::new(), Vec::new());
    let (mut x, mut y) = (0i32, 0i32);
    for &(px, py, on) in all() {
        let mut flag = u8::from(on);
        for (delta, short, same_or_positive, out) in [(i32::from(px) - x, 0x02, 0x10, &mut xs), (i32::from(py) - y, 0x04, 0x20, &mut ys)] {
            if delta == 0 { flag |= same_or_positive; }
            else if delta.abs() <= 255 { flag |= short | if delta > 0 { same_or_positive } else { 0 }; out.push(delta.unsigned_abs() as u8); }
            else { out.extend_from_slice(&(delta as i16).to_be_bytes()); }
        }
        (x, y) = (i32::from(px), i32::from(py));
        flags.push(flag);
    }
    let mut index = 0;
    while index < flags.len() {
        let run = flags[index..].iter().take(256).take_while(|&&flag| flag == flags[index]).count();
        if run > 1 { data.extend_from_slice(&[flags[index] | 0x08, (run - 1) as u8]); } else { data.push(flags[index]); }
        index += run;
    }
    data.extend_from_slice(&xs);
    data.extend_from_slice(&ys);
    Ok(Some(Drawn { data, bounds, points: end, contours: contours.len() }))
}

/// A cmap with a format 4 subtable for the BMP and, when a character lies
/// beyond it, a format 12 subtable for all characters.
fn cmap(mapping: &[(u32, u16)]) -> Result<Vec<u8>> {
    let bmp: Vec<(u32, u16)> = mapping.iter().copied().filter(|(codepoint, _)| *codepoint < 0xFFFF).collect();
    let mut subtables = vec![format4(&bmp)?];
    let full = mapping.iter().any(|(codepoint, _)| *codepoint > 0xFFFF);
    if full { subtables.push(format12(mapping)); }
    let records: &[(u16, u16, usize)] = if full { &[(0, 3, 0), (0, 4, 1), (3, 1, 0), (3, 10, 1)] } else { &[(0, 3, 0), (3, 1, 0)] };
    let mut offsets = Vec::new();
    let mut offset = 4 + 8 * records.len();
    for subtable in &subtables { offsets.push(offset); offset += subtable.len(); }
    let mut table = Vec::with_capacity(offset);
    table.extend_from_slice(&0u16.to_be_bytes());
    table.extend_from_slice(&(records.len() as u16).to_be_bytes());
    for &(platform, encoding, index) in records {
        table.extend_from_slice(&platform.to_be_bytes());
        table.extend_from_slice(&encoding.to_be_bytes());
        table.extend_from_slice(&(offsets[index] as u32).to_be_bytes());
    }
    for subtable in subtables { table.extend_from_slice(&subtable); }
    Ok(table)
}

/// Format 4: one delta segment per run of consecutive characters with
/// consecutive glyphs. If that exceeds the 64 KiB subtable limit, nearby runs
/// merge into glyph-array segments with growing gaps until it fits.
fn format4(map: &[(u32, u16)]) -> Result<Vec<u8>> {
    let mut runs: Vec<(usize, usize)> = Vec::new();
    for index in 0..map.len() {
        let continues = index > 0 && map[index].0 == map[index - 1].0 + 1
            && map[index].1.wrapping_sub(map[index - 1].1) == 1;
        if continues { runs.last_mut().expect("run").1 = index; } else { runs.push((index, index)); }
    }
    for gap in std::iter::once(None).chain((0..17).map(|bits| Some((1u32 << bits) - 1))) {
        let mut segments: Vec<Vec<(usize, usize)>> = Vec::new();
        for &run in &runs {
            match (segments.last_mut(), gap) {
                (Some(segment), Some(gap)) if map[run.0].0 - map[segment.last().expect("run").1].0 - 1 <= gap => segment.push(run),
                _ => segments.push(vec![run]),
            }
        }
        let array: usize = segments.iter().filter(|s| s.len() > 1)
            .map(|s| (map[s.last().expect("run").1].0 - map[s[0].0].0 + 1) as usize).sum();
        let count = segments.len() + 1;
        let length = 16 + count * 8 + array * 2;
        if length > 0xFFFF { continue; }
        let mut ends = Vec::with_capacity(count);
        let mut starts = Vec::with_capacity(count);
        let mut deltas = Vec::with_capacity(count);
        let mut range_offsets = Vec::with_capacity(count);
        let mut glyphs: Vec<u16> = Vec::with_capacity(array);
        for (index, segment) in segments.iter().enumerate() {
            let (first, last) = (map[segment[0].0], map[segment.last().expect("run").1]);
            starts.push(first.0 as u16);
            ends.push(last.0 as u16);
            if segment.len() == 1 {
                deltas.push(first.1.wrapping_sub(first.0 as u16));
                range_offsets.push(0u16);
            } else {
                deltas.push(0);
                range_offsets.push((2 * (count - index + glyphs.len())) as u16);
                let mut codepoint = first.0;
                for &(from, to) in segment {
                    while codepoint < map[from].0 { glyphs.push(0); codepoint += 1; }
                    for &(_, glyph) in &map[from..=to] { glyphs.push(glyph); codepoint += 1; }
                }
            }
        }
        starts.push(0xFFFF);
        ends.push(0xFFFF);
        deltas.push(1);
        range_offsets.push(0);
        let selector = (usize::BITS - 1 - count.leading_zeros()) as u16;
        let search = 2u16 << selector;
        let mut table = Vec::with_capacity(length);
        for value in [4u16, length as u16, 0, (count * 2) as u16, search, selector, (count * 2) as u16 - search] {
            table.extend_from_slice(&value.to_be_bytes());
        }
        for value in ends { table.extend_from_slice(&value.to_be_bytes()); }
        table.extend_from_slice(&0u16.to_be_bytes());
        for column in [starts, deltas, range_offsets, glyphs] {
            for value in column { table.extend_from_slice(&value.to_be_bytes()); }
        }
        debug_assert_eq!(table.len(), length);
        return Ok(table);
    }
    bail!("UI_FONT_SUBSET_CMAP_OVERFLOW: too many characters for a format 4 cmap; set \"subset\": false for this face")
}

/// Format 12: one group per run of consecutive characters and glyphs.
fn format12(map: &[(u32, u16)]) -> Vec<u8> {
    let mut groups: Vec<(u32, u32, u32)> = Vec::new();
    for &(codepoint, glyph) in map {
        match groups.last_mut() {
            Some(group) if codepoint == group.1 + 1 && u32::from(glyph) == group.2 + (codepoint - group.0) => group.1 = codepoint,
            _ => groups.push((codepoint, codepoint, u32::from(glyph))),
        }
    }
    let mut table = Vec::with_capacity(16 + groups.len() * 12);
    table.extend_from_slice(&12u16.to_be_bytes());
    table.extend_from_slice(&0u16.to_be_bytes());
    table.extend_from_slice(&((16 + groups.len() * 12) as u32).to_be_bytes());
    table.extend_from_slice(&0u32.to_be_bytes());
    table.extend_from_slice(&(groups.len() as u32).to_be_bytes());
    for (start, end, glyph) in groups {
        for value in [start, end, glyph] { table.extend_from_slice(&value.to_be_bytes()); }
    }
    table
}

fn checksum(data: &[u8]) -> u32 {
    data.chunks(4).fold(0u32, |sum, chunk| {
        let mut word = [0u8; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

/// Writes a TrueType file: sorted table directory, 4-byte aligned tables and
/// the head checksum adjustment.
fn assemble(mut tables: Vec<([u8; 4], Vec<u8>)>) -> Vec<u8> {
    tables.sort_by(|a, b| a.0.cmp(&b.0));
    let count = tables.len();
    let selector = usize::BITS - 1 - count.leading_zeros();
    let search = 16usize << selector;
    let mut font = Vec::new();
    font.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    for value in [count as u16, search as u16, selector as u16, (count * 16 - search) as u16] {
        font.extend_from_slice(&value.to_be_bytes());
    }
    let mut offset = 12 + count * 16;
    let mut head_offset = None;
    for (tag, data) in &tables {
        font.extend_from_slice(tag);
        font.extend_from_slice(&checksum(data).to_be_bytes());
        font.extend_from_slice(&(offset as u32).to_be_bytes());
        font.extend_from_slice(&(data.len() as u32).to_be_bytes());
        if tag == b"head" { head_offset = Some(offset); }
        offset += data.len().div_ceil(4) * 4;
    }
    for (_, data) in &tables {
        font.extend_from_slice(data);
        font.resize(font.len().div_ceil(4) * 4, 0);
    }
    if let Some(at) = head_offset {
        let adjustment = 0xB1B0_AFBAu32.wrapping_sub(checksum(&font));
        font[at + 8..at + 12].copy_from_slice(&adjustment.to_be_bytes());
    }
    font
}

/// A small TrueType font built in code for tests: simple and composite
/// glyphs, a character beyond the BMP and a glyph no character maps.
#[cfg(test)]
pub(crate) mod fixture {
    #[derive(Default)]
    pub(crate) struct Options {
        pub fs_type: u16,
        /// Arabic alef, so layout-dependent text can be tested.
        pub arabic: bool,
        /// A wght axis (100..900, default 400): at 900 'A' raises its apex by
        /// 100 units and widens its advance by 40.
        pub variable: bool,
        pub extra_tables: Vec<([u8; 4], Vec<u8>)>,
    }

    /// Characters and the glyph each maps to; glyph 4 ('文') is a composite of
    /// glyphs 3 ('中') and 2 ('Z'), and the last glyph is mapped by nothing.
    pub(crate) const CHARACTERS: [(char, u16); 6] = [('A', 1), ('Z', 2), ('中', 3), ('文', 4), ('字', 5), ('\u{20000}', 6)];

    fn simple(points: &[(i16, i16)]) -> Vec<u8> {
        curved(&points.iter().map(|&(x, y)| (x, y, true)).collect::<Vec<_>>())
    }

    /// One contour; `false` marks a quadratic control point.
    fn curved(points: &[(i16, i16, bool)]) -> Vec<u8> {
        let (xs, ys): (Vec<i16>, Vec<i16>) = points.iter().map(|&(x, y, _)| (x, y)).unzip();
        let mut glyph = Vec::new();
        for value in [1, *xs.iter().min().unwrap(), *ys.iter().min().unwrap(), *xs.iter().max().unwrap(), *ys.iter().max().unwrap()] {
            glyph.extend_from_slice(&value.to_be_bytes());
        }
        glyph.extend_from_slice(&(points.len() as u16 - 1).to_be_bytes());
        glyph.extend_from_slice(&0u16.to_be_bytes());
        glyph.extend(points.iter().map(|&(_, _, on)| u8::from(on)));
        for column in [&xs, &ys] {
            let mut previous = 0i16;
            for &value in column.iter() { glyph.extend_from_slice(&(value - previous).to_be_bytes()); previous = value; }
        }
        glyph
    }

    fn composite(parts: &[(u16, i16, i16)]) -> Vec<u8> {
        let mut glyph = Vec::new();
        for value in [-1i16, 0, 0, 700, 700] { glyph.extend_from_slice(&value.to_be_bytes()); }
        for (index, &(component, dx, dy)) in parts.iter().enumerate() {
            let more = if index + 1 < parts.len() { 0x0020 } else { 0 };
            glyph.extend_from_slice(&(0x0001u16 | 0x0002 | more).to_be_bytes());
            glyph.extend_from_slice(&component.to_be_bytes());
            glyph.extend_from_slice(&dx.to_be_bytes());
            glyph.extend_from_slice(&dy.to_be_bytes());
        }
        glyph
    }

    fn fields(values: &[(i64, usize)]) -> Vec<u8> {
        values.iter().flat_map(|&(value, size)| value.to_be_bytes()[8 - size..].to_vec()).collect()
    }

    pub(crate) fn font(options: Options) -> Vec<u8> {
        let mut glyphs = vec![
            simple(&[(50, 0), (50, 700), (450, 700), (450, 0)]),
            simple(&[(0, 0), (250, 700), (500, 0)]),
            simple(&[(10, 0), (10, 100), (490, 600), (490, 700)]),
            simple(&[(100, 100), (100, 600), (600, 600), (600, 100)]),
            composite(&[(3, 0, 0), (2, 50, 20)]),
            // Two control points in a row imply an on-curve point between them.
            curved(&[(20, 20, true), (20, 680, false), (680, 680, false), (680, 20, true)]),
            simple(&[(0, 0), (0, 500), (500, 500), (500, 0), (250, 250)]),
        ];
        let mut characters = CHARACTERS.to_vec();
        if options.arabic {
            characters.push(('\u{0627}', glyphs.len() as u16));
            glyphs.push(simple(&[(200, 0), (200, 700), (260, 700), (260, 0)]));
        }
        glyphs.push(simple(&[(5, 5), (5, 50), (50, 50)]));
        let count = glyphs.len() as i64;
        let mut glyf = Vec::new();
        let mut loca = Vec::new();
        for glyph in &glyphs {
            loca.extend_from_slice(&(glyf.len() as u32).to_be_bytes());
            glyf.extend_from_slice(glyph);
            glyf.resize(glyf.len().div_ceil(4) * 4, 0);
        }
        loca.extend_from_slice(&(glyf.len() as u32).to_be_bytes());
        let mut hmtx = Vec::new();
        for gid in 0..count as u16 {
            hmtx.extend_from_slice(&(500 + gid * 10).to_be_bytes());
            hmtx.extend_from_slice(&gid.to_be_bytes());
        }
        let head = fields(&[(0x0001_0000, 4), (0x0001_0000, 4), (0, 4), (0x5F0F_3CF5, 4), (0x000B, 2), (1000, 2), (0, 8), (0, 8),
            (0, 2), (0, 2), (700, 2), (700, 2), (0, 2), (8, 2), (2, 2), (1, 2), (0, 2)]);
        assert_eq!(head.len(), 54);
        let hhea = fields(&[(0x0001_0000, 4), (880, 2), (-120, 2), (0, 2), (600, 2), (0, 2), (0, 2), (600, 2), (1, 2), (0, 2), (0, 2),
            (0, 2), (0, 2), (0, 2), (0, 2), (0, 2), (count, 2)]);
        assert_eq!(hhea.len(), 36);
        let maxp = fields(&[(0x0001_0000, 4), (count, 2), (8, 2), (1, 2), (8, 2), (2, 2), (2, 2), (0, 2), (0, 2), (0, 2), (0, 2),
            (0, 2), (0, 2), (2, 2), (1, 2)]);
        let mut os2 = vec![0u8; 96];
        os2[0..2].copy_from_slice(&4u16.to_be_bytes());
        os2[4..6].copy_from_slice(&400u16.to_be_bytes());
        os2[6..8].copy_from_slice(&5u16.to_be_bytes());
        os2[8..10].copy_from_slice(&options.fs_type.to_be_bytes());
        let mut post = vec![0u8; 32];
        post[0..4].copy_from_slice(&0x0003_0000u32.to_be_bytes());
        let family: Vec<u8> = "Fixture".encode_utf16().flat_map(u16::to_be_bytes).collect();
        let mut name = fields(&[(0, 2), (1, 2), (18, 2), (3, 2), (1, 2), (0x409, 2), (1, 2), (family.len() as i64, 2), (0, 2)]);
        name.extend_from_slice(&family);
        let mut mapping: Vec<(u32, u16)> = characters.iter().map(|&(ch, gid)| (ch as u32, gid)).collect();
        mapping.sort_unstable();
        let mut tables = vec![(*b"head", head), (*b"hhea", hhea), (*b"maxp", maxp), (*b"hmtx", hmtx), (*b"loca", loca),
            (*b"glyf", glyf), (*b"cmap", super::cmap(&mapping).unwrap()), (*b"OS/2", os2), (*b"post", post), (*b"name", name)];
        if options.variable {
            // fvar: one wght axis, 100..900, default 400, named by name ID 256.
            let fvar = fields(&[(1, 2), (0, 2), (16, 2), (2, 2), (1, 2), (20, 2), (0, 2), (8, 2),
                (i64::from(u32::from_be_bytes(*b"wght")), 4), (100 << 16, 4), (400 << 16, 4), (900 << 16, 4), (0, 2), (256, 2)]);
            // gvar: glyph 1 ('A': three points, then four phantom points) has one
            // tuple peaking at wght=900 with private "all points" numbers.
            let words = |values: &[i64]| -> Vec<u8> {
                let mut packed = vec![0x40 | (values.len() as u8 - 1)];
                packed.extend(fields(&values.iter().map(|&v| (v, 2)).collect::<Vec<_>>()));
                packed
            };
            let mut serialized = vec![0u8];
            serialized.extend(words(&[0, 0, 0, 0, 40, 0, 0]));
            serialized.extend(words(&[0, 100, 0, 0, 0, 0, 0]));
            let mut variation = fields(&[(1, 2), (10, 2), (serialized.len() as i64, 2), (0xA000, 2), (0x4000, 2)]);
            variation.extend(serialized);
            variation.resize(variation.len().div_ceil(4) * 4, 0);
            let array = 20 + (count as usize + 1) * 4;
            let mut gvar = fields(&[(1, 2), (0, 2), (1, 2), (0, 2), (array as i64, 4), (count, 2), (1, 2), (array as i64, 4)]);
            for gid in 0..=count { gvar.extend(fields(&[(if gid >= 2 { variation.len() as i64 } else { 0 }, 4)])); }
            gvar.extend(variation);
            tables.extend([(*b"fvar", fvar), (*b"gvar", gvar)]);
        }
        tables.extend(options.extra_tables);
        super::assemble(tables)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ttf_parser::{Face, GlyphId, OutlineBuilder};

    struct Path(Vec<String>);
    impl OutlineBuilder for Path {
        fn move_to(&mut self, x: f32, y: f32) { self.0.push(format!("M{x},{y}")); }
        fn line_to(&mut self, x: f32, y: f32) { self.0.push(format!("L{x},{y}")); }
        fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) { self.0.push(format!("Q{x1},{y1},{x},{y}")); }
        fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) { self.0.push(format!("C{x1},{y1},{x2},{y2},{x},{y}")); }
        fn close(&mut self) { self.0.push("Z".into()); }
    }

    fn drawing(face: &Face, ch: char) -> (Vec<String>, Option<u16>) {
        let glyph = face.glyph_index(ch).unwrap();
        let mut path = Path(Vec::new());
        face.outline_glyph(glyph, &mut path);
        (path.0, face.glyph_hor_advance(glyph))
    }

    #[test]
    fn subset_maps_only_requested_characters_and_draws_them_identically() {
        let original = fixture::font(fixture::Options::default());
        let wanted: BTreeSet<char> = ['A', '文', '\u{20000}', '缺'].into();
        let result = subset(&original, &wanted, 400).unwrap();
        assert_eq!(coverage(&result.bytes).unwrap(), ['A', '文', '\u{20000}'].into(), "only requested characters the font has stay mapped");
        // .notdef, A, 文, U+20000, then 文's components 中 and Z (kept as glyphs, not characters).
        assert_eq!((result.glyphs, result.original_glyphs, result.characters), (6, 8, 3));
        assert!(result.bytes.len() < original.len());
        assert!(result.dropped_tables.is_empty(), "{:?}", result.dropped_tables);
        let (before, after) = (Face::parse(&original, 0).unwrap(), Face::parse(&result.bytes, 0).unwrap());
        for ch in wanted.iter().copied().filter(|ch| *ch != '缺') {
            assert_eq!(drawing(&before, ch), drawing(&after, ch), "{ch} keeps its outline and advance");
        }
        let mut path = Path(Vec::new());
        after.outline_glyph(GlyphId(0), &mut path);
        assert!(!path.0.is_empty(), ".notdef keeps its outline");
        assert_eq!(after.names().into_iter().find_map(|name| name.to_string()), Some("Fixture".into()), "name table (license, copyright) is kept");
    }

    #[test]
    fn subset_is_deterministic_and_drops_layout_tables_it_cannot_renumber() {
        let font = fixture::font(fixture::Options { extra_tables: vec![(*b"GSUB", vec![0; 10]), (*b"kern", vec![0; 4])], ..Default::default() });
        let wanted: BTreeSet<char> = ['A', '字'].into();
        let first = subset(&font, &wanted, 400).unwrap();
        assert_eq!(first.bytes, subset(&font, &wanted, 400).unwrap().bytes);
        assert_eq!(first.dropped_tables, ["GSUB", "kern"]);
        assert_eq!(coverage(&first.bytes).unwrap(), wanted);
    }

    #[test]
    fn unsupported_or_forbidden_fonts_are_refused_explicitly() {
        let wanted: BTreeSet<char> = ['A'].into();
        let mut cff = fixture::font(fixture::Options::default());
        cff[0..4].copy_from_slice(b"OTTO");
        let color = fixture::font(fixture::Options { extra_tables: vec![(*b"COLR", vec![0; 14])], ..Default::default() });
        let forbidden = fixture::font(fixture::Options { fs_type: 0x0100, ..Default::default() });
        for (font, code) in [(cff, "UI_FONT_SUBSET_UNSUPPORTED"), (color, "UI_FONT_SUBSET_UNSUPPORTED"),
            (forbidden, "UI_FONT_SUBSET_FORBIDDEN"), (b"not a font".to_vec(), "UI_FONT_INVALID")] {
            let message = subset(&font, &wanted, 400).err().unwrap().to_string();
            assert!(message.contains(code), "{message}");
        }
    }

    #[test]
    fn variable_fonts_become_static_instances_at_the_declared_weight() {
        let font = fixture::font(fixture::Options { variable: true, ..Default::default() });
        assert!(is_variable(&font));
        let original = Face::parse(&font, 0).unwrap();
        let wanted: BTreeSet<char> = ['A', '文', '字'].into();
        let (apex, _) = drawing(&original, 'A');
        assert!(apex.contains(&"L250,700".to_string()), "{apex:?}");
        for (weight, y, advance) in [(400, 700, 510), (650, 750, 530), (900, 800, 550)] {
            let result = subset(&font, &wanted, weight).unwrap();
            assert!(!is_variable(&result.bytes) && !has_table(&result.bytes, b"gvar"), "an instance does not vary");
            assert!(result.dropped_tables.contains(&"fvar".to_string()) && result.dropped_tables.contains(&"gvar".to_string()));
            let instance = Face::parse(&result.bytes, 0).unwrap();
            let (path, width) = drawing(&instance, 'A');
            let expected: Vec<String> = apex.iter().map(|step| if step == "L250,700" { format!("L250,{y}") } else { step.clone() }).collect();
            assert_eq!((path, width), (expected, Some(advance)), "weight {weight}");
            assert_eq!(instance.weight().to_number(), weight, "OS/2 names the instance's weight");
            // Composites come out flattened; curves keep their implied points.
            for ch in ['文', '字'] { assert_eq!(drawing(&instance, ch), drawing(&original, ch), "{ch} at weight {weight}"); }
        }
        let curve = draw(&original, original.glyph_index('字').unwrap(), None).unwrap().unwrap();
        assert_eq!(curve.points, 4, "the implied midpoint between two control points is not written");
        let message = subset(&font, &wanted, 950).err().unwrap().to_string();
        assert!(message.contains("UI_FONT_SUBSET_WEIGHT_OUT_OF_RANGE"), "{message}");
    }

    /// UNONE_FONT_SUBSET_FONT=<font.ttf> UNONE_FONT_SUBSET_TEXT=<utf-8 file>
    /// [UNONE_FONT_SUBSET_OUT=<subset.ttf>] cargo test -p unone-cli --bin game
    /// real_font -- --ignored --nocapture
    #[test]
    #[ignore = "needs a real font and text named by environment variables"]
    fn real_font_subset_draws_every_kept_character_identically() {
        let font = std::fs::read(std::env::var("UNONE_FONT_SUBSET_FONT").unwrap()).unwrap();
        let text = std::fs::read_to_string(std::env::var("UNONE_FONT_SUBSET_TEXT").unwrap()).unwrap();
        let wanted: BTreeSet<char> = text.chars().chain((0x20u8..0x7F).map(char::from)).collect();
        let started = std::time::Instant::now();
        let result = subset(&font, &wanted, 400).unwrap();
        let elapsed = started.elapsed();
        let (before, after) = (Face::parse(&font, 0).unwrap(), Face::parse(&result.bytes, 0).unwrap());
        let kept = coverage(&result.bytes).unwrap();
        assert_eq!(kept, coverage(&font).unwrap().intersection(&wanted).copied().collect());
        for &ch in &kept {
            assert_eq!(drawing(&before, ch), drawing(&after, ch), "U+{:04X}", ch as u32);
            let (old, new) = (before.glyph_index(ch).unwrap(), after.glyph_index(ch).unwrap());
            assert_eq!(before.glyph_ver_advance(old), after.glyph_ver_advance(new), "U+{:04X} vertical advance", ch as u32);
        }
        if let Ok(out) = std::env::var("UNONE_FONT_SUBSET_OUT") { std::fs::write(out, &result.bytes).unwrap(); }
        println!("{} -> {} bytes, {} -> {} glyphs, {} characters, dropped {:?}, {elapsed:?}",
            font.len(), result.bytes.len(), result.original_glyphs, result.glyphs, result.characters, result.dropped_tables);
    }

    /// Steps of a drawing with their coordinates, for comparisons with a tolerance.
    #[derive(Default)]
    struct Steps(Vec<(char, Vec<f32>)>);
    impl OutlineBuilder for Steps {
        fn move_to(&mut self, x: f32, y: f32) { self.0.push(('M', vec![x, y])); }
        fn line_to(&mut self, x: f32, y: f32) { self.0.push(('L', vec![x, y])); }
        fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) { self.0.push(('Q', vec![x1, y1, x, y])); }
        fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) { self.0.push(('C', vec![x1, y1, x2, y2, x, y])); }
        fn close(&mut self) { self.0.push(('Z', Vec::new())); }
    }

    /// UNONE_FONT_SUBSET_FONT=<variable.ttf> UNONE_FONT_SUBSET_REFERENCE=<static instance by another tool>
    /// UNONE_FONT_SUBSET_WEIGHT=<wght> UNONE_FONT_SUBSET_TEXT=<utf-8 file> cargo test -p unone-cli --bin game
    /// real_variable -- --ignored --nocapture
    #[test]
    #[ignore = "needs a real variable font, a reference instance and text named by environment variables"]
    fn real_variable_font_instance_matches_a_reference_instance() {
        let font = std::fs::read(std::env::var("UNONE_FONT_SUBSET_FONT").unwrap()).unwrap();
        let reference = std::fs::read(std::env::var("UNONE_FONT_SUBSET_REFERENCE").unwrap()).unwrap();
        let weight: u16 = std::env::var("UNONE_FONT_SUBSET_WEIGHT").unwrap().parse().unwrap();
        let text = std::fs::read_to_string(std::env::var("UNONE_FONT_SUBSET_TEXT").unwrap()).unwrap();
        let wanted: BTreeSet<char> = text.chars().chain((0x20u8..0x7F).map(char::from)).collect();
        let started = std::time::Instant::now();
        let result = subset(&font, &wanted, weight).unwrap();
        let elapsed = started.elapsed();
        let (expected, actual) = (Face::parse(&reference, 0).unwrap(), Face::parse(&result.bytes, 0).unwrap());
        let (mut compared, mut largest) = (0, 0f32);
        for ch in coverage(&result.bytes).unwrap() {
            let (want, got) = (expected.glyph_index(ch).unwrap(), actual.glyph_index(ch).unwrap());
            let (mut a, mut b) = (Steps::default(), Steps::default());
            expected.outline_glyph(want, &mut a);
            actual.outline_glyph(got, &mut b);
            if std::env::var("UNONE_FONT_SUBSET_DEBUG").is_ok() && a.0.len() == b.0.len() && a.0.iter().zip(&b.0).any(|(x, y)| x.0 != y.0) { println!("REF {:?}
OUR {:?}", a.0, b.0); }
            assert_eq!(a.0.iter().map(|s| s.0).collect::<String>(), b.0.iter().map(|s| s.0).collect::<String>(), "U+{:04X} steps", ch as u32);
            for (x, y) in a.0.iter().zip(&b.0) {
                for (p, q) in x.1.iter().zip(&y.1) { largest = largest.max((p - q).abs()); }
            }
            let advances = (expected.glyph_hor_advance(want).unwrap() as i32, actual.glyph_hor_advance(got).unwrap() as i32);
            assert!((advances.0 - advances.1).abs() <= 1, "U+{:04X} advance {advances:?}", ch as u32);
            compared += 1;
        }
        assert!(largest <= 1.0, "largest coordinate difference {largest}");
        if let Ok(out) = std::env::var("UNONE_FONT_SUBSET_OUT") { std::fs::write(out, &result.bytes).unwrap(); }
        println!("{compared} characters within {largest} units of the reference");
        println!("{} -> {} bytes, {} -> {} glyphs, {} characters, dropped {:?}, {elapsed:?}",
            font.len(), result.bytes.len(), result.original_glyphs, result.glyphs, result.characters, result.dropped_tables);
    }

    #[test]
    fn format4_merges_sparse_runs_into_glyph_arrays_when_segments_overflow() {
        // 12,000 characters two codepoints apart would need 12,000 delta
        // segments (96 KB), more than a format 4 subtable can hold; one glyph
        // array over their 24,000 codepoints (48 KB) fits.
        let mapping: Vec<(u32, u16)> = (0..12_000u32).map(|i| (0x4E00 + i * 2, 1 + i as u16)).collect();
        let table = cmap(&mapping).unwrap();
        let parsed = ttf_parser::cmap::Table::parse(&table).unwrap();
        let windows = parsed.subtables.into_iter().find(|s| s.platform_id == ttf_parser::PlatformId::Windows).unwrap();
        for &(codepoint, glyph) in &mapping {
            assert_eq!(windows.glyph_index(codepoint), Some(GlyphId(glyph)));
            assert_eq!(windows.glyph_index(codepoint + 1), None);
        }
        // Three apart, neither encoding fits (96 KB of segments, 72 KB of array).
        let sparse: Vec<(u32, u16)> = (0..12_000u32).map(|i| (0x4E00 + i * 3, 1 + i as u16)).collect();
        assert!(cmap(&sparse).unwrap_err().to_string().contains("UI_FONT_SUBSET_CMAP_OVERFLOW"));
        let beyond: Vec<(u32, u16)> = vec![(0x41, 1), (0x20000, 2), (0x20001, 3)];
        let table = cmap(&beyond).unwrap();
        let parsed = ttf_parser::cmap::Table::parse(&table).unwrap();
        assert_eq!(parsed.subtables.len(), 4);
        let full = parsed.subtables.into_iter().find(|s| s.platform_id == ttf_parser::PlatformId::Windows && s.encoding_id == 10).unwrap();
        assert_eq!((full.glyph_index(0x41), full.glyph_index(0x20001)), (Some(GlyphId(1)), Some(GlyphId(3))));
    }
}

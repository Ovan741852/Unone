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
//! CFF outlines, variable fonts, collections and color glyphs are refused
//! with `UI_FONT_SUBSET_UNSUPPORTED` rather than written incompletely.

use anyhow::{anyhow, bail, ensure, Context, Result};
use std::collections::BTreeSet;

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

pub(crate) fn subset(font: &[u8], wanted: &BTreeSet<char>) -> Result<Subset> {
    let tables = directory(font)?;
    let get = |tag: &[u8; 4]| tables.iter().find(|(t, _)| t == tag).map(|(_, data)| *data);
    let need = |tag: &[u8; 4]| get(tag).with_context(|| format!("UI_FONT_INVALID: the font has no {} table", tag_name(tag)));
    for (tag, what) in [(b"fvar", "a variable font; package static instances"), (b"gvar", "a variable font; package static instances"),
        (b"CFF ", "CFF outlines"), (b"CFF2", "CFF2 outlines"), (b"COLR", "color glyphs"), (b"sbix", "color bitmap glyphs"),
        (b"CBDT", "color bitmap glyphs"), (b"SVG ", "SVG glyphs")] {
        ensure!(get(tag).is_none(), "UI_FONT_SUBSET_UNSUPPORTED: the font has {what}, which subsetting does not support; set \"subset\": false for this face or package a static TrueType (glyf) face");
    }
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

    let face = ttf_parser::Face::parse(font, 0).map_err(|error| anyhow!("UI_FONT_INVALID: the font cannot be parsed: {error}"))?;
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
    // Composite glyphs pull in their components, transitively.
    let mut next = 0;
    while next < order.len() {
        let data = glyph(order[next] as usize)?;
        for position in component_positions(data)? {
            add(be16(data, position)?, &mut order)?;
        }
        next += 1;
    }
    mapping.sort_unstable();

    let mut glyf_out = Vec::new();
    let mut offsets = Vec::with_capacity(order.len() + 1);
    for &old in &order {
        offsets.push(glyf_out.len());
        let data = glyph(old as usize)?;
        let start = glyf_out.len();
        glyf_out.extend_from_slice(data);
        for position in component_positions(data)? {
            let renumbered = new_id[be16(data, position)? as usize];
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
    out.push((*b"head", head_out));
    let mut maxp_out = maxp.to_vec();
    maxp_out[4..6].copy_from_slice(&(order.len() as u16).to_be_bytes());
    out.push((*b"maxp", maxp_out));
    let (hhea_out, hmtx_out) = metrics(hhea, hmtx, num_glyphs, &order).context("UI_FONT_INVALID: horizontal metrics")?;
    out.push((*b"hhea", hhea_out));
    out.push((*b"hmtx", hmtx_out));
    if let (Some(vhea), Some(vmtx)) = (get(b"vhea"), get(b"vmtx")) {
        let (vhea_out, vmtx_out) = metrics(vhea, vmtx, num_glyphs, &order).context("UI_FONT_INVALID: vertical metrics")?;
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
        out.push((*b"OS/2", os2_out));
    }
    for tag in KEPT {
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

/// Rebuilds `hhea`+`hmtx` (or `vhea`+`vmtx`, same layout) for the new glyph
/// order, writing one long metric per glyph until the trailing advances repeat.
fn metrics(header: &[u8], table: &[u8], num_glyphs: usize, order: &[u16]) -> Result<(Vec<u8>, Vec<u8>)> {
    ensure!(header.len() >= 36, "header is truncated");
    let long = (be16(header, 34)? as usize).min(num_glyphs);
    ensure!(long >= 1, "no long metrics");
    let metric = |gid: usize| -> Result<(u16, u16)> {
        if gid < long { Ok((be16(table, gid * 4)?, be16(table, gid * 4 + 2)?)) }
        else { Ok((be16(table, (long - 1) * 4)?, be16(table, long * 4 + (gid - long) * 2)?)) }
    };
    let values: Vec<(u16, u16)> = order.iter().map(|&gid| metric(gid as usize)).collect::<Result<_>>()?;
    let last = values.last().expect("subset keeps .notdef").0;
    let repeated = values.iter().rev().take_while(|(advance, _)| *advance == last).count();
    let long_out = values.len() - repeated + 1;
    let mut header_out = header.to_vec();
    header_out[34..36].copy_from_slice(&(long_out as u16).to_be_bytes());
    let mut table_out = Vec::with_capacity(long_out * 4 + (values.len() - long_out) * 2);
    for (index, (advance, side)) in values.iter().enumerate() {
        if index < long_out { table_out.extend_from_slice(&advance.to_be_bytes()); }
        table_out.extend_from_slice(&side.to_be_bytes());
    }
    Ok((header_out, table_out))
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
        pub extra_tables: Vec<([u8; 4], Vec<u8>)>,
    }

    /// Characters and the glyph each maps to; glyph 4 ('文') is a composite of
    /// glyphs 3 ('中') and 2 ('Z'), and the last glyph is mapped by nothing.
    pub(crate) const CHARACTERS: [(char, u16); 6] = [('A', 1), ('Z', 2), ('中', 3), ('文', 4), ('字', 5), ('\u{20000}', 6)];

    fn simple(points: &[(i16, i16)]) -> Vec<u8> {
        let (xs, ys): (Vec<i16>, Vec<i16>) = points.iter().copied().unzip();
        let mut glyph = Vec::new();
        for value in [1, *xs.iter().min().unwrap(), *ys.iter().min().unwrap(), *xs.iter().max().unwrap(), *ys.iter().max().unwrap()] {
            glyph.extend_from_slice(&value.to_be_bytes());
        }
        glyph.extend_from_slice(&(points.len() as u16 - 1).to_be_bytes());
        glyph.extend_from_slice(&0u16.to_be_bytes());
        glyph.extend(std::iter::repeat_n(1u8, points.len()));
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
            simple(&[(20, 20), (20, 680), (680, 680)]),
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
        let result = subset(&original, &wanted).unwrap();
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
        let first = subset(&font, &wanted).unwrap();
        assert_eq!(first.bytes, subset(&font, &wanted).unwrap().bytes);
        assert_eq!(first.dropped_tables, ["GSUB", "kern"]);
        assert_eq!(coverage(&first.bytes).unwrap(), wanted);
    }

    #[test]
    fn unsupported_or_forbidden_fonts_are_refused_explicitly() {
        let wanted: BTreeSet<char> = ['A'].into();
        let mut cff = fixture::font(fixture::Options::default());
        cff[0..4].copy_from_slice(b"OTTO");
        let variable = fixture::font(fixture::Options { extra_tables: vec![(*b"fvar", vec![0; 16])], ..Default::default() });
        let color = fixture::font(fixture::Options { extra_tables: vec![(*b"COLR", vec![0; 14])], ..Default::default() });
        let forbidden = fixture::font(fixture::Options { fs_type: 0x0100, ..Default::default() });
        for (font, code) in [(cff, "UI_FONT_SUBSET_UNSUPPORTED"), (variable, "UI_FONT_SUBSET_UNSUPPORTED"), (color, "UI_FONT_SUBSET_UNSUPPORTED"),
            (forbidden, "UI_FONT_SUBSET_FORBIDDEN"), (b"not a font".to_vec(), "UI_FONT_INVALID")] {
            let message = subset(&font, &wanted).err().unwrap().to_string();
            assert!(message.contains(code), "{message}");
        }
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
        let result = subset(&font, &wanted).unwrap();
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

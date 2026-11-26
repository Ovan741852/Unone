//! Assets that declare `import` are produced by project importers before any
//! host reads them; see docs/import-pipeline.md.
use serde_json::{Value, json};
use std::path::Path;

const IMPORTERS: &str = r#"
return {
  palette = {
    inputs = {indices = "bytes", palette = "bytes"}, outputs = {image = "image", colors = "json"},
    run = function(inputs, params)
      local n = buffer.len(inputs.indices)
      local out = buffer.create(n * 4)
      for i = 0, n - 1 do
        local index = buffer.readu8(inputs.indices, i)
        for c = 0, 2 do buffer.writeu8(out, i * 4 + c, buffer.readu8(inputs.palette, index * 3 + c)) end
        buffer.writeu8(out, i * 4 + 3, if index == params.key then 0 else 255)
      end
      return {image = {width = n, height = 1, rgba = out}, colors = {count = buffer.len(inputs.palette) // 3}}
    end,
  },
  opaque = {
    inputs = {image = "image"}, outputs = {pixels = "json"},
    run = function(inputs)
      local opaque = 0
      for i = 0, inputs.image.width * inputs.image.height - 1 do
        if buffer.readu8(inputs.image.rgba, i * 4 + 3) > 0 then opaque += 1 end
      end
      return {pixels = {opaque = opaque}}
    end,
  },
}"#;

fn write(path: &Path, text: impl AsRef<[u8]>) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn project(dir: &Path, assets: Value) {
    write(&dir.join("project.unone.json"), json!({"name": "imports", "entry_script": "main.luau", "asset_manifest": "assets.json",
        "import": {"importers": {"pal": {"module": "import/pop.luau", "node": "palette"}, "count": {"module": "import/pop.luau", "node": "opaque"}},
            "roots": {"original": {"description": "an installation the game may not redistribute", "candidates": ["${UNONE_TEST_NO_SUCH_VARIABLE}/x"]}}}}).to_string());
    write(&dir.join("main.luau"), "return {start = function(api) api.observation.set('stats', api.assets.load('data://opaque')); \
        api.observation.set('palette_bytes', buffer.len(api.assets.load('data://palette'))) end, update = function() end}");
    write(&dir.join("import/pop.luau"), IMPORTERS);
    write(&dir.join("assets.json"), json!({"version": 1, "assets": assets}).to_string());
}

fn assets() -> Value {
    json!([
        {"id": "texture://atlas", "kind": "texture2d", "source": "imported/atlas.png", "bundle": "terrain",
         "encoding": {"format": "png", "mime": "image/png", "decoder": "image"},
         "import": {"importer": "pal", "inputs": {"indices": "original:DATA/pixels.dat", "palette": "original:DATA/pal.dat"}, "params": {"key": 0}, "product": "image"}},
        {"id": "data://opaque", "kind": "data", "source": "imported/opaque.json",
         "encoding": {"format": "json", "mime": "application/json", "decoder": "json"},
         "import": {"importer": "count", "inputs": {"image": "asset:texture://atlas"}, "product": "pixels"}},
        // A file needing no conversion is copied as it is.
        {"id": "data://palette", "kind": "data", "source": "imported/pal.dat",
         "encoding": {"format": "binary", "mime": "application/octet-stream", "decoder": "bytes"},
         "import": {"from": "original:DATA/pal.dat"}},
    ])
}

#[test]
fn file_png_inputs_keep_encoded_bytes_and_decode_straight_rgba() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    let mut manifest = json!([
        {"id":"texture://input", "kind":"texture2d", "source":"input.PNG"},
        {"id":"data://pixels", "kind":"data", "source":"pixels.json", "import":{
            "importer":"count", "inputs":{"image":"asset:texture://input", "raw":"asset:texture://input"}, "product":"pixels"}}
    ]);
    project(dir, manifest.clone());
    let module = r#"return {opaque = {
        inputs = {image = "image", raw = "bytes"}, outputs = {pixels = "json"},
        run = function(inputs)
            local im = inputs.image
            local rgba = {}
            for i = 0, buffer.len(im.rgba)-1 do table.insert(rgba, buffer.readu8(im.rgba,i)) end
            return {pixels={im.width, im.height, rgba, buffer.len(inputs.raw), buffer.readu8(inputs.raw, 0)}}
        end}, palette={outputs={}, run=function() return {} end}}"#;
    write(&dir.join("import/pop.luau"), module);
    use png::{BitDepth::*, ColorType::*};
    for (color, depth, samples, expected) in [
        (Rgba, Eight, vec![200,64,16,0, 30,60,90,128], vec![200,64,16,0, 30,60,90,128]),
        (Rgb, Eight, vec![9,8,7, 6,5,4], vec![9,8,7,255, 6,5,4,255]),
        (GrayscaleAlpha, Sixteen, vec![29,99,200,55, 63,111,25,22], vec![29,29,29,200, 63,63,63,25]),
        (Grayscale, One, vec![0b0100_0000], vec![0,0,0,255, 255,255,255,255]),
        (Indexed, One, vec![0b0100_0000], vec![31,30,29,0, 98,97,96,123]),
    ] {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
            encoder.set_color(color);
            encoder.set_depth(depth);
            if color == Indexed {
                encoder.set_palette([31,30,29,98,97,96].as_slice());
                encoder.set_trns([0,123].as_slice());
            }
            encoder.write_header().unwrap().write_image_data(&samples).unwrap();
        }
        write(&dir.join("input.PNG"), &bytes);
        let report = unone_engine::prepare_imports(dir).unwrap();
        assert_eq!(report.ran, 1);
        let result: Value = serde_json::from_slice(&std::fs::read(dir.join("pixels.json")).unwrap()).unwrap();
        assert_eq!(result, json!([2,1,expected,bytes.len(),137]), "{color:?}");
        assert!(unone_engine::prepare_imports(dir).unwrap().up_to_date);
    }
    let previous = std::fs::read(dir.join("pixels.json")).unwrap();
    write(&dir.join("input.PNG"), b"bad PNG");
    assert_eq!(unone_engine::prepare_imports(dir).unwrap_err().code, "IMPORT_IMAGE_INVALID");
    assert_eq!(std::fs::read(dir.join("pixels.json")).unwrap(), previous);
    // A legal one-row header that exceeds the engine's dimension bound.
    let mut oversized = Vec::new();
    png::Encoder::new(&mut oversized, 16385, 1).write_header().unwrap().write_image_data(&vec![0; 16385]).unwrap();
    write(&dir.join("input.PNG"), oversized);
    assert_eq!(unone_engine::prepare_imports(dir).unwrap_err().code, "IMPORT_IMAGE_INVALID");
    for (kind, path) in [("data", "input.PNG"), ("texture2d", "input.svg")] {
        manifest[0]["kind"] = json!(kind);
        manifest[0]["source"] = json!(path);
        write(&dir.join("assets.json"), json!({"version":1,"assets":manifest}).to_string());
        assert_eq!(unone_engine::prepare_imports(dir).unwrap_err().code, "IMPORT_TYPE_MISMATCH");
    }
}

#[test]
fn webp_import_requires_matching_path_and_declared_encoding() {
    let temp = tempfile::tempdir().unwrap();
    let mut manifest = assets();
    manifest[0]["source"] = json!("imported/atlas.webp");
    project(temp.path(), manifest);
    assert_eq!(unone_engine::prepare_imports(temp.path()).unwrap_err().code, "IMPORT_IMAGE_ENCODING");
}

#[test]
#[ignore = "requires Python with Pillow/libwebp; select the interpreter with UNONE_PYTHON"]
fn webp_import_preserves_raw_pixels_for_chained_image_consumers() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    let mut manifest = assets();
    manifest[0]["source"] = json!("imported/atlas.webp");
    manifest[0]["encoding"] = json!({"format":"webp","mime":"image/webp","decoder":"image"});
    project(dir, manifest.clone());
    let input = dir.join("original");
    write(&dir.join(".unone/import-roots.json"), json!({"original":input}).to_string());
    write(&input.join("DATA/pal.dat"), [9, 8, 7, 10, 20, 30]);
    write(&input.join("DATA/pixels.dat"), [0, 1, 0]);
    let report = unone_engine::prepare_imports(dir).unwrap();
    assert_eq!(report.written, 3);
    assert_eq!((report.webp_encoded, report.webp_reused, report.png_encoded), (1, 0, 0));
    let encoded = std::fs::read(dir.join("imported/atlas.webp")).unwrap();
    assert_eq!(&encoded[8..16], b"WEBPVP8L");
    assert_eq!(serde_json::from_slice::<Value>(&std::fs::read(dir.join("imported/opaque.json")).unwrap()).unwrap(), json!({"opaque":1}));
    assert!(unone_engine::prepare_imports(dir).unwrap().up_to_date);
    manifest[0]["bundle"] = json!("world");
    write(&dir.join("assets.json"), json!({"version":1,"assets":manifest}).to_string());
    let again = unone_engine::prepare_imports(dir).unwrap();
    assert_eq!((again.webp_encoded, again.webp_reused, again.written), (0, 1, 0));
    let output = dir.join("imported/atlas.webp");
    let mut bad = encoded.clone();
    *bad.last_mut().unwrap() ^= 1;
    write(&output, bad);
    let repaired = unone_engine::prepare_imports(dir).unwrap();
    assert_eq!((repaired.webp_encoded, repaired.webp_reused, repaired.written), (1, 0, 1));
    assert_eq!(std::fs::read(&output).unwrap(), encoded);

    let provenance = dir.join(".unone/import-provenance.json");
    let mut old: Value = serde_json::from_slice(&std::fs::read(&provenance).unwrap()).unwrap();
    old["assets"]["texture://atlas"].as_object_mut().unwrap().remove("encoded_image_key");
    write(&provenance, old.to_string());
    let migrated = unone_engine::prepare_imports(dir).unwrap();
    assert_eq!((migrated.webp_encoded, migrated.webp_reused, migrated.written), (1, 0, 0));

    manifest[0] = assets()[0].clone();
    std::fs::copy(&output, dir.join("imported/atlas.png")).unwrap();
    write(&dir.join("assets.json"), json!({"version":1,"assets":manifest}).to_string());
    let switched = unone_engine::prepare_imports(dir).unwrap();
    assert_eq!((switched.png_encoded, switched.png_reused, switched.webp_reused), (1, 0, 0));
    assert!(std::fs::read(dir.join("imported/atlas.png")).unwrap().starts_with(b"\x89PNG"));
}

#[test]
fn imported_atlas_chooses_a_smaller_lossless_png() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    let original = dir.join("original");
    project(dir, json!([{"id":"texture://atlas","kind":"texture2d","source":"atlas.png",
        "import":{"importer":"pal","inputs":{"rgba":"original:pixels.raw"},"product":"image"}}]));
    write(&dir.join(".unone/import-roots.json"), json!({"original": original}).to_string());
    write(&dir.join("import/pop.luau"), r#"return {
        opaque={outputs={},run=function() return {} end},
        palette={inputs={rgba="bytes"},outputs={image="image"},run=function(inputs)
            return {image={width=64,height=buffer.len(inputs.rgba)//256,rgba=inputs.rgba}}
        end}}"#);
    let mut pixels = Vec::new();
    let mut random = 0u32;
    for i in 0..8192 {
        random = random.wrapping_mul(1664525).wrapping_add(1013904223);
        let index = if i < 256 { i as u8 } else { (random >> 24) as u8 };
        // Pairs share RGB but differ in alpha. Preserve the RGB behind alpha zero.
        pixels.extend_from_slice(&[index / 2, !index / 2, 29, if index % 2 == 0 { 0 } else { 153 }]);
    }
    let cases = [
        (pixels.clone(), png::ColorType::Indexed),
        ({ pixels[0..4].copy_from_slice(&[0, 0, 0, 255]); pixels }, png::ColorType::Rgba),
        (vec![17; 64 * 4], png::ColorType::Rgba),
    ];
    for (rgba, color) in cases {
        write(&original.join("pixels.raw"), &rgba);
        assert_eq!(unone_engine::prepare_imports(dir).unwrap().ran, 1);
        let encoded = std::fs::read(dir.join("atlas.png")).unwrap();
        let mut decoder = png::Decoder::new(std::io::Cursor::new(encoded));
        decoder.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
        let mut reader = decoder.read_info().unwrap();
        assert_eq!(reader.info().color_type, color);
        let mut decoded = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut decoded).unwrap();
        assert_eq!(decoded, rgba);
    }
}

#[test]
fn partial_manifest_changes_only_reencode_pngs_without_verified_outputs() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    let original = dir.join("original");
    let mut manifest = assets();
    for name in ["second", "third"] {
        let mut atlas = manifest[0].clone();
        atlas["id"] = json!(format!("texture://{name}"));
        atlas["source"] = json!(format!("imported/{name}.png"));
        atlas["import"]["inputs"]["indices"] = json!(format!("original:{name}.raw"));
        manifest.as_array_mut().unwrap().push(atlas);
    }
    project(dir, manifest.clone());
    write(&dir.join(".unone/import-roots.json"), json!({"original": original}).to_string());
    write(&original.join("DATA/pal.dat"), [25u8, 50, 75, 100, 125, 150]);
    write(&original.join("DATA/pixels.dat"), [0u8, 1, 0]);
    write(&original.join("second.raw"), [0u8, 1, 1]);
    write(&original.join("third.raw"), [1u8, 0, 0]);
    let prepare = || unone_engine::prepare_imports(dir).unwrap();
    let files = ["atlas", "second", "third"].map(|n| dir.join(format!("imported/{n}.png")));
    let first = prepare();
    assert_eq!((first.png_encoded, first.png_reused), (3, 0));
    let original_bytes = files.each_ref().map(|p| std::fs::read(p).unwrap());

    manifest[0]["bundle"] = json!("new-group");
    write(&dir.join("assets.json"), json!({"version":1,"assets":manifest}).to_string());
    let metadata_only = prepare();
    assert_eq!((metadata_only.png_encoded, metadata_only.png_reused), (0, 3));
    assert_eq!(files.each_ref().map(|p| std::fs::read(p).unwrap()), original_bytes);

    // A dependency still receives the raw image when its producer reuses the encoded PNG.
    let count = dir.join("imported/opaque.json");
    std::fs::remove_file(&count).unwrap();
    assert_eq!(prepare().png_reused, 3);
    assert_eq!(serde_json::from_slice::<Value>(&std::fs::read(count).unwrap()).unwrap(), json!({"opaque":1}));

    let mut damaged = original_bytes[1].clone();
    damaged[0] ^= 1;
    let modified = std::fs::metadata(&files[1]).unwrap().modified().unwrap();
    write(&files[1], damaged);
    std::fs::File::options().write(true).open(&files[1]).unwrap().set_modified(modified).unwrap();
    std::fs::remove_file(&files[2]).unwrap();
    let repaired = prepare();
    assert_eq!((repaired.png_encoded, repaired.png_reused, repaired.written), (2, 1, 2));
    assert_eq!(files.each_ref().map(|p| std::fs::read(p).unwrap()), original_bytes);

    write(&original.join("second.raw"), [1u8, 1, 1]);
    let changed = prepare();
    assert_eq!((changed.png_encoded, changed.png_reused, changed.written), (1, 2, 1));
    assert_ne!(std::fs::read(&files[1]).unwrap(), original_bytes[1]);

    let path = dir.join(".unone/import-provenance.json");
    let mut old: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    old["assets"]["texture://second"].as_object_mut().unwrap().remove("encoded_image_key");
    write(&path, old.to_string());
    let missing_key = prepare();
    assert_eq!((missing_key.png_encoded, missing_key.png_reused, missing_key.written), (1, 2, 0));
    std::fs::remove_file(path).unwrap();
    let migrated = prepare();
    assert_eq!((migrated.png_encoded, migrated.png_reused, migrated.written), (3, 0, 0));
}

#[test]
fn hosts_produce_imported_assets_from_local_roots_with_cache_and_provenance() {
    let root = std::env::temp_dir().join(format!("unone-import-pipeline-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let (dir, original) = (root.join("game"), root.join("Populous 3"));
    write(&original.join("DATA/pixels.dat"), [0u8, 1, 2]);
    write(&original.join("DATA/pal.dat"), [9u8, 9, 9, 10, 20, 30, 40, 50, 60]);
    project(&dir, assets());
    // Without the original installation there is nothing to produce the files from.
    let missing = unone_engine::EngineRuntime::load(&dir).err().unwrap();
    assert_eq!(missing.code, "IMPORT_ROOT_UNAVAILABLE");
    // The machine-local roots file names the installation; loading the project imports.
    write(&dir.join(".unone/import-roots.json"), json!({"original": original}).to_string());
    let runtime = unone_engine::EngineRuntime::load(&dir).unwrap();
    assert_eq!(runtime.semantic_observations()["stats"], json!({"opaque": 2}), "the game reads the imported data asset");
    assert_eq!(runtime.semantic_observations()["palette_bytes"], json!(9), "and the copied file as bytes");
    assert_eq!(std::fs::read(dir.join("imported/pal.dat")).unwrap(), std::fs::read(original.join("DATA/pal.dat")).unwrap());
    let png = std::fs::read(dir.join("imported/atlas.png")).unwrap();
    let decoder = png::Decoder::new(std::io::Cursor::new(png));
    let mut reader = decoder.read_info().unwrap();
    let mut rgba = vec![0; reader.output_buffer_size().unwrap()];
    reader.next_frame(&mut rgba).unwrap();
    assert_eq!(rgba, [9, 9, 9, 0, 10, 20, 30, 255, 40, 50, 60, 255], "index 0 is transparent");
    let provenance: Value = serde_json::from_slice(&std::fs::read(dir.join(".unone/import-provenance.json")).unwrap()).unwrap();
    let atlas = &provenance["assets"]["texture://atlas"];
    assert_eq!((atlas["inputs"]["palette"]["root"].as_str(), atlas["inputs"]["palette"]["bytes"].as_u64()), (Some("original"), Some(9)));
    assert_eq!(provenance["assets"]["data://opaque"]["inputs"]["image"]["asset"], "texture://atlas");
    assert_eq!(provenance["assets"]["data://palette"]["from"]["path"], "DATA/pal.dat");
    // Nothing changed since the last prepare: its stamp (sizes and times of every
    // input, module and product) answers without reading or hashing a source.
    let again = unone_engine::prepare_imports(&dir).unwrap();
    assert!(again.up_to_date);
    assert_eq!((again.imports, again.ran, again.cached, again.written, again.unchanged), (3, 0, 0, 0, 0));
    // A previous encoder's stamp must revisit the files, but the original
    // decoded image in the import cache is still valid.
    let stamp_path = dir.join(".unone/import-stamp.json");
    let mut old: Value = serde_json::from_slice(&std::fs::read(&stamp_path).unwrap()).unwrap();
    old.as_object_mut().unwrap().remove("png_encoding");
    write(&stamp_path, old.to_string());
    let migrated = unone_engine::prepare_imports(&dir).unwrap();
    assert!(!migrated.up_to_date);
    assert_eq!((migrated.ran, migrated.cached), (0, 2));
    assert!(unone_engine::prepare_imports(&dir).unwrap().up_to_date);
    // The project file counts by what imports read of it: a test added to it changes nothing they do.
    let config = dir.join("project.unone.json");
    let mut edited: Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
    edited["test_files"] = json!(["tests/new.test.json"]);
    write(&config, edited.to_string());
    assert!(unone_engine::prepare_imports(&dir).unwrap().up_to_date, "a new test is not an import change");
    edited["import"]["roots"]["original"]["description"] = json!("described again");
    write(&config, edited.to_string());
    assert!(!unone_engine::prepare_imports(&dir).unwrap().up_to_date, "its import section is");
    assert!(unone_engine::prepare_imports(&dir).unwrap().up_to_date);
    // Without the stamp, every product is checked by content: all from the cache, none rewritten.
    std::fs::remove_file(dir.join(".unone/import-stamp.json")).unwrap();
    let checked = unone_engine::prepare_imports(&dir).unwrap();
    assert!(!checked.up_to_date);
    assert_eq!((checked.ran, checked.cached, checked.written, checked.unchanged), (0, 2, 0, 3));
    // A product edited by hand is not up to date; it is produced again.
    write(&dir.join("imported/pal.dat"), [0u8]);
    let edited = unone_engine::prepare_imports(&dir).unwrap();
    assert_eq!((edited.up_to_date, edited.written), (false, 1));
    assert_eq!(std::fs::read(dir.join("imported/pal.dat")).unwrap(), std::fs::read(original.join("DATA/pal.dat")).unwrap());
    // A changed source file reruns what depends on it.
    let linked = dir.join("imported/linked-copy.png");
    std::fs::hard_link(dir.join("imported/atlas.png"), &linked).unwrap();
    let before = std::fs::read(&linked).unwrap();
    write(&original.join("DATA/pixels.dat"), [1u8, 1, 2]);
    let changed = unone_engine::prepare_imports(&dir).unwrap();
    assert_eq!((changed.ran, changed.written), (2, 2));
    // The product is replaced, not rewritten: a copy hard-linked to it keeps its bytes.
    assert_eq!(std::fs::read(&linked).unwrap(), before);
    assert_ne!(std::fs::read(dir.join("imported/atlas.png")).unwrap(), before);
    assert!(!dir.join("imported/atlas.png.importing").exists());
    // On a machine without the installation, produced files are kept but marked unverified.
    std::fs::remove_file(dir.join(".unone/import-roots.json")).unwrap();
    let offline = unone_engine::prepare_imports(&dir).unwrap();
    assert_eq!(offline.unverified, ["data://palette", "texture://atlas", "data://opaque"], "in dependency order");
    // Wiring is checked before anything runs.
    let mut wrong = assets();
    wrong[1]["import"]["inputs"]["image"] = json!("original:DATA/pal.dat");
    project(&dir, wrong);
    assert_eq!(unone_engine::prepare_imports(&dir).unwrap_err().code, "IMPORT_TYPE_MISMATCH");
    let mut kind = assets();
    kind[0]["kind"] = json!("data");
    project(&dir, kind);
    assert_eq!(unone_engine::prepare_imports(&dir).unwrap_err().code, "IMPORT_PRODUCT_KIND");
    let mut unknown = assets();
    unknown[0]["import"]["importer"] = json!("missing");
    project(&dir, unknown);
    assert_eq!(unone_engine::prepare_imports(&dir).unwrap_err().code, "IMPORTER_UNKNOWN");
    // A copy names one root file and nothing else.
    let mut both = assets();
    both[2]["import"]["importer"] = json!("pal");
    project(&dir, both);
    assert_eq!(unone_engine::prepare_imports(&dir).unwrap_err().code, "IMPORT_DECLARATION_INVALID");
    let mut from_asset = assets();
    from_asset[2]["import"]["from"] = json!("asset:texture://atlas");
    project(&dir, from_asset);
    assert_eq!(unone_engine::prepare_imports(&dir).unwrap_err().code, "IMPORT_INPUT_INVALID");
    let mut neither = assets();
    neither[2]["import"] = json!({"params": {"key": 0}});
    project(&dir, neither);
    assert_eq!(unone_engine::prepare_imports(&dir).unwrap_err().code, "IMPORT_DECLARATION_INVALID");
    let _ = std::fs::remove_dir_all(&root);
}

// A recording loads the project with the host clock it records (load_with_host_time): that load imports too, so a
// project that has just declared a copied file reads it on its first recorded run.
#[test]
fn recorded_runs_import_before_they_read() {
    let root = std::env::temp_dir().join(format!("unone-import-recorded-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let (dir, original) = (root.join("game"), root.join("Populous 3"));
    write(&original.join("DATA/pal.dat"), [1u8, 2, 3, 4]);
    write(&dir.join("project.unone.json"), json!({"name": "recorded-imports", "entry_script": "main.luau", "asset_manifest": "assets.json",
        "host_time": {"mode": "live"},
        "import": {"roots": {"original": {"description": "an installation", "candidates": ["${UNONE_TEST_NO_SUCH_VARIABLE}/x"]}}}}).to_string());
    write(&dir.join(".unone/import-roots.json"), json!({"original": original}).to_string());
    write(&dir.join("main.luau"), "return {start = function(api) api.observation.set('bytes', buffer.len(api.assets.load('data://palette'))) end, \
        update = function() end}");
    write(&dir.join("assets.json"), json!({"version": 1, "assets": [{"id": "data://palette", "kind": "data", "source": "imported/pal.dat",
        "encoding": {"format": "binary", "mime": "application/octet-stream", "decoder": "bytes"}, "import": {"from": "original:DATA/pal.dat"}}]}).to_string());
    let recorded = unone_engine::record_run(&dir, 1, 7, &[]);
    let recording = recorded.value.as_ref().unwrap_or_else(|| panic!("recorded: {:?}", recorded.diagnostics));
    assert_eq!(recording.recorded[0].observation["observations"]["bytes"], json!(4), "the recorded run reads the file it imported");
    assert_eq!(std::fs::read(dir.join("imported/pal.dat")).unwrap(), [1u8, 2, 3, 4]);
    let _ = std::fs::remove_dir_all(&root);
}

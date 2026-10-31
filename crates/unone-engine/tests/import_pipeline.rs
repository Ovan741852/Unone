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
    // Unchanged sources: everything comes from the cache and no file is rewritten.
    let again = unone_engine::prepare_imports(&dir).unwrap();
    assert_eq!((again.ran, again.cached, again.written, again.unchanged), (0, 2, 0, 3));
    // A changed source file reruns what depends on it.
    write(&original.join("DATA/pixels.dat"), [1u8, 1, 2]);
    let changed = unone_engine::prepare_imports(&dir).unwrap();
    assert_eq!((changed.ran, changed.written), (2, 2));
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

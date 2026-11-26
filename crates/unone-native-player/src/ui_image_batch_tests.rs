use super::*;
use serde_json::json;

fn png_bytes(width: u32, height: u32, pixels: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header().unwrap().write_image_data(pixels).unwrap();
    }
    bytes
}

fn raster() -> Rasterizer {
    let colors = [[255,0,0,255], [0,0,255,255], [0,255,0,255], [255,255,0,255]];
    let mut pixels = Vec::new();
    for y in 0..32 { for x in 0..32 { pixels.extend_from_slice(&colors[(y/16)*2+x/16]); } }
    // A uniformly half-transparent texture: tint must not touch its alpha.
    let glass = [200u8,100,40,128].repeat(4);
    let package = Package { digest:String::new(), files:BTreeMap::from([
        ("content/assets.json".into(), br#"{"assets":[{"kind":"texture2d","id":"texture://atlas","source":"atlas.png"},{"kind":"texture2d","id":"texture://glass","source":"glass.png"}]}"#.to_vec()),
        ("content/presentation.json".into(), b"{}".to_vec()), ("content/atlas.png".into(), png_bytes(32, 32, &pixels)),
        ("content/glass.png".into(), png_bytes(2, 2, &glass))]) };
    Rasterizer::new(&package).unwrap()
}

fn node() -> serde_json::Value {
    json!({"kind":"image_batch","id":"paint","rect":{"x":0,"y":0,"width":100,"height":100},"quads":[
        {"asset":"texture://atlas","rect":{"x":0,"y":0,"width":60,"height":100},"source":{"x":1,"y":1,"width":14,"height":14}},
        {"asset":"texture://atlas","rect":{"x":40,"y":0,"width":60,"height":100},"source":{"x":17,"y":1,"width":14,"height":14},"opacity":0.5}]})
}

fn tree(node: serde_json::Value) -> UiTree {
    UiTree::from_json(json!({"kind":"screen","id":"s","node":"s","children":[node]})).unwrap()
}

#[test]
fn image_batch_native_crop_opacity_and_original_paint_order() {
    let raster = raster();
    for (width,height) in [(100,100),(300,100),(100,300)] {
        let pixels = raster.draw(&tree(node()), width, height).unwrap();
        let pixel = |x:u32,y:u32| &pixels[((y*width+x)*4) as usize..][..4];
        for (x, expected) in [(width/5,[255,0,0,255]),(width/2,[127,0,128,255]),(width*4/5,[0,0,255,128])] {
            let actual = pixel(x,height/2);
            assert!(actual.iter().zip(expected).all(|(a,b)| a.abs_diff(b)<=3), "{width}x{height} x{x}: {actual:?}");
        }
    }
    let mut reversed = node(); reversed["quads"].as_array_mut().unwrap().reverse();
    let pixels = raster.draw(&tree(reversed),100,100).unwrap();
    assert_eq!(&pixels[((50*100+50)*4)..][..4], &[255,0,0,255]);
}

#[test]
fn image_batch_native_tint_multiplies_texture_colour_and_keeps_alpha() {
    let raster = raster();
    let tinted = json!({"kind":"image_batch","id":"tint","rect":{"x":0,"y":0,"width":100,"height":100},"quads":[
        // Yellow quadrant of a larger atlas, scaled up: the crop alone is filtered.
        {"asset":"texture://atlas","rect":{"x":0,"y":0,"width":25,"height":100},"source":{"x":17,"y":17,"width":14,"height":14},"tint":[0.5,1,0.25]},
        {"asset":"texture://atlas","rect":{"x":25,"y":0,"width":25,"height":100},"source":{"x":17,"y":17,"width":14,"height":14},"tint":[0.5,1,0.25]},
        {"asset":"texture://glass","rect":{"x":50,"y":0,"width":25,"height":100},"tint":[0.5,0.5,1]},
        {"asset":"texture://atlas","rect":{"x":75,"y":0,"width":25,"height":100},"source":{"x":17,"y":17,"width":14,"height":14},"opacity":0.5,"tint":[0,0.5,1]}]});
    let pixels = raster.draw(&tree(tinted.clone()), 100, 100).unwrap();
    let pixel = |pixels: &[u8], x: usize| pixels[(50*100+x)*4..][..4].to_vec();
    let near = |actual: Vec<u8>, expected: [u8; 4]| assert!(actual.iter().zip(expected).all(|(a,b)| a.abs_diff(b)<=3), "{actual:?} != {expected:?}");
    near(pixel(&pixels, 12), [128,255,0,255]);
    near(pixel(&pixels, 37), [128,255,0,255]);
    near(pixel(&pixels, 62), [100,50,40,128]);
    near(pixel(&pixels, 87), [0,128,0,128]);
    let markup = raster.node_markup(3, &tree(tinted.clone()).children[0], 100, 100).unwrap();
    assert_eq!(markup.matches("<filter").count(), 3, "one filter per distinct tint and crop");
    let mut plain = tinted;
    for quad in plain["quads"].as_array_mut().unwrap() { quad.as_object_mut().unwrap().remove("tint"); }
    assert!(!raster.node_markup(3, &tree(plain.clone()).children[0], 100, 100).unwrap().contains("filter"));
    let pixels = raster.draw(&tree(plain), 100, 100).unwrap();
    near(pixel(&pixels, 12), [255,255,0,255]);
    near(pixel(&pixels, 62), [200,100,40,128]);
    near(pixel(&pixels, 87), [255,255,0,128]);
}

#[test]
fn image_batch_native_visits_every_asset_and_rejects_bad_decoded_crop() {
    let raster = raster();
    let mut missing = node(); missing["quads"][1]["asset"] = json!("texture://missing");
    let error = raster.draw(&tree(missing),100,100).unwrap_err();
    assert!(error.contains("UI_IMAGE_UNAVAILABLE") && error.contains("quad=1") && error.contains("texture://missing"), "{error}");
    let mut cropped = node(); cropped["quads"][1]["source"]["width"] = json!(16);
    assert!(raster.draw(&tree(cropped),100,100).unwrap_err().contains("UI_IMAGE_BATCH_SOURCE_BOUNDS"));
}

#[test]
fn image_batch_native_is_noninteractive_and_does_not_block_buttons() {
    let mut value = serde_json::to_value(tree(node())).unwrap();
    value["children"].as_array_mut().unwrap().insert(0,json!({"kind":"button","id":"button","text":"Test","action":"Test",
        "rect":{"x":0,"y":0,"width":100,"height":100}}));
    let tree = UiTree::from_json(value).unwrap();
    let mut pointer = PointerRouter::default();
    assert!(pointer.down(Some(&tree),1,50.,50.));
    assert_eq!(pointer.next_edge(),Some(("Test".into(),true)));
}

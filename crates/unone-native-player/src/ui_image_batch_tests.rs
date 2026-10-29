use super::*;
use serde_json::json;

fn raster() -> Rasterizer {
    let colors = [[255,0,0,255], [0,0,255,255], [0,255,0,255], [255,255,0,255]];
    let mut pixels = Vec::new();
    for y in 0..32 { for x in 0..32 { pixels.extend_from_slice(&colors[(y/16)*2+x/16]); } }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 32, 32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header().unwrap().write_image_data(&pixels).unwrap();
    }
    let package = Package { digest:String::new(), files:BTreeMap::from([
        ("content/assets.json".into(), br#"{"assets":[{"kind":"texture2d","id":"texture://atlas","source":"atlas.png"}]}"#.to_vec()),
        ("content/presentation.json".into(), b"{}".to_vec()), ("content/atlas.png".into(), bytes)]) };
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

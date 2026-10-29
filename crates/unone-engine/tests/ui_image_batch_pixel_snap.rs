use unone_engine::{EngineRuntime,SourceProject};

#[test]
fn pixel_snap_is_cheap_instance_state_and_rejects_rotated_or_sheared_publication_atomically() {
    let mut runtime=EngineRuntime::load_source_project(SourceProject{source:r#"
local definition={bounds={x=0,y=0,width=10,height=10},quads={{asset='texture://tile',rect={x=0,y=0,width=10,height=10},source={x=.5,y=.5,width=3,height=4},opacity=.5}}}
local art={kind='image_batch',id='art',content='shared',rect={x=5,y=5,width=90,height=90}}
local root={kind='screen',id='s',node='s',children={art}}
return {start=function(api)
 api.ui.imageBatch.define('shared',definition);api.ui.setRoot(root)
end,update=function(api)
 art.pixel_snap=true;api.ui.setRoot(root)
 for _,transform in {{a=1,b=1,c=0,d=1,tx=0,ty=0},{a=1,b=0,c=1,d=1,tx=0,ty=0},{a=1,b=1e-300,c=0,d=1,tx=0,ty=0}} do
  art.transform=transform
  local ok,err=pcall(api.ui.setRoot,root)
  assert(not ok and string.find(tostring(err),'UI_IMAGE_BATCH_SNAP_TRANSFORM',1,true))
 end
 for _,bad in {'true',1,{}} do art.pixel_snap=bad;art.transform=nil;assert(not pcall(api.ui.setRoot,root)) end
 art.pixel_snap=true
 -- Sign flips and zero scales are valid; hosts omit only collapsed quads.
 for _,transform in {{a=-1,b=0,c=0,d=1,tx=20,ty=0},{a=1,b=0,c=0,d=-1,tx=0,ty=20},{a=0,b=0,c=0,d=1,tx=0,ty=0},{a=1,b=0,c=0,d=0,tx=0,ty=0}} do
  art.transform=transform;api.ui.setRoot(root)
 end
 local badDefinition=table.clone(definition);badDefinition.pixel_snap=true
 assert(not pcall(api.ui.imageBatch.define,'shared',badDefinition))
end}
"#.into(),..Default::default()}).unwrap();
    let before=runtime.observe();let resource=&before.ui_image_batches["shared"];
    runtime.tick().unwrap();let after=runtime.observe();let new=&after.ui_image_batches["shared"];
    assert_eq!(new.revision(),resource.revision());
    assert_eq!(new.quads().as_ptr(),resource.quads().as_ptr());
    assert_eq!(new.encoded_json().get().as_ptr(),resource.encoded_json().get().as_ptr());
    let wire=serde_json::to_value(after.ui.unwrap()).unwrap();
    assert_eq!(wire["children"][0]["pixel_snap"],true);
    assert_eq!(wire["children"][0]["transform"]["d"],0.);
    assert_eq!(wire["children"][0]["rect"],serde_json::json!({"x":5.,"y":5.,"width":90.,"height":90.}));
    assert_eq!(new.quads()[0].source,resource.quads()[0].source);
}

#[test]
fn unsnapped_retained_affine_and_inline_snapping_keep_their_separate_contracts() {
    let runtime=EngineRuntime::load_source_project(SourceProject{source:r#"
return {start=function(api)
 local rect={x=0,y=0,width=10,height=10}
 api.ui.imageBatch.define('shared',{bounds=rect,quads={{asset='texture://tile',rect=rect}}})
 api.ui.setRoot({kind='screen',id='s',node='s',children={
  {kind='image_batch',id='retained',content='shared',rect=rect,pixel_snap=false,transform={a=1,b=1,c=1,d=1,tx=0,ty=0}},
  {kind='image_batch',id='inline',rect=rect,pixel_snap=true,quads={{asset='texture://tile',rect=rect}}},
 }})
end,update=function()end}
"#.into(),..Default::default()}).unwrap();
    let wire=serde_json::to_value(runtime.observe().ui.unwrap()).unwrap();
    assert!(wire["children"][0].get("pixel_snap").is_none());
    assert_eq!(wire["children"][0]["transform"]["b"],1.);
    assert_eq!(wire["children"][1]["pixel_snap"],true);
    assert_eq!(wire["children"][1]["quads"].as_array().unwrap().len(),1);
}

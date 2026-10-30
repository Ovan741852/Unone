use serde_json::{Value,json};
use unone_engine::{EngineRuntime,SourceProject,UiTree,observation_digest};

fn game(source:&str)->EngineRuntime {
    EngineRuntime::load_source_project(SourceProject{source:source.into(),..Default::default()}).unwrap()
}

const FIXTURE:&str=r#"
local bounds={x=-10,y=-20,width=40,height=60}
local q={asset='texture://tile',rect={x=-5,y=-10,width=20,height=30},source={x=1,y=2,width=3,height=4},opacity=.25}
local definition={bounds=bounds,quads={q}}
local node={kind='image_batch',id='art',rect={x=5,y=5,width=90,height=90},content='shared'}
local root={kind='screen',id='screen',node='screen',children={node},budget={max_nodes=16}}
"#;

#[test]
fn large_origin_rounded_endpoints_cannot_admit_an_oversized_replacement() {
    let mut runtime=game(r#"
local bounds={x=1e9,y=1e9,width=1e-7,height=1e-7}
local quad={asset='texture://tile',rect=table.clone(bounds)}
return {start=function(api)
 api.ui.imageBatch.define('art',{bounds=bounds,quads={quad}})
 api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='image_batch',id='art-node',content='art',rect={x=0,y=0,width=100,height=100}}}})
end,update=function(api)
 for _,axis in {'width','height'} do
  local bad=table.clone(quad);bad.rect=table.clone(bounds);bad.rect[axis]=1.5e-7
  -- The absolute endpoints round equal, but the local extent is too large.
  assert(bounds.x+bounds.width==bounds.x+1.5e-7)
  local ok,err=pcall(api.ui.imageBatch.define,'art',{bounds=bounds,quads={bad}})
  assert(not ok and string.find(tostring(err),'UI_IMAGE_BATCH_BOUNDS',1,true))
 end
end}
"#);
    let before=runtime.observe();
    let before_resource=&before.ui_image_batches["art"];
    let before_tree=serde_json::to_value(before.ui.as_ref().unwrap()).unwrap();
    runtime.tick().unwrap();
    let after=runtime.observe();
    assert_eq!(after.ui_image_batches["art"].revision(),before_resource.revision());
    assert_eq!(after.ui_image_batches["art"].quads().as_ptr(),before_resource.quads().as_ptr());
    assert_eq!(after.ui_image_batches["art"].encoded_json().get(),before_resource.encoded_json().get());
    assert_eq!(serde_json::to_value(after.ui.as_ref().unwrap()).unwrap(),before_tree);
}

#[test]
fn camera_changes_only_instance_state_and_keeps_owned_content_and_cached_bytes() {
    let mut game=game(&format!(r#"{FIXTURE}
return {{start=function(api)
 api.ui.imageBatch.define('shared',definition);api.ui.setRoot(root)
 q.asset='texture://mutated';q.rect.x=999;bounds.width=999
end,update=function(api)
 node.transform={{a=1,b=0,c=0,d=1,tx=3,ty=-7}};api.ui.setRoot(root)
end}}"#));
    let before=game.observe();let old=&before.ui_image_batches["shared"];
    assert_eq!(old.quads()[0].asset,"texture://tile");
    assert_eq!(old.bounds().width,40.);
    let bytes=old.encoded_json().get().to_owned();
    assert_eq!(serde_json::to_string(old).unwrap(),bytes);
    let first_ptr=old.quads().as_ptr();let encoded_ptr=old.encoded_json().get().as_ptr();
    let wire=serde_json::to_value(&before).unwrap();
    assert_eq!(wire["ui_image_batches"]["shared"]["quads"][0]["source"],json!({"x":1.,"y":2.,"width":3.,"height":4.}));
    assert!(wire["ui"]["children"][0].get("quads").is_none());
    assert!(wire["ui"]["children"][0].get("transform").is_none());
    game.tick().unwrap();let after=game.observe();let new=&after.ui_image_batches["shared"];
    assert_eq!(new.revision(),old.revision());
    assert_eq!(new.quads().as_ptr(),first_ptr);
    assert_eq!(new.encoded_json().get().as_ptr(),encoded_ptr);
    assert_eq!(new.encoded_json().get(),bytes);
    assert_ne!(observation_digest(&before).unwrap(),observation_digest(&after).unwrap());
    assert_eq!(after.ui.as_ref().unwrap().usage().image_quads,1);
    assert!(serde_json::to_value(after.ui.as_ref().unwrap()).unwrap()["children"][0].get("quads").is_none());
    let parsed=UiTree::from_json_for_viewport_with_resources(serde_json::to_value(after.ui.as_ref().unwrap()).unwrap(),16./9.,&after.ui_image_batches).unwrap();
    assert_eq!(parsed.usage().image_quads,1);
}

#[test]
fn replacement_is_atomic_updates_live_counts_and_preserves_old_snapshot_generation() {
    let mut game=game(&format!(r#"{FIXTURE}
local turn=0
return {{start=function(api)api.ui.imageBatch.define('shared',definition);api.ui.setRoot(root)end,
update=function(api)
 turn+=1
 if turn==1 then api.ui.imageBatch.define('shared',definition)
 else definition.quads={{q,q}};api.ui.imageBatch.define('shared',definition) end
end}}"#));
    let before=game.observe();let resource=before.ui_image_batches["shared"].clone();
    game.tick().unwrap();assert_eq!(game.observe().ui_image_batches["shared"].revision(),resource.revision());
    game.tick().unwrap();let after=game.observe();
    assert!(after.ui_image_batches["shared"].revision()>resource.revision());
    assert_eq!(after.ui.as_ref().unwrap().usage().logical_nodes,3);
    assert_eq!(resource.quads().len(),1);assert_eq!(after.ui_image_batches["shared"].quads().len(),2);
    assert_eq!(serde_json::from_str::<Value>(resource.encoded_json().get()).unwrap()["quads"].as_array().unwrap().len(),1);
}

#[test]
fn live_budget_transform_overflow_and_unknown_fields_reject_without_partial_change() {
    let game=game(&format!(r#"{FIXTURE}
return {{start=function(api)
 root.budget.max_nodes=2
 api.ui.imageBatch.define('shared',definition);api.ui.setRoot(root)
 local function reject(value,code)
  local ok,err=pcall(api.ui.imageBatch.define,'shared',value)
  assert(not ok and string.find(tostring(err),code,1,true),tostring(err))
 end
 reject({{bounds=bounds,quads={{q,q}}}},'UI_NODE_LIMIT')
 reject({{bounds=bounds,quads={{q}},unknown=true}},'unknown field')
 reject({{bounds=bounds,quads={{{{asset='texture://tile',rect=q.rect,rotation=0}}}}}},'unknown field')
 assert(not pcall(api.ui.imageBatch.define,'shared',{{bounds={{x=1e308,y=0,width=1e308,height=1}},quads={{q}}}}))
 local invalid=table.clone(node);invalid.quads={{q}}
 assert(not pcall(api.ui.setRoot,{{kind='screen',id='s',node='s',children={{invalid}}}}))
 invalid=table.clone(node);invalid.content='missing'
 assert(not pcall(api.ui.setRoot,{{kind='screen',id='s',node='s',children={{invalid}}}}))
 invalid=table.clone(node);invalid.transform={{a=1e308,b=0,c=0,d=1,tx=0,ty=0}}
 assert(not pcall(api.ui.setRoot,{{kind='screen',id='s',node='s',children={{invalid}}}}))
 invalid=table.clone(node);invalid.transform={{a=1,b=0,c=0,d=1,tx=0,ty=0,typo=1}}
 assert(not pcall(api.ui.setRoot,{{kind='screen',id='s',node='s',children={{invalid}}}}))
end,update=function()end}}"#));
    let snapshot=game.observe();assert_eq!(snapshot.ui_image_batches["shared"].revision(),1);
    assert_eq!(snapshot.ui_image_batches["shared"].quads().len(),1);
    assert_eq!(snapshot.ui.as_ref().unwrap().id,"screen");
}

#[test]
fn removal_requires_no_published_reference_and_recreation_gets_new_revision() {
    let mut game=game(&format!(r#"{FIXTURE}
return {{start=function(api)api.ui.imageBatch.define('shared',definition);api.ui.setRoot(root)end,
update=function(api)
 local ok,err=pcall(api.ui.imageBatch.remove,'shared');assert(not ok and string.find(tostring(err),'UI_IMAGE_BATCH_IN_USE',1,true))
 api.ui.setRoot({{kind='screen',id='empty',node='empty',children={{{{kind='panel',id='plain',rect={{x=0,y=0,width=1,height=1}}}}}}}})
 assert(api.ui.imageBatch.remove('shared'));assert(not api.ui.imageBatch.remove('shared'))
 api.ui.imageBatch.define('shared',definition);api.ui.setRoot(root)
end}}"#));
    let old=game.observe().ui_image_batches["shared"].clone();
    game.tick().unwrap();assert_eq!(game.observe().ui_image_batches["shared"].revision(),old.revision()+1);
    assert_eq!(old.quads()[0].asset,"texture://tile");
}

#[test]
fn pure_virtual_callbacks_cannot_mutate_resources_and_error_restores_the_guard() {
    let game=game(&format!(r#"{FIXTURE}
return {{start=function(api)
 api.ui.imageBatch.define('shared',definition)
 local failed=pcall(api.ui.virtualList,{{id='bad',viewport={{left=0,top=0,width=50,height=50}},items={{{{id='one'}}}},key='id',rowHeight=10,
  renderItem=function()api.ui.imageBatch.define('other',definition);error('unexpected')end}})
 assert(not failed)
 api.ui.imageBatch.define('after-error',definition)
 local list=api.ui.virtualList({{id='list',viewport={{left=0,top=0,width=50,height=50}},items={{{{id='one'}}}},key='id',rowHeight=10,
  renderItem=function()
   local ok,err=pcall(api.ui.imageBatch.remove,'shared');assert(not ok and string.find(tostring(err),'UI_PURE_VIEW',1,true))
   return {{{{kind='panel',id='p',rect={{x=0,y=0,width=10,height=10}}}}}}
  end}})
 api.ui.setRoot({{kind='screen',id='s',node='s',children={{list}}}})
end,update=function()end}}"#));
    assert_eq!(game.observe().ui_image_batches.len(),2);
}

#[test]
fn pure_virtual_callbacks_cannot_mutate_simulation_state() {
    let game=game(r#"
return {start=function(api)
 local list=api.ui.virtualList({id='list',viewport={left=0,top=0,width=50,height=50},items={{id='one'}},key='id',rowHeight=10,
  renderItem=function()
   for _,call in {function()return api.random.nextInt(1,6)end,function()api.observation.set('x',1)end,
     function()api.entity.spawn('e')end,function()api.save.set({})end} do
    local ok,err=pcall(call);assert(not ok and string.find(tostring(err),'UI_PURE_VIEW',1,true),tostring(err))
   end
   return {{kind='panel',id='p',rect={x=0,y=0,width=10,height=10}}}
  end})
 api.ui.setRoot({kind='screen',id='s',node='s',children={list}})
 -- Outside renderItem the same calls are allowed again.
 api.observation.set('after',api.random.nextInt(1,1))
end,update=function()end}"#);
    assert_eq!(game.observe().observations["after"],json!(1));
}

#[test]
fn retained_content_is_explicitly_stage_only_and_inline_serialization_is_unchanged() {
    let runtime=game(&format!(r#"{FIXTURE}
return {{start=function(api)
 api.ui.imageBatch.define('shared',definition)
 local scroll=api.ui.scrollView({{id='scroll',viewport={{left=0,top=0,width=100,height=100}},content={{node}}}})
 local ok,err=pcall(api.ui.setRoot,{{kind='screen',id='s',node='s',children={{scroll}}}})
 assert(not ok and string.find(tostring(err),'UI_IMAGE_BATCH_SPACE',1,true))
end,update=function()end}}"#));
    assert!(runtime.observe().ui.is_none());
    let plain=game("return {start=function()end,update=function()end}");
    assert!(serde_json::to_value(plain.observe()).unwrap().get("ui_image_batches").is_none());
    let value=json!({"kind":"screen","id":"s","node":"s","children":[{"kind":"image_batch","id":"art","rect":{"x":0.,"y":0.,"width":100.,"height":100.},"quads":[{"asset":"texture://tile","rect":{"x":1.,"y":2.,"width":3.,"height":4.}}]}]});
    assert_eq!(serde_json::to_value(UiTree::from_json(value.clone()).unwrap()).unwrap(),value);
}

#[cfg(feature="dev-tools")]
#[test]
fn reload_rollback_restores_matching_resource_and_instance_generations() {
    let mut game=game(&format!(r#"{FIXTURE}return {{start=function(api)api.ui.imageBatch.define('shared',definition);api.ui.setRoot(root)end,update=function()end}}"#));
    let old=game.observe();let bytes=old.ui_image_batches["shared"].encoded_json().get().to_owned();
    let rejected=format!(r#"{FIXTURE}return {{start=function()end,update=function()end,onReload=function(api)
 definition.quads[1].opacity=.5;api.ui.imageBatch.define('shared',definition);error('reject')end}}"#);
    assert!(game.reload_source(rejected).is_err());
    assert_eq!(game.observe().ui_image_batches["shared"].encoded_json().get(),bytes);
    assert_eq!(observation_digest(&game.observe()).unwrap(),observation_digest(&old).unwrap());
    let accepted=format!(r#"{FIXTURE}return {{start=function()end,update=function()end,onReload=function(api)
 definition.quads[1].opacity=.5;api.ui.imageBatch.define('shared',definition)end}}"#);
    game.reload_source(accepted).unwrap();let after=game.observe();
    assert!(after.ui_image_batches["shared"].revision()>old.ui_image_batches["shared"].revision());
    assert_eq!(after.ui_image_batches["shared"].quads()[0].opacity,Some(0.5));
}

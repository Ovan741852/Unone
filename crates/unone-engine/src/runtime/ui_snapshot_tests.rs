//! Shared validated UI generations: no authored aliases and no snapshot mutation.
use super::{EngineRuntime, UiTree, observation_digest};
use std::sync::Arc;
use serde_json::json;
use sha2::{Digest, Sha256};

const ROOT: &str = r#"
local root={kind='screen',id='screen',node='screen',children={
 {kind='text',id='label',text='before',rect={x=1,y=2,width=30,height=10}}
}}
"#;

fn game(body: &str) -> EngineRuntime {
    EngineRuntime::load_source("SharedUi", "main.luau", format!("{ROOT}\n{body}"), None).unwrap()
}

fn text(tree: &UiTree) -> String {
    serde_json::to_value(tree).unwrap()["children"][0]["text"].as_str().unwrap().to_owned()
}

#[test]
fn unchanged_observation_and_snapshot_clones_share_the_validated_generation() {
    let mut runtime=game("return {start=function(api)api.ui.setRoot(root)end,update=function()end}");
    let before=runtime.observe();
    let tree=before.ui.as_ref().unwrap();
    assert!(Arc::ptr_eq(tree,runtime.ui.borrow().as_ref().unwrap()));
    for _ in 0..4 {
        let observed=runtime.observe();
        assert!(Arc::ptr_eq(tree,observed.ui.as_ref().unwrap()));
        assert!(Arc::ptr_eq(tree,observed.clone().ui.as_ref().unwrap()));
        assert!(Arc::ptr_eq(tree,runtime.tick().unwrap().ui.as_ref().unwrap()));
    }
    // Arc must serialize the exact existing validated tree, not an ownership wrapper.
    let owned=UiTree::from_json(json!({"kind":"screen","id":"screen","node":"screen","children":[
        {"kind":"text","id":"label","text":"before","rect":{"x":1,"y":2,"width":30,"height":10}}
    ]})).unwrap();
    assert_eq!(serde_json::to_vec(tree).unwrap(),serde_json::to_vec(&owned).unwrap());
    let bytes=serde_json::to_vec(&before).unwrap();
    assert_eq!(observation_digest(&before).unwrap(),format!("sha256:{:x}",Sha256::digest(bytes)));
}

#[test]
fn authored_changes_republish_without_mutating_earlier_snapshots() {
    let mut runtime=game(r#"
return {start=function(api)
 api.ui.setRoot(root);root.children[1].text='next'
end,update=function(api)
 api.ui.setRoot(root);root.children[1].text='not published'
 root.children[1].rect.width=0
 assert(not pcall(api.ui.setRoot,root))
end}
"#);
    let old=runtime.observe();
    let old_bytes=serde_json::to_vec(&old).unwrap();
    let old_digest=observation_digest(&old).unwrap();
    let next=runtime.tick().unwrap();
    assert!(!Arc::ptr_eq(old.ui.as_ref().unwrap(),next.ui.as_ref().unwrap()));
    assert_eq!(text(old.ui.as_deref().unwrap()),"before");
    assert_eq!(text(next.ui.as_deref().unwrap()),"next");
    assert_eq!(serde_json::to_vec(&old).unwrap(),old_bytes);
    assert_eq!(observation_digest(&old).unwrap(),old_digest);
    assert_eq!(text(runtime.observe().ui.as_deref().unwrap()),"next");
}

#[test]
fn detached_snapshot_edits_and_runtime_clear_do_not_mutate_or_retain_other_generations() {
    let runtime=game("return {start=function(api)api.ui.setRoot(root)end,update=function()end}");
    let mut detached=runtime.observe();
    let saved=runtime.observe();
    let weak=Arc::downgrade(saved.ui.as_ref().unwrap());
    Arc::make_mut(detached.ui.as_mut().unwrap()).id="detached".into();
    assert_eq!(runtime.observe().ui.as_ref().unwrap().id,"screen");
    assert_eq!(saved.ui.as_ref().unwrap().id,"screen");
    assert!(!Arc::ptr_eq(detached.ui.as_ref().unwrap(),saved.ui.as_ref().unwrap()));
    *runtime.ui.borrow_mut()=None;
    assert!(runtime.observe().ui.is_none());
    drop(runtime);
    assert!(weak.upgrade().is_some(),"a snapshot owns its tree after runtime reset/drop");
    assert_eq!(text(saved.ui.as_deref().unwrap()),"before");
    drop(saved);
    assert!(weak.upgrade().is_none(),"no retired-tree history retains the old generation");
}

#[test]
fn resource_refresh_is_cow_and_rejected_replacement_keeps_the_live_generation() {
    let mut runtime=game(r#"
local bounds={x=0,y=0,width=10,height=10}
local q={asset='texture://tile',rect=bounds}
root.children={{kind='image_batch',id='art',rect=bounds,content='shared'}}
root.budget={max_nodes=3}
local turn=0
return {start=function(api)
 api.ui.imageBatch.define('shared',{bounds=bounds,quads={q}});api.ui.setRoot(root)
end,update=function(api)
 turn+=1
 if turn==1 then api.ui.imageBatch.define('shared',{bounds=bounds,quads={q,q}})
 elseif turn==2 then
  local ok,err=pcall(api.ui.imageBatch.define,'shared',{bounds=bounds,quads={q,q,q}})
  assert(not ok and string.find(tostring(err),'UI_NODE_LIMIT',1,true))
 else
  root.children={{kind='panel',id='empty',rect=bounds}};api.ui.setRoot(root)
  assert(api.ui.imageBatch.remove('shared'))
 end
end}
"#);
    let old=runtime.observe();
    let old_bytes=serde_json::to_vec(&old).unwrap();
    let old_tree=old.ui.as_ref().unwrap();
    let accepted=runtime.tick().unwrap();
    assert!(!Arc::ptr_eq(old_tree,accepted.ui.as_ref().unwrap()));
    assert_eq!(old_tree.usage().image_quads,1);
    assert_eq!(accepted.ui.as_ref().unwrap().usage().image_quads,2);
    let rejected=runtime.tick().unwrap();
    assert!(Arc::ptr_eq(accepted.ui.as_ref().unwrap(),rejected.ui.as_ref().unwrap()));
    assert_eq!(accepted.ui_image_batches,rejected.ui_image_batches);
    assert!(runtime.tick().unwrap().ui_image_batches.is_empty());
    drop(runtime);
    assert_eq!(old.ui_image_batches["shared"].quads().len(),1);
    assert_eq!(accepted.ui_image_batches["shared"].quads().len(),2);
    assert_eq!(serde_json::to_vec(&old).unwrap(),old_bytes);
}

#[cfg(feature="dev-tools")]
#[test]
fn developer_edits_detach_candidates_and_rejections_keep_identity_and_digest() {
    use crate::developer::{Change,EnactOperation,Selector};
    let mut runtime=game("return {start=function(api)api.ui.setRoot(root)end,update=function()end}");
    let old=runtime.observe();
    let old_bytes=serde_json::to_vec(&old).unwrap();
    let edit=EnactOperation{selector:Selector::Ui{id:"label".into()},change:Change::SetText{text:"edited".into()}};
    let (dry,_)=runtime.enact_developer(std::slice::from_ref(&edit),true).unwrap();
    assert_eq!(text(dry.ui.as_deref().unwrap()),"edited");
    assert!(Arc::ptr_eq(old.ui.as_ref().unwrap(),runtime.observe().ui.as_ref().unwrap()));
    let (accepted,_)=runtime.enact_developer(std::slice::from_ref(&edit),false).unwrap();
    assert!(!Arc::ptr_eq(old.ui.as_ref().unwrap(),accepted.ui.as_ref().unwrap()));
    assert_eq!(text(old.ui.as_deref().unwrap()),"before");
    assert_eq!(text(accepted.ui.as_deref().unwrap()),"edited");
    let digest=observation_digest(&accepted).unwrap();
    let transient=EnactOperation{selector:Selector::Ui{id:"label".into()},change:Change::SetText{text:"transient".into()}};
    let invalid=EnactOperation{selector:Selector::Ui{id:"label".into()},change:Change::SetRect{
        rect:crate::UiRect{x:0.,y:0.,width:-1.,height:10.}}};
    assert!(runtime.enact_developer(&[transient,invalid],false).is_err());
    let after=runtime.observe();
    assert!(Arc::ptr_eq(accepted.ui.as_ref().unwrap(),after.ui.as_ref().unwrap()));
    assert_eq!(observation_digest(&after).unwrap(),digest);
    assert_eq!(serde_json::to_vec(&old).unwrap(),old_bytes);
}

#[cfg(feature="dev-tools")]
#[test]
fn reload_without_ui_edits_preserves_the_current_generation() {
    let mut runtime=game("return {start=function(api)api.ui.setRoot(root)end,update=function()end}");
    let old=runtime.observe();
    runtime.reload_source("return {start=function()end,update=function()end}").unwrap();
    assert!(Arc::ptr_eq(old.ui.as_ref().unwrap(),runtime.observe().ui.as_ref().unwrap()));
    assert!(Arc::ptr_eq(old.ui.as_ref().unwrap(),runtime.tick().unwrap().ui.as_ref().unwrap()));
}

#[cfg(feature="dev-tools")]
#[test]
fn reload_replacement_and_failure_preserve_old_tree_and_resource_associations() {
    let mut runtime=game(r#"
local bounds={x=0,y=0,width=10,height=10}
return {start=function(api)
 api.ui.imageBatch.define('shared',{bounds=bounds,quads={{asset='texture://old',rect=bounds}}})
 root.children={{kind='image_batch',id='art',rect=bounds,content='shared'}}
 api.ui.setRoot(root)
end,update=function()end}
"#);
    let old=runtime.observe();
    let bytes=serde_json::to_vec(&old).unwrap();
    let digest=observation_digest(&old).unwrap();
    let candidate=r#"
local bounds={x=0,y=0,width=10,height=10}
local q={asset='texture://new',rect=bounds}
return {start=function()end,update=function()end,onReload=function(api)
 api.ui.imageBatch.define('shared',{bounds=bounds,quads={q,q}})
 ERROR_POINT
end}
"#;
    assert!(runtime.reload_source(candidate.replace("ERROR_POINT","error('reject candidate')")).is_err());
    let failed=runtime.observe();
    assert!(Arc::ptr_eq(old.ui.as_ref().unwrap(),failed.ui.as_ref().unwrap()));
    assert_eq!(observation_digest(&failed).unwrap(),digest);
    assert_eq!(failed.ui_image_batches["shared"].quads().len(),1);
    runtime.reload_source(candidate.replace("ERROR_POINT","")).unwrap();
    let current=runtime.observe();
    assert!(!Arc::ptr_eq(old.ui.as_ref().unwrap(),current.ui.as_ref().unwrap()));
    assert_eq!(current.ui.as_ref().unwrap().usage().image_quads,2);
    assert_eq!(current.ui_image_batches["shared"].quads()[0].asset,"texture://new");
    assert_eq!(old.ui.as_ref().unwrap().usage().image_quads,1);
    assert_eq!(old.ui_image_batches["shared"].quads()[0].asset,"texture://old");
    assert_eq!(serde_json::to_vec(&old).unwrap(),bytes);
}

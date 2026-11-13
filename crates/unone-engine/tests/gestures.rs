use serde_json::{Value, json};
use unone_engine::{Diagnostic, EngineRuntime, ProjectConfig, SourceProject, parse_input_frame};

const HELPERS: &str = r#"
local function near(a,b) assert(math.abs(a-b)<1e-9,tostring(a)..' != '..tostring(b)) end
local vp={revision=1,width=720,height=1280,rect_left=0,rect_top=0,css_width=360,css_height=640,device_pixel_ratio=2}
local function pointer(id,phase,x,y,route)
 return {kind='pointer',pointer_id=id,pointer_type='touch',phase=phase,route=route or 'game',
 point=x and {x=x,y=y,inside=true,viewport=vp} or nil}
end
local function send(g,id,phase,x,y,route) return g.process(pointer(id,phase,x,y,route)) end
"#;

fn config(declared: bool) -> ProjectConfig {
    let mut config = json!({"name":"gestures-qa","entry_script":"main.luau","systems":{
        "ui":false,"audio":false,"camera2d":false,"camera3d":false,"physics2d":false,
        "physics3d":false,"random":false,"save":false,"spine":false,"particle":false,
        "effekseer":false,"jobs":false
    }});
    if declared {
        config["runtime_packages"] = json!({"@unone/gestures":"0.1.0"});
    }
    serde_json::from_value(config).unwrap()
}

fn load(source: String, declared: bool) -> Result<EngineRuntime, Box<Diagnostic>> {
    EngineRuntime::load_source_project(SourceProject {
        config: config(declared),
        source,
        ..SourceProject::default()
    })
}

fn exercise(body: &str) {
    load(
        format!("return {{start=function(api)\n{HELPERS}\n{body}\nend,update=function()end}}"),
        true,
    )
    .unwrap();
}

#[test]
fn metadata_discovery_exact_version_and_ui_independence() {
    let source = "return {start=function(api) local i=api.input.gestures.info();assert(i.name=='@unone/gestures' and i.version=='0.1.0' and not i.declared);assert(table.isfrozen(i));local ok,e=pcall(api.input.gestures.create);assert(not ok and string.find(e,'GESTURE_PACKAGE_NOT_DECLARED',1,true)) end,update=function()end}";
    load(source.into(), false).unwrap();
    exercise(
        "assert(api.input.gestures.info().declared);assert(api.input.gestures.create().status().contacts==0)",
    );
    let mut config = config(true);
    config
        .runtime_packages
        .insert("@unone/gestures".into(), "9.9.9".into());
    let error = match EngineRuntime::load_source_project(SourceProject {
        config,
        source: "syntax must never run".into(),
        ..Default::default()
    }) {
        Ok(_) => panic!("mismatched package accepted"),
        Err(error) => error,
    };
    assert_eq!(error.code, "RUNTIME_PACKAGE_UNAVAILABLE");
}

#[test]
fn pan_threshold_detached_results_and_final_release() {
    exercise(
        r#"
local g=api.input.gestures.create({panThreshold=6})
local down=send(g,1,'down',100,100);assert(not down.consumed and #down.events==0)
local tap=send(g,1,'move',103,103);assert(not tap.consumed)
local start=send(g,1,'move',106,100);assert(start.consumed and start.captured)
assert(start.events[1].kind=='pan' and start.events[1].phase=='start');near(start.events[1].deltaX,6)
local move=send(g,1,'move',110,104);near(move.events[1].deltaX,4);near(move.events[1].deltaY,4)
local up=send(g,1,'up',110,104);assert(up.events[1].phase=='end' and up.consumed and not up.captured)
assert(start.events[1].x==106 and table.isfrozen(start) and table.isfrozen(start.events) and table.isfrozen(start.events[1].viewport))
assert(not pcall(function()start.events[1].x=999 end))
send(g,2,'down',50,50);assert(not send(g,2,'up',50,50).consumed)
assert(g.status().contacts==0 and not g.status().captured)
assert(not g.process({kind='pointer',pointer_type='mouse',pointer_id=9,phase='down'}).consumed)
assert(not g.process({kind='key'}).consumed)
"#,
    );
}

#[test]
fn pinch_centroid_physical_aspect_rotation_and_stable_pair_identity() {
    exercise(
        r#"
local g=api.input.gestures.create()
send(g,20,'down',100,100)
local start=send(g,3,'down',200,100);assert(start.events[1].phase=='start' and start.events[1].kind=='transform')
local spread=send(g,3,'move',300,100).events[1]
near(spread.scale,2);near(spread.x,200);near(spread.deltaX,50);near(spread.rotation,0)
local rotate=send(g,3,'move',100,300).events[1]
near(rotate.scale,1);near(rotate.rotation,math.pi/2);near(rotate.x,100);near(rotate.y,200)
local up=send(g,3,'up',100,300);assert(up.events[1].phase=='end' and up.captured)
local tail=send(g,20,'move',500,500);assert(tail.consumed and #tail.events==0)
assert(send(g,20,'up',500,500).consumed and not g.status().captured)
send(g,1,'down',100,100);send(g,2,'down',100,100)
local tiny=send(g,2,'move',100,100).events[1];near(tiny.scale,1);near(tiny.rotation,0)
local baseline=send(g,2,'move',102,100).events[1];near(baseline.scale,1)
near(send(g,2,'move',104,100).events[1].scale,2)
"#,
    );
}

#[test]
fn transitions_ui_rejection_third_finger_and_no_one_finger_fallthrough() {
    exercise(
        r#"
local g=api.input.gestures.create()
send(g,1,'down',100,100);send(g,1,'move',110,100)
local join=send(g,2,'down',200,100)
assert(#join.events==2 and join.events[1].phase=='cancel' and join.events[2].phase=='start')
local third=send(g,3,'down',300,100);assert(third.events[1].reason=='extra_pointer')
assert(#send(g,2,'move',250,100).events==0)
local baseline=send(g,3,'up',300,100);assert(baseline.events[1].phase=='start')
near(send(g,2,'move',390,100).events[1].scale,2)
send(g,2,'up',390,100);send(g,1,'up',110,100)
send(g,1,'down',100,100);send(g,1,'move',110,100)
local ui=send(g,2,'down',200,100,'engine_ui');assert(ui.events[1].phase=='cancel')
assert(#send(g,1,'move',50,100).events==0)
send(g,2,'up',200,100,'engine_ui');send(g,1,'up',50,100)
assert(not g.status().captured)
"#,
    );
}

#[test]
fn focus_reset_capture_cancel_and_geometry_changes_drop_stale_state() {
    exercise(
        r#"
for _,control in {
 {kind='focus',focused=false}, {kind='reset',scope='all',reason='blur'},
 {kind='reset',scope='pointer',pointer_id=2,reason='lost_capture'},
 {kind='capture',pointer_id=2,captured=false},pointer(2,'cancel'),
 {kind='viewport',viewport={revision=2,width=1280,height=720}},
} do
 local g=api.input.gestures.create();send(g,1,'down',100,100);send(g,2,'down',200,100)
 local cancelled=g.process(control);assert(cancelled.events[1].phase=='cancel')
 assert(#send(g,1,'move',50,100).events==0)
 g.process({kind='reset',scope='all',reason='load'})
 assert(g.status().contacts==0 and not g.status().captured)
 send(g,3,'down',100,100);assert(send(g,3,'move',150,100).events[1].kind=='pan')
end
"#,
    );
}

#[test]
fn options_predicates_explicit_cancel_reentry_and_ownership() {
    exercise(
        r#"
local options={panThreshold=8,accept=function(p) assert(table.isfrozen(p));return p.x<300 end}
local g=api.input.gestures.create(options);options.panThreshold=0
send(g,1,'down',100,100);assert(#send(g,1,'move',104,100).events==0)
assert(send(g,1,'move',110,100).events[1].phase=='start')
assert(g.cancel().events[1].phase=='cancel');assert(#send(g,1,'move',200,100).events==0)
send(g,1,'up',200,100);send(g,1,'down',400,100);assert(#send(g,1,'move',100,100).events==0);send(g,1,'up',100,100)
send(g,1,'down',100,100);g.setEnabled(false);g.setEnabled(true)
assert(#send(g,1,'move',200,100).events==0);send(g,1,'up',200,100)
send(g,1,'down',100,100);assert(send(g,1,'move',200,100).events[1].phase=='start')
for _,bad in {{unknown=true},{panThreshold=-1},{panThreshold=0/0},{minPinchDistance=0},{enabled='true'},{accept=1}} do
 assert(not pcall(api.input.gestures.create,bad))
end
local predicate=api.input.gestures.create({accept=function()return nil end})
assert(not pcall(send,predicate,1,'down',100,100));assert(predicate.status().contacts==0)
local recursive
recursive=api.input.gestures.create({accept=function()recursive.cancel();return true end})
local ok,e=pcall(send,recursive,1,'down',100,100);assert(not ok and string.find(e,'GESTURE_REENTRANT',1,true))
assert(recursive.status().contacts==0)
assert(not pcall(g.process,{kind='pointer',pointer_type='touch',pointer_id=4,phase='move',point={x=math.huge,y=0,viewport=vp}}))
"#,
    );
}

#[test]
fn actual_ordered_core_input_reaches_the_embedded_package() {
    let source = r#"local g
return {start=function(api)g=api.input.gestures.create()end,
update=function(api)
 local rows=api.input.getPhysicalBatch();if not rows then return end
 for _,row in rows.events do
  local result=g.process(row)
  for _,e in result.events do if e.phase=='change' then api.observation.set('scale',e.scale)end end
 end
 api.observation.set('contacts',g.status().contacts)
end}"#;
    let mut runtime = load(source.into(), true).unwrap();
    let viewport = json!({"revision":1,"width":720,"height":1280,"rect_left":0,"rect_top":0,"css_width":360,"css_height":640,"device_pixel_ratio":2});
    let rows:Vec<Value>=[(1,"down",100.),(2,"down",200.),(2,"move",300.),(2,"up",300.),(1,"up",100.)].into_iter().enumerate().map(|(index,(id,phase,x))|json!({
        "kind":"pointer","pointer_id":id,"pointer_type":"touch","phase":phase,"button":0,"buttons":if phase=="up"{0}else{1},
        "point":{"x":x,"y":100,"inside":true,"viewport":viewport},"modifiers":{"shift":false,"control":false,"alt":false,"meta":false},
        "sequence":index+1,"received_us":index+1,"origin":"fixture","route":"game"
    })).collect();
    let frame=parse_input_frame(&serde_json::to_vec(&json!({"physical":{"profile":"ordered_physical_v1","epoch":1,"after_sequence":0,"through_sequence":5,"events":rows}})).unwrap()).unwrap();
    runtime.tick_with_input(&frame).unwrap();
    assert_eq!(runtime.semantic_observations()["scale"], 2.);
    assert_eq!(runtime.semantic_observations()["contacts"], 0);
}

#[cfg(feature = "ui")]
#[test]
fn recognizer_mutations_are_rejected_inside_pure_ui_callbacks() {
    for mutation in [
        "api.input.gestures.create()",
        "g.cancel()",
        "g.setEnabled(false)",
        "g.process({kind='key'})",
    ] {
        let mut config = config(true);
        config.systems.insert("ui".into(), true);
        let source = format!(
            r#"return {{start=function(api)
local g=api.input.gestures.create()
api.ui.setRoot({{id='root',node='root',children={{api.ui.virtualList({{id='list',viewport={{left=0,top=0,width=80,height=80}},rowHeight=10,items={{{{id='one'}}}},key=function(v)return v.id end,renderItem=function() {mutation};return {{kind='panel',id='row',rect={{x=0,y=0,width=10,height=10}}}} end}})}}}})
end,update=function()end}}"#
        );
        let error = match EngineRuntime::load_source_project(SourceProject {
            config,
            source,
            ..Default::default()
        }) {
            Ok(_) => panic!("mutation accepted: {mutation}"),
            Err(error) => error,
        };
        assert!(format!("{error:?}").contains("UI_PURE_VIEW"), "{error:?}");
    }
}

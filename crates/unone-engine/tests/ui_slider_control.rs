#![cfg(feature = "ui")]

use serde_json::{Value, json};
use unone_engine::{Diagnostic, EngineRuntime, InputFrame, ProjectConfig, SourceProject, parse_input_frame};

fn load(body: &str, declared: bool) -> Result<EngineRuntime, Box<Diagnostic>> {
    load_script(&format!("return {{start=function(api)\n{body}\nend,update=function()end}}"), declared)
}

fn load_script(source: &str, declared: bool) -> Result<EngineRuntime, Box<Diagnostic>> {
    let mut config = json!({"name":"slider-control","entry_script":"main.luau","systems":{"ui":true}});
    if declared {
        let manifest: Value = serde_json::from_str(include_str!("../../../packages/unone-ui/package.unone.json")).unwrap();
        config["runtime_packages"] = json!({"@unone/ui":manifest["version"]});
    }
    let config: ProjectConfig = serde_json::from_value(config).unwrap();
    EngineRuntime::load_source_project(SourceProject {
        config,
        source: source.to_owned(),
        ..SourceProject::default()
    })
}

#[test]
fn direct_and_themed_slider_controls_share_the_numeric_contract() {
    let runtime = load(r#"
local event=nil
local input={getSliderInteraction=function(id) assert(id=='gain');return event end}
local function exercise(ui)
    local c=ui.createSlider({id='gain',value=12,min=10,max=20,step=3})
    assert(c.getValue()==13)
    local function update(phase,ratio)
        event=phase and {phase=phase,ratio=ratio} or nil
        return c.update(input)
    end
    local idle=update(nil)
    assert(idle.value==13 and not idle.changed and not idle.dragging)
    assert(not idle.started and not idle.released and not idle.cancelled)
    local start=update('start',0.4)
    assert(start.value==13 and start.started and start.dragging and not start.changed)
    local middle=update('drag',0.8)
    assert(middle.value==19 and middle.changed and middle.dragging and not middle.started)
    local quiet=update(nil)
    assert(quiet.value==19 and quiet.dragging and not quiet.changed)
    local last=update('end',1)
    assert(last.value==20 and last.changed and last.released and not last.dragging)
    local stray=update('drag',0)
    assert(stray.value==20 and not stray.changed and not stray.dragging)
    assert(update('start',0).value==10)
    local cancel=update('cancel',0.9)
    assert(cancel.value==10 and cancel.cancelled and not cancel.dragging and not cancel.changed)
    local idleAfterCancel=update(nil)
    assert(not idleAfterCancel.cancelled and not idleAfterCancel.released)
end
exercise(api.ui.components)
exercise(api.ui.components.create())
api.observation.set('entrypoints',2)
"#, true).unwrap();
    assert_eq!(runtime.semantic_observations()["entrypoints"], 2);
}

#[test]
fn programmatic_value_and_cancel_block_the_old_drag_until_a_new_start() {
    load(r#"
local ui=api.ui.components
local c=ui.createSlider({id='s',value=0,min=-5,max=5,step=2})
local e=nil
local input={getSliderInteraction=function()return e end}
local function send(phase,ratio) e={phase=phase,ratio=ratio};return c.update(input) end
assert(c.getValue()==1)
assert(send('start',1).value==5)
c.setValue(-2)
assert(c.getValue()==-1)
local stale=send('drag',1)
assert(stale.value==-1 and not stale.changed and not stale.dragging)
assert(not send('end',1).released)
assert(send('start',0).value==-5)
c.cancel()
assert(send('drag',1).value==-5)
assert(send('end',1).value==-5)
assert(send('start',0.5).value==1)
c.setValue(-999);assert(c.getValue()==-5)
c.setValue(999);assert(c.getValue()==5)
local tiny=ui.createSlider({id='tiny',value=0.4,step=1e-300})
assert(tiny.getValue()==0.4)
local plain=ui.createSlider({id='plain',value=0.375})
assert(plain.getValue()==0.375)
"#, true).unwrap();
}

#[test]
fn slider_view_is_pure_copied_and_uses_one_shared_hit_and_track_geometry() {
    let runtime = load(r#"
local ui=api.ui.components.create({slider={font_size=2,color={0.1,0.2,0.3,1},padding={left=1,right=2}}})
local c=ui.createSlider({id='s',value=0.4,axis='vertical',reverse=true})
local rect={x=10,y=30,width=40,height=5}
local track={x=12,y=20,width=36,height=1}
local props={rect=rect,trackRect=track,text='Gain',style={padding={left=3}}}
local a=c.view(props)
assert(a.kind=='slider' and a.id=='s' and a.action=='s' and a.text=='Gain')
assert(a.drag.axis=='vertical' and a.drag.reverse and a.drag.enabled)
assert(a.drag.track_rect.x==12 and a.drag.track_rect.y==20)
assert(math.abs(a.drag.hit_rect.x-10)<1e-9 and math.abs(a.drag.hit_rect.y-19.35)<1e-9)
assert(math.abs(a.drag.hit_rect.width-40)<1e-9 and math.abs(a.drag.hit_rect.height-15.65)<1e-9)
assert(a.style.font_size==2 and a.style.padding.left==3 and a.style.padding.right==2)
rect.x=99;track.x=88;props.style.padding.left=99
assert(a.rect.x==10 and a.drag.track_rect.x==12 and a.style.padding.left==3)
a.style.color[1]=0.9
local b=c.view({rect={x=1,y=2,width=3,height=4},hitPadding=0,enabled=false,action='Gain'})
assert(b.drag.hit_rect.x==1 and b.drag.hit_rect.y==2 and b.drag.hit_rect.width==3 and b.drag.hit_rect.height==4)
assert(b.drag.track_rect.x==b.rect.x and b.drag.track_rect~=b.rect)
assert(b.style.color[1]==0.1 and b.action=='Gain' and not b.drag.enabled)
assert(c.getValue()==0.4)
local raw=api.ui.components.createSlider({id='raw',value=0}).view({rect={x=0,y=0,width=1,height=1}})
assert(raw.style==nil and raw.drag.axis=='horizontal' and not raw.drag.reverse)
api.observation.set('view',a)
"#, true).unwrap();
    assert_eq!(runtime.semantic_observations()["view"]["drag"]["track_rect"]["x"], 12);
}

#[test]
fn slider_controls_are_independent_and_host_reverse_is_not_applied_twice() {
    load(r#"
local ui=api.ui.components
local a=ui.createSlider({id='a',value=10,min=0,max=100,axis='vertical',reverse=true})
local b=ui.createSlider({id='b',value=0.5})
local events={a={phase='start',ratio=0.25},b={phase='start',ratio=0.75}}
local input={getSliderInteraction=function(id)return events[id] end}
assert(a.update(input).value==25)
assert(b.update(input).value==0.75)
a.cancel()
events={a={phase='drag',ratio=1},b={phase='drag',ratio=0.25}}
assert(a.update(input).value==25)
assert(b.update(input).value==0.25)
assert(a.getValue()==25 and b.getValue()==0.25)
"#, true).unwrap();
}

#[test]
fn slider_configuration_and_familiar_misuse_fail_with_actionable_diagnostics() {
    let runtime = load(r#"
local ui=api.ui.components
local cases={
    {function()ui.createSlider({id='s'})end,'value must be finite'},
    {function()ui.createSlider({id='',value=0})end,'UI_COMPONENT_ID'},
    {function()ui.createSlider({id='s',value=0,min=1,max=1})end,'UI_SLIDER_RANGE'},
    {function()ui.createSlider({id='s',value=0,min=-1e308,max=1e308})end,'UI_SLIDER_RANGE'},
    {function()ui.createSlider({id='s',value=0/0})end,'UI_SLIDER_NUMBER'},
    {function()ui.createSlider({id='s',value=0,step=0})end,'UI_SLIDER_STEP'},
    {function()ui.createSlider({id='s',value=0,step=-1})end,'UI_SLIDER_STEP'},
    {function()ui.createSlider({id='s',value=0,step=math.huge})end,'UI_SLIDER_NUMBER'},
    {function()ui.createSlider({id='s',value=0,axis='both'})end,'UI_SLIDER_AXIS'},
    {function()ui.createSlider({id='s',value=0,axis=false})end,'UI_SLIDER_AXIS'},
    {function()ui.createSlider({id='s',value=0,reverse=1})end,'UI_SLIDER_REVERSE'},
    {function()ui.createSlider({id='s',value=0,onChange=function()end})end,'control.update(api.input)'},
    {function()ui.slider({id='s',value=0})end,'use createSlider'},
}
local c=ui.createSlider({id='s',value=0})
local rect={x=1,y=2,width=3,height=4}
table.insert(cases,{function()c.view({rect=rect,onChange=function()end})end,'no callbacks'})
table.insert(cases,{function()c.view({anchor='center'})end,'UI_COMPONENT_PROP'})
table.insert(cases,{function()c.view({rect={x=0,y=0,width=0,height=1}})end,'UI_SLIDER_RECT'})
table.insert(cases,{function()c.view({rect=rect,trackRect={x=0,y=0,width=1,height=math.huge}})end,'UI_SLIDER_NUMBER'})
table.insert(cases,{function()c.view({rect=rect,hitPadding=-1})end,'UI_SLIDER_PADDING'})
table.insert(cases,{function()c.view({rect=rect,enabled=1})end,'UI_SLIDER_ENABLED'})
table.insert(cases,{function()c.view({rect=rect,action=''})end,'UI_SLIDER_ACTION'})
table.insert(cases,{function()c.view({rect=rect,action=false})end,'UI_SLIDER_ACTION'})
table.insert(cases,{function()c.setValue(math.huge)end,'UI_SLIDER_NUMBER'})
table.insert(cases,{function()c.update({})end,'UI_SLIDER_INPUT'})
table.insert(cases,{function()c.update({getSliderInteraction=function()return {phase='click',ratio=0} end})end,'UI_SLIDER_INTERACTION'})
table.insert(cases,{function()c.update({getSliderInteraction=function()return {phase='start',ratio=2} end})end,'UI_SLIDER_INTERACTION'})
for _,case in ipairs(cases) do
    local ok,message=pcall(case[1])
    assert(not ok and string.find(tostring(message),case[2],1,true),tostring(message))
end
api.observation.set('diagnostics',#cases)
"#, true).unwrap();
    assert_eq!(runtime.semantic_observations()["diagnostics"], 25);
}

#[test]
fn undeclared_projects_cannot_construct_slider_controls() {
    load(r#"
local ok,message=pcall(function()api.ui.components.createSlider({id='s',value=0})end)
assert(not ok and string.find(message,'UI_PACKAGE_NOT_DECLARED',1,true))
"#, false).unwrap();
}

fn interactive_runtime() -> EngineRuntime {
    load_script(r#"
local Game={}
local slider=nil
function Game.start(api)
    assert(api.input.getSliderInteraction('gain')==nil)
    slider=api.ui.components.createSlider({id='gain',value=0,min=0,max=10,step=3})
    api.ui.setRoot(api.ui.components.screen({id='settings',node='test',children={
        slider.view({rect={x=10,y=10,width=70,height=10},trackRect={x=12,y=12,width=66,height=1}}),
    }}))
end
function Game.update(api)
    local first=api.input.getSliderInteraction('gain')
    local second=api.input.getSliderInteraction('gain')
    if first then
        assert(second~=nil and first.phase==second.phase and first.ratio==second.ratio)
        first.ratio=-100
        assert(api.input.getSliderInteraction('gain').ratio==second.ratio)
    else
        assert(second==nil)
    end
    api.observation.set('event',second or false)
    api.observation.set('slider',slider.update(api.input))
end
return Game
"#, true).unwrap()
}

fn slider_frame(phase: &str, ratio: f64) -> InputFrame {
    serde_json::from_value(json!({"ui_sliders":{"gain":{"phase":phase,"ratio":ratio}}})).unwrap()
}

#[test]
fn default_padded_controls_publish_at_stage_and_scroll_origins() {
    load(r#"
local ui=api.ui.components
local stage=ui.createSlider({id='stage_gain',value=.5})
local row=ui.createSlider({id='row_gain',value=.5})
local stageNode=stage.view({rect={x=0,y=0,width=20,height=5}})
local localNode=row.view({rect={x=0,y=0,width=20,height=5}})
assert(stageNode.drag.hit_rect.x<0 and localNode.drag.hit_rect.y<0)
api.ui.setRoot(ui.screen({id='origin_controls',node='test',children={stageNode,
 ui.scrollView({id='list',viewport={left=40,top=10,width=40,height=30},content={localNode}})}}))
"#,true).unwrap();
}

#[test]
fn accepted_control_ids_fit_the_shared_input_protocol() {
    load(r#"
local ui=api.ui.components
local ok,message=pcall(function() ui.createSlider({id=string.rep('x',1025),value=.5}) end)
assert(not ok and string.find(tostring(message),'UI_SLIDER_ID',1,true))
local max=ui.createSlider({id=string.rep('x',1024),value=.5})
api.ui.setRoot(ui.screen({id='ids',node='test',children={max.view({rect={x=0,y=0,width=20,height=5}})}}))
local raw=max.view({rect={x=0,y=0,width=20,height=5}})
raw.id=string.rep('x',1025)
ok,message=pcall(function() api.ui.setRoot(ui.screen({id='ids',node='test',children={raw}})) end)
assert(not ok and string.find(tostring(message),'UI_SLIDER_ID',1,true))
"#,true).unwrap();
}

#[test]
fn real_host_snapshots_are_read_only_ephemeral_and_drive_the_official_control() {
    let mut runtime = interactive_runtime();
    runtime.tick_with_input(&slider_frame("drag", 0.8)).unwrap();
    assert_eq!(runtime.semantic_observations()["slider"]["value"], 0);
    assert_eq!(runtime.semantic_observations()["slider"]["dragging"], false);
    runtime.tick_with_input(&slider_frame("start", 0.5)).unwrap();
    assert_eq!(runtime.semantic_observations()["event"], json!({"phase":"start","ratio":0.5}));
    assert_eq!(runtime.semantic_observations()["slider"]["value"], 6);
    assert_eq!(runtime.semantic_observations()["slider"]["started"], true);
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["event"], false);
    assert_eq!(runtime.semantic_observations()["slider"]["started"], false);
    assert_eq!(runtime.semantic_observations()["slider"]["changed"], false);
    assert_eq!(runtime.semantic_observations()["slider"]["dragging"], true);
    runtime.tick_with_input(&slider_frame("end", 1.0)).unwrap();
    assert_eq!(runtime.semantic_observations()["slider"]["value"], 10);
    assert_eq!(runtime.semantic_observations()["slider"]["released"], true);
    assert_eq!(runtime.semantic_observations()["slider"]["dragging"], false);
    runtime.tick_with_input(&InputFrame::default()).unwrap();
    assert_eq!(runtime.semantic_observations()["event"], false);
    assert_eq!(runtime.semantic_observations()["slider"]["released"], false);
    assert_eq!(runtime.semantic_observations()["slider"]["value"], 10);
}

#[test]
fn invalid_semantic_slider_frames_fail_before_advancing_the_runtime() {
    let mut runtime = interactive_runtime();
    for raw in [
        r#"{"ui_sliders":{"gain":{"phase":"click","ratio":0.5}}}"#,
        r#"{"ui_sliders":{"gain":{"phase":"start","ratio":0.5,"value":10}}}"#,
        r#"{"ui_sliders":{"gain":{"phase":"start","ratio":-0.1}}}"#,
        r#"{"ui_sliders":{"gain":{"phase":"start","ratio":1.1}}}"#,
        r#"{"ui_sliders":{"gain":{"phase":"start","ratio":null}}}"#,
        r#"{"ui_sliders":{"gain":{"phase":"start","ratio":NaN}}}"#,
        r#"{"ui_sliders":{"gain":{"phase":"start","ratio":1e999}}}"#,
        r#"{"ui_sliders":{" ":{"phase":"start","ratio":0}}}"#,
    ] {
        assert!(parse_input_frame(raw.as_bytes()).is_err(), "{raw}");
    }
    for ratio in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.1, 1.1] {
        let mut frame = slider_frame("start", 0.0);
        frame.ui_sliders.get_mut("gain").unwrap().ratio = ratio;
        assert!(frame.validate().is_err());
        assert!(runtime.tick_with_input(&frame).is_err());
        assert_eq!(runtime.observe().frame, 0);
    }
    runtime.tick_with_input(&slider_frame("start", 1.0)).unwrap();
    assert_eq!(runtime.observe().frame, 1);
    assert_eq!(runtime.semantic_observations()["slider"]["value"], 10);
}

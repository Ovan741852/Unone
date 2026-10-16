#![cfg(feature = "ui")]

use serde_json::{Value, json};
use unone_engine::{Diagnostic, EngineRuntime, ProjectConfig, SourceProject};

fn load(body: &str, declared: bool) -> Result<EngineRuntime, Box<Diagnostic>> {
    load_script(&format!("return {{start=function(api)\n{body}\nend,update=function()end}}"), declared)
}

fn load_script(source: &str, declared: bool) -> Result<EngineRuntime, Box<Diagnostic>> {
    let mut config = json!({"name":"ui-components","entry_script":"main.luau","systems":{"ui":true}});
    if declared {
        config["runtime_packages"] = json!({"@unone/ui":"0.3.0"});
    }
    let config: ProjectConfig = serde_json::from_value(config).unwrap();
    EngineRuntime::load_source_project(SourceProject {
        config,
        source: source.to_string(),
        ..SourceProject::default()
    })
}

#[test]
fn nested_virtual_helpers_keep_live_identity_and_materialize_without_a_tick() {
    let source = r#"
local Game={}
local updates=0
function Game.start(api)
    local ui=api.ui.components.create()
    local items={}
    for i=1,10 do items[i]={key='k'..i,name='Item '..i} end
    local function row(prefix)
        return function(item)
            return {ui.text({id=prefix..item.key,text=item.name,rect={x=0,y=0,width=20,height=8}})}
        end
    end
    local keyCalls=0
    local function itemKey(item) keyCalls+=1;return item.key end
    local list=ui.virtualList({id='list',viewport={left=10,top=10,width=40,height=20},
        items=items,key=itemKey,rowHeight=10,renderItem=row('list_')})
    local grid=api.ui.components.virtualGrid({id='grid',viewport={left=55,top=10,width=40,height=20},
        items=items,key=itemKey,rowHeight=10,columns=2,columnWidth=20,renderItem=row('grid_')})
    assert(keyCalls==20)
    local ordinary=ui.text({id='ordinary',text='Unmanaged',rect={x=10,y=10,width=20,height=8}})
    local parent=ui.component({id='container',component='test.container',rect={x=0,y=0,width=100,height=100},
        children={list,grid,ordinary}})
    assert(parent.children[1]==list and parent.children[2]==grid)
    assert(parent.children[3]~=ordinary and parent.children[3].rect~=ordinary.rect)
    api.ui.setRoot(ui.screen({id='screen',node='virtual',children={parent}}))
    api.observation.set('updates',updates)
end
function Game.update(api)
    updates+=1
    api.observation.set('updates',updates)
    api.observation.set('sample',api.random.nextFloat())
end
return Game
"#;
    let mut runtime = load_script(source, true).unwrap();
    let mut baseline = load_script(source, true).unwrap();
    let before = runtime.observe();
    let initial = serde_json::to_value(before.ui.as_ref().unwrap()).unwrap();
    for (index, id, last) in [(0, "list", 7), (1, "grid", 10)] {
        let revision = initial["children"][0]["children"][index]["scroll"]["virtual_items"]["revision"].clone();
        runtime.ui_request(json!({"id":id,"revision":revision,"first":5,"last":last})).unwrap();
        let after = runtime.observe();
        assert_eq!(after.frame, before.frame);
        assert_eq!(after.observations, before.observations);
        let current = serde_json::to_value(after.ui.as_ref().unwrap()).unwrap();
        let virtual_node = &current["children"][0]["children"][index];
        assert_eq!(virtual_node["scroll"]["virtual_items"]["first"], 5);
        assert_eq!(virtual_node["scroll"]["virtual_items"]["last"], last);
        assert_eq!(virtual_node["children"].as_array().unwrap().len(), (last - 4) as usize);
        assert_eq!(virtual_node["children"][0]["id"], format!("{id}::k5"));
        assert_eq!(virtual_node["children"][0]["children"][0]["id"], format!("{id}_k5"));
        assert_eq!(virtual_node["children"][0]["children"][0]["text"], "Item 5");
    }
    assert_eq!(runtime.tick().unwrap().observations, baseline.tick().unwrap().observations);
    assert_eq!(runtime.semantic_observations()["updates"], 1);
}

fn observed(body: &str) -> Value {
    serde_json::to_value(load(body, true).unwrap().semantic_observations()).unwrap()
}

#[test]
fn virtual_rows_translate_slider_track_and_hit_geometry_with_the_leaf() {
    let values = observed(r#"
local c=api.ui.components
local items={{id='a'},{id='b'},{id='c'}}
local controls={}
for _,item in ipairs(items) do controls[item.id]=c.createSlider({id='slider_'..item.id,value=.5}) end
local original={rect={x=0,y=0,width=20,height=4},trackRect={x=1,y=1,width=18,height=1},hitPadding=0}
local list=c.virtualList({id='rows',viewport={left=10,top=10,width=30,height=25},items=items,key='id',rowHeight=10,
 renderItem=function(item) return {controls[item.id].view(original)} end})
for index,row in ipairs(list.children) do
 local n=row.children[1]
 assert(n.rect.y==(index-1)*10)
 assert(n.drag.track_rect.y==1+(index-1)*10)
 assert(n.drag.hit_rect.y==(index-1)*10)
 assert(n.drag.track_rect.x==1)
end
assert(original.rect.y==0 and original.trackRect.y==1)
api.ui.setRoot(c.screen({id='screen',node='test',children={list}}))
api.observation.set('translated',true)
"#);
    assert_eq!(values["translated"], true);
}

#[test]
fn undeclared_projects_can_inspect_metadata_but_cannot_use_the_package() {
    let runtime = load(r#"
local c=api.ui.components
local info=c.info()
assert(info.name=='@unone/ui' and info.version=='0.3.0' and info.declared==false)
info.version='changed'
assert(c.info().version=='0.3.0')
local calls={function()c.create()end,function()c.id('a','b')end,function()c.composeStyle()end}
for _,name in ipairs({'text','button','slider','combobox','panel','image','component','screen','scrollView','virtualList','virtualGrid'}) do
    table.insert(calls,function()c[name]({})end)
end
for _,call in ipairs(calls) do
    local ok,message=pcall(call)
    assert(not ok and string.find(message,'UI_PACKAGE_NOT_DECLARED',1,true))
    assert(string.find(message,'runtime_packages',1,true) and string.find(message,'0.3.0',1,true))
end
api.observation.set('declared',c.info().declared)
"#, false).unwrap();
    assert_eq!(runtime.semantic_observations()["declared"], false);
}

#[test]
fn constructors_publish_existing_nodes_with_authored_geometry_and_order() {
    let runtime = load(r#"
local c=api.ui.components
assert(c.info().declared)
local ui=c.create()
local bounds={x=10,y=10,width=70,height=60}
local children={
    ui.text({id=ui.id('card','heading'),text='Settings',rect={x=15,y=55,width=60,height=8}}),
    ui.button({id=ui.id('card','apply'),text='Apply',action='Apply',rect={x=55,y=15,width=20,height=8}}),
}
local card=ui.component({id='card',component='test.card',rect=bounds,
    surface={kind='panel',style={background={0.1,0.2,0.3,1}}},children=children})
assert(card.rect~=bounds and card.children[2]~=children[1])
bounds.x=99;children[1].text='Changed'
api.ui.setRoot({kind='screen',id='screen',node='test',children={card,
    ui.image({id='art',asset='asset://art',fit='contain',alt='Art',rect={x=85,y=10,width=10,height=10}})}})
"#, true).unwrap();
    let tree = runtime.observe().ui.unwrap();
    let value = serde_json::to_value(&tree).unwrap();
    let card = &value["children"][0];
    assert_eq!(card["kind"], "component");
    assert_eq!(card["rect"], json!({"x":10.0,"y":10.0,"width":70.0,"height":60.0}));
    assert_eq!(card["children"][0]["id"], "card/surface");
    assert_eq!(card["children"][0]["background_for"], json!({"component":"card"}));
    assert_eq!(card["children"][0]["rect"], card["rect"]);
    assert_eq!(card["children"][1]["id"], "card/heading");
    assert_eq!(card["children"][1]["text"], "Settings");
    assert_eq!(card["children"][1]["rect"], json!({"x":15.0,"y":55.0,"width":60.0,"height":8.0}));
    assert!(card["children"][1].get("style").is_none());
    assert_eq!(card["children"][2]["action"], "Apply");
    assert_eq!(value["children"][1]["asset"], "asset://art");
}

#[test]
fn direct_and_themed_entries_cover_every_canonical_control_and_screen() {
    let runtime = load(r#"
local c=api.ui.components
local ui=c.create()
local function equivalent(a,b)
    if type(a)~='table' or type(b)~='table' then return a==b end
    for k,v in pairs(a) do if not equivalent(v,b[k]) then return false end end
    for k in pairs(b) do if a[k]==nil then return false end end
    return true
end
local bounds={x=10,y=20,width=20,height=10}
local cases={
    {'text',{id='text',text='Text',rect=bounds}},
    {'button',{id='button',text='Apply',action='Apply',rect=bounds}},
    {'slider',{id='slider',text='Volume',action='Volume',rect=bounds}},
    {'combobox',{id='combobox',text='Quality',action='Quality',expanded=true,rect=bounds}},
    {'panel',{id='panel',rect=bounds}},
    {'image',{id='image',asset='asset://image',rect=bounds}},
    {'component',{id='component',component='test.card',rect=bounds,children={}}},
    {'screen',{id='screen',node='test',children={},budget={max_nodes=20}}},
    {'scrollView',{id='scroll',viewport={left=5,top=5,width=30,height=20},
        content={{kind='text',id='scroll_text',text='Local',rect={x=0,y=0,width=10,height=5}}}}},
}
for _,case in ipairs(cases) do
    local direct=c[case[1]](case[2])
    local themed=ui[case[1]](case[2])
    assert(equivalent(direct,themed),'entry mismatch '..case[1])
end
local theme={slider={background={0.1,0.2,0.3,1},padding={left=1,right=2}},
    combobox={font_size=2,color={0.2,0.4,0.6,1}}}
local styled=c.create(theme)
theme.slider.background[1]=0.9;theme.combobox.font_size=99
local slider=styled.slider({id='volume',text='Volume',action='Volume',rect=bounds,
    style={padding={left=3}}})
local combo=styled.combobox({id='quality',text='High',action='Quality',expanded=true,
    rect={x=50,y=20,width=20,height=10}})
assert(slider.style.background[1]==0.1 and slider.style.padding.left==3 and slider.style.padding.right==2)
assert(combo.style.font_size==2 and combo.expanded==true)
assert(c.slider({id='plain',action='Plain',rect=bounds}).style==nil)
local children={slider,combo}
local screen=c.screen({id='controls',node='test',children=children})
assert(screen.children~=children and screen.children[1]~=slider)
children[1].text='Mutated';assert(screen.children[1].text=='Volume')
api.ui.setRoot(screen)
api.observation.set('parity_checks',#cases)
"#, true).unwrap();
    let tree = serde_json::to_value(runtime.observe().ui.unwrap()).unwrap();
    assert_eq!(runtime.semantic_observations()["parity_checks"], 9);
    assert_eq!(tree["children"][0]["kind"], "slider");
    assert_eq!(tree["children"][0]["action"], "Volume");
    assert_eq!(tree["children"][1]["kind"], "combobox");
    assert_eq!(tree["children"][1]["expanded"], true);
}

#[test]
fn helper_forwarders_keep_existing_contracts_and_compatibility_entries() {
    let values = observed(r#"
local c=api.ui.components
local ui=c.create()
local function checkScroll(factory,id)
    local options={id=id,viewport={left=10,top=5,width=40,height=20},
        axis='both',resetKey='catalog',wheelRect={left=1,top=2,width=3,height=4},
        content={ui.text({id=id..'_text',text='Local',rect={x=0,y=0,width=10,height=5}})}}
    local node=factory(options)
    assert(node.kind=='scroll_view' and node.viewport==options.viewport and node.children==options.content)
    assert(node.scroll.axis=='both' and node.scroll.reset_key=='catalog' and node.scroll.wheel_rect.y==94)
    return node
end
local a=checkScroll(c.scrollView,'direct')
local b=checkScroll(ui.scrollView,'kit')
local legacy=checkScroll(api.ui.scrollView,'legacy')
local items={{key='stable-a',name='A'},{key='stable-b',name='B'}}
local callbacks=0
local function options(id)
    return {id=id,viewport={left=10,top=10,width=40,height=20},items=items,
        key=function(item,index)assert(items[index]==item);return item.key end,
        rowHeight=10,renderItem=function(item,index,key)
            callbacks+=1;assert(items[index]==item and key==item.key)
            return {ui.text({id=id..'_'..key,text=item.name,rect={x=0,y=0,width=20,height=8}})}
        end}
end
for _,factory in ipairs({c.virtualList,ui.virtualList,api.ui.virtualList}) do
    local id='list_'..callbacks
    local list=factory(options(id))
    assert(list.kind=='scroll_view' and list.children[1].children[1].text=='A')
end
for _,factory in ipairs({c.virtualGrid,ui.virtualGrid,api.ui.virtualGrid}) do
    local id='grid_'..callbacks
    local spec=options(id);spec.columns=2;spec.columnWidth=20
    local grid=factory(spec)
    assert(grid.scroll.virtual_items.columns==2 and grid.children[2].children[1].text=='B')
end
assert(callbacks==12)
api.observation.set('callbacks',callbacks)
api.observation.set('scrolls',{a,b,legacy})
"#);
    assert_eq!(values["callbacks"], 12);
    assert_eq!(values["scrolls"][0]["scroll"], values["scrolls"][2]["scroll"]);
}

#[test]
fn familiar_but_unsupported_callback_and_layout_props_have_actionable_errors() {
    let values = observed(r#"
local c=api.ui.components
local ui=c.create()
local cases={
    {function()ui.button({onClick=function()end})end,'wasPressed(action)'},
    {function()c.slider({onChange=function()end})end,'no UI callbacks or automatic value binding'},
    {function()ui.combobox({onPress=function()end})end,'isDown(action)'},
    {function()c.component({layout='column'})end,'stage coordinates'},
    {function()ui.text({placement={rect={}}})end,'flatten placement fields'},
    {function()c.text({kind='text'})end,'constructor supplies kind'},
    {function()c.button({fontSize=2})end,'font_size'},
    {function()ui.screen({id='screen',node='test',children={},layout='row'})end,'automatic layout'},
    {function()c.scrollView({onClick=function()end})end,'wasPressed(action)'},
    {function()ui.virtualList({onChange=function()end})end,'automatic value binding'},
    {function()c.virtualGrid({placement={}})end,'flatten placement fields'},
    {function()ui.virtualList({columns=2})end,'use virtualGrid'},
    {function()ui.screen({id='screen',node='test',children={[2]={}}})end,'UI_COMPONENT_CHILDREN'},
    {function()c.create({screen={}})end,'UI_COMPONENT_PROP'},
    {function()ui.slider({id='s',action='Slide',rect={},style={fontSize=2}})end,'font_size'},
}
for _,case in ipairs(cases) do
    local ok,message=pcall(case[1])
    assert(not ok and string.find(tostring(message),case[2],1,true),tostring(message))
end
api.observation.set('diagnostics',#cases)
"#);
    assert_eq!(values["diagnostics"], 15);
}

#[test]
fn theme_overrides_and_copied_inputs_are_isolated_between_instances() {
    let values = observed(r#"
local c=api.ui.components
local theme={text={font_size=2,color={0.1,0.2,0.3,1},padding={left=1,right=2}},panel={opacity=0.8}}
local ui=c.create(theme)
theme.text.font_size=99;theme.text.color[1]=0.9
local override={padding={left=3},color={0.4,0.5,0.6,1}}
local a=ui.text({id='a',text='A',rect={x=1,y=1,width=10,height=5},style=override})
local b=ui.text({id='b',text='B',rect={x=20,y=1,width=10,height=5}})
override.padding.left=88;override.color[1]=0.8
assert(a.style.padding.left==3 and a.style.padding.right==2 and a.style.color[1]==0.4)
assert(b.style.font_size==2 and b.style.color[1]==0.1 and b.style.padding.left==1)
a.style.padding.right=77;a.style.color[2]=0.9
assert(b.style.padding.right==2 and b.style.color[2]==0.2)
local base={padding={left=1,top=2},color={1,1,1,1}}
local merged=c.composeStyle(base,{padding={right=3},color={0.2,0.3}})
assert(#merged.color==2 and merged.padding.left==1 and merged.padding.top==2 and merged.padding.right==3)
merged.padding.left=55;assert(base.padding.left==1)
local slice={left=2,top=3,right=4,bottom=5,pixels_per_unit=2,source={x=1,y=2,width=8,height=8}}
local image=ui.image({id='image',asset='asset://image',rect={x=1,y=1,width=10,height=10},slice=slice})
slice.source.x=99;assert(image.slice.source.x==1)
api.observation.set('empty_style',next(c.composeStyle())==nil)
api.observation.set('styles',{a.style,b.style})
"#);
    assert_eq!(values["empty_style"], true);
    assert_eq!(values["styles"][0]["padding"]["left"], 3);
    assert_eq!(values["styles"][1]["padding"]["right"], 2);
}

#[test]
fn stable_ids_and_anchored_surfaces_do_not_reposition_children() {
    let runtime = load(r#"
local c=api.ui.components
local ui=c.create({image={opacity=0.7}})
assert(c.id('card','label')=='card/label' and ui.id('card','label')==c.id('card','label'))
assert(c.id('a','b/c')=='a/b%2Fc' and c.id('a','b/c')~=c.id(c.id('a','b'),'c'))
assert(c.id('a','%2F')=='a/%252F')
local card=ui.component({id='anchored',component='test.anchored',anchor='center',pivot='center',
    size={width=40,height=30},offset={x=2,y=3},surface={kind='image',asset='asset://skin',fit='stretch'},
    children={ui.text({id='child',text='Absolute',rect={x=45,y=48,width=10,height=5}})}})
api.observation.set('raw',card)
api.ui.setRoot({kind='screen',id='screen',node='test',children={card}})
"#, true).unwrap();
    let raw = &runtime.semantic_observations()["raw"];
    assert_eq!(raw["anchor"], raw["children"][0]["anchor"]);
    assert_eq!(raw["size"], raw["children"][0]["size"]);
    assert_eq!(raw["offset"], raw["children"][0]["offset"]);
    assert_eq!(raw["children"][1]["rect"]["x"], 45);
    assert_eq!(raw["children"][0]["style"]["opacity"], 0.7);
    let tree = runtime.observe().ui.unwrap();
    assert_eq!(tree.children[0].rect(), tree.children[0].children()[0].rect());
    assert_eq!(tree.children[0].children()[1].rect().x, 45.0);
}

#[test]
fn unknown_fields_sparse_children_and_cyclic_data_fail_before_publication() {
    let values = observed(r#"
local c=api.ui.components
local ui=c.create()
local calls={
    {function()ui.text({id='a',fontSize=2})end,'UI_COMPONENT_PROP'},
    {function()c.create({buttons={}})end,'UI_COMPONENT_PROP'},
    {function()ui.component({id='a',component='a',children={[2]={}}})end,'UI_COMPONENT_CHILDREN'},
    {function()ui.component({id='a',component='a',children={wrong={}}})end,'UI_COMPONENT_CHILDREN'},
    {function()ui.component({id='a',component='a',surface={kind='panel',rect={}}})end,'UI_COMPONENT_PROP'},
    {function()ui.component({id='a',component='a',surface={kind='text'}})end,'UI_COMPONENT_SURFACE'},
    {function()c.composeStyle({padding={horizontal=1}})end,'UI_COMPONENT_PROP'},
    {function()c.id('','role')end,'UI_COMPONENT_ID'},
    {function()local value={};value.color=value;c.composeStyle(value)end,'UI_COMPONENT_COPY'},
    {function()local root={};local current=root;for _=1,70 do current[1]={};current=current[1] end;c.composeStyle({color=root})end,'UI_COMPONENT_COPY'},
}
for _,case in ipairs(calls) do
    local ok,message=pcall(case[1])
    assert(not ok and string.find(message,case[2],1,true),tostring(message))
end
api.observation.set('checks',#calls)
"#);
    assert_eq!(values["checks"], 10);
}

#[test]
fn core_keeps_value_id_and_background_validation_authoritative() {
    let runtime = load(r#"
local ui=api.ui.components.create()
local rect={x=10,y=10,width=30,height=30}
api.ui.setRoot({kind='screen',id='good',node='test',children={ui.text({id='legacy',text='Good',rect=rect})}})
local function rejected(node,expected)
    local ok,message=pcall(function()api.ui.setRoot({kind='screen',id='bad',node='test',children={node}})end)
    assert(not ok and string.find(tostring(message),expected,1,true),tostring(message))
end
rejected(ui.text({id='bad_style',rect=rect,style={font_size=-2}}),'UI_STYLE_INVALID')
rejected(ui.component({id='duplicate',component='test.card',rect=rect,surface={kind='panel'},
    children={ui.text({id='duplicate/surface',rect=rect})}}),'duplicate')
local card=ui.component({id='bad_scope',component='test.card',rect=rect,surface={kind='panel'}})
card.children[1].background_for={component='unrelated'}
rejected(card,'UI_BACKGROUND_SCOPE')
local outside=ui.component({id='outside',component='test.card',rect=rect,surface={kind='panel'}})
outside.children[1].rect.x=0
rejected(outside,'UI_BACKGROUND_BOUNDS')
api.observation.set('rejected',true)
"#, true).unwrap();
    assert_eq!(runtime.semantic_observations()["rejected"], true);
    assert_eq!(runtime.observe().ui.unwrap().id, "good");
}

#[test]
fn component_backgrounds_do_not_hide_foreground_collisions() {
    let runtime = load(r#"
local ui=api.ui.components.create()
local r={x=10,y=10,width=50,height=50}
api.ui.setRoot({kind='screen',id='screen',node='test',children={
    ui.component({id='card',component='test.card',rect=r,surface={kind='panel'},children={
        ui.text({id='one',text='One',rect={x=15,y=20,width=30,height=10}}),
        ui.button({id='two',text='Two',action='Two',rect={x=20,y=20,width=30,height=10}}),
    }}),
}})
"#, true).unwrap();
    let report = unone_engine::inspect_layout(&runtime.observe().ui.unwrap(), 80, 45);
    assert!(report.allowed_overlaps.iter().any(|finding| finding.nodes.contains(&"card/surface".to_string())));
    assert!(report.findings.iter().any(|finding| finding.code == "UI_NODES_OVERLAP"
        && finding.nodes.contains(&"one".to_string()) && finding.nodes.contains(&"two".to_string())));
}

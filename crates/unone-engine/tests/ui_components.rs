#![cfg(feature = "ui")]

use serde_json::{Value, json};
use unone_engine::{Diagnostic, EngineRuntime, ProjectConfig, SourceProject};

fn load(body: &str, declared: bool) -> Result<EngineRuntime, Box<Diagnostic>> {
    load_script(&format!("return {{start=function(api)\n{body}\nend,update=function()end}}"), declared)
}

fn load_script(source: &str, declared: bool) -> Result<EngineRuntime, Box<Diagnostic>> {
    let mut config = json!({"name":"ui-components","entry_script":"main.luau","systems":{"ui":true}});
    if declared {
        let manifest: Value = serde_json::from_str(include_str!("../../../packages/unone-ui/package.unone.json")).unwrap();
        config["runtime_packages"] = json!({"@unone/ui":manifest["version"]});
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
    assert(parent.children[3]==ordinary and table.isfrozen(ordinary.rect))
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
assert(info.name=='@unone/ui' and info.version=='0.6.0' and info.declared==false)
info.version='changed'
assert(c.info().version=='0.6.0')
local calls={function()c.create()end,function()c.id('a','b')end,function()c.composeStyle()end}
for _,name in ipairs({'text','button','slider','combobox','panel','image','imageBatch','component','screen','scrollView','virtualList','virtualGrid'}) do
    table.insert(calls,function()c[name]({})end)
end
for _,call in ipairs(calls) do
    local ok,message=pcall(call)
    assert(not ok and string.find(message,'UI_PACKAGE_NOT_DECLARED',1,true))
    assert(string.find(message,'runtime_packages',1,true) and string.find(message,'0.6.0',1,true))
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
assert(card.rect~=bounds and card.children[2]==children[1])
bounds.x=99;assert(not pcall(function()children[1].text='Changed'end))
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
assert(screen.children~=children and screen.children[1]==slider)
assert(not pcall(function()children[1].text='Mutated'end));assert(screen.children[1].text=='Volume')
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
    assert(node.kind=='scroll_view')
    if factory==api.ui.scrollView then
        assert(node.viewport==options.viewport and node.children==options.content)
    else
        assert(node.viewport~=options.viewport and node.children~=options.content and table.isfrozen(node))
    end
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
    {function()c.component({layout='column'})end,'createResponsiveLayout'},
    {function()ui.text({placement={rect={}}})end,'flatten placement fields'},
    {function()c.text({kind='text'})end,'constructor supplies kind'},
    {function()c.button({fontSize=2})end,'font_size'},
    {function()ui.screen({id='screen',node='test',children={},layout='row'})end,'createResponsiveLayout'},
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
assert(not pcall(function()a.style.padding.right=77 end));assert(not pcall(function()a.style.color[2]=0.9 end))
assert(b.style.padding.right==2 and b.style.color[2]==0.2)
local base={padding={left=1,top=2},color={1,1,1,1}}
local merged=c.composeStyle(base,{padding={right=3},color={0.2,0.3}})
assert(#merged.color==2 and merged.padding.left==1 and merged.padding.top==2 and merged.padding.right==3)
assert(not pcall(function()merged.padding.left=55 end));assert(base.padding.left==1)
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
fn borrowed_portable_data_is_detached_frozen_and_strips_metatables() {
    let values = observed(r#"
local c=api.ui.components
local shared=table.freeze({0.1,0.2,0.3,1})
local source=table.freeze({color=shared,background=shared})
local copied=c.composeStyle(source)
assert(copied~=source and copied.color~=shared and copied.background~=shared)
assert(copied.color~=copied.background)
assert(table.isfrozen(copied) and table.isfrozen(copied.color))
assert(not pcall(function()copied.color[1]=0.9 end));assert(copied.background[1]==0.1 and shared[1]==0.1)
local protected=setmetatable({1,2,3},{__metatable='protected',__index={inherited=4}})
local plain=c.composeStyle({color=protected})
assert(getmetatable(plain.color)==nil and plain.color.inherited==nil and plain.color[2]==2)
assert(not pcall(function()plain.color[2]=8 end));assert(protected[2]==2)
local cases={
 {function()c.composeStyle({color={function()end}})end,'only portable'},
 {function()c.composeStyle({color={coroutine.create(function()end)}})end,'only portable'},
 {function()c.composeStyle({color={[true]=1}})end,'invalid table key'},
}
for _,case in ipairs(cases) do
 local ok,message=pcall(case[1])
 assert(not ok and string.find(tostring(message),case[2],1,true),tostring(message))
end
api.observation.set('copy_contract',true)
"#);
    assert_eq!(values["copy_contract"], true);
}

#[test]
fn portable_copy_preserves_exact_work_and_depth_bounds() {
    let values = observed(r#"
local c=api.ui.components
-- The style root and color table consume two of the 131072 visits.
local wide=table.create(131070,true)
assert(#c.composeStyle({color=wide}).color==131070)
wide[131071]=true
local ok,message=pcall(function()c.composeStyle({color=wide})end)
assert(not ok and string.find(tostring(message),'data exceeds copy limits',1,true),tostring(message))
-- An empty table at depth 64 is valid; its scalar child at depth 65 is not.
local deep={};local current=deep
for _=1,63 do current[1]={};current=current[1] end
assert(type(c.composeStyle({color=deep}).color)=='table')
current[1]=true
ok,message=pcall(function()c.composeStyle({color=deep})end)
assert(not ok and string.find(tostring(message),'data exceeds copy limits',1,true),tostring(message))
api.observation.set('copy_bounds',true)
"#);
    assert_eq!(values["copy_bounds"], true);
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
card=table.clone(card);card.children=table.clone(card.children);card.children[1]=table.clone(card.children[1])
card.children[1].background_for={component='unrelated'}
rejected(card,'UI_BACKGROUND_SCOPE')
local outside=ui.component({id='outside',component='test.card',rect=rect,surface={kind='panel'}})
outside=table.clone(outside);outside.children=table.clone(outside.children);outside.children[1]=table.clone(outside.children[1]);outside.children[1].rect=table.clone(outside.children[1].rect)
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
    assert!(report.declared_backgrounds.iter().any(|group| group.background=="card/surface" && group.pair_count==2));
    assert!(report.findings.iter().any(|finding| finding.code == "UI_NODES_OVERLAP"
        && finding.nodes.contains(&"one".to_string()) && finding.nodes.contains(&"two".to_string())));
}

#[test]
fn leaf_owned_styles_keep_theme_props_and_each_result_independent() {
    let values=observed(r#"
local c=api.ui.components
local shared={.1,.2,.3,1}
local theme={text={padding={left=1,right=2},color=shared,background=shared,text_shadow={offset_x=1,offset_y=2,color={0,0,0,.5}}}}
local ui=c.create(theme)
local props={id='a',text='A',rect={x=0,y=0,width=10,height=5},style={padding={right=4},color={.7,.8,.9,1},text_shadow={offset_x=3,color={1,1,1,.2}}}}
local a=ui.text(props)
local b=ui.text(props)
assert(a~=b and a.style~=b.style and a.style.color~=b.style.color and a.style.padding~=b.style.padding)
assert(a.style~=props.style and a.style.color~=props.style.color and a.rect~=props.rect)
assert(a.style.padding.left==1 and a.style.padding.right==4)
assert(a.style.text_shadow.offset_x==3 and a.style.text_shadow.offset_y==nil,'shadow replaces whole record')
assert(a.style.text_shadow~=props.style.text_shadow and a.style.text_shadow.color~=props.style.text_shadow.color)
props.style.color[1]=0;props.style.padding.right=9;props.rect.x=90;theme.text.padding.left=50;shared[1]=.99
assert(a.style.color[1]==.7 and a.style.padding.right==4 and a.rect.x==0)
assert(not pcall(function()a.style.color[1]=.5 end));assert(not pcall(function()a.style.padding.left=80 end));assert(not pcall(function()a.style.text_shadow.color[1]=0 end))
assert(b.style.color[1]==.7 and b.style.padding.left==1 and b.style.text_shadow.color[1]==1)
local base=ui.text({id='base',rect={x=0,y=0,width=10,height=5}})
local later=ui.text({id='later',rect={x=0,y=0,width=10,height=5}})
assert(base.style.padding.left==1 and base.style.color[1]==.1)
assert(base.style.color~=base.style.background and base.style.color==later.style.color)
assert(not pcall(function()base.style.color[1]=.6 end));assert(base.style.background[1]==.1 and later.style.color[1]==.1)
local plain=c.text({id='plain',rect=base.rect})
local empty=c.text({id='empty',rect=base.rect,style={}})
assert(plain.style==nil and type(empty.style)=='table' and next(empty.style)==nil)
local noBase={id='no-base',rect=base.rect,style={padding={left=1},color=shared,background=shared}}
local detached=c.text(noBase)
assert(detached.style~=noBase.style and detached.style.color~=shared and detached.style.color~=detached.style.background)
assert(not pcall(function()detached.style.color[1]=0 end));assert(detached.style.background[1]==.99 and shared[1]==.99)
api.observation.set('owned_style',true)
"#);
    assert_eq!(values["owned_style"],true);
}

#[test]
fn leaf_metatable_fallback_preserves_inherited_style_and_strips_copied_metatables() {
    let values=observed(r#"
local c=api.ui.components
local inherited={padding={left=2},color={1,.5,.25,1}}
local reads=0
local props=setmetatable({id='inherited',rect={x=0,y=0,width=10,height=5}},{__metatable='protected',__index=function(_,key)if key=='style' then reads+=1;return inherited end;return nil end})
local node=c.text(props)
assert(reads==3,'retain the existing inherited style read path')
assert(node.style.padding.left==2 and node.style.color[2]==.5 and node.style~=inherited)
inherited.color[2]=0;assert(node.style.color[2]==.5)
local padding=setmetatable({right=3},{__metatable='padding',__index={left=99}})
local shadow=setmetatable({offset_x=2,color={0,0,0,.5}},{__metatable='shadow',__index={offset_y=99}})
local authored=setmetatable({padding=padding,text_shadow=shadow,color={.2,.3,.4,1}},{__metatable='style',__index={opacity=.9}})
local ui=c.create({text={padding={left=1},text_shadow={offset_y=1,color={1,1,1,1}}}})
local fallback=ui.text({id='meta-style',rect=node.rect,style=authored})
assert(getmetatable(fallback.style)==nil and getmetatable(fallback.style.padding)==nil and getmetatable(fallback.style.text_shadow)==nil)
assert(fallback.style.padding.left==1 and fallback.style.padding.right==3 and fallback.style.opacity==nil)
assert(fallback.style.text_shadow.offset_x==2 and fallback.style.text_shadow.offset_y==nil)
local nested=ui.text({id='nested-meta',rect=node.rect,style={padding=padding,text_shadow=shadow}})
assert(nested.style.padding.left==1 and nested.style.padding.right==3 and nested.style.text_shadow.offset_y==nil)
assert(not pcall(function()nested.style.padding.right=8 end));assert(padding.right==3 and fallback.style.padding.right==3)
api.observation.set('metatable_style',true)
"#);
    assert_eq!(values["metatable_style"],true);
}

#[test]
fn managed_identity_probe_never_runs_authored_nested_index_callbacks() {
    let values=observed(r#"
local c=api.ui.components
local calls=0
local color=setmetatable({0,0,0,1},{__index=function(t,key)
 if key=='id' then calls+=1;rawset(t,1,t[1]+.1) end
 return nil
end})
local props={id='plain',rect={x=0,y=0,width=10,height=5},style={color=color}}
local a=c.text(props)
local b=c.text(props)
local composed=c.composeStyle({color=color})
assert(calls==0 and color[1]==0,'private ownership probes cannot call authored getters')
assert(a.style.color[1]==0 and b.style.color[1]==0 and composed.color[1]==0)
assert(getmetatable(a.style.color)==nil and a.style.color~=color and a.style.color~=b.style.color)
assert(not pcall(function()a.style.color[1]=.8 end));assert(b.style.color[1]==0 and color[1]==0)
api.observation.set('pure_identity_probe',true)
"#);
    assert_eq!(values["pure_identity_probe"],true);
}

#[test]
fn leaf_owned_style_retains_the_first_props_copy_work_depth_and_portability_bounds() {
    let values=observed(r#"
local c=api.ui.components
-- props, id, rect and four coordinates, style and color consume nine visits.
local wide=table.create(131063,true)
local props={id='wide',rect={x=0,y=0,width=1,height=1},style={color=wide}}
assert(#c.text(props).style.color==131063)
wide[131064]=true
local ok,message=pcall(c.text,props)
assert(not ok and string.find(tostring(message),'data exceeds copy limits',1,true),tostring(message))
local deep={};local current=deep
for _=1,62 do current[1]={};current=current[1] end
props.style={color=deep};assert(type(c.text(props).style.color)=='table')
current[1]=true;ok,message=pcall(c.text,props)
assert(not ok and string.find(tostring(message),'data exceeds copy limits',1,true),tostring(message))
for _,bad in ipairs({function()end,coroutine.create(function()end),buffer.create(16)})do
 props.style={color={bad}};ok,message=pcall(c.text,props)
 assert(not ok and string.find(tostring(message),'only portable',1,true),tostring(message))
end
api.observation.set('leaf_copy_bounds',true)
"#);
    assert_eq!(values["leaf_copy_bounds"],true);
}

#[test]
fn copied_child_grants_preserve_expanded_bounds_and_mutable_metadata() {
    let values=observed(r#"
local c=api.ui.components
local info=c.info()
local changed=false
local function mutate(value)
 for _,child in pairs(value) do if type(child)=='table' then mutate(child) end end
 assert(not table.isfrozen(value),'metadata remains a mutable detached copy')
 value.__probe=true;changed=true
end
mutate(info)
assert(changed and c.info().__probe==nil)
local owned=c.composeStyle({color=table.create(65536,true)})
assert(table.isfrozen(owned.color))
local ok,message=pcall(function()c.composeStyle({color={owned.color,owned.color}})end)
assert(not ok and string.find(tostring(message),'data exceeds copy limits',1,true),tostring(message))
local deep={};local cursor=deep
for _=1,63 do cursor[1]={};cursor=cursor[1] end
local tall=c.composeStyle({color=deep})
assert(c.composeStyle(tall).color==tall.color)
ok,message=pcall(function()c.composeStyle({color={tall.color}})end)
assert(not ok and string.find(tostring(message),'data exceeds copy limits',1,true),tostring(message))
local handle=c.virtualList({id='live',viewport={left=10,top=10,width=40,height=20},
 items={{id='a'}},key='id',rowHeight=10,renderItem=function(item)
  return {c.text({id=item.id,text=item.id,rect={x=0,y=0,width=20,height=8}})}
 end})
local authored={handle}
local card=c.component({id='card',component='test.card',rect={x=0,y=0,width=100,height=100},
 surface={kind='panel'},children=authored})
assert(card.children[2]==handle and not table.isfrozen(handle))
assert(#authored==1 and not table.isfrozen(authored))
assert(table.isfrozen(card) and table.isfrozen(card.children))
local outer=c.component({id='outer',component='test.outer',rect={x=0,y=0,width=100,height=100},children={card}})
assert(outer.children[1]~=card and outer.children[1].children[2]==handle)
api.ui.setRoot(c.screen({id='screen',node='test',children={outer}}))
api.observation.set('copied_child_grants',true)
"#);
    assert_eq!(values["copied_child_grants"],true);
}

#[test]
fn immutable_package_matches_0_5_canonical_worlds_across_changed_views() {
    let current=include_str!("../../../packages/unone-ui/src/components.luau");
    // Frozen historical 0.5 source, not a second implementation of the new
    // ownership algorithm. The same authored changing View runs in both VMs.
    let previous=include_str!("fixtures/ui-components-0.5.0.luau");
    let make=|package:&str| {
        let mut script=String::from("local helpers=(function(...)\n");
        script.push_str(include_str!("../src/runtime/bindings/scroll.luau"));
        script.push_str("\nend)(function()end,function(callback)return callback()end)\nlocal components=(function(...)\n");
        script.push_str(package);
        script.push_str(r#"
end)({name='@unone/ui',version='0.6.0'},true,helpers.isManagedNode,helpers)
local ui
local frame=0
local function view()
 local children={}
 for row=0,7 do
  local leaves={}
  for column=0,11 do
   local n=row*12+column
   local style=nil
   if n%3==0 then style={} elseif n%3==1 then style={padding={right=.2},color={.2+(frame%2)*.1,.6,.9,1},text_shadow={offset_x=.1,offset_y=.2,color={0,0,0,.4}}} end
   table.insert(leaves,ui.text({id='t'..n,text='Frame '..frame,rect={x=column*8,y=row*10,width=7,height=6},style=style}))
  end
  table.insert(children,ui.component({id='row'..row,component='qa.row',rect={x=0,y=0,width=100,height=100},surface={kind='panel',style={opacity=.5}},children=leaves}))
 end
 return ui.screen({id='root',node='qa.styles',children=children})
end
return {start=function(api)
 ui=components.create({text={font_size=1.4,color={1,1,1,1},padding={left=.1,right=.1},text_shadow={offset_x=.1,offset_y=.2,color={0,0,0,.5}}},panel={background={.1,.2,.3,.2}}})
 api.ui.setRoot(view())
end,update=function(api)frame+=1;api.ui.setRoot(view())end}
"#);
        load_script(&script,true).unwrap()
    };
    let mut before=make(previous);let mut after=make(current);
    assert_eq!(serde_json::to_vec(&before.observe()).unwrap(),serde_json::to_vec(&after.observe()).unwrap());
    for _ in 0..120 {
        let a=before.tick().unwrap();let b=after.tick().unwrap();
        assert_eq!(serde_json::to_vec(&a).unwrap(),serde_json::to_vec(&b).unwrap());
        assert_eq!(unone_engine::observation_digest(&a).unwrap(),unone_engine::observation_digest(&b).unwrap());
    }
    #[cfg(all(feature="sampling-profile",not(feature="phase-profile")))]
    {
        for runtime in [&mut before,&mut after] {
            let started=runtime.preview_request(unone_engine::PreviewRequest::ProfileStart {sampling:false}).unwrap();
            assert_eq!(started["execution"]["bytecode_optimization_level"],2);
            assert_eq!(started["execution"]["sampling_profile"],true);
        }
        for _ in 0..10 {
            let a=before.tick().unwrap();let b=after.tick().unwrap();
            assert_eq!(serde_json::to_vec(&a).unwrap(),serde_json::to_vec(&b).unwrap());
        }
        let a=before.preview_request(unone_engine::PreviewRequest::ProfileStop {}).unwrap();
        let b=after.preview_request(unone_engine::PreviewRequest::ProfileStop {}).unwrap();
        assert_eq!(a["window"]["vm"]["tick_count"],10);
        assert_eq!(b["window"]["vm"]["tick_count"],10);
        // Optional local evidence, never an allocation/time pass threshold.
        // Both sides use opt2, VM allocation/GC probes and sampling=false.
        if let Some(path)=std::env::var_os("UNONE_UI_IMMUTABLE_ALLOCATION_OUTPUT") {
            let value=json!({"scope":"Synthetic historical0.5 versus immutable0.6 package pair; Luau update allocation-growth/GC diagnostics, not CPU milliseconds, production FPS or total allocator traffic", "warmup_ticks":120,"measured_ticks":10,"leaves_per_view":96,"canonical_worlds_equal":true,"sampling":false,"execution":b["execution"],"before":a["window"]["vm"],"after":b["window"]["vm"]});
            let path=std::path::PathBuf::from(path);
            if let Some(parent)=path.parent(){std::fs::create_dir_all(parent).unwrap();}
            std::fs::write(path,serde_json::to_vec_pretty(&value).unwrap()).unwrap();
        }
    }
}

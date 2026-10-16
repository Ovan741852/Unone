#![cfg(feature = "ui")]

use serde_json::{json, Value};
use unone_engine::{Diagnostic, EngineRuntime, ProjectConfig, SourceProject};

fn load(body: &str, declared: bool) -> Result<EngineRuntime, Box<Diagnostic>> {
    let mut config =
        json!({"name":"responsive-layout","entry_script":"main.luau","systems":{"ui":true}});
    if declared {
        let manifest: Value = serde_json::from_str(include_str!(
            "../../../packages/unone-ui/package.unone.json"
        ))
        .unwrap();
        config["runtime_packages"] = json!({"@unone/ui":manifest["version"]});
    }
    EngineRuntime::load_source_project(SourceProject {
        config: serde_json::from_value::<ProjectConfig>(config).unwrap(),
        source: format!("return {{start=function(api)\n{body}\nend,update=function()end}}"),
        ..SourceProject::default()
    })
}

#[test]
fn threshold_selection_is_inclusive_and_shared_by_direct_and_themed_kits() {
    let runtime = load(
        r#"
local options={variants={
    {name='portrait',minAspect=0,layout={id='main',kind='slot'},values={fontSize=2}},
    {name='medium',minAspect=1,layout={id='main',kind='slot'},values={fontSize=3}},
    {name='wide',minAspect=1.6,layout={id='main',kind='slot'},values={fontSize=4}},
}}
for _,ui in ipairs({api.ui.components,api.ui.components.create({text={font_size=1}})}) do
    local model=ui.createResponsiveLayout(options)
    assert(model.resolve({aspect=0.0001}).variant=='portrait')
    assert(model.resolve({aspect=0.999999}).variant=='portrait')
    assert(model.resolve({aspect=1}).variant=='medium')
    assert(model.resolve({aspect=1.599999}).values.fontSize==3)
    assert(model.resolve({aspect=1.6}).variant=='wide')
    assert(model.resolve({aspect=9999}).values.fontSize==4)
    local rect=model.resolve(api.ui.getViewport()).rect('main')
    assert(rect.x==0 and rect.y==0 and rect.width==100 and rect.height==100)
end
api.observation.set('entrypoints',2)
"#,
        true,
    )
    .unwrap();
    assert_eq!(runtime.semantic_observations()["entrypoints"], 2);
}

#[test]
fn variant_values_are_required_but_false_zero_and_strings_are_valid() {
    load(r#"
local ui=api.ui.components
local function plan(value)
    return ui.createResponsiveLayout({variants={{name='base',minAspect=0,layout={id='root',kind='slot'},values=value}}})
end
local ok,message=pcall(function()plan(nil)end)
assert(not ok and string.find(tostring(message),'UI_LAYOUT_VALUES',1,true),tostring(message))
assert(string.find(tostring(message),'values={}',1,true),tostring(message))
assert(plan(false).resolve({aspect=1}).values==false)
assert(plan(0).resolve({aspect=1}).values==0)
assert(plan('compact').resolve({aspect=1}).values=='compact')
assert(type(plan({}).resolve({aspect=1}).values)=='table')
"#, true).unwrap();
}

#[test]
fn nested_fixed_and_weighted_stacks_resolve_in_top_left_geometry() {
    load(r#"
local model=api.ui.components.createResponsiveLayout({variants={{name='base',minAspect=0,values=false,
    layout={id='root',kind='column',padding={left=2,right=3,top=4,bottom=5},gap=3,children={
        {id='header',kind='slot',size=10},
        {id='content',kind='row',grow=1,gap=2,children={
            {id='left',kind='slot',size=20},
            {id='middle',kind='slot'},
            {id='right',kind='slot',grow=2},
        }},
        {id='footer',kind='slot',size=5},
    }}
}}})
local r=model.resolve({aspect=1},{left=10,top=10,width=80,height=80})
local header=r.viewport('header')
assert(header.left==12 and header.top==14 and header.width==75 and header.height==10)
local content=r.viewport('content')
assert(content.left==12 and content.top==27 and content.width==75 and content.height==50)
local a,b,c=r.viewport('left'),r.viewport('middle'),r.viewport('right')
assert(a.width==20 and a.height==50 and a.left==12 and a.top==27)
assert(b.width==17 and b.left==34 and c.width==34 and c.left==53)
local footer=r.rect('footer')
assert(footer.x==12 and footer.y==15 and footer.width==75 and footer.height==5)
local outer=r.rect('root')
assert(outer.x==10 and outer.y==10 and outer.width==80 and outer.height==80)
assert(r.values==false)
local fixed=api.ui.components.createResponsiveLayout({variants={{name='base',minAspect=0,values={},
    layout={id='r',kind='row',gap=1,children={{id='a',kind='slot',size=10},{id='b',kind='slot',size=20}}}}}})
assert(fixed.resolve({aspect=1}).viewport('b').left==11)
"#, true).unwrap();
}

#[test]
fn grids_keep_declared_columns_and_reserve_short_last_row_cells() {
    load(
        r#"
local ui=api.ui.components
local m=ui.createResponsiveLayout({variants={{name='base',minAspect=0,values={},
    layout={id='grid',kind='grid',columns=3,gap=2,padding={left=2,right=2,top=3,bottom=3},children={
        {id='a',kind='slot'},{id='b',kind='slot'},{id='c',kind='slot'},{id='d',kind='slot'},
    }}
}}})
local r=m.resolve({aspect=1},{left=0,top=0,width=100,height=80})
local a,b,c,d=r.viewport('a'),r.viewport('b'),r.viewport('c'),r.viewport('d')
assert(math.abs(a.width-92/3)<1e-9 and a.height==36)
assert(a.left==2 and a.top==3 and b.top==3 and c.top==3)
assert(math.abs(b.left-(4+92/3))<1e-9 and math.abs(c.left-(6+184/3))<1e-9)
assert(d.left==2 and d.top==41 and d.width==a.width and d.height==36)
local short=ui.createResponsiveLayout({variants={{name='base',minAspect=0,values={},
    layout={id='g',kind='grid',columns=4,children={{id='only',kind='slot'}}}}}})
local cell=short.resolve({aspect=1}).viewport('only')
assert(cell.width==25 and cell.height==100)
"#,
        true,
    )
    .unwrap();
}

#[test]
fn authored_options_values_and_resolved_regions_are_defensive_snapshots() {
    load(
        r#"
local options={space='stage',variants={{name='base',minAspect=0,
    layout={id='root',kind='column',padding={top=4},children={{id='child',kind='slot'}}},
    values={label='Original',tokens={fontSize=2},array={3,4},flag=true},
}}}
local m=api.ui.components.createResponsiveLayout(options)
options.space='scroll';options.variants[1].name='mutated';options.variants[1].minAspect=99
options.variants[1].layout.children[1].id='lost';options.variants[1].layout.padding.top=50
options.variants[1].values.tokens.fontSize=99
local a=m.resolve({aspect=1})
assert(a.variant=='base' and a.values.tokens.fontSize==2 and a.values.array[2]==4)
local rect,viewport=a.rect('child'),a.viewport('child')
assert(rect.y==0 and rect.height==96 and viewport.top==4)
rect.x=80;viewport.top=50;a.values.tokens.fontSize=9
assert(a.rect('child').x==0 and a.viewport('child').top==4)
assert(m.resolve({aspect=1}).values.tokens.fontSize==2)
local b=m.resolve({aspect=1},{left=1,top=2,width=40,height=50})
assert(b.viewport('child').top==6 and b.rect('child').y==48)
assert(a.viewport('child').top==4)
local ok,message=pcall(function()a.rect('missing')end)
assert(not ok and string.find(tostring(message),'UI_LAYOUT_ID',1,true))
"#,
        true,
    )
    .unwrap();
}

#[test]
fn stage_and_scroll_spaces_are_explicit_and_share_existing_coordinate_units() {
    load(r#"
local ui=api.ui.components
local variants={{name='base',minAspect=0,values={},layout={id='root',kind='column',gap=2,children={
    {id='a',kind='slot',size=10},{id='b',kind='slot'},
}}}}
local stage=ui.createResponsiveLayout({variants=variants}).resolve({aspect=2},{left=5,top=10,width=80,height=70})
local scroll=ui.createResponsiveLayout({space='scroll',variants=variants}).resolve({aspect=2},{left=5,top=110,width=80,height=170})
assert(stage.rect('a').y==80 and stage.viewport('a').top==10)
assert(stage.rect('b').y==20 and stage.rect('b').height==58)
assert(scroll.rect('a').y==110 and scroll.rect('a').height==10)
assert(scroll.viewport('b').top==122 and scroll.rect('b').y==122 and scroll.rect('b').height==158)
assert(stage.rect('a').width==scroll.rect('a').width)
"#, true).unwrap();
}

#[test]
fn variant_viewport_bounds_and_unknown_property_misuse_are_actionable() {
    let runtime = load(r#"
local ui=api.ui.components
local base={name='base',minAspect=0,values={},layout={id='root',kind='slot'}}
local function make(options)return function()ui.createResponsiveLayout(options)end end
local model=ui.createResponsiveLayout({variants={base}})
local cases={
    {make({variants={}}),'UI_LAYOUT_ARRAY'},
    {make({variants={[2]=base}}),'UI_LAYOUT_ARRAY'},
    {make({variants={base,extra=base}}),'UI_LAYOUT_ARRAY'},
    {make({variants={base},breakpoints={}}),'UI_LAYOUT_PROP'},
    {make({space='pixels',variants={base}}),'UI_LAYOUT_SPACE'},
    {make({variants={{name='base',minAspect=1,values={},layout=base.layout}}}),'first exactly 0'},
    {make({variants={base,{name='second',minAspect=0,values={},layout=base.layout}}}),'strictly ascending'},
    {make({variants={base,{name='second',minAspect=-1,values={},layout=base.layout}}}),'UI_LAYOUT_VARIANT'},
    {make({variants={base,{name='second',minAspect=math.huge,values={},layout=base.layout}}}),'UI_LAYOUT_NUMBER'},
    {make({variants={base,{name='second',minAspect=0/0,values={},layout=base.layout}}}),'UI_LAYOUT_NUMBER'},
    {make({variants={base,{name='base',minAspect=1,values={},layout=base.layout}}}),'UI_LAYOUT_VARIANT'},
    {make({variants={{name=' ',minAspect=0,values={},layout=base.layout}}}),'UI_LAYOUT_ID'},
    {make({variants={{name='base',minAspect=0,values={},layout=base.layout,fontSize=2}}}),'UI_LAYOUT_PROP'},
    {function()model.resolve({aspect=0})end,'UI_LAYOUT_VIEWPORT'},
    {function()model.resolve({aspect=math.huge})end,'UI_LAYOUT_NUMBER'},
    {function()model.resolve({aspect=0/0})end,'UI_LAYOUT_NUMBER'},
    {function()model.resolve({aspect=1,width=100})end,'UI_LAYOUT_PROP'},
    {function()model.resolve({aspect=1},{left=0,top=0,width=0,height=1})end,'UI_LAYOUT_BOUNDS'},
    {function()model.resolve({aspect=1},{left=-1,top=0,width=1,height=1})end,'UI_LAYOUT_BOUNDS'},
    {function()model.resolve({aspect=1},{left=1,top=0,width=100,height=1})end,'UI_LAYOUT_BOUNDS'},
    {function()model.resolve({aspect=1},{left=0,top=99,width=1,height=2})end,'UI_LAYOUT_BOUNDS'},
    {function()model.resolve({aspect=1},{left=0,top=0,width=1,height=math.huge})end,'UI_LAYOUT_NUMBER'},
    {function()model.resolve({aspect=1},{left=0,top=0,width=1,height=1,x=0})end,'UI_LAYOUT_PROP'},
    {function()ui.panel({id='x',layout={}})end,'createResponsiveLayout'},
}
local scroll=ui.createResponsiveLayout({space='scroll',variants={base}})
table.insert(cases,{function()scroll.resolve({aspect=1},{left=1e308,top=0,width=1e308,height=1})end,'UI_LAYOUT_NUMBER'})
for _,case in ipairs(cases) do
    local ok,message=pcall(case[1])
    assert(not ok and string.find(tostring(message),case[2],1,true),tostring(message))
end
api.observation.set('cases',#cases)
"#, true).unwrap();
    assert_eq!(runtime.semantic_observations()["cases"], 25);
}

#[test]
fn layout_node_misuse_overflow_and_arithmetic_fail_with_layout_diagnostics() {
    let runtime = load(r#"
local ui=api.ui.components
local function plan(node)return ui.createResponsiveLayout({variants={{name='base',minAspect=0,values={},layout=node}}})end
local function reject(node)return function()plan(node)end end
local function overflow(node)return function()plan(node).resolve({aspect=1})end end
local slot={id='child',kind='slot'}
local cases={
    {reject({id='root',kind='slot',children={}}),'UI_LAYOUT_SLOT'},
    {reject({id='root',kind='slot',padding={}}),'UI_LAYOUT_SLOT'},
    {reject({id='root',kind='slot',gap=0}),'UI_LAYOUT_SLOT'},
    {reject({id='root',kind='slot',columns=1}),'UI_LAYOUT_SLOT'},
    {reject({id='root',kind='flex'}),'UI_LAYOUT_KIND'},
    {reject({id=' ',kind='slot'}),'UI_LAYOUT_ID'},
    {reject({id='root',kind='row',children={}}),'UI_LAYOUT_ARRAY'},
    {reject({id='root',kind='column',children={slot},columns=1}),'UI_LAYOUT_COLUMNS'},
    {reject({id='root',kind='grid',children={slot}}),'UI_LAYOUT_NUMBER'},
    {reject({id='root',kind='grid',columns=0,children={slot}}),'UI_LAYOUT_COLUMNS'},
    {reject({id='root',kind='grid',columns=1.5,children={slot}}),'UI_LAYOUT_COLUMNS'},
    {reject({id='root',kind='grid',columns=257,children={slot}}),'UI_LAYOUT_COLUMNS'},
    {reject({id='root',kind='row',gap=-1,children={slot}}),'UI_LAYOUT_GAP'},
    {reject({id='root',kind='row',gap=math.huge,children={slot}}),'UI_LAYOUT_NUMBER'},
    {reject({id='root',kind='row',padding={left=-1},children={slot}}),'UI_LAYOUT_PADDING'},
    {reject({id='root',kind='row',padding={x=2},children={slot}}),'UI_LAYOUT_PROP'},
    {reject({id='root',kind='row',size=1,children={slot}}),'UI_LAYOUT_FLEX'},
    {reject({id='root',kind='slot',grow=1}),'UI_LAYOUT_FLEX'},
    {reject({id='root',kind='row',children={{id='a',kind='slot',size=1,grow=1}}}),'UI_LAYOUT_FLEX'},
    {reject({id='root',kind='row',children={{id='a',kind='slot',size=0}}}),'UI_LAYOUT_FLEX'},
    {reject({id='root',kind='row',children={{id='a',kind='slot',grow=-1}}}),'UI_LAYOUT_FLEX'},
    {reject({id='root',kind='grid',columns=1,children={{id='a',kind='slot',size=1}}}),'UI_LAYOUT_FLEX'},
    {reject({id='root',kind='grid',columns=1,children={{id='a',kind='slot',grow=1}}}),'UI_LAYOUT_FLEX'},
    {reject({id='root',kind='slot',font_size=2}),'UI_LAYOUT_PROP'},
    {overflow({id='root',kind='row',padding={left=60,right=40},children={slot}}),'UI_LAYOUT_OVERFLOW'},
    {overflow({id='root',kind='row',gap=101,children={slot,{id='other',kind='slot'}}}),'UI_LAYOUT_OVERFLOW'},
    {overflow({id='root',kind='row',children={{id='a',kind='slot',size=100},slot}}),'UI_LAYOUT_OVERFLOW'},
    {overflow({id='root',kind='column',children={{id='a',kind='slot',size=101}}}),'UI_LAYOUT_OVERFLOW'},
    {overflow({id='root',kind='grid',columns=3,gap=50,children={slot}}),'UI_LAYOUT_OVERFLOW'},
    {overflow({id='root',kind='grid',columns=1,gap=100,children={slot,{id='b',kind='slot'}}}),'UI_LAYOUT_OVERFLOW'},
    {overflow({id='root',kind='row',children={{id='a',kind='slot',size=1e308},{id='b',kind='slot',size=1e308}}}),'UI_LAYOUT_NUMBER'},
    {overflow({id='root',kind='column',children={{id='a',kind='slot',grow=1e308},{id='b',kind='slot',grow=1e308}}}),'UI_LAYOUT_NUMBER'},
}
for _,case in ipairs(cases) do
    local ok,message=pcall(case[1])
    assert(not ok and string.find(tostring(message),case[2],1,true),tostring(message))
end
local ok,message=pcall(function()
    plan({id='r',kind='row',children={{id='a',kind='slot',grow=1e308},{id='b',kind='slot',grow=1}}}).resolve({aspect=1})
end)
assert(not ok and string.find(tostring(message),'UI_LAYOUT_OVERFLOW',1,true),tostring(message))
api.observation.set('cases',#cases)
"#, true).unwrap();
    assert_eq!(runtime.semantic_observations()["cases"], 32);
}

#[test]
fn plans_and_values_reject_cycles_duplicate_ids_and_bounded_excess() {
    load(r#"
local ui=api.ui.components
local function plan(node,values)return ui.createResponsiveLayout({variants={{name='base',minAspect=0,layout=node,values=if values==nil then {} else values}}})end
local function fails(callback,code)
    local ok,message=pcall(callback)
    assert(not ok and string.find(tostring(message),code,1,true),tostring(message))
end
fails(function()plan({id='r',kind='row',children={{id='dup',kind='slot'},{id='dup',kind='slot'}}})end,'UI_LAYOUT_DUPLICATE_ID')
local cycle={id='cycle',kind='column',children={}}
cycle.children[1]=cycle
fails(function()plan(cycle)end,'UI_LAYOUT_CYCLE')
local chain={id='leaf',kind='slot'}
for n=1,31 do chain={id='level'..n,kind='row',children={chain}} end
assert(plan(chain).resolve({aspect=1}).rect('leaf').width==100)
fails(function()plan({id='deep',kind='row',children={chain}})end,'UI_LAYOUT_LIMIT')
local children={}
for n=1,4096 do children[n]={id='child'..n,kind='slot'} end
fails(function()plan({id='root',kind='row',children=children})end,'UI_LAYOUT_LIMIT')
local data={};data.self=data
fails(function()plan({id='r',kind='slot'},data)end,'UI_LAYOUT_COPY')
fails(function()plan({id='r',kind='slot'},{callback=function()end})end,'UI_LAYOUT_COPY')
fails(function()plan({id='r',kind='slot'},{number=math.huge})end,'UI_LAYOUT_NUMBER')
fails(function()plan({id='r',kind='slot'},setmetatable({},{__index={}}))end,'UI_LAYOUT_COPY')
local deep={};local head=deep
for _=1,33 do head.child={};head=head.child end
fails(function()plan({id='r',kind='slot'},deep)end,'UI_LAYOUT_COPY')
-- The same node IDs are intentionally valid across variants.
ui.createResponsiveLayout({variants={
    {name='one',minAspect=0,values={},layout={id='root',kind='slot'}},
    {name='two',minAspect=1,values={},layout={id='root',kind='slot'}},
}})
"#, true).unwrap();
}

#[test]
fn resolved_regions_publish_through_existing_components_scroll_and_slider() {
    let runtime = load(r#"
local ui=api.ui.components.create({text={font_size=1},slider={font_size=1}})
local layout=ui.createResponsiveLayout({variants={{name='base',minAspect=0,values={label='Gain'},layout={
    id='root',kind='column',padding={left=5,top=5,right=5,bottom=5},gap=5,children={
        {id='label',kind='slot',size=10},{id='slider',kind='slot',size=10},{id='list',kind='slot'},
    }
}}}})
local resolved=layout.resolve(api.ui.getViewport())
local slider=ui.createSlider({id='gain',value=0.5})
local scrollLayout=ui.createResponsiveLayout({space='scroll',variants={{name='base',minAspect=0,values={},layout={
    id='content',kind='column',gap=1,children={{id='first',kind='slot',size=8},{id='second',kind='slot',size=8}}
}}}})
local localRows=scrollLayout.resolve(api.ui.getViewport(),{left=0,top=0,width=90,height=60})
api.ui.setRoot(ui.screen({id='settings',node='controls',children={
    ui.text({id='title',text=resolved.values.label,rect=resolved.rect('label')}),
    slider.view({rect=resolved.rect('slider')}),
    ui.scrollView({id='scroll',viewport=resolved.viewport('list'),content={
        ui.text({id='first',text='One',rect=localRows.rect('first')}),
        ui.text({id='second',text='Two',rect=localRows.rect('second')}),
    }}),
}}))
assert(slider.getValue()==0.5 and not slider.update(api.input).dragging)
api.observation.set('resolved',{variant=resolved.variant,slider=resolved.rect('slider'),list=resolved.viewport('list')})
"#, true).unwrap();
    let observations = runtime.semantic_observations();
    assert_eq!(observations["resolved"]["variant"], "base");
    assert_eq!(observations["resolved"]["slider"]["y"], 70);
    assert_eq!(observations["resolved"]["list"]["top"], 35);
}

#[test]
fn fractional_layouts_conserve_strict_stage_edges_when_published() {
    load(r#"
local ui=api.ui.components
local function publish(kind,count,columns)
    local children={}
    for index=1,count do children[index]={id='leaf'..index,kind='slot'} end
    local node={id='root',kind=kind,children=children,columns=columns}
    local model=ui.createResponsiveLayout({variants={{name='base',minAspect=0,values={},layout=node}}})
    local resolved=model.resolve({aspect=1})
    local leaves={}
    for index=1,count do
        local rect=resolved.rect('leaf'..index)
        assert(rect.x>=0 and rect.y>=0 and rect.x+rect.width<=100 and rect.y+rect.height<=100)
        leaves[index]=ui.panel({id='leaf'..index,rect=rect})
    end
    api.ui.setRoot(ui.screen({id='screen',node='fractions',children=leaves}))
end
publish('column',3,nil)
publish('row',6,nil)
publish('grid',49,7)
publish('row',97,nil)
publish('column',71,nil)
local decimals=ui.createResponsiveLayout({variants={{name='base',minAspect=0,values={},layout={id='root',kind='row',children={
    {id='a',kind='slot',size=0.1},{id='b',kind='slot',size=0.2},
}}}}})
local r=decimals.resolve({aspect=1},{left=0,top=0,width=0.3,height=1})
assert(r.rect('b').x+r.rect('b').width<=0.3)
api.ui.setRoot(ui.screen({id='decimal',node='fractions',children={
    ui.panel({id='a',rect=r.rect('a')}),ui.panel({id='b',rect=r.rect('b')}),
}}))
local overflow=ui.createResponsiveLayout({variants={{name='base',minAspect=0,values={},layout={id='root',kind='row',children={
    {id='a',kind='slot',size=0.1},{id='b',kind='slot',size=0.200001},
}}}}})
local ok,message=pcall(function()overflow.resolve({aspect=1},{left=0,top=0,width=0.3,height=1})end)
assert(not ok and string.find(tostring(message),'UI_LAYOUT_OVERFLOW',1,true),tostring(message))
"#, true).unwrap();
}

#[test]
fn tiny_axis_overflow_is_not_hidden_by_origin_or_cross_axis_roundoff() {
    load(r#"
local ui=api.ui.components
for _,kind in ipairs({'row','column'}) do
    local model=ui.createResponsiveLayout({space='scroll',variants={{name='base',minAspect=0,values={},layout={
        id='root',kind=kind,children={{id='a',kind='slot',size=6e-19},{id='b',kind='slot',size=6e-19}},
    }}}})
    for _,cross in ipairs({1,1e100}) do
        local bounds={left=0,top=0,width=if kind=='row' then 1e-18 else cross,
            height=if kind=='column' then 1e-18 else cross}
        local ok,message=pcall(function()model.resolve({aspect=1},bounds)end)
        assert(not ok and string.find(tostring(message),'UI_LAYOUT_OVERFLOW',1,true),tostring(message))
    end
end
"#, true).unwrap();
}

#[test]
fn undeclared_projects_cannot_construct_responsive_layouts() {
    load(
        r#"
local ok,message=pcall(function()api.ui.components.createResponsiveLayout({variants={}})end)
assert(not ok and string.find(tostring(message),'UI_PACKAGE_NOT_DECLARED',1,true))
"#,
        false,
    )
    .unwrap();
}

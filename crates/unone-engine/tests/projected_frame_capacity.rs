use unone_engine::{EngineRuntime,ProjectedFrame,ProjectedFrameDraw,ProjectedFrameMaterial,FrameInitial,FrameClipPolicy};
use serde_json::json;

const DRAW:&str=r#"
local v=buffer.create(120)
for i=0,2 do for j,x in {0,0,.5,1,0,0,1,1,1,1} do buffer.writef32(v,i*40+(j-1)*4,x)end end
local ix=buffer.create(12);buffer.writeu32(ix,4,1);buffer.writeu32(ix,8,2)
local m={rgb='texture_times_vertex',texture_alpha='sampled',alpha='texture',
alpha_test={enabled=false,compare='always',reference=0},
blend={enabled=false,operation='add',source='source_alpha',destination='one_minus_source_alpha'},
depth={test=true,write=true,compare='less_equal'},sampler={min='nearest',mag='nearest',address_u='clamp',address_v='clamp'}}
local d={id='first',texture='texture://test',vertices=v,indices=ix,clip_policy='clip',material=m}
local f={profile='rgb8_encoded_gouraud_v1',initial={rgb8={0,0,0},depth=1},draws={d}}
"#;

#[test]
fn runtime_keeps_all_256_257_and_1024_draws_in_order() {
    for count in [256,257,1024] {
        let body=format!("{DRAW}\nreturn {{start=function(api) f.draws={{}};for i=1,{count} do local a=table.clone(d);a.id=tostring(i);f.draws[i]=a end;api.projected.setFrame(f) end,update=function()end}}");
        let r=EngineRuntime::load_source("capacity","main.luau",&body,None).unwrap();
        let j=serde_json::to_value(r.observe()).unwrap();let draws=j["projected_frame"]["draws"].as_array().unwrap();
        assert_eq!(draws.len(),count);assert_eq!(draws[0]["id"],"1");assert_eq!(draws[count-1]["id"],count.to_string());
    }
}

#[test]
fn runtime_rejects_1025_atomically() {
    let body=format!("{DRAW}\nreturn {{start=function(api) api.projected.setFrame(f);local ds={{}};for i=1,1025 do local a=table.clone(d);a.id=tostring(i);ds[i]=a end;f.draws=ds;assert(not pcall(api.projected.setFrame,f)) end,update=function()end}}");
    let r=EngineRuntime::load_source("capacity","main.luau",&body,None).unwrap();let j=serde_json::to_value(r.observe()).unwrap();
    assert_eq!(j["projected_frame"]["revision"],1);assert_eq!(j["projected_frame"]["draws"].as_array().unwrap().len(),1);
}

fn material()->ProjectedFrameMaterial {
    serde_json::from_value(json!({"rgb":"texture_times_vertex","texture_alpha":"sampled","alpha":"texture",
        "alpha_test":{"enabled":false,"compare":"always","reference":0},
        "blend":{"enabled":false,"operation":"add","source":"source_alpha","destination":"one_minus_source_alpha"},
        "depth":{"test":true,"write":true,"compare":"less_equal"},
        "sampler":{"min":"nearest","mag":"nearest","address_u":"clamp","address_v":"clamp"}})).unwrap()
}

fn draw(vertex_count:usize,index_count:usize)->ProjectedFrameDraw {
    let mut v=Vec::with_capacity(vertex_count*40);
    for _ in 0..vertex_count {for x in [0f32,0.,0.5,1.,0.,0.,1.,1.,1.,1.] {v.extend(x.to_le_bytes());}}
    let mut ix=Vec::with_capacity(index_count*4);
    for n in 0..index_count {ix.extend(((n%3)as u32).to_le_bytes());}
    ProjectedFrameDraw::new("first".into(),"texture://test".into(),FrameClipPolicy::Clip,material(),None,v,ix).unwrap()
}

fn copies(d:&ProjectedFrameDraw,count:usize)->Vec<ProjectedFrameDraw> {
    (0..count).map(|i|{let mut a=d.clone();a.id=i.to_string();a}).collect()
}

#[test]
fn constructor_keeps_global_vertex_and_index_budgets() {
    let initial=FrameInitial{rgb8:[0,0,0],depth:1.};
    for d in [draw(262144,3),draw(3,1572864)] {
        assert!(ProjectedFrame::new(initial.clone(),copies(&d,4)).is_ok());
        let error=ProjectedFrame::new(initial.clone(),copies(&d,5)).unwrap_err();
        assert!(error.contains("world geometry budget"),"{error}");
    }
    let d=draw(3,3);
    assert!(ProjectedFrame::new(initial.clone(),copies(&d,1024)).is_ok());
    assert!(ProjectedFrame::new(initial,copies(&d,1025)).is_err());
}

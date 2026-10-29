use unone_engine::EngineRuntime;
use serde_json::{Value,json};

const FIXTURE:&str=r#"
local v=buffer.create(120)
for i=0,2 do
 local values={if i==0 then -0.5 else 0.5,if i==2 then 0.5 else -0.5,0.25,1,0,0,1,1,1,0.5}
 for j,x in values do buffer.writef32(v,i*40+(j-1)*4,x) end
end
local ix=buffer.create(12);buffer.writeu32(ix,4,1);buffer.writeu32(ix,8,2)
local m={rgb='texture_times_vertex',texture_alpha='sampled',alpha='texture',
 alpha_test={enabled=true,compare='greater',reference=127/255},
 blend={enabled=true,operation='add',source='source_alpha',destination='one_minus_source_alpha'},
 depth={test=true,write=false,compare='less_equal'},
 sampler={min='nearest',mag='linear',address_u='repeat',address_v='clamp'}}
local d={id='first',texture='texture://test',vertices=v,indices=ix,clip_policy='clip',material=m}
local f={profile='rgb8_encoded_rebuild_v1',initial={rgb8={17,24,39},depth=1},draws={d}}
"#;

fn load(body:&str)->EngineRuntime {
    EngineRuntime::load_source("frame-test","main.luau",&format!("{FIXTURE}\n{body}"),None).unwrap()
}
fn snapshot(r:&EngineRuntime)->Value {serde_json::to_value(r.observe()).unwrap()}

#[test]
fn ordered_frame_is_detached_atomic_and_same_canonical_payload_is_noop() {
    let mut r=load(r#"local turn=0
return {start=function(api)
 api.projected.setWorldVisible(false);api.projected.setFrame(f)
 buffer.writef32(v,0,0/0)
 assert(not pcall(api.projected.setFrame,f))
 buffer.writef32(v,0,-0.5)
end,update=function(api)
 turn+=1
 if turn==2 then f.initial.depth=0.5 elseif turn==3 then f.draws={} end
 api.projected.setFrame(f)
end}"#);
    let a=snapshot(&r);let f=&a["projected_frame"];
    assert_eq!(f["draws"][0]["id"],"first");assert_eq!(f["revision"],1);
    assert_eq!(f["initial"]["rgb8"],json!([17,24,39]));
    assert_eq!(f["draws"][0]["material"]["alpha_test"]["reference"].as_f64().unwrap() as f32,127f32/255f32);
    r.tick().unwrap();assert_eq!(snapshot(&r)["projected_frame"],*f);
    r.tick().unwrap();assert_eq!(snapshot(&r)["projected_frame"]["revision"],2);
    r.tick().unwrap();assert_eq!(snapshot(&r)["projected_frame"]["draws"],json!([]));
    assert_eq!(snapshot(&r)["projected_frame"]["revision"],3);
}

#[test]
fn all_material_compares_alpha_sources_and_independent_axes_survive() {
    let r=load(r#"return {start=function(api)
 local ds={}
 for i,c in {'never','less','equal','less_equal','greater','not_equal','greater_equal','always'} do
  local a=table.clone(d);a.id=tostring(i);a.material=table.clone(m)
  a.material.alpha_test={enabled=i%2==0,compare=c,reference=0.5}
  a.material.depth={test=true,write=i%2==1,compare=c};table.insert(ds,a)
 end
 f.draws=ds;api.projected.setFrame(f)
end,update=function()end}"#);
    let j=snapshot(&r);let draws=j["projected_frame"]["draws"].as_array().unwrap();assert_eq!(draws.len(),8);
    assert_eq!(draws[0]["material"]["alpha_test"]["compare"],"never");
    assert_eq!(draws[7]["material"]["depth"]["compare"],"always");
    assert_eq!(draws[2]["material"]["sampler"]["address_u"],"repeat");
    assert_eq!(draws[2]["material"]["sampler"]["mag"],"linear");
}

#[test]
fn malformed_nested_keys_dense_sequences_geometry_and_late_draw_do_not_commit() {
    let r=load(r#"return {start=function(api)
 api.projected.setFrame(f)
 local function reject(t) assert(not pcall(api.projected.setFrame,t)) end
 local bad=table.clone(f);bad.typo=1;reject(bad)
 bad=table.clone(f);bad.draws={[2]=d};reject(bad)
 bad=table.clone(f);bad.draws={d};bad.draws.typo=d;reject(bad)
 for _,path in {'initial','material','alpha_test','blend','depth','sampler'} do
  local x=table.clone(f);x.initial=table.clone(f.initial);local a=table.clone(d);a.material=table.clone(m)
  x.draws={a}
  if path=='initial' then x.initial.typo=1
  elseif path=='material' then a.material.typo=1
  else a.material[path]=table.clone(m[path]);a.material[path].typo=1 end
  reject(x)
 end
 local last=table.clone(d);last.id='last';last.material=table.clone(m)
 last.material.depth={test=false,write=true,compare='always'}
 bad=table.clone(f);bad.draws={d,last};reject(bad)
 for _,value in {-0.01,1.01,0/0,math.huge} do
  local old=buffer.readf32(v,24);buffer.writef32(v,24,value);reject(f);buffer.writef32(v,24,old)
 end
 buffer.writef32(v,64,0.75);reject(f);buffer.writef32(v,64,1)
 buffer.writef32(v,12,2);reject(f);buffer.writef32(v,12,1)
 buffer.writef32(v,8,1.1);reject(f);buffer.writef32(v,8,0.25)
 bad=table.clone(f);local a=table.clone(d);a.scissor={x=0,y=0,width=0,height=1};bad.draws={a};reject(bad)
 assert(not pcall(api.projected.set,'legacy',{texture=d.texture,vertices=v,indices=ix}))
end,update=function()end}"#);
    assert_eq!(snapshot(&r)["projected_frame"]["revision"],1);
    assert_eq!(snapshot(&r)["projected_frame"]["draws"].as_array().unwrap().len(),1);
}

#[test]
fn legacy_omission_is_unchanged_and_cannot_mix_with_frame() {
    let r=load(r#"return {start=function(api)
 api.projected.set('old',{texture=d.texture,vertices=v,indices=ix})
 assert(not pcall(api.projected.setFrame,f))
end,update=function()end}"#);
    assert!(snapshot(&r).get("projected_frame").is_none());
    assert_eq!(snapshot(&r)["projected_geometry"]["old"]["revision"],1);
}

#[test]
fn inside_clip_and_scalar_f32_normalization_are_explicit() {
    let mut r=load(r#"local turn=0
return {start=function(api)
 d.clip_policy='inside';f.initial.depth=-0;api.projected.setFrame(f)
 buffer.writef32(v,0,-2);assert(not pcall(api.projected.setFrame,f));buffer.writef32(v,0,-0.5)
end,update=function(api)
 turn+=1;f.initial.depth=0;m.alpha_test.reference=127/255+1e-12;api.projected.setFrame(f)
end}"#);
    assert_eq!(snapshot(&r)["projected_frame"]["initial"]["depth"],0.0);
    r.tick().unwrap();assert_eq!(snapshot(&r)["projected_frame"]["revision"],1);
}

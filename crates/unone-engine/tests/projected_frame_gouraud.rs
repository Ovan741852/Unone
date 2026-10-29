use unone_engine::EngineRuntime;
const FIXTURE:&str=r#"
local v=buffer.create(120)
for i,rgba in {{1,0,0,.25},{0,1,0,.75},{0,0,1,1}} do
 local values={if i==2 then .5 else -.5,if i==3 then .5 else -.5,.25,1,0,0,rgba[1],rgba[2],rgba[3],rgba[4]}
 for j,x in values do buffer.writef32(v,(i-1)*40+(j-1)*4,x) end
end
local ix=buffer.create(12);buffer.writeu32(ix,4,1);buffer.writeu32(ix,8,2)
local m={rgb='texture_times_vertex',texture_alpha='sampled',alpha='texture_times_vertex',
alpha_test={enabled=false,compare='always',reference=0},blend={enabled=false,operation='add',source='source_alpha',destination='one'},
depth={test=true,write=true,compare='less_equal'},sampler={min='nearest',mag='nearest',address_u='clamp',address_v='clamp'}}
local f={profile='rgb8_encoded_rebuild_v1',initial={rgb8={17,24,39},depth=1},draws={{id='gradient',texture='texture://test',vertices=v,indices=ix,clip_policy='clip',material=m}}}
"#;
fn load(body:&str)->EngineRuntime {
    EngineRuntime::load_source("gouraud-profile","main.luau",&format!("{FIXTURE}\n{body}"),None).unwrap()
}
#[test]
fn old_profile_still_rejects_varying_rgba_new_profile_preserves_every_vertex() {
    let r=load(r#"return {start=function(api)
assert(not pcall(api.projected.setFrame,f))
f.profile='rgb8_encoded_gouraud_v1';api.projected.setFrame(f)
end,update=function()end}"#);
    let world=serde_json::to_value(r.observe()).unwrap();
    assert_eq!(world["projected_frame"]["profile"],"rgb8_encoded_gouraud_v1");
    assert_eq!(world["projected_frame"]["revision"],1);
}
#[test]
fn profile_switch_is_a_revision_change_even_when_all_colors_are_constant() {
    let mut r=load(r#"local step=0;return {start=function(api)
for i=0,2 do for c=6,9 do buffer.writef32(v,i*40+c*4,1) end end
api.projected.setFrame(f)
end,update=function(api)
step+=1;if step==1 then f.profile='rgb8_encoded_gouraud_v1' end;api.projected.setFrame(f)
end}"#);
    r.tick().unwrap();assert_eq!(serde_json::to_value(r.observe()).unwrap()["projected_frame"]["revision"],2);
    r.tick().unwrap();assert_eq!(serde_json::to_value(r.observe()).unwrap()["projected_frame"]["revision"],2);
}

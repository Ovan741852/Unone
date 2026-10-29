use serde_json::json;
use unone_engine::HostProject;

#[test]
fn disabled_ui_keeps_nested_namespace_diagnostics() {
    let project = json!({"config":{"name":"disabled-ui","systems":{"ui":false}},
        "script":r#"return {start=function(api)
            for _,call in {
                function() api.ui.components.info() end,
                function() api.ui.components.create({}) end,
                function() api.ui.setRoot({}) end,
            } do
                local ok,message=pcall(call)
                assert(not ok and string.find(tostring(message),'SYSTEM_DISABLED'))
            end
        end, update=function()end}"#});
    HostProject::parse(&serde_json::to_vec(&project).unwrap()).unwrap().into_runtime(42).unwrap();
}

#[test]
fn two_dimensional_mutators_reject_three_dimensional_entities_without_changing_them() {
    let project = json!({"config":{"name":"dimension"}, "scene":{"entities":[{
        "id":"ship", "transform3d":{"position":{"x":1,"y":2,"z":3},
            "rotation":{"x":0,"y":0,"z":0}, "scale":{"x":1,"y":1,"z":1}}
    }]}, "script":r#"return {start=function(api)
        for _, call in {
            function() api.entity.getPosition('ship') end,
            function() api.entity.setPosition('ship',{x=10,y=20}) end,
            function() api.entity.getTransform2D('ship') end,
            function() api.entity.setTransform2D('ship',{position={x=10,y=20},rotation=0,scale={x=1,y=1}}) end,
        } do
            local ok,message=pcall(call)
            assert(not ok and string.find(tostring(message),'ENTITY_DIMENSION_MISMATCH'))
        end
    end, update=function()end}"#});
    let runtime = HostProject::parse(&serde_json::to_vec(&project).unwrap()).unwrap().into_runtime(42).unwrap();
    let ship = runtime.observe().entities["ship"].clone();
    assert_eq!(ship.transform.x, 0.0);
    assert_eq!(ship.transform3d.unwrap().position.z, 3.0);
}

use super::*;
use serde_json::json;
fn vec(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}
fn body(kind: &str, shape: serde_json::Value) -> Body3D {
    serde_json::from_value(json!({"body_type":kind,"shape":shape})).unwrap()
}
fn ball() -> Body3D {
    body("dynamic", json!({"kind":"sphere","radius":0.5}))
}
fn add(p: &mut PhysicsWorld3D, id: &str, b: Body3D, position: Vec3) {
    p.add(
        id.into(),
        b,
        Pose3D {
            position,
            rotation: Vec3::default(),
        },
    )
    .unwrap();
}
fn step(p: &mut PhysicsWorld3D, n: usize) {
    for _ in 0..n {
        p.step(1. / 60., &mut BTreeMap::new()).unwrap();
    }
}
fn floor(p: &mut PhysicsWorld3D) {
    add(
        p,
        "floor",
        body(
            "static",
            json!({"kind":"box","half_extents":{"x":500,"y":0.5,"z":500}}),
        ),
        vec(0., -0.5, 0.),
    );
}

#[test]
fn rigid3d_drop_stacks_sleep_and_impulse_wakes() {
    let mut p = PhysicsWorld3D::default();
    floor(&mut p);
    for i in 0..6 {
        add(
            &mut p,
            &format!("box{i}"),
            body(
                "dynamic",
                json!({"kind":"box","half_extents":{"x":0.5,"y":0.5,"z":0.5}}),
            ),
            vec(0., 0.6 + i as f64 * 1.05, 0.),
        );
    }
    step(&mut p, 900);
    let snapshot = p.snapshot();
    for i in 0..6 {
        let b = &snapshot.bodies[&format!("box{i}")];
        assert!((b.position.y - (0.5 + i as f64)).abs() < 0.12, "{b:?}");
        assert!(b.sleeping, "{b:?}");
    }
    p.vector_command("box5", vec(0., 5., 0.), "applyImpulse")
        .unwrap();
    step(&mut p, 1);
    assert!(!p.snapshot().bodies["box5"].sleeping);
    assert!(p.snapshot().bodies["box5"].velocity.y > 4.);
}
#[test]
fn rigid3d_ccd_stops_fast_ball_at_thin_wall() {
    let run = |ccd| {
        let mut p = PhysicsWorld3D::default();
        p.set_gravity(Vec3::default()).unwrap();
        add(
            &mut p,
            "wall",
            body(
                "static",
                json!({"kind":"box","half_extents":{"x":0.05,"y":5,"z":5}}),
            ),
            Vec3::default(),
        );
        let mut b = ball();
        b.ccd = ccd;
        b.velocity = vec(1000., 0., 0.);
        b.restitution = 0.;
        add(&mut p, "bullet", b, vec(-5., 0., 0.));
        step(&mut p, 1);
        p.snapshot().bodies["bullet"].position.x
    };
    assert!(run(false) > 5.);
    assert!(run(true) < 0.);
}
#[test]
fn rigid3d_restitution_and_friction_change_physical_response() {
    let slide = |friction: f64| {
        let mut p = PhysicsWorld3D::default();
        let mut f = body(
            "static",
            json!({"kind":"box","half_extents":{"x":100,"y":0.5,"z":100}}),
        );
        f.friction = friction;
        add(&mut p, "floor", f, vec(0., -0.5, 0.));
        let mut b = body(
            "dynamic",
            json!({"kind":"box","half_extents":{"x":0.5,"y":0.5,"z":0.5}}),
        );
        b.friction = friction;
        b.velocity = vec(5., 0., 0.);
        add(&mut p, "b", b, vec(0., 0.5, 0.));
        step(&mut p, 120);
        p.snapshot().bodies["b"].velocity.x.abs()
    };
    assert!(slide(0.) > 4.9);
    assert!(slide(1.) < 0.1);
    let mut p = PhysicsWorld3D::default();
    floor(&mut p);
    let mut b = ball();
    b.restitution = 1.;
    add(&mut p, "b", b, vec(0., 3., 0.));
    let mut bounced = false;
    for _ in 0..90 {
        step(&mut p, 1);
        bounced |= p.snapshot().bodies["b"].velocity.y > 2.;
    }
    assert!(bounced);
}
#[test]
fn rigid3d_sensor_lifecycle_filter_and_removal() {
    let mut p = PhysicsWorld3D::default();
    p.set_gravity(Vec3::default()).unwrap();
    let mut s = ball();
    s.body_type = BodyKind::Static;
    s.sensor = true;
    add(&mut p, "sensor", s, Vec3::default());
    add(&mut p, "ball", ball(), vec(0.2, 0., 0.));
    step(&mut p, 1);
    assert_eq!(p.contacts[0].phase, "enter");
    assert!(p.contacts[0].sensor);
    step(&mut p, 1);
    assert_eq!(p.contacts[0].phase, "stay");
    assert_eq!(p.snapshot().bodies["ball"].position.x, 0.2f32 as f64);
    p.remove("ball").unwrap();
    step(&mut p, 1);
    assert_eq!(p.contacts[0].phase, "exit");
    step(&mut p, 1);
    assert!(p.contacts.is_empty());
    let mut b = ball();
    b.membership = 1;
    b.filter = 1;
    add(&mut p, "a", b, Vec3::default());
    let mut b = ball();
    b.membership = 2;
    b.filter = 2;
    add(&mut p, "b", b, Vec3::default());
    p.remove("sensor").unwrap();
    step(&mut p, 1);
    assert!(!p.contacts.iter().any(|c| c.a == "a" && c.b == "b"));
}
#[test]
fn rigid3d_queries_cover_rotated_box_capsule_convex_and_mesh() {
    let mut p = PhysicsWorld3D::default();
    p.add(
        "box".into(),
        body(
            "static",
            json!({"kind":"box","half_extents":{"x":1,"y":1,"z":1}}),
        ),
        Pose3D {
            position: Vec3::default(),
            rotation: vec(0., 0.4, 0.),
        },
    )
    .unwrap();
    let ray = || Ray3D {
        from: vec(-5., 0., 0.),
        to: vec(5., 0., 0.),
        filter: Query3DFilter::default(),
    };
    assert_eq!(p.raycast(ray()).unwrap().unwrap().id, "box");
    let h = p
        .cast(Cast3D {
            pose: Pose3D {
                position: vec(-5., 0., 0.),
                ..Default::default()
            },
            to: vec(5., 0., 0.),
            shape: Shape3D::Capsule {
                half_height: 0.5,
                radius: 0.25,
            },
            filter: Default::default(),
        })
        .unwrap()
        .unwrap();
    assert!(h.fraction > 0. && h.fraction < 0.5);
    assert!(h.normal.x < 0.);
    assert_eq!(
        p.overlap(Overlap3D {
            pose: Default::default(),
            shape: Shape3D::Sphere { radius: 2. },
            filter: Default::default()
        })
        .unwrap(),
        vec!["box"]
    );
    p.move_body(
        "box",
        Pose3D {
            position: vec(30., 0., 0.),
            ..Default::default()
        },
        false,
    )
    .unwrap();
    assert!(p.raycast(ray()).unwrap().is_none());
    add(
        &mut p,
        "hull",
        body(
            "static",
            json!({"kind":"convex","vertices":[{"x":-1,"y":-1,"z":-1},{"x":1,"y":-1,"z":-1},{"x":0,"y":1,"z":-1},{"x":0,"y":0,"z":1}]}),
        ),
        Vec3::default(),
    );
    assert_eq!(p.raycast(ray()).unwrap().unwrap().id, "hull");
    add(
        &mut p,
        "mesh",
        body(
            "static",
            json!({"kind":"trimesh","vertices":[{"x":-2,"y":0,"z":-2},{"x":2,"y":0,"z":-2},{"x":0,"y":0,"z":2}],"indices":[[0,2,1]]}),
        ),
        vec(10., 0., 0.),
    );
    assert_eq!(
        p.raycast(Ray3D {
            from: vec(10., 2., 0.),
            to: vec(10., -2., 0.),
            filter: Default::default()
        })
        .unwrap()
        .unwrap()
        .id,
        "mesh"
    );
}
#[test]
fn rigid3d_kinematic_joint_and_clone_preserve_solver_state() {
    let mut p = PhysicsWorld3D::default();
    floor(&mut p);
    add(
        &mut p,
        "anchor",
        body("kinematic", json!({"kind":"sphere","radius":0.1})),
        vec(0., 3., 0.),
    );
    add(&mut p, "ball", ball(), vec(0., 2., 0.));
    p.add_joint(
        "rope".into(),
        Joint3D {
            body_a: "anchor".into(),
            body_b: "ball".into(),
            anchor_a: vec(0., -1., 0.),
            anchor_b: Vec3::default(),
            joint: JointKind3D::Spherical {},
            contacts_enabled: false,
        },
    )
    .unwrap();
    step(&mut p, 20);
    p.move_body(
        "anchor",
        Pose3D {
            position: vec(1., 3., 0.),
            ..Default::default()
        },
        true,
    )
    .unwrap();
    step(&mut p, 30);
    assert!(p.snapshot().bodies["ball"].position.y > 1.8);
    let mut clone = p.clone();
    step(&mut p, 120);
    step(&mut clone, 120);
    assert_eq!(
        serde_json::to_value(p.snapshot()).unwrap(),
        serde_json::to_value(clone.snapshot()).unwrap()
    );
    p.remove("ball").unwrap();
    assert!(p.snapshot().joints.is_empty());
}
#[test]
fn rigid3d_invalid_contracts_are_errors_before_mutation() {
    let mut p = PhysicsWorld3D::default();
    let mut b = ball();
    b.mass = f64::NAN;
    assert!(p.add("bad".into(), b, Default::default()).is_err());
    assert!(p.ids.is_empty());
    assert!(
        serde_json::from_value::<Body3D>(
            json!({"body_type":"dynamic","shape":{"kind":"sphere","radius":1},"restituton":1})
        )
        .is_err()
    );
    assert!(serde_json::from_value::<JointKind3D>(json!({"kind":"fixed","typo":1})).is_err());
    assert!(
        p.raycast(Ray3D {
            from: Vec3::default(),
            to: Vec3::default(),
            filter: Default::default()
        })
        .is_err()
    );
}
#[test]
fn rigid3d_host_and_lua_enforce_ownership_and_lifecycle() {
    let script = r#"
        return {start=function(api)
            api.physics3d.addBody('free',{body_type='dynamic',shape={kind='sphere',radius=0.5}})
            local definition=api.physics3d.getBody('free')
            assert(definition.mass==1)
            local ok=pcall(function() api.entity.setTransform3D('free',api.entity.getTransform3D('free')) end)
            assert(not ok)
            ok=pcall(function() api.physics3d.raycast({from={x=0,y=5,z=0},to={x=0,y=-5,z=0},typo=true}) end)
            assert(not ok)
            api.physics3d.applyImpulse('free',{x=1,y=0,z=0})
            api.physics3d.addForce('free',{x=0,y=1,z=0})
            api.physics3d.clearForces('free')
            api.physics3d.removeBody('free')
            api.entity.setTransform3D('free',api.entity.getTransform3D('free'))
            api.physics3d.addBody('free',{body_type='dynamic',shape={kind='capsule',half_height=0.5,radius=0.2}})
            api.entity.despawn('free')
            assert(api.physics3d.snapshot().bodies.free==nil)
            api.observation.set('ownership_and_cleanup',true)
        end,update=function() end}
    "#;
    let payload = json!({"config":{"name":"physics boundary","entry_script":"main.luau","systems":{"physics3d":true,"physics2d":false}},"script":script,"scene":{"entities":[{"id":"free","transform3d":{}}]}});
    let mut runtime = crate::HostProject::parse(&serde_json::to_vec(&payload).unwrap())
        .unwrap()
        .into_runtime(42)
        .unwrap();
    assert_eq!(
        runtime.tick().unwrap().observations["ownership_and_cleanup"],
        true
    );
    let disabled = json!({"config":{"name":"disabled physics","entry_script":"main.luau","systems":{"physics3d":false}},"script":"return {start=function() end,update=function() end}","scene":{"physics3d":{},"entities":[]}});
    let error = crate::HostProject::parse(&serde_json::to_vec(&disabled).unwrap())
        .unwrap()
        .into_runtime(42)
        .err()
        .unwrap();
    assert_eq!(error.code, "SYSTEM_DISABLED");
}
#[test]
fn rigid3d_fixed_and_limited_revolute_joints_hold_and_remove() {
    for kind in [
        JointKind3D::Fixed {},
        JointKind3D::Revolute {
            axis: vec(0., 0., 1.),
            limits: Some([-0.1, 0.1]),
        },
    ] {
        let mut p = PhysicsWorld3D::default();
        let mut fixed = ball();
        fixed.body_type = BodyKind::Static;
        add(&mut p, "a", fixed, vec(0., 3., 0.));
        add(&mut p, "b", ball(), vec(0., 2., 0.));
        p.add_joint(
            "j".into(),
            Joint3D {
                body_a: "a".into(),
                body_b: "b".into(),
                anchor_a: vec(0., -1., 0.),
                anchor_b: Vec3::default(),
                joint: kind,
                contacts_enabled: false,
            },
        )
        .unwrap();
        p.vector_command("b", vec(0., 0., 3.), "applyTorqueImpulse")
            .unwrap();
        step(&mut p, 120);
        assert!((p.snapshot().bodies["b"].position.y - 2.).abs() < 0.02);
        p.remove_joint("j").unwrap();
        step(&mut p, 30);
        assert!(p.snapshot().bodies["b"].position.y < 1.);
    }
}
#[test]
fn rigid3d_sleeping_fast_path_preserves_removal_exit_and_static_teleport() {
    let mut p = PhysicsWorld3D::default();
    let mut s = ball();
    s.body_type = BodyKind::Static;
    s.sensor = true;
    add(&mut p, "a", s.clone(), Vec3::default());
    add(&mut p, "b", s, Vec3::default());
    step(&mut p, 1);
    assert_eq!(p.contacts[0].phase, "enter");
    step(&mut p, 2);
    assert_eq!(p.contacts[0].phase, "stay");
    p.move_body(
        "b",
        Pose3D {
            position: vec(10., 0., 0.),
            ..Default::default()
        },
        false,
    )
    .unwrap();
    p.raycast(Ray3D {
        from: vec(-1., 0., 0.),
        to: vec(2., 0., 0.),
        filter: Default::default(),
    })
    .unwrap(); // Query refresh must not consume pending solver changes.
    step(&mut p, 1);
    assert_eq!(p.contacts[0].phase, "exit");
    step(&mut p, 1);
    assert!(p.contacts.is_empty());
    p.remove("a").unwrap();
    p.remove("b").unwrap();
    step(&mut p, 2);
    assert!(p.contacts.is_empty());
}
#[test]
#[ignore = "manual optimized solver-only performance; not an end-to-end frame-rate claim"]
fn rigid3d_benchmark() {
    for count in [250, 1000, 4000] {
        for layout in ["active_sparse", "sleeping", "dense_stack"] {
            let mut p = PhysicsWorld3D::default();
            floor(&mut p);
            for i in 0..count {
                let mut b = ball();
                if layout == "dense_stack" {
                    b.can_sleep = false;
                }
                let position = if layout == "dense_stack" {
                    vec(
                        (i % 20) as f64 * 1.01,
                        0.5 + (i / 400) as f64 * 1.01,
                        ((i / 20) % 20) as f64 * 1.01,
                    )
                } else {
                    vec((i % 100) as f64 * 3., 0.5, (i / 100) as f64 * 3.)
                };
                if layout == "active_sparse" {
                    b.can_sleep = false;
                    b.gravity_scale = 0.;
                    b.velocity = vec(0.1, 0., 0.);
                }
                add(&mut p, &format!("b{i:05}"), b, position);
            }
            step(&mut p, if layout == "sleeping" { 240 } else { 60 });
            let mut samples = vec![];
            for _ in 0..120 {
                let t = std::time::Instant::now();
                step(&mut p, 1);
                samples.push(t.elapsed().as_secs_f64() * 1000.);
            }
            samples.sort_by(f64::total_cmp);
            println!(
                "{}",
                json!({"bodies":count,"layout":layout,"physics_median_ms":samples[60],"physics_p95_ms":samples[114],"sleeping":p.bodies.iter().filter(|(_,b)|b.is_sleeping()).count()})
            );
        }
    }
}

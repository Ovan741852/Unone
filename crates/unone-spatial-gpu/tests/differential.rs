//! This suite requires a working native compute adapter. Unavailability is a
//! failure, never a silent CPU fallback or a passing skipped GPU check.
use unone_engine::spatial::{execute_cpu, validate_result, SpatialBatch, SpatialBatchResult, SpatialBody, SpatialExecutor, SpatialQuery};
use unone_spatial_gpu::SpatialGpuExecutor;

fn body(id: u32, position: [f32; 3], radius: f32) -> SpatialBody {
    SpatialBody { id, position, radius, category: 1, previous_position: None }
}
fn nearest(point: [f32; 3], max_distance: f32) -> SpatialQuery {
    SpatialQuery::Nearest { point, max_distance, mask: u32::MAX, exclude_id: None }
}
fn overlap(center: [f32; 3], radius: f32) -> SpatialQuery {
    SpatialQuery::OverlapSphere { center, radius, mask: u32::MAX, exclude_id: None }
}
fn sweep(from: [f32; 3], to: [f32; 3], radius: f32) -> SpatialQuery {
    SpatialQuery::SweepSphere { from, to, radius, mask: u32::MAX, exclude_id: None }
}
fn compare(expected: &SpatialBatchResult, actual: &SpatialBatchResult) {
    assert_eq!(expected.version, actual.version);
    assert_eq!(expected.results.len(), actual.results.len());
    for (index, (left, right)) in expected.results.iter().zip(&actual.results).enumerate() {
        assert_eq!(left.hits.len(), right.hits.len(), "query {index}");
        for (left, right) in left.hits.iter().zip(&right.hits) {
            assert_eq!(left.id, right.id, "query {index}");
            for (a,b) in [left.distance,left.fraction].into_iter().chain(left.point).chain(left.normal)
                .zip([right.distance,right.fraction].into_iter().chain(right.point).chain(right.normal)) {
                assert!((a-b).abs() <= 0.0001*(1.+a.abs()), "query {index}, id {}: CPU {a} GPU {b}", left.id);
            }
        }
    }
}
fn check(gpu: &mut SpatialGpuExecutor, batch: SpatialBatch) {
    let cpu = execute_cpu(&batch).unwrap();
    let actual = gpu.execute(&batch).unwrap();
    let profile = gpu.take_profile().expect("GPU executor reports host phase timings");
    profile.validate().unwrap();
    assert!(profile.phases_ms.gpu_kernel.is_none());
    assert!(profile.gpu_kernel_unavailable_reason.is_some());
    assert!(gpu.take_profile().is_none(), "reading diagnostics consumes only the executor sample");
    if batch.queries.is_empty() {
        assert_eq!(profile.upload_bytes, 0);
        assert_eq!(profile.readback_bytes, 0);
    } else {
        assert_eq!(profile.upload_bytes, (batch.bodies.len().max(1) * 48 + batch.queries.len() * 64 + 16) as u64);
        assert_eq!(profile.readback_bytes, (batch.queries.len() * (4 + 64 * 12) * 4) as u64);
        for value in [profile.phases_ms.validation, profile.phases_ms.packing, profile.phases_ms.upload,
            profile.phases_ms.encode_submit, profile.phases_ms.readback_wait, profile.phases_ms.decode] {
            assert!(value.is_some_and(|value| value >= 0.0));
        }
    }
    validate_result(&batch, &cpu).unwrap();
    validate_result(&batch, &actual).unwrap();
    compare(&cpu, &actual);
}

#[test]
fn required_gpu_keeps_valid_contact_normals_at_tiny_zero_and_large_scales() {
    let mut gpu = SpatialGpuExecutor::new().expect("required real GPU compute adapter");
    eprintln!("Spatial tiny-normal adapter: {}", gpu.adapter_name());
    let tiny = f32::from_bits(1);
    let diagonal = 1.0 / 3.0_f32.sqrt();
    let cases = [
        ([3e-23, 0.0, 0.0], [0.0; 3], [-1.0, 0.0, 0.0]),
        ([3e-23, -4e-23, 0.0], [0.0; 3], [-0.6, 0.8, 0.0]),
        ([3e-30, -4e-30, 0.0], [0.0; 3], [-0.6, 0.8, 0.0]),
        ([tiny, -tiny, tiny], [0.0; 3], [-diagonal, diagonal, -diagonal]),
        ([f32::MIN_POSITIVE, 0.0, 0.0], [f32::MIN_POSITIVE + tiny, 0.0, 0.0], [1.0, 0.0, 0.0]),
        ([600_000.0, -800_000.0, 0.0], [0.0; 3], [-0.6, 0.8, 0.0]),
        ([0.0; 3], [0.0; 3], [0.0, 0.0, 1.0]),
    ];
    for (position, point, expected_normal) in cases {
        let batch = SpatialBatch {
            version: 31,
            bodies: vec![body(1, position, 0.0)],
            queries: vec![nearest(point, 2_000_000.0), overlap(point, 1_000_000.0)],
        };
        let actual = gpu.execute(&batch).unwrap();
        validate_result(&batch, &actual).unwrap();
        compare(&execute_cpu(&batch).unwrap(), &actual);
        for query in actual.results {
            assert_eq!(query.hits.len(), 1);
            for (actual, expected) in query.hits[0].normal.into_iter().zip(expected_normal) {
                assert!((actual-expected).abs() < 0.0001, "position {position:?}: actual {actual}, expected {expected}");
            }
        }
    }
}

#[test]
fn required_gpu_matches_cpu_for_generic_spatial_batches() {
    let mut gpu = SpatialGpuExecutor::new().expect("required real GPU compute adapter");
    eprintln!("Spatial differential adapter: {}", gpu.adapter_name());
    let mut moving = body(99, [0.,-4.,0.], 0.5);
    moving.previous_position = Some([0.,4.,0.]);
    let mut filtered = body(0xffffffff, [0.,0.,0.], 1.);
    filtered.category = 2;
    check(&mut gpu, SpatialBatch { version: 123, bodies: vec![body(42,[2.,0.,0.],1.),body(7,[-2.,0.,0.],1.),moving,filtered], queries: vec![
        SpatialQuery::Nearest { point:[0.,0.,0.],max_distance:2.,mask:1,exclude_id:None },
        SpatialQuery::Nearest { point:[0.,0.,0.],max_distance:2.,mask:1,exclude_id:Some(7) },
        nearest([0.,0.,0.],0.), overlap([0.,0.,0.],1.),
        sweep([-8.,0.,0.],[8.,0.,0.],0.25), sweep([0.,0.,0.],[0.,0.,0.],0.25),
        sweep([-2.,1.,0.],[2.,1.,0.],0.),
        SpatialQuery::OverlapSphere { center:[0.,0.,0.],radius:100.,mask:0,exclude_id:None },
    ] });
    check(&mut gpu, SpatialBatch { version: 0, bodies: vec![], queries: vec![nearest([0.;3],3e38),overlap([0.;3],1.),sweep([0.;3],[10.,0.,0.],1.)] });
    check(&mut gpu, SpatialBatch { version: 1, bodies: vec![body(1,[0.;3],0.)], queries: vec![] });
    check(&mut gpu, SpatialBatch { version: 1, bodies: vec![body(1,[0.;3],1.)], queries: vec![
        sweep([-1e6,0.,0.],[1e6,0.,0.],0.),
        sweep([-100.,1.,0.],[100.,1.,0.],0.),
        sweep([-100.,1.01,0.],[100.,1.01,0.],0.),
    ] });
    // Relative-motion CCD must detect a body crossing a stationary query sphere.
    let mut crossing = body(1,[5.,0.,0.],0.5);
    crossing.previous_position = Some([-5.,0.,0.]);
    check(&mut gpu, SpatialBatch {version:7,bodies:vec![crossing],queries:vec![sweep([0.;3],[0.;3],0.5)]});
    // Seeded point cloud exercises arbitrary directions and insertion ordering.
    let mut seed = 0x4a71d18bu32;
    let mut next = || { seed=seed.wrapping_mul(1664525).wrapping_add(1013904223); ((seed>>8) as f32 / 16777216.)*100.-50. };
    let bodies=(0..512).map(|i| {let position=[next(),next(),next()];let mut b=body(1000-i,position,0.25);b.previous_position=Some([position[0]-next()*0.01,position[1],position[2]]);b}).collect();
    let mut queries=Vec::new();for _ in 0..96 {let point=[next(),next(),next()];queries.push(nearest(point,150.));queries.push(overlap(point,8.));queries.push(sweep(point,[point[0]+20.,point[1]+2.,point[2]],0.5));}
    check(&mut gpu,SpatialBatch{version:0xffffffff,bodies,queries});
    // Maximum body capacity and upper coordinate bound, without a game fixture.
    let bodies=(0..65536).map(|i|body(i,[i as f32*10.,1e6,0.],0.)).collect();
    check(&mut gpu,SpatialBatch{version:8,bodies,queries:vec![nearest([0.,1e6,0.],1e6)]});
    // The 65th overlap fails the whole batch instead of truncating the result.
    let batch=SpatialBatch {version:1,bodies:(0..65).map(|i|body(i,[0.;3],1.)).collect(),queries:vec![overlap([0.;3],0.)]};
    assert!(execute_cpu(&batch).is_err());
    assert!(gpu.execute(&batch).unwrap_err().contains("64"));
    let mut invalid=batch;invalid.bodies[0].position[0]=f32::NAN;
    assert!(gpu.execute(&invalid).is_err());
}

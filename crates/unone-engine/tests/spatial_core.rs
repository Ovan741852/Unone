use unone_engine::spatial::{
    CpuSpatialExecutor, MAX_BODIES, MAX_COORDINATE, MAX_HITS, MAX_QUERIES, SpatialBatch,
    SpatialBody, SpatialExecutor, SpatialQuery, execute_cpu, pack_bodies, unpack_bodies,
    validate_batch, validate_bodies, validate_result,
};

fn body(id: u32, position: [f32; 3], radius: f32) -> SpatialBody {
    SpatialBody {
        id,
        position,
        radius,
        category: 1,
        previous_position: None,
    }
}

fn batch(bodies: Vec<SpatialBody>, queries: Vec<SpatialQuery>) -> SpatialBatch {
    SpatialBatch {
        version: 19,
        bodies,
        queries,
    }
}

fn nearest(point: [f32; 3], max_distance: f32) -> SpatialQuery {
    SpatialQuery::Nearest {
        point,
        max_distance,
        mask: u32::MAX,
        exclude_id: None,
    }
}

fn overlap(center: [f32; 3], radius: f32) -> SpatialQuery {
    SpatialQuery::OverlapSphere {
        center,
        radius,
        mask: u32::MAX,
        exclude_id: None,
    }
}

fn sweep(from: [f32; 3], to: [f32; 3], radius: f32) -> SpatialQuery {
    SpatialQuery::SweepSphere {
        from,
        to,
        radius,
        mask: u32::MAX,
        exclude_id: None,
    }
}

fn close(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() < 0.0001,
        "actual {actual}, expected {expected}"
    );
}

#[test]
fn nearest_uses_center_distance_inclusive_boundary_and_numeric_id_ties() {
    let result = execute_cpu(&batch(
        vec![
            body(12, [-3.0, 0.0, 0.0], 100.0),
            body(2, [3.0, 0.0, 0.0], 1.0),
            body(1, [4.0, 0.0, 0.0], 100.0),
        ],
        vec![nearest([0.0; 3], 3.0), nearest([0.0; 3], 2.999)],
    ))
    .unwrap();
    assert_eq!(result.version, 19);
    assert_eq!(result.results[0].hits.len(), 1);
    let hit = &result.results[0].hits[0];
    assert_eq!(hit.id, 2);
    assert_eq!(hit.distance, 3.0);
    assert_eq!(hit.fraction, 0.0);
    assert_eq!(hit.normal, [-1.0, 0.0, 0.0]);
    assert_eq!(hit.point, [2.0, 0.0, 0.0]);
    assert!(result.results[1].hits.is_empty());
}

#[test]
fn static_contact_normals_remain_unit_length_across_valid_coordinate_scales() {
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
        let input = batch(
            vec![body(1, position, 0.0)],
            vec![nearest(point, 2_000_000.0), overlap(point, 1_000_000.0)],
        );
        let output = execute_cpu(&input).unwrap();
        validate_result(&input, &output).unwrap();
        for query in &output.results {
            assert_eq!(query.hits.len(), 1);
            for (actual, expected) in query.hits[0].normal.into_iter().zip(expected_normal) {
                close(actual, expected);
            }
        }
    }
}

#[test]
fn filtering_is_bitwise_and_exclusion_applies_to_all_query_kinds() {
    let mut bodies = vec![body(1, [0.0; 3], 1.0), body(2, [1.0, 0.0, 0.0], 1.0)];
    bodies[0].category = 0;
    bodies[1].category = 0x8000_0000;
    let result = execute_cpu(&batch(
        bodies,
        vec![
            SpatialQuery::Nearest {
                point: [0.0; 3],
                max_distance: 100.0,
                mask: 0x8000_0000,
                exclude_id: None,
            },
            SpatialQuery::OverlapSphere {
                center: [0.0; 3],
                radius: 100.0,
                mask: u32::MAX,
                exclude_id: Some(2),
            },
            SpatialQuery::SweepSphere {
                from: [-10.0, 0.0, 0.0],
                to: [10.0, 0.0, 0.0],
                radius: 1.0,
                mask: 0,
                exclude_id: None,
            },
        ],
    ))
    .unwrap();
    assert_eq!(result.results[0].hits[0].id, 2);
    assert!(result.results[1].hits.is_empty());
    assert!(result.results[2].hits.is_empty());
}

#[test]
fn overlaps_include_touching_spheres_and_are_sorted_by_id() {
    let result = execute_cpu(&batch(
        vec![
            body(9, [0.0; 3], 0.0),
            body(2, [3.0, 0.0, 0.0], 1.0),
            body(4, [3.01, 0.0, 0.0], 1.0),
        ],
        vec![overlap([0.0; 3], 2.0)],
    ))
    .unwrap();
    let hits = &result.results[0].hits;
    assert_eq!(hits.iter().map(|hit| hit.id).collect::<Vec<_>>(), [2, 9]);
    assert_eq!(hits[0].distance, 3.0);
    assert_eq!(hits[1].normal, [0.0, 0.0, 1.0]);
}

#[test]
fn overlap_capacity_is_exact_and_overflow_is_an_error() {
    let bodies: Vec<_> = (0..=MAX_HITS as u32)
        .map(|id| body(id, [0.0; 3], 0.0))
        .collect();
    let at_limit = execute_cpu(&batch(
        bodies[..MAX_HITS].to_vec(),
        vec![overlap([0.0; 3], 0.0)],
    ))
    .unwrap();
    assert_eq!(at_limit.results[0].hits.len(), MAX_HITS);
    let error = execute_cpu(&batch(bodies, vec![overlap([0.0; 3], 0.0)])).unwrap_err();
    assert!(error.contains("overlap exceeds 64 hits"));
}

#[test]
fn sweep_detects_fast_motion_and_chooses_first_contact_before_numeric_id() {
    let result = execute_cpu(&batch(
        vec![
            body(1, [5.0, 0.0, 0.0], 1.0),
            body(7, [0.0; 3], 1.0),
            body(3, [0.0; 3], 1.0),
        ],
        vec![sweep([-100.0, 0.0, 0.0], [100.0, 0.0, 0.0], 1.0)],
    ))
    .unwrap();
    let hits = &result.results[0].hits;
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, 3);
    close(hits[0].fraction, 0.49);
    close(hits[0].distance, 98.0);
    assert_eq!(hits[0].normal, [-1.0, 0.0, 0.0]);
    assert_eq!(hits[0].point, [-1.0, 0.0, 0.0]);
}

#[test]
fn sweep_uses_body_relative_motion_and_interpolated_contact_position() {
    let mut moving = body(10, [10.0, 0.0, 0.0], 1.0);
    moving.previous_position = Some([-10.0, 0.0, 0.0]);
    let result = execute_cpu(&batch(
        vec![moving],
        vec![
            sweep([0.0; 3], [0.0; 3], 1.0),
            overlap([0.0; 3], 1.0),
        ],
    ))
    .unwrap();
    let hit = &result.results[0].hits[0];
    close(hit.fraction, 0.4);
    assert_eq!(hit.distance, 0.0);
    assert_eq!(hit.normal, [1.0, 0.0, 0.0]);
    close(hit.point[0], -1.0);
    assert!(result.results[1].hits.is_empty());
}

#[test]
fn sweep_handles_initial_overlap_tangency_endpoints_and_stationary_queries() {
    let result = execute_cpu(&batch(
        vec![body(0, [0.0; 3], 1.0)],
        vec![
            sweep([0.5, 0.0, 0.0], [10.0, 0.0, 0.0], 0.0),
            sweep([-2.0, 1.0, 0.0], [2.0, 1.0, 0.0], 0.0),
            sweep([-2.0, 0.0, 0.0], [-1.0, 0.0, 0.0], 0.0),
            sweep([-2.0, 0.0, 0.0], [-2.0, 0.0, 0.0], 0.0),
        ],
    ))
    .unwrap();
    assert_eq!(result.results[0].hits[0].fraction, 0.0);
    assert_eq!(result.results[0].hits[0].normal, [0.0, 0.0, 1.0]);
    assert_eq!(result.results[0].hits[0].point, [0.0, 0.0, 1.0]);
    close(result.results[1].hits[0].fraction, 0.5);
    assert_eq!(result.results[2].hits[0].fraction, 1.0);
    assert!(result.results[3].hits.is_empty());
}

#[test]
fn sweep_keeps_small_sphere_geometry_at_large_coordinate_bounds() {
    let input = batch(
        vec![body(1, [0.0; 3], 1.0)],
        vec![
            sweep([-MAX_COORDINATE, 0.0, 0.0], [MAX_COORDINATE, 0.0, 0.0], 0.0),
            sweep([-MAX_COORDINATE, 1.0, 0.0], [MAX_COORDINATE, 1.0, 0.0], 0.0),
            sweep([-MAX_COORDINATE, 2.0, 0.0], [MAX_COORDINATE, 2.0, 0.0], 0.0),
        ],
    );
    let result = execute_cpu(&input).unwrap();
    let hit = &result.results[0].hits[0];
    assert_eq!(hit.normal, [-1.0, 0.0, 0.0]);
    assert_eq!(hit.point, [-1.0, 0.0, 0.0]);
    assert!(hit.fraction < 0.5);
    assert_eq!(result.results[1].hits[0].fraction, 0.5);
    assert!(result.results[2].hits.is_empty());
    validate_result(&input, &result).unwrap();
}

#[test]
fn empty_batches_and_executor_preserve_query_order_and_version() {
    let mut executor = CpuSpatialExecutor;
    assert_eq!(executor.name(), "cpu");
    let result = executor.execute(&batch(Vec::new(), Vec::new())).unwrap();
    assert_eq!(result.version, 19);
    assert!(result.results.is_empty());
    let result = executor
        .execute(&batch(
            Vec::new(),
            vec![nearest([0.0; 3], 1.0), overlap([0.0; 3], 1.0)],
        ))
        .unwrap();
    assert_eq!(result.results.len(), 2);
    assert!(result.results.iter().all(|result| result.hits.is_empty()));
}

#[test]
fn validates_capacity_uniqueness_and_all_numeric_fields() {
    assert!(validate_bodies(&vec![body(1, [0.0; 3], 1.0); MAX_BODIES + 1]).is_err());
    assert!(validate_bodies(&[body(1, [0.0; 3], 1.0), body(1, [1.0; 3], 1.0)]).is_err());
    assert!(validate_batch(&batch(
        Vec::new(),
        vec![nearest([0.0; 3], 1.0); MAX_QUERIES + 1]
    ))
    .is_err());
    for invalid in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, MAX_COORDINATE + 1.0] {
        assert!(validate_bodies(&[body(1, [invalid, 0.0, 0.0], 0.0)]).is_err());
        let mut previous = body(1, [0.0; 3], 0.0);
        previous.previous_position = Some([0.0, invalid, 0.0]);
        assert!(validate_bodies(&[previous]).is_err());
        assert!(validate_batch(&batch(Vec::new(), vec![overlap([invalid; 3], 0.0)])).is_err());
        assert!(validate_batch(&batch(Vec::new(), vec![sweep([0.0; 3], [invalid; 3], 0.0)])).is_err());
    }
    for invalid in [-1.0, f32::NAN, f32::INFINITY, MAX_COORDINATE + 1.0] {
        assert!(validate_bodies(&[body(1, [0.0; 3], invalid)]).is_err());
        assert!(validate_batch(&batch(Vec::new(), vec![overlap([0.0; 3], invalid)])).is_err());
        assert!(validate_batch(&batch(Vec::new(), vec![sweep([0.0; 3], [0.0; 3], invalid)])).is_err());
    }
    for invalid in [-1.0, f32::NAN, f32::INFINITY] {
        assert!(validate_batch(&batch(Vec::new(), vec![nearest([0.0; 3], invalid)])).is_err());
    }
    validate_bodies(&[body(u32::MAX, [MAX_COORDINATE; 3], MAX_COORDINATE)]).unwrap();
    validate_batch(&batch(Vec::new(), vec![nearest([0.0; 3], f32::MAX)])).unwrap();
}

#[test]
fn serde_defaults_are_usable_and_unknown_fields_fail() {
    let body: SpatialBody = serde_json::from_str(r#"{"id":8,"position":[0,0,0],"radius":1}"#).unwrap();
    assert_eq!(body.category, 1);
    assert_eq!(body.previous_position, None);
    let query: SpatialQuery = serde_json::from_str(
        r#"{"kind":"nearest","point":[0,0,0],"max_distance":5}"#,
    )
    .unwrap();
    assert_eq!(query, nearest([0.0; 3], 5.0));
    assert!(serde_json::from_str::<SpatialBody>(
        r#"{"id":8,"position":[0,0,0],"radius":1,"extra":true}"#
    )
    .is_err());
    assert!(serde_json::from_str::<SpatialQuery>(
        r#"{"kind":"nearest","point":[0,0,0],"max_distance":5,"extra":true}"#
    )
    .is_err());
}

#[test]
fn packed_codec_round_trips_order_optional_motion_and_little_endian_fields() {
    let mut moving = body(0x0102_0304, [1.0, -2.0, 3.0], 0.5);
    moving.category = 0x8000_0000;
    moving.previous_position = Some([-1.0, -2.0, -3.0]);
    let bodies = vec![moving, body(0, [0.0; 3], 0.0)];
    let packed = pack_bodies(&bodies).unwrap();
    assert_eq!(&packed[..8], b"USB1\x02\x00\x00\x00");
    assert_eq!(&packed[8..12], &[4, 3, 2, 1]);
    assert_eq!(packed.len(), 8 + 40 * bodies.len());
    assert_eq!(unpack_bodies(&packed).unwrap(), bodies);
    assert_eq!(unpack_bodies(&pack_bodies(&[]).unwrap()).unwrap(), []);
}

#[test]
fn packed_codec_rejects_malformed_headers_lengths_flags_and_hidden_nonfinite_data() {
    let packed = pack_bodies(&[body(1, [0.0; 3], 1.0)]).unwrap();
    for bytes in [Vec::new(), b"USB1".to_vec(), packed[..packed.len() - 1].to_vec()] {
        assert!(unpack_bodies(&bytes).is_err());
    }
    let mut corrupt = packed.clone();
    corrupt[0] = b'X';
    assert!(unpack_bodies(&corrupt).is_err());
    let mut corrupt = packed.clone();
    corrupt[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(unpack_bodies(&corrupt).is_err());
    let mut corrupt = packed.clone();
    corrupt.push(0);
    assert!(unpack_bodies(&corrupt).is_err());
    let mut corrupt = packed.clone();
    corrupt[44..48].copy_from_slice(&2_u32.to_le_bytes());
    assert!(unpack_bodies(&corrupt).is_err());
    let mut corrupt = packed;
    corrupt[32..36].copy_from_slice(&f32::NAN.to_le_bytes());
    assert!(unpack_bodies(&corrupt).is_err());
}

#[test]
fn result_envelopes_reject_stale_versions_unknown_ids_bad_filters_and_invalid_geometry() {
    let input = batch(
        vec![body(4, [0.0; 3], 1.0), body(2, [0.0; 3], 1.0)],
        vec![overlap([0.0; 3], 1.0)],
    );
    let output = execute_cpu(&input).unwrap();
    validate_result(&input, &output).unwrap();
    let mut invalid = output.clone();
    invalid.version += 1;
    assert!(validate_result(&input, &invalid).is_err());
    let mut invalid = output.clone();
    invalid.results.clear();
    assert!(validate_result(&input, &invalid).is_err());
    let mut invalid = output.clone();
    invalid.results[0].hits[0].id = 999;
    assert!(validate_result(&input, &invalid).is_err());
    let mut invalid = output.clone();
    invalid.results[0].hits.reverse();
    assert!(validate_result(&input, &invalid).is_err());
    let mut invalid = output.clone();
    invalid.results[0].hits[0].fraction = 0.1;
    assert!(validate_result(&input, &invalid).is_err());
    let mut invalid = output.clone();
    invalid.results[0].hits[0].distance = f32::NAN;
    assert!(validate_result(&input, &invalid).is_err());
    let mut invalid = output.clone();
    invalid.results[0].hits[0].normal = [0.0; 3];
    assert!(validate_result(&input, &invalid).is_err());
    let mut invalid = output.clone();
    invalid.results[0].hits[0].point = [f32::INFINITY; 3];
    assert!(validate_result(&input, &invalid).is_err());
    let mut filtered = input.clone();
    filtered.queries[0] = SpatialQuery::OverlapSphere {
        center: [0.0; 3], radius: 1.0, mask: u32::MAX, exclude_id: Some(2),
    };
    assert!(validate_result(&filtered, &output).is_err());
}

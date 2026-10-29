use unone_engine::spatial::{execute_cpu, validate_batch, validate_result, SpatialBatch, SpatialBody, SpatialQuery};

fn main() {
    for x in [3e-23_f32, 1e-22_f32, 1e-20_f32, 1e-19_f32] {
        let batch = SpatialBatch {
            version: 1,
            bodies: vec![SpatialBody { id: 1, position: [x, 0., 0.], radius: 0., category: 1, previous_position: None }],
            queries: vec![SpatialQuery::Nearest { point: [0.; 3], max_distance: 1., mask: u32::MAX, exclude_id: None }],
        };
        validate_batch(&batch).unwrap();
        let output = execute_cpu(&batch).unwrap();
        println!("x={x:?} hit={:?} validation={:?}", output.results[0].hits[0], validate_result(&batch, &output));
    }
}

use unone_engine::{ProjectedFrame,FrameInitial};
#[test]
fn frame_revision_wire_is_lossless_at_safe_integer_boundary_and_u64_max() {
    for n in [1,9_007_199_254_740_991,9_007_199_254_740_992,u64::MAX] {
        let mut frame=ProjectedFrame::new(FrameInitial{rgb8:[20,40,60],depth:1.},vec![]).unwrap();frame.revision=n;
        let value=serde_json::to_value(&frame).unwrap();
        if n<=9_007_199_254_740_991 {assert_eq!(value["revision"].as_u64(),Some(n));}
        else {assert_eq!(value["revision"].as_str(),Some(n.to_string().as_str()));}
    }
}

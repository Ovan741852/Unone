//! Painter-ordered sprite instances. Batch only adjacent textures: regrouping
//! all sprites by texture would change alpha blending and equal-layer order.
use std::collections::BTreeMap;
use unone_engine::EntitySnapshot;

pub struct Run {
    pub asset: String,
    pub start: u32,
    pub count: u32,
}

#[derive(Default)]
pub struct Frame {
    pub instances: Vec<[f32; 6]>,
    pub runs: Vec<Run>,
}

impl Frame {
    pub fn prepare(&mut self, entities: &BTreeMap<String, EntitySnapshot>) {
        let mut ordered: Vec<_> = entities
            .iter()
            .filter_map(|(id, entity)| {
                entity
                    .sprite
                    .as_ref()
                    .filter(|sprite| sprite.visible)
                    .map(|sprite| (id, entity, sprite))
            })
            .collect();
        // Borrow IDs. The old draw-time sort cloned an ID at every comparison.
        ordered.sort_unstable_by(|a, b| (a.2.layer, a.0).cmp(&(b.2.layer, b.0)));
        self.instances.clear();
        let mut run_count = 0;
        for (_, entity, sprite) in ordered {
            let start = self.instances.len() as u32;
            self.instances.push([
                entity.transform.x as f32,
                entity.transform.y as f32,
                (sprite.size.x * entity.scale.x).abs() as f32,
                (sprite.size.y * entity.scale.y).abs() as f32,
                entity.rotation as f32,
                sprite.layer as f32,
            ]);
            if run_count > 0 && self.runs[run_count - 1].asset == sprite.asset {
                self.runs[run_count - 1].count += 1;
            } else {
                if let Some(run) = self.runs.get_mut(run_count) {
                    run.asset.clone_from(&sprite.asset);
                    run.start = start;
                    run.count = 1;
                } else {
                    self.runs.push(Run {
                        asset: sprite.asset.clone(),
                        start,
                        count: 1,
                    });
                }
                run_count += 1;
            }
        }
        self.runs.truncate(run_count);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use unone_engine::EngineRuntime;

    #[test]
    fn batching_preserves_paint_order_and_handles_visibility_removal_and_growth() {
        let scene = serde_json::from_value(serde_json::json!({"entities": [
            {"id":"2", "transform":{"x":2,"y":0}, "sprite":{"asset":"a","layer":0}},
            {"id":"10", "transform":{"x":10,"y":0}, "sprite":{"asset":"b","layer":0}},
            {"id":"back", "transform":{"x":-1,"y":0}, "sprite":{"asset":"a","layer":-1}},
            {"id":"3", "transform":{"x":3,"y":0}, "sprite":{"asset":"a","layer":0}},
            {"id":"hidden", "sprite":{"asset":"missing","visible":false}}
        ]}))
        .unwrap();
        let runtime = EngineRuntime::load_source(
            "sprites",
            "main.luau",
            "return {start=function(api) end,update=function(api,dt) end}",
            Some(scene),
        )
        .unwrap();
        let mut entities = runtime.observe().entities;
        let mut frame = Frame::default();
        frame.prepare(&entities);
        assert_eq!(
            frame.instances.iter().map(|v| v[0]).collect::<Vec<_>>(),
            [-1., 10., 2., 3.]
        );
        assert_eq!(
            frame
                .runs
                .iter()
                .map(|r| (r.asset.as_str(), r.start, r.count))
                .collect::<Vec<_>>(),
            [("a", 0, 1), ("b", 1, 1), ("a", 2, 2)]
        );
        entities
            .get_mut("10")
            .unwrap()
            .sprite
            .as_mut()
            .unwrap()
            .visible = false;
        frame.prepare(&entities);
        assert_eq!(frame.runs.len(), 1);
        assert_eq!(frame.runs[0].count, 3);
        let entity = entities["2"].clone();
        entities.clear();
        frame.prepare(&entities);
        assert!(frame.instances.is_empty() && frame.runs.is_empty());
        for i in 0..1000 {
            entities.insert(i.to_string(), entity.clone());
        }
        frame.prepare(&entities);
        assert_eq!(frame.instances.len(), 1000);
        assert_eq!(frame.runs.len(), 1);
        assert_eq!(frame.runs[0].count, 1000);
    }
}

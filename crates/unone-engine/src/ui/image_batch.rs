//! Immutable logical artwork resources. GPU batching and object lifetime belong
//! to the host; gameplay never receives a GPU buffer or material handle.
use super::{UiImageQuad, UiNode, UiRect, UiTree, ui_contract};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::{Arc, OnceLock}};

const MAX_ENCODED_RESOURCE_BYTES:usize=16*1024*1024;
const MAX_ENCODED_REGISTRY_BYTES:usize=32*1024*1024;

/// Local-to-stage affine transform: x'=a*x+c*y+tx, y'=b*x+d*y+ty.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiImageTransform {
    pub a: f64, pub b: f64, pub c: f64, pub d: f64, pub tx: f64, pub ty: f64,
}

impl Default for UiImageTransform {
    fn default() -> Self { Self { a:1., b:0., c:0., d:1., tx:0., ty:0. } }
}

impl UiImageTransform {
    pub fn point(&self, x:f64, y:f64) -> (f64,f64) {
        (self.a*x+self.c*y+self.tx, self.b*x+self.d*y+self.ty)
    }

    pub(crate) fn validate(&self, bounds:UiRect) -> Result<(),String> {
        if [self.a,self.b,self.c,self.d,self.tx,self.ty].iter().any(|n|!n.is_finite()) {
            return Err("UI_IMAGE_BATCH_TRANSFORM: all six affine values must be finite".into());
        }
        for x in [bounds.x,bounds.x+bounds.width] {
            for y in [bounds.y,bounds.y+bounds.height] {
                let (x,y)=self.point(x,y);
                if !x.is_finite() || !y.is_finite() {
                    return Err("UI_IMAGE_BATCH_TRANSFORM: transformed content bounds overflow".into());
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiImageBatchDefinition { pub bounds:UiRect, pub quads:Vec<UiImageQuad> }

impl UiImageBatchDefinition {
    pub fn validate(&self) -> Result<(),String> {
        validate_local_rect(self.bounds)?;
        if self.quads.is_empty() { return Err("UI_IMAGE_BATCH_EMPTY: content requires at least one quad".into()); }
        if self.quads.len() > ui_contract().host_max_nodes {
            return Err("UI_IMAGE_BATCH_RESOURCE_LIMIT: content exceeds the host quad budget".into());
        }
        if self.quads.iter().map(|q|q.asset.len()).sum::<usize>() > ui_contract().max_string_bytes {
            return Err("UI_STRING_LIMIT: image batch content exceeds the host string budget".into());
        }
        for (index,quad) in self.quads.iter().enumerate() {
            quad.validate_local(self.bounds).map_err(|e|format!("{e}; quad={index}"))?;
        }
        Ok(())
    }
}

pub(crate) fn validate_local_rect(r:UiRect) -> Result<(),String> {
    if [r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height].iter().any(|n|!n.is_finite())
        || r.width<=0. || r.height<=0. {
        return Err("UI_IMAGE_BATCH_BOUNDS: local rectangles need finite coordinates and positive dimensions".into());
    }
    Ok(())
}

#[derive(Debug)]
struct Generation { revision:u64, definition:UiImageBatchDefinition, asset_string_bytes:usize, encoded:OnceLock<Box<serde_json::value::RawValue>> }

/// Cheaply cloned, immutable Core-owned generation. Canonical snapshots retain
/// complete content even after replacement/removal in the live registry.
#[derive(Debug, Clone)]
pub struct UiImageBatchResource(Arc<Generation>);

impl UiImageBatchResource {
    pub fn revision(&self)->u64 { self.0.revision }
    pub fn bounds(&self)->UiRect { self.0.definition.bounds }
    pub fn quads(&self)->&[UiImageQuad] { &self.0.definition.quads }
    pub fn encoded_json(&self)->&serde_json::value::RawValue {
        #[derive(Serialize)]
        struct Wire<'a> { revision:u64, bounds:UiRect, quads:&'a [UiImageQuad] }
        self.0.encoded.get_or_init(||serde_json::value::to_raw_value(&Wire{revision:self.revision(),bounds:self.bounds(),quads:self.quads()}).expect("validated finite UI artwork"))
    }
    pub(crate) fn definition(&self)->&UiImageBatchDefinition { &self.0.definition }
    pub(crate) fn asset_string_bytes(&self)->usize { self.0.asset_string_bytes }
}

impl PartialEq for UiImageBatchResource {
    fn eq(&self,other:&Self)->bool { self.revision()==other.revision() && self.0.definition==other.0.definition }
}

impl Serialize for UiImageBatchResource {
    fn serialize<S:serde::Serializer>(&self,s:S)->Result<S::Ok,S::Error> {
        self.encoded_json().serialize(s)
    }
}

pub(crate) type Resources=BTreeMap<String,UiImageBatchResource>;

impl crate::world::World {
    pub(crate) fn define_ui_image_batch(&mut self,id:String,definition:UiImageBatchDefinition,tree:Option<&mut UiTree>)->Result<(),String> {
        if id.trim().is_empty() || id.len()>1024 { return Err("UI_IMAGE_BATCH_ID: resource id must contain 1..1024 bytes and non-whitespace text".into()); }
        definition.validate()?;
        if self.ui_image_batches.get(&id).is_some_and(|r|r.definition()==&definition) { return Ok(()); }
        let revision=self.ui_image_batch_revision.checked_add(1).filter(|v|*v<=9_007_199_254_740_991)
            .ok_or("UI_IMAGE_BATCH_REVISION: generation exhausted")?;
        let asset_string_bytes=definition.quads.iter().map(|q|q.asset.len()).sum();
        let resource=UiImageBatchResource(Arc::new(Generation {revision,definition,asset_string_bytes,encoded:OnceLock::new()}));
        let encoded_bytes=resource.encoded_json().get().len();
        if encoded_bytes>MAX_ENCODED_RESOURCE_BYTES {
            return Err(format!("UI_IMAGE_BATCH_ENCODED_LIMIT: resource JSON uses {encoded_bytes} bytes, limit={MAX_ENCODED_RESOURCE_BYTES}; escaped strings count at their encoded size"));
        }
        let mut candidate=self.ui_image_batches.clone();
        candidate.insert(id,resource);
        if candidate.len()>256 || candidate.values().map(|r|r.quads().len()).sum::<usize>()>ui_contract().host_max_nodes {
            return Err("UI_IMAGE_BATCH_RESOURCE_LIMIT: registry allows at most 256 resources and host_max_nodes total quads".into());
        }
        let bytes=candidate.iter().map(|(id,r)|id.len()+r.asset_string_bytes()).sum::<usize>();
        if bytes>ui_contract().max_string_bytes { return Err("UI_STRING_LIMIT: retained image registry exceeds string budget".into()); }
        let encoded_bytes=candidate.values().map(|r|r.encoded_json().get().len()).sum::<usize>();
        if encoded_bytes>MAX_ENCODED_REGISTRY_BYTES {
            return Err(format!("UI_IMAGE_BATCH_ENCODED_LIMIT: registry JSON definitions use {encoded_bytes} bytes, limit={MAX_ENCODED_REGISTRY_BYTES}"));
        }
        if let Some(tree)=tree {
            tree.validate_image_batch_resources(&candidate)?;
            tree.refresh_image_batch_counts(&candidate);
        }
        self.ui_image_batches=candidate;
        self.ui_image_batch_revision=revision;
        Ok(())
    }

    pub(crate) fn remove_ui_image_batch(&mut self,id:&str,tree:Option<&UiTree>)->Result<bool,String> {
        if tree.is_some_and(|tree|tree.references_image_batch(id)) {
            return Err(format!("UI_IMAGE_BATCH_IN_USE: '{id}' is referenced by the published UI; replace the tree before removal"));
        }
        Ok(self.ui_image_batches.remove(id).is_some())
    }
}

impl UiTree {
    pub fn references_image_batch(&self,id:&str)->bool {
        fn visit(nodes:&[UiNode],id:&str)->bool {
            nodes.iter().any(|n|matches!(n,UiNode::ImageBatch {content:Some(content),..} if content==id)||visit(n.children(),id))
        }
        visit(&self.children,id)
    }

    pub(crate) fn validate_image_batch_resources(&self,resources:&Resources)->Result<(),String> {
        fn visit(nodes:&[UiNode],resources:&Resources,count:&mut usize,bytes:&mut usize)->Result<(),String> {
            for node in nodes {
                *count+=1;
                if let UiNode::ImageBatch{quads,content,transform,..}=node {
                    if let Some(id)=content {
                        let resource=resources.get(id).ok_or_else(||format!("UI_IMAGE_BATCH_CONTENT: unknown content '{id}'"))?;
                        transform.unwrap_or_default().validate(resource.bounds())?;
                        *count+=resource.quads().len();
                        *bytes+=resource.asset_string_bytes();
                    } else { *count+=quads.len(); }
                }
                visit(node.children(),resources,count,bytes)?;
            }
            Ok(())
        }
        let (mut count,mut bytes)=(0,self.string_bytes);
        visit(&self.children,resources,&mut count,&mut bytes)?;
        let limit=self.budget.map_or(ui_contract().default_max_nodes,|b|b.max_nodes);
        if count>limit { return Err(format!("UI_NODE_LIMIT: used={count}, limit={limit}; retained image quads count for every instance")); }
        if bytes>ui_contract().max_string_bytes { return Err("UI_STRING_LIMIT: retained image instances exceed string budget".into()); }
        Ok(())
    }

    pub(crate) fn refresh_image_batch_counts(&mut self,resources:&Resources) {
        fn visit(nodes:&mut [UiNode],resources:&Resources) {
            for node in nodes {
                match node {
                    UiNode::ImageBatch{content:Some(id),resource_quad_count,..}=>*resource_quad_count=resources[id].quads().len(),
                    UiNode::Component{children,..}|UiNode::ScrollView{children,..}=>visit(children,resources),
                    _=>{}
                }
            }
        }
        visit(&mut self.children,resources);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition(count:usize)->UiImageBatchDefinition {
        let bounds=UiRect{x:-5.,y:-5.,width:10.,height:10.};
        UiImageBatchDefinition{bounds,quads:vec![UiImageQuad{asset:"texture://tile".into(),rect:bounds,source:None,opacity:None};count]}
    }

    #[test]
    fn retired_generation_is_released_after_last_snapshot_and_scene_reset_keeps_revision_monotonic() {
        let mut world=crate::world::World::default();
        world.define_ui_image_batch("art".into(),definition(1),None).unwrap();
        let snapshot=world.snapshot();
        let weak=Arc::downgrade(&snapshot.ui_image_batches["art"].0);
        let revision=snapshot.ui_image_batches["art"].revision();
        world.remove_ui_image_batch("art",None).unwrap();
        assert!(weak.upgrade().is_some());
        drop(snapshot);
        assert!(weak.upgrade().is_none(),"Core retains no retired generation history");
        world.define_ui_image_batch("art".into(),definition(1),None).unwrap();
        world.load_scene_data(crate::world::SceneFile::default()).unwrap();
        assert!(world.ui_image_batches.is_empty());
        world.define_ui_image_batch("art".into(),definition(1),None).unwrap();
        assert_eq!(world.ui_image_batches["art"].revision(),revision+2);
    }

    #[test]
    fn aggregate_retained_quad_budget_rejects_the_whole_new_generation() {
        let mut world=crate::world::World::default();
        let half=ui_contract().host_max_nodes/2;
        world.define_ui_image_batch("a".into(),definition(half),None).unwrap();
        world.define_ui_image_batch("b".into(),definition(half),None).unwrap();
        let revision=world.ui_image_batch_revision;
        assert!(world.define_ui_image_batch("c".into(),definition(1),None).unwrap_err().contains("UI_IMAGE_BATCH_RESOURCE_LIMIT"));
        assert_eq!(world.ui_image_batch_revision,revision);
        assert_eq!(world.ui_image_batches.len(),2);
    }

    #[test]
    fn encoded_escaping_budget_rejects_replacement_atomically_and_admits_the_exact_boundary() {
        let mut world=crate::world::World::default();
        world.define_ui_image_batch("art".into(),definition(1),None).unwrap();
        let before=world.ui_image_batches["art"].clone();
        // Each NUL is one raw UTF-8 byte but six JSON bytes. The existing raw
        // string budget alone therefore cannot establish a player wire bound.
        let mut oversized=definition(1);
        oversized.quads[0].asset="texture://".to_owned()+&"\0".repeat(3*1024*1024);
        assert!(world.define_ui_image_batch("art".into(),oversized,None).unwrap_err().contains("UI_IMAGE_BATCH_ENCODED_LIMIT"));
        assert_eq!(world.ui_image_batches["art"],before);
        assert_eq!(world.ui_image_batch_revision,before.revision());

        let mut exact=definition(1);
        let empty_bytes=before.encoded_json().get().len();
        let padding=MAX_ENCODED_RESOURCE_BYTES-empty_bytes;
        exact.quads[0].asset.push_str(&"\0".repeat(padding/6));
        exact.quads[0].asset.push_str(&"x".repeat(padding%6));
        world.define_ui_image_batch("art".into(),exact.clone(),None).unwrap();
        assert_eq!(world.ui_image_batches["art"].encoded_json().get().len(),MAX_ENCODED_RESOURCE_BYTES);
        let accepted=world.ui_image_batches["art"].clone();
        exact.quads[0].asset.push('x');
        assert!(world.define_ui_image_batch("art".into(),exact,None).unwrap_err().contains("UI_IMAGE_BATCH_ENCODED_LIMIT"));
        assert_eq!(world.ui_image_batches["art"],accepted);
    }

    #[test]
    fn aggregate_encoded_budget_counts_cached_definitions_before_committing_a_new_resource() {
        let mut world=crate::world::World::default();
        world.define_ui_image_batch("seed".into(),definition(1),None).unwrap();
        let base=world.ui_image_batches["seed"].encoded_json().get().len();
        world.remove_ui_image_batch("seed",None).unwrap();
        let padding=MAX_ENCODED_RESOURCE_BYTES-base;
        let mut exact=definition(1);
        exact.quads[0].asset.push_str(&"\0".repeat(padding/6));
        exact.quads[0].asset.push_str(&"x".repeat(padding%6));
        world.define_ui_image_batch("a".into(),exact.clone(),None).unwrap();
        world.define_ui_image_batch("b".into(),exact,None).unwrap();
        assert_eq!(world.ui_image_batches.values().map(|r|r.encoded_json().get().len()).sum::<usize>(),MAX_ENCODED_REGISTRY_BYTES);
        let revision=world.ui_image_batch_revision;
        assert!(world.define_ui_image_batch("c".into(),definition(1),None).unwrap_err().contains("UI_IMAGE_BATCH_ENCODED_LIMIT"));
        assert_eq!(world.ui_image_batch_revision,revision);
        assert_eq!(world.ui_image_batches.len(),2);
    }
}

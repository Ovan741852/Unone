//! Native presentation receipts are host facts, never inferred from Core intent.
//! Only the current plan is retained; GPU textures have separate shared owners.
use std::collections::{BTreeMap, BTreeSet};
use unone_engine::{PresentationResourceInput, SpriteAppearanceReceipt, SpriteResourcePlan,
    SpriteResourceReceipt, SpriteResourceState, SpriteSubmissionState, WorldSnapshot};

pub(crate) const SHADER_UNSUPPORTED: &str = "SHADER_BACKEND_UNSUPPORTED: GLSL sprite shader materials require the official WebGL player; native wgpu does not implement this contract";
pub fn next_epoch() -> u64 {
    static NEXT:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)
}
pub fn declaration()->serde_json::Value {
    serde_json::json!({"input":"InputFrame.presentation_resources","prepared":"texture upload commands queued in current renderer epoch",
        "appearance":"visible resource/UV/uniform revision drawn, or committed hidden absence applied, in successful surface submission; not OS scanout",
        "feedback_batch_limit":256,"preload":"explicit api.sprite resource plans; declared pages alone do not upload",
        "release":"last plan/visible sprite/projected owner retires its texture; mesh-owned textures remain pinned",
        "managed_budget":{"configured_by":"content/image-assets.json budget","default_max_bytes":64*1024*1024,"default_max_entries":128},
        "budget_excludes":"ordinary unprepared sprites, projected textures, mesh textures, UI, temporary incoming/outgoing overlap and driver/in-flight allocations",
        "shader_materials":{"supported":false,"error":"SHADER_BACKEND_UNSUPPORTED"},
        "headless":"no GPU readiness or submission feedback","replay":"recorded feedback remains authoritative"})
}
#[derive(Clone, Copy)]
pub(crate) struct Budget {pub max_bytes:u64,pub max_entries:usize}
impl Default for Budget {
    fn default()->Self {Self {max_bytes:64*1024*1024,max_entries:128}}
}
impl Budget {
    pub fn from_plan(bytes:Option<&[u8]>)->Result<Self,String> {
        let Some(bytes)=bytes else {return Ok(Self::default());};
        let value:serde_json::Value=serde_json::from_slice(bytes).map_err(|e|format!("IMAGE_PRELOAD_PLAN_INVALID: {e}"))?;
        let Some(budget)=value.get("budget") else {return Ok(Self::default());};
        let object=budget.as_object().ok_or("IMAGE_PRELOAD_BUDGET_INVALID: expected object")?;
        if object.keys().any(|key|key!="max_bytes" && key!="max_entries") {
            return Err("IMAGE_PRELOAD_BUDGET_INVALID: unknown field".into());
        }
        let defaults=Self::default();
        let integer=|key:&str,default:u64,max:u64|match object.get(key) {
            None=>Ok(default),Some(value)=>value.as_u64().filter(|n|*n>0 && *n<=max)
                .ok_or_else(||format!("IMAGE_PRELOAD_BUDGET_INVALID: {key}")),
        };
        Ok(Self {max_bytes:integer("max_bytes",defaults.max_bytes,1024*1024*1024)?,
            max_entries:integer("max_entries",defaults.max_entries as u64,65536)? as usize})
    }
}

#[derive(Clone)]
pub(crate) struct TextureDeclaration {
    kind: String,
    source: String,
}

pub(crate) struct TextureCatalog(BTreeMap<String, TextureDeclaration>);
impl TextureCatalog {
    pub fn new(assets: &[serde_json::Value]) -> Result<Self, String> {
        let mut entries = BTreeMap::new();
        for asset in assets {
            let id = asset["id"].as_str().ok_or("ASSET_ID_MISSING")?;
            let kind = asset["kind"].as_str().ok_or("ASSET_KIND_MISSING")?;
            let source = asset["source"].as_str().ok_or("ASSET_SOURCE_MISSING")?;
            if entries.insert(id.into(), TextureDeclaration {kind:kind.into(),source:source.into()}).is_some() {
                return Err(format!("ASSET_MANIFEST_DUPLICATE_ID: {id}"));
            }
        }
        Ok(Self(entries))
    }
    pub fn texture_source(&self, id: &str) -> Result<&str, String> {
        let entry = self.0.get(id).ok_or_else(|| format!("SPRITE_ASSET_UNKNOWN: {id}"))?;
        if entry.kind != "texture2d" { return Err(format!("SPRITE_ASSET_KIND_INVALID: {id} must be texture2d")); }
        Ok(&entry.source)
    }
}

pub(crate) struct Resources {
    epoch: u64,
    plans: BTreeMap<String, SpriteResourcePlan>,
    receipts: BTreeMap<String, SpriteResourceReceipt>,
    submitted: BTreeMap<String, SpriteAppearanceReceipt>,
    pub budget: Budget,
    resource_cursor:usize,
    appearance_cursor:usize,
}
impl Resources {
    pub fn new(epoch: u64,budget:Budget) -> Self {
        Self {epoch,plans:BTreeMap::new(),receipts:BTreeMap::new(),submitted:BTreeMap::new(),
            budget,resource_cursor:0,appearance_cursor:0}
    }
    pub fn reconcile(&mut self, plan: &[SpriteResourcePlan], mut upload: impl FnMut(&str,u64)->Result<Option<u64>,String>) {
        let live: BTreeSet<_> = plan.iter().map(|p|p.id.as_str()).collect();
        self.plans.retain(|id,_|live.contains(id.as_str()));
        self.receipts.retain(|id,_|live.contains(id.as_str()));
        let mut resident:BTreeMap<String,u64>=plan.iter().filter_map(|p| {
            let old=self.plans.get(&p.id)?;
            let receipt=self.receipts.get(&p.id)?;
            (same_plan(old,p) && receipt.state==SpriteResourceState::Ready).then(||(p.asset.clone(),receipt.bytes))
        }).collect();
        for entry in plan {
            // Plan identity is immutable, but also compare its descriptor so a
            // malformed/replaced plan cannot inherit another asset's readiness.
            if self.plans.get(&entry.id).is_some_and(|old|same_plan(old,entry))
                && self.receipts.get(&entry.id).is_some_and(|r|r.state!=SpriteResourceState::Loading) {continue;}
            let result = if entry.material_id.is_some() || entry.material.is_some() {
                Err(SHADER_UNSUPPORTED.into())
            } else if let Some(bytes)=resident.get(&entry.asset) {Ok(Some(*bytes))}
            else if resident.len()>=self.budget.max_entries {Ok(None)}
            else {upload(&entry.asset,self.budget.max_bytes.saturating_sub(resident.values().sum::<u64>()))};
            let (state,bytes,error) = match result {
                Ok(Some(bytes))=>{resident.insert(entry.asset.clone(),bytes);(SpriteResourceState::Ready,bytes,None)},
                Ok(None)=>(SpriteResourceState::Loading,0,None),
                Err(error)=>(SpriteResourceState::Error,0,Some(bounded_error(error))),
            };
            self.receipts.insert(entry.id.clone(),SpriteResourceReceipt {
                id:entry.id.clone(),state,epoch:self.epoch,bytes,error,
            });
            self.plans.insert(entry.id.clone(),entry.clone());
        }
    }
    pub fn ready_assets(&self) -> BTreeSet<String> {
        self.receipts.iter().filter(|(_,r)|r.state==SpriteResourceState::Ready)
            .filter_map(|(id,_)|self.plans.get(id).map(|p|p.asset.clone())).collect()
    }
    pub fn report(&self)->serde_json::Value {
        let count=|state|self.receipts.values().filter(|r|r.state==state).count();
        serde_json::json!({"epoch":self.epoch,"planned_resources":self.plans.len(),
            "ready":count(SpriteResourceState::Ready),"loading":count(SpriteResourceState::Loading),
            "errors":count(SpriteResourceState::Error),"prepared_unique_assets":self.ready_assets().len()})
    }
    pub fn drawable(&self, entity: &unone_engine::EntitySnapshot) -> bool {
        let Some(appearance)=&entity.sprite_appearance else {return entity.shader_material.is_none();};
        self.receipts.get(&appearance.resource).is_some_and(|r|r.state==SpriteResourceState::Ready)
            && self.plans.get(&appearance.resource).is_some_and(|p|entity.sprite.as_ref().is_some_and(|s|s.asset==p.asset))
            && entity.shader_material.is_none()
    }
    pub fn submitted(&mut self, snapshot: &WorldSnapshot, scene_drawn: bool) {
        self.submitted.clear();
        for (id,entity) in &snapshot.entities {
            let Some(appearance)=&entity.sprite_appearance else {continue;};
            let Some(sprite)=&entity.sprite else {continue;};
            // A committed hide acknowledges absence after a successful frame;
            // its resource owner may already have retired. Visible content must
            // actually enter the scene pass with a prepared texture.
            if sprite.visible && (!scene_drawn || !self.drawable(entity)) {continue;}
            self.submitted.insert(id.clone(),SpriteAppearanceReceipt {entity:id.clone(),revision:appearance.revision,
                state:SpriteSubmissionState::Submitted,epoch:self.epoch,error:None});
        }
    }
    pub fn feedback(&mut self, snapshot: &WorldSnapshot) -> PresentationResourceInput {
        let errors:Vec<_>=snapshot.entities.iter().filter_map(|(id,entity)| {
            let appearance=entity.sprite_appearance.as_ref()?;
            if !entity.sprite.as_ref().is_some_and(|sprite|sprite.visible) {return None;}
            let error=if entity.shader_material.is_some() {Some(SHADER_UNSUPPORTED.into())}
                else if let Some(receipt)=self.receipts.get(&appearance.resource) {
                    if receipt.state==SpriteResourceState::Error {receipt.error.clone()}
                    else if self.plans.get(&appearance.resource).is_some_and(|plan|entity.sprite.as_ref().is_some_and(|s|s.asset!=plan.asset)) {
                        Some("SPRITE_APPEARANCE_RESOURCE_MISMATCH: asset differs from prepared resource".into())
                    } else {None}
                } else {Some("SPRITE_RESOURCE_RELEASED: appearance has no live resource plan".into())}?;
            Some(SpriteAppearanceReceipt {entity:id.clone(),revision:appearance.revision,state:SpriteSubmissionState::Error,
                epoch:self.epoch,error:Some(error)})
        }).collect();
        let valid:Vec<_>=self.submitted.iter().filter(|(id,receipt)|snapshot.entities.get(*id)
            .is_some_and(|e|e.sprite.as_ref().is_some_and(|s|!s.visible || self.drawable(e)) && e.sprite_appearance.as_ref()
                .is_some_and(|a|a.revision==receipt.revision)))
            .map(|(_,r)|r).chain(errors.iter()).collect();
        let appearances=receipt_batch(&valid,&mut self.appearance_cursor);
        let resources=receipt_batch(&self.receipts.values().collect::<Vec<_>>(),&mut self.resource_cursor);
        PresentationResourceInput {resources,appearances}
    }
}
fn same_plan(a:&SpriteResourcePlan,b:&SpriteResourcePlan)->bool {
    a.asset==b.asset && a.material_id==b.material_id && a.material==b.material
}
fn bounded_error(mut error:String)->String {
    if error.is_empty(){return "NATIVE_SPRITE_RESOURCE_FAILED".into();}
    if error.len()>4096 {let mut end=4096;while !error.is_char_boundary(end){end-=1;}error.truncate(end);}
    error
}
fn receipt_batch<T:Clone>(rows:&[&T],cursor:&mut usize)->Vec<T> {
    if rows.is_empty(){*cursor=0;return Vec::new();}
    let count=rows.len().min(256);
    let batch=(0..count).map(|n|(*rows[(*cursor+n)%rows.len()]).clone()).collect();
    *cursor=(*cursor+count)%rows.len();batch
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan(id:&str,asset:&str)->SpriteResourcePlan {
        SpriteResourcePlan {id:id.into(),asset:asset.into(),material_id:None,material:None}
    }
    fn snapshot()->WorldSnapshot {
        let scene=serde_json::from_value(serde_json::json!({"entities":[{"id":"actor","sprite":{"asset":"atlas"}}]})).unwrap();
        let runtime=unone_engine::EngineRuntime::load_source("native-resources","main.luau",
            "return {start=function()end,update=function()end}",Some(scene)).unwrap();
        let mut s=runtime.observe();
        s.entities.get_mut("actor").unwrap().sprite_appearance=Some(unone_engine::SpriteAppearanceMetadata {resource:"1".into(),revision:1});
        s
    }
    #[test]
    fn catalog_is_lazy_and_shared_asset_uploads_once_for_multiple_owners() {
        let assets:Vec<_>=(0..806).map(|i|serde_json::json!({"id":format!("atlas{i}"),"kind":"texture2d","source":format!("{i}.png")})).collect();
        let catalog=TextureCatalog::new(&assets).unwrap();
        let mut resources=Resources::new(1,Budget::default());let mut uploads=0;
        resources.reconcile(&[],|_,_|{uploads+=1;unreachable!()});
        assert_eq!(uploads,0,"declaring pages never preloads them");
        let plans=[plan("1","atlas7"),plan("2","atlas7")];
        resources.reconcile(&plans,|id,_|{assert_eq!(catalog.texture_source(id).unwrap(),"7.png");uploads+=1;Ok(Some(64))});
        resources.reconcile(&plans,|_,_|panic!("unchanged plans must not upload again"));
        assert_eq!(uploads,1);assert_eq!(resources.ready_assets().len(),1);
        resources.reconcile(&[plans[1].clone()],|_,_|panic!("surviving shared owner"));
        assert_eq!(resources.ready_assets().len(),1);
        resources.reconcile(&[],|_,_|unreachable!());
        assert!(resources.ready_assets().is_empty());assert!(resources.receipts.is_empty());
    }
    #[test]
    fn invalid_assets_and_unsupported_materials_never_become_ready_or_upload() {
        let catalog=TextureCatalog::new(&[serde_json::json!({"id":"sound","kind":"audio","source":"s.wav"})]).unwrap();
        let mut shader=plan("3","atlas");shader.material_id=Some("custom".into());
        let mut resources=Resources::new(9,Budget::default());
        resources.reconcile(&[plan("1","missing"),plan("2","sound"),shader],|id,_| {
            assert_ne!(id,"atlas","unsupported shader must fail before image work");
            catalog.texture_source(id)?;unreachable!()
        });
        assert!(resources.ready_assets().is_empty());
        assert!(resources.receipts.values().all(|r|r.state==SpriteResourceState::Error && r.epoch==9));
        assert!(resources.receipts["1"].error.as_ref().unwrap().contains("SPRITE_ASSET_UNKNOWN"));
        assert!(resources.receipts["2"].error.as_ref().unwrap().contains("SPRITE_ASSET_KIND_INVALID"));
        assert_eq!(resources.receipts["3"].error.as_deref(),Some(SHADER_UNSUPPORTED));
    }
    #[test]
    fn configured_budget_queues_demand_and_retries_after_release_without_game_caps() {
        let mut resources=Resources::new(1,Budget {max_bytes:8,max_entries:2});
        let plans=[plan("1","a"),plan("2","b")];
        resources.reconcile(&plans,|_,available|Ok((available>=6).then_some(6)));
        assert_eq!(resources.receipts["1"].state,SpriteResourceState::Ready);
        assert_eq!(resources.receipts["2"].state,SpriteResourceState::Loading);
        resources.reconcile(&[plans[1].clone()],|_,available|Ok((available>=6).then_some(6)));
        assert_eq!(resources.receipts["2"].state,SpriteResourceState::Ready);
        let mut resources=Resources::new(1,Budget {max_bytes:4096,max_entries:40});
        let plans:Vec<_>=(0..40).map(|i|plan(&i.to_string(),&format!("asset{i}"))).collect();
        resources.reconcile(&plans,|_,_|Ok(Some(16)));
        assert_eq!(resources.ready_assets().len(),40,"12 slots belongs to Game policy");
    }
    #[test]
    fn prepared_is_not_submitted_and_stale_hidden_removed_or_undrawn_frames_do_not_acknowledge() {
        let mut resources=Resources::new(4,Budget::default());let mut s=snapshot();
        resources.reconcile(&[plan("1","atlas")],|_,_|Ok(Some(16)));
        assert!(resources.feedback(&s).appearances.is_empty(),"surface timeout/prepare alone produces no submission");
        resources.submitted(&s,true);
        assert_eq!(resources.feedback(&s).appearances[0].state,SpriteSubmissionState::Submitted);
        s.entities.get_mut("actor").unwrap().sprite_appearance.as_mut().unwrap().revision=2;
        assert!(resources.feedback(&s).appearances.is_empty(),"new intent cannot inherit old submitted revision");
        resources.submitted(&s,false);assert!(resources.feedback(&s).appearances.is_empty(),"scene pass disabled");
        resources.submitted(&s,true);
        s.entities.get_mut("actor").unwrap().sprite.as_mut().unwrap().visible=false;
        s.entities.get_mut("actor").unwrap().sprite_appearance=None;
        assert!(resources.feedback(&s).appearances.is_empty());
        s.entities.clear();assert!(resources.feedback(&s).appearances.is_empty());
    }
    #[test]
    fn committed_hidden_absence_is_acknowledged_only_after_surface_submission_without_resource() {
        let mut resources=Resources::new(2,Budget::default());let mut s=snapshot();
        s.entities.get_mut("actor").unwrap().sprite.as_mut().unwrap().visible=false;
        assert!(resources.feedback(&s).appearances.is_empty());
        resources.submitted(&s,false);
        let feedback=resources.feedback(&s);assert!(feedback.resources.is_empty());
        assert_eq!(feedback.appearances[0].state,SpriteSubmissionState::Submitted);
        assert_eq!(feedback.appearances[0].epoch,2);
    }
    #[test]
    fn unsupported_managed_appearance_is_an_error_and_never_a_fallback_quad() {
        let mut s=snapshot();s.entities.get_mut("actor").unwrap().shader_material=Some("custom".into());
        let mut shader=plan("1","atlas");shader.material_id=Some("custom".into());
        let mut resources=Resources::new(1,Budget::default());
        resources.reconcile(&[shader],|_,_|panic!("no image upload for unsupported shader"));
        let mut frame=crate::sprites::Frame::default();frame.prepare_selected(&s.entities,|e|resources.drawable(e));
        assert!(frame.instances.is_empty());resources.submitted(&s,true);
        let feedback=resources.feedback(&s);assert_eq!(feedback.appearances[0].state,SpriteSubmissionState::Error);
        assert_eq!(feedback.appearances[0].error.as_deref(),Some(SHADER_UNSUPPORTED));
    }
    #[test]
    fn feedback_batches_are_bounded_and_fair_and_new_renderer_epochs_have_no_old_ack() {
        let mut resources=Resources::new(1,Budget::default());let s=snapshot();
        let plans:Vec<_>=(0..600).map(|i|plan(&i.to_string(),"atlas")).collect();
        resources.reconcile(&plans,|_,_|Ok(Some(16)));
        let mut seen=BTreeSet::new();
        for _ in 0..3 {let input=resources.feedback(&s);assert_eq!(input.resources.len(),256);
            input.validate().unwrap();seen.extend(input.resources.into_iter().map(|r|r.id));}
        assert_eq!(seen.len(),600);
        resources.submitted(&s,true);
        let new=Resources::new(2,Budget::default());assert!(new.submitted.is_empty());assert!(new.receipts.is_empty());
        assert!(next_epoch()<next_epoch());
    }
    #[test]
    fn budget_defaults_partial_overrides_and_invalid_values_are_explicit() {
        assert_eq!(Budget::from_plan(None).unwrap().max_bytes,64*1024*1024);
        assert_eq!(Budget::from_plan(Some(br#"{"budget":{"max_entries":7}}"#)).unwrap().max_entries,7);
        for bytes in [br#"{"budget":null}"#.as_slice(),br#"{"budget":{"max_bytes":0}}"#,
            br#"{"budget":{"max_entries":1.5}}"#,br#"{"budget":{"typo":1}}"#] {
            assert!(Budget::from_plan(Some(bytes)).is_err());
        }
    }
}

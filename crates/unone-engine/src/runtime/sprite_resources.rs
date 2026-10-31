//! VM-local ownership and transactional presentation feedback, never GPU state.
use super::*;
use crate::sprite_resources::*;
use std::rc::Weak;

#[derive(Debug)]
pub(super) struct Resource { pub id: String, pub asset: String, pub material_id: Option<String>, pub material: Option<crate::ShaderMaterialDefinition> }

#[derive(Debug, Clone)]
struct Record {
    resource: Weak<Resource>, caller: Weak<()>, released: bool, state: SpriteResourceState,
    epoch: u64, bytes: u64, error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommitStatus {
    pub requested_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submitted_revision: Option<u64>,
    pub state: String, pub epoch: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
struct Commit { resource: Weak<Resource>, resource_id: String, appearance: SpriteAppearance, status: CommitStatus }

#[derive(Debug, Clone)]
pub(super) struct Registry {
    catalog: Rc<BTreeSet<String>>, records: Rc<BTreeMap<String, Record>>,
    commits: Rc<BTreeMap<String, Rc<Commit>>>, next_id: u64, next_revision: u64,
    owners: Rc<BTreeMap<String, Rc<Resource>>>,
    plan_revision: u64,
    undo: Option<BTreeMap<String, crate::world::EntityState>>,
}

impl Registry {
    /// Keeps only declared textures, the one kind a sprite resource accepts. The
    /// size follows the project's own manifest; large games declare 100k assets.
    pub fn new(catalog: Vec<AssetCatalogEntry>) -> Result<Self, String> {
        let mut textures = BTreeSet::new();
        for entry in catalog {
            if entry.id.trim().is_empty() || entry.id.len() > 1024 || entry.kind.is_empty() || entry.kind.len() > 64 {
                return Err("SPRITE_CATALOG_INVALID: invalid asset id/kind".into());
            }
            if entry.kind == "texture2d" && !textures.insert(entry.id) {
                return Err("SPRITE_CATALOG_INVALID: duplicate texture asset id".into());
            }
        }
        Ok(Self { catalog: Rc::new(textures), records: Rc::default(), commits: Rc::default(), owners: Rc::default(), next_id: 0, next_revision: 0, plan_revision: 0, undo: None })
    }

    pub fn reconcile(&mut self, world: &World) {
        let before = (self.owners.len(), self.records.len());
        let current_commit = |id: &String, c: &Rc<Commit>| world.entities.get(id).is_some_and(|e|
            e.sprite_appearance.as_ref().is_some_and(|m| m.resource == c.resource_id && m.revision == c.status.requested_revision));
        if self.commits.iter().any(|(id, c)| !current_commit(id, c)) { Rc::make_mut(&mut self.commits).retain(|id, c| current_commit(id, c)); }
        let current_owner = |id: &String, r: &Rc<Resource>| world.entities.get(id).is_some_and(|e| {
            e.sprite.as_ref().is_some_and(|s| s.visible && s.asset == r.asset)
                && e.shader_material == r.material_id
                && e.sprite_appearance.as_ref().is_some_and(|m| m.resource == r.id)
        });
        if self.owners.iter().any(|(id, r)| !current_owner(id, r)) { Rc::make_mut(&mut self.owners).retain(|id, r| current_owner(id, r)); }
        let owners = &self.owners;
        let current_record = |id: &String, r: &Record| r.caller.strong_count() > 0 || owners.values().any(|o| o.id == *id);
        if self.records.iter().any(|(id, r)| !current_record(id, r)) { Rc::make_mut(&mut self.records).retain(|id, r| current_record(id, r)); }
        if before != (self.owners.len(), self.records.len()) { self.changed(); }
    }

    pub fn prepare(&mut self, world: &World, asset: String, material_id: Option<String>) -> Result<(Rc<Resource>, Rc<()>), String> {
        self.reconcile(world);
        if !self.catalog.contains(&asset) {
            return Err(format!("SPRITE_ASSET_INVALID: '{asset}' must be a declared texture2d asset"));
        }
        let material = material_id.as_ref().map(|id| world.shader_materials.get(id).cloned()
            .ok_or_else(|| format!("SHADER_MATERIAL_UNKNOWN: '{id}' is not declared"))).transpose()?;
        if self.records.len() >= MAX_SPRITE_RESOURCES {
            return Err("SPRITE_RESOURCE_LIMIT: at most 4096 live resources".into());
        }
        self.next_id = next(self.next_id)?;
        let resource = Rc::new(Resource { id: self.next_id.to_string(), asset, material_id, material });
        let caller = Rc::new(());
        Rc::make_mut(&mut self.records).insert(resource.id.clone(), Record { resource: Rc::downgrade(&resource), caller: Rc::downgrade(&caller), released: false,
            state: SpriteResourceState::Loading, epoch: 0, bytes: 0, error: None });
        self.changed();
        Ok((resource, caller))
    }

    fn record(&self, resource: &Rc<Resource>) -> Result<&Record, String> {
        self.records.get(&resource.id).filter(|r| r.resource.upgrade().is_some_and(|x| Rc::ptr_eq(&x, resource)))
            .ok_or_else(|| "SPRITE_RESOURCE_RELEASED: resource does not belong to this runtime generation".into())
    }

    pub fn status(&self, resource: &Rc<Resource>) -> Result<serde_json::Value, String> {
        let r = self.record(resource)?;
        Ok(serde_json::json!({"state": if r.released { "released" } else { match r.state {
            SpriteResourceState::Loading => "loading", SpriteResourceState::Ready => "ready", SpriteResourceState::Error => "error" } },
            "epoch":r.epoch,"bytes":r.bytes,"error":r.error}))
    }

    pub fn release(&mut self, resource: &Rc<Resource>) -> Result<(), String> {
        self.record(resource)?;
        let record = Rc::make_mut(&mut self.records).get_mut(&resource.id).unwrap();
        if !record.released { record.released = true; self.changed(); }
        Ok(())
    }

    pub fn plan(&self) -> Vec<SpriteResourcePlan> {
        let owned: BTreeSet<_> = self.owners.values().map(|r| r.id.as_str()).collect();
        self.records.values().filter_map(|record| {
            let r = record.resource.upgrade()?;
            let committed = owned.contains(r.id.as_str());
            if (record.released || record.caller.strong_count() == 0) && !committed { return None; }
            Some(SpriteResourcePlan { id: r.id.clone(), asset: r.asset.clone(), material_id: r.material_id.clone(), material: r.material.clone() })
        }).collect()
    }

    fn changed(&mut self) { self.plan_revision = self.plan_revision.saturating_add(1).min(MAX_PRESENTATION_INTEGER); }
    pub fn plan_since(&self, after: Option<u64>) -> SpriteResourcePlanUpdate {
        SpriteResourcePlanUpdate { revision: self.plan_revision, resources: (after != Some(self.plan_revision)).then(|| self.plan()) }
    }

    pub fn commit(&mut self, world: &mut World, entity: &str, resource: Rc<Resource>, appearance: SpriteAppearance) -> Result<Option<u64>, String> {
        let prepared = world.validate_sprite_appearance(entity, &resource.asset, resource.material_id.as_deref(), &appearance)?;
        let record = self.record(&resource)?;
        if record.released { return Err("SPRITE_RESOURCE_RELEASED: cannot commit a released handle".into()); }
        if record.state != SpriteResourceState::Ready { return Ok(None); }
        let epoch = record.epoch;
        if let Some(c) = self.commits.get(entity)
            && c.resource.upgrade().is_some_and(|r| Rc::ptr_eq(&r, &resource)) && c.appearance == appearance
            && world.matches_sprite_appearance(entity, &prepared) {
                return Ok(Some(c.status.requested_revision));
            }
        let revision = next(self.next_revision)?;
        if let Some(undo) = &mut self.undo { undo.entry(entity.into()).or_insert_with(|| world.entities[entity].clone()); }
        world.apply_sprite_appearance(entity, prepared, SpriteAppearanceMetadata { resource: resource.id.clone(), revision });
        self.next_revision = revision;
        let old_owner = self.owners.get(entity).map(|r| r.id.clone());
        let new_owner = appearance.visible.then(|| resource.id.clone());
        let ownership_changed = old_owner != new_owner;
        if ownership_changed {
            if appearance.visible { Rc::make_mut(&mut self.owners).insert(entity.into(), Rc::clone(&resource)); }
            else { Rc::make_mut(&mut self.owners).remove(entity); }
        }
        Rc::make_mut(&mut self.commits).insert(entity.into(), Rc::new(Commit { resource: Rc::downgrade(&resource), resource_id: resource.id.clone(), appearance, status: CommitStatus {
            requested_revision: revision, submitted_revision: None, state: "pending".into(), epoch, error: None } }));
        if ownership_changed { self.changed(); }
        Ok(Some(revision))
    }

    pub fn get_commit(&self, world: &World, entity: &str) -> Result<CommitStatus, String> {
        if !world.entities.contains_key(entity) { return Err(format!("ENTITY_UNKNOWN: '{entity}'")); }
        let current = self.commits.get(entity).filter(|c| world.entities[entity].sprite_appearance.as_ref()
            .is_some_and(|m| m.resource == c.resource_id && m.revision == c.status.requested_revision));
        Ok(current.map(|c| c.status.clone()).unwrap_or(CommitStatus {
            requested_revision: 0, submitted_revision: None, state: "none".into(), epoch: 0, error: None }))
    }

    fn feedback(&mut self, input: &PresentationResourceInput) -> Result<(), String> {
        if input.is_empty() { return Ok(()); }
        for receipt in &input.resources {
            let Some(record) = self.records.get(&receipt.id) else { continue; };
            if record.state == receipt.state && record.epoch == receipt.epoch
                && record.bytes == receipt.bytes && record.error == receipt.error { continue; }
            let committed = self.owners.values().any(|r| r.id == receipt.id);
            if ((record.released || record.caller.strong_count() == 0) && !committed)
                || receipt.epoch < record.epoch { continue; }
            let record = Rc::make_mut(&mut self.records).get_mut(&receipt.id).unwrap();
            record.state = receipt.state; record.epoch = receipt.epoch;
            record.bytes = receipt.bytes; record.error = receipt.error.clone();
            for c in Rc::make_mut(&mut self.commits).values_mut().filter(|c| c.resource_id == receipt.id) {
                let c = Rc::make_mut(c);
                if c.status.epoch != receipt.epoch || receipt.state != SpriteResourceState::Ready {
                    c.status.submitted_revision = None; c.status.state = "pending".into();
                    c.status.epoch = receipt.epoch; c.status.error = None;
                }
            }
        }
        for receipt in &input.appearances {
            let Some(c) = self.commits.get(&receipt.entity) else { continue; };
            if receipt.revision != c.status.requested_revision { continue; }
            if !c.appearance.visible {
                // Rendering absence needs no retained texture, including after restore.
                if receipt.epoch < c.status.epoch { continue; }
            } else {
                let Some(r) = self.records.get(&c.resource_id) else { continue; };
                if receipt.epoch != r.epoch || (receipt.state == SpriteSubmissionState::Submitted
                    && r.state != SpriteResourceState::Ready) { continue; }
            }
            let state = match receipt.state { SpriteSubmissionState::Submitted => "submitted", SpriteSubmissionState::Error => "error" };
            let submitted = (receipt.state == SpriteSubmissionState::Submitted).then_some(receipt.revision);
            if c.status.epoch == receipt.epoch && c.status.error == receipt.error
                && c.status.state == state && c.status.submitted_revision == submitted { continue; }
            let c = Rc::make_mut(Rc::make_mut(&mut self.commits).get_mut(&receipt.entity).unwrap());
            c.status.epoch = receipt.epoch; c.status.error = receipt.error.clone();
            c.status.state = state.into(); c.status.submitted_revision = submitted;
        }
        Ok(())
    }
}

fn next(value: u64) -> Result<u64, String> {
    value.checked_add(1).filter(|v| *v <= MAX_PRESENTATION_INTEGER)
        .ok_or_else(|| "SPRITE_REVISION_EXHAUSTED: exact presentation counter exhausted".into())
}

pub(super) struct Tick {
    registry: Rc<RefCell<Registry>>, world: Rc<RefCell<World>>, checkpoint: Option<Registry>,
}
impl Tick {
    pub fn begin(registry: &Rc<RefCell<Registry>>, world: &Rc<RefCell<World>>, input: &PresentationResourceInput) -> Result<Self, String> {
        let checkpoint = registry.borrow().clone();
        // Construct rollback before any admission work. Even a future checked
        // feedback error must restore the old registry, not partially publish it.
        let guard = Self { registry: Rc::clone(registry), world: Rc::clone(world), checkpoint: Some(checkpoint) };
        { let mut current = registry.borrow_mut();
          current.reconcile(&world.borrow()); current.feedback(input)?;
          current.undo = Some(BTreeMap::new()); }
        Ok(guard)
    }
    pub fn commit(mut self) { self.registry.borrow_mut().undo = None; self.checkpoint = None; }
}
impl Drop for Tick {
    fn drop(&mut self) {
        let Some(mut checkpoint) = self.checkpoint.take() else { return; };
        let mut registry = self.registry.borrow_mut();
        if let Some(undo) = registry.undo.take() {
            let mut world = self.world.borrow_mut();
            for (id, previous) in undo { if let Some(entity) = world.entities.get_mut(&id) {
                entity.transform = previous.transform; entity.rotation = previous.rotation; entity.scale = previous.scale;
                entity.sprite = previous.sprite; entity.shader_material = previous.shader_material;
                entity.sprite_uniforms = previous.sprite_uniforms; entity.sprite_appearance = previous.sprite_appearance;
                entity.sprite_animation = previous.sprite_animation;
            }}
        }
        checkpoint.next_id = checkpoint.next_id.max(registry.next_id);
        *registry = checkpoint;
    }
}

impl EngineRuntime {
    /// A detached plan, reconciled against live entities without changing World.
    pub fn sprite_resource_plan(&self) -> Vec<SpriteResourcePlan> {
        let mut registry = self.sprite_resources.borrow_mut();
        registry.reconcile(&self.world.borrow()); registry.plan()
    }
    /// Unchanged polls do not copy shader definitions or asset strings.
    pub fn sprite_resource_plan_since(&self, after: Option<u64>) -> SpriteResourcePlanUpdate {
        let mut registry = self.sprite_resources.borrow_mut();
        registry.reconcile(&self.world.borrow()); registry.plan_since(after)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn registry() -> Registry {
        Registry::new(vec![AssetCatalogEntry { id: "texture://one".into(), kind: "texture2d".into() }]).unwrap()
    }
    fn appearance() -> SpriteAppearance {
        serde_json::from_value(serde_json::json!({"transform":{}})).unwrap()
    }
    fn ready(registry: &mut Registry, id: &str) {
        registry.feedback(&PresentationResourceInput { resources: vec![SpriteResourceReceipt {
            id: id.into(), state: SpriteResourceState::Ready, epoch: 1, bytes: 4, error: None }], ..Default::default() }).unwrap();
    }
    #[test]
    fn checkpoints_share_immutable_maps_and_do_not_masquerade_as_live_callers() {
        let world = World::default(); let mut registry = registry();
        let (resource, caller) = registry.prepare(&world, "texture://one".into(), None).unwrap();
        let checkpoint = registry.clone();
        assert!(Rc::ptr_eq(&registry.catalog, &checkpoint.catalog));
        assert!(Rc::ptr_eq(&registry.records, &checkpoint.records));
        drop(caller);
        // Even an internal strong Resource reference is not a caller demand.
        assert!(registry.plan().is_empty());
        registry.reconcile(&world);
        assert!(registry.records.is_empty());
        assert!(registry.status(&resource).is_err());
    }
    #[test]
    fn shared_commits_pin_once_until_last_visible_entity_retires() {
        let mut world = World::default(); let mut registry = registry();
        let a = world.spawn("a"); let b = world.spawn("b");
        let (resource, caller) = registry.prepare(&world, "texture://one".into(), None).unwrap();
        ready(&mut registry, &resource.id);
        registry.commit(&mut world, &a, Rc::clone(&resource), appearance()).unwrap();
        registry.commit(&mut world, &b, Rc::clone(&resource), appearance()).unwrap();
        registry.release(&resource).unwrap();
        let weak = Rc::downgrade(&resource); drop(resource); drop(caller);
        world.entities.get_mut(&a).unwrap().sprite.as_mut().unwrap().visible = false;
        registry.reconcile(&world); assert_eq!(registry.plan().len(), 1);
        world.entities.get_mut(&b).unwrap().sprite.as_mut().unwrap().visible = false;
        registry.reconcile(&world); assert!(registry.plan().is_empty()); assert!(weak.upgrade().is_none());
        // Commit history itself contains only weak ownership.
        assert_eq!(registry.get_commit(&world, &a).unwrap().state, "pending");
    }
    #[test]
    fn admission_bound_is_generic_not_a_twelve_slot_game_policy() {
        let world = World::default(); let mut registry = registry();
        let leases: Vec<_> = (0..13).map(|_| registry.prepare(&world, "texture://one".into(), None).unwrap()).collect();
        assert_eq!(registry.plan().len(), 13);
        drop(leases); registry.reconcile(&world); assert!(registry.plan().is_empty());
    }
    #[test]
    fn hidden_absence_can_be_submitted_after_its_resource_and_old_renderer_retire() {
        let mut world = World::default(); let mut registry = registry(); let entity = world.spawn("a");
        let (resource, caller) = registry.prepare(&world, "texture://one".into(), None).unwrap();
        ready(&mut registry, &resource.id); let mut hidden = appearance(); hidden.visible = false;
        let revision = registry.commit(&mut world, &entity, Rc::clone(&resource), hidden).unwrap().unwrap();
        registry.release(&resource).unwrap(); drop(resource); drop(caller); registry.reconcile(&world);
        assert!(registry.records.is_empty());
        registry.feedback(&PresentationResourceInput { appearances: vec![SpriteAppearanceReceipt {
            entity: entity.clone(), revision, state: SpriteSubmissionState::Submitted, epoch: 2, error: None }], ..Default::default() }).unwrap();
        assert_eq!(registry.get_commit(&world, &entity).unwrap().submitted_revision, Some(revision));
        assert_eq!(registry.get_commit(&world, &entity).unwrap().epoch, 2);
    }
    #[test]
    fn duplicate_feedback_does_not_clone_shared_checkpoint_maps() {
        let mut world = World::default(); let mut registry = registry(); let entity = world.spawn("a");
        let (resource, _caller) = registry.prepare(&world, "texture://one".into(), None).unwrap();
        ready(&mut registry, &resource.id);
        let revision = registry.commit(&mut world, &entity, resource.clone(), appearance()).unwrap().unwrap();
        let mut feedback = PresentationResourceInput { resources: vec![SpriteResourceReceipt {
            id: resource.id.clone(), state: SpriteResourceState::Ready, epoch: 1, bytes: 4, error: None }],
            appearances: vec![SpriteAppearanceReceipt { entity, revision,
                state: SpriteSubmissionState::Submitted, epoch: 1, error: None }] };
        registry.feedback(&feedback).unwrap();
        let checkpoint = registry.clone();
        feedback.resources.push(SpriteResourceReceipt { id: "unknown".into(), state: SpriteResourceState::Loading, epoch: 1, bytes: 0, error: None });
        feedback.validate().unwrap(); registry.feedback(&feedback).unwrap();
        assert!(Rc::ptr_eq(&registry.records, &checkpoint.records));
        assert!(Rc::ptr_eq(&registry.commits, &checkpoint.commits));
        assert!(Rc::ptr_eq(&registry.owners, &checkpoint.owners));
    }
    #[test]
    fn large_catalogs_load_and_keep_only_textures() {
        let mut catalog: Vec<_> = (0..70_000).map(|i| AssetCatalogEntry { id: format!("texture://{i}"), kind: "texture2d".into() }).collect();
        catalog.push(AssetCatalogEntry { id: "mesh://hull".into(), kind: "mesh3d".into() });
        let mut registry = Registry::new(catalog).unwrap();
        assert_eq!(registry.catalog.len(), 70_000);
        let world = World::default();
        assert!(registry.prepare(&world, "mesh://hull".into(), None).unwrap_err().contains("texture2d"));
        assert!(registry.prepare(&world, "texture://69999".into(), None).is_ok());
    }
}

//! Image groups a game asks the host to warm, hold or drop (`api.assets.imageGroups`).
//!
//! The project's image plan (`player.image-assets.json`) names the groups. The
//! official Web player applies the requests to its decoded-image broker and
//! reports each group's state back as recorded presentation input. Neither the
//! requests nor the reports enter World, so they never change a snapshot or its
//! digest; a replay reproduces `status` from the recorded reports.
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;
use std::cell::RefCell;
use serde::{Deserialize, Serialize};

/// The plan's file name in the project root.
pub const IMAGE_PLAN_FILE: &str = "player.image-assets.json";
/// The plan's own limits: at most 128 groups, names of 1–128 UTF-8 bytes.
pub const MAX_IMAGE_GROUPS: usize = 128;
pub const MAX_IMAGE_GROUP_NAME_BYTES: usize = 128;
const MAX_PLAN_BYTES: usize = 1024 * 1024;
/// The plan allows 16384 references in total, so no group has more images.
const MAX_GROUP_IMAGES: u32 = 16384;
const MAX_ERROR_BYTES: usize = 4096;

/// A group's state as the host last reported it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ImageGroupState { Idle, Loading, Ready, Error, Unloaded }

impl ImageGroupState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle", Self::Loading => "loading", Self::Ready => "ready",
            Self::Error => "error", Self::Unloaded => "unloaded",
        }
    }
}

/// One group's state, reported by the host that holds the images.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ImageGroupReceipt {
    pub name: String,
    pub state: ImageGroupState,
    /// Distinct images in the group.
    pub total: u32,
    /// How many of them are decoded and ready.
    pub ready: u32,
    /// Decoded RGBA estimate (width × height × 4) the group reserves; images it
    /// shares with another held group count in both.
    pub bytes: u64,
    /// Why the group failed; only with state `error`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// What the game asked for a group, most recent call first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageGroupRequest { Preload, Load, Unload }

impl ImageGroupRequest {
    pub(crate) fn as_str(self) -> &'static str {
        match self { Self::Preload => "preload", Self::Load => "load", Self::Unload => "unload" }
    }
}

/// The groups the host should hold: those whose latest request is preload or
/// load. `groups` is present only when the plan changed since `after`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImageGroupPlanUpdate {
    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<BTreeMap<String, ImageGroupRequest>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub retries: Vec<String>,
}

pub(crate) fn validate_names(names: &[String]) -> Result<(), String> {
    if names.len() > MAX_IMAGE_GROUPS {
        return Err(format!("IMAGE_PLAN_INVALID: at most {MAX_IMAGE_GROUPS} image groups"));
    }
    let mut seen = BTreeSet::new();
    for name in names {
        valid_name(name)?;
        if !seen.insert(name) { return Err(format!("IMAGE_PLAN_INVALID: duplicate image group '{name}'")); }
    }
    Ok(())
}

fn valid_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_IMAGE_GROUP_NAME_BYTES {
        return Err(format!("IMAGE_GROUP_NAME_INVALID: group names have 1 to {MAX_IMAGE_GROUP_NAME_BYTES} UTF-8 bytes"));
    }
    Ok(())
}

pub(crate) fn validate_receipts(receipts: &[ImageGroupReceipt]) -> Result<(), String> {
    let invalid = |why: &str| Err(format!("INPUT_PRESENTATION_INVALID: image group receipt {why}"));
    if receipts.len() > MAX_IMAGE_GROUPS {
        return invalid(&format!("batch exceeds {MAX_IMAGE_GROUPS} groups"));
    }
    let mut names = BTreeSet::new();
    for r in receipts {
        if valid_name(&r.name).is_err() { return invalid("names have 1..128 UTF-8 bytes"); }
        if !names.insert(&r.name) { return invalid("names a group twice"); }
        if r.ready > r.total || r.total > MAX_GROUP_IMAGES { return invalid("counts are out of range"); }
        if r.bytes > crate::MAX_PRESENTATION_INTEGER { return invalid("bytes must be an exact safe integer"); }
        match &r.error {
            Some(e) if r.state != ImageGroupState::Error || e.is_empty() || e.len() > MAX_ERROR_BYTES =>
                return invalid("error must be 1..4096 UTF-8 bytes on an error state"),
            _ => {}
        }
    }
    Ok(())
}

/// Group names in an image plan's bytes. Only what this runtime needs is read;
/// the Web publisher validates the rest of the plan.
pub(crate) fn parse_plan_names(bytes: &[u8]) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct Plan { groups: serde_json::Map<String, serde_json::Value> }
    if bytes.len() > MAX_PLAN_BYTES {
        return Err(format!("IMAGE_PLAN_INVALID: {IMAGE_PLAN_FILE} exceeds 1 MiB"));
    }
    let plan: Plan = serde_json::from_slice(bytes)
        .map_err(|e| format!("IMAGE_PLAN_INVALID: {IMAGE_PLAN_FILE}: {e}"))?;
    let mut names: Vec<String> = plan.groups.into_iter().map(|(name, _)| name).collect();
    names.sort();
    validate_names(&names)?;
    Ok(names)
}

/// Group names the project's image plan declares; empty without a plan.
#[cfg(feature = "dev-tools")]
pub fn image_group_names(project_root: &std::path::Path) -> Result<Vec<String>, Box<crate::Diagnostic>> {
    let invalid = |explanation: String| Box::new(crate::Diagnostic::error("IMAGE_PLAN_INVALID", "Invalid image plan", explanation));
    match std::fs::read(project_root.join(IMAGE_PLAN_FILE)) {
        Ok(bytes) => parse_plan_names(&bytes).map_err(invalid),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(invalid(format!("{IMAGE_PLAN_FILE}: {error}"))),
    }
}

/// A group's status as Luau sees it.
pub(crate) struct GroupStatus<'a> {
    pub name: &'a str,
    pub state: &'static str,
    pub requested: Option<ImageGroupRequest>,
    pub total: u32,
    pub ready: u32,
    pub bytes: u64,
    pub error: Option<&'a str>,
}

/// VM-local requests and reports. Cloning is cheap: the maps are shared until written.
#[derive(Debug, Clone)]
pub(crate) struct Registry {
    names: Rc<BTreeSet<String>>,
    /// The host applies requests and reports; otherwise status reads unsupported.
    host: bool,
    direct: Rc<BTreeMap<String, ImageGroupRequest>>,
    owners: Rc<BTreeMap<String, Rc<BTreeMap<String, ImageGroupRequest>>>>,
    requests: Rc<BTreeMap<String, ImageGroupRequest>>,
    retries: Rc<BTreeMap<String, u64>>,
    reports: Rc<BTreeMap<String, ImageGroupReceipt>>,
    revision: u64,
}

impl Registry {
    pub fn new(names: Vec<String>, host: bool) -> Result<Self, String> {
        validate_names(&names)?;
        Ok(Self { names: Rc::new(names.into_iter().collect()), host, direct: Rc::default(), owners: Rc::default(),
            requests: Rc::default(), retries: Rc::default(), reports: Rc::default(), revision: 0 })
    }

    fn known(&self, name: &str) -> Result<(), String> {
        valid_name(name)?;
        if self.names.contains(name) { return Ok(()); }
        if self.names.is_empty() {
            return Err(format!("IMAGE_GROUP_UNKNOWN: '{name}': the project declares no image groups; declare them in {IMAGE_PLAN_FILE}"));
        }
        let declared: Vec<_> = self.names.iter().take(8).map(String::as_str).collect();
        Err(format!("IMAGE_GROUP_UNKNOWN: '{name}' is not a group in {IMAGE_PLAN_FILE}. Declared: [{}]", declared.join(", ")))
    }

    /// Record the game's latest request. Repeating it changes nothing, so a
    /// game may call it every update.
    pub fn request(&mut self, name: &str, request: ImageGroupRequest) -> Result<(), String> {
        self.known(name)?;
        if self.direct.get(name) == Some(&request) { return Ok(()); }
        Rc::make_mut(&mut self.direct).insert(name.to_owned(), request);
        if self.reconcile(name) { self.bump_revision(); }
        Ok(())
    }

    fn bump_revision(&mut self) {
        self.revision = (self.revision + 1).min(crate::MAX_PRESENTATION_INTEGER);
    }

    /// Retry only a held group for which the host reported a failure. Keep all owners.
    pub fn retry(&mut self, name: &str) -> Result<(), String> {
        self.known(name)?;
        if matches!(self.requests.get(name), Some(ImageGroupRequest::Preload | ImageGroupRequest::Load))
            && self.reports.get(name).is_some_and(|r| r.state == ImageGroupState::Error)
        {
            self.bump_revision();
            Rc::make_mut(&mut self.retries).insert(name.to_owned(), self.revision);
        }
        Ok(())
    }

    // Only an effective demand change reaches the image broker. In particular an
    // owner handoff with identical holds cannot release and decode a shared group.
    fn reconcile(&mut self, name: &str) -> bool {
        use ImageGroupRequest::{Load, Preload, Unload};
        let mut effective = self.direct.get(name).copied().unwrap_or(Unload);
        if effective != Load {
            for groups in self.owners.values() {
                match groups.get(name) {
                    Some(Load) => { effective = Load; break; }
                    Some(Preload) => effective = Preload,
                    _ => {}
                }
            }
        }
        let old = self.requests.get(name).copied();
        if old == Some(effective) { return false; }
        Rc::make_mut(&mut self.requests).insert(name.to_owned(), effective);
        if effective == Unload && self.retries.contains_key(name) { Rc::make_mut(&mut self.retries).remove(name); }
        old.unwrap_or(Unload) != effective
    }

    /// Atomically replace one screen, overlay or subsystem's complete working set.
    pub fn set_owner(&mut self, owner: &str, desired: BTreeMap<String, ImageGroupRequest>) -> Result<(), String> {
        if owner.is_empty() || owner.len() > MAX_IMAGE_GROUP_NAME_BYTES {
            return Err("IMAGE_GROUP_OWNER_INVALID: owner names must be 1..128 UTF-8 bytes".into());
        }
        let previous = self.owners.get(owner).cloned();
        if desired.is_empty() && previous.is_none() { return Ok(()); }
        if previous.as_deref() == Some(&desired) { return Ok(()); }
        for (name, request) in &desired {
            self.known(name)?;
            if *request == ImageGroupRequest::Unload {
                return Err("IMAGE_GROUP_OWNER_INVALID: omit a group to release it".into());
            }
        }
        if previous.is_none() && self.owners.len() >= MAX_IMAGE_GROUPS {
            return Err(format!("IMAGE_GROUP_OWNER_LIMIT: at most {MAX_IMAGE_GROUPS} active owners; release unused owners"));
        }
        let affected: BTreeSet<String> = previous.iter().flat_map(|groups| groups.keys()).chain(desired.keys()).cloned().collect();
        let owners = Rc::make_mut(&mut self.owners);
        if desired.is_empty() { owners.remove(owner); } else { owners.insert(owner.to_owned(), Rc::new(desired)); }
        let mut changed = false;
        for name in affected { changed |= self.reconcile(&name); }
        if changed { self.bump_revision(); }
        Ok(())
    }

    /// Copy-free view for an explicit diagnostics query. No owner data is sent on every frame.
    pub fn owners(&self, name: &str) -> Result<impl Iterator<Item = (&str, ImageGroupRequest)> + '_, String> {
        self.known(name)?;
        let name = self.names.get(name).expect("validated group");
        Ok(self.owners.iter().filter_map(move |(owner, groups)| groups.get(name).map(|demand| (owner.as_str(), *demand))))
    }

    pub fn status<'a>(&'a self, name: &'a str) -> Result<GroupStatus<'a>, String> {
        self.known(name)?;
        let report = self.reports.get(name);
        Ok(GroupStatus {
            name,
            state: match report {
                Some(report) => report.state.as_str(),
                None if self.host => "idle",
                None => "unsupported",
            },
            requested: self.requests.get(name).copied(),
            total: report.map_or(0, |r| r.total),
            ready: report.map_or(0, |r| r.ready),
            bytes: report.map_or(0, |r| r.bytes),
            error: report.and_then(|r| r.error.as_deref()),
        })
    }

    /// Admit host reports. A report for a group the project does not declare
    /// is ignored: the host's published plan may be newer than this script.
    pub fn feedback(&mut self, receipts: &[ImageGroupReceipt]) {
        for receipt in receipts {
            if !self.names.contains(&receipt.name) || self.reports.get(&receipt.name) == Some(receipt) { continue; }
            Rc::make_mut(&mut self.reports).insert(receipt.name.clone(), receipt.clone());
        }
    }

    pub fn plan_since(&self, after: Option<u64>) -> ImageGroupPlanUpdate {
        ImageGroupPlanUpdate {
            revision: self.revision,
            retries: if after == Some(self.revision) { Vec::new() } else {
                self.retries.iter().filter(|(_, rev)| after.is_some_and(|seen| seen < **rev))
                    .map(|(name, _)| name.clone()).collect()
            },
            groups: (after != Some(self.revision)).then(|| self.requests.iter()
                .filter(|(_, request)| **request != ImageGroupRequest::Unload)
                .map(|(name, request)| (name.clone(), *request)).collect()),
        }
    }
}

/// A tick's admitted reports and requests, undone if the tick fails.
pub(crate) struct Tick { registry: Rc<RefCell<Registry>>, checkpoint: Option<Registry> }

impl Tick {
    pub fn begin(registry: &Rc<RefCell<Registry>>, receipts: &[ImageGroupReceipt]) -> Self {
        let checkpoint = registry.borrow().clone();
        registry.borrow_mut().feedback(receipts);
        Self { registry: Rc::clone(registry), checkpoint: Some(checkpoint) }
    }
    pub fn commit(mut self) { self.checkpoint = None; }
}

impl Drop for Tick {
    fn drop(&mut self) {
        let Some(mut checkpoint) = self.checkpoint.take() else { return; };
        let mut registry = self.registry.borrow_mut();
        // A host never sees a failed tick's plan; keeping the revision
        // monotonic still means no two different plans share one revision.
        checkpoint.revision = checkpoint.revision.max(registry.revision);
        *registry = checkpoint;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry(host: bool) -> Registry { Registry::new(vec!["town".into(), "map".into()], host).unwrap() }
    fn receipt(name: &str, state: ImageGroupState) -> ImageGroupReceipt {
        ImageGroupReceipt { name: name.into(), state, total: 3, ready: 1, bytes: 12, error: None }
    }

    #[test]
    fn unknown_and_malformed_names_fail_loudly() {
        let mut groups = registry(true);
        assert!(groups.request("towm", ImageGroupRequest::Load).unwrap_err().starts_with("IMAGE_GROUP_UNKNOWN: 'towm' is not a group"));
        assert!(groups.status("").err().unwrap().starts_with("IMAGE_GROUP_NAME_INVALID"));
        let mut empty = Registry::new(Vec::new(), true).unwrap();
        assert!(empty.request("town", ImageGroupRequest::Preload).unwrap_err().contains("declares no image groups"));
        assert!(Registry::new(vec!["a".into(), "a".into()], true).is_err());
    }

    #[test]
    fn the_plan_holds_preloaded_and_loaded_groups_and_moves_only_when_it_changes() {
        let mut groups = registry(true);
        assert_eq!(groups.plan_since(None), ImageGroupPlanUpdate { revision: 0, groups: Some(BTreeMap::new()), retries: vec![] });
        groups.request("map", ImageGroupRequest::Unload).unwrap();
        assert_eq!(groups.plan_since(Some(0)).groups, None, "unloading a group nobody held changes nothing");
        groups.request("town", ImageGroupRequest::Preload).unwrap();
        groups.request("town", ImageGroupRequest::Preload).unwrap();
        assert_eq!(groups.plan_since(Some(0)).revision, 1);
        groups.request("town", ImageGroupRequest::Load).unwrap();
        let plan = groups.plan_since(Some(1));
        assert_eq!((plan.revision, plan.groups.unwrap()["town"]), (2, ImageGroupRequest::Load));
        assert_eq!(groups.plan_since(Some(2)).groups, None);
        groups.request("town", ImageGroupRequest::Unload).unwrap();
        assert_eq!(groups.plan_since(Some(2)).groups, Some(BTreeMap::new()));
        assert_eq!(groups.status("town").unwrap().requested, Some(ImageGroupRequest::Unload));
    }

    #[test]
    fn status_is_the_hosts_last_report_or_says_nobody_manages_the_group() {
        let mut groups = registry(true);
        assert_eq!(groups.status("town").unwrap().state, "idle");
        assert_eq!(registry(false).status("town").unwrap().state, "unsupported");
        groups.feedback(&[receipt("town", ImageGroupState::Ready), receipt("other", ImageGroupState::Ready)]);
        let status = groups.status("town").unwrap();
        assert_eq!((status.state, status.total, status.ready, status.bytes, status.requested), ("ready", 3, 1, 12, None));
        let mut replayed = registry(false);
        replayed.feedback(&[receipt("town", ImageGroupState::Loading)]);
        assert_eq!(replayed.status("town").unwrap().state, "loading", "recorded reports win on any host");
    }

    #[test]
    fn a_failed_tick_undoes_its_reports_and_requests() {
        let registry = Rc::new(RefCell::new(registry(true)));
        let tick = Tick::begin(&registry, &[receipt("town", ImageGroupState::Loading)]);
        registry.borrow_mut().request("map", ImageGroupRequest::Load).unwrap();
        drop(tick);
        let current = registry.borrow();
        assert_eq!(current.status("town").unwrap().state, "idle");
        assert_eq!(current.status("map").unwrap().requested, None);
        assert_eq!(current.plan_since(None).revision, 1, "revision stays monotonic");
        drop(current);
        Tick::begin(&registry, &[receipt("town", ImageGroupState::Loading)]).commit();
        assert_eq!(registry.borrow().status("town").unwrap().state, "loading");
    }

    #[test]
    fn receipts_and_plans_are_bounded() {
        assert!(validate_receipts(&[receipt("town", ImageGroupState::Ready)]).is_ok());
        assert!(validate_receipts(&[receipt("town", ImageGroupState::Ready), receipt("town", ImageGroupState::Ready)]).is_err());
        let mut over = receipt("town", ImageGroupState::Ready); over.ready = 4;
        assert!(validate_receipts(&[over]).is_err());
        let mut stray = receipt("town", ImageGroupState::Ready); stray.error = Some("late".into());
        assert!(validate_receipts(&[stray]).is_err());
        let mut failed = receipt("town", ImageGroupState::Error); failed.error = Some("IMAGE_ASSET_GROUP_BUDGET".into());
        assert!(validate_receipts(&[failed]).is_ok());
        assert_eq!(parse_plan_names(br#"{"version":1,"groups":{"b":[],"a":[]},"startup":[]}"#).unwrap(), vec!["a", "b"]);
        assert!(parse_plan_names(br#"{"groups":[]}"#).is_err());
        let long = format!(r#"{{"groups":{{"{}":[]}}}}"#, "x".repeat(129));
        assert!(parse_plan_names(long.as_bytes()).is_err());
    }
}

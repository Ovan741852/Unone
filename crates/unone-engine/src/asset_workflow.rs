use std::{
    collections::BTreeSet,
    fs,
    path::Path,
};

use serde::Serialize;

use crate::{
    asset::{
        AssetManifest, AssetSpec, load_active_asset_manifest, load_declared_manifest,
        validate_asset_spec,
    },
    bundle::{BundleManager, digest_bytes, read_asset_from_archive},
    diagnostics::{ActionSuggestion, Diagnostic, EngineResult},
    project::{ProjectPaths, resolve_project_path},
    scene::{parse_scene_file, scene_read_failed},
};

#[derive(Debug, Clone, Serialize)]
pub struct AssetDescribeReport {
    pub project_root: String,
    pub asset: AssetSpec,
    pub authoring: AssetAuthoringReport,
    pub references: Vec<AssetDescribeReference>,
    pub reference_scope: AssetReferenceScope,
    /// Project source evidence is separate from the legacy main-scene-only references.
    pub usages: Option<crate::asset_usage::AssetUsageIndex>,
    pub active: AssetActiveReport,
    pub publication: AssetPublicationReport,
    pub required_next_actions: Vec<AssetWorkflowAction>,
    /// Declaration only; decoder availability belongs to the selected live host.
    pub decoder_support: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetAuthoringReport {
    pub manifest_path: String,
    pub manifest_json_pointer: String,
    pub files: Vec<AssetAuthoringFileReport>,
    pub editing_rules: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetAuthoringFileReport {
    pub path: String,
    pub role: String,
    pub exists: bool,
    pub size_bytes: Option<u64>,
    pub sha256: Option<String>,
    pub shared_with_asset_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<Diagnostic>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetDescribeReference {
    pub path: String,
    pub json_pointer: String,
    pub id: String,
    pub entity: String,
    pub component: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetReferenceScope {
    pub scope: String,
    pub roots_inspected: Vec<String>,
    pub components_inspected: Vec<String>,
    pub dynamic_luau_assets_included: bool,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetActiveReport {
    pub scope: String,
    pub generation: Option<u64>,
    pub asset_manifest_json_pointer: Option<String>,
    pub asset: Option<AssetSpec>,
    pub files: Vec<AssetActiveFileReport>,
    pub diagnostics: Vec<Diagnostic>,
    pub observation_token_before: Option<String>,
    pub observation_token_after: Option<String>,
    pub observation_consistent: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetActiveFileReport {
    pub path: String,
    pub role: String,
    pub verified: bool,
    pub size_bytes: Option<u64>,
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<Diagnostic>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetPublicationReport {
    pub scope: String,
    pub matches_authoring: Option<bool>,
    pub asset_spec_matches: Option<bool>,
    pub primary_bytes_match: Option<bool>,
    pub companion_bytes_match: Option<bool>,
    pub bytes_match: Option<bool>,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetWorkflowAction {
    pub action: String,
    pub kind: String,
    pub reason: String,
    pub executable: Option<String>,
    pub argv: Vec<String>,
    pub ready: bool,
    pub status: String,
    pub prerequisites: Vec<String>,
}

#[derive(Debug, Clone)]
struct ActiveComparison {
    report: AssetActiveReport,
    spec: Option<AssetSpec>,
}

/// Describe one declared asset's authoring files, static references, native
/// active bytes, publication freshness and the next safe workflow actions.
///
/// The query is deliberately read-only. It observes one native-local active
/// generation and refuses to call a failed or changing observation fresh.
pub fn describe_asset(
    project_root: impl AsRef<Path>,
    asset_id: &str,
) -> EngineResult<AssetDescribeReport> {
    let requested_root = project_root.as_ref().to_path_buf();
    let (config, paths) = match ProjectPaths::discover(&requested_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let root = match fs::canonicalize(&paths.root) {
        Ok(root) => root,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_ROOT_NOT_FOUND",
                "Unone project root was not found",
                format!("{}: {}", paths.root.display(), error),
            ));
        }
    };
    let manifest = match load_declared_manifest(&paths) {
        Ok(manifest) => manifest,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let Some((asset_index, asset)) = manifest
        .assets
        .iter()
        .enumerate()
        .find(|(_, candidate)| candidate.id == asset_id)
    else {
        let mut diagnostic = Diagnostic::error(
            "ASSET_ID_NOT_DECLARED",
            "The asset manifest has no such asset id",
            format!(
                "The manifest does not declare asset '{asset_id}'; the engine does not guess asset sources."
            ),
        );
        diagnostic.facts = serde_json::json!({
            "asset_id": asset_id,
            "declared": manifest
                .assets
                .iter()
                .map(|candidate| candidate.id.clone())
                .collect::<Vec<_>>(),
        });
        diagnostic.suggested_actions.push(ActionSuggestion {
            action: "inspect_assets".to_string(),
            description: "List the current declarations, sources, and static references before choosing an asset id to describe."
                .to_string(),
            command: Some("game asset inspect --json".to_string()),
        });
        return EngineResult::failure(diagnostic);
    };
    if let Err(diagnostic) = validate_asset_spec(asset) {
        return EngineResult::failure(*diagnostic);
    }

    let manifest_relative = config
        .asset_manifest
        .as_deref()
        .map(|path| path.replace('\\', "/"))
        .unwrap_or_default();
    if !manifest_relative.is_empty()
        && let Err(diagnostic) = resolve_project_path(&root, &manifest_relative)
    {
        return EngineResult::failure(*diagnostic);
    }
    let authoring = authoring_report(&root, &manifest, asset_index, asset, &manifest_relative);
    let (references, reference_diagnostic) = match scene_references(
        &root,
        config.main_scene.as_deref(),
        asset_id,
    ) {
        Ok(references) => (references, None),
        Err(diagnostic) => (Vec::new(), Some(*diagnostic)),
    };
    let reference_scope = reference_scope(config.main_scene.as_deref(), &root);

    let mut diagnostics = authoring
        .files
        .iter()
        .filter_map(|file| file.diagnostic.clone())
        .collect::<Vec<_>>();
    if let Some(diagnostic) = reference_diagnostic {
        diagnostics.push(diagnostic);
    }

    let active_comparison = observe_active(&root, asset, &authoring.files);
    diagnostics.extend(active_comparison.report.diagnostics.iter().cloned());
    let publication = publication_report(
        asset,
        &authoring.files,
        &active_comparison,
    );
    let required_next_actions = required_next_actions(
        &root,
        asset,
        &authoring.files,
        &active_comparison.report,
        &publication,
    );
    let report = AssetDescribeReport {
        project_root: root.display().to_string(),
        asset: asset.clone(),
        authoring,
        references,
        reference_scope,
        usages: {
            let result = crate::asset_usage::asset_usages(&root, Some(asset_id));
            diagnostics.extend(result.diagnostics);
            result.value
        },
        active: active_comparison.report,
        publication,
        required_next_actions,
        decoder_support: "not_probed",
    };
    let mut result = EngineResult::success(report);
    result.diagnostics = diagnostics;
    result
}

fn authoring_report(
    root: &Path,
    manifest: &AssetManifest,
    asset_index: usize,
    asset: &AssetSpec,
    manifest_relative: &str,
) -> AssetAuthoringReport {
    let mut files = Vec::with_capacity(asset.files.len() + 1);
    files.push(authoring_file(root, manifest, asset, &asset.source, "primary"));
    for file in &asset.files {
        files.push(authoring_file(root, manifest, asset, file, "companion"));
    }
    AssetAuthoringReport {
        manifest_path: manifest_relative.to_string(),
        manifest_json_pointer: format!("/assets/{asset_index}"),
        files,
        editing_rules: vec![
            "Edit content by changing the source bytes of the primary or a companion; keep the asset id and scene references unchanged."
                .to_string(),
            "When moving files, update the source/files paths in the same manifest entry and repack; do not edit an archive or cache by hand."
                .to_string(),
            "Editing a scene changes placement and presentation only; this query does not automatically change size, pivot, colliders, or dynamic Luau references."
                .to_string(),
            "asset init declares source/files only; it does not create or guess new art content.".to_string(),
        ],
    }
}

fn authoring_file(
    root: &Path,
    manifest: &AssetManifest,
    selected: &AssetSpec,
    path: &str,
    role: &str,
) -> AssetAuthoringFileReport {
    let shared_with_asset_ids = manifest
        .assets
        .iter()
        .filter(|asset| asset.id != selected.id)
        .filter(|asset| asset.source == path || asset.files.iter().any(|file| file == path))
        .map(|asset| asset.id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let resolved = match resolve_project_path(root, path) {
        Ok(path) => path,
        Err(diagnostic) => {
            return AssetAuthoringFileReport {
                path: path.to_string(),
                role: role.to_string(),
                exists: false,
                size_bytes: None,
                sha256: None,
                shared_with_asset_ids,
                diagnostic: Some(*diagnostic),
            };
        }
    };
    if !resolved.is_file() {
        return AssetAuthoringFileReport {
            path: path.to_string(),
            role: role.to_string(),
            exists: false,
            size_bytes: None,
            sha256: None,
            shared_with_asset_ids,
            diagnostic: Some(Diagnostic::warning(
                "ASSET_SOURCE_NOT_FOUND",
                "Asset authoring file was not found",
                format!("asset '{}' requires '{}', but the file does not exist.", selected.id, path),
            )),
        };
    }
    match fs::read(&resolved) {
        Ok(bytes) => AssetAuthoringFileReport {
            path: path.to_string(),
            role: role.to_string(),
            exists: true,
            size_bytes: Some(bytes.len() as u64),
            sha256: Some(digest_bytes(&bytes)),
            shared_with_asset_ids,
            diagnostic: None,
        },
        Err(error) => AssetAuthoringFileReport {
            path: path.to_string(),
            role: role.to_string(),
            exists: true,
            size_bytes: None,
            sha256: None,
            shared_with_asset_ids,
            diagnostic: Some(Diagnostic::error(
                "ASSET_SOURCE_READ_FAILED",
                "Could not read the asset authoring file",
                format!("{}: {}", resolved.display(), error),
            )),
        },
    }
}

fn scene_references(
    root: &Path,
    configured_scene: Option<&str>,
    selected_id: &str,
) -> Result<Vec<AssetDescribeReference>, Box<Diagnostic>> {
    let Some(configured_scene) = configured_scene else {
        return Ok(Vec::new());
    };
    let scene_path = resolve_project_path(root, configured_scene)?;
    let scene_relative = relative_path(root, &scene_path);
    let text = fs::read_to_string(&scene_path).map_err(|error| {
        scene_read_failed(&scene_path, error)
    })?;
    let scene = parse_scene_file(&text, &scene_path)?;
    let mut references = Vec::new();
    for (index, entity) in scene.entities.iter().enumerate() {
        let components = [
            ("sprite", entity.sprite.as_ref().map(|component| component.asset.as_str())),
            ("mesh3d", entity.mesh3d.as_ref().map(|component| component.asset.as_str())),
            (
                "animation",
                entity.animation.as_ref().map(|component| component.asset.as_str()),
            ),
        ];
        for (component, id) in components {
            if let Some(id) = id.filter(|id| *id == selected_id) {
                references.push(AssetDescribeReference {
                    path: scene_relative.clone(),
                    json_pointer: format!("/entities/{index}/{component}/asset"),
                    id: id.to_string(),
                    entity: entity.id.clone(),
                    component: component.to_string(),
                });
            }
        }
    }
    Ok(references)
}

fn reference_scope(configured_scene: Option<&str>, root: &Path) -> AssetReferenceScope {
    let roots_inspected = configured_scene
        .and_then(|path| resolve_project_path(root, path).ok())
        .map(|path| vec![relative_path(root, &path)])
        .unwrap_or_default();
    AssetReferenceScope {
        scope: "main_scene_only".to_string(),
        roots_inspected,
        components_inspected: vec![
            "sprite".to_string(),
            "mesh3d".to_string(),
            "animation".to_string(),
        ],
        dynamic_luau_assets_included: false,
        limitations: vec![
            "Only the configured main scene is inspected for static asset references.".to_string(),
            "Dynamic asset ids selected or created by Luau are not inspected.".to_string(),
            "An unreferenced asset is not thereby safe to remove; dynamic references may exist.".to_string(),
        ],
    }
}

fn observe_active(
    root: &Path,
    selected: &AssetSpec,
    authoring_files: &[AssetAuthoringFileReport],
) -> ActiveComparison {
    let mut report = AssetActiveReport {
        scope: "native_local".to_string(),
        generation: None,
        asset_manifest_json_pointer: None,
        asset: None,
        files: Vec::new(),
        diagnostics: Vec::new(),
        observation_token_before: None,
        observation_token_after: None,
        observation_consistent: false,
    };
    let manager = match BundleManager::from_project(root) {
        Ok(manager) => manager,
        Err(diagnostic) => {
            let diagnostic = *diagnostic;
            report.diagnostics.push(diagnostic.clone());
            fill_active_failures(&mut report, authoring_files, Some(&diagnostic));
            return ActiveComparison { report, spec: None };
        }
    };
    let before = match manager.observation_token() {
        Ok(token) => {
            report.observation_token_before = Some(token.clone());
            Some(token)
        }
        Err(diagnostic) => {
            let diagnostic = *diagnostic;
            report.diagnostics.push(diagnostic.clone());
            fill_active_failures(&mut report, authoring_files, Some(&diagnostic));
            return ActiveComparison { report, spec: None };
        }
    };
    match manager.active_generation() {
        Ok(generation) => report.generation = generation,
        Err(diagnostic) => push_active_diagnostic(&mut report, *diagnostic),
    }

    let mut active_spec = None;
    if report.generation.is_some() && before.is_some() {
        match load_active_asset_manifest(root, &manager) {
            Ok(manifest) => {
                if let Some((index, candidate)) = manifest
                    .assets
                    .iter()
                    .enumerate()
                    .find(|(_, candidate)| candidate.id == selected.id)
                {
                    active_spec = Some(candidate.clone());
                    report.asset_manifest_json_pointer = Some(format!("/assets/{index}"));
                } else {
                    push_active_diagnostic(
                        &mut report,
                        Diagnostic::error(
                            "ASSET_ACTIVE_ID_MISSING",
                            "The active asset manifest has no requested asset id",
                            format!("The active generation does not declare asset '{}'.", selected.id),
                        ),
                    );
                }
            }
            Err(diagnostic) => push_active_diagnostic(&mut report, *diagnostic),
        }
    }
    if let Some(active) = active_spec.as_ref() {
        report.asset = Some(active.clone());
        let mut entries = Vec::with_capacity(active.files.len() + 1);
        entries.push((active.source.clone(), "primary".to_string()));
        entries.extend(
            active
                .files
                .iter()
                .cloned()
                .map(|path| (path, "companion".to_string())),
        );
        let archive = manager.read_active_bundle(&active.bundle);
        for (path, role) in entries {
            let mut spec = active.clone();
            spec.source = path.clone();
            let bytes = match archive.as_ref() {
                Ok(archive) => read_asset_from_archive(archive, &spec),
                Err(diagnostic) => Err(diagnostic.clone()),
            };
            match bytes {
                Ok(bytes) => report.files.push(AssetActiveFileReport {
                    path,
                    role,
                    verified: true,
                    size_bytes: Some(bytes.len() as u64),
                    sha256: Some(digest_bytes(&bytes)),
                    diagnostic: None,
                }),
                Err(diagnostic) => {
                    push_active_diagnostic(&mut report, (*diagnostic).clone());
                    report.files.push(AssetActiveFileReport {
                        path,
                        role,
                        verified: false,
                        size_bytes: None,
                        sha256: None,
                        diagnostic: Some(*diagnostic),
                    });
                }
            }
        }
    } else {
        let diagnostic = report.diagnostics.last().cloned().unwrap_or_else(|| {
            Diagnostic::error(
                "BUNDLE_GENERATION_MISMATCH",
                "No active asset generation is available to describe",
                "First have the host install and activate a generation that includes the asset manifest.",
            )
        });
        push_active_diagnostic(&mut report, diagnostic.clone());
        fill_active_failures(&mut report, authoring_files, Some(&diagnostic));
    }

    match manager.observation_token() {
        Ok(token) => report.observation_token_after = Some(token),
        Err(diagnostic) => push_active_diagnostic(&mut report, *diagnostic),
    }
    report.observation_consistent = match (
        report.observation_token_before.as_deref(),
        report.observation_token_after.as_deref(),
    ) {
        (Some(before), Some(after)) if before == after => true,
        (Some(_), Some(_)) => {
            push_active_diagnostic(
                &mut report,
                Diagnostic::error(
                    "ASSET_OBSERVATION_CHANGED",
                    "The active observation changed during describe",
                    "The query does not combine freshness data from different generations; run describe again after the host finishes writing.",
                ),
            );
            false
        }
        _ => false,
    };
    ActiveComparison {
        report,
        spec: active_spec,
    }
}

fn fill_active_failures(
    report: &mut AssetActiveReport,
    authoring_files: &[AssetAuthoringFileReport],
    diagnostic: Option<&Diagnostic>,
) {
    if !report.files.is_empty() {
        return;
    }
    for file in authoring_files {
        report.files.push(AssetActiveFileReport {
            path: file.path.clone(),
            role: file.role.clone(),
            verified: false,
            size_bytes: None,
            sha256: None,
            diagnostic: diagnostic.cloned(),
        });
    }
}

fn push_active_diagnostic(report: &mut AssetActiveReport, diagnostic: Diagnostic) {
    let duplicate = report.diagnostics.iter().any(|existing| {
        existing.code == diagnostic.code
            && existing.summary == diagnostic.summary
            && existing.explanation == diagnostic.explanation
    });
    if !duplicate {
        report.diagnostics.push(diagnostic);
    }
}

fn publication_report(
    selected: &AssetSpec,
    authoring_files: &[AssetAuthoringFileReport],
    active: &ActiveComparison,
) -> AssetPublicationReport {
    let mut publication = AssetPublicationReport {
        scope: "selected_asset_native_local".to_string(),
        matches_authoring: None,
        asset_spec_matches: None,
        primary_bytes_match: None,
        companion_bytes_match: None,
        bytes_match: None,
        reasons: Vec::new(),
    };
    if !active.report.observation_consistent {
        publication
            .reasons
            .push("active observation is missing or inconsistent".to_string());
        return publication;
    }
    let Some(active_spec) = active.spec.as_ref() else {
        publication
            .reasons
            .push("native-local active asset spec is unavailable".to_string());
        return publication;
    };
    let spec_matches = active_spec == selected;
    publication.asset_spec_matches = Some(spec_matches);
    if !spec_matches {
        publication
            .reasons
            .push("active AssetSpec differs from the authoring manifest".to_string());
        publication.matches_authoring = Some(false);
        return publication;
    }
    if authoring_files
        .iter()
        .any(|file| file.sha256.is_none() || file.size_bytes.is_none())
    {
        publication
            .reasons
            .push("one or more authoring primary/companion files cannot be verified".to_string());
        return publication;
    }
    if active.report.files.iter().any(|file| !file.verified) {
        publication
            .reasons
            .push("one or more active primary/companion reads failed verification".to_string());
        return publication;
    }

    let mut primary_match = None;
    let mut companion_match = Some(true);
    for file in authoring_files {
        let Some(authoring_hash) = file.sha256.as_deref() else {
            continue;
        };
        let Some(active_file) = active
            .report
            .files
            .iter()
            .find(|candidate| candidate.path == file.path && candidate.role == file.role)
        else {
            if file.role == "primary" {
                primary_match = Some(false);
            } else {
                companion_match = Some(false);
            }
            continue;
        };
        let matches = active_file.verified
            && active_file.sha256.as_deref() == Some(authoring_hash)
            && active_file.size_bytes == file.size_bytes;
        if file.role == "primary" {
            primary_match = Some(matches);
        } else if !matches {
            companion_match = Some(false);
        }
    }
    let bytes_match = primary_match == Some(true) && companion_match == Some(true);
    publication.primary_bytes_match = primary_match;
    publication.companion_bytes_match = companion_match;
    publication.bytes_match = Some(bytes_match);
    publication.matches_authoring = Some(bytes_match);
    if bytes_match {
        publication
            .reasons
            .push("active AssetSpec and primary/companion verified bytes match authoring".to_string());
    } else {
        publication
            .reasons
            .push("one or more primary/companion verified bytes differ from authoring".to_string());
    }
    publication
}

fn required_next_actions(
    root: &Path,
    selected: &AssetSpec,
    authoring_files: &[AssetAuthoringFileReport],
    active: &AssetActiveReport,
    publication: &AssetPublicationReport,
) -> Vec<AssetWorkflowAction> {
    let project = root.display().to_string();
    let mut actions = Vec::new();
    let authoring_ready = authoring_files
        .iter()
        .all(|file| file.exists && file.sha256.is_some() && file.size_bytes.is_some());
    let active_corrupt = active
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "BUNDLE_ACTIVE_GENERATION_UNREADABLE");
    if !authoring_ready {
        actions.push(manual_action(
            "authoring_files_ready",
            "Have the AI or author complete or fix the primary and companion authoring files; init does not create art.",
            Vec::new(),
        ));
    }
    if active_corrupt {
        actions.push(manual_action(
            "repair_active_generation_record",
            "The latest native-local active generation record cannot be read; diagnose and repair that record through the host first. Do not assume pack, strict, or install will repair it, and do not clear the cache as a first response.",
            if authoring_ready {
                Vec::new()
            } else {
                vec!["authoring_files_ready".to_string()]
            },
        ));
    }
    let mut pack_prerequisites = Vec::new();
    if !authoring_ready {
        pack_prerequisites.push("authoring_files_ready".to_string());
    }
    if active_corrupt {
        pack_prerequisites.push("repair_active_generation_record".to_string());
    }
    let needs_publication = publication.matches_authoring != Some(true);
    if needs_publication {
        actions.push(command_action(
            "bundle_pack",
            "Regenerate the bundle from the current authoring manifest/source; pack is the first mechanical step for initial creation or after content changes and is not blocked by strict inspection.",
            vec!["--project", &project, "bundle", "pack", "--json"],
            pack_prerequisites.clone(),
            pack_prerequisites.is_empty(),
        ));
        let strict_prerequisites = {
            let mut prerequisites = pack_prerequisites;
            prerequisites.push("bundle_pack".to_string());
            prerequisites
        };
        actions.push(command_action(
            "asset_inspect_strict",
            "After pack, verify static main-scene references, manifest sources, and bundle declarations; dynamic Luau references remain out of scope.",
            vec!["--project", &project, "asset", "inspect", "--strict", "--json"],
            strict_prerequisites.clone(),
            false,
        ));
        let install_prerequisites = {
            let mut prerequisites = strict_prerequisites;
            prerequisites.push("asset_inspect_strict".to_string());
            prerequisites
        };
        actions.push(command_action(
            "bundle_install_all",
            "After strict inspection passes, activate the complete generation at once; the query does not install bundles individually or clear the cache.",
            vec!["--project", &project, "bundle", "install", "--all", "--json"],
            install_prerequisites.clone(),
            false,
        ));
        let describe_prerequisites = {
            let mut prerequisites = install_prerequisites;
            prerequisites.push("bundle_install_all".to_string());
            prerequisites
        };
        actions.push(command_action(
            "asset_describe",
            "After activation, capture the same native-local observation again to confirm AssetSpec and primary/companion byte freshness.",
            vec!["--project", &project, "asset", "describe", "--id", selected.id.as_str(), "--json"],
            describe_prerequisites.clone(),
            false,
        ));
        for file in authoring_files {
            let action = if file.role == "primary" {
                "asset_read_primary"
            } else {
                "asset_read_companion"
            };
            let mut argv = vec![
                "--project".to_string(),
                project.clone(),
                "asset".to_string(),
                "read".to_string(),
                "--id".to_string(),
                selected.id.clone(),
            ];
            if file.role != "primary" {
                argv.push("--file".to_string());
                argv.push(file.path.clone());
            }
            argv.push("--json".to_string());
            actions.push(command_action(
                action,
                "Read only confirmed native-local verified bytes; describe argv has no output path, and a read export is not an authoring source.",
                argv.iter().map(String::as_str).collect(),
                vec!["asset_describe".to_string()],
                false,
            ));
        }
    } else {
        for file in authoring_files {
            let action = if file.role == "primary" {
                "asset_read_primary"
            } else {
                "asset_read_companion"
            };
            let mut argv = vec![
                "--project".to_string(),
                project.clone(),
                "asset".to_string(),
                "read".to_string(),
                "--id".to_string(),
                selected.id.clone(),
            ];
            if file.role != "primary" {
                argv.push("--file".to_string());
                argv.push(file.path.clone());
            }
            argv.push("--json".to_string());
            actions.push(command_action(
                action,
                "Active bytes match authoring; if the host needs a file, read it with an explicit read export.",
                argv.iter().map(String::as_str).collect(),
                Vec::new(),
                true,
            ));
        }
    }
    actions
}

fn manual_action(action: &str, reason: &str, prerequisites: Vec<String>) -> AssetWorkflowAction {
    AssetWorkflowAction {
        action: action.to_string(),
        kind: "manual".to_string(),
        reason: reason.to_string(),
        executable: None,
        argv: Vec::new(),
        ready: prerequisites.is_empty(),
        status: if prerequisites.is_empty() {
            "manual_required".to_string()
        } else {
            "blocked".to_string()
        },
        prerequisites,
    }
}

fn command_action(
    action: &str,
    reason: &str,
    argv: Vec<&str>,
    prerequisites: Vec<String>,
    ready: bool,
) -> AssetWorkflowAction {
    let ready = ready && prerequisites.is_empty();
    AssetWorkflowAction {
        action: action.to_string(),
        kind: "command".to_string(),
        reason: reason.to_string(),
        executable: Some("game".to_string()),
        argv: argv.into_iter().map(str::to_string).collect(),
        ready,
        status: if ready {
            "ready".to_string()
        } else {
            "blocked".to_string()
        },
        prerequisites,
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use crate::{BundleManager, pack_project};
    use crate::asset::workflow_test_support::{
        cache_path, installed_project, replace_installed_bundle,
    };

    use super::describe_asset;

    fn write_project(root: &std::path::Path, manifest: &str, scene: &str) {
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(root.join("scenes")).unwrap();
        fs::create_dir_all(root.join("scripts")).unwrap();
        fs::write(
            root.join("project.unone.json"),
            r#"{"name":"describe-test","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json","bundle_manifest":"bundles/manifest.json"}"#,
        )
        .unwrap();
        fs::write(root.join("scripts/main.luau"), b"return {}\n").unwrap();
        fs::write(root.join("scenes/main.scene.json"), scene).unwrap();
        fs::write(root.join("assets/manifest.json"), manifest).unwrap();
    }

    fn two_asset_manifest() -> &'static str {
        r#"{"version":1,"assets":[
            {"id":"asset://a","source":"assets/shared.svg","kind":"texture2d","bundle":"content","files":["assets/a.atlas"]},
            {"id":"asset://b","source":"assets/b.svg","kind":"texture2d","bundle":"other","files":["assets/shared.svg"]}
        ]}"#
    }

    fn two_asset_scene() -> &'static str {
        r#"{"entities":[
            {"id":"a-sprite","sprite":{"asset":"asset://a"}},
            {"id":"b-sprite","sprite":{"asset":"asset://b"}},
            {"id":"a-mesh","mesh3d":{"asset":"asset://a"}},
            {"id":"b-animation","animation":{"asset":"asset://b","animation":"idle"}}
        ]}"#
    }

    #[test]
    fn describes_selected_references_with_real_indexes_and_shared_paths_readonly() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), two_asset_manifest(), two_asset_scene());
        fs::write(dir.path().join("assets/shared.svg"), b"shared").unwrap();
        fs::write(dir.path().join("assets/a.atlas"), b"atlas").unwrap();
        fs::write(dir.path().join("assets/b.svg"), b"b").unwrap();
        assert!(pack_project(dir.path(), None).ok);
        assert!(BundleManager::from_project(dir.path())
            .unwrap()
            .install("content")
            .ok);

        let before_manifest = fs::read(dir.path().join("assets/manifest.json")).unwrap();
        let before_scene = fs::read(dir.path().join("scenes/main.scene.json")).unwrap();
        let before_source = fs::read(dir.path().join("assets/shared.svg")).unwrap();
        let result = describe_asset(dir.path(), "asset://a");
        assert!(result.ok, "{result:?}");
        let report = result.value.unwrap();
        assert_eq!(report.authoring.manifest_json_pointer, "/assets/0");
        assert_eq!(report.authoring.files[0].path, "assets/shared.svg");
        assert_eq!(report.authoring.files[0].role, "primary");
        assert_eq!(
            report.authoring.files[0].shared_with_asset_ids,
            vec!["asset://b"]
        );
        assert_eq!(report.references.len(), 2);
        assert_eq!(report.references[0].json_pointer, "/entities/0/sprite/asset");
        assert_eq!(report.references[0].entity, "a-sprite");
        assert_eq!(report.references[1].json_pointer, "/entities/2/mesh3d/asset");
        assert!(report
            .references
            .iter()
            .all(|reference| reference.id == "asset://a"));
        assert_eq!(report.reference_scope.scope, "main_scene_only");
        assert!(!report.reference_scope.dynamic_luau_assets_included);
        assert_eq!(report.publication.matches_authoring, Some(true));
        let companion_read = report
            .required_next_actions
            .iter()
            .find(|action| action.action == "asset_read_companion")
            .unwrap();
        assert_eq!(companion_read.executable.as_deref(), Some("game"));
        assert!(companion_read.argv.windows(2).any(|pair| {
            pair == ["--file", "assets/a.atlas"]
        }));
        assert!(!companion_read.argv.iter().any(|arg| arg == "--output"));
        assert_eq!(
            fs::read(dir.path().join("assets/manifest.json")).unwrap(),
            before_manifest
        );
        assert_eq!(
            fs::read(dir.path().join("scenes/main.scene.json")).unwrap(),
            before_scene
        );
        assert_eq!(
            fs::read(dir.path().join("assets/shared.svg")).unwrap(),
            before_source
        );
    }

    #[test]
    fn reports_uninstalled_and_repacked_but_not_activated_as_not_fresh() {
        let dir = tempdir().unwrap();
        write_project(
            dir.path(),
            r#"{"version":1,"assets":[{"id":"asset://a","source":"assets/a.svg","kind":"texture2d","bundle":"content"}]}"#,
            r#"{"entities":[{"id":"a","sprite":{"asset":"asset://a"}}]}"#,
        );
        fs::write(dir.path().join("assets/a.svg"), b"old").unwrap();
        assert!(pack_project(dir.path(), None).ok);
        let uninstalled = describe_asset(dir.path(), "asset://a");
        assert!(uninstalled.ok);
        let uninstalled = uninstalled.value.unwrap();
        assert_eq!(uninstalled.active.generation, None);
        assert_eq!(uninstalled.publication.matches_authoring, None);
        assert_eq!(uninstalled.required_next_actions[0].action, "bundle_pack");

        assert!(BundleManager::from_project(dir.path())
            .unwrap()
            .install("content")
            .ok);
        fs::write(dir.path().join("assets/a.svg"), b"new").unwrap();
        assert!(pack_project(dir.path(), None).ok);
        let repacked = describe_asset(dir.path(), "asset://a");
        assert!(repacked.ok);
        assert_ne!(
            repacked.value.unwrap().publication.matches_authoring,
            Some(true)
        );
    }

    #[test]
    fn keeps_special_project_paths_and_asset_ids_as_argv_values() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("project with spaces & [asset]");
        write_project(
            &root,
            r#"{"version":1,"assets":[{"id":"asset://hero-red","source":"assets/hero.svg","kind":"texture2d","bundle":"content"}]}"#,
            r#"{"entities":[]}"#,
        );
        fs::write(root.join("assets/hero.svg"), b"hero").unwrap();
        assert!(pack_project(&root, None).ok);

        let report = describe_asset(&root, "asset://hero-red");
        assert!(report.ok, "{report:?}");
        let report = report.value.unwrap();
        let project = std::fs::canonicalize(&root).unwrap().display().to_string();
        let pack = &report.required_next_actions[0];
        assert_eq!(pack.action, "bundle_pack");
        assert_eq!(
            pack.argv,
            vec![
                "--project".to_string(),
                project,
                "bundle".to_string(),
                "pack".to_string(),
                "--json".to_string()
            ]
        );
        let describe = report
            .required_next_actions
            .iter()
            .find(|action| action.action == "asset_describe")
            .unwrap();
        assert!(describe
            .argv
            .windows(2)
            .any(|pair| pair == ["--id", "asset://hero-red"]));
        assert!(!describe.argv.iter().any(|arg| arg == "--output"));
    }

    #[test]
    fn metadata_only_asset_spec_change_is_not_reported_as_fresh() {
        let dir = tempdir().unwrap();
        write_project(
            dir.path(),
            r#"{"version":1,"assets":[{"id":"asset://a","source":"assets/a.svg","kind":"texture2d","bundle":"content"}]}"#,
            r#"{"entities":[{"id":"a","sprite":{"asset":"asset://a"}}]}"#,
        );
        fs::write(dir.path().join("assets/a.svg"), b"same-bytes").unwrap();
        assert!(pack_project(dir.path(), None).ok);
        assert!(BundleManager::from_project(dir.path())
            .unwrap()
            .install("content")
            .ok);

        fs::write(
            dir.path().join("assets/manifest.json"),
            r#"{"version":1,"assets":[{"id":"asset://a","source":"assets/a.svg","kind":"spine","bundle":"content"}]}"#,
        )
        .unwrap();
        let before_pack = describe_asset(dir.path(), "asset://a");
        assert!(before_pack.ok, "{before_pack:?}");
        let before_pack = before_pack.value.unwrap();
        assert_eq!(before_pack.publication.asset_spec_matches, Some(false));
        assert_eq!(before_pack.publication.matches_authoring, Some(false));

        assert!(pack_project(dir.path(), None).ok);
        let result = describe_asset(dir.path(), "asset://a");
        assert!(result.ok, "{result:?}");
        assert_eq!(result.value.unwrap().publication.matches_authoring, None);
    }

    #[test]
    fn missing_authoring_source_stays_describable_and_blocks_mechanical_actions() {
        let dir = tempdir().unwrap();
        write_project(
            dir.path(),
            r#"{"version":1,"assets":[{"id":"asset://missing","source":"assets/missing.svg","kind":"texture2d","bundle":"content"}]}"#,
            r#"{"entities":[]}"#,
        );
        let result = describe_asset(dir.path(), "asset://missing");
        assert!(result.ok, "{result:?}");
        let report = result.value.unwrap();
        assert!(!report.authoring.files[0].exists);
        assert_eq!(report.authoring.files[0].sha256, None);
        assert_eq!(report.publication.matches_authoring, None);
        assert_eq!(report.required_next_actions[0].kind, "manual");
        assert_eq!(report.required_next_actions[0].action, "authoring_files_ready");
        assert!(!report.required_next_actions[1].ready);
        assert_eq!(report.required_next_actions[1].action, "bundle_pack");
    }

    #[test]
    fn active_content_failures_are_discoverable_once_with_file_locations() {
        for (failure, code, failed_files) in [
            ("cache_miss", "BUNDLE_CACHE_MISS", 3),
            ("cache_corrupt", "BUNDLE_CACHE_CORRUPT", 3),
            ("archive_invalid", "ASSET_ARCHIVE_INVALID", 3),
            ("entry_missing", "ASSET_NOT_IN_BUNDLE", 1),
            ("entry_corrupt", "ASSET_CONTENT_CORRUPT", 1),
        ] {
            let dir = installed_project();
            match failure {
                "cache_miss" => fs::remove_file(cache_path(dir.path(), "content")).unwrap(),
                "cache_corrupt" => {
                    fs::write(cache_path(dir.path(), "content"), b"corrupt").unwrap()
                }
                "archive_invalid" => {
                    replace_installed_bundle(dir.path(), "content", b"not-an-archive")
                }
                "entry_missing" => {
                    let path = dir.path().join("assets/manifest.json");
                    let mut manifest: serde_json::Value =
                        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                    manifest["assets"][0]["files"]
                        .as_array_mut()
                        .unwrap()
                        .push(serde_json::json!("assets/missing-from-archive.png"));
                    let bytes = serde_json::to_vec(&manifest).unwrap();
                    fs::write(path, &bytes).unwrap();
                    fs::write(dir.path().join("assets/missing-from-archive.png"), b"page").unwrap();
                    replace_installed_bundle(dir.path(), "asset-manifest", &bytes);
                }
                "entry_corrupt" => {
                    let mut archive = BundleManager::from_project(dir.path())
                        .unwrap()
                        .read_active_bundle("content")
                        .unwrap();
                    *archive.last_mut().unwrap() ^= 1;
                    replace_installed_bundle(dir.path(), "content", &archive);
                }
                _ => unreachable!(),
            }
            let result = describe_asset(dir.path(), "asset://a");
            assert!(result.ok, "{failure}: {result:?}");
            assert_eq!(result.diagnostics.len(), 1, "{failure}: {result:?}");
            assert_eq!(result.diagnostics[0].code, code);
            let report = result.value.unwrap();
            assert_eq!(report.active.diagnostics.len(), 1);
            assert_eq!(report.active.diagnostics[0].code, code);
            assert_eq!(report.publication.matches_authoring, None);
            assert!(report.active.observation_consistent);
            let failed = report
                .active
                .files
                .iter()
                .filter(|file| !file.verified)
                .collect::<Vec<_>>();
            assert_eq!(failed.len(), failed_files, "{failure}");
            for file in failed {
                assert_eq!(file.diagnostic.as_ref().unwrap().code, code);
                assert!(
                    report
                        .authoring
                        .files
                        .iter()
                        .any(|authoring| authoring.path == file.path)
                );
                assert_eq!(file.sha256, None);
                assert_eq!(file.size_bytes, None);
                if failure == "entry_missing" {
                    assert_eq!(file.path, "assets/missing-from-archive.png");
                    assert_eq!(file.role, "companion");
                }
                let output = dir.path().join("export/result.bin");
                let read = crate::asset::read(
                    dir.path(),
                    "asset://a",
                    (file.role == "companion").then_some(file.path.as_str()),
                    Some(&output),
                );
                assert!(!read.ok, "{failure}: {read:?}");
                assert_eq!(read.diagnostics[0].code, code);
                assert!(read.effects.is_empty());
                assert!(!output.parent().unwrap().exists());
            }
        }
    }

    #[test]
    fn corrupt_latest_active_record_has_one_diagnostic_and_no_repair_loop() {
        let dir = tempdir().unwrap();
        write_project(
            dir.path(),
            r#"{"version":1,"assets":[{"id":"asset://a","source":"assets/a.svg","kind":"texture2d","bundle":"content"}]}"#,
            r#"{"entities":[{"id":"a","sprite":{"asset":"asset://a"}}]}"#,
        );
        fs::write(dir.path().join("assets/a.svg"), b"old").unwrap();
        assert!(pack_project(dir.path(), None).ok);
        assert!(BundleManager::from_project(dir.path())
            .unwrap()
            .install("content")
            .ok);
        fs::write(dir.path().join("assets/a.svg"), b"new").unwrap();
        assert!(pack_project(dir.path(), None).ok);
        assert!(BundleManager::from_project(dir.path())
            .unwrap()
            .install("content")
            .ok);

        let active_dir = dir.path().join(".unone/active/bundles");
        let mut records = fs::read_dir(&active_dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
            .collect::<Vec<_>>();
        records.sort();
        fs::write(records.last().unwrap(), b"not-json").unwrap();

        let result = describe_asset(dir.path(), "asset://a");
        assert!(result.ok, "{result:?}");
        let report = result.value.unwrap();
        assert_eq!(report.publication.matches_authoring, None);
        assert_eq!(
            report
                .active
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.code == "BUNDLE_ACTIVE_GENERATION_UNREADABLE")
                .count(),
            1
        );
        assert_eq!(
            result
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.code == "BUNDLE_ACTIVE_GENERATION_UNREADABLE")
                .count(),
            1
        );
        assert_eq!(report.required_next_actions[0].action, "repair_active_generation_record");
        assert!(report
            .required_next_actions
            .iter()
            .filter(|action| action.kind == "command")
            .all(|action| !action.ready));
        assert!(!report
            .required_next_actions
            .iter()
            .any(|action| action.reason.contains("clear cache")));
    }
}

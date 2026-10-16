//! Versioned, SDK-bundled pure Luau libraries. No filesystem or network loader.
use std::collections::BTreeMap;

use crate::{Diagnostic, SystemSettings};

#[cfg(feature = "ui")]
pub(crate) fn ui_components_source() -> &'static str {
    include_str!("../../../packages/unone-ui/src/components.luau")
}

#[cfg(feature = "ui")]
pub(crate) fn ui_components_info() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../packages/unone-ui/package.unone.json"))
        .expect("bundled UI package manifest")
}

/// Exact package versions implemented by this binary for the enabled systems.
/// Runtime descriptors use the same registry as validation and API binding.
pub fn compiled_runtime_packages(settings: &SystemSettings) -> BTreeMap<String, String> {
    #[cfg(feature = "ui")]
    if settings.is_enabled("ui") {
        let info = ui_components_info();
        return BTreeMap::from([(
            info["name"].as_str().expect("package name").to_owned(),
            info["version"].as_str().expect("package version").to_owned(),
        )]);
    }
    #[cfg(not(feature = "ui"))]
    let _ = settings;
    BTreeMap::new()
}

pub(crate) fn validate_runtime_packages(
    required: &BTreeMap<String, String>,
    settings: &SystemSettings,
) -> Result<(), Box<Diagnostic>> {
    let available = compiled_runtime_packages(settings);
    for (name, version) in required {
        if available.get(name) != Some(version) {
            let mut diagnostic = Diagnostic::error(
                "RUNTIME_PACKAGE_UNAVAILABLE",
                "The project requires a runtime package unavailable in this build",
                format!(
                    "Required {name}@{version}; available version: {}. Use a matching SDK/player and enable its owning system. Runtime packages are SDK-bundled exact versions; this declaration does not download or load local modules.",
                    available.get(name).map_or("<not available>", String::as_str)
                ),
            );
            diagnostic.facts = serde_json::json!({
                "required_packages": required, "available_packages": available,
                "package": name, "expected": version, "found": available.get(name),
            });
            return Err(Box::new(diagnostic));
        }
    }
    Ok(())
}

/// The source, provenance, authoring guide and canonical strict types of the
/// official package accompany portable SDKs. Binaries embed the same source.
#[cfg(feature = "dev-tools")]
pub fn runtime_package_files() -> Vec<(&'static str, &'static str)> {
    vec![
        ("packages/unone-ui/package.unone.json", include_str!("../../../packages/unone-ui/package.unone.json")),
        ("packages/unone-ui/src/components.luau", include_str!("../../../packages/unone-ui/src/components.luau")),
        ("packages/unone-ui/README.md", include_str!("../../../packages/unone-ui/README.md")),
        ("docs/engine.d.luau", include_str!("engine.d.luau")),
        ("docs/ui-components.md", include_str!("../../../docs/ui-components.md")),
        ("docs/ui-styling.md", include_str!("../../../docs/ui-styling.md")),
        ("docs/ui-scroll.md", include_str!("../../../docs/ui-scroll.md")),
        ("docs/formal-ui-host.md", include_str!("../../../docs/formal-ui-host.md")),
        ("docs/ui-slice-and-budget.md", include_str!("../../../docs/ui-slice-and-budget.md")),
        ("docs/ui.schema.json", include_str!("../../../docs/ui.schema.json")),
        ("docs/project.schema.json", include_str!("../../../docs/project.schema.json")),
        ("docs/decisions/0038-shared-ui-styling.md", include_str!("../../../docs/decisions/0038-shared-ui-styling.md")),
        ("docs/decisions/0039-component-background-intent.md", include_str!("../../../docs/decisions/0039-component-background-intent.md")),
        ("docs/decisions/0040-official-ui-package.md", include_str!("../../../docs/decisions/0040-official-ui-package.md")),
    ]
}

#[cfg(all(test, feature = "ui"))]
mod tests {
    use super::*;

    #[test]
    fn exact_versions_and_system_ownership_are_checked_without_loading_game_code() {
        let settings = SystemSettings::default();
        let available = compiled_runtime_packages(&settings);
        assert_eq!(available.get("@unone/ui").unwrap(), "0.2.0");
        validate_runtime_packages(&available, &settings).unwrap();
        for required in [
            BTreeMap::from([("@unone/ui".into(), "99.0.0".into())]),
            BTreeMap::from([("@unknown/package".into(), "0.1.0".into())]),
        ] {
            let error = validate_runtime_packages(&required, &settings).unwrap_err();
            assert_eq!(error.code, "RUNTIME_PACKAGE_UNAVAILABLE");
            assert_eq!(error.facts["required_packages"], serde_json::to_value(required).unwrap());
        }
        let disabled = SystemSettings::resolve(&BTreeMap::from([("ui".into(), false)])).unwrap();
        assert!(compiled_runtime_packages(&disabled).is_empty());
        assert!(validate_runtime_packages(&available, &disabled).is_err());
        validate_runtime_packages(&BTreeMap::new(), &disabled).unwrap();
    }

    #[cfg(feature = "dev-tools")]
    #[test]
    fn package_and_documented_types_ship_from_the_compiled_canonical_sources() {
        let files = runtime_package_files();
        assert_eq!(files.iter().find(|(path, _)| *path == "docs/engine.d.luau").unwrap().1, crate::api::typings());
        let docs = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/engine.d.luau");
        assert_eq!(std::fs::read_to_string(docs).unwrap().replace("\r\n", "\n"), crate::api::typings().replace("\r\n", "\n"));
        assert!(files.iter().any(|(path, _)| *path == "packages/unone-ui/src/components.luau"));
        assert!(files.iter().any(|(path, text)| *path == "docs/ui-components.md" && text.contains("api.ui.components.create")));
    }
}

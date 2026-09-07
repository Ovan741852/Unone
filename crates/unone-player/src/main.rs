// Both hosts use the same bridge. The player cannot enable developer tooling.
#[cfg(feature = "dev-tools")]
compile_error!("unone-player cannot include dev-tools; build the development host instead");
const _: () = assert!(
    !unone_engine::DEV_TOOLS_ENABLED,
    "player dependency enabled dev-tools"
);
include!("../../unone-web-live-smoke/src/main.rs");

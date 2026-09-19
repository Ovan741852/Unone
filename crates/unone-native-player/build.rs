use std::{env, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=windows.manifest");

    let is_windows_msvc = env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if !is_windows_msvc {
        return;
    }

    let manifest = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set for build scripts"),
    )
    .join("windows.manifest");
    println!("cargo:rustc-link-arg-bin=unone-native-player=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg-bin=unone-native-player=/MANIFESTINPUT:{}",
        manifest.display()
    );
}

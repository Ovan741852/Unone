fn main() {
    // iOS: the game is in the app bundle and winit's event loop never returns.
    #[cfg(target_os = "ios")]
    unone_native_player::ios_main();
    #[cfg(not(target_os = "ios"))]
    if let Err(e) = unone_native_player::desktop() {
        eprintln!("{e}");
        std::process::exit(2);
    }
}

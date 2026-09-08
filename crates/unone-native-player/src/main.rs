fn main() {
    if let Err(e) = unone_native_player::desktop() {
        eprintln!("{e}");
        std::process::exit(2);
    }
}

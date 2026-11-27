// Unone native player embedded in an iOS host app (crates/unone-native-player/src/embed.rs).
// Link the iOS static library built with:
//   cargo rustc --release --lib --crate-type staticlib --target aarch64-apple-ios --manifest-path crates/unone-native-player/Cargo.toml
// All calls must come from the main thread.
#ifndef UNONE_PLAYER_H
#define UNONE_PLAYER_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct EmbeddedPlayer UnonePlayer;

// Starts the exported game in package_dir (content/, export.json, native-player.json) inside view (a UIView*,
// ideally one whose layer is a CAMetalLayer), at width x height physical pixels and the given scale. The save
// and reports go under data_dir. Returns NULL and sets *error (free with unone_player_free_string) on failure.
UnonePlayer *unone_player_start(void *view, uint32_t width, uint32_t height, double scale,
                                const char *package_dir, const char *data_dir, char **error);
// One display frame (call from a CADisplayLink). Returns false once the game quit or failed to start.
bool unone_player_frame(UnonePlayer *player);
void unone_player_resize(UnonePlayer *player, uint32_t width, uint32_t height, double scale);
// phase: 0 began, 1 moved, 2 ended, 3 cancelled. x, y in the view's physical pixels.
void unone_player_touch(UnonePlayer *player, uint64_t id, uint32_t phase, double x, double y);
void unone_player_suspend(UnonePlayer *player);
void unone_player_resume(UnonePlayer *player);
// The error that stopped the game, or NULL. Free with unone_player_free_string.
char *unone_player_error(UnonePlayer *player);
void unone_player_stop(UnonePlayer *player);
void unone_player_free_string(char *text);

#ifdef __cplusplus
}
#endif

#endif

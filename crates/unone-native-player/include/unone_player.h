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
// For an installed package, load startup files first and look up the rest on demand.
// bundle_cache may be NULL for an installed directory export.
UnonePlayer *unone_player_start_installed(void *view, uint32_t width, uint32_t height, double scale,
                                         const char *package_dir, const char *data_dir,
                                         const char *bundle_cache, char **error);
bool unone_player_game_presented(const UnonePlayer *player);
// One display frame (call from a CADisplayLink). Returns false once the game quit or failed to start.
bool unone_player_frame(UnonePlayer *player);
// Delivers the latest JSON on this channel at the next simulation tick. False while loading or for invalid data.
bool unone_player_set_host_data(UnonePlayer *player, const char *channel, const char *json);
// Returns a JSON value from the last simulation tick, or NULL for an unknown key. Free with unone_player_free_string.
char *unone_player_observation(const UnonePlayer *player, const char *key);
uint64_t unone_player_tick(const UnonePlayer *player);
// Per-slot (1..4) held physical state. Buttons use XInput's packed layout; sticks have positive y up.
void unone_player_gamepad(UnonePlayer *player, uint8_t slot, bool connected, uint16_t buttons,
                          int16_t lx, int16_t ly, int16_t rx, int16_t ry, uint8_t lt, uint8_t rt);
void unone_player_resize(UnonePlayer *player, uint32_t width, uint32_t height, double scale);
// Sets the full drawable size and its unobstructed edges together (all values in physical pixels).
// Call once after start, before the first frame, then for resize/rotation and inset-only updates.
bool unone_player_set_viewport(UnonePlayer *player, uint32_t width, uint32_t height, double scale,
                               double left, double top, double right, double bottom);
// phase: 0 began, 1 moved, 2 ended, 3 cancelled. x, y in the view's physical pixels.
void unone_player_touch(UnonePlayer *player, uint64_t id, uint32_t phase, double x, double y);
void unone_player_suspend(UnonePlayer *player);
void unone_player_resume(UnonePlayer *player);
// The error that stopped the game, or NULL. Free with unone_player_free_string.
char *unone_player_error(UnonePlayer *player);
void unone_player_stop(UnonePlayer *player);
// Thread-safe. Plan from export.json and an array of installed export.json objects.
// Returns plan JSON or NULL and sets *error. Free either string with unone_player_free_string.
char *unone_player_plan_update(const char *next, const char *installed, char **error);
void unone_player_free_string(char *text);

#ifdef __cplusplus
}
#endif

#endif

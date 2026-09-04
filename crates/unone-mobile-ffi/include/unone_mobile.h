#ifndef UNONE_MOBILE_H
#define UNONE_MOBILE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct UnoneMobileSession UnoneMobileSession;

UnoneMobileSession *unone_mobile_init(void);
void unone_mobile_shutdown(UnoneMobileSession *session);

int32_t unone_mobile_load_project(
    UnoneMobileSession *session,
    const uint8_t *payload,
    size_t payload_length,
    uint64_t seed);

int32_t unone_mobile_set_save_payload(
    UnoneMobileSession *session,
    const uint8_t *payload,
    size_t payload_length);

int32_t unone_mobile_bundle_begin(
    UnoneMobileSession *session,
    const uint8_t *bundle_spec,
    size_t bundle_spec_length);
int32_t unone_mobile_bundle_write(
    UnoneMobileSession *session,
    const uint8_t *chunk,
    size_t chunk_length);
int32_t unone_mobile_bundle_finish(UnoneMobileSession *session);

int32_t unone_mobile_set_input_frame(
    UnoneMobileSession *session,
    const uint8_t *payload,
    size_t payload_length);
int32_t unone_mobile_set_pointer(
    UnoneMobileSession *session,
    double x,
    double y,
    int32_t down);
int32_t unone_mobile_set_action(
    UnoneMobileSession *session,
    const uint8_t *action,
    size_t action_length,
    int32_t is_down);

int32_t unone_mobile_resize(
    UnoneMobileSession *session,
    uint32_t width_px,
    uint32_t height_px,
    double scale_factor,
    double safe_left_px,
    double safe_top_px,
    double safe_right_px,
    double safe_bottom_px);
int32_t unone_mobile_surface_lost(UnoneMobileSession *session);

int32_t unone_mobile_pause(UnoneMobileSession *session);
int32_t unone_mobile_resume(UnoneMobileSession *session);
int32_t unone_mobile_tick(UnoneMobileSession *session);

int32_t unone_mobile_reload_script(
    UnoneMobileSession *session,
    const uint8_t *source,
    size_t source_length);

const uint8_t *unone_mobile_observation_ptr(const UnoneMobileSession *session);
size_t unone_mobile_observation_len(const UnoneMobileSession *session);

#ifdef __cplusplus
}
#endif

#endif

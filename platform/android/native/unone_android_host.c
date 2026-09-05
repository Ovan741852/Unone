#include <jni.h>
#include <stdint.h>

#include "unone_mobile.h"

static UnoneMobileSession *session_from_jlong(jlong value) {
    return (UnoneMobileSession *)(uintptr_t)value;
}

static int32_t with_byte_array(
    JNIEnv *env,
    jbyteArray payload,
    int32_t (*call)(const uint8_t *, size_t, void *),
    void *context) {
    if (payload == NULL) return -1;
    jsize length = (*env)->GetArrayLength(env, payload);
    jbyte *bytes = (*env)->GetByteArrayElements(env, payload, NULL);
    if (bytes == NULL) return -1;
    int32_t result = call((const uint8_t *)bytes, (size_t)length, context);
    (*env)->ReleaseByteArrayElements(env, payload, bytes, JNI_ABORT);
    return result;
}

struct load_context {
    UnoneMobileSession *session;
    uint64_t seed;
};

static int32_t load_call(const uint8_t *bytes, size_t length, void *raw) {
    struct load_context *context = (struct load_context *)raw;
    return unone_mobile_load_project(context->session, bytes, length, context->seed);
}

JNIEXPORT jlong JNICALL
Java_com_unone_android_UnoneNative_init(JNIEnv *env, jclass type) {
    (void)env;
    (void)type;
    return (jlong)(uintptr_t)unone_mobile_init();
}

JNIEXPORT void JNICALL
Java_com_unone_android_UnoneNative_shutdown(JNIEnv *env, jclass type, jlong value) {
    (void)env;
    (void)type;
    unone_mobile_shutdown(session_from_jlong(value));
}

JNIEXPORT jint JNICALL
Java_com_unone_android_UnoneNative_loadProject(
    JNIEnv *env, jclass type, jlong value, jbyteArray payload, jlong seed) {
    (void)type;
    struct load_context context = {session_from_jlong(value), (uint64_t)seed};
    return (jint)with_byte_array(env, payload, load_call, &context);
}

JNIEXPORT jint JNICALL
Java_com_unone_android_UnoneNative_setPointer(
    JNIEnv *env, jclass type, jlong value, jdouble x, jdouble y, jboolean down) {
    (void)env;
    (void)type;
    return (jint)unone_mobile_set_pointer(session_from_jlong(value), x, y, down ? 1 : 0);
}

JNIEXPORT jint JNICALL
Java_com_unone_android_UnoneNative_setScreenPointer(
    JNIEnv *env, jclass type, jlong value, jdouble x, jdouble y) {
    (void)env;
    (void)type;
    return (jint)unone_mobile_set_screen_pointer(session_from_jlong(value), x, y);
}

JNIEXPORT jint JNICALL
Java_com_unone_android_UnoneNative_resize(
    JNIEnv *env, jclass type, jlong value, jint width, jint height, jfloat density) {
    (void)env;
    (void)type;
    return (jint)unone_mobile_resize(
        session_from_jlong(value), (uint32_t)width, (uint32_t)height, (double)density,
        0.0, 0.0, 0.0, 0.0);
}

JNIEXPORT jint JNICALL
Java_com_unone_android_UnoneNative_pause(JNIEnv *env, jclass type, jlong value) {
    (void)env;
    (void)type;
    return (jint)unone_mobile_pause(session_from_jlong(value));
}

JNIEXPORT jint JNICALL
Java_com_unone_android_UnoneNative_resume(JNIEnv *env, jclass type, jlong value) {
    (void)env;
    (void)type;
    return (jint)unone_mobile_resume(session_from_jlong(value));
}

JNIEXPORT jint JNICALL
Java_com_unone_android_UnoneNative_tick(JNIEnv *env, jclass type, jlong value) {
    (void)env;
    (void)type;
    return (jint)unone_mobile_tick(session_from_jlong(value));
}

JNIEXPORT jbyteArray JNICALL
Java_com_unone_android_UnoneNative_observation(JNIEnv *env, jclass type, jlong value) {
    (void)type;
    UnoneMobileSession *session = session_from_jlong(value);
    const uint8_t *pointer = unone_mobile_observation_ptr(session);
    size_t length = unone_mobile_observation_len(session);
    if (pointer == NULL || length > (size_t)0x7fffffff) return NULL;
    jbyteArray result = (*env)->NewByteArray(env, (jsize)length);
    if (result == NULL) return NULL;
    (*env)->SetByteArrayRegion(env, result, 0, (jsize)length, (const jbyte *)pointer);
    return result;
}

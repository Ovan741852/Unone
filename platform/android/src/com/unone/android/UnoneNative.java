package com.unone.android;

final class UnoneNative {
    static {
        System.loadLibrary("unone_mobile_ffi");
        System.loadLibrary("unone_android_host");
    }

    private UnoneNative() {}

    static native long init();
    static native void shutdown(long session);
    static native int loadProject(long session, byte[] payload, long seed);
    static native int setPointer(long session, double x, double y, boolean down);
    static native int setScreenPointer(long session, double x, double y);
    static native int resize(long session, int width, int height, float density);
    static native int pause(long session);
    static native int resume(long session);
    static native int tick(long session);
    static native byte[] observation(long session);
}

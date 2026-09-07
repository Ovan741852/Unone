package com.unone.android;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.View;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public final class UnoneActivity extends Activity {
    private UnoneView gameView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        gameView = new UnoneView(this);
        setContentView(gameView);
    }

    @Override
    protected void onPause() {
        if (gameView != null) gameView.pauseRuntime();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (gameView != null) gameView.resumeRuntime();
    }

    @Override
    protected void onDestroy() {
        if (gameView != null) gameView.closeRuntime();
        super.onDestroy();
    }

    private static final class UnoneView extends View {
        private static final String TAG = "UnoneAndroidHost";

        private final Handler handler = new Handler(Looper.getMainLooper());
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private long session;
        private String observation = "{}";
        private String failure = null;
        private boolean closed = false;
        private boolean paused = false;

        private final Runnable frame = new Runnable() {
            @Override
            public void run() {
                if (closed) return;
                if (!paused && session != 0) {
                    if (UnoneNative.tick(session) != 0) {
                        failure = "engine tick failed";
                    }
                    readObservation();
                }
                invalidate();
                handler.postDelayed(this, 16L);
            }
        };

        UnoneView(Context context) {
            super(context);
            setFocusable(true);
            session = UnoneNative.init();
            if (session == 0) {
                failure = "unone_mobile_init returned null";
                return;
            }
            try {
                byte[] payload = readAsset(context, "unone-project.json");
                if (UnoneNative.loadProject(session, payload, 42L) != 0) {
                    failure = "project load failed";
                } else {
                    Log.i(TAG, "project_loaded");
                    readObservation();
                }
            } catch (IOException error) {
                failure = "project asset read failed: " + error.getMessage();
            }
            handler.post(frame);
        }

        private static byte[] readAsset(Context context, String name) throws IOException {
            try (InputStream input = context.getAssets().open(name);
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count > 0) output.write(buffer, 0, count);
                }
                return output.toByteArray();
            }
        }

        private void readObservation() {
            byte[] bytes = UnoneNative.observation(session);
            if (bytes == null) {
                failure = "observation pointer returned null";
                return;
            }
            observation = new String(bytes, StandardCharsets.UTF_8);
        }

        void pauseRuntime() {
            if (session != 0 && !paused) {
                if (UnoneNative.pause(session) != 0) {
                    failure = "runtime pause failed";
                } else {
                    Log.i(TAG, "runtime_paused");
                }
                paused = true;
            }
        }

        void resumeRuntime() {
            if (session != 0 && paused) {
                if (UnoneNative.resume(session) != 0) {
                    failure = "runtime resume failed";
                } else {
                    Log.i(TAG, "runtime_resumed");
                }
                paused = false;
            }
        }

        void closeRuntime() {
            if (!closed) {
                closed = true;
                handler.removeCallbacks(frame);
                if (session != 0) {
                    UnoneNative.shutdown(session);
                    session = 0;
                }
            }
        }

        @Override
        protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
            super.onSizeChanged(width, height, oldWidth, oldHeight);
            if (session != 0 && width > 0 && height > 0) {
                float density = getResources().getDisplayMetrics().density;
                if (UnoneNative.resize(session, width, height, density) != 0) {
                    failure = "surface resize failed";
                }
            }
        }

        // This Canvas adapter renders Camera2D only. Screen coordinates also
        // remain available to 3D game code; they are not a fabricated 3D ray.
        private float[] camera2d() {
            try {
                JSONObject world = new JSONObject(observation).optJSONObject("world");
                JSONObject camera = world == null ? null : world.optJSONObject("camera");
                JSONObject position = camera == null ? null : camera.optJSONObject("position");
                float height = camera == null ? 10.0f : (float) camera.optDouble("view_height", 10.0);
                float zoom = camera == null ? 1.0f : (float) camera.optDouble("zoom", 1.0);
                return new float[] { position == null ? 0 : (float) position.optDouble("x", 0),
                    position == null ? 0 : (float) position.optDouble("y", 0), getHeight() * zoom / height };
            } catch (JSONException error) { return new float[] {0, 0, getHeight() / 10.0f}; }
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            if (session == 0 || closed || getWidth() == 0 || getHeight() == 0) return true;
            boolean down = event.getActionMasked() != MotionEvent.ACTION_UP
                    && event.getActionMasked() != MotionEvent.ACTION_CANCEL;
            float[] camera = camera2d();
            float worldX = camera[0] + (event.getX() - getWidth() * 0.5f) / camera[2];
            float worldY = camera[1] + (getHeight() * 0.5f - event.getY()) / camera[2];
            float screenX = event.getX() * 100.0f / getWidth();
            float screenY = (getHeight() - event.getY()) * 100.0f / getHeight();
            UnoneNative.setPointer(session, worldX, worldY, down);
            UnoneNative.setScreenPointer(session, screenX, screenY);
            if (!down) readObservation();
            return true;
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            canvas.drawColor(Color.rgb(20, 28, 42));
            paint.setStyle(Paint.Style.FILL);
            drawWorld(canvas);
            paint.setColor(Color.WHITE);
            paint.setTextSize(28.0f);
            canvas.drawText("Unone Android host · Rust/Luau", 24.0f, 40.0f, paint);
            paint.setTextSize(20.0f);
            try {
                JSONObject root = new JSONObject(observation);
                JSONObject world = root.optJSONObject("world");
                long frame = world == null ? -1L : world.optLong("frame", -1L);
                canvas.drawText("frame=" + frame + (paused ? " paused" : " running"), 24.0f, 70.0f, paint);
                JSONObject observations = world == null ? null : world.optJSONObject("observations");
                if (observations != null) canvas.drawText(observations.toString(), 24.0f, 98.0f, paint);
            } catch (JSONException error) {
                failure = "observation JSON invalid: " + error.getMessage();
            }
            if (failure != null) {
                paint.setColor(Color.rgb(255, 150, 150));
                canvas.drawText(failure, 24.0f, getHeight() - 32.0f, paint);
            }
        }

        private void drawWorld(Canvas canvas) {
            try {
                JSONObject world = new JSONObject(observation).optJSONObject("world");
                if (world == null) return;
                JSONObject entities = world.optJSONObject("entities");
                if (entities == null) return;
                float[] camera = camera2d();
                Iterator<String> ids = entities.keys();
                while (ids.hasNext()) {
                    String id = ids.next();
                    JSONObject entity = entities.optJSONObject(id);
                    if (entity == null) continue;
                    JSONObject transform = entity.optJSONObject("transform");
                    if (transform == null) continue;
                    float x = (float) transform.optDouble("x", 0.0);
                    float y = (float) transform.optDouble("y", 0.0);
                    float centerX = getWidth() * 0.5f + (x - camera[0]) * camera[2];
                    float centerY = getHeight() * 0.5f - (y - camera[1]) * camera[2];
                    JSONObject sprite = entity.optJSONObject("sprite");
                    float width = camera[2];
                    float height = camera[2];
                    if (sprite != null) {
                        JSONObject size = sprite.optJSONObject("size");
                        if (size != null) {
                            width *= (float) size.optDouble("x", 1.0);
                            height *= (float) size.optDouble("y", 1.0);
                        }
                    }
                    if (id.contains("bird")) paint.setColor(Color.rgb(220, 55, 55));
                    else if (id.contains("pig")) paint.setColor(Color.rgb(90, 210, 100));
                    else if (id.contains("block")) paint.setColor(Color.rgb(180, 125, 70));
                    else paint.setColor(Color.rgb(85, 160, 230));
                    if (id.contains("bird") || id.contains("pig")) {
                        canvas.drawCircle(centerX, centerY, Math.max(width, height) * 0.5f, paint);
                    } else {
                        canvas.drawRect(new RectF(centerX - width * 0.5f, centerY - height * 0.5f,
                                centerX + width * 0.5f, centerY + height * 0.5f), paint);
                    }
                }
            } catch (JSONException error) {
                failure = "world JSON invalid: " + error.getMessage();
            }
        }
    }
}

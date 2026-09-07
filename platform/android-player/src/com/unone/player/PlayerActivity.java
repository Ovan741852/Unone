package com.unone.player;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.util.Log;
import android.view.View;
import android.webkit.*;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.Locale;

/** Offline release player: only verified APK assets are served to the WebView. */
public final class PlayerActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                Log.println(message.messageLevel() == ConsoleMessage.MessageLevel.ERROR ? Log.ERROR : Log.INFO,
                    "UnonePlayer", message.message());
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !local(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();
                if (!local(uri) || !"GET".equals(request.getMethod())) return error(403,"Blocked asset request");
                String path=uri.getPath();
                if (path == null || path.contains("..") || path.contains("\\") || path.contains("\0")) return error(400,"Invalid asset path");
                if (path.equals("/")) path="/index.html";
                try {
                    return new WebResourceResponse(mime(path), null, 200, "OK",
                        Collections.singletonMap("Cache-Control","no-cache"),getAssets().open("player"+path));
                } catch (IOException exception) {
                    Log.e("UnonePlayer","ASSET_NOT_FOUND: "+path);
                    return error(404,"Asset not found");
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showFailure("WEBVIEW_LOAD_FAILED: "+error.getDescription());
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                view.destroy(); web=null; showFailure("WEBVIEW_RENDERER_STOPPED: reopen the game"); return true;
            }
        });
        setContentView(web);
        web.loadUrl("https://"+HOST+"/index.html");
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort()==-1;
    }
    private static WebResourceResponse error(int status,String message) {
        return new WebResourceResponse("text/plain","UTF-8",status,message,
            Collections.emptyMap(),new ByteArrayInputStream(message.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
    private static String mime(String path) {
        String lower=path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".html")) return "text/html";
        String extension=MimeTypeMap.getFileExtensionFromUrl(lower);
        String mime=MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return mime == null ? "application/octet-stream" : mime;
    }
    private void showFailure(String message) {
        Log.e("UnonePlayer",message);
        runOnUiThread(()->{TextView text=new TextView(this);text.setText(message);text.setTextColor(0xffffffff);text.setBackgroundColor(0xff111827);text.setPadding(24,24,24,24);setContentView(text);});
    }
    @Override protected void onPause() {
        if (web!=null) { web.evaluateJavascript("window.dispatchEvent(new Event('unone-host-pause'))",null); web.onPause(); }
        Log.i("UnonePlayer","host_paused"); super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (web!=null) { web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('unone-host-resume'))",null); }
        Log.i("UnonePlayer","host_resumed");
    }
    @Override protected void onDestroy() {
        if (web!=null) { web.destroy();web=null; } super.onDestroy();
    }
}

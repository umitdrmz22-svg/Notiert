package de.defidev.notiert;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.view.View;
import android.widget.FrameLayout;
import android.view.WindowInsets;
import android.webkit.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Locale;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private WebView web;
    private PermissionRequest pendingMic;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xfffaf6ee);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setGeolocationEnabled(false);
        web.getSettings().setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                String path = req.getUrl().getPath();
                if (ORIGIN.equals(req.getUrl().getScheme() + "://" + req.getUrl().getAuthority())
                        && path != null && (path.matches("/[a-z]+[.](html|js|css)") || path.equals("/display.ttf"))) {
                    String mime = path.endsWith(".ttf") ? "font/ttf" : path.endsWith(".js") ? "application/javascript" :
                                  path.endsWith(".css") ? "text/css" : "text/html";
                    try { return new WebResourceResponse(mime, "UTF-8", 200, "OK", java.util.Collections.emptyMap(), getAssets().open(path.substring(1))); }
                    catch (IOException ignored) { }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found",
                        java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest req) {
                if (!ORIGIN.equals(req.getOrigin().getScheme() + "://" + req.getOrigin().getAuthority()) ||
                    !java.util.Arrays.asList(req.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                    req.deny(); return;
                }
                if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else if (pendingMic == null) {
                    pendingMic = req;
                    requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 10);
                } else req.deny();
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest req) {
                if (pendingMic == req) pendingMic = null;
            }
        });
        web.addJavascriptInterface(new Device(), "Device");
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR |
                View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        getWindow().setStatusBarColor(0xfffaf6ee);
        getWindow().setNavigationBarColor(0xfffaf6ee);
        // Size the WebView itself to the usable rectangle. Padding applied directly to
        // WebView does not reliably move its visual viewport on Samsung devices.
        FrameLayout viewport = new FrameLayout(this);
        viewport.setBackgroundColor(0xfffaf6ee);
        viewport.addView(web, new FrameLayout.LayoutParams(-1, -1));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            viewport.setOnApplyWindowInsetsListener((v, w) -> {
                android.graphics.Insets bars = w.getInsets(WindowInsets.Type.systemBars() |
                        WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(viewport);
        viewport.requestApplyInsets();
        web.loadUrl(ORIGIN + "/index.html");
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.appBack ? window.appBack() : false", result -> {
            if (!"true".equals(result)) super.onBackPressed();
        });
    }
    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == 10 && pendingMic != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED)
                pendingMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pendingMic.deny();
            pendingMic = null;
        }
    }
    public final class Device {
        @JavascriptInterface public void shareText(String title, String text) {
            runOnUiThread(() -> {
                Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(share, null));
            });
        }
    }
    @Override protected void onPause() {
        web.evaluateJavascript("window.stopActiveRecording && window.stopActiveRecording()", null);
        super.onPause();
    }
}

package de.defidev.notiert;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.IOException;
import java.io.OutputStream;

/** Uses only documents selected through the system picker. */
public final class ArchiveFiles {
    private static final int OPEN = 41;
    private static final int CREATE = 42;
    private final Activity activity;
    private final WebView web;
    private ValueCallback<Uri[]> source;
    private String ticket;
    private Uri destination;
    private OutputStream output;
    private long expected;
    private long written;

    ArchiveFiles(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    boolean chooseSource(ValueCallback<Uri[]> callback) {
        synchronized (this) {
            if (source != null || ticket != null) {
                callback.onReceiveValue(null);
                return true;
            }
            source = callback;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        try {
            activity.startActivityForResult(intent, OPEN);
        } catch (RuntimeException e) {
            completeSource(null);
        }
        return true;
    }

    private void completeSource(Uri uri) {
        ValueCallback<Uri[]> callback;
        synchronized (this) {
            callback = source;
            source = null;
        }
        if (callback != null) callback.onReceiveValue(uri == null ? null : new Uri[]{uri});
    }

    @JavascriptInterface public void chooseDestination(String token, String name, long size) {
        if (token == null || !token.matches("[a-zA-Z0-9-]{1,100}")) return;
        synchronized (this) {
            if (source != null || ticket != null || size <= 0 || name == null
                    || !name.matches("Notiert-[0-9]{4}-[0-9]{2}-[0-9]{2}[.]notiert")) {
                signal(token, "error");
                return;
            }
            ticket = token;
            expected = size;
            written = 0;
        }
        activity.runOnUiThread(() -> {
            try {
                activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream")
                        .putExtra(Intent.EXTRA_TITLE, name), CREATE);
            } catch (RuntimeException e) {
                release(token);
                signal(token, "error");
            }
        });
    }

    private void signal(String token, String status) {
        activity.runOnUiThread(() -> {
            if (!activity.isDestroyed()) web.evaluateJavascript(
                    "window.archiveDestination(" + JSONObject.quote(token) + "," + JSONObject.quote(status) + ")", null);
        });
    }

    boolean onResult(int request, int code, Intent data) {
        if (request != OPEN && request != CREATE) return false;
        Uri uri = code == Activity.RESULT_OK && data != null ? data.getData() : null;
        if (uri != null && !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) uri = null;
        if (request == OPEN) {
            completeSource(uri);
        } else {
            String token;
            synchronized (this) {
                token = ticket;
                destination = uri;
            }
            if (token != null) signal(token, uri != null ? "ready" : code == Activity.RESULT_CANCELED ? "cancel" : "error");
        }
        return true;
    }

    @JavascriptInterface public synchronized boolean append(String token, String block) {
        if (ticket == null || !ticket.equals(token) || destination == null || block == null
                || block.isEmpty() || block.length() > 131072) return false;
        try {
            byte[] bytes = Base64.decode(block, Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > expected - written) return false;
            if (output == null) output = activity.getContentResolver().openOutputStream(destination, "wt");
            if (output == null) throw new IOException("Document unavailable");
            output.write(bytes);
            written += bytes.length;
            return true;
        } catch (IOException | RuntimeException e) {
            release(token);
            return false;
        }
    }

    @JavascriptInterface public synchronized boolean finish(String token) {
        if (ticket == null || !ticket.equals(token) || output == null || expected != written) return false;
        try {
            output.close();
            output = null;
            destination = null;
            return true;
        } catch (IOException | RuntimeException e) {
            return false;
        }
    }

    @JavascriptInterface public synchronized void release(String token) {
        if (ticket == null || !ticket.equals(token)) return;
        if (output != null) {
            try { output.close(); } catch (IOException | RuntimeException ignored) { }
        }
        output = null;
        destination = null;
        ticket = null;
    }

    void close() {
        completeSource(null);
        synchronized (this) { release(ticket); }
    }
}

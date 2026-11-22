package de.defidev.notiert;

import static org.junit.Assert.assertEquals;
import android.graphics.Insets;
import android.graphics.Rect;
import android.view.DisplayCutout;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.webkit.WebView;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.net.Uri;
import java.util.Collections;
import java.util.Map;
import java.util.Scanner;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {33, 35})
public class ViewportTest {
    @Test public void webContentFitsBetweenBarsAndAboveKeyboard() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        FrameLayout content = activity.findViewById(android.R.id.content);
        FrameLayout viewport = (FrameLayout) content.getChildAt(0);
        WebView web = (WebView) viewport.getChildAt(0);
        assertEquals(FrameLayout.LayoutParams.MATCH_PARENT, web.getLayoutParams().width);
        assertEquals(FrameLayout.LayoutParams.MATCH_PARENT, web.getLayoutParams().height);
        for (int ime : new int[] {0, 320, 0}) {
            WindowInsets insets = new WindowInsets.Builder()
                .setInsets(WindowInsets.Type.statusBars(), Insets.of(0, 32, 0, 0))
                .setInsets(WindowInsets.Type.navigationBars(), Insets.of(0, 0, 0, 48))
                .setDisplayCutout(new DisplayCutout(Insets.of(12, 0, 0, 0),
                    new Rect(0, 400, 12, 440), null, null, null))
                .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, ime))
                .setVisible(WindowInsets.Type.systemBars(), true)
                .setVisible(WindowInsets.Type.ime(), ime > 0)
                .build();
            viewport.dispatchApplyWindowInsets(insets);
            assertEquals(12, viewport.getPaddingLeft());
            assertEquals(32, viewport.getPaddingTop());
            assertEquals(0, viewport.getPaddingRight());
            assertEquals(Math.max(48, ime), viewport.getPaddingBottom());
        }
    }
    private WebResourceResponse request(WebView web, String path) {
        WebResourceRequest request = new WebResourceRequest() {
            public Uri getUrl() { return Uri.parse("https://appassets.androidplatform.net/" + path); }
            public boolean isForMainFrame() { return false; }
            public boolean isRedirect() { return false; }
            public boolean hasGesture() { return false; }
            public String getMethod() { return "GET"; }
            public Map<String, String> getRequestHeaders() { return Collections.emptyMap(); }
        };
        return web.getWebViewClient().shouldInterceptRequest(web, request);
    }

    @Test public void entryPointCanLoadAllItsOfflineAssets() throws Exception {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).setup().get();
        FrameLayout content = activity.findViewById(android.R.id.content);
        WebView web = (WebView) ((FrameLayout) content.getChildAt(0)).getChildAt(0);
        try (Scanner file = new Scanner(request(web, "index.html").getData(), "UTF-8")) {
            Matcher assets = Pattern.compile("(?:src|href)=\"([^\"]+)\"").matcher(file.useDelimiter("\\A").next());
            int loaded = 0;
            while (assets.find()) {
                String name = assets.group(1);
                WebResourceResponse response = request(web, name);
                assertEquals(name, 200, response.getStatusCode());
                try (java.io.InputStream stream = response.getData()) {
                    org.junit.Assert.assertTrue(name, stream.read() >= 0);
                }
                loaded++;
            }
            org.junit.Assert.assertTrue(loaded >= 5);
        }
    }
}

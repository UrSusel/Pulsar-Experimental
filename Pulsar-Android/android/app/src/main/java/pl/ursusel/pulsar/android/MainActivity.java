package pl.ursusel.pulsar.android;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PulsarMediaPlugin.class);
        registerPlugin(PulsarDrivePlugin.class);
        registerPlugin(PulsarFolderPlugin.class);
        super.onCreate(savedInstanceState);
        applyBackgroundPlaybackPolicy();
    }

    /**
     * Keeps the WebView renderer important even while the app is not visible.
     * Without this Android/Chromium is free to deprioritise or suspend the
     * renderer as soon as the activity leaves the foreground, which stops the
     * JavaScript playback loop and with it the music.
     */
    private void applyBackgroundPlaybackPolicy() {
        WebView webView = currentWebView();
        if (webView == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }

    private WebView currentWebView() {
        Bridge bridge = getBridge();
        return bridge == null ? null : bridge.getWebView();
    }

    /**
     * Capacitor pauses the WebView whenever the activity pauses, and a paused
     * WebView stops its audio. Pulsar plays music, so while the playback
     * service reports a playing track, keep the WebView resumed and its
     * JavaScript timers running so audio and the JS playback loop continue with
     * the screen off.
     */
    @Override
    public void onPause() {
        super.onPause();
        if (!PulsarPlaybackService.isPlaying()) return;
        applyBackgroundPlaybackPolicy();
        WebView webView = currentWebView();
        if (webView == null) return;
        webView.onResume();
        webView.resumeTimers();
    }
}

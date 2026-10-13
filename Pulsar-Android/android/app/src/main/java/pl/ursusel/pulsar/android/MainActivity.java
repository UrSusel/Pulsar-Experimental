package pl.ursusel.pulsar.android;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PulsarMediaPlugin.class);
        super.onCreate(savedInstanceState);
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
        Bridge bridge = getBridge();
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;
        webView.onResume();
        webView.resumeTimers();
    }
}

package pl.ursusel.pulsar.android;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "PulsarMedia",
    permissions = {@Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})}
)
public class PulsarMediaPlugin extends Plugin {

    private BroadcastReceiver actionReceiver;
    private boolean receiverRegistered = false;

    @Override
    public void load() {
        super.load();
        actionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!PulsarPlaybackService.ACTION_MEDIA_CONTROL.equals(intent.getAction())) return;
                JSObject payload = new JSObject();
                payload.put("action", intent.getStringExtra(PulsarPlaybackService.EXTRA_CONTROL));
                payload.put("position", intent.getLongExtra(PulsarPlaybackService.EXTRA_POSITION, 0L));
                notifyListeners("mediaAction", payload, true);
            }
        };
        IntentFilter filter = new IntentFilter(PulsarPlaybackService.ACTION_MEDIA_CONTROL);
        try {
            ContextCompat.registerReceiver(getContext(), actionReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
            receiverRegistered = true;
        } catch (Exception ignored) {
            receiverRegistered = false;
        }
    }

    @PluginMethod
    public void updateState(PluginCall call) {
        Context context = getContext();
        boolean hasTrack = call.getBoolean("hasTrack", false);
        if (!hasTrack) {
            context.stopService(new Intent(context, PulsarPlaybackService.class));
            call.resolve();
            return;
        }

        Intent intent = new Intent(context, PulsarPlaybackService.class);
        intent.setAction(PulsarPlaybackService.ACTION_UPDATE);
        intent.putExtra(PulsarPlaybackService.EXTRA_HAS_TRACK, true);
        intent.putExtra(PulsarPlaybackService.EXTRA_TITLE, call.getString("title", ""));
        intent.putExtra(PulsarPlaybackService.EXTRA_ARTIST, call.getString("artist", ""));
        intent.putExtra(PulsarPlaybackService.EXTRA_PLAYING, call.getBoolean("playing", false));
        intent.putExtra(PulsarPlaybackService.EXTRA_POSITION, Math.max(0L, Math.round(call.getDouble("position", 0.0) * 1000.0)));
        intent.putExtra(PulsarPlaybackService.EXTRA_DURATION, Math.max(0L, Math.round(call.getDouble("duration", 0.0) * 1000.0)));

        try {
            if (call.getBoolean("playing", false)) {
                ContextCompat.startForegroundService(context, intent);
            } else {
                context.startService(intent);
            }
        } catch (RuntimeException ignored) {
            // Playback in the WebView remains available even if Android refuses a
            // background notification update (for example after the user denies it).
        }
        call.resolve();
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PermissionCallback
    public void notificationPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(result);
    }

    @Override
    protected void handleOnDestroy() {
        if (receiverRegistered && actionReceiver != null) {
            try { getContext().unregisterReceiver(actionReceiver); } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        super.handleOnDestroy();
    }
}

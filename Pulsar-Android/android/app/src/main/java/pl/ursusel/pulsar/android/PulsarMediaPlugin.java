package pl.ursusel.pulsar.android;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.webkit.WebSettings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;

@CapacitorPlugin(
    name = "PulsarMedia",
    permissions = {@Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})}
)
public class PulsarMediaPlugin extends Plugin {

    private static final long MAX_YOUTUBE_AUDIO_BYTES = 128L * 1024L * 1024L;
    private static final long YOUTUBE_CACHE_MAX_AGE_MS = 24L * 60L * 60L * 1000L;
    private static final String YOUTUBE_CACHE_DIR = "youtube-audio";
    private static final java.util.regex.Pattern YOUTUBE_ID =
        java.util.regex.Pattern.compile("^[A-Za-z0-9_-]{6,20}$");

    private BroadcastReceiver actionReceiver;
    private boolean receiverRegistered = false;
    private final ExecutorService youtubeAudioExecutor = Executors.newSingleThreadExecutor();

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

    /**
     * Resolve YouTube audio on-device using YouTube's InnerTube player API.
     * No user-run bridge/server or extra runtime package is required. Each
     * returned stream carries the client User-Agent needed for its CDN fetch.
     */
    @PluginMethod
    public void resolveYoutubeAudio(PluginCall call) {
        final String videoId = call.getString("videoId", "").trim();
        if (!YOUTUBE_ID.matcher(videoId).matches()) {
            call.reject("Invalid YouTube video ID.");
            return;
        }

        String defaultUserAgent;
        try { defaultUserAgent = WebSettings.getDefaultUserAgent(getContext()); }
        catch (Exception ignored) { defaultUserAgent = ""; }
        final String webViewUserAgent = defaultUserAgent;
        youtubeAudioExecutor.execute(() -> {
            try {
                java.util.List<YoutubeInnertubeResolver.Stream> streams =
                    YoutubeInnertubeResolver.resolve(videoId, webViewUserAgent);
                JSONArray candidates = new JSONArray();
                for (YoutubeInnertubeResolver.Stream stream : streams) {
                    JSObject candidate = new JSObject();
                    candidate.put("url", stream.url);
                    candidate.put("ext", stream.extension);
                    candidate.put("mimeType", stream.mimeType);
                    candidate.put("client", stream.clientName);
                    candidate.put("clientVersion", stream.clientVersion);
                    candidate.put("userAgent", stream.userAgent);
                    candidate.put("itag", stream.itag);
                    candidate.put("bitrate", stream.bitrate);
                    candidate.put("audioOnly", stream.audioOnly);
                    candidates.put(candidate);
                }
                JSObject result = new JSObject();
                result.put("streams", candidates);
                call.resolve(result);
            } catch (Exception error) {
                String message = error.getMessage();
                call.reject(message == null ? "The built-in YouTube extractor found no audio stream." : message);
            }
        });
    }

    /**
     * Fetch a resolved YouTube audio URL into app-private cache storage.
     * WebView fetch/audio requests can be blocked by provider CORS or missing
     * CDN headers; performing this final hop natively avoids both problems.
     * The page then plays/reads the same file through Capacitor.convertFileSrc.
     */
    @PluginMethod
    public void prepareYoutubeAudio(PluginCall call) {
        final String videoId = call.getString("videoId", "").trim();
        final String sourceUrl = call.getString("url", "").trim();
        final String requestedExtension = call.getString("ext", "m4a");
        if (!YOUTUBE_ID.matcher(videoId).matches()) {
            call.reject("Invalid YouTube video ID.");
            return;
        }
        if (!isHttpsUrlSyntax(sourceUrl)) {
            call.reject("The stream provider returned an invalid HTTPS URL.");
            return;
        }

        final Context appContext = getContext().getApplicationContext();
        String defaultUserAgent;
        try { defaultUserAgent = WebSettings.getDefaultUserAgent(getContext()); }
        catch (Exception ignored) { defaultUserAgent = ""; }
        String requestedUserAgent = call.getString("userAgent", "").trim();
        if (requestedUserAgent.length() > 512 || requestedUserAgent.indexOf('\r') >= 0
            || requestedUserAgent.indexOf('\n') >= 0) requestedUserAgent = "";
        final String userAgent = requestedUserAgent.isEmpty() ? defaultUserAgent : requestedUserAgent;
        youtubeAudioExecutor.execute(() -> {
            try {
                File audio = downloadYoutubeAudio(appContext, videoId, sourceUrl, requestedExtension, userAgent);
                JSObject result = new JSObject();
                result.put("path", audio.getAbsolutePath());
                result.put("ext", extensionFromName(audio.getName()));
                result.put("bytes", audio.length());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Unable to fetch the YouTube audio stream." : error.getMessage());
            }
        });
    }

    private static File downloadYoutubeAudio(Context context, String videoId, String sourceUrl, String requestedExtension, String userAgent)
        throws IOException {
        File cacheDir = new File(context.getCacheDir(), YOUTUBE_CACHE_DIR);
        if (!cacheDir.isDirectory() && !cacheDir.mkdirs()) {
            throw new IOException("Unable to create the YouTube audio cache.");
        }
        pruneYoutubeCache(cacheDir);
        File cached = findCachedYoutubeAudio(cacheDir, videoId);
        if (cached != null) return cached;

        HttpsURLConnection connection = openYoutubeAudioConnection(sourceUrl, userAgent);
        File temporary = new File(cacheDir, "yt-" + videoId + "-" + UUID.randomUUID() + ".part");
        try {
            String contentType = connection.getContentType();
            if (contentType != null) {
                String lowerType = contentType.toLowerCase(Locale.ROOT);
                if (lowerType.startsWith("text/") || lowerType.contains("json") || lowerType.contains("html")) {
                    throw new IOException("The stream provider returned a web page instead of audio.");
                }
            }

            long expectedBytes = connection.getContentLengthLong();
            if (expectedBytes > MAX_YOUTUBE_AUDIO_BYTES) {
                throw new IOException("The audio stream is larger than the Android cache limit.");
            }

            long totalBytes = 0L;
            byte[] buffer = new byte[32 * 1024];
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    totalBytes += read;
                    if (totalBytes > MAX_YOUTUBE_AUDIO_BYTES) {
                        throw new IOException("The audio stream is larger than the Android cache limit.");
                    }
                    output.write(buffer, 0, read);
                }
                output.flush();
                output.getFD().sync();
            }
            if (totalBytes < 16L) {
                throw new IOException("The stream provider returned an empty audio file.");
            }

            String extension = audioExtension(contentType, requestedExtension);
            File destination = new File(cacheDir, "yt-" + videoId + "." + extension);
            if (destination.exists() && !destination.delete()) {
                throw new IOException("Unable to replace the cached YouTube audio file.");
            }
            if (!temporary.renameTo(destination)) {
                throw new IOException("Unable to finalize the cached YouTube audio file.");
            }
            destination.setLastModified(System.currentTimeMillis());
            return destination;
        } finally {
            connection.disconnect();
            if (temporary.exists()) temporary.delete();
        }
    }

    private static HttpsURLConnection openYoutubeAudioConnection(String firstUrl, String userAgent) throws IOException {
        String currentUrl = firstUrl;
        if (userAgent == null || userAgent.trim().isEmpty()) {
            userAgent = "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";
        }

        for (int redirect = 0; redirect <= 5; redirect++) {
            if (!isSafeHttpsUrl(currentUrl)) {
                throw new IOException("The stream provider redirected to an unsafe URL.");
            }
            URL url = new URL(currentUrl);
            HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", userAgent);
            connection.setRequestProperty("Accept", "audio/*,application/octet-stream;q=0.9,*/*;q=0.8");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Referer", "https://www.youtube.com/");
            connection.setRequestProperty("Origin", "https://www.youtube.com");

            int status;
            try {
                status = connection.getResponseCode();
            } catch (IOException error) {
                connection.disconnect();
                throw new IOException("Could not connect to the YouTube audio provider.");
            }
            if (status >= 200 && status < 300) return connection;
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.trim().isEmpty()) {
                    throw new IOException("The stream provider returned an invalid redirect.");
                }
                currentUrl = new URL(url, location).toString();
                continue;
            }
            connection.disconnect();
            throw new IOException("The YouTube audio provider returned HTTP " + status + ".");
        }
        throw new IOException("The YouTube audio provider redirected too many times.");
    }

    private static boolean isHttpsUrlSyntax(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        try {
            URI uri = new URI(value.trim());
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isSafeHttpsUrl(String value) {
        if (!isHttpsUrlSyntax(value)) return false;
        try {
            URI uri = new URI(value.trim());
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            if (host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
            for (InetAddress address : InetAddress.getAllByName(host)) {
                if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void pruneYoutubeCache(File cacheDir) {
        File[] files = cacheDir.listFiles();
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File file : files) {
            String name = file.getName();
            if (!name.startsWith("yt-")) continue;
            if (name.endsWith(".part") || now - file.lastModified() >= YOUTUBE_CACHE_MAX_AGE_MS) file.delete();
        }
    }

    private static File findCachedYoutubeAudio(File cacheDir, String videoId) {
        File[] files = cacheDir.listFiles();
        if (files == null) return null;
        long now = System.currentTimeMillis();
        for (File file : files) {
            if (file.getName().startsWith("yt-" + videoId + ".") && file.isFile() && file.length() >= 16L
                && now - file.lastModified() < YOUTUBE_CACHE_MAX_AGE_MS) return file;
        }
        return null;
    }

    private static String audioExtension(String contentType, String fallback) {
        String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        if (type.contains("audio/mpeg") || type.contains("audio/mp3")) return "mp3";
        if (type.contains("audio/webm") || type.contains("video/webm")) return "webm";
        if (type.contains("audio/ogg") || type.contains("audio/opus")) return "ogg";
        if (type.contains("audio/aac")) return "aac";
        if (type.contains("audio/mp4") || type.contains("audio/x-m4a")) return "m4a";
        String normalized = fallback == null ? "" : fallback.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        if (normalized.equals("mp3") || normalized.equals("webm") || normalized.equals("ogg")
            || normalized.equals("opus") || normalized.equals("aac") || normalized.equals("m4a")) return normalized;
        return "m4a";
    }

    private static String extensionFromName(String name) {
        int dot = name.lastIndexOf('.');
        return dot >= 0 && dot < name.length() - 1 ? name.substring(dot + 1) : "m4a";
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
        youtubeAudioExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}

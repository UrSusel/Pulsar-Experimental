package pl.ursusel.pulsar.android;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * On-device YouTube InnerTube resolver used before public stream providers.
 *
 * This intentionally only accepts formats with a direct HTTPS URL. Encrypted
 * signature-cipher formats need the separately versioned YouTube player JS and
 * are skipped rather than returned as broken audio URLs. Client profiles are
 * kept together here because YouTube changes them independently of the UI.
 */
final class YoutubeInnertubeResolver {
    private static final String PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
    private static final String WATCH_URL = "https://www.youtube.com/watch?v=";
    private static final int MAX_HTML_BYTES = 5 * 1024 * 1024;
    private static final int MAX_PLAYER_BYTES = 3 * 1024 * 1024;
    private static final int MAX_STREAMS = 8;
    private static final int MAX_STREAMS_PER_PROFILE = 2;
    private static final long PROFILE_DEADLINE_SECONDS = 18L;
    private static final Pattern VIDEO_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");

    // These are public YouTube player-client identities, not account/API secrets.
    // VISIONOS is tried first because current yt-dlp marks it as not requiring
    // player JavaScript or a GVS proof-of-origin token. Other profiles are
    // retained as format fallbacks and may be rejected by YouTube over time.
    private static final List<ClientProfile> CLIENTS = Collections.unmodifiableList(Arrays.asList(
        new ClientProfile(
            "VISIONOS", "1.02", "101",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
            "Apple", "RealityDevice17,1", "", "visionOS", "26.5.23O471"
        ),
        new ClientProfile(
            "IOS", "21.26.4", "5",
            "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
            "Apple", "iPhone16,2", "", "iPhone", "18.3.2.22D82"
        ),
        new ClientProfile(
            "ANDROID", "21.26.364", "3",
            "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip",
            "", "", "30", "Android", "11"
        ),
        new ClientProfile(
            "WEB_EMBEDDED_PLAYER", "2.20260708.00.00", "56",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)",
            "", "", "", "", ""
        )
    ));

    private static final ExecutorService PROFILE_EXECUTOR = Executors.newFixedThreadPool(
        CLIENTS.size(), runnable -> {
            Thread thread = new Thread(runnable, "Pulsar-YouTube-InnerTube");
            thread.setDaemon(true);
            return thread;
        }
    );

    private YoutubeInnertubeResolver() {}

    static List<Stream> resolve(String videoId, String webViewUserAgent) throws IOException {
        if (videoId == null || !VIDEO_ID.matcher(videoId.trim()).matches()) {
            throw new IOException("The built-in YouTube extractor received an invalid video ID.");
        }
        String id = videoId.trim();
        String requestUserAgent = usableUserAgent(webViewUserAgent);
        Bootstrap bootstrap = Bootstrap.empty();
        try {
            bootstrap = fetchBootstrap(id, requestUserAgent);
        } catch (Exception ignored) {
            // The player endpoint is still attempted without webpage-derived
            // API key/visitor data; the web page can be blocked independently.
        }

        List<ProfileResult> results = fetchProfiles(id, bootstrap);
        List<Stream> preferred = new ArrayList<>();
        List<Stream> alternatives = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        for (ClientProfile profile : CLIENTS) {
            ProfileResult result = findResult(results, profile.clientName);
            if (result == null) {
                failures.add(profile.clientName + ": no response");
                continue;
            }
            if (!result.error.isEmpty()) {
                failures.add(profile.clientName + ": " + result.error);
                continue;
            }
            if (result.streams.isEmpty()) {
                failures.add(profile.clientName + ": " + result.status);
                continue;
            }

            int accepted = 0;
            for (Stream stream : result.streams) {
                String key = stream.clientName + "|" + stream.itag + "|" + stream.url;
                if (!seen.add(key)) continue;
                if (accepted == 0) preferred.add(stream);
                else alternatives.add(stream);
                accepted++;
                if (accepted >= MAX_STREAMS_PER_PROFILE) break;
            }
        }

        preferred.addAll(alternatives);
        if (preferred.size() > MAX_STREAMS) {
            preferred = new ArrayList<>(preferred.subList(0, MAX_STREAMS));
        }
        if (preferred.isEmpty()) {
            StringBuilder message = new StringBuilder(
                "YouTube's built-in extractor found no direct audio stream. Tried "
            );
            for (int i = 0; i < failures.size(); i++) {
                if (i > 0) message.append("; ");
                message.append(failures.get(i));
            }
            throw new IOException(message.toString());
        }
        return preferred;
    }

    private static List<ProfileResult> fetchProfiles(String videoId, Bootstrap bootstrap) {
        CompletionService<ProfileResult> completed = new ExecutorCompletionService<>(PROFILE_EXECUTOR);
        List<Future<ProfileResult>> tasks = new ArrayList<>();
        for (ClientProfile profile : CLIENTS) {
            tasks.add(completed.submit(() -> fetchPlayer(videoId, profile, bootstrap)));
        }

        ProfileResult[] results = new ProfileResult[CLIENTS.size()];
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(PROFILE_DEADLINE_SECONDS);
        for (int received = 0; received < CLIENTS.size(); received++) {
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0L) break;
            try {
                Future<ProfileResult> task = completed.poll(remaining, TimeUnit.NANOSECONDS);
                if (task == null) break;
                ProfileResult result = task.get();
                results[result.profileIndex] = result;
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception ignored) {
                // Individual client failures do not suppress other profiles.
            }
        }
        for (Future<ProfileResult> task : tasks) {
            if (!task.isDone()) task.cancel(true);
        }

        List<ProfileResult> ordered = new ArrayList<>();
        for (int i = 0; i < results.length; i++) {
            if (results[i] != null) ordered.add(results[i]);
        }
        return ordered;
    }

    private static ProfileResult fetchPlayer(String videoId, ClientProfile profile, Bootstrap bootstrap) {
        HttpsURLConnection connection = null;
        try {
            JSONObject client = new JSONObject();
            client.put("clientName", profile.clientName);
            client.put("clientVersion", profile.clientVersion);
            client.put("hl", currentLanguage());
            client.put("gl", currentCountry());
            putIfPresent(client, "deviceMake", profile.deviceMake);
            putIfPresent(client, "deviceModel", profile.deviceModel);
            if (!profile.androidSdkVersion.isEmpty()) {
                client.put("androidSdkVersion", Integer.parseInt(profile.androidSdkVersion));
            }
            putIfPresent(client, "osName", profile.osName);
            putIfPresent(client, "osVersion", profile.osVersion);
            putIfPresent(client, "visitorData", bootstrap.visitorData);

            JSONObject context = new JSONObject().put("client", client);
            JSONObject request = new JSONObject()
                .put("videoId", videoId)
                .put("context", context)
                .put("contentCheckOk", true)
                .put("racyCheckOk", true);

            URL url = new URL(playerEndpoint(bootstrap.apiKey));
            connection = (HttpsURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setRequestProperty("User-Agent", profile.userAgent);
            connection.setRequestProperty("Accept", "application/json, */*;q=0.8");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Accept-Language", currentLanguage() + ",en;q=0.8");
            connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            connection.setRequestProperty("Origin", "https://www.youtube.com");
            connection.setRequestProperty("Referer", "https://www.youtube.com/");
            connection.setRequestProperty("X-YouTube-Client-Name", profile.clientId);
            connection.setRequestProperty("X-YouTube-Client-Version", profile.clientVersion);
            connection.setRequestProperty("X-Goog-Api-Format-Version", "2");
            if (!bootstrap.visitorData.isEmpty()) {
                connection.setRequestProperty("X-Goog-Visitor-Id", bootstrap.visitorData);
            }
            if (!bootstrap.consentCookie.isEmpty()) {
                connection.setRequestProperty("Cookie", bootstrap.consentCookie);
            }

            byte[] payload = request.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(payload);
            }

            int statusCode = connection.getResponseCode();
            InputStream body = statusCode >= 200 && statusCode < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
            if (body == null) {
                return ProfileResult.failure(profile, "HTTP " + statusCode);
            }

            String responseText;
            try (InputStream input = body) {
                responseText = readLimited(input, MAX_PLAYER_BYTES);
            }
            if (statusCode < 200 || statusCode >= 300) {
                return ProfileResult.failure(profile, "HTTP " + statusCode);
            }

            JSONObject response = new JSONObject(responseText);
            String playability = playabilityStatus(response);
            List<Stream> streams = parseStreams(response, profile);
            return ProfileResult.success(profile, streams, playability);
        } catch (JSONException error) {
            return ProfileResult.failure(profile, "invalid player response");
        } catch (Exception error) {
            return ProfileResult.failure(profile, "network request failed");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static List<Stream> parseStreams(JSONObject response, ClientProfile profile) {
        JSONObject streamingData = response.optJSONObject("streamingData");
        if (streamingData == null) return Collections.emptyList();

        List<Format> formats = new ArrayList<>();
        appendFormats(formats, streamingData.optJSONArray("adaptiveFormats"));
        appendFormats(formats, streamingData.optJSONArray("formats"));
        Collections.sort(formats, FORMAT_ORDER);

        List<Stream> streams = new ArrayList<>();
        Set<String> seenItags = new HashSet<>();
        for (Format format : formats) {
            if (!seenItags.add(format.itag)) continue;
            streams.add(new Stream(
                format.url,
                format.extension,
                format.mimeType,
                profile.clientName,
                profile.clientVersion,
                profile.clientId,
                profile.userAgent,
                format.itag,
                format.bitrate,
                format.audioOnly
            ));
        }
        return streams;
    }

    private static void appendFormats(List<Format> output, JSONArray formats) {
        if (formats == null) return;
        for (int i = 0; i < formats.length(); i++) {
            JSONObject item = formats.optJSONObject(i);
            if (item == null) continue;

            String mimeType = item.optString("mimeType", "").trim();
            if (mimeType.isEmpty()) continue;
            boolean audioOnly = mimeType.toLowerCase(Locale.ROOT).startsWith("audio/");
            if (!audioOnly && !hasAudioCodec(mimeType)) continue;

            String streamUrl = directUrl(item);
            if (!isHttpsUrl(streamUrl)) continue;

            String extension = extensionFor(mimeType);
            String itag = item.optString("itag", Integer.toString(i));
            long bitrate = Math.max(0L, item.optLong("averageBitrate", item.optLong("bitrate", 0L)));
            output.add(new Format(streamUrl, extension, mimeType, itag, bitrate, audioOnly));
        }
    }

    private static String directUrl(JSONObject format) {
        String direct = format.optString("url", "").trim();
        if (isHttpsUrl(direct)) return direct;

        String cipher = format.optString("signatureCipher", "");
        if (cipher.isEmpty()) cipher = format.optString("cipher", "");
        if (cipher.isEmpty()) return "";

        Map<String, String> values = decodeQuery(cipher);
        String url = values.getOrDefault("url", "");
        if (!isHttpsUrl(url)) return "";

        String signature = values.getOrDefault("sig", values.getOrDefault("signature", ""));
        if (!signature.isEmpty()) {
            String parameter = values.getOrDefault("sp", "signature");
            try {
                return appendQueryParameter(url, parameter, signature);
            } catch (Exception ignored) {
                return "";
            }
        }

        // The encrypted `s` value cannot be safely used without the matching
        // player-JS decipher function. Do not return a URL that will just 403.
        if (!values.getOrDefault("s", "").isEmpty()) return "";
        return url;
    }

    private static Map<String, String> decodeQuery(String encoded) {
        Map<String, String> values = new HashMap<>();
        for (String pair : encoded.split("&")) {
            if (pair.isEmpty()) continue;
            int separator = pair.indexOf('=');
            String key = separator >= 0 ? pair.substring(0, separator) : pair;
            String value = separator >= 0 ? pair.substring(separator + 1) : "";
            try {
                key = URLDecoder.decode(key, StandardCharsets.UTF_8.name());
                value = URLDecoder.decode(value, StandardCharsets.UTF_8.name());
                values.put(key, value);
            } catch (Exception ignored) {
                // Ignore malformed cipher parameters; another client may work.
            }
        }
        return values;
    }

    private static String appendQueryParameter(String url, String name, String value) throws Exception {
        String separator = url.contains("?") ? "&" : "?";
        return url + separator + URLEncoder.encode(name, StandardCharsets.UTF_8.name())
            + "=" + URLEncoder.encode(value, StandardCharsets.UTF_8.name());
    }

    private static boolean hasAudioCodec(String mimeType) {
        String lower = mimeType.toLowerCase(Locale.ROOT);
        int codecStart = lower.indexOf("codecs=");
        if (codecStart < 0) return false;
        String codecs = lower.substring(codecStart);
        return codecs.contains("mp4a") || codecs.contains("opus") || codecs.contains("vorbis")
            || codecs.contains("aac") || codecs.contains("ac-3") || codecs.contains("ec-3");
    }

    private static String extensionFor(String mimeType) {
        String lower = mimeType.toLowerCase(Locale.ROOT);
        if (lower.startsWith("audio/webm") || lower.startsWith("video/webm")) return "webm";
        if (lower.startsWith("audio/ogg") || lower.startsWith("audio/opus")) return "ogg";
        if (lower.startsWith("audio/mpeg")) return "mp3";
        if (lower.startsWith("audio/aac")) return "aac";
        // MP4 audio is conventionally named M4A, including muxed fallback files.
        if (lower.startsWith("audio/mp4") || lower.startsWith("video/mp4")) return "m4a";
        return "m4a";
    }

    private static final Comparator<Format> FORMAT_ORDER = (left, right) -> {
        if (left.audioOnly != right.audioOnly) return left.audioOnly ? -1 : 1;
        int leftContainer = containerRank(left.extension);
        int rightContainer = containerRank(right.extension);
        if (leftContainer != rightContainer) return Integer.compare(leftContainer, rightContainer);
        return Long.compare(right.bitrate, left.bitrate);
    };

    private static int containerRank(String extension) {
        if ("m4a".equals(extension)) return 0;
        if ("mp3".equals(extension)) return 1;
        if ("webm".equals(extension)) return 2;
        if ("ogg".equals(extension)) return 3;
        return 4;
    }

    private static Bootstrap fetchBootstrap(String videoId, String userAgent) throws IOException {
        HttpsURLConnection connection = null;
        try {
            URL url = new URL(WATCH_URL + videoId + "&hl=" + currentLanguage() + "&gl=" + currentCountry());
            connection = (HttpsURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("User-Agent", userAgent);
            connection.setRequestProperty("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Accept-Language", currentLanguage() + ",en;q=0.8");
            connection.setRequestProperty("Referer", "https://www.youtube.com/");

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("watch page unavailable");
            String html;
            try (InputStream input = connection.getInputStream()) {
                html = readUpTo(input, MAX_HTML_BYTES);
            }
            String apiKey = extractConfigValue(html, "INNERTUBE_API_KEY");
            String visitorData = extractConfigValue(html, "VISITOR_DATA");
            String consentCookie = consentCookie(connection);
            return new Bootstrap(apiKey, visitorData, consentCookie);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String consentCookie(HttpsURLConnection connection) {
        List<String> headers = connection.getHeaderFields().get("Set-Cookie");
        if (headers == null) return "";
        List<String> selected = new ArrayList<>();
        for (String header : headers) {
            if (header == null) continue;
            String pair = header.split(";", 2)[0].trim();
            if (pair.startsWith("CONSENT=") || pair.startsWith("SOCS=")) selected.add(pair);
        }
        StringBuilder cookie = new StringBuilder();
        for (String pair : selected) {
            if (cookie.length() > 0) cookie.append("; ");
            cookie.append(pair);
        }
        return cookie.toString();
    }

    private static String extractConfigValue(String html, String key) {
        String expression = "[\"']" + Pattern.quote(key)
            + "[\"']\\s*:\\s*[\"']([^\"']{1,512})[\"']";
        Matcher matcher = Pattern.compile(expression).matcher(html);
        return matcher.find() ? matcher.group(1) : "";
    }

    private static String playerEndpoint(String apiKey) throws IOException {
        String endpoint = PLAYER_URL + "?prettyPrint=false";
        if (apiKey == null || apiKey.isEmpty()) return endpoint;
        try {
            return endpoint + "&key=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8.name());
        } catch (Exception error) {
            throw new IOException("Could not prepare the YouTube player request.");
        }
    }

    private static String playabilityStatus(JSONObject response) {
        JSONObject status = response.optJSONObject("playabilityStatus");
        if (status == null) return "no streaming data";
        String value = status.optString("status", "unknown").trim();
        if (value.isEmpty()) return "no streaming data";
        return value.replaceAll("[^A-Za-z0-9_-]", "");
    }

    private static ProfileResult findResult(List<ProfileResult> results, String clientName) {
        for (ProfileResult result : results) {
            if (result.clientName.equals(clientName)) return result;
        }
        return null;
    }

    private static String readUpTo(InputStream input, int maximumBytes) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int total = 0;
        int count;
        while (total < maximumBytes && (count = input.read(buffer, 0, Math.min(buffer.length, maximumBytes - total))) != -1) {
            output.write(buffer, 0, count);
            total += count;
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static String readLimited(InputStream input, int maximumBytes) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > maximumBytes) throw new IOException("YouTube response exceeded the size limit.");
            output.write(buffer, 0, count);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static boolean isHttpsUrl(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        try {
            URI uri = new URI(value.trim());
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                && uri.getUserInfo() == null;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void putIfPresent(JSONObject object, String key, String value) throws JSONException {
        if (value != null && !value.isEmpty()) object.put(key, value);
    }

    private static String currentLanguage() {
        String language = Locale.getDefault().getLanguage();
        return language == null || language.isEmpty() ? "en" : language;
    }

    private static String currentCountry() {
        String country = Locale.getDefault().getCountry();
        return country == null || country.isEmpty() ? "US" : country;
    }

    private static String usableUserAgent(String userAgent) {
        if (userAgent != null) {
            String candidate = userAgent.trim();
            if (!candidate.isEmpty() && candidate.length() <= 512
                && candidate.indexOf('\r') < 0 && candidate.indexOf('\n') < 0) return candidate;
        }
        return "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";
    }

    static final class Stream {
        final String url;
        final String extension;
        final String mimeType;
        final String clientName;
        final String clientVersion;
        final String clientId;
        final String userAgent;
        final String itag;
        final long bitrate;
        final boolean audioOnly;

        Stream(String url, String extension, String mimeType, String clientName, String clientVersion,
               String clientId, String userAgent, String itag, long bitrate, boolean audioOnly) {
            this.url = url;
            this.extension = extension;
            this.mimeType = mimeType;
            this.clientName = clientName;
            this.clientVersion = clientVersion;
            this.clientId = clientId;
            this.userAgent = userAgent;
            this.itag = itag;
            this.bitrate = bitrate;
            this.audioOnly = audioOnly;
        }
    }

    private static final class ClientProfile {
        final String clientName;
        final String clientVersion;
        final String clientId;
        final String userAgent;
        final String deviceMake;
        final String deviceModel;
        final String androidSdkVersion;
        final String osName;
        final String osVersion;

        ClientProfile(String clientName, String clientVersion, String clientId, String userAgent,
                      String deviceMake, String deviceModel, String androidSdkVersion, String osName,
                      String osVersion) {
            this.clientName = clientName;
            this.clientVersion = clientVersion;
            this.clientId = clientId;
            this.userAgent = userAgent;
            this.deviceMake = deviceMake;
            this.deviceModel = deviceModel;
            this.androidSdkVersion = androidSdkVersion;
            this.osName = osName;
            this.osVersion = osVersion;
        }
    }

    private static final class ProfileResult {
        final int profileIndex;
        final String clientName;
        final String error;
        final String status;
        final List<Stream> streams;

        private ProfileResult(int profileIndex, String clientName, String error, String status,
                              List<Stream> streams) {
            this.profileIndex = profileIndex;
            this.clientName = clientName;
            this.error = error;
            this.status = status;
            this.streams = streams;
        }

        static ProfileResult success(ClientProfile profile, List<Stream> streams, String status) {
            return new ProfileResult(CLIENTS.indexOf(profile), profile.clientName, "", status, streams);
        }

        static ProfileResult failure(ClientProfile profile, String error) {
            return new ProfileResult(CLIENTS.indexOf(profile), profile.clientName, error, "", Collections.emptyList());
        }
    }

    private static final class Format {
        final String url;
        final String extension;
        final String mimeType;
        final String itag;
        final long bitrate;
        final boolean audioOnly;

        Format(String url, String extension, String mimeType, String itag, long bitrate,
               boolean audioOnly) {
            this.url = url;
            this.extension = extension;
            this.mimeType = mimeType;
            this.itag = itag;
            this.bitrate = bitrate;
            this.audioOnly = audioOnly;
        }
    }

    private static final class Bootstrap {
        final String apiKey;
        final String visitorData;
        final String consentCookie;

        Bootstrap(String apiKey, String visitorData, String consentCookie) {
            this.apiKey = apiKey == null ? "" : apiKey;
            this.visitorData = visitorData == null ? "" : visitorData;
            this.consentCookie = consentCookie == null ? "" : consentCookie;
        }

        static Bootstrap empty() {
            return new Bootstrap("", "", "");
        }
    }
}

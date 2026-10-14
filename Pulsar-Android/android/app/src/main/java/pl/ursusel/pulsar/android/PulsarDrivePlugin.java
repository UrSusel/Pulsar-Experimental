package pl.ursusel.pulsar.android;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Google Drive transport for the library sync.
 *
 * The plugin owns the OAuth flow and the Drive REST calls; all library logic
 * (what to send, how to merge) lives in drive-sync.js. Nothing audio related
 * ever travels through here: only the metadata manifest.
 *
 * Auth is the "installed app" flow with PKCE: the consent page opens in the
 * system browser (Google refuses OAuth inside an embedded WebView) and the
 * redirect comes back to MainActivity through the scheme registered in the
 * manifest. A refresh token is kept in private shared preferences so sync can
 * run later without asking the user again.
 */
@CapacitorPlugin(name = "PulsarDrive")
public class PulsarDrivePlugin extends Plugin {

    public static final String DEFAULT_REDIRECT_URI = "pl.ursusel.pulsar.android:/oauth2redirect";
    private static final String DEFAULT_CLIENT_ID = "";
    private static final String DEFAULT_CLIENT_SECRET = "";

    private static final String PREFS = "pulsar_drive";
    private static final String MANIFEST_NAME = "pulsar-library.json";
    private static final String MIRROR_NAME = "pulsar-library.json";
    private static final String MIRROR_FOLDER = "Pulsar";

    private static final String AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
    private static final String USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
    private static final String DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
    private static final String DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

    private static final String SCOPE = "https://www.googleapis.com/auth/drive.appdata "
        + "https://www.googleapis.com/auth/drive.file";

    private static final int TIMEOUT_MS = 30000;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    /** Values of an in-flight authorization request (kept across the browser round trip). */
    private static String pendingState = null;
    private static String pendingVerifier = null;
    private static PulsarDrivePlugin pendingOwner = null;
    /** Wywołanie JS czekające na powrót z przeglądarki (logowanie trwa dłużej niż samo wywołanie). */
    private static PluginCall pendingCall = null;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String setting(SharedPreferences prefs, String key, String fallback) {
        String value = prefs.getString(key, null);
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private String clientId() {
        return setting(prefs(), "clientId", DEFAULT_CLIENT_ID);
    }

    private String clientSecret() {
        return setting(prefs(), "clientSecret", DEFAULT_CLIENT_SECRET);
    }

    private String redirectUri() {
        return setting(prefs(), "redirectUri", DEFAULT_REDIRECT_URI);
    }

    // ---------------------------------------------------------------- config

    @PluginMethod
    public void configure(PluginCall call) {
        SharedPreferences.Editor editor = prefs().edit();
        String clientId = call.getString("clientId");
        String clientSecret = call.getString("clientSecret");
        String redirectUri = call.getString("redirectUri");
        if (clientId != null) editor.putString("clientId", clientId.trim());
        if (clientSecret != null) editor.putString("clientSecret", clientSecret.trim());
        if (redirectUri != null && !redirectUri.trim().isEmpty()) editor.putString("redirectUri", redirectUri.trim());
        editor.apply();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    private JSObject statusObject() {
        SharedPreferences prefs = prefs();
        JSObject result = new JSObject();
        result.put("configured", !clientId().isEmpty() && !clientSecret().isEmpty());
        result.put("signedIn", !setting(prefs, "refreshToken", "").isEmpty());
        result.put("email", setting(prefs, "email", ""));
        result.put("lastSyncAt", prefs.getLong("lastSyncAt", 0));
        result.put("lastError", setting(prefs, "lastError", ""));
        result.put("hasPendingAuth", pendingOwner == this && pendingState != null);
        result.put("canSync", !clientId().isEmpty() && !setting(prefs, "refreshToken", "").isEmpty());
        result.put("mirror", prefs.getBoolean("mirror", true));
        return result;
    }

    @PluginMethod
    public void setMirror(PluginCall call) {
        boolean mirror = Boolean.TRUE.equals(call.getBoolean("enabled", Boolean.TRUE));
        prefs().edit().putBoolean("mirror", mirror).apply();
        call.resolve(statusObject());
    }

    // ------------------------------------------------------------------ auth

    @PluginMethod
    public void signIn(PluginCall call) {
        if (clientId().isEmpty() || clientSecret().isEmpty()) {
            call.reject("Najpierw wklej Client ID i Client secret z Google Cloud (zakładka Chmura → konfiguracja).");
            return;
        }
        pendingCall = call;
        try {
            pendingState = randomUrlSafe(24);
            pendingVerifier = randomUrlSafe(64);
            pendingOwner = this;
            String url = AUTH_ENDPOINT + "?client_id=" + enc(clientId()) + "&redirect_uri=" + enc(redirectUri())
                + "&response_type=code&scope=" + enc(SCOPE) + "&access_type=offline&prompt=consent"
                + "&code_challenge=" + enc(challenge(pendingVerifier)) + "&code_challenge_method=S256"
                + "&state=" + enc(pendingState);
            final Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            view.addCategory(Intent.CATEGORY_BROWSABLE);
            final android.app.Activity activity = getActivity();
            if (activity == null) {
                failPending("Aplikacja nie jest gotowa — spróbuj ponownie.");
                return;
            }
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivity(view);
                } catch (Exception error) {
                    failPending("Nie można otworzyć przeglądarki: " + error.getMessage());
                }
            });
        } catch (Exception error) {
            failPending("Nie udało się rozpocząć logowania: " + error.getMessage());
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        SharedPreferences.Editor editor = prefs().edit();
        editor.remove("refreshToken");
        editor.remove("accessToken");
        editor.remove("accessTokenExpiresAt");
        editor.remove("email");
        editor.remove("mirrorFolderId");
        editor.apply();
        call.resolve(statusObject());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || intent.getData() == null) return;
        Uri data = intent.getData();
        String redirect = redirectUri();
        String wantedScheme = schemeOf(redirect);
        if (wantedScheme == null || !wantedScheme.equalsIgnoreCase(data.getScheme())) return;

        String state = data.getQueryParameter("state");
        String code = data.getQueryParameter("code");
        String error = data.getQueryParameter("error");
        if (pendingOwner != this || pendingState == null) return;
        if (error != null) {
            failPending("Logowanie odrzucone: " + error);
            return;
        }
        if (state == null || !state.equals(pendingState)) {
            failPending("Odpowiedź logowania nie pasuje do tego żądania (state).");
            return;
        }
        if (code == null || code.isEmpty()) {
            failPending("Brak kodu autoryzacji w odpowiedzi Google.");
            return;
        }
        final String verifier = pendingVerifier;
        pendingState = null;
        pendingVerifier = null;
        pendingOwner = null;
        executor.execute(() -> {
            try {
                JSONObject token = postForm(
                    TOKEN_ENDPOINT,
                    "code=" + enc(code) + "&client_id=" + enc(clientId()) + "&client_secret=" + enc(clientSecret())
                        + "&redirect_uri=" + enc(redirectUri()) + "&grant_type=authorization_code"
                        + "&code_verifier=" + enc(verifier == null ? "" : verifier)
                );
                storeToken(token);
                JSObject result = statusObject();
                resolvePending(result);
                notifyListeners("driveAuth", result, true);
            } catch (Exception failure) {
                failPending("Nie udało się wymienić kodu na token: " + failure.getMessage());
            }
        });
    }

    private void resolvePending(JSObject result) {
        PluginCall waiting = pendingCall;
        pendingCall = null;
        if (waiting != null) waiting.resolve(result);
    }

    private String schemeOf(String redirect) {
        int index = redirect.indexOf(':');
        return index <= 0 ? null : redirect.substring(0, index);
    }

    private void failPending(String message) {
        pendingState = null;
        pendingVerifier = null;
        pendingOwner = null;
        prefs().edit().putString("lastError", message).apply();
        PluginCall waiting = pendingCall;
        pendingCall = null;
        if (waiting != null) waiting.reject(message);
        JSObject payload = new JSObject();
        payload.put("error", message);
        notifyListeners("driveAuth", payload, true);
    }

    // ----------------------------------------------------------------- drive

    @PluginMethod
    public void pull(final PluginCall call) {
        executor.execute(() -> {
            try {
                String token = accessToken();
                JSONObject found = findFile(token, "appDataFolder");
                if (found == null) {
                    JSObject empty = new JSObject();
                    empty.put("manifest", null);
                    call.resolve(empty);
                    return;
                }
                String id = found.getString("id");
                HttpURLConnection connection = open(DRIVE_FILES + "/" + id + "?alt=media", "GET", token);
                String body = read(connection);
                JSObject result = new JSObject();
                result.put("manifest", body);
                result.put("modifiedTime", found.optString("modifiedTime", ""));
                result.put("version", found.optString("version", ""));
                result.put("fileId", id);
                call.resolve(result);
            } catch (Exception error) {
                record(error);
                call.reject(describe(error));
            }
        });
    }

    @PluginMethod
    public void push(final PluginCall call) {
        final String manifest = call.getString("manifest");
        if (manifest == null) {
            call.reject("Brak manifestu do wysłania.");
            return;
        }
        final boolean wantMirror = Boolean.TRUE.equals(call.getBoolean("mirror", Boolean.TRUE));
        executor.execute(() -> {
            try {
                String token = accessToken();
                JSONObject existing = findFile(token, "appDataFolder");
                JSONObject stored = existing == null
                    ? uploadJson(token, manifest, "appDataFolder", null, MANIFEST_NAME)
                    : uploadJson(token, manifest, "appDataFolder", existing.getString("id"), MANIFEST_NAME);

                JSObject result = new JSObject();
                result.put("modifiedTime", stored.optString("modifiedTime", ""));
                result.put("version", stored.optString("version", ""));
                result.put("fileId", stored.optString("id", ""));
                result.put("mirrored", false);
                if (wantMirror) {
                    String folderId = mirrorFolderId(token);
                    JSONObject mirror = findMirror(token);
                    JSONObject mirrored = mirror == null
                        ? uploadJson(token, manifest, folderId, null, MIRROR_NAME)
                        : uploadJson(token, manifest, folderId, mirror.getString("id"), MIRROR_NAME);
                    result.put("mirrored", true);
                    result.put("mirrorFileId", mirrored.optString("id", ""));
                }
                prefs().edit().putLong("lastSyncAt", System.currentTimeMillis()).putString("lastError", "").apply();
                result.put("lastSyncAt", prefs().getLong("lastSyncAt", 0));
                call.resolve(result);
            } catch (Exception error) {
                record(error);
                call.reject(describe(error));
            }
        });
    }

    private void storeToken(JSONObject token) throws Exception {
        String access = token.optString("access_token", "");
        String refresh = token.optString("refresh_token", "");
        long expiresIn = token.optLong("expires_in", 3600L);
        String scope = token.optString("scope", "");
        SharedPreferences.Editor editor = prefs().edit();
        editor.putString("accessToken", access);
        editor.putLong("accessTokenExpiresAt", System.currentTimeMillis() + Math.max(0L, expiresIn - 60L) * 1000L);
        if (!refresh.isEmpty()) editor.putString("refreshToken", refresh);
        editor.putString("lastError", "");
        editor.apply();
        // Missing scopes mean the user unticked something in the consent screen.
        if (!scope.contains("drive.appdata") || !scope.contains("drive.file")) {
            throw new Exception("Brak wymaganych uprawnień Drive (drive.appdata / drive.file).");
        }
        try {
            HttpURLConnection connection = open(USERINFO_ENDPOINT, "GET", access);
            String body = read(connection);
            String email = new JSONObject(body).optString("email", "");
            if (!email.isEmpty()) prefs().edit().putString("email", email).apply();
        } catch (Exception ignored) {
            // The address is cosmetic; not worth failing the sign-in.
        }
    }

    private String accessToken() throws Exception {
        SharedPreferences prefs = prefs();
        String access = setting(prefs, "accessToken", "");
        long expiry = prefs.getLong("accessTokenExpiresAt", 0L);
        if (!access.isEmpty() && expiry > System.currentTimeMillis() + 60000L) return access;

        String refresh = setting(prefs, "refreshToken", "");
        if (refresh.isEmpty()) throw new Exception("Najpierw zaloguj się kontem Google.");
        JSONObject token = postForm(
            TOKEN_ENDPOINT,
            "client_id=" + enc(clientId()) + "&client_secret=" + enc(clientSecret())
                + "&refresh_token=" + enc(refresh) + "&grant_type=refresh_token"
        );
        storeToken(token);
        String fresh = token.optString("access_token", "");
        if (fresh.isEmpty()) throw new Exception("Google nie zwróciło nowego tokenu.");
        return fresh;
    }

    /** Hidden manifest inside the application data folder (scope drive.appdata). */
    private JSONObject findFile(String token, String space) throws Exception {
        String query = "name='" + MANIFEST_NAME + "' and trashed=false";
        String url = DRIVE_FILES + "?spaces=" + space + "&q=" + enc(query)
            + "&fields=" + enc("files(id,name,modifiedTime,version)") + "&pageSize=1";
        HttpURLConnection connection = open(url, "GET", token);
        JSONObject response = new JSONObject(read(connection));
        JSONArray files = response.optJSONArray("files");
        if (files == null || files.length() == 0) return null;
        return files.getJSONObject(0);
    }

    private JSONObject findMirror(String token) throws Exception {
        String query = "name='" + MIRROR_NAME + "' and trashed=false and mimeType='application/json'";
        String url = DRIVE_FILES + "?q=" + enc(query) + "&fields=" + enc("files(id,name,modifiedTime,version)") + "&pageSize=1";
        HttpURLConnection connection = open(url, "GET", token);
        JSONObject response = new JSONObject(read(connection));
        JSONArray files = response.optJSONArray("files");
        if (files == null || files.length() == 0) return null;
        return files.getJSONObject(0);
    }

    private String mirrorFolderId(String token) throws Exception {
        String cached = setting(prefs(), "mirrorFolderId", "");
        if (!cached.isEmpty()) return cached;
        String query = "mimeType='application/vnd.google-apps.folder' and name='" + MIRROR_FOLDER
            + "' and trashed=false and 'root' in parents";
        String url = DRIVE_FILES + "?q=" + enc(query) + "&fields=" + enc("files(id,name)") + "&pageSize=1";
        HttpURLConnection connection = open(url, "GET", token);
        JSONObject response = new JSONObject(read(connection));
        JSONArray files = response.optJSONArray("files");
        String folderId = (files != null && files.length() > 0) ? files.getJSONObject(0).getString("id") : null;
        if (folderId == null) {
            JSONObject metadata = new JSONObject();
            metadata.put("name", MIRROR_FOLDER);
            metadata.put("mimeType", "application/vnd.google-apps.folder");
            metadata.put("parents", new JSONArray().put("root"));
            folderId = uploadMetadata(token, metadata.toString()).getString("id");
        }
        prefs().edit().putString("mirrorFolderId", folderId).apply();
        return folderId;
    }

    // ------------------------------------------------------------- http bits

    private JSONObject uploadJson(String token, String manifest, String parent, String fileId, String name) throws Exception {
        JSONObject metadata = new JSONObject();
        metadata.put("name", name);
        metadata.put("mimeType", "application/json");
        if (fileId == null) {
            metadata.put("parents", new JSONArray().put(parent));
        }
        String boundary = "pulsar" + System.currentTimeMillis();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        write(body, "--" + boundary + "\r\n");
        write(body, "Content-Type: application/json; charset=UTF-8\r\n\r\n");
        write(body, metadata.toString());
        write(body, "\r\n--" + boundary + "\r\n");
        write(body, "Content-Type: application/json; charset=UTF-8\r\n\r\n");
        write(body, manifest);
        write(body, "\r\n--" + boundary + "--");

        String url = fileId == null
            ? DRIVE_UPLOAD + "?uploadType=multipart&fields=" + enc("id,modifiedTime,version")
            : DRIVE_UPLOAD + "/" + fileId + "?uploadType=multipart&fields=" + enc("id,modifiedTime,version");
        HttpURLConnection connection = open(url, fileId == null ? "POST" : "PATCH", token);
        connection.setRequestProperty("Content-Type", "multipart/related; boundary=" + boundary);
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(body.size());
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body.toByteArray());
        }
        return new JSONObject(read(connection));
    }

    private JSONObject uploadMetadata(String token, String metadataJson) throws Exception {
        HttpURLConnection connection = open(DRIVE_FILES + "?fields=" + enc("id"), "POST", token);
        connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        connection.setDoOutput(true);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(metadataJson.getBytes(StandardCharsets.UTF_8));
        }
        return new JSONObject(read(connection));
    }

    private void write(ByteArrayOutputStream target, String text) throws Exception {
        target.write(text.getBytes(StandardCharsets.UTF_8));
    }

    private HttpURLConnection open(String url, String method, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        return connection;
    }

    private String read(HttpURLConnection connection) throws Exception {
        int code = connection.getResponseCode();
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String body = stream == null ? "" : slurp(stream);
        if (code >= 400) {
            String hint = body;
            try {
                JSONObject error = new JSONObject(body);
                JSONObject details = error.optJSONObject("error");
                if (details != null && details.optString("message", "").length() > 0) {
                    hint = details.optString("message");
                }
            } catch (Exception ignored) {}
            throw new Exception("HTTP " + code + ": " + trim(hint));
        }
        return body;
    }

    private String slurp(InputStream stream) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) builder.append(line).append('\n');
        }
        return builder.toString();
    }

    private JSONObject postForm(String url, String form) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        connection.setDoOutput(true);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(form.getBytes(StandardCharsets.UTF_8));
        }
        return new JSONObject(read(connection));
    }

    // ---------------------------------------------------------------- crypto

    private String randomUrlSafe(int bytes) {
        byte[] raw = new byte[bytes];
        new SecureRandom().nextBytes(raw);
        return Base64.encodeToString(raw, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private String challenge(String verifier) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hashed = digest.digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.encodeToString(hashed, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private String enc(String value) throws Exception {
        return URLEncoder.encode(value == null ? "" : value, "UTF-8");
    }

    private String trim(String value) {
        String single = value == null ? "" : value.replace('\n', ' ').trim();
        return single.length() > 300 ? single.substring(0, 300) : single;
    }

    private String describe(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    private void record(Exception error) {
        prefs().edit().putString("lastError", describe(error)).apply();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
        super.handleOnDestroy();
    }
}

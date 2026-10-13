package pl.ursusel.pulsar.android;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Synchronizacja przez folder na Dysku użytkownika, bez logowania w aplikacji.
 *
 * Użytkownik raz wskazuje folder w systemowym oknie Dokumentów (to samo, które
 * zna z innych aplikacji) i wybiera tam swoje konto Google. Aplikacja zapisuje
 * trwałe pozwolenie na ten folder, więc kolejne uruchomienia nie pytają o nic.
 *
 * Ten sam plik `pulsar-library.json` wskazuje się na drugim urządzeniu i od tej
 * pory synchronizacja dzieje się sama. Apka nie widzi hasła ani nie prosi
 * o zgodę OAuth — dostęp do Dysku daje system, na poziomie wybranego folderu.
 */
@CapacitorPlugin(name = "PulsarFolder")
public class PulsarFolderPlugin extends Plugin {

    private static final String PREFS = "pulsar_folder";
    private static final String KEY_URI = "treeUri";
    private static final String FILE_NAME = "pulsar-library.json";
    private static final String MIME = "application/json";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private Uri treeUri() {
        String raw = prefs().getString(KEY_URI, "");
        if (raw == null || raw.isEmpty()) return null;
        try {
            return Uri.parse(raw);
        } catch (Exception error) {
            return null;
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void forget(PluginCall call) {
        Uri uri = treeUri();
        if (uri != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {
                // Bez pozwolenia też czyścimy wpis — użytkownik chce zapomnieć folder.
            }
        }
        prefs().edit().remove(KEY_URI).putString("lastError", "").apply();
        call.resolve(statusObject());
    }

    /** Jednorazowy wybór folderu; potem pozwolenie jest trwałe. */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "folderPicked");
        } catch (Exception error) {
            call.reject("Nie można otworzyć okna wyboru folderu: " + error.getMessage());
        }
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("Nie wybrano folderu.");
            return;
        }
        Uri tree = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (flags == 0) {
            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, flags);
        } catch (Exception error) {
            call.reject("Nie udało się zachować dostępu do folderu: " + error.getMessage());
            return;
        }
        prefs().edit().putString(KEY_URI, tree.toString()).putString("lastError", "").apply();
        call.resolve(statusObject());
    }

    /** Odczyt manifestu; brak pliku to nie błąd, tylko „jeszcze nic tu nie ma". */
    @PluginMethod
    public void read(final PluginCall call) {
        executor.execute(() -> {
            try {
                Uri tree = treeUri();
                if (tree == null) {
                    call.reject("Nie wskazano folderu.");
                    return;
                }
                DocumentFile directory = DocumentFile.fromTreeUri(getContext(), tree);
                if (directory == null || !directory.canRead()) {
                    fail(call, "Brak dostępu do folderu — wybierz go ponownie.");
                    return;
                }
                DocumentFile file = directory.findFile(FILE_NAME);
                JSObject result = new JSObject();
                result.put("file", FILE_NAME);
                result.put("label", labelOf(directory));
                if (file == null || !file.exists()) {
                    result.put("manifest", null);
                    result.put("modifiedTime", 0);
                    call.resolve(result);
                    return;
                }
                result.put("manifest", readText(file));
                result.put("modifiedTime", file.lastModified());
                call.resolve(result);
            } catch (Exception error) {
                fail(call, describe(error));
            }
        });
    }

    /** Zapis manifestu; plik tworzy się przy pierwszym zapisie. */
    @PluginMethod
    public void write(final PluginCall call) {
        final String manifest = call.getString("manifest");
        if (manifest == null) {
            call.reject("Brak manifestu do zapisania.");
            return;
        }
        executor.execute(() -> {
            try {
                Uri tree = treeUri();
                if (tree == null) {
                    call.reject("Nie wskazano folderu.");
                    return;
                }
                DocumentFile directory = DocumentFile.fromTreeUri(getContext(), tree);
                if (directory == null || !directory.canWrite()) {
                    fail(call, "Brak dostępu do folderu — wybierz go ponownie.");
                    return;
                }
                DocumentFile file = directory.findFile(FILE_NAME);
                if (file == null) file = directory.createFile(MIME, FILE_NAME);
                if (file == null) {
                    fail(call, "Nie można utworzyć pliku " + FILE_NAME + " w tym folderze.");
                    return;
                }
                try (OutputStream output = getContext().getContentResolver().openOutputStream(file.getUri(), "wt")) {
                    if (output == null) {
                        fail(call, "Nie można otworzyć pliku do zapisu.");
                        return;
                    }
                    output.write(manifest.getBytes(StandardCharsets.UTF_8));
                    output.flush();
                }
                prefs().edit().putString("lastError", "").apply();
                JSObject result = new JSObject();
                result.put("file", FILE_NAME);
                result.put("modifiedTime", System.currentTimeMillis());
                call.resolve(result);
            } catch (Exception error) {
                fail(call, describe(error));
            }
        });
    }

    private JSObject statusObject() {
        Uri tree = treeUri();
        boolean picked = tree != null;
        String label = "";
        boolean fileReady = false;
        if (picked) {
            try {
                DocumentFile directory = DocumentFile.fromTreeUri(getContext(), tree);
                if (directory != null) {
                    label = labelOf(directory);
                    DocumentFile file = directory.findFile(FILE_NAME);
                    fileReady = file != null && file.exists();
                }
            } catch (Exception ignored) {
                // Etykieta jest kosmetyczna — brak nazwy nie blokuje synchronizacji.
            }
        }
        JSObject result = new JSObject();
        result.put("picked", picked);
        result.put("label", label);
        result.put("file", FILE_NAME);
        result.put("fileReady", fileReady);
        result.put("lastError", prefs().getString("lastError", ""));
        return result;
    }

    private String labelOf(DocumentFile directory) {
        try {
            String name = directory.getName();
            if (name != null && !name.trim().isEmpty()) return name.trim();
        } catch (Exception ignored) {
            // np. dostawca bez nazwy — próbujemy niżej zapytaniem do systemu.
        }
        try {
            Uri document = DocumentsContract.buildDocumentUriUsingTree(
                directory.getUri(), DocumentsContract.getTreeDocumentId(directory.getUri()));
            String[] projection = {DocumentsContract.Document.COLUMN_DISPLAY_NAME};
            try (Cursor cursor = getContext().getContentResolver().query(document, projection, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String name = cursor.getString(0);
                    if (name != null && !name.trim().isEmpty()) return name.trim();
                }
            }
        } catch (Exception ignored) {
            // Nazwa pozostaje pusta; użytkownik i tak widzi, że folder jest wybrany.
        }
        return "";
    }

    private String readText(DocumentFile file) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (InputStream stream = getContext().getContentResolver().openInputStream(file.getUri())) {
            if (stream == null) throw new Exception("Nie można odczytać " + FILE_NAME + ".");
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) builder.append(line).append('\n');
            }
        }
        return builder.toString();
    }

    private void fail(PluginCall call, String message) {
        prefs().edit().putString("lastError", message).apply();
        call.reject(message);
    }

    private String describe(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
        super.handleOnDestroy();
    }
}

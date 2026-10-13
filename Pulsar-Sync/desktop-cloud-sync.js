/* Pulsar — warstwa synchronizacji dla Windows i Linuksa (Neutralino).
 *
 * Rejestruje window.__pulsarSyncAdapter, czyli ten sam kontrakt, którego na
 * Androidzie używa PulsarFolderPlugin: odczyt i zapis pliku
 * `pulsar-library.json` w folderze wskazanym raz w systemowym oknie.
 *
 * Jeśli tym folderem jest folder synchronizowany z Dyskiem Google (klient
 * Drive dla Windows, na Linuksie rclone/Insync/overlay), plik trafia do chmury
 * bez logowania w aplikacji i bez projektu w Google Cloud — a plik jest ten sam,
 * którego używa Android, więc wszystkie trzy platformy widzą jedną bibliotekę.
 *
 * Neutralino nie ma gniazd sieciowych, więc logowanie OAuth (które wymaga
 * przekierowania na localhost) nie jest tu dostępne; adapter zgłasza to jako
 * supportsGoogle: false, a panel chowa kartę Google.
 */
(function () {
  'use strict';

  if (typeof Neutralino === 'undefined') return;

  var FILE_NAME = 'pulsar-library.json';
  var KEY_PATH = 'pulsarSyncFolder';
  var KEY_ERROR = 'pulsarSyncFolderError';

  function store(key) {
    try { return localStorage.getItem(key) || ''; } catch (error) { return ''; }
  }

  function keep(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (error) {}
  }

  function join(dir, name) {
    return String(dir).replace(/[\\/]+$/, '') + '/' + name;
  }

  function remember(error) {
    var message = error && error.message ? error.message : String(error || '');
    keep(KEY_ERROR, message);
    return message;
  }

  function clearError() {
    keep(KEY_ERROR, '');
  }

  async function exists(path) {
    try {
      await Neutralino.filesystem.getStats(path);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function folderStats(dir) {
    if (!dir) return null;
    try {
      return await Neutralino.filesystem.getStats(dir);
    } catch (error) {
      return null;
    }
  }

  var adapter = {
    /** Desktop nie ma logowania Google w aplikacji — panel to respektuje. */
    supportsGoogle: false,
    desktop: true,

    async status() {
      var dir = store(KEY_PATH);
      if (!dir) {
        return { picked: false, label: '', file: FILE_NAME, fileReady: false, lastError: store(KEY_ERROR) };
      }
      var stats = await folderStats(dir);
      if (!stats || (stats.isDirectory === false)) {
        return { picked: false, label: '', file: FILE_NAME, fileReady: false, lastError: store(KEY_ERROR) };
      }
      var ready = await exists(join(dir, FILE_NAME));
      return { picked: true, label: dir, file: FILE_NAME, fileReady: ready, lastError: store(KEY_ERROR) };
    },

    async pickFolder() {
      try {
        var dir = await Neutralino.os.showFolderDialog('Wybierz folder biblioteki');
        if (!dir) return adapter.status();
        keep(KEY_PATH, String(dir));
        clearError();
        return adapter.status();
      } catch (error) {
        remember(error);
        return adapter.status();
      }
    },

    async forget() {
      keep(KEY_PATH, '');
      clearError();
      return adapter.status();
    },

    async read() {
      var dir = store(KEY_PATH);
      if (!dir) throw new Error('Nie wskazano folderu.');
      var file = join(dir, FILE_NAME);
      if (!(await exists(file))) return { manifest: null, modifiedTime: 0 };
      try {
        var text = await Neutralino.filesystem.readFile(file);
        clearError();
        var stats = await folderStats(file);
        return { manifest: text, modifiedTime: stats && stats.modifiedAt ? stats.modifiedAt : Date.now() };
      } catch (error) {
        throw new Error(remember(error) || 'Nie można odczytać pliku biblioteki.');
      }
    },

    async write(payload) {
      var dir = store(KEY_PATH);
      if (!dir) throw new Error('Nie wskazano folderu.');
      try {
        if (!(await folderStats(dir))) {
          await Neutralino.filesystem.createDirectory(dir);
        }
        await Neutralino.filesystem.writeFile(join(dir, FILE_NAME), String(payload && payload.manifest || ''));
        clearError();
        return { file: FILE_NAME, modifiedTime: Date.now() };
      } catch (error) {
        throw new Error(remember(error) || 'Nie można zapisać pliku biblioteki.');
      }
    }
  };

  window.__pulsarSyncAdapter = adapter;
})();

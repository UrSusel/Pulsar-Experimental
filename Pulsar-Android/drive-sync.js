/**
 * Pulsar Android — synchronizacja biblioteki z Google Drive (tylko metadane).
 *
 * Co wysyłamy: lista utworów (tytuł, wykonawca, album, rok, polubienie, liczba
 * odtworzeń, identyfikator YouTube) oraz albumy (nazwa, okładka, zawartość).
 * Czego NIGDY nie wysyłamy: plików audio, okładek-blobów, ścieżek lokalnych
 * ani adresów strumieni (te wygasają po kilku godzinach i są przypisane do IP).
 *
 * Warstwa natywna (PulsarDrivePlugin) robi logowanie i wywołania Drive.
 * Ten plik ma całą logikę: zbudowanie manifestu, scalenie dwóch manifestów
 * (ostatnia zmiana wygrywa, kasowanie wygrywa z wpisem), zastosowanie wyniku
 * w bibliotece i panel w ustawieniach. Ładowany tylko na Androidzie, przez
 * build_web_assets.py.
 */
(function () {
  'use strict';

  var SCHEMA = 1;
  var MANIFEST_NAME = 'pulsar-library.json';
  var SYNC_DB = 'pulsar-sync';
  var SYNC_DB_VERSION = 1;
  var TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

  var LANG = 'pl';
  try { LANG = String(localStorage.getItem('playerLang') || 'pl').slice(0, 2); } catch (error) {}

  var LABELS = {
    pl: {
      title: 'Chmura', tab: 'Chmura',
      intro: 'Biblioteka (utwory, albumy, polubienia) synchronizuje się przez Twoje konto Google. Pliki audio zostają na urządzeniu.',
      neverDeletes: 'Kasowanie nigdy nie rusza plików: utwory usunięte na innym urządzeniu są tylko oznaczone.',
      notConfigured: 'Synchronizacja nie jest skonfigurowana — wklej Client ID i Client secret z Google Cloud.',
      signedOut: 'Nie zalogowano na konto Google.', signedInAs: 'Zalogowano jako ',
      signIn: 'Zaloguj się kontem Google', signOut: 'Wyloguj', syncNow: 'Synchronizuj teraz',
      syncing: 'Synchronizuję…', lastSync: 'Ostatnia synchronizacja: ', never: 'nigdy',
      sent: 'Wysłane: ', received: 'Odebrane: ', inCloud: 'Tylko w chmurze: ',
      removedElsewhere: 'Usunięte na innym urządzeniu: ',
      mirror: 'Trzymaj czytelną kopię na Dysku (folder Pulsar)',
      enabled: 'Synchronizuj automatycznie',
      advanced: 'Konfiguracja (Google Cloud)', clientId: 'Client ID', clientSecret: 'Client secret',
      redirectUri: 'Adres przekierowania', save: 'Zapisz',
      help: 'Jak włączyć: utwórz projekt w Google Cloud, dodaj typ klienta OAuth „Aplikacja komputerowa”, wklej Client ID i secret powyżej, jako adres przekierowania podaj pl.ursusel.pulsar.android:/oauth2redirect i dodaj swoje konto jako testera.',
      missingLibrary: 'Nie widzę biblioteki aplikacji.', error: 'Błąd: '
    },
    en: {
      title: 'Cloud', tab: 'Cloud',
      intro: 'Your library (tracks, albums, favourites) syncs through your own Google account. Audio files stay on the device.',
      neverDeletes: 'Deleting never touches files: tracks removed on another device are only flagged.',
      notConfigured: 'Sync is not configured — paste the Client ID and Client secret from Google Cloud.',
      signedOut: 'Not signed in to Google.', signedInAs: 'Signed in as ',
      signIn: 'Sign in with Google', signOut: 'Sign out', syncNow: 'Sync now',
      syncing: 'Syncing…', lastSync: 'Last sync: ', never: 'never',
      sent: 'Sent: ', received: 'Received: ', inCloud: 'Cloud only: ',
      removedElsewhere: 'Removed on another device: ',
      mirror: 'Keep a readable copy in Drive (Pulsar folder)',
      enabled: 'Sync automatically',
      advanced: 'Setup (Google Cloud)', clientId: 'Client ID', clientSecret: 'Client secret',
      redirectUri: 'Redirect URI', save: 'Save',
      help: 'How to enable: create a Google Cloud project, add an OAuth client of type “Desktop app”, paste its Client ID and secret above, set the redirect URI to pl.ursusel.pulsar.android:/oauth2redirect and add your account as a test user.',
      missingLibrary: 'The app library is not available.', error: 'Error: '
    }
  };

  function T(key) {
    var table = LABELS[LANG] || LABELS.en;
    return table[key] || LABELS.en[key] || key;
  }

  // --------------------------------------------------------------- narzędzia

  function nowMs() { return Date.now(); }

  /** Krótki stabilny skrót (bez crypto.subtle, żeby działał synchronicznie). */
  function hash(text) {
    var a = 0x811c9dc5;
    var b = 0x01000193;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      a = (a ^ c) * 16777619 >>> 0;
      b = ((b + c * (i + 1)) ^ (b >>> 13)) >>> 0;
    }
    return (a.toString(16) + b.toString(16)).slice(0, 16);
  }

  /**
   * Klucz utworu wspólny dla wszystkich urządzeń.
   * Preferujemy identyfikator sieciowy (`netId` = „youtube:VIDEOID”), bo jest
   * ten sam wszędzie. Dla plików lokalnych zostaje odcisk z rozmiaru i nazwy —
   * niezależny od lokalnej ścieżki i od UUID nadanego przy imporcie (te różnią
   * się między urządzeniami i nie nadają się do parowania).
   */
  function trackKey(track) {
    if (!track) return '';
    var netId = track.netId || track.syncId || '';
    if (netId) return String(netId);
    var size = track.file ? (track.file.size || 0) : (track.size || 0);
    var name = track.file ? (track.file.name || '') : (track.name || '');
    if (!name && !size) return '';
    return 'fp:' + size + ':' + hash(String(name).toLowerCase());
  }

  function albumKey(album) {
    if (!album) return '';
    if (album.syncId) return String(album.syncId);
    return 'al:' + hash(String(album.name || '').toLowerCase());
  }

  function metadataOf(track) {
    var netId = String((track && (track.netId || track.syncId)) || '');
    return {
      title: String((track && track.title) || ''),
      artist: String((track && track.artist) || ''),
      album: String((track && track.album) || ''),
      year: String((track && track.year) || ''),
      provider: netId ? netId.split(':')[0] : String((track && track.provider) || ''),
      ytId: netId.indexOf('youtube:') === 0 ? netId.slice(8) : '',
      durMs: Math.round(Number((track && track.durMs) || 0) || 0),
      fav: !!(track && track.fav),
      plays: Math.max(0, Math.round(Number((track && track.plays) || 0) || 0)),
      lastPlay: Math.max(0, Math.round(Number((track && track.lastPlay) || 0) || 0))
    };
  }

  function fingerprintOf(meta) {
    return [
      meta.title, meta.artist, meta.album, meta.year, meta.provider, meta.ytId,
      meta.durMs, meta.fav ? 1 : 0, meta.plays, meta.lastPlay
    ].join('|');
  }

  function devicesOf(manifest) {
    var list = (manifest && manifest.devices) || [];
    var out = [];
    var seen = {};
    list.forEach(function (entry) {
      if (!entry || !entry.id || seen[entry.id]) return;
      seen[entry.id] = true;
      out.push(entry);
    });
    return out;
  }

  function mergeDevices(local, remote, device) {
    var out = devicesOf(remote).concat(devicesOf(local));
    var seen = {};
    var merged = [];
    out.forEach(function (entry) {
      if (!entry || !entry.id || seen[entry.id]) return;
      seen[entry.id] = true;
      merged.push(entry.id === device.id ? { id: device.id, name: device.name, platform: device.platform, at: nowMs() } : entry);
    });
    if (!seen[device.id]) merged.unshift({ id: device.id, name: device.name, platform: device.platform, at: nowMs() });
    return merged.slice(0, 12);
  }

  /**
   * Buduje manifest z bieżącego stanu biblioteki.
   * `previous` (poprzednio wypchnięty manifest) służy do wykrycia zmian: wpisy
   * o niezmienionym odcisku zachowują stary znacznik czasu, a klucze, których
   * już nie ma, zamieniają się w znaczniki kasowania.
   *
   * Pierwsza synchronizacja nie zna wieku miejscowych wpisów, więc dostają
   * znacznik 0 („wiek nieznany") i przegrywają konflikt z wpisem z chmury.
   * Inaczej urządzenie, które uruchomiło sync później, nadpisywałoby cudze
   * zmiany tylko dlatego, że ma późniejszy zegar.
   */
  function buildManifest(snapshot, previous, device) {
    var firstSync = !previous;
    var previousTracks = {};
    var previousAlbums = {};
    var tombstones = {};

    if (previous) {
      (previous.tracks || []).forEach(function (entry) { if (entry && entry.key) previousTracks[entry.key] = entry; });
      (previous.albums || []).forEach(function (entry) { if (entry && entry.key) previousAlbums[entry.key] = entry; });
      (previous.removed || []).forEach(function (entry) { if (entry && entry.key) tombstones[entry.key] = entry; });
    }

    var stamp = nowMs();
    var seenTracks = {};
    var tracks = [];

    (snapshot.tracks || []).forEach(function (item) {
      var key = item.key || trackKey(item);
      if (!key || seenTracks[key]) return;
      seenTracks[key] = true;
      var meta = metadataOf(item);
      var fingerprint = fingerprintOf(meta);
      var previousEntry = previousTracks[key];
      var unchanged = previousEntry && previousEntry.fingerprint === fingerprint;
      tracks.push({
        key: key,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        year: meta.year,
        provider: meta.provider,
        ytId: meta.ytId,
        durMs: meta.durMs,
        fav: meta.fav,
        plays: meta.plays,
        lastPlay: meta.lastPlay,
        fingerprint: fingerprint,
        device: device.id,
        updatedAt: unchanged ? previousEntry.updatedAt : (firstSync ? 0 : stamp)
      });
      delete tombstones[key];
    });

    Object.keys(previousTracks).forEach(function (key) {
      if (seenTracks[key]) return;
      var existing = tombstones[key];
      tombstones[key] = { key: key, deletedAt: existing ? existing.deletedAt : stamp, device: device.id };
    });

    var seenAlbums = {};
    var albums = [];
    (snapshot.albums || []).forEach(function (item) {
      var key = item.key || albumKey(item);
      if (!key || seenAlbums[key]) return;
      seenAlbums[key] = true;
      var trackKeys = (item.trackKeys || []).slice().sort();
      var fingerprint = [item.name || '', item.artist || '', item.cover || '', trackKeys.join(',')].join('|');
      var previousEntry = previousAlbums[key];
      var unchanged = previousEntry && previousEntry.fingerprint === fingerprint;
      albums.push({
        key: key,
        name: String(item.name || ''),
        artist: String(item.artist || ''),
        cover: String(item.cover || ''),
        trackKeys: trackKeys,
        customCover: !!item.customCover,
        createdAt: Number(item.createdAt || 0) || stamp,
        fingerprint: fingerprint,
        device: device.id,
        updatedAt: unchanged ? previousEntry.updatedAt : (firstSync ? 0 : stamp)
      });
      delete tombstones[key];
    });

    Object.keys(previousAlbums).forEach(function (key) {
      if (seenAlbums[key]) return;
      var existing = tombstones[key];
      tombstones[key] = { key: key, deletedAt: existing ? existing.deletedAt : stamp, device: device.id };
    });

    var cutoff = stamp - TOMBSTONE_TTL_MS;
    var removed = Object.keys(tombstones)
      .map(function (key) { return tombstones[key]; })
      .filter(function (entry) { return Number(entry.deletedAt || 0) > cutoff; });

    return {
      schema: SCHEMA,
      app: 'pulsar',
      name: MANIFEST_NAME,
      updatedAt: stamp,
      device: { id: device.id, name: device.name, platform: device.platform },
      devices: mergeDevices(null, previous, device),
      tracks: tracks,
      albums: albums,
      removed: removed
    };
  }

  /** Ostatnia zmiana wygrywa; przy remisie rozstrzyga identyfikator urządzenia. */
  function newer(a, b) {
    var aAt = Number((a && a.updatedAt) || 0);
    var bAt = Number((b && b.updatedAt) || 0);
    if (aAt !== bAt) return aAt > bAt ? a : b;
    var aDevice = String((a && a.device) || '');
    var bDevice = String((b && b.device) || '');
    if (aDevice === bDevice) return a;
    return aDevice > bDevice ? a : b;
  }

  function fingerprintOfRecord(record, isAlbum) {
    if (isAlbum) {
      var keys = (record.trackKeys || []).slice().sort().join(',');
      return [record.name || '', record.artist || '', record.cover || '', keys].join('|');
    }
    return fingerprintOf({
      title: record.title || '',
      artist: record.artist || '',
      album: record.album || '',
      year: record.year || '',
      provider: record.provider || '',
      ytId: record.ytId || '',
      durMs: Number(record.durMs || 0) || 0,
      fav: !!record.fav,
      plays: Number(record.plays || 0) || 0,
      lastPlay: Number(record.lastPlay || 0) || 0
    });
  }

  function unionKeys(a, b) {
    var out = [];
    (a || []).concat(b || []).forEach(function (key) {
      if (key && out.indexOf(key) === -1) out.push(key);
    });
    return out;
  }

  /**
   * Scala dwa wpisy o tym samym kluczu.
   *
   * Gdy oba znają swój wiek (mają znacznik zmiany), wygrywa nowszy wpis —
   * dzięki temu odznaczenie polubienia też się propaguje.
   *
   * Gdy wieku nie da się porównać (pierwsza synchronizacja obu urządzeń ma
   * znacznik 0, albo remis), nie udajemy, że wiemy, kto ma rację, i scalamy
   * pola po ludzku: brakujące teksty się uzupełniają, polubienie nigdy nie
   * ginie (true wygrywa), a liczniki odtworzeń biorą maksimum. Wybór przy
   * dwóch sprzecznych, niepustych tekstach jest deterministyczny (kolejność
   * urządzeń), więc każde urządzenie dojdzie do tego samego wyniku.
   */
  function mergeEntries(mine, theirs, isAlbum) {
    var knownAges = Number(mine.updatedAt || 0) > 0 && Number(theirs.updatedAt || 0) > 0;
    var winner = newer(mine, theirs);
    var out = Object.assign({}, winner);

    function text(field) {
      var a = String(mine[field] || '');
      var b = String(theirs[field] || '');
      if (a === b) return a;
      if (knownAges) return String(winner[field] || '');
      if (!a) return b;
      if (!b) return a;
      return winner === mine ? a : b;
    }

    if (isAlbum) {
      out.name = text('name');
      out.artist = text('artist');
      out.cover = text('cover');
      if (!knownAges) out.trackKeys = unionKeys(mine.trackKeys, theirs.trackKeys);
    } else {
      out.title = text('title');
      out.artist = text('artist');
      out.album = text('album');
      out.year = text('year');
      out.provider = text('provider');
      out.ytId = text('ytId');
      out.fav = knownAges ? !!winner.fav : (!!mine.fav || !!theirs.fav);
      out.plays = Math.max(Number(mine.plays || 0) || 0, Number(theirs.plays || 0) || 0);
      out.lastPlay = Math.max(Number(mine.lastPlay || 0) || 0, Number(theirs.lastPlay || 0) || 0);
      out.durMs = Number(winner.durMs || 0) || Number(mine.durMs || theirs.durMs || 0) || 0;
    }

    out.updatedAt = Math.max(Number(mine.updatedAt || 0) || 0, Number(theirs.updatedAt || 0) || 0);
    out.fingerprint = fingerprintOfRecord(out, isAlbum);
    out.device = winner.device || mine.device || '';
    return out;
  }

  function collectTombstones(local, remote) {
    var map = {};
    (local && local.removed || []).forEach(function (entry) { if (entry && entry.key) map[entry.key] = entry; });
    (remote && remote.removed || []).forEach(function (entry) {
      if (!entry || !entry.key) return;
      var existing = map[entry.key];
      if (existing && Number(existing.deletedAt || 0) >= Number(entry.deletedAt || 0)) return;
      map[entry.key] = entry;
    });
    return map;
  }

  /**
   * Scala lokalny manifest ze zdalnym. Czysta funkcja — bez zapisu.
   * Zwraca { merged, incoming, stats }:
   *   merged   — stan do wypchnięcia,
   *   incoming — pozycje, które na tym urządzeniu trzeba zastosować,
   *   stats    — liczniki dla panelu.
   * Kasowanie wygrywa z wpisem, jeśli jest nowsze — inaczej usunięty utwór
   * wracałby z drugiego urządzenia przy każdej synchronizacji.
   */
  function mergeManifests(local, remote) {
    var stats = { localOnly: 0, remoteOnly: 0, updated: 0, remoteRemoved: [], cloudRemoved: [] };
    if (!remote) return { merged: local, incoming: { tracks: [], albums: [] }, stats: stats };
    if (!local) return { merged: remote, incoming: { tracks: remote.tracks || [], albums: remote.albums || [] }, stats: stats };

    var tombstones = collectTombstones(local, remote);
    var localTracks = {};
    var localAlbums = {};
    (local.tracks || []).forEach(function (entry) { if (entry && entry.key) localTracks[entry.key] = entry; });
    (local.albums || []).forEach(function (entry) { if (entry && entry.key) localAlbums[entry.key] = entry; });

    function buried(entry) {
      var tomb = tombstones[entry.key];
      return !!tomb && Number(tomb.deletedAt || 0) >= Number(entry.updatedAt || 0);
    }

    var mergedTracks = [];
    var incomingTracks = [];
    var index = {};
    (local.tracks || []).forEach(function (entry) {
      if (!entry || !entry.key || buried(entry)) return;
      index[entry.key] = mergedTracks.length;
      mergedTracks.push(entry);
    });
    (remote.tracks || []).forEach(function (entry) {
      if (!entry || !entry.key || buried(entry)) return;
      var at = index[entry.key];
      if (at === undefined) {
        index[entry.key] = mergedTracks.length;
        mergedTracks.push(entry);
        stats.remoteOnly++;
        incomingTracks.push(entry);
        return;
      }
      var mergedEntry = mergeEntries(mergedTracks[at], entry, false);
      if (mergedEntry.fingerprint !== mergedTracks[at].fingerprint) {
        stats.updated++;
        incomingTracks.push(mergedEntry);
      }
      mergedTracks[at] = mergedEntry;
    });

    Object.keys(localTracks).forEach(function (key) {
      if (!remote.tracks || !remote.tracks.some(function (entry) { return entry && entry.key === key; })) stats.localOnly++;
      if (localTracks[key] && buried(localTracks[key]) && tombstones[key].device !== local.device.id) {
        stats.remoteRemoved.push(key);
      }
    });

    var mergedAlbums = [];
    var incomingAlbums = [];
    var albumIndex = {};
    (local.albums || []).forEach(function (entry) {
      if (!entry || !entry.key || buried(entry)) return;
      albumIndex[entry.key] = mergedAlbums.length;
      mergedAlbums.push(entry);
    });
    (remote.albums || []).forEach(function (entry) {
      if (!entry || !entry.key || buried(entry)) return;
      var at = albumIndex[entry.key];
      if (at === undefined) {
        albumIndex[entry.key] = mergedAlbums.length;
        mergedAlbums.push(entry);
        incomingAlbums.push(entry);
        return;
      }
      var mergedAlbum = mergeEntries(mergedAlbums[at], entry, true);
      if (mergedAlbum.fingerprint !== mergedAlbums[at].fingerprint) incomingAlbums.push(mergedAlbum);
      mergedAlbums[at] = mergedAlbum;
    });

    // Pozycje z chmury, których nie ma już po żadnej stronie (poza lokalnym plikiem).
    (remote.tracks || []).forEach(function (entry) {
      if (entry && entry.key && buried(entry) && !localTracks[entry.key]) stats.cloudRemoved.push(entry.key);
    });

    var merged = {
      schema: SCHEMA,
      app: 'pulsar',
      name: MANIFEST_NAME,
      updatedAt: nowMs(),
      device: local.device,
      devices: mergeDevices(local, remote, local.device),
      tracks: mergedTracks,
      albums: mergedAlbums,
      removed: Object.keys(tombstones).map(function (key) { return tombstones[key]; })
    };
    return { merged: merged, incoming: { tracks: incomingTracks, albums: incomingAlbums }, stats: stats };
  }

  /**
   * Plan zmian dla runtime: co podmienić w bibliotece w pamięci.
   * Utwory istniejące tylko w chmurze są pomijane — aplikacja gra z plików,
   * więc nie tworzymy „pustych” pozycji. Trafiają do listy „tylko w chmurze”.
   */
  function buildApplyPlan(incoming, snapshot) {
    var byKey = {};
    (snapshot.tracks || []).forEach(function (item) { if (item.key) byKey[item.key] = item; });

    var trackUpdates = [];
    (incoming.tracks || []).forEach(function (entry) {
      var local = byKey[entry.key];
      if (!local) return;
      var fields = {};
      if (entry.title && entry.title !== local.title) fields.title = entry.title;
      if (entry.artist && entry.artist !== local.artist) fields.artist = entry.artist;
      if ((entry.album || '') !== (local.album || '')) fields.album = entry.album || '';
      if ((entry.year || '') !== (local.year || '')) fields.year = entry.year || '';
      if (!!entry.fav !== !!local.fav) fields.fav = !!entry.fav;
      if (Number(entry.plays || 0) > Number(local.plays || 0)) fields.plays = Number(entry.plays || 0);
      if (Number(entry.lastPlay || 0) > Number(local.lastPlay || 0)) fields.lastPlay = Number(entry.lastPlay || 0);
      if (Object.keys(fields).length) trackUpdates.push({ key: entry.key, fields: fields });
    });

    var albumKeys = {};
    (snapshot.albums || []).forEach(function (item) { if (item.key) albumKeys[item.key] = item; });

    var albumUpdates = [];
    var newAlbums = [];
    (incoming.albums || []).forEach(function (entry) {
      var local = albumKeys[entry.key];
      if (local) {
        var before = (local.trackKeys || []).slice().sort().join(',');
        var after = (entry.trackKeys || []).slice().sort().join(',');
        if (before !== after) albumUpdates.push({ key: entry.key, trackKeys: entry.trackKeys || [] });
      } else {
        newAlbums.push({
          key: entry.key,
          name: entry.name,
          trackKeys: entry.trackKeys || [],
          createdAt: entry.createdAt || nowMs()
        });
      }
    });
    return { trackUpdates: trackUpdates, albumUpdates: albumUpdates, newAlbums: newAlbums };
  }

  function cloudOnlyOf(merged, snapshot) {
    var local = {};
    (snapshot.tracks || []).forEach(function (item) { if (item.key) local[item.key] = true; });
    return (merged.tracks || []).filter(function (entry) { return entry && entry.key && !local[entry.key]; });
  }

  // --------------------------------------------------------------- baza sync

  var dbPromise = null;

  function openSyncDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open(SYNC_DB, SYNC_DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cloud')) db.createObjectStore('cloud', { keyPath: 'key' });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return dbPromise;
  }

  function withStore(store, mode, work) {
    return openSyncDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = work(db.transaction(store, mode).objectStore(store));
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function stateGet(id) { return withStore('state', 'readonly', function (store) { return store.get(id); }); }
  function statePut(value) { return withStore('state', 'readwrite', function (store) { return store.put(value); }); }
  function cloudReplace(entries) {
    return withStore('cloud', 'readwrite', function (store) { return store.clear(); }).then(function () {
      return Promise.all((entries || []).map(function (entry) {
        return withStore('cloud', 'readwrite', function (store) { return store.put(entry); });
      }));
    });
  }

  // ------------------------------------------------------------- stan i UI

  var plugin = null;
  var status = { configured: false, signedIn: false, email: '', lastSyncAt: 0, lastError: '', mirror: true };
  var settings = { enabled: false };
  var busy = false;
  var counters = { sent: 0, received: 0, cloud: 0, removed: 0 };
  var scheduledTimer = null;
  var listenersReady = false;
  var panel = null;

  function pluginApi() {
    var capacitor = window.Capacitor;
    return (capacitor && capacitor.Plugins && capacitor.Plugins.PulsarDrive) || null;
  }

  function hostSnapshot() {
    if (typeof window.__pulsarSyncSnapshot !== 'function') return null;
    try { return window.__pulsarSyncSnapshot(); } catch (error) { return null; }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem('pulsarCloudSync');
      if (raw) settings.enabled = !!JSON.parse(raw).enabled;
    } catch (error) {}
  }

  function saveSettings() {
    try { localStorage.setItem('pulsarCloudSync', JSON.stringify({ enabled: settings.enabled })); } catch (error) {}
  }

  function setStatus(patch) {
    status = Object.assign({}, status, patch || {});
    renderPanelStatus();
  }

  function deviceInfo() {
    return stateGet('device').then(function (stored) {
      if (stored && stored.deviceId) return stored;
      var record = {
        id: 'device',
        deviceId: 'dev-' + hash(String(navigator.userAgent || '') + nowMs() + Math.random()),
        name: deviceName(),
        platform: 'android',
        createdAt: nowMs()
      };
      return statePut(record).then(function () { return record; });
    });
  }

  function deviceName() {
    var match = String(navigator.userAgent || '').match(/Android[^;]*;\s*([^)]+?)(?:\s+Build|\))/i);
    return (match && match[1] ? match[1].trim() : 'Android').slice(0, 40);
  }

  function refreshStatus() {
    plugin = pluginApi();
    if (!plugin) return Promise.resolve(status);
    return plugin.status().then(function (result) {
      status = Object.assign({}, status, result || {});
      renderPanelStatus();
      return status;
    }).catch(function (error) {
      setStatus({ lastError: message(error) });
      return status;
    });
  }

  function message(error) {
    return String((error && error.message) || error || '');
  }

  function scheduleSync(delayMs) {
    if (!settings.enabled || busy) return;
    if (scheduledTimer) clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(function () {
      scheduledTimer = null;
      runSync().catch(function () {});
    }, Math.max(1000, delayMs || 20000));
  }

  /** Pełny cykl: pobierz zdalny manifest, scal, zastosuj u siebie, wypchnij wynik. */
  function runSync() {
    if (busy) return Promise.resolve({ skipped: 'busy' });
    plugin = pluginApi();
    if (!plugin) return Promise.resolve({ skipped: 'no-plugin' });
    if (!settings.enabled) return Promise.resolve({ skipped: 'disabled' });

    busy = true;
    renderPanelStatus();
    var mergedManifest = null;

    return refreshStatus()
      .then(function () {
        if (!status.signedIn) throw new Error(T('signedOut'));
        return deviceInfo();
      })
      .then(function (device) {
        var snapshot = hostSnapshot();
        if (!snapshot) throw new Error(T('missingLibrary'));
        return stateGet('manifest').then(function (stored) {
          var previous = stored && stored.value ? stored.value : null;
          var localManifest = buildManifest(snapshot, previous, {
            id: device.deviceId, name: device.name, platform: 'android'
          });
          return plugin.pull().then(function (remote) {
            var remoteManifest = null;
            if (remote && remote.manifest) {
              try { remoteManifest = JSON.parse(remote.manifest); } catch (error) { remoteManifest = null; }
            }
            var merged = mergeManifests(localManifest, remoteManifest);
            mergedManifest = merged.merged;
            var plan = buildApplyPlan(merged.incoming, snapshot);
            var touched = plan.trackUpdates.length + plan.albumUpdates.length + plan.newAlbums.length;
            var applyStep = Promise.resolve({ tracks: 0, albums: 0 });
            if (touched && typeof window.__pulsarSyncApply === 'function') {
              try {
                applyStep = Promise.resolve(window.__pulsarSyncApply(plan)).catch(function () {
                  return { tracks: 0, albums: 0 };
                });
              } catch (error) {
                applyStep = Promise.resolve({ tracks: 0, albums: 0 });
              }
            }
            return applyStep.then(function () {
              var cloudEntries = cloudOnlyOf(mergedManifest, snapshot);
              counters = {
                sent: (mergedManifest.tracks || []).length,
                received: plan.trackUpdates.length + plan.newAlbums.length + plan.albumUpdates.length,
                cloud: cloudEntries.length,
                removed: merged.stats.remoteRemoved.length
              };
              return cloudReplace(cloudEntries).then(function () {
                return plugin.push({ manifest: JSON.stringify(mergedManifest), mirror: !!status.mirror });
              });
            });
          });
        });
      })
      .then(function () {
        // Manifest zapisujemy jako „poprzedni" dopiero po udanym wysłaniu —
        // inaczej zmiany uznane za wysłane przepadłyby przy błędzie sieci.
        return statePut({ id: 'manifest', value: mergedManifest });
      })
      .then(function () { return statePut({ id: 'counters', value: counters }); })
      .then(function () {
        busy = false;
        setStatus({ lastError: '', lastSyncAt: nowMs() });
        return { counters: counters };
      })
      .catch(function (error) {
        busy = false;
        setStatus({ lastError: message(error) });
        return { error: message(error) };
      });
  }

  // ---------------------------------------------------------------- panel UI

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    var settingsMenu = document.getElementById('settingsMenu');
    if (!settingsMenu) return null;

    var pane = settingsMenu.querySelector('.sm-pane[data-pane="cloud"]');
    if (!pane) {
      pane = document.createElement('div');
      pane.className = 'sm-pane';
      pane.setAttribute('data-pane', 'cloud');
      pane.innerHTML =
        '<div class="sm-section-cap">' + escapeHtml(T('title')) + '</div>' +
        '<div class="sm-note" data-cloud="intro"></div>' +
        '<label class="sm-check"><input type="checkbox" data-cloud="enabled"><span>' + escapeHtml(T('enabled')) + '</span></label>' +
        '<label class="sm-check"><input type="checkbox" data-cloud="mirror"><span>' + escapeHtml(T('mirror')) + '</span></label>' +
        '<div class="sm-note" data-cloud="status"></div>' +
        '<div class="sm-btns">' +
        '<button class="sm-btn" data-cloud="signin">' + escapeHtml(T('signIn')) + '</button>' +
        '<button class="sm-btn" data-cloud="sync">' + escapeHtml(T('syncNow')) + '</button>' +
        '<button class="sm-btn" data-cloud="signout">' + escapeHtml(T('signOut')) + '</button>' +
        '</div>' +
        '<div class="sm-section-cap">' + escapeHtml(T('advanced')) + '</div>' +
        '<input class="sm-input" data-cloud="clientId" placeholder="' + escapeHtml(T('clientId')) + '">' +
        '<input class="sm-input" data-cloud="clientSecret" type="password" placeholder="' + escapeHtml(T('clientSecret')) + '">' +
        '<input class="sm-input" data-cloud="redirectUri" placeholder="' + escapeHtml(T('redirectUri')) + '">' +
        '<div class="sm-btns"><button class="sm-btn" data-cloud="save">' + escapeHtml(T('save')) + '</button></div>' +
        '<div class="sm-note" data-cloud="help"></div>';
      settingsMenu.appendChild(pane);

      var tabs = settingsMenu.querySelector('.sm-tabs') ||
        (settingsMenu.querySelector('.sm-tab') ? settingsMenu.querySelector('.sm-tab').parentNode : null);
      var tab = document.createElement('button');
      tab.className = 'sm-tab';
      tab.setAttribute('data-pane', 'cloud');
      tab.textContent = T('tab');
      if (tabs) tabs.appendChild(tab);
      tab.addEventListener('click', function () {
        if (typeof window.smShowPane === 'function') window.smShowPane('cloud');
      });
      wirePanel(pane);
    }

    panel = pane;
    var intro = pane.querySelector('[data-cloud="intro"]');
    if (intro) intro.textContent = T('intro') + ' ' + T('neverDeletes');
    var help = pane.querySelector('[data-cloud="help"]');
    if (help) help.textContent = T('help');
    var redirect = pane.querySelector('[data-cloud="redirectUri"]');
    if (redirect && !redirect.value) redirect.value = 'pl.ursusel.pulsar.android:/oauth2redirect';
    return pane;
  }

  function wirePanel(pane) {
    function find(name) { return pane.querySelector('[data-cloud="' + name + '"]'); }
    function field(name) { var element = find(name); return element ? String(element.value || '').trim() : ''; }

    var enabled = find('enabled');
    if (enabled) enabled.addEventListener('change', function () {
      settings.enabled = !!enabled.checked;
      saveSettings();
      if (settings.enabled) runSync().catch(function () {});
    });

    var mirror = find('mirror');
    if (mirror) mirror.addEventListener('change', function () {
      status.mirror = !!mirror.checked;
      var api = pluginApi();
      if (api && api.setMirror) api.setMirror({ enabled: status.mirror }).catch(function () {});
    });

    var signin = find('signin');
    if (signin) signin.addEventListener('click', function () {
      var api = pluginApi();
      if (!api) return;
      api.signIn().then(refreshStatus).then(function () {
        if (status.signedIn) return runSync();
        return null;
      }).catch(function (error) { setStatus({ lastError: message(error) }); });
    });

    var signout = find('signout');
    if (signout) signout.addEventListener('click', function () {
      var api = pluginApi();
      if (api) api.signOut().then(refreshStatus).catch(function () {});
    });

    var sync = find('sync');
    if (sync) sync.addEventListener('click', function () { runSync().catch(function () {}); });

    var save = find('save');
    if (save) save.addEventListener('click', function () {
      var api = pluginApi();
      if (!api || !api.configure) return;
      api.configure({ clientId: field('clientId'), clientSecret: field('clientSecret'), redirectUri: field('redirectUri') })
        .then(refreshStatus)
        .catch(function (error) { setStatus({ lastError: message(error) }); });
    });
  }

  function renderPanelStatus() {
    var pane = ensurePanel();
    if (!pane) return;
    var box = pane.querySelector('[data-cloud="status"]');
    if (box) {
      var lines = [];
      if (!status.configured) lines.push(T('notConfigured'));
      else if (!status.signedIn) lines.push(T('signedOut'));
      else lines.push(T('signedInAs') + (status.email || 'Google'));
      lines.push(T('lastSync') + (status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : T('never')));
      if (counters.sent || counters.received || counters.cloud || counters.removed) {
        lines.push(T('sent') + counters.sent + ' · ' + T('received') + counters.received);
        if (counters.cloud) lines.push(T('inCloud') + counters.cloud);
        if (counters.removed) lines.push(T('removedElsewhere') + counters.removed);
      }
      if (busy) lines.push(T('syncing'));
      if (status.lastError) lines.push(T('error') + status.lastError);
      box.textContent = lines.join('\n');
    }
    var enabled = pane.querySelector('[data-cloud="enabled"]');
    if (enabled) enabled.checked = !!settings.enabled;
    var mirror = pane.querySelector('[data-cloud="mirror"]');
    if (mirror) mirror.checked = !!status.mirror;
  }

  // --------------------------------------------------------------- rozruch

  function start() {
    plugin = pluginApi();
    if (!plugin) return;
    loadSettings();
    ensurePanel();
    refreshStatus();
    deviceInfo().catch(function () {});
    stateGet('counters').then(function (stored) {
      if (stored && stored.value) {
        counters = Object.assign(counters, stored.value);
        renderPanelStatus();
      }
    }).catch(function () {});

    if (!listenersReady) {
      listenersReady = true;
      document.addEventListener('pulsar:library', function () { scheduleSync(20000); });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleSync(5000); });
      var settingsBtn = document.getElementById('settingsBtn');
      if (settingsBtn) settingsBtn.addEventListener('click', function () { setTimeout(renderPanelStatus, 60); });
      if (plugin.addListener) {
        plugin.addListener('driveAuth', function () {
          refreshStatus().then(function () { if (status.signedIn && settings.enabled) return runSync(); return null; });
        });
      }
    }

    if (settings.enabled) setTimeout(function () { runSync().catch(function () {}); }, 6000);
    else renderPanelStatus();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(start, 400);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 400); });

  // API dla konsoli i testów offline.
  window.__pulsarDrive = {
    sync: runSync,
    status: refreshStatus,
    settings: settings,
    counters: function () { return counters; },
    _pure: {
      trackKey: trackKey,
      albumKey: albumKey,
      metadataOf: metadataOf,
      buildManifest: buildManifest,
      mergeManifests: mergeManifests,
      buildApplyPlan: buildApplyPlan,
      cloudOnlyOf: cloudOnlyOf,
      hash: hash
    }
  };
})();

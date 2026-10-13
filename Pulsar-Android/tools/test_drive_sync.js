/**
 * Offline checks for the Google Drive sync (Pulsar-Android/drive-sync.js).
 *
 *   node Pulsar-Android/tools/test_drive_sync.js
 *
 * No device, no Google account and no network are involved: the script loads
 * drive-sync.js in a VM with a fake Capacitor plugin (in-memory Drive), a fake
 * library runtime and a fake IndexedDB. It checks the parts that would be
 * expensive to discover on a phone: that only metadata leaves the device, how
 * two devices merge, and that deletions never delete audio without asking.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { makeSettingsDom, makeDocument } = require('./fake_dom.js');

const SOURCE = path.join(__dirname, '..', 'drive-sync.js');
const HOOKS = path.join(__dirname, 'cloud_sync_hooks.js');

// ------------------------------------------------------------------ fake IDB

function makeIndexedDb() {
  const stores = new Map();
  function area(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }
  // Requests resolve on a timer, exactly like the real IndexedDB: the engine
  // attaches onsuccess/onerror after the call returns.
  function deliver(request) {
    setTimeout(() => { if (request.onsuccess) request.onsuccess(); }, 0);
    return request;
  }
  function makeStore(storeName) {
    return {
      get(key) { return deliver({ result: area(storeName).get(key) }); },
      put(value) { area(storeName).set(value.id, value); return deliver({ result: true }); },
      getAll() { return deliver({ result: Array.from(area(storeName).values()) }); },
      clear() { area(storeName).clear(); return deliver({ result: true }); },
    };
  }
  let upgradeDone = false;
  return {
    open() {
      const request = { result: null };
      setTimeout(() => {
        request.result = {
          objectStoreNames: { contains: (name) => stores.has(name) },
          createObjectStore: (name) => { stores.set(name, new Map()); },
          transaction: (_name, _mode) => ({ objectStore: (store) => makeStore(store) }),
        };
        if (request.onupgradeneeded && !upgradeDone) { upgradeDone = true; request.onupgradeneeded(); }
        if (request.onsuccess) request.onsuccess();
      }, 0);
      return request;
    },
  };
}

// ------------------------------------------------------- fake biblioteka runtime

function makeLibrary(tracks, albums) {
  const state = { tracks: tracks, albums: albums };
  return {
    state,
    snapshot() {
      return {
        tracks: state.tracks.map((track) => ({
          key: track.netId || ('fp:' + track.size + ':' + track.hash),
          title: track.title,
          artist: track.artist,
          album: track.album || '',
          year: track.year || '',
          provider: track.netId ? track.netId.split(':')[0] : '',
          ytId: track.netId && track.netId.startsWith('youtube:') ? track.netId.slice(8) : '',
          durMs: track.durMs || 0,
          fav: !!track.fav,
          plays: track.plays || 0,
          lastPlay: track.lastPlay || 0,
        })),
        albums: state.albums.map((album) => ({
          key: album.key,
          name: album.name,
          cover: '',
          createdAt: album.createdAt || 0,
          trackKeys: album.trackKeys || [],
        })),
      };
    },
    apply(plan) {
      const applied = { tracks: 0, albums: 0 };
      plan.trackUpdates.forEach((update) => {
        const key = update.key;
        const target = state.tracks.find((track) => (track.netId || ('fp:' + track.size + ':' + track.hash)) === key);
        if (!target) return;
        Object.assign(target, update.fields);
        applied.tracks++;
      });
      plan.newAlbums.forEach((album) => {
        state.albums.push({ key: album.key, name: album.name, trackKeys: album.trackKeys });
        applied.albums++;
      });
      plan.albumUpdates.forEach((update) => {
        const album = state.albums.find((entry) => entry.key === update.key);
        if (!album) return;
        album.trackKeys = update.trackKeys;
        applied.albums++;
      });
      return applied;
    },
  };
}

// ------------------------------------------------------------- fake Drive

function makeDrive() {
  return { files: new Map(), pushes: 0 };
}

/**
 * Fałszywy folder na Dysku: to samo miejsce widziane przez oba urządzenia.
 * Odpowiada natywnemu PulsarFolderPlugin (systemowe okno Dokumentów).
 */
function makeFolder(drive) {
  const api = {
    _picked: false,
    _label: '',
    _files: drive.files,
    status() {
      return Promise.resolve({
        picked: api._picked,
        label: api._label,
        file: 'pulsar-library.json',
        fileReady: api._files.has('folder'),
        lastError: '',
      });
    },
    pickFolder() {
      api._picked = true;
      api._label = 'Pulsar (Dysk Google)';
      return api.status();
    },
    forget() {
      api._picked = false;
      api._label = '';
      return Promise.resolve({ picked: false, label: '', lastError: '' });
    },
    read() {
      return Promise.resolve({ manifest: api._files.get('folder') || null, modifiedTime: Date.now() });
    },
    write(payload) {
      if (!api._picked) return Promise.reject(new Error('Nie wskazano folderu.'));
      api._files.set('folder', payload.manifest);
      return Promise.resolve({ modifiedTime: Date.now() });
    },
  };
  return api;
}

function makePlugin(drive) {
  return {
    _configured: { clientId: '', clientSecret: '' },
    _signedIn: false,
    _status: null,
    configure(config) {
      this._configured = config;
      return Promise.resolve(this.statusNow());
    },
    statusNow() {
      return {
        configured: !!(this._configured.clientId && this._configured.clientSecret),
        signedIn: this._signedIn,
        email: this._signedIn ? 'user@gmail.com' : '',
        lastSyncAt: 0,
        lastError: '',
        mirror: true,
      };
    },
    status() { return Promise.resolve(this.statusNow()); },
    signIn() { this._signedIn = true; return Promise.resolve(this.statusNow()); },
    signOut() { this._signedIn = false; return Promise.resolve(this.statusNow()); },
    setMirror() { return Promise.resolve(this.statusNow()); },
    addListener() { return Promise.resolve({}); },
    pull() {
      const value = drive.files.get('appdata') || null;
      return Promise.resolve(value ? { manifest: value, modifiedTime: 't', version: '1' } : { manifest: null });
    },
    push(payload) {
      drive.pushes++;
      drive.files.set('appdata', payload.manifest);
      if (payload.mirror) drive.files.set('mirror', payload.manifest);
      return Promise.resolve({ modifiedTime: 't', version: '2', mirrored: !!payload.mirror });
    },
  };
}

// ------------------------------------------------------------------ środowisko

function makeEnv(options) {
  const drive = options.drive || makeDrive();
  const plugin = makePlugin(drive);
  plugin._configured = options.config || { clientId: 'id', clientSecret: 'secret' };
  plugin._signedIn = !!options.signedIn;
  if (options.seed) drive.files.set('appdata', JSON.stringify(options.seed));
  const folder = makeFolder(drive);
  folder._picked = !!options.folderPicked;
  if (options.seed) drive.files.set('folder', JSON.stringify(options.seed));

  const library = makeLibrary(options.tracks || [], options.albums || []);

  // Bez `withPanel` testy działają bez DOM-u (logika scalania); z `withPanel`
  // podstawiamy strukturę ustawień runtime'u, żeby sprawdzić sam panel.
  const settingsDom = options.withPanel ? makeSettingsDom() : null;
  const document = settingsDom ? Object.assign(makeDocument(settingsDom), { hidden: false }) : {
    readyState: 'complete',
    hidden: false,
    body: { contains: () => false },
    documentElement: { classList: { contains: () => false, add() {} } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    dispatchEvent() {},
    createElement: () => ({ style: {}, addEventListener() {}, setAttribute() {}, appendChild() {}, classList: { add() {} } }),
  };
  document.documentElement = { classList: { contains: () => false, add() {} } };
  document.hidden = false;

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Number,
    String,
    Object,
    Array,
    isFinite,
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A) AppleWebKit/537.36' },
    Event: class Event { constructor(type) { this.type = type; } },
    localStorage: {
      _data: Object.assign({}, options.storage || {}),
      getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
      setItem(key, value) { this._data[key] = String(value); },
    },
    indexedDB: makeIndexedDb(),
    location: { href: 'https://localhost/' },
    File: class File {},
  };
  const docListeners = {};
  if (settingsDom) {
    document.addEventListener = (type, handler) => {
      (docListeners[type] = docListeners[type] || []).push(handler);
    };
    document.dispatchEvent = (event) => {
      (docListeners[event.type] || []).forEach((handler) => handler(event));
      return true;
    };
  }
  const pluginTable = {};
  if (options.withDrive !== false) pluginTable.PulsarDrive = plugin;
  if (options.withFolder !== false) pluginTable.PulsarFolder = folder;

  const toasts = [];
  sandbox.window = {
    Capacitor: { Plugins: pluginTable },
    __pulsarHost: { toast: (text) => toasts.push(String(text)) },
    __pulsarSyncSnapshot: library.snapshot,
    __pulsarSyncApply: library.apply,
    addEventListener() {},
  };
  sandbox.document = document;
  sandbox.window.document = document;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.indexedDB = sandbox.indexedDB;
  sandbox.window.setTimeout = setTimeout;
  sandbox.window.clearTimeout = clearTimeout;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), sandbox, { filename: 'drive-sync.js' });
  return {
    api: sandbox.window.__pulsarDrive, drive, plugin, folder, library, plugins: pluginTable,
    storage: sandbox.localStorage, dom: settingsDom, document, toasts,
    fireDocumentEvent(type) { (docListeners[type] || []).forEach((handler) => handler({ type })); },
  };
}

// -------------------------------------------------------------------- testy

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '   [' + extra + ']' : ''));
}

function containsAudioLike(value, depth) {
  if (depth > 8 || value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 400 || /^data:audio/.test(value) || /\.mp3$/i.test(value);
  if (Array.isArray(value)) return value.some((entry) => containsAudioLike(entry, depth + 1));
  if (typeof value === 'object') return Object.keys(value).some((key) => containsAudioLike(value[key], depth + 1));
  return false;
}

(async () => {
  const track = (over) => Object.assign({
    netId: 'youtube:dQw4w9WgXcQ', title: 'Giants', artist: 'Imagine Dragons',
    durMs: 200000, fav: false, plays: 3,
  }, over);

  { // 1. manifest zawiera tylko metadane — bez audio, bez ścieżek
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true, tracks: [track({})] });
    env.api.setMode('google');
    env.api.setEnabled(true);
    await env.api.sync();
    const manifest = JSON.parse(env.drive.files.get('appdata'));
    check('manifest holds no audio payload', !containsAudioLike(manifest, 0), 'bytes=' + JSON.stringify(manifest).length);
    check('manifest keeps the cross-device key', manifest.tracks[0].key === 'youtube:dQw4w9WgXcQ', manifest.tracks[0].key);
    check('local file paths are never uploaded', !/(srcPath|folder|blob)/.test(env.drive.files.get('appdata')));
    check('readable mirror is written too', !!env.drive.files.get('mirror'));
  }

  { // 2. drugie urządzenie dostaje pozycję z chmury i scalone polubienie
    const first = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true, tracks: [track({ fav: true, plays: 9 })] });
    first.api.setMode('google');
    first.api.setEnabled(true);
    await first.api.sync();

    const second = makeEnv({
      config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true,
      tracks: [track({ fav: false, plays: 1 })],
      drive: first.drive,
    });
    second.api.setMode('google');
    second.api.setEnabled(true);
    const outcome = await second.api.sync();
    check('second device pulls the newer favourite', second.library.state.tracks[0].fav === true, JSON.stringify(outcome.counters || outcome));
    check('play counts merge upwards', second.library.state.tracks[0].plays === 9, String(second.library.state.tracks[0].plays));
  }

  { // 3. pozycja istniejąca tylko w chmurze trafia na listę, ale nie tworzy pustego utworu
    const remote = {
      schema: 1, app: 'pulsar', updatedAt: Date.now(), device: { id: 'other' },
      devices: [{ id: 'other' }],
      tracks: [{ key: 'youtube:aaaaaaaaaaa', title: 'Only remote', artist: 'X', updatedAt: Date.now(), fingerprint: 'f' }],
      albums: [], removed: [],
    };
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true, tracks: [], seed: remote });
    env.api.setMode('google');
    env.api.setEnabled(true);
    await env.api.sync();
    const counters = env.api.counters();
    check('cloud-only track is counted, not materialised', counters.cloud === 1 && env.library.state.tracks.length === 0,
      'cloud=' + counters.cloud + ' local=' + env.library.state.tracks.length);
  }

  { // 4. kasowanie na innym urządzeniu nie kasuje pliku, ale jest raportowane
    const local = track({});
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true, tracks: [local] });
    env.api.setMode('google');
    env.api.setEnabled(true);
    await env.api.sync();
    const manifest = JSON.parse(env.drive.files.get('appdata'));
    manifest.removed = [{ key: 'youtube:dQw4w9WgXcQ', deletedAt: Date.now() + 1000, device: 'other-device' }];
    env.drive.files.set('appdata', JSON.stringify(manifest));
    const outcome = await env.api.sync();
    check('remote deletion never removes the local file', env.library.state.tracks.length === 1);
    check('remote deletion is reported in the panel', outcome.counters && outcome.counters.removed === 1,
      'removed=' + (outcome.counters ? outcome.counters.removed : 'n/a'));
  }

  { // 5. albumy: nowy album z chmury powstaje lokalnie po dopasowaniu kluczy
    const remote = {
      schema: 1, app: 'pulsar', updatedAt: Date.now(), device: { id: 'other' }, devices: [{ id: 'other' }],
      tracks: [{ key: 'youtube:dQw4w9WgXcQ', title: 'Giants', artist: 'Imagine Dragons', updatedAt: Date.now(), fingerprint: 'x' }],
      albums: [{ key: 'al:abc', name: 'Evolve', trackKeys: ['youtube:dQw4w9WgXcQ', 'youtube:missingaaaa'], updatedAt: Date.now(), fingerprint: 'a' }],
      removed: [],
    };
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true, tracks: [track({})], seed: remote });
    env.api.setMode('google');
    env.api.setEnabled(true);
    await env.api.sync();
    const album = env.library.state.albums[0];
    check('album from the cloud lands locally', !!album && album.name === 'Evolve', JSON.stringify(env.library.state.albums));
  }

  { // 6. usunięcie lokalne wysyła znacznik kasowania i nie wraca z chmury
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true, tracks: [track({})] });
    env.api.setMode('google');
    env.api.setEnabled(true);
    await env.api.sync();
    env.library.state.tracks.length = 0; // użytkownik usuwa utwór na tym urządzeniu
    await env.api.sync();
    const afterRemoval = JSON.parse(env.drive.files.get('appdata'));
    check('local deletion becomes a tombstone', (afterRemoval.removed || []).some((entry) => entry.key === 'youtube:dQw4w9WgXcQ'),
      JSON.stringify(afterRemoval.removed));
    check('tombstoned track is no longer uploaded', (afterRemoval.tracks || []).length === 0, String((afterRemoval.tracks || []).length));
  }

  { // 7. brak logowania: nic nie leci do Drive, tylko komunikat
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: false, tracks: [track({})] });
    env.api.setMode('google');
    env.api.setEnabled(true);
    const outcome = await env.api.sync();
    check('signed-out sync uploads nothing', env.drive.pushes === 0 && /zalogow|sign in/i.test(outcome.error || ''),
      'pushes=' + env.drive.pushes + ' error=' + (outcome.error || ''));
  }

  { // 8. wyłączona synchronizacja nie robi nic
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true, tracks: [track({})] });
    const outcome = await env.api.sync();
    check('disabled sync stays offline', env.drive.pushes === 0 && outcome.skipped === 'disabled', JSON.stringify(outcome));
  }

  { // 9. błąd sieci nie gubi zmian: następny cykl wysyła ten sam stan
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true, tracks: [track({})] });
    env.api.setMode('google');
    env.api.setEnabled(true);
    await env.api.sync();
    const first = JSON.parse(env.drive.files.get('appdata'));
    const realPush = env.plugin.push.bind(env.plugin);
    env.plugin.push = () => Promise.reject(new Error('brak sieci'));
    env.library.state.tracks[0].fav = true;
    const failed = await env.api.sync();
    check('failed push is reported', !!failed.error, String(failed.error));
    env.plugin.push = realPush;
    await env.api.sync();
    const second = JSON.parse(env.drive.files.get('appdata'));
    check('retry still carries the local change', second.tracks[0].fav === true && first.tracks[0].fav === false,
      'before=' + first.tracks[0].fav + ' after=' + second.tracks[0].fav);
  }

  { // 10. scalanie czystych funkcji: ostatnia zmiana wygrywa, remis rozstrzyga urządzenie
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true });
    const pure = env.api._pure;
    const local = {
      schema: 1, device: { id: 'aaa' }, devices: [{ id: 'aaa' }],
      tracks: [{ key: 'k', title: 'stary', updatedAt: 1000, fingerprint: 'A', device: 'aaa' }], albums: [], removed: [],
    };
    const remoteManifest = {
      schema: 1, device: { id: 'bbb' }, devices: [{ id: 'bbb' }],
      tracks: [{ key: 'k', title: 'nowy', updatedAt: 2000, fingerprint: 'B', device: 'bbb' }], albums: [], removed: [],
    };
    const merged = pure.mergeManifests(local, remoteManifest);
    check('newer change wins', merged.merged.tracks[0].title === 'nowy', merged.merged.tracks[0].title);
    check('incoming list only carries real changes', merged.incoming.tracks.length === 1, String(merged.incoming.tracks.length));

    const tie = pure.mergeManifests(local, {
      schema: 1, device: { id: 'bbb' }, devices: [{ id: 'bbb' }],
      tracks: [{ key: 'k', title: 'ten sam czas', updatedAt: 1000, fingerprint: 'C', device: 'bbb' }], albums: [], removed: [],
    });
    check('ties are deterministic', tie.merged.tracks[0].title === 'ten sam czas', tie.merged.tracks[0].title);

    const buried = pure.mergeManifests(local, {
      schema: 1, device: { id: 'bbb' }, devices: [{ id: 'bbb' }],
      tracks: [{ key: 'k', title: 'wskrzeszony', updatedAt: 1000, fingerprint: 'A', device: 'bbb' }],
      albums: [], removed: [{ key: 'k', deletedAt: 5000, device: 'bbb' }],
    });
    check('a newer deletion outranks the entry', buried.merged.tracks.length === 0, JSON.stringify(buried.merged.tracks));
  }

  { // 11. klucz utworu nie zależy od lokalnego UUID ani ścieżki
    const env = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true });
    const pure = env.api._pure;
    const a = pure.trackKey({ netId: 'youtube:abcdefghijk' });
    const b = pure.trackKey({ file: { name: 'Giants.mp3', size: 4096 } });
    const c = pure.trackKey({ file: { name: 'giants.mp3', size: 4096 } });
    check('network tracks key off the video id', a === 'youtube:abcdefghijk', a);
    check('local files key off name+size, case-insensitive', b === c && b.indexOf('fp:4096:') === 0, b + ' / ' + c);
  }

// ------------------------------------------- prawdziwe hooki runtime (snapshot/apply)

function makeHooksEnv(libraryState) {
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Number,
    String,
    Object,
    Array,
    Promise,
    CustomEvent: class CustomEvent { constructor(type, detail) { this.type = type; this.detail = detail; } },
    document: { dispatchEvent() {} },
    tracks: libraryState.tracks,
    albums: libraryState.albums,
    persistTrack(track) { track.__persisted = (track.__persisted || 0) + 1; return Promise.resolve(); },
    persistAlbum(album) { album.__persisted = (album.__persisted || 0) + 1; return Promise.resolve(); },
    makeId: () => 'local-' + Math.random().toString(16).slice(2),
    renderLibrary() {},
    renderAlbumDetail() {},
    buildAlbumCover: async () => null,
    activeAlbumId: null,
    rebuildQueue() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(HOOKS, 'utf8'), sandbox, { filename: 'cloud_sync_hooks.js' });
  return sandbox;
}

async function checkRuntimeHooks() {
  const file = { name: 'Giants.mp3', size: 4096, type: 'audio/mpeg' };
  const cover = { size: 999, type: 'image/png' };
  const libraryState = {
    tracks: [
      { id: 't1', file, coverBlob: cover, folder: 'Muzyka', srcPath: '/storage/emulated/0/Muzyka/Giants.mp3',
        netId: 'youtube:dQw4w9WgXcQ', title: 'Giants', artist: 'Imagine Dragons', album: 'Evolve', year: '2017',
        fav: true, plays: 7, durMs: 200000 },
      { id: 't2', file: { name: 'Local.mp3', size: 8192 }, folder: 'Muzyka', title: 'Local', artist: 'X', fav: false, plays: 1 },
    ],
    albums: [
      { id: 'a1', name: 'Evolve', trackIds: ['t1'], coverBlob: cover, customCover: true, createdAt: 111 },
      { id: 'a2', name: 'Pusty', trackIds: [], createdAt: 222 },
    ],
  };
  const hooks = makeHooksEnv(libraryState);

  const snapshot = hooks.window.__pulsarSyncSnapshot();
  check('snapshot exposes no blobs or paths', !/(blob|file|srcPath|folder)/i.test(JSON.stringify(snapshot)),
    JSON.stringify(snapshot).slice(0, 120));
  check('snapshot keys YouTube tracks by video id', snapshot.tracks[0].key === 'youtube:dQw4w9WgXcQ', snapshot.tracks[0].key);
  check('snapshot keys local files by fingerprint', /^fp:8192:/.test(snapshot.tracks[1].key), snapshot.tracks[1].key);
  check('album membership is expressed as track keys',
    JSON.stringify(snapshot.albums[0].trackKeys) === JSON.stringify(['youtube:dQw4w9WgXcQ']),
    JSON.stringify(snapshot.albums.map((album) => album.trackKeys)));

  const plan = {
    trackUpdates: [{ key: 'youtube:dQw4w9WgXcQ', fields: { fav: false, plays: 12, album: '' } }],
    albumUpdates: [{ key: snapshot.albums[0].key, trackKeys: ['youtube:dQw4w9WgXcQ', 'fp:8192:' + snapshot.tracks[1].key.split(':')[2]] }],
    newAlbums: [
      { key: 'al:nowy', name: 'Z chmury', trackKeys: ['fp:8192:' + snapshot.tracks[1].key.split(':')[2], 'youtube:nieistnieje'], createdAt: 999 },
      { key: 'al:pusty', name: 'Same obce', trackKeys: ['youtube:nieistnieje'] },
    ],
  };
  const applied = await hooks.window.__pulsarSyncApply(plan);
  const track1 = libraryState.tracks[0];
  check('metadata updates are applied', track1.fav === false && track1.plays === 12, JSON.stringify({ fav: track1.fav, plays: track1.plays }));
  check('audio file object is untouched', track1.file === file && track1.coverBlob === cover);
  check('local paths are never rewritten', track1.srcPath === '/storage/emulated/0/Muzyka/Giants.mp3');
  check('album membership maps keys to local ids', JSON.stringify(libraryState.albums[0].trackIds) === JSON.stringify(['t1', 't2']),
    JSON.stringify(libraryState.albums[0].trackIds));
  check('album membership drops keys unknown here', libraryState.albums[0].trackIds.indexOf('youtube:missingaaaa') === -1);
  const created = libraryState.albums.find((album) => album.name === 'Z chmury');
  check('new album keeps only tracks that exist here', !!created && created.trackIds.length === 1 && created.trackIds[0] === 't2',
    JSON.stringify(created && created.trackIds));
  check('album made only of foreign tracks is skipped', !libraryState.albums.some((album) => album.name === 'Same obce'));
  check('applied counter reflects the work', applied.tracks === 1 && applied.albums === 2,
    JSON.stringify(applied) + ' (membership from the cloud + one new album)');
}

  { // 12. pierwsza synchronizacja obu urządzeń nie może zależeć od szczęścia zegara
    const environment = makeEnv({ config: { clientId: 'id', clientSecret: 'secret' }, signedIn: true });
    const pure = environment.api._pure;
    const deviceA = { id: 'device-a', name: 'Telefon', platform: 'android' };
    const deviceB = { id: 'device-b', name: 'Tablet', platform: 'android' };
    const phone = pure.buildManifest({ tracks: [{ key: 'youtube:x', title: 'Giants', artist: '', fav: true, plays: 9 }], albums: [] }, null, deviceA);
    const tablet = pure.buildManifest({ tracks: [{ key: 'youtube:x', title: 'Giants', artist: 'Imagine Dragons', fav: false, plays: 1 }], albums: [] }, null, deviceB);
    const tabletMerged = pure.mergeManifests(tablet, phone).merged.tracks[0];
    const phoneMerged = pure.mergeManifests(phone, tablet).merged.tracks[0];
    check('first sync keeps the favourite from either side', tabletMerged.fav === true && phoneMerged.fav === true,
      JSON.stringify({ tablet: tabletMerged.fav, phone: phoneMerged.fav }));
    check('first sync fills in missing text on both sides',
      tabletMerged.artist === 'Imagine Dragons' && phoneMerged.artist === 'Imagine Dragons',
      JSON.stringify({ tablet: tabletMerged.artist, phone: phoneMerged.artist }));
    check('first sync takes the higher play count', tabletMerged.plays === 9 && phoneMerged.plays === 9,
      JSON.stringify({ tablet: tabletMerged.plays, phone: phoneMerged.plays }));

    const manifestOf = (device, record) => ({
      schema: 1, app: 'pulsar', device: device, devices: [device], tracks: [record], albums: [], removed: [],
    });

    // Scalanie musi być idempotentne: powtórka nie może wiecznie wyglądać jak zmiana.
    const twice = pure.mergeManifests(manifestOf(deviceB, tabletMerged), manifestOf(deviceA, phoneMerged)).merged.tracks[0];
    check('merging again is a no-op', twice.fingerprint === phoneMerged.fingerprint && twice.plays === 9,
      JSON.stringify({ sameFingerprint: twice.fingerprint === phoneMerged.fingerprint, plays: twice.plays }));

    // Odznaczenie polubienia na urządzeniu z nowszą zmianą ma się propagować.
    const older = Object.assign({}, phoneMerged, { fav: true, updatedAt: 1000 });
    const newerUnfav = Object.assign({}, phoneMerged, { fav: false, updatedAt: 2000 });
    const unFav = pure.mergeManifests(manifestOf(deviceA, older), manifestOf(deviceB, newerUnfav));
    const reverseUnFav = pure.mergeManifests(manifestOf(deviceB, newerUnfav), manifestOf(deviceA, older));
    check('un-favouriting wins when it is the newer change',
      unFav.merged.tracks[0].fav === false && reverseUnFav.merged.tracks[0].fav === false,
      JSON.stringify({ a: unFav.merged.tracks[0].fav, b: reverseUnFav.merged.tracks[0].fav }));
  }

  { // 13. domyślnie tryb folderu: działa bez Client ID, bez logowania i bez pluginu Drive
    const env = makeEnv({ withDrive: false, folderPicked: true, tracks: [track({})] });
    check('folder mode is the default', env.api.mode() === 'folder', env.api.mode());
    env.api.setEnabled(true);
    const outcome = await env.api.sync();
    const written = env.drive.files.get('folder');
    check('folder sync works with no Google setup', !!written && !outcome.error, outcome.error || 'ok');
    check('folder sync uploads no audio', written && !containsAudioLike(JSON.parse(written), 0));
    check('folder sync keeps the cross-device key', written && JSON.parse(written).tracks[0].key === 'youtube:dQw4w9WgXcQ');
    check('panel sees the folder as ready after a sync', env.api.state().folderReady === true);
  }

  { // 14. drugie urządzenie wskazuje ten sam folder i dostaje scaloną bibliotekę
    const first = makeEnv({ withDrive: false, folderPicked: true, tracks: [track({ fav: true, plays: 9 })] });
    first.api.setEnabled(true);
    await first.api.sync();

    const second = makeEnv({
      withDrive: false, folderPicked: true, drive: first.drive,
      tracks: [track({ fav: false, plays: 1 })],
    });
    second.api.setEnabled(true);
    const outcome = await second.api.sync();
    check('second device syncs through the same folder',
      second.library.state.tracks[0].fav === true && second.library.state.tracks[0].plays === 9,
      JSON.stringify(outcome.counters || outcome));
  }

  { // 15. bez wskazanego folderu nic nie leci na Dysk, tylko komunikat
    const env = makeEnv({ withDrive: false, tracks: [track({})] });
    env.api.setEnabled(true);
    const outcome = await env.api.sync();
    check('folder mode without a folder refuses to write',
      !env.drive.files.has('folder') && /folder/i.test(outcome.error || ''),
      'error=' + (outcome.error || 'brak') + ' plik=' + env.drive.files.has('folder'));
    check('folder status is surfaced to the panel', env.api.state().folderReady === false);
  }

  { // 16. wybór folderu jest zapamiętywany i widoczny w stanie
    const env = makeEnv({ withDrive: false, tracks: [track({})] });
    await env.folder.pickFolder();
    await env.api.status();
    check('chosen folder is visible in the panel state',
      env.api.state().folderReady === true && /Pulsar/.test(env.api.state().folderLabel || ''),
      env.api.state().folderLabel);
  }

  { // 17. tryb jest zapamiętywany między uruchomieniami
    const env = makeEnv({ withDrive: true, folderPicked: true, tracks: [track({})] });
    env.api.setMode('google');
    env.api.setEnabled(true);
    const saved = JSON.parse(env.storage.getItem('pulsarCloudSync'));
    check('mode switch is stored', saved.mode === 'google' && saved.enabled === true, JSON.stringify(saved));
    const second = makeEnv({ withDrive: true, tracks: [track({})], storage: { pulsarCloudSync: env.storage.getItem('pulsarCloudSync') } });
    check('mode is read back from storage', second.api.mode() === 'google', second.api.mode());
  }

  { // 18. brak pluginu Google przy trybie google nie wywala synchronizacji w powietrze
    const env = makeEnv({ withDrive: false, folderPicked: true, tracks: [track({})] });
    env.api.setMode('google');
    env.api.setEnabled(true);
    const outcome = await env.api.sync();
    check('missing Google plugin falls back to the folder transport',
      !!env.drive.files.get('folder') && !outcome.error, JSON.stringify(outcome));
  }

  { // 19. panel ląduje tam, gdzie runtime trzyma ustawienia (to była przyczyna „nic nie robi")
    const env = makeEnv({ withDrive: true, withPanel: true, tracks: [track({})] });
    const pane = env.api.openPanel();
    check('pane is created inside #smBody, not loose in the menu',
      !!pane && pane.parentNode === env.dom.smBody, pane && pane.parentNode && (pane.parentNode.getAttribute('id') || '?'));
    const tab = env.dom.nav.querySelector('.sm-tab[data-pane="cloud"]');
    check('tab is added to the runtime nav', !!tab && tab.parentNode === env.dom.nav);
    check('tab is a real button with the runtime class',
      !!tab && tab.getAttribute('type') === 'button' && tab.classList.contains('sm-tab'),
      tab && tab.getAttribute('type'));
    check('pane uses only the runtime pane class', !!pane && pane.classList.contains('sm-pane'));
  }

  { // 20. klik na zakładkę pokazuje panel (wcześniej nie robił nic)
    const env = makeEnv({ withDrive: true, withPanel: true, tracks: [track({})] });
    env.api.openPanel();
    const tab = env.dom.nav.querySelector('.sm-tab[data-pane="cloud"]');
    const pane = env.dom.smBody.querySelector('.sm-pane[data-pane="cloud"]');
    const play = env.dom.smBody.querySelector('.sm-pane[data-pane="play"]');
    check('cloud pane starts hidden', !pane.classList.contains('active'));
    check('another pane starts active', play.classList.contains('active'));
    tab.click();
    check('clicking the tab activates the cloud pane', pane.classList.contains('active'));
    check('clicking the tab deactivates the previous pane', !play.classList.contains('active'));
    check('tab marks itself active and aria-current',
      tab.classList.contains('active') && tab.getAttribute('aria-current') === 'page');
    check('chosen tab is remembered for the next open',
      env.storage.getItem('pulsarSettingsTab') === 'cloud', String(env.storage.getItem('pulsarSettingsTab')));
    check('other tabs are deactivated', env.dom.nav.querySelector('.sm-tab[data-pane="play"]').classList.contains('active') === false);
  }

  { // 21. tryb wybiera się w panelu i wybór obowiązuje od razu
    const env = makeEnv({ withDrive: true, withPanel: true, folderPicked: true, tracks: [track({})] });
    const pane = env.api.openPanel();
    const select = pane.querySelector('[data-cloud="mode"]');
    const folderSection = pane.querySelector('[data-cloud-section="folder"]');
    const googleSection = pane.querySelector('[data-cloud-section="google"]');
    check('panel offers both transports', !!select && select.querySelectorAll('option').length === 2);
    check('folder section is shown in the default mode',
      !folderSection.classList.contains('sm-hide') && googleSection.classList.contains('sm-hide'));
    select.change('google');
    check('switching to Google mode is applied', env.api.mode() === 'google', env.api.mode());
    check('sections swap with the mode',
      folderSection.classList.contains('sm-hide') && !googleSection.classList.contains('sm-hide'));
    check('mode survives a restart', JSON.parse(env.storage.getItem('pulsarCloudSync')).mode === 'google');
  }

  { // 22. żaden tekst panelu nie jest pusty, a zmiana języka go przetłumaczy
    const env = makeEnv({ withDrive: true, withPanel: true, tracks: [track({})] });
    const pane = env.api.openPanel();
    const empty = pane.querySelectorAll('[data-cloud-text]').filter((el) => !el.textContent.trim());
    check('every label in the panel is filled', empty.length === 0,
      empty.map((el) => el.getAttribute('data-cloud-text')).join(',') || 'brak pustych');
    check('input placeholders are set',
      ['clientId', 'clientSecret', 'redirectUri'].every((name) => {
        const input = pane.querySelector('[data-cloud="' + name + '"]');
        return input && input.getAttribute('placeholder');
      }));
    const tab = env.dom.nav.querySelector('.sm-tab[data-pane="cloud"]');
    const polishTab = tab.textContent.trim();
    env.storage.setItem('playerLang', 'en');
    env.fireDocumentEvent('pulsar:lang');
    check('language switch relabels the tab', tab.textContent.trim() !== polishTab && /cloud/i.test(tab.textContent),
      polishTab + ' → ' + tab.textContent.trim());
    check('language switch relabels the pane',
      /Drive folder|Google sign-in|How to sync/i.test(pane.textContent));
  }

  { // 23. klasy CSS panelu muszą istnieć w runtime (inaczej panel wygląda jak goły HTML)
    const htmlPath = path.join(__dirname, '..', 'www', 'index.html');
    if (!fs.existsSync(htmlPath)) {
      check('panel CSS classes exist in the runtime', true, 'pominięte: brak www/index.html');
    } else {
      const html = fs.readFileSync(htmlPath, 'utf8');
      const css = html.slice(0, html.indexOf('</style>'));
      const known = new Set((css.match(/\.sm-[a-z-]+/g) || []).map((entry) => entry.slice(1)).concat(['sm-pane']));
      const env = makeEnv({ withDrive: true, withPanel: true, tracks: [track({})] });
      const pane = env.api.openPanel();
      const tab = env.dom.nav.querySelector('.sm-tab[data-pane="cloud"]');
      const used = new Set();
      pane.querySelectorAll('*').concat([pane, tab]).forEach((element) => {
        element.classList.set.forEach((name) => { if (name.startsWith('sm-')) used.add(name); });
      });
      const unknown = Array.from(used).filter((name) => !known.has(name));
      check('panel CSS classes exist in the runtime', unknown.length === 0,
        unknown.length ? 'nieznane: ' + unknown.join(', ') : Array.from(used).length + ' klas OK');
    }
  }

  { // 24. „Zaloguj się kontem Google" nigdy nie jest cichym klikiem
    const env = makeEnv({ withDrive: true, withPanel: true, tracks: [track({})] });
    const pane = env.api.openPanel();
    const signin = pane.querySelector('[data-cloud="signin"]');
    check('sign-in button exists in the panel', !!signin);
    signin.click();
    const message = env.api.state().lastError || '';
    check('sign-in click explains itself in the status', /wycofa|retired/i.test(message), message.slice(0, 90));
    check('sign-in click also raises a toast', env.toasts.some((text) => /wycofa|retired/i.test(text)),
      JSON.stringify(env.toasts.map((text) => text.slice(0, 40))));
    check('sign-in click does not throw', true);
  }

  { // 25. brakująca warstwa natywna jest nazwana, a nie przemilczana
    const env = makeEnv({ withDrive: false, withPanel: true, tracks: [track({})] });
    const pane = env.api.openPanel();
    pane.querySelector('[data-cloud="signin"]').click();
    check('missing Google layer is reported with its name',
      /PulsarDrive|wycofa|retired/i.test(env.api.state().lastError || ''), String(env.api.state().lastError).slice(0, 80));

    const folder = makeEnv({ withFolder: false, withDrive: true, withPanel: true, tracks: [track({})] });
    const folderPane = folder.api.openPanel();
    folderPane.querySelector('[data-cloud="choose"]').click();
    await wait(30);
    check('missing folder layer is reported with its name',
      /PulsarFolder/.test(folder.api.state().lastError || ''), String(folder.api.state().lastError).slice(0, 90));
    check('the error names the fix (rebuild)', /zbuduj|rebuild/i.test(folder.api.state().lastError || ''));
    const folderStatus = folderPane.querySelector('[data-cloud="status"]').textContent;
    check('the layers line names the missing plugin', /PulsarFolder/.test(folderStatus),
      folderStatus.replace(/\n/g, ' | ').slice(0, 110));
  }

  { // 26. „Synchronizuj teraz" działa przy wyłączonym automacie i zdaje relację
    const env = makeEnv({ withFolder: true, withPanel: true, folderPicked: true, tracks: [track({})] });
    const pane = env.api.openPanel();
    pane.querySelector('[data-cloud="sync"]').click();
    await wait(80);
    check('manual sync writes without the auto toggle', env.drive.files.has('folder'));
    check('manual sync reports the result', env.toasts.some((text) => /zsynchronizowano|synced/i.test(text)),
      JSON.stringify(env.toasts.map((text) => text.slice(0, 50))));
  }

  { // 27. włączenie automatu bez folderu mówi, czego brakuje
    const env = makeEnv({ withFolder: true, withPanel: true, tracks: [track({})] });
    const pane = env.api.openPanel();
    pane.querySelector('[data-cloud="enabled"]').change(true);
    await wait(30);
    check('turning sync on without a folder explains what is missing',
      /folder/i.test(env.api.state().lastError || ''), String(env.api.state().lastError).slice(0, 80));
    check('the explanation is a toast too', env.toasts.some((text) => /folder/i.test(text)));
  }

  { // 28. panel pokazuje, które warstwy ma ta kompilacja
    const env = makeEnv({ withDrive: true, withFolder: true, withPanel: true, tracks: [track({})] });
    const pane = env.api.openPanel();
    env.api.status();
    await wait(20);
    const status = pane.querySelector('[data-cloud="status"]').textContent;
    check('status lists the sync layers of this build',
      /folder ✔/.test(status) && /google ✔/.test(status), status.replace(/\n/g, ' | ').slice(0, 110));
    const firstCard = pane.querySelector('.sm-card');
    check('status sits in the first card, visible without scrolling',
      !!firstCard && firstCard.contains(pane.querySelector('[data-cloud="status"]')) &&
      firstCard.contains(pane.querySelector('[data-cloud="sync"]')));
    check('status comes before the folder and Google cards in the pane',
      pane.children.indexOf(firstCard) === 1, 'index=' + pane.children.indexOf(firstCard));
  }

  await checkRuntimeHooks();
  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('FAIL'));
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})();

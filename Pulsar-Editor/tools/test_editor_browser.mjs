// Test integracyjny gotowej paczki (headless Chromium).
// NODE_PATH=<node_modules> node Pulsar-Editor/tools/test_editor_browser.mjs <rozpakowane-resources>
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const require = createRequire(path.join(process.env.NODE_PATH || process.cwd(), 'x.js'));
const puppeteerModule = require('puppeteer-core');
const chromiumModule = require('@sparticuz/chromium');
const puppeteer = puppeteerModule.default || puppeteerModule;
const chromium = chromiumModule.default || chromiumModule;
const RES = path.resolve(process.argv[2] || process.env.RES_DIR || '');
if (!fs.existsSync(path.join(RES, 'index.html'))) throw new Error('Podaj katalog z rozpakowanym resources.neu');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-editor-browser-'));
const DESKTOP = process.env.EDITOR_DESKTOP === '1';
const DOWNLOADS = path.join(TMP, 'downloads'); fs.mkdirSync(DOWNLOADS);
const NATIVE_DIR = path.join(TMP, 'native'); fs.mkdirSync(NATIVE_DIR);
const NATIVE_OUTPUT = path.join(NATIVE_DIR, 'Test Artist - Test Song (edycja).wav');
const NATIVE_OUTPUT_MP3 = path.join(NATIVE_DIR, 'Test Artist - Test Song (edycja).mp3');
let lastFfmpegCommand = '';
const NEUTRALINO_STUB = String.raw`
(function(){
  var handlers = {};
  function call(op){ var a = Array.prototype.slice.call(arguments, 1); return window.__nfs(op, JSON.stringify(a)).then(function(r){ r = JSON.parse(r); if (r && r.__err) throw new Error(r.__err); return r; }); }
  function b64ToAb(b){ var s = atob(b), u = new Uint8Array(s.length); for (var i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; }
  function abToB64(ab){ var u=new Uint8Array(ab),s=''; for(var i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }
  var noop=function(){return Promise.resolve(null);};
  var ns=function(extra){return new Proxy(extra||{},{get:function(t,k){return k in t?t[k]:noop;}});};
  window.NL_PATH=window.__NL_PATH||''; window.NL_PORT=47329; window.NL_TOKEN='editor.test';
  window.Neutralino={
    init:function(){},
    events:{on:function(e,f){(handlers[e]=handlers[e]||[]).push(f);return Promise.resolve();},off:noop,dispatch:noop,broadcast:noop},
    filesystem:ns({
      getStats:function(p){return call('getStats',p);}, readBinaryFile:function(p){return call('readBinaryFile',p).then(b64ToAb);},
      writeBinaryFile:function(p,b){return call('writeBinaryFile',p,abToB64(b));}, appendBinaryFile:function(p,b){return call('appendBinaryFile',p,abToB64(b));},
      writeFile:function(p,s){return call('writeFile',p,s);}, createDirectory:function(p){return call('createDirectory',p);}, remove:function(p){return call('remove',p);},
      readDirectory:function(p,o){return call('readDirectory',p,o||{});}, createWatcher:function(){return Promise.resolve(1);}, removeWatcher:noop
    }),
    os:ns({execCommand:function(c){return call('execCommand',c);},getEnv:function(){return Promise.resolve(window.__NL_PATH);},showSaveDialog:function(t,o){return call('showSaveDialog',t,o);}}),
    window:ns({getTitle:function(){return Promise.resolve('Pulsar');}}), app:ns({}), storage:ns({})
  };
  window.__nlEmit=function(e,d){(handlers[e]||[]).forEach(function(f){try{f({detail:d});}catch(x){console.error(x);}});};
  document.addEventListener('DOMContentLoaded',function(){setTimeout(function(){window.__nlEmit('ready',{});},50);});
})();`;
let failures = 0;
const dialogMessages = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
  if (!ok) failures++;
}
async function poll(fn, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = await fn();
    if (value) return value;
    await sleep(80);
  }
  return null;
}
function makeWav(file) {
  const sr = 22050, seconds = 6, channels = 2, frames = sr * seconds;
  const dataSize = frames * channels * 2;
  const out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0); out.writeUInt32LE(36 + dataSize, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22); out.writeUInt32LE(sr, 24); out.writeUInt32LE(sr * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / sr;
    const silent = (t >= 1 && t < 2) || (t >= 4 && t < 5);
    const sample = silent ? 0 : Math.round(Math.sin(2 * Math.PI * 220 * t) * 0.18 * 32767);
    out.writeInt16LE(sample, 44 + i * 4); out.writeInt16LE(sample, 46 + i * 4);
  }
  fs.writeFileSync(file, out);
}

const mime = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css', png: 'image/png', wav: 'audio/wav', lrc: 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/neutralino.js') { res.writeHead(200, { 'Content-Type': mime.js }); res.end(DESKTOP ? NEUTRALINO_STUB : ''); return; }
  const file = path.join(RES, pathname);
  if (!file.startsWith(RES + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file).slice(1)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const wavPath = path.join(TMP, 'Test Artist - Test Song.wav');
const lrcPath = path.join(TMP, 'Test Artist - Test Song.lrc');
makeWav(wavPath);
fs.writeFileSync(lrcPath, '[00:01.00] w pierwszej ciszy\n[00:02.50] druga linia\n[00:04.50] w drugiej ciszy\n[00:05.50] ostatnia linia\n');
async function nativeFs(op, argsJson) {
  const args = JSON.parse(argsJson);
  try {
    if (op === 'showSaveDialog') {
      const requested = String(args[1] && args[1].defaultPath || '');
      return JSON.stringify(/\.mp3$/i.test(requested) ? NATIVE_OUTPUT_MP3 : NATIVE_OUTPUT);
    }
    if (op === 'writeBinaryFile') { fs.writeFileSync(args[0], Buffer.from(args[1], 'base64')); return 'null'; }
    if (op === 'appendBinaryFile') { fs.appendFileSync(args[0], Buffer.from(args[1], 'base64')); return 'null'; }
    if (op === 'readBinaryFile') return JSON.stringify(fs.readFileSync(args[0]).toString('base64'));
    if (op === 'writeFile') { fs.writeFileSync(args[0], args[1]); return 'null'; }
    if (op === 'createDirectory') { fs.mkdirSync(args[0], { recursive: true }); return 'null'; }
    if (op === 'remove') { fs.rmSync(args[0], { force: true, recursive: true }); return 'null'; }
    if (op === 'getStats') {
      const stat = fs.statSync(args[0]);
      return JSON.stringify({ size: stat.size, isFile: stat.isFile(), isDirectory: stat.isDirectory(), createdAt: stat.birthtimeMs, modifiedAt: stat.mtimeMs });
    }
    if (op === 'readDirectory') return JSON.stringify(fs.readdirSync(args[0], { withFileTypes: true }).map(entry => ({ entry: entry.name, type: entry.isDirectory() ? 'DIRECTORY' : 'FILE' })));
    if (op === 'execCommand') {
      const command = String(args[0] || '');
      if (command === 'command -v ffmpeg' || command === 'where ffmpeg' || command.includes('command -v ffmpeg')) return JSON.stringify({ stdOut: '/usr/bin/ffmpeg\n', stdErr: '', exitCode: 0 });
      if (command.includes('-hide_banner') && command.includes('-filter_complex')) {
        lastFfmpegCommand = command;
        const match = command.match(/'([^']+)'\s*$/) || command.match(/"([^"]+)"\s*$/);
        if (!match) return JSON.stringify({ stdOut: '', stdErr: 'no output path', exitCode: 1 });
        fs.writeFileSync(match[1], Buffer.from('ID3 simulated FFmpeg output'));
        return JSON.stringify({ stdOut: '', stdErr: '', exitCode: 0 });
      }
      return JSON.stringify({ stdOut: '2026.01.01\n', stdErr: '', exitCode: 0 });
    }
    return JSON.stringify({ __err: 'unknown op ' + op });
  } catch (error) { return JSON.stringify({ __err: String(error.message || error) }); }
}
let browser;
let outputSize = 0;
try {
  const args = chromium.args.filter(arg => arg !== '--mute-audio' && !arg.startsWith('--single-process'))
    .concat(['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files']);
  browser = await puppeteer.launch({ args, executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => { dialogMessages.push(dialog.message()); dialog.accept().catch(() => {}); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) request.abort().catch(() => {});
    else request.continue().catch(() => {});
  });
  await page.evaluateOnNewDocument((desktop, nlPath) => {
    if (desktop) window.__NL_PATH = nlPath;
    if (!sessionStorage.getItem('editorTestInit')) {
      sessionStorage.setItem('editorTestInit', '1');
      localStorage.setItem('playerLang', 'pl');
      localStorage.setItem('playerNetEnrich', '0');
      localStorage.setItem('playerSkipSilence', '0');
      localStorage.setItem('playerNorm', '0');
    }
  }, DESKTOP, TMP);
  if (DESKTOP) await page.exposeFunction('__nfs', nativeFs);
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await page.goto(origin, { waitUntil: 'load' });
  check('moduł i przycisk edytora startują', await poll(() => page.evaluate(() => !!window.PulsarAudioEditor && !!document.getElementById('audioEditorBtn'))));
  check('ustawienia używają klasycznego cogwheela', await page.evaluate(() => {
    const path = document.querySelector('#settingsBtn svg path');
    return !!path && path.getAttribute('d').startsWith('M10.325') && !path.getAttribute('d').includes('M12 2.8v3');
  }));
  check('wspólny moduł karaoke startuje', await page.evaluate(() => !!window.PulsarKaraoke && !!document.getElementById('karaokeBtn')));

  await page.$eval('#folderInput', input => input.removeAttribute('webkitdirectory'));
  const input = await page.$('#folderInput');
  await input.uploadFile(wavPath, lrcPath);
  check('utwór testowy i LRC trafiają do biblioteki', await poll(() => page.evaluate(() => window.__player && __player.state().tracks === 1 && __player.state().currentIndex === 0)));
  await page.click('#audioEditorBtn');
  check('audio zostaje zdekodowane w edytorze', await poll(() => page.evaluate(() => window.PulsarAudioEditor.state().decoded)));

  await page.click('#paeDetect');
  check('wykrywanie ciszy dodaje dwa zakresy', await poll(() => page.evaluate(() => PulsarAudioEditor.state().cuts.length === 2)));
  await page.click('#paeClear');
  const setCut = async (start, end) => {
    await page.evaluate(({ start, end }) => {
      const s = document.getElementById('paeCutStart'), e = document.getElementById('paeCutEnd');
      s.value = String(start); e.value = String(end);
      document.getElementById('paeAddCut').click();
    }, { start, end });
  };
  await setCut(1, 2); await setCut(4, 5);
  check('ręczne cięcia mają dokładne czasy', await page.evaluate(() => JSON.stringify(PulsarAudioEditor.state().cuts) === JSON.stringify([{ start: 1, end: 2 }, { start: 4, end: 5 }])));
  check('podsumowanie pokazuje 4 sekundy wyniku', await page.$eval('#paeFinalDuration', el => el.textContent === '0:04.00'));

  await page.evaluate(() => { document.getElementById('audio').currentTime = 1.2; });
  await page.click('#paePreview');
  check('podgląd przeskakuje usunięty zakres', await poll(() => page.evaluate(() => document.getElementById('audio').currentTime >= 1.99)));
  await page.click('#paePreview');

  await page.$eval('.pae-cut-input', input => { input.value = '1.01'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  check('granica wycinka ma precyzyjne pole 1 ms', await page.evaluate(() => PulsarAudioEditor.state().cuts[0].start === 1.01));
  await page.click('#paeUndo');
  check('cofanie przywraca poprzednią granicę', await page.evaluate(() => PulsarAudioEditor.state().cuts[0].start === 1));
  await page.click('#paeZoomIn');
  check('zoom fali zwiększa widok do 2×', await page.evaluate(() => PulsarAudioEditor.state().zoom === 2));
  await page.$eval('#paeFadeIn', input => { input.value = '120'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#paeJoinFade', input => { input.value = '25'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#paeSilenceMin', input => { input.value = '1.2'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#paeSaveSession');
  const savedSessionKey = await page.evaluate(() => PulsarAudioEditor.state().sessionKey);
  check('sesja zapisuje decyzje bez audio w localStorage', await page.evaluate(key => {
    const raw = localStorage.getItem(key), value = JSON.parse(raw || 'null');
    return !!value && value.cuts.length === 2 && value.fadeInMs === 120 && value.joinFadeMs === 25 && value.silenceMin === 1.2 && raw.length < 2000;
  }, savedSessionKey));
  await page.click('#paeClose');
  await page.click('#audioEditorBtn');
  const resumed = await poll(() => page.evaluate(() => {
    const s = PulsarAudioEditor.state();
    return s.open && s.decoded && s.cuts.length === 2 && s.fadeInMs === 120 && s.joinFadeMs === 25 && s.silenceMin === 1.2 && s.zoom === 2;
  }));
  if (!resumed) console.log('DIAG resumed', await page.evaluate(key => ({ state: PulsarAudioEditor.state(), saved: JSON.parse(localStorage.getItem(key) || 'null'), status: document.getElementById('paeAudioStatus').textContent, hidden: document.getElementById('audioEditor').hidden }), savedSessionKey));
  check('sesja wznawia cięcia, przejścia, ciszę i zoom', !!resumed);
  if (!resumed) throw new Error('Sesja nie wznowiła się — szczegóły DIAG powyżej');

  await page.click('[data-tab="lyrics"]');
  check('lokalne LRC jest widoczne w edytorze', await poll(() => page.evaluate(() => document.querySelectorAll('#paeLyricsPreview .pae-lyric-row').length > 0)));
  await page.$eval('#paeOffsetNumber', el => { el.value = '0.5'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  check('przesunięcie +0,5 s działa w runtime', await page.evaluate(() => __player.__lyrics.offset() === 0.5 && document.getElementById('paeOffsetValue').textContent.includes('0,50')));
  check('przesunięcie jest trwałe w localStorage', await page.evaluate(() => {
    const id = __player.__editor.current().id;
    return localStorage.getItem('playerLyricsOffset:' + id) === '0.5';
  }));

  await page.click('[data-tab="audio"]');
  await page.click('#paeSave');
  check('po zapisie biblioteka zawiera drugi utwór', await poll(() => page.evaluate(() => __player.state().tracks === 2)));
  check('edytor zamyka się po udanym zapisie', await poll(() => page.evaluate(() => !PulsarAudioEditor.state().open)));
  const outputFile = DESKTOP ? NATIVE_OUTPUT : path.join(DOWNLOADS, 'Test Artist - Test Song (edycja).wav');
  check(DESKTOP ? 'Neutralino zapisuje nowy WAV przez natywny dialog' : 'przeglądarka zapisuje nowy WAV', await poll(async () => fs.existsSync(outputFile) && fs.statSync(outputFile).size > 44));
  if (fs.existsSync(outputFile)) {
    const wav = fs.readFileSync(outputFile);
    outputSize = wav.length;
    const sampleRate = wav.readUInt32LE(24);
    check('WAV ma 4 sekundy stereo PCM', wav.readUInt32LE(40) === 4 * sampleRate * 2 * 2, { bytes: wav.length, sampleRate, data: wav.readUInt32LE(40) });
  }

  const record = await page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('ambient-player-library', 2);
    request.onsuccess = () => {
      const get = request.result.transaction('tracks').objectStore('tracks').getAll();
      get.onsuccess = async () => {
        const item = get.result.find(x => /\(edycja\)\.wav$/i.test(x.name));
        resolve(item && { title: item.title, artist: item.artist, durMs: item.durMs, size: item.blob.size, srcPath: item.srcPath, lyrics: item.lyricsData });
      };
    };
  }));
  check('kopia zachowuje metadane i czas trwania', record && record.title === 'Test Song (edycja)' && record.artist === 'Test Artist' && record.durMs === 4000 && record.size === outputSize, record && { title: record.title, durMs: record.durMs, size: record.size });
  if (DESKTOP) check('biblioteka zna natywną ścieżkę zapisanej kopii', record && record.srcPath === NATIVE_OUTPUT, record && record.srcPath);
  check('napisy kopii są przesunięte i dopasowane do cięć', record && JSON.stringify(record.lyrics && record.lyrics.synced) === JSON.stringify([
    { t: 2, txt: 'druga linia' }, { t: 3, txt: 'w drugiej ciszy' }, { t: 4, txt: 'ostatnia linia' }
  ]), record && record.lyrics);

  await page.reload({ waitUntil: 'load' });
  check('biblioteka odtwarza oba utwory po restarcie', await poll(() => page.evaluate(() => window.__player && __player.state().tracks === 2)));
  const indices = await page.evaluate(() => __player.__sound.trackIds().map((id, index) => ({ index, name: __player.__net.trackAt(index).fileName })));
  const editedIndex = indices.find(item => /\(edycja\)\.wav$/i.test(item.name)).index;
  const originalIndex = indices.find(item => !/\(edycja\)\.wav$/i.test(item.name)).index;
  const persisted = await page.evaluate(async (index) => {
    await __player.loadIndex(index);
    const data = await __player.__lyrics.fetchFor(index);
    return { offset: __player.__lyrics.offset(), lines: data && data.synced };
  }, editedIndex);
  check('dopasowane napisy przeżywają restart, bez podwójnego offsetu', persisted && persisted.offset === 0 && persisted.lines && persisted.lines.length === 3 && persisted.lines[0].t === 2, persisted);
  const originalOffset = await page.evaluate(async (index) => { await __player.loadIndex(index); return __player.__lyrics.offset(); }, originalIndex);
  check('oryginał zachowuje własne przesunięcie +0,5 s', originalOffset === 0.5);

  await page.click('#karaokeBtn');
  check('karaoke wczytuje LRC bieżącego utworu', await poll(() => page.evaluate(index => {
    const s = PulsarKaraoke.state();
    return s.open && s.loadedTrack === index && s.lines === 4;
  }, originalIndex)));
  await page.evaluate(() => { document.getElementById('audio').currentTime = 3.05; });
  check('duży tekst podąża za wspólnym offsetem', await poll(() => page.evaluate(() => {
    const s = PulsarKaraoke.state();
    const active = document.querySelector('#pkLines .pk-current .pk-line-text');
    return s.activeLine === 1 && active && active.textContent === 'druga linia';
  })));
  check('widok zawiera poprzednie i następne wersy', await page.evaluate(() => document.querySelectorAll('#pkLines .pk-previous').length > 0 && document.querySelectorAll('#pkLines .pk-next').length > 0));
  await page.click('#pkLarger');
  check('skala dużego tekstu jest regulowana', await page.evaluate(() => PulsarKaraoke.state().scale > 1 && document.getElementById('pkScale').textContent !== '100%'));
  await page.click('#pkAlign');
  check('wyrównanie napisów jest regulowane', await page.evaluate(() => PulsarKaraoke.state().align === 'left' && document.querySelector('.pk-stage').dataset.align === 'left'));
  await page.click('#pkOffsetPlus');
  check('szybka korekta karaoke zmienia wspólny offset', await page.evaluate(() => PulsarKaraoke.state().offset === 0.6000000000000001 || PulsarKaraoke.state().offset === 0.6));
  const clickedLineTime = await page.evaluate(() => {
    document.getElementById('audio').currentTime = 2;
    const line = document.querySelector('#pkLines [data-index="1"]');
    if (line) line.click();
    return { found: !!line, time: document.getElementById('audio').currentTime };
  });
  check('kliknięcie wersu przewija do czasu z offsetem', clickedLineTime.found && Math.abs(clickedLineTime.time - 3.1) < 0.02, clickedLineTime);
  check('karaoke wyświetla zwykły tekst bez znaczników czasu', await page.evaluate(() => {
    window.__testLyricsData = __player.__lyrics.data;
    __player.__lyrics.data = () => ({ plain: 'Pierwszy zwykły wers\nDrugi zwykły wers', synced: null });
    PulsarKaraoke.refresh();
    return PulsarKaraoke.state().plain === 2 && document.querySelectorAll('#pkLines.pk-plain p').length === 2;
  }));
  check('karaoke ma czytelny stan braku tekstu', await page.evaluate(() => {
    __player.__lyrics.data = () => null; PulsarKaraoke.refresh();
    return !!document.querySelector('#pkLines .pk-empty') && document.getElementById('pkLines').textContent.includes('Brak tekstu');
  }));
  await page.evaluate(() => { __player.__lyrics.data = window.__testLyricsData; delete window.__testLyricsData; PulsarKaraoke.refresh(); });
  await page.click('#pkClose');
  check('karaoke zamyka się bez zatrzymywania odtwarzacza', await poll(() => page.evaluate(() => !PulsarKaraoke.state().open)));
  check('zamknięcie karaoke zachowuje wcześniej włączony panel napisów', await page.evaluate(() => __player.__lyrics.on()));
  await page.evaluate(() => __player.__lyrics.setOffset(0.5));

  check('panel Auto-DJ 2.0 jest dostępny', await page.evaluate(() => !!document.getElementById('pulsarDjPlus') && !!window.PulsarAutoDj));
  const djChoice = await page.evaluate(() => {
    PulsarAutoDj.set({ mood: 'calm', artistDiversity: 80, genreDiversity: 60 });
    const preview = PulsarAutoDj.preview();
    const index = __player.__dj.choose();
    const last = PulsarAutoDj.lastChoice();
    return { preview: preview && preview.index, index: index, reason: last && last.reason, settings: PulsarAutoDj.settings() };
  });
  check('Auto-DJ stosuje nastrój i zwraca wyjaśnienie wyboru', djChoice && Number.isInteger(djChoice.index) && djChoice.index !== originalIndex && /Spokojnie/.test(djChoice.reason || '') && djChoice.settings.artistDiversity === 80, djChoice);
  const djUndo = await page.evaluate(() => {
    const start = __player.state().currentIndex;
    const picked = PulsarAutoDj.playSimilar();
    const after = __player.state().currentIndex;
    const backed = __player.__dj.back();
    return { start: start, picked: picked, after: after, backed: backed, restored: __player.state().currentIndex, history: __player.__dj.history().length };
  });
  check('Więcej podobnych i cofanie korzystają z historii DJ', djUndo && djUndo.picked === djUndo.after && djUndo.backed && djUndo.restored === djUndo.start, djUndo);

  if (DESKTOP) {
    check('natywny FFmpeg jest wykrywany', await page.evaluate(async () => (await __pulsarDesktopTools.capabilities(true)).ffmpeg));
    const backupResults = await page.evaluate(async dir => {
      PulsarBackups.set({ enabled: false, safety: true, folder: dir, keep: 2 });
      const results = [];
      for (let i = 0; i < 3; i++) results.push(await PulsarBackups.snapshot('test-' + i));
      return results.map(x => ({ name: x.name, size: x.size, tracks: x.tracks }));
    }, NATIVE_DIR);
    const backupFiles = fs.readdirSync(NATIVE_DIR).filter(name => /^Pulsar-auto-.*\.pulsarlib$/i.test(name)).sort();
    check('automatyczne migawki mają format .pulsarlib i rotację do 2 wersji', backupResults.length === 3 && backupFiles.length === 2 && backupFiles.every(name => fs.readFileSync(path.join(NATIVE_DIR, name)).subarray(0, 9).toString() === 'PULSARLIB'), { results: backupResults, files: backupFiles });
    const uniqueGuard = await page.evaluate(async () => {
      const current = __player.__editor.current();
      return __pulsarLibraryGuard.beforeRemove([current], { total: __player.state().tracks, kind: 'remove' });
    });
    check('usunięcie jedynej kopii wymaga osobnego ostrzeżenia i robi migawkę', uniqueGuard === true && dialogMessages.some(message => /tylko w bibliotece/i.test(message)), dialogMessages.slice(-3));
    const restoreGuard = await page.evaluate(async () => {
      const allowed = await __pulsarLibraryGuard.beforeRestore({ tracks: 1 });
      return { allowed: allowed, path: PulsarBackups.state().lastPath };
    });
    check('restore jest poprzedzony migawką bezpieczeństwa', restoreGuard.allowed === true && /before-restore/.test(restoreGuard.path), restoreGuard);

    await page.evaluate(async index => { await __player.loadIndex(index); }, originalIndex);
    await page.click('#audioEditorBtn');
    await poll(() => page.evaluate(() => PulsarAudioEditor.state().decoded));
    await setCut(1, 2);
    await page.select('#paeFormat', 'mp3');
    await page.$eval('#paeImport', input => { input.checked = false; });
    await page.click('#paeSave');
    check('eksport MP3 przechodzi przez natywny FFmpeg', await poll(async () => fs.existsSync(NATIVE_OUTPUT_MP3) && fs.statSync(NATIVE_OUTPUT_MP3).size > 0));
    check('FFmpeg otrzymuje kodek MP3, cięcia i fade', lastFfmpegCommand.includes('libmp3lame') && lastFfmpegCommand.includes('atrim=') && lastFfmpegCommand.includes('afade='), lastFfmpegCommand.slice(-500));
    await poll(() => page.evaluate(() => !PulsarAudioEditor.state().open));

    const enlarged = await page.evaluate(async index => {
      await __player.loadIndex(index);
      const file = __player.__editor.current().file;
      try { Object.defineProperty(file, 'size', { value: 90 * 1024 * 1024, configurable: true }); return file.size > 80 * 1024 * 1024; } catch (e) { return false; }
    }, originalIndex);
    check('test może oznaczyć źródło jako duży plik', enlarged);
    await page.click('#audioEditorBtn');
    check('duży plik używa FFmpeg bez AudioBuffer', await poll(() => page.evaluate(() => PulsarAudioEditor.state().nativeMode && !PulsarAudioEditor.state().decoded)));
    await page.evaluate(() => { PulsarAudioEditor.close(); const file = __player.__editor.current().file; try { delete file.size; } catch (e) {} });
  }
  check('brak nieobsłużonych błędów JavaScript', pageErrors.length === 0, pageErrors);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n${failures ? 'FAIL' : 'PASS'} — test integracyjny edytora, błędów: ${failures}`);
process.exitCode = failures ? 1 : 0;

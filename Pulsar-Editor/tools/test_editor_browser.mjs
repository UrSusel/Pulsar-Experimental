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
    if (op === 'showSaveDialog') return JSON.stringify(NATIVE_OUTPUT);
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
    if (op === 'execCommand') return JSON.stringify({ stdOut: '2026.01.01\n', stdErr: '', exitCode: 0 });
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
  page.on('dialog', dialog => dialog.accept().catch(() => {}));
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
  check('brak nieobsłużonych błędów JavaScript', pageErrors.length === 0, pageErrors);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n${failures ? 'FAIL' : 'PASS'} — test integracyjny edytora, błędów: ${failures}`);
process.exitCode = failures ? 1 : 0;

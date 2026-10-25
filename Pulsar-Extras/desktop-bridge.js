/* Pulsar Desktop — wspólny, natywny mostek FFmpeg i systemu plików. */
(function () {
  'use strict';

  const api = { available: false };
  window.__pulsarDesktopTools = api;
  if (typeof Neutralino === 'undefined') return;

  const APP_DIR = (typeof NL_PATH === 'string' && NL_PATH) ? NL_PATH : '.';
  const WINDOWS = /win/i.test(String(window.NL_OS || navigator.platform || navigator.userAgent || ''));
  let tmpDir = '';
  let ffmpegPath;
  let commandChain = Promise.resolve();

  function join(a, b) { return String(a || '').replace(/[\\/]+$/, '') + '/' + String(b || '').replace(/^[\\/]+/, ''); }
  function baseName(path) { const parts = String(path || '').split(/[\\/]/); return parts[parts.length - 1] || ''; }
  function extension(path) { const m = /\.([a-z0-9]+)$/i.exec(String(path || '')); return m ? m[1].toLowerCase() : ''; }
  function uuid() { return 'pulsar-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9); }
  function asBuffer(data) { return ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data; }
  function resultOf(result) {
    return {
      stdout: String((result && (result.stdOut != null ? result.stdOut : result.stdout)) || ''),
      stderr: String((result && (result.stdErr != null ? result.stdErr : result.stderr)) || '').trim(),
      code: result && typeof result.exitCode === 'number' ? result.exitCode : 0
    };
  }
  function quote(value) {
    const text = String(value == null ? '' : value);
    return WINDOWS ? '"' + text.replace(/["\r\n]/g, "'") + '"' : "'" + text.replace(/'/g, "'\\''") + "'";
  }
  function run(command, timeout) {
    const limit = Math.max(1000, Number(timeout) || 240000);
    const job = commandChain.then(function () {
      return Promise.race([
        Neutralino.os.execCommand(command),
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error('Przekroczono limit czasu polecenia')); }, limit); })
      ]);
    });
    commandChain = job.catch(function () {});
    return job;
  }
  async function stats(path) { return Neutralino.filesystem.getStats(path); }
  async function exists(path) { if (!path) return false; try { return !!(await stats(path)); } catch (e) { return false; } }
  async function mkdir(path) { try { await Neutralino.filesystem.createDirectory(path); } catch (e) {} return exists(path); }
  async function env(names) {
    for (const name of names) {
      try { const value = await Neutralino.os.getEnv(name); if (value && String(value).trim()) return String(value).trim(); } catch (e) {}
    }
    return '';
  }
  async function getTmp() {
    if (tmpDir) return tmpDir;
    const root = await env(WINDOWS ? ['TEMP', 'TMP'] : ['TMPDIR', 'XDG_CACHE_HOME', 'HOME']);
    tmpDir = join(root || join(APP_DIR, 'tmp'), 'pulsar-editor');
    await mkdir(tmpDir);
    return tmpDir;
  }
  async function tempFile(ext) { return join(await getTmp(), uuid() + '.' + String(ext || 'tmp').replace(/[^a-z0-9]/gi, '')); }
  async function resolveFfmpeg(force) {
    if (!force && ffmpegPath !== undefined) return ffmpegPath;
    const local = join(APP_DIR, WINDOWS ? 'ffmpeg.exe' : 'ffmpeg');
    if (await exists(local)) { ffmpegPath = local; return local; }
    try {
      const result = resultOf(await run(WINDOWS ? 'where ffmpeg' : 'command -v ffmpeg', 8000));
      const found = result.stdout.trim().split(/\r?\n/)[0].trim();
      ffmpegPath = result.code === 0 && found ? found : null;
    } catch (e) { ffmpegPath = null; }
    return ffmpegPath;
  }
  async function capabilities(force) {
    const ffmpeg = await resolveFfmpeg(!!force);
    return { available: true, ffmpeg: !!ffmpeg, ffmpegPath: ffmpeg || '', platform: WINDOWS ? 'windows' : 'linux' };
  }
  async function writeBlob(path, blob) {
    await Neutralino.filesystem.writeBinaryFile(path, new ArrayBuffer(0));
    for (let offset = 0; offset < blob.size; offset += 8388608) {
      const bytes = await blob.slice(offset, Math.min(blob.size, offset + 8388608)).arrayBuffer();
      await Neutralino.filesystem.appendBinaryFile(path, bytes);
    }
    return path;
  }
  async function exportAudio(job) {
    if (!job || !job.outputPath) throw new Error('Nie wybrano pliku docelowego');
    const ffmpeg = await resolveFfmpeg(false);
    if (!ffmpeg) throw new Error('FFmpeg nie jest dostępny');
    if (!window.PulsarEditorCore) throw new Error('Brak modułu eksportu');
    let input = String(job.inputPath || '');
    let temporary = '';
    if (!input) {
      if (!job.inputBlob) throw new Error('Brak źródła audio');
      input = temporary = await tempFile(extension(job.inputName) || 'audio');
      await writeBlob(input, job.inputBlob);
    }
    try {
      const args = window.PulsarEditorCore.buildFfmpegArgs(Object.assign({}, job, { inputPath: input }));
      const command = quote(ffmpeg) + ' ' + args.map(quote).join(' ');
      const result = resultOf(await run(command, Math.max(300000, Number(job.timeout) || 3600000)));
      if (result.code !== 0) throw new Error(result.stderr.split(/\r?\n/).slice(-4).join(' ') || ('FFmpeg zakończył kodem ' + result.code));
      const stat = await stats(input === job.outputPath ? '' : job.outputPath);
      if (!stat || !stat.size) throw new Error('FFmpeg nie utworzył pliku wynikowego');
      return { path: job.outputPath, size: stat.size, native: true, ffmpeg: ffmpeg };
    } finally {
      if (temporary) { try { await Neutralino.filesystem.remove(temporary); } catch (e) {} }
    }
  }
  async function defaultBackupDirectory() {
    if (WINDOWS) {
      const home = await env(['USERPROFILE']);
      return join(home || APP_DIR, 'Documents/Pulsar/Backups');
    }
    const home = await env(['HOME']);
    return join(home || APP_DIR, 'Pulsar/Backups');
  }

  const fs = {
    stats: stats,
    exists: exists,
    mkdir: mkdir,
    remove: function (path) { return Neutralino.filesystem.remove(path); },
    read: function (path) { return Neutralino.filesystem.readBinaryFile(path); },
    write: function (path, data) { return Neutralino.filesystem.writeBinaryFile(path, asBuffer(data)); },
    append: function (path, data) { return Neutralino.filesystem.appendBinaryFile(path, asBuffer(data)); },
    writeBlob: writeBlob,
    list: function (path) { return Neutralino.filesystem.readDirectory(path); },
    folderDialog: function (title) { return Neutralino.os.showFolderDialog(title || 'Wybierz folder'); },
    saveDialog: function (title, name, ext, label) {
      return Neutralino.os.showSaveDialog(title, { defaultPath: name, filters: [{ name: label || ext, extensions: [ext] }, { name: 'All files', extensions: ['*'] }] })
        .then(function (path) { if (!path) return ''; path = String(path); return /\.[a-z0-9]+$/i.test(path) ? path : path + '.' + ext; });
    },
    join: join,
    baseName: baseName
  };

  Object.assign(api, {
    available: true,
    capabilities: capabilities,
    tempFile: tempFile,
    exportAudio: exportAudio,
    defaultBackupDirectory: defaultBackupDirectory,
    fs: fs
  });
})();

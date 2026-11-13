#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const platform of ['Linux', 'Windows']) {
  const html = fs.readFileSync(path.join(__dirname, '..', platform, 'resources', 'index.html'), 'utf8');
  const loadTrack = html.match(/async function loadTrack\(index, opts\)\{([\s\S]*?)\n  function nextTrack/);
  assert.ok(loadTrack, `${platform}: local track loader exists`);
  const playAt = loadTrack[1].indexOf('if (opts.autoplay) tryPlayWithGesture();');
  const metadataAt = loadTrack[1].indexOf('await ensureTrackMeta(track)');
  assert.ok(playAt >= 0 && metadataAt > playAt,
    `${platform}: local audio starts in the click activation before metadata work can consume it`);
  assert.match(loadTrack[1], /try \{ await ensureTrackMeta\(track\); \}\s*catch\(e\)/,
    `${platform}: a metadata failure does not prevent playback or reject the track load`);
  assert.match(html, /const isLinux=\/Linux\/i\.test\(navigator\.platform \|\| navigator\.userAgent \|\| ''\);/,
    `${platform}: Linux decoder failures are detected from the runtime platform`);
  assert.match(html, /Linux\/WebKit nie obsłużył pliku \(format lub kodek\)/,
    `${platform}: Linux users get an actionable WebKit/GStreamer diagnosis`);
  assert.match(html, /showToast\(detail,10000\)/,
    `${platform}: the codec diagnosis remains visible long enough to read`);
  assert.match(html, /mp3:'audio\/mpeg'[\s\S]*m4a:'audio\/mp4'/,
    `${platform}: common audio formats receive canonical MIME types`);
  assert.match(html, /file: normalizeAudioFile\(new File\(\[item\.blob\]/,
    `${platform}: older library entries are corrected by filename when restored`);
  assert.match(loadTrack[1], /URL\.createObjectURL\(normalizeAudioFile\(track\.file\)\)/,
    `${platform}: playback uses a codec-friendly Blob type`);
  assert.match(html, /mediaInfo=failedTrack&&failedTrack\.file/,
    `${platform}: the Linux error includes the exact filename`);
  assert.match(html, /failedTrack\.file\.type\|\|'brak MIME'/,
    `${platform}: the Linux error includes the detected MIME type`);

  assert.match(html, /const maxPixels = 1280 \* 720;/,
    `${platform}: the GPU visualizer has a fixed pixel budget on high-DPI displays`);
  assert.match(html, /if\(now-lastFrame<1000\/30\)return;/,
    `${platform}: shader rendering is capped at 30 frames per second`);
  assert.match(html, /localStorage\.setItem\('ambientVisualMode', '0'\)/,
    `${platform}: users switch to the new visualizer after updating`);
  console.log(`${platform}: local playback and visualizer stability checks passed`);
}

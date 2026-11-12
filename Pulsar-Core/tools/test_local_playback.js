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

  assert.match(html, /const maxPixels = 1280 \* 720;/,
    `${platform}: the GPU visualizer has a fixed pixel budget on high-DPI displays`);
  assert.match(html, /if\(now-lastFrame<1000\/30\)return;/,
    `${platform}: shader rendering is capped at 30 frames per second`);
  assert.match(html, /localStorage\.setItem\('ambientVisualMode', '0'\)/,
    `${platform}: users switch to the new visualizer after updating`);
  console.log(`${platform}: local playback and visualizer stability checks passed`);
}

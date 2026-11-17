#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const platform of ['Linux', 'Windows']) {
  const html = fs.readFileSync(path.join(__dirname, '..', platform, 'resources', 'index.html'), 'utf8');
  assert.match(html, /title: track\.title, artist: track\.artist, addedAt: Number\(track\.addedAt\), blob: track\.file/,
    `${platform}: track-added time is stored in IndexedDB`);
  assert.match(html, /folder: item\.folder \|\| '', title: item\.title, artist: item\.artist, addedAt: addedAt/,
    `${platform}: the saved add time is restored with each track`);
  assert.match(html, /const addedAt = Number\.isFinite\(savedAddedAt\) && savedAddedAt > 0 \? savedAddedAt : legacyAddedAtBase \+ index;/,
    `${platform}: old library records receive a stable one-time migration timestamp`);
  assert.match(html, /addedAt: addedAtBase \+ index/,
    `${platform}: newly imported tracks receive ordered timestamps`);

  const sort = html.match(/function orderedTrackIdx\(filter\)\{([\s\S]*?)\n  \}/);
  assert.ok(sort, `${platform}: library sort function exists`);
  const orderedTrackIdx = new Function('tracks', 'libSortMode', 'filter', `${sort[1]}; return idx;`);
  const tracks = [
    { title: 'Older', artist: 'A', addedAt: 100 },
    { title: 'Newest', artist: 'B', addedAt: 300 },
    { title: 'Middle', artist: 'C', addedAt: 200 }
  ];
  assert.deepEqual(orderedTrackIdx(tracks, 4, ''), [1, 2, 0],
    `${platform}: newest-first sorting follows saved timestamps, not the in-memory array order`);
  console.log(`${platform}: persistent recently-added ordering checks passed`);
}

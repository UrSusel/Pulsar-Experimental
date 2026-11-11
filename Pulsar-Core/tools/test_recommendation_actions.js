#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const platform of ['Linux', 'Windows']) {
  const html = fs.readFileSync(path.join(__dirname, '..', platform, 'resources', 'index.html'), 'utf8');
  assert.match(html, /recommendation-play/, `${platform}: recommendations expose a listen control`);
  assert.match(html, /recommendation-download/, `${platform}: recommendations expose a download control`);
  assert.match(html, /play\.addEventListener\('click',function\(\)\{playRecommendation\(item,play\);\}\)/, `${platform}: listen control starts playback`);
  assert.match(html, /const stream=await netYtStream\(id\)/, `${platform}: playback resolves the YouTube audio stream`);
  assert.match(html, /await netImport\(-1,download,recommendationAsNetResult\(item\)\)/, `${platform}: download uses the same library import flow as YouTube search`);
  assert.match(html, /async function netImport\(i, btnEl, overrideResult\)/, `${platform}: shared importer accepts recommendation tracks`);
  console.log(`${platform}: For You listen/download checks passed`);
}

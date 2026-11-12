#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const platform of ['Linux', 'Windows']) {
  const html = fs.readFileSync(path.join(__dirname, '..', platform, 'resources', 'index.html'), 'utf8');
  assert.match(html, /'uniform vec2 uOrigin;'/, `${platform}: shader exposes an album-origin uniform`);
  assert.match(html, /vec2 p = \(uv - uOrigin\) \* vec2\(aspect, 1\.0\) \* 2\.5/, `${platform}: shader coordinates radiate from the supplied origin`);
  assert.match(html, /vec2 wq = \(uv - uOrigin\) \* vec2\(aspect, 1\.0\)/, `${platform}: wave mode is anchored to the album too`);
  assert.match(html, /length\(\(uv - uOrigin\) \* vec2\(aspect, 1\.0\)/, `${platform}: vignette follows the album center`);
  assert.match(html, /float sourceRing = exp\(-abs\(sourceR - pulseR\)/, `${platform}: every visual style includes an outward pulse ring`);
  assert.match(html, /const coverRect=coverWrap\.getBoundingClientRect\(\)/, `${platform}: origin follows the live album-cover position`);
  assert.match(html, /originX\+=\(targetOriginX-originX\)\*originEase/, `${platform}: the origin follows cover motion smoothly`);
  assert.match(html, /gl\.uniform2f\(U\.uOrigin, originX, originY\)/, `${platform}: cover center is sent to the GPU each frame`);
  console.log(`${platform}: album-centered visualizer checks passed`);
}

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
  assert.match(html, /float spec = texture2D\(uSpectrum, vec2\(abs\(a\) \* 0\.31830989, 0\.5\)\)\.r;/, `${platform}: the default halo maps the live spectrum continuously around the cover`);
  assert.match(html, /float ringRadius = 0\.54 \+ spec \* \(0\.12 \+ uBass \* 0\.14\) \+ uBeat \* 0\.05;/, `${platform}: the spectral ring breathes to bass and beats`);
  assert.match(html, /float pulseRadius = 0\.58 \+ fract\(uTime \* 0\.06\) \* 2\.15;/, `${platform}: soft pulses expand outward from the album`);
  assert.match(html, /float rayField = rays \* exp\(-abs\(r - ringRadius - 0\.11\) \* 5\.0\)/, `${platform}: fine rays stay attached to the album halo`);
  assert.match(html, /vec3 lifted = c \/ max\(m, 0\.28\) \* 0\.82;/, `${platform}: extracted cover colors keep their natural saturation`);
  assert.match(html, /const coverRect=coverWrap\.getBoundingClientRect\(\)/, `${platform}: origin follows the live album-cover position`);
  assert.match(html, /originX\+=\(targetOriginX-originX\)\*originEase/, `${platform}: the origin follows cover motion smoothly`);
  assert.match(html, /gl\.uniform2f\(U\.uOrigin, originX, originY\)/, `${platform}: cover center is sent to the GPU each frame`);
  console.log(`${platform}: album-centered visualizer checks passed`);
}

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
  assert.match(html, /float shellRadius = 0\.86 \+ petals \* 0\.085/, `${platform}: the softened shell keeps its organic halo without a deep inward notch`);
  assert.match(html, /float band = abs\(a\) \* 0\.31830989;/, `${platform}: the default visualizer keeps its original fixed angular spectrum layout`);
  assert.match(html, /float spec = clamp\(texture2D\(uSpectrum, vec2\(band, 0\.5\)\)\.r \* \(1\.0 \+ band \* 0\.75\) \+ uHigh \* band \* 1\.4, 0\.0, 1\.0\);/, `${platform}: the quieter high-frequency side gets an audio-driven local boost`);
  assert.match(html, /float mir = abs\(mod\(ang \+ 3\.14159265, 6\.2831853\) - 3\.14159265\) \/ 3\.14159265;/, `${platform}: the radial mode does not rotate its angular mapping`);
  assert.match(html, /float specA = clamp\(texture2D\(uSpectrum, vec2\(mir \* 0\.62 \+ 0\.02, 0\.5\)\)\.r \* \(1\.0 \+ mir \* 0\.75\) \+ uHigh \* mir \* 1\.4, 0\.0, 1\.0\);/, `${platform}: radial rays boost high frequencies without time-based rotation`);
  assert.doesNotMatch(html, /abs\(sin\(a \+ uTime|sin\(ang \+ uTime/, `${platform}: audio spectrum mapping does not rotate independently of the music`);
  assert.match(html, /float petals = 0\.72 \* sin\(a \* 3\.0 \+ field \* 3\.5 - t \* 0\.45\) \+ 0\.28 \* sin\(a \* 7\.0 - warp \* 3\.0 \+ t \* 0\.3\);/, `${platform}: angular scallops are softened to avoid a pinched-in side`);
  assert.match(html, /float shellRadius = 0\.86 \+ petals \* 0\.085 \+ \(spec - 0\.25\) \* 0\.22 \+ uBass \* 0\.12 \+ uBeat \* 0\.04 \+ uHigh \* band \* 0\.12;/, `${platform}: shell retains local high-band movement while the outline stays rounder`);
  assert.match(html, /float silk = exp\(-abs\(folds\) \* 10\.0\) \* exp\(-abs\(shellDelta\) \* 3\.2\);/, `${platform}: layered silk folds add moving depth behind the artwork`);
  assert.match(html, /float pulseWarp = 0\.12 \* sin\(a \* 3\.0 \+ field \* 3\.0\)/, `${platform}: outward pulses follow the organic halo instead of perfect circles`);
  assert.match(html, /float sourceBloom = exp\(-sourceR \* 2\.5\);/, `${platform}: the old universal hard pulse ring is removed`);
  assert.match(html, /const visualRevision = Number\(localStorage\.getItem\('ambientVisualRevision'\) \|\| 0\);/, `${platform}: existing users are switched to the redesigned visualizer once`);
  assert.match(html, /localStorage\.setItem\('ambientVisualMode', '0'\)/, `${platform}: the redesign becomes the selected style on upgrade`);
  assert.match(html, /vec3 lifted = c \/ max\(m, 0\.28\) \* 0\.82;/, `${platform}: extracted cover colors keep their natural saturation`);
  assert.match(html, /const coverRect=coverWrap\.getBoundingClientRect\(\)/, `${platform}: origin follows the live album-cover position`);
  assert.match(html, /originX\+=\(targetOriginX-originX\)\*originEase/, `${platform}: the origin follows cover motion smoothly`);
  assert.match(html, /gl\.uniform2f\(U\.uOrigin, originX, originY\)/, `${platform}: cover center is sent to the GPU each frame`);
  console.log(`${platform}: album-centered visualizer checks passed`);
}

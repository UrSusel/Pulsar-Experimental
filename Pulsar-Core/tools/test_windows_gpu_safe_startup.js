#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'Windows', 'resources', 'index.html'), 'utf8');
assert.match(html, /const APP_RUN_STATE_KEY = 'pulsarAppRunStateV1'/,
  'Windows: startup tracks whether the previous app exit was clean');
assert.match(html, /recoveredAfterUncleanExit = localStorage\.getItem\(APP_RUN_STATE_KEY\) === 'running'/,
  'Windows: an interrupted run is detected before graphics initialization');
assert.match(html, /window\.addEventListener\('beforeunload',[\s\S]*?localStorage\.setItem\(APP_RUN_STATE_KEY, 'clean'\)/,
  'Windows: normal app close marks the run clean');
assert.match(html, /if \(!gpuSafeStartupDone \|\| recoveredAfterUncleanExit\)[\s\S]*?localStorage\.setItem\('threeDMode', 'false'\)/,
  'Windows: first launch after upgrade and crash recovery both disable risky auto-start graphics');
assert.match(html, /function ensureAmbientVisual\(\)[\s\S]*?ambientVisual = initAmbientVisual\(\)/,
  'Windows: WebGL renderer initializes lazily');
assert.match(html, /if \(initializeGpuAtStartup && !recoveredAfterUncleanExit\) ensureAmbientVisual\(\)/,
  'Windows: renderer is not initialized after an unclean exit');
assert.doesNotMatch(html, /ambientVisual = initAmbientVisual\(\);\s*if \(ambientVisual\)/,
  'Windows: no unconditional renderer/shader compilation during normal app startup');
assert.match(html, /if \(requested\) ensureAmbientVisual\(\);\s*threeDMode = requested && Boolean\(ambientVisual\)/,
  'Windows: users can still opt into 3D from Settings after the UI is responsive');

console.log('Windows: GPU-safe startup and interrupted-run recovery checks passed');

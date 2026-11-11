#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const platform of ['Linux', 'Windows']) {
  const html = fs.readFileSync(path.join(__dirname, '..', platform, 'resources', 'index.html'), 'utf8');
  assert.match(html, /id="videoModeBtn"/, `${platform}: the main player exposes video mode`);
  assert.match(html, /id="mvVideoBtn"/, `${platform}: mini player exposes the video shortcut`);
  assert.match(html, /async function discoverVideoForTrack\(/, `${platform}: local tracks can resolve a matching YouTube video`);
  assert.match(html, /directYoutubeId\(track\)/, `${platform}: known YouTube source IDs are reused`);
  assert.match(html, /const results=await netYoutube\(query,8\)/, `${platform}: unknown local tracks search YouTube`);
  assert.ok(html.includes('b.hidden=!available'), `${platform}: the video button is hidden when no match exists`);
  assert.match(html, /new YT\.Player\('videoPlayerMount'/, `${platform}: video mode uses the YouTube player as the media source`);
  assert.match(html, /id="videoStagePlay"/, `${platform}: video-mode playback remains controllable in fullscreen`);
  assert.match(html, /videoModePosition=Math\.max\(0,audio\.currentTime\|\|0\)/, `${platform}: entering video mode keeps the current edit/seek position`);
  assert.match(html, /function userVideoCuts\(track\)[\s\S]*?PulsarAudioEditor[\s\S]*?pulsarEditorSession:/, `${platform}: saved audio-editor cuts are loaded for video playback`);
  assert.match(html, /function applyVideoEditCuts\(\)[\s\S]*?now>=item\.start&&now<item\.end[\s\S]*?seekPlaybackTo\(cut\.end\+\.001\)/, `${platform}: edited-out sections are skipped by the video player`);
  assert.match(html, /if\(videoModeWasPlaying\)event\.target\.playVideo\(\)/, `${platform}: video starts only after its player is ready`);
  assert.match(html, /function seekPlaybackTo\(position\)[\s\S]*?videoPlayer\.seekTo\(time,true\)/, `${platform}: user seeking is forwarded to the video`);
  assert.match(html, /videoModePosition=pos;audio\.currentTime=pos/, `${platform}: leaving video mode returns audio to the video position`);
  assert.match(html, /stopVideoMode\(true\)/, `${platform}: the toggle returns to audio playback`);
  assert.match(html, /body\.fullscreen-mode\.video-mode \.video-stage[\s\S]*?body\.fullscreen-mode\.video-mode \.lyrics-box/, `${platform}: fullscreen lays video and lyrics side by side`);
  assert.match(html, /video-backdrop img[\s\S]*?filter:blur\(34px\)/, `${platform}: video artwork is blurred behind the stage to blend screen edges`);
  assert.match(html, /body\.video-mode \.ambient-bg-container[\s\S]*?opacity:0 !important/, `${platform}: video mode owns its backdrop instead of mixing visualizer backgrounds`);
  assert.match(html, /videoModeActive\?videoModePlaying:!audio\.paused/, `${platform}: player UI follows whichever media source is active`);
  console.log(`${platform}: YouTube music-video mode checks passed`);
}

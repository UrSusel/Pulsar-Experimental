#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const platform of ['Linux', 'Windows']) {
  const html = fs.readFileSync(path.join(__dirname, '..', platform, 'resources', 'index.html'), 'utf8');
  assert.match(html, /id="videoModeBtn"/, `${platform}: the main player exposes video mode`);
  assert.match(html, /id="mvVideoBtn"/, `${platform}: mini player exposes the video shortcut`);
  assert.match(html, /async function discoverVideoForTrack\(/, `${platform}: local tracks can resolve a matching YouTube video`);
  assert.match(html, /directYoutubeId\(track\)/, `${platform}: known YouTube source IDs are reused`);
  assert.match(html, /let results=await netYoutube\(query,12\)/, `${platform}: local tracks search YouTube for multiple matches`);
  assert.ok(html.includes('b.hidden=!available'), `${platform}: the video button is hidden when no match exists`);
  assert.match(html, /new YT\.Player\('videoPlayerMount'/, `${platform}: video mode uses the YouTube player as the media source`);
  assert.match(html, /id="videoStageFullscreen"/, `${platform}: video mode exposes a fullscreen control inside the visible video stage`);
  assert.match(html, /videoStageFullscreenBtn\.addEventListener\('click'/, `${platform}: the visible video fullscreen button toggles fullscreen mode`);
  assert.match(html, /body\.video-mode:not\(\.fullscreen-mode\) \.player \{[\s\S]*?grid-template-columns:minmax\(240px,\.28fr\) minmax\(0,\.72fr\)/, `${platform}: normal video view places lyrics left and enlarges video on the right`);
  assert.match(html, /playerVars\.widget_referrer=location\.href/, `${platform}: embedded player receives the desktop webview referrer`);
  assert.match(html, /function videoTextSimilarity\([\s\S]*?const precision=shared\/bb\.length,recall=shared\/aa\.length/, `${platform}: matching uses balanced title-token similarity`);
  assert.match(html, /function videoCandidateTypePenalty\([\s\S]*?karaoke[\s\S]*?remix/, `${platform}: covers, karaoke and alternate versions are down-ranked`);
  assert.match(html, /function promptVideoCandidate\([\s\S]*?Wybierz właściwy teledysk/, `${platform}: ambiguous matches ask the user to choose`);
  assert.match(html, /artistKnown&&best\.score>=\.84&&\(details\.length===1\|\|best\.score-runner\.score>=\.14\)/, `${platform}: strong, distinct matches can start automatically`);
  assert.match(html, /if\(code===101\|\|code===150\)[\s\S]*?nextVideoCandidate\(track,id\)/, `${platform}: YouTube embed restrictions trigger alternate-video retries`);
  assert.match(html, /function openVideoOnYoutube\([\s\S]*?Neutralino\.os\.open\(url\)/, `${platform}: blocked embeds can still open in YouTube's own player`);
  assert.match(html, /okText:t\('Otwórz w YouTube'\)/, `${platform}: the non-embeddable-video fallback is actionable`);
  assert.match(html, /id="videoStagePlay"/, `${platform}: video-mode playback remains controllable in fullscreen`);
  assert.match(html, /videoModePosition=Math\.max\(0,audio\.currentTime\|\|0\)/, `${platform}: entering video mode keeps the current edit/seek position`);
  assert.match(html, /function userVideoCuts\(track\)[\s\S]*?PulsarAudioEditor[\s\S]*?pulsarEditorSession:/, `${platform}: saved audio-editor cuts are loaded for video playback`);
  assert.match(html, /function applyVideoEditCuts\(\)[\s\S]*?now>=item\.start&&now<item\.end[\s\S]*?seekPlaybackTo\(cut\.end\+\.001\)/, `${platform}: edited-out sections are skipped by the video player`);
  assert.match(html, /if\(videoModeWasPlaying\)event\.target\.playVideo\(\)/, `${platform}: video starts only after its player is ready`);
  assert.match(html, /function seekPlaybackTo\(position\)[\s\S]*?videoPlayer\.seekTo\(time,true\)/, `${platform}: user seeking is forwarded to the video`);
  assert.match(html, /videoModePosition=pos;audio\.currentTime=pos/, `${platform}: leaving video mode returns audio to the video position`);
  assert.match(html, /stopVideoMode\(true\)/, `${platform}: the toggle returns to audio playback`);
  assert.match(html, /body\.fullscreen-mode\.video-mode \.video-stage[\s\S]*?body\.fullscreen-mode\.video-mode \.lyrics-box/, `${platform}: fullscreen lays video and lyrics side by side`);
  assert.match(html, /html:fullscreen, html:-webkit-full-screen \{ width:100vw; height:100vh; min-height:100vh; overflow:hidden; background:#050505 !important; \}/, `${platform}: fullscreen root fills the viewport`);
  assert.match(html, /html:fullscreen::backdrop, html:-webkit-full-screen::backdrop \{ background:#050505/, `${platform}: fullscreen backdrop stays dark and does not expose white viewport strips`);
  assert.match(html, /html:fullscreen body, html:-webkit-full-screen body \{ position:fixed; inset:0; width:100vw; height:100vh; min-height:100vh; margin:0; overflow:hidden; background:#050505 !important; \}/, `${platform}: fullscreen body covers the entire viewport`);
  assert.match(html, /body\.fullscreen-mode\.video-mode \{ width:100vw; height:100vh; min-height:100vh; margin:0; overflow:hidden; background:#050505 !important; \}/, `${platform}: fullscreen video content covers the full viewport`);
  assert.match(html, /videoModeActive\?videoModePlaying:!audio\.paused/, `${platform}: player UI follows whichever media source is active`);

  const start = html.indexOf('  function videoNormalizeText(value)');
  const end = html.indexOf('  async function discoverVideoForTrack(track)', start);
  assert.ok(start >= 0 && end > start, `${platform}: candidate ranker is available for unit checks`);
  const context = {};
  vm.runInNewContext(html.slice(start, end) + '\nthis.rankVideoCandidates=rankVideoCandidates;this.videoTextSimilarity=videoTextSimilarity;', context);
  assert.ok(context.videoTextSimilarity('One', 'One Direction') < 0.8, `${platform}: a short substring is not treated as an exact match`);
  const ranked = context.rankVideoCandidates({ title: 'Song Name', artist: 'Artist A', durMs: 180000 }, [
    { id: 'wrong-cover', title: 'Song Name Cover', artist: 'Random Singer', durMs: 180000 },
    { id: 'right', title: 'Artist A - Song Name (Official Music Video)', artist: 'Artist A - Topic', durMs: 181000 },
    { id: 'wrong-title', title: 'Different Song', artist: 'Artist A', durMs: 180000 }
  ]);
  assert.equal(ranked[0] && ranked[0].id, 'right', `${platform}: title, artist and duration favor the correct music video`);
  assert.ok(!ranked.some(candidate => candidate.id === 'wrong-cover'), `${platform}: a cover by a different artist is discarded`);
  console.log(`${platform}: YouTube music-video matching checks passed`);
}

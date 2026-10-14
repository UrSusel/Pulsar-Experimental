// Checks the background-playback guard in android-bridge.js without a device.
//   node Pulsar-Android/tools/test_background_watchdog.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'android-bridge.js'), 'utf8');

// Real-time model: the watchdog interval is squeezed 20x and the fake media
// clock runs 20x so tick-to-tick progress matches a real 2 s window.
const SPEED = 20;
function makeEnv() {
  const L = { doc: {}, win: {}, audio: {} };
  const on = (bag, target) => (type, fn) => { (bag[target][type] = bag[target][type] || []).push(fn); };
  const fire = (target, type, detail) => (L[target][type] || []).slice().forEach(fn => fn(detail || { type }));

  const audio = {
    paused: true, duration: 180, readyState: 4, playCalls: 0, seeks: [], frozen: false,
    addEventListener: on(L, 'audio'),
    systemPause() { const was = !this.paused; this.paused = true; if (was) fire('audio', 'pause'); },
    play() { this.playCalls++; const was = this.paused; this.paused = false; if (was) { fire('audio','play'); fire('audio','playing'); } return Promise.resolve(); },
    pause() { const was = !this.paused; this.paused = true; if (was) fire('audio','pause'); },
    removeAttribute() {}, load() {},
    get currentTime() { return this._t || 0; },
    set currentTime(v) { this._t = v; this.seeks.push(v); },
  };
  // media clock: advances while playing, unless the pipeline is simulated stuck
  const clock = setInterval(() => { if (!audio.paused && !audio.frozen) { audio._t = (audio._t || 0) + 0.1; fire('audio', 'timeupdate'); } }, Math.max(1, Math.round(5)));
  clock.unref && clock.unref();

  let updates = 0, lastState = null, permissionAskedAt = null;
  const plugin = {
    updateState(s) { updates++; lastState = s; return Promise.resolve(); },
    requestNotificationPermission() { if (permissionAskedAt === null) permissionAskedAt = Date.now(); return Promise.resolve({ granted: true }); },
    addListener(name, fn) { L.action = fn; return Promise.resolve({}); },
  };
  const host = {
    nowPlaying: () => ({ hasTrack: true, title: 'Giants', artist: 'Imagine Dragons', playing: !audio.paused, pos: audio.currentTime, dur: 180 }),
    toggle: () => { if (audio.paused) audio.play(); else audio.pause(); },
    next() {}, prev() {},
    audioTap: () => ({ ctx: { state: 'running', resume: () => Promise.resolve(), addEventListener() {} } }),
  };
  const document = {
    hidden: false, readyState: 'complete',
    documentElement: { classList: { add() {} } }, head: { appendChild() {} }, body: { classList: { toggle() {}, add() {}, remove() {} } },
    addEventListener: on(L, 'doc'), createElement: () => ({ style: {} }), querySelector: s => (s === 'audio' ? audio : null),
  };
  const window = {
    document, Capacitor: { Plugins: { PulsarMedia: plugin } }, __pulsarHost: host,
    addEventListener: on(L, 'win'),
    setInterval: (fn, ms) => setInterval(fn, Math.max(1, Math.round(ms / SPEED))),
    clearInterval, setTimeout: (fn, ms) => setTimeout(fn, Math.max(1, Math.round(ms / SPEED))),
  };
  const startedAt = Date.now();
  class FakeDate extends Date { static now() { return (Date.now() - startedAt) * SPEED; } }
  const sandbox = { window, document, console, navigator: {}, Date: FakeDate, setTimeout: window.setTimeout, setInterval: window.setInterval, clearInterval };
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  return {
    audio, fire, plugin,
    get updates() { return updates; }, get lastState() { return lastState; }, get permissionAsked() { return permissionAskedAt !== null; },
    setHidden(v) { document.hidden = v; fire('doc', 'visibilitychange'); },
    mediaAction(a, pos) { L.action({ action: a, position: pos || 0 }); },
    stopClock() { clearInterval(clock); },
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => results.push((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '   [' + extra + ']' : ''));

(async () => {
  { // 1. system pause while backgrounded must be undone
    const env = makeEnv(); await sleep(60); env.audio.play(); await sleep(120);
    env.setHidden(true); env.audio.systemPause();
    await sleep(300);
    check('system pause in background is resumed', !env.audio.paused && env.audio.playCalls >= 2, 'playCalls=' + env.audio.playCalls);
  }
  { // 2. user pause from the notification/lock screen must stay paused
    const env = makeEnv(); await sleep(60); env.audio.play(); await sleep(120);
    env.setHidden(true); env.mediaAction('pause');
    await sleep(300);
    check('user pause from notification stays paused', env.audio.paused && env.audio.playCalls === 1, 'playCalls=' + env.audio.playCalls);
  }
  { // 3. app-initiated pause (sleep timer, in-app button) must stay paused
    const env = makeEnv(); await sleep(60); env.audio.play(); await sleep(120);
    env.setHidden(true); await sleep(60); env.audio.pause();   // goes through the patched pause()
    await sleep(300);
    check('app-initiated pause stays paused', env.audio.paused && env.audio.playCalls === 1, 'playCalls=' + env.audio.playCalls);
  }
  { // 4. healthy background playback must be left completely alone
    const env = makeEnv(); await sleep(60); env.audio.play(); env.setHidden(true);
    await sleep(500);
    check('healthy background playback untouched', !env.audio.paused && env.audio.playCalls === 1 && env.audio.seeks.length === 0,
          'playCalls=' + env.audio.playCalls + ' seeks=' + env.audio.seeks.length);
  }
  { // 5. frozen pipeline (element says playing, sound stopped) is nudged, then given up on
    const env = makeEnv(); await sleep(60); env.audio.play(); await sleep(120);
    env.setHidden(true); env.audio.frozen = true;
    await sleep(1600);
    const nudged = env.audio.playCalls > 1 || env.audio.seeks.length > 0;
    check('frozen background pipeline is nudged', nudged, 'playCalls=' + env.audio.playCalls + ' seeks=' + env.audio.seeks.length);
    const afterCap = env.audio.playCalls + env.audio.seeks.length;
    await sleep(700);
    const later = env.audio.playCalls + env.audio.seeks.length;
    check('watchdog gives up instead of fighting forever', later === afterCap, 'before=' + afterCap + ' after=' + later);
  }
  { // 6. in-app pause then play again: watchdog must be armed again once playing
    const env = makeEnv(); await sleep(60); env.audio.play(); await sleep(120);
    env.setHidden(true); env.audio.systemPause(); await sleep(60); env.audio.play(); await sleep(200);
    check('resuming from the app re-arms the watchdog', !env.audio.paused, 'playCalls=' + env.audio.playCalls);
  }
  { // 7. notification permission is requested as soon as a track exists
    const env = makeEnv(); await sleep(200);
    check('notification permission requested up front', env.permissionAsked, 'asked=' + env.permissionAsked);
  }
  console.log(results.join('\n'));
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();

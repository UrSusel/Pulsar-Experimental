/* Android-only adapter for the existing Pulsar web runtime.
 * Desktop/Neutralino APIs are deliberately not loaded on Android.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('pulsar-android');

  var style = document.createElement('style');
  style.id = 'pulsarAndroidAdapterStyles';
  style.textContent = [
    'html.pulsar-android .sm-desktop-only { display: none !important; }',
    'html.pulsar-android #pipBtn { display: none !important; }',
    'html.pulsar-android #netView { display: none !important; }',
    'html.pulsar-android #libraryTabs [data-view="net"] { display: none !important; }',
    'html.pulsar-android .sm-tab[data-pane="net"], html.pulsar-android .sm-pane[data-pane="net"] { display: none !important; }',
    'html.pulsar-android body { min-width: 0; overflow-x: hidden; overscroll-behavior: none; -webkit-tap-highlight-color: transparent; }'
  ].join('\n');
  (document.head || root).appendChild(style);

  // The player core only enables disk-writing and desktop mini-window behaviour
  // when these objects expose the relevant APIs. Keep those features unavailable
  // until they have proper Android-native implementations.
  window.__pulsarDesktop = undefined;
  window.__pulsarFs = undefined;
  window.__pulsarAndroid = true;

  function installNativeMediaControls() {
    var capacitor = window.Capacitor;
    var plugin = capacitor && capacitor.Plugins && capacitor.Plugins.PulsarMedia;
    var host = window.__pulsarHost;
    var audio = document.querySelector('audio');
    if (!plugin || !host || !audio || typeof host.nowPlaying !== 'function') return;

    var lastSignature = '';
    var lastTrackId = null;
    var permissionAsked = false;

    function syncMediaState(force) {
      var state;
      try { state = host.nowPlaying(); } catch (error) { return; }
      if (!state || !state.hasTrack) {
        if (lastTrackId !== null) {
          lastTrackId = null;
          lastSignature = '';
          try { plugin.updateState({ hasTrack: false, playing: false }); } catch (error) {}
        }
        return;
      }

      var position = Math.max(0, Number(state.pos) || 0);
      var duration = Math.max(0, Number(state.dur) || 0);
      var signature = [
        state.title || '', state.artist || '', !!state.playing,
        Math.floor(duration), Math.floor(position / 5)
      ].join('|');
      lastTrackId = state.title || state.artist || 'current-track';
      if (!force && signature === lastSignature) return;
      lastSignature = signature;

      try {
        var update = plugin.updateState({
          hasTrack: true,
          title: state.title || '',
          artist: state.artist || '',
          playing: !!state.playing,
          position: position,
          duration: duration
        });
        if (update && typeof update.catch === 'function') update.catch(function () {});
      } catch (error) {}

      if (state.playing && !permissionAsked && typeof plugin.requestNotificationPermission === 'function') {
        permissionAsked = true;
        try {
          var permission = plugin.requestNotificationPermission();
          if (permission && typeof permission.catch === 'function') permission.catch(function () {});
        } catch (error) {}
      }
    }

    function handleMediaAction(event) {
      var action = event && event.action;
      try {
        if (action === 'play' && audio.paused) host.toggle();
        else if (action === 'pause' && !audio.paused) host.toggle();
        else if (action === 'toggle') host.toggle();
        else if (action === 'next') host.next();
        else if (action === 'previous') host.prev();
        else if (action === 'seekTo') {
          var target = Math.max(0, Number(event.position) || 0) / 1000;
          if (isFinite(target) && isFinite(audio.duration)) target = Math.min(target, audio.duration);
          audio.currentTime = target;
        }
      } catch (error) {}
      if (action === 'play' || action === 'toggle') {
        window.setTimeout(function () { syncMediaState(true); }, 1000);
      }
    }

    if (typeof plugin.addListener === 'function') {
      try {
        var listener = plugin.addListener('mediaAction', handleMediaAction);
        if (listener && typeof listener.catch === 'function') listener.catch(function () {});
      } catch (error) {}
    }

    audio.addEventListener('play', function () { syncMediaState(true); });
    audio.addEventListener('pause', function () { syncMediaState(true); });
    audio.addEventListener('loadedmetadata', function () { syncMediaState(true); });
    audio.addEventListener('durationchange', function () { syncMediaState(true); });
    audio.addEventListener('seeked', function () { syncMediaState(true); });
    audio.addEventListener('ended', function () { syncMediaState(true); });
    audio.addEventListener('error', function () { syncMediaState(true); });
    audio.addEventListener('timeupdate', function () { syncMediaState(false); });
    document.addEventListener('pulsar:state', function () { syncMediaState(true); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) syncMediaState(true);
    });
    syncMediaState(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installNativeMediaControls, { once: true });
  } else {
    installNativeMediaControls();
  }
})();

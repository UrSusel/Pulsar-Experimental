/* Android-only adapter for the existing Pulsar web runtime.
 * Desktop/Neutralino APIs are deliberately not loaded on Android; YouTube
 * streams are resolved by the built-in native InnerTube extractor first, with
 * public providers as fallbacks, then cached locally for preview and import.
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
    'html.pulsar-android .sm-tab[data-pane="net"], html.pulsar-android .sm-pane[data-pane="net"] { display: none !important; }',
    'html.pulsar-android #netBridgeChip, html.pulsar-android #netBridgeBanner { display: none !important; }',
    'html.pulsar-android body { min-width: 0; overflow-x: hidden; overscroll-behavior: none; -webkit-tap-highlight-color: transparent; }',
    'html.pulsar-android { --barh: 96px; }',
    'html.pulsar-android .player { padding: max(20px, calc(var(--barh) + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) - 68px)) max(12px, var(--safe-area-inset-right, env(safe-area-inset-right, 0px))) calc(var(--barh) + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 12px) max(12px, var(--safe-area-inset-left, env(safe-area-inset-left, 0px))); }',
    'html.pulsar-android .library-panel { top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px)); right: var(--safe-area-inset-right, env(safe-area-inset-right, 0px)); height: calc(100% - var(--barh) - var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))); }',
    'html.pulsar-android .settings-menu { padding: max(8px, var(--safe-area-inset-top, env(safe-area-inset-top, 0px))) max(8px, var(--safe-area-inset-right, env(safe-area-inset-right, 0px))) max(8px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))) max(8px, var(--safe-area-inset-left, env(safe-area-inset-left, 0px))); }',
    'html.pulsar-android .sm-dialog { max-width: 100%; max-height: 100%; border-radius: 16px; }',
    'html.pulsar-android .modal-dim { padding: max(12px, var(--safe-area-inset-top, env(safe-area-inset-top, 0px))) max(12px, var(--safe-area-inset-right, env(safe-area-inset-right, 0px))) max(12px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))) max(12px, var(--safe-area-inset-left, env(safe-area-inset-left, 0px))); }',
    'html.pulsar-android .modal { max-height: calc(100dvh - var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) - 24px); }',
    'html.pulsar-android .queue-panel { top: calc(62px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px))); right: max(12px, var(--safe-area-inset-right, env(safe-area-inset-right, 0px))); max-height: min(72vh, calc(100dvh - var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) - 90px)); }',
    'html.pulsar-android .style-toast, html.pulsar-android .net-badge { bottom: calc(var(--barh) + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 12px); }',
    '@media (max-width: 640px) {',
    '  html.pulsar-android { --barh: 146px; }',
    '  html.pulsar-android .bottombar { display: grid !important; grid-template-columns: minmax(0, 1fr); grid-template-areas: "center" "left" "right"; row-gap: 4px; align-items: center; padding: 6px max(10px, var(--safe-area-inset-right, env(safe-area-inset-right, 0px))) calc(6px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))) max(10px, var(--safe-area-inset-left, env(safe-area-inset-left, 0px))); }',
    '  html.pulsar-android .bb-center { grid-area: center; width: 100%; max-width: none; flex: none; gap: 6px; }',
    '  html.pulsar-android .controls { gap: clamp(8px, 3vw, 14px); }',
    '  html.pulsar-android .ctrl-btn { width: 30px; height: 30px; }',
    '  html.pulsar-android .ctrl-btn.play-main { width: 40px; height: 40px; }',
    '  html.pulsar-android .seek-row { max-width: none; gap: 6px; }',
    '  html.pulsar-android .time { min-width: 32px; font-size: 10px; }',
    '  html.pulsar-android .bb-left { grid-area: left; display: flex; width: 100%; min-width: 0; flex: none; gap: 10px; }',
    '  html.pulsar-android .bb-thumb { width: 34px; height: 34px; }',
    '  html.pulsar-android .bb-left .bb-meta { display: block; }',
    '  html.pulsar-android .bb-right { grid-area: right; display: flex; width: 100%; min-width: 0; flex: none; justify-content: space-between; flex-wrap: wrap; gap: 2px 4px; }',
    '  html.pulsar-android .bb-right .icon-btn { width: 28px; height: 28px; }',
    '  html.pulsar-android body.fullscreen-mode .player { padding: max(20px, var(--safe-area-inset-top, env(safe-area-inset-top, 0px))) max(12px, var(--safe-area-inset-right, env(safe-area-inset-right, 0px))) max(20px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))) max(12px, var(--safe-area-inset-left, env(safe-area-inset-left, 0px))) !important; }',
    '}',
  ].join('\n');
  (document.head || root).appendChild(style);

  // Keep desktop disk-writing and mini-window APIs unavailable until they have
  // proper Android-native implementations; in-app network imports remain usable.
  window.__pulsarDesktop = undefined;
  window.__pulsarFs = undefined;
  window.__pulsarAndroid = true;
  window.__pulsarAndroidYouTube = {
    resolve: function (videoId) {
      var capacitor = window.Capacitor;
      var plugin = capacitor && capacitor.Plugins && capacitor.Plugins.PulsarMedia;
      if (!plugin || typeof plugin.resolveYoutubeAudio !== 'function') {
        return Promise.reject(new Error('The built-in YouTube extractor is unavailable.'));
      }
      return plugin.resolveYoutubeAudio({ videoId: String(videoId || '') });
    }
  };

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

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
})();

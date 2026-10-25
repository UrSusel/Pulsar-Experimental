/* Pulsar — pełnoekranowy tryb karaoke, wspólny dla desktopu i Androida. */
(function () {
  'use strict';
  const player = window.__player;
  const host = window.__pulsarHost;
  const core = window.PulsarKaraokeCore;
  const audio = document.getElementById('audio');
  if (!player || !player.__lyrics || !core || !audio) return;

  const KEY = 'pulsarKaraokeSettings';
  let settings = loadSettings();
  let open = false;
  let ui = {};
  let launchButton = null;
  let trackIndex = -2;
  let loadedTrack = -2;
  let loadToken = 0;
  let lines = [];
  let plain = [];
  let activeLine = -2;
  let progressElement = null;
  let raf = 0;
  let lastTick = 0;
  let seeking = false;

  function loadSettings() { try { return core.settingsOf(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return core.settingsOf(); } }
  function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} }
  function el(id) { return document.getElementById(id); }
  function toast(text) { try { if (host) host.toast(text); } catch (e) {} }
  function currentTrack() { return player.state().currentIndex; }
  function offset() { return player.__lyrics.offset ? player.__lyrics.offset() : 0; }
  function offsetText(value) { return (value > 0 ? '+' : '') + Number(value || 0).toFixed(2).replace('.', ',') + ' s'; }

  function buildButton() {
    const lyrics = el('lyricsBtn');
    if (!lyrics || !lyrics.parentNode || el('karaokeBtn')) return;
    launchButton = document.createElement('button');
    launchButton.type = 'button'; launchButton.className = 'icon-btn'; launchButton.dataset.ic = 'stroke'; launchButton.id = 'karaokeBtn';
    launchButton.title = 'Tryb karaoke — duży tekst'; launchButton.setAttribute('aria-label', 'Otwórz tryb karaoke');
    launchButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h7M7 17h4"/></svg>';
    launchButton.addEventListener('click', openKaraoke);
    lyrics.parentNode.insertBefore(launchButton, lyrics.nextSibling);
  }

  function buildPanel() {
    if (el('karaokeMode')) return;
    const dim = document.createElement('div');
    dim.id = 'karaokeMode'; dim.className = 'pk-dim'; dim.hidden = true;
    dim.innerHTML = `
      <div class="pk-cover" id="pkCover" aria-hidden="true"></div><div class="pk-shade" aria-hidden="true"></div>
      <section class="pk-stage" role="dialog" aria-modal="true" aria-labelledby="pkTitle">
        <header class="pk-head">
          <div class="pk-track"><strong id="pkTitle">Karaoke</strong><span id="pkArtist">Wybierz utwór</span></div>
          <div class="pk-head-actions">
            <button type="button" id="pkSmaller" aria-label="Zmniejsz tekst" title="Mniejszy tekst">A−</button><span id="pkScale">100%</span><button type="button" id="pkLarger" aria-label="Powiększ tekst" title="Większy tekst">A+</button>
            <button type="button" id="pkAlign" title="Zmień wyrównanie">Środek</button>
            <select id="pkTheme" aria-label="Motyw karaoke"><option value="nebula">Neon</option><option value="contrast">Kontrast</option><option value="light">Jasny</option></select>
            <button type="button" id="pkCoverToggle" title="Włącz lub wyłącz tło okładki">Okładka</button>
            <button type="button" id="pkFullscreen" title="Pełny ekran (F)">⛶</button><button type="button" id="pkClose" class="pk-close" aria-label="Zamknij karaoke" title="Zamknij (Esc)">×</button>
          </div>
        </header>
        <main class="pk-lines" id="pkLines" aria-live="off"></main>
        <footer class="pk-foot">
          <div class="pk-timing"><span id="pkCurrent">0:00</span><input type="range" id="pkSeek" min="0" max="1000" value="0" aria-label="Pozycja utworu"><span id="pkDuration">0:00</span></div>
          <div class="pk-controls">
            <div class="pk-transport"><button type="button" id="pkPrev" aria-label="Poprzedni utwór">⏮</button><button type="button" id="pkPlay" class="pk-play" aria-label="Odtwórz lub wstrzymaj">▶</button><button type="button" id="pkNext" aria-label="Następny utwór">⏭</button></div>
            <div class="pk-offset"><span>Synchronizacja <strong id="pkOffset">+0,00 s</strong></span><button type="button" id="pkOffsetMinus" aria-label="Napisy 0,1 sekundy wcześniej">−0,1 s</button><button type="button" id="pkOffsetPlus" aria-label="Napisy 0,1 sekundy później">+0,1 s</button><button type="button" id="pkOffsetReset">Reset</button></div>
          </div>
          <div class="pk-hint">Spacja: play/pauza · ←/→: 5 s · F: pełny ekran · kliknięcie wersu przewija utwór</div>
        </footer>
      </section>`;
    document.body.appendChild(dim);
    ui = { dim: dim, stage: dim.querySelector('.pk-stage'), cover: el('pkCover'), title: el('pkTitle'), artist: el('pkArtist'), lines: el('pkLines'), scale: el('pkScale'), align: el('pkAlign'), theme: el('pkTheme'), coverToggle: el('pkCoverToggle'), current: el('pkCurrent'), duration: el('pkDuration'), seek: el('pkSeek'), play: el('pkPlay'), offset: el('pkOffset') };
    el('pkClose').addEventListener('click', closeKaraoke);
    el('pkSmaller').addEventListener('click', function () { setSettings({ scale: settings.scale - 0.1 }); });
    el('pkLarger').addEventListener('click', function () { setSettings({ scale: settings.scale + 0.1 }); });
    ui.align.addEventListener('click', function () { setSettings({ align: settings.align === 'center' ? 'left' : 'center' }); });
    ui.theme.addEventListener('change', function () { setSettings({ theme: ui.theme.value }); });
    ui.coverToggle.addEventListener('click', function () { setSettings({ cover: !settings.cover }); });
    el('pkFullscreen').addEventListener('click', toggleFullscreen);
    el('pkPrev').addEventListener('click', function () { if (host) host.prev(); });
    el('pkNext').addEventListener('click', function () { if (host) host.next(); });
    ui.play.addEventListener('click', function () { if (host) host.toggle(); });
    ui.seek.addEventListener('pointerdown', function () { seeking = true; });
    ui.seek.addEventListener('input', function () { if (audio.duration > 0) audio.currentTime = Number(ui.seek.value) / 1000 * audio.duration; });
    ui.seek.addEventListener('change', function () { seeking = false; });
    ui.seek.addEventListener('pointerup', function () { seeking = false; });
    el('pkOffsetMinus').addEventListener('click', function () { changeOffset(-0.1); });
    el('pkOffsetPlus').addEventListener('click', function () { changeOffset(0.1); });
    el('pkOffsetReset').addEventListener('click', function () { if (player.__lyrics.setOffset) player.__lyrics.setOffset(0); renderLyrics(true); });
    document.addEventListener('fullscreenchange', function () { if (el('pkFullscreen')) el('pkFullscreen').textContent = document.fullscreenElement ? '⛶' : '⛶'; });
    document.addEventListener('pulsar:lyricsoffset', function () { if (open) renderLyrics(true); });
  }

  function renderSettings() {
    if (!ui.stage) return;
    ui.stage.dataset.theme = settings.theme; ui.stage.dataset.align = settings.align;
    ui.dim.dataset.theme = settings.theme; ui.dim.classList.toggle('pk-no-cover', !settings.cover);
    ui.stage.style.setProperty('--pk-font', (Math.round(18 * settings.scale * 100) / 100) + 'px');
    ui.scale.textContent = Math.round(settings.scale * 100) + '%'; ui.align.textContent = settings.align === 'center' ? 'Środek' : 'Lewo';
    ui.theme.value = settings.theme; ui.coverToggle.classList.toggle('active', settings.cover);
    ui.coverToggle.setAttribute('aria-pressed', String(settings.cover));
  }
  function setSettings(value) { settings = core.settingsOf(Object.assign({}, settings, value)); saveSettings(); renderSettings(); renderTrack(); renderLyrics(true); }

  function renderTrack() {
    const info = host && host.nowPlaying ? host.nowPlaying() : null;
    ui.title.textContent = info && info.title || 'Karaoke'; ui.artist.textContent = info && info.artist || 'Wybierz utwór';
    ui.cover.style.backgroundImage = settings.cover && info && info.cover ? 'url(' + JSON.stringify(info.cover) + ')' : 'none';
  }
  function renderLoading(message) {
    activeLine = -2; progressElement = null; lines = []; plain = [];
    ui.lines.className = 'pk-lines'; ui.lines.textContent = '';
    const empty = document.createElement('div'); empty.className = 'pk-empty'; empty.textContent = message; ui.lines.appendChild(empty);
  }
  async function loadLyrics() {
    const index = currentTrack();
    const token = ++loadToken;
    loadedTrack = -2;
    if (index < 0) { loadedTrack = index; renderLoading('Wybierz utwór, aby rozpocząć karaoke.'); return; }
    renderLoading('Wczytywanie tekstu…');
    try {
      await player.__lyrics.fetchFor(index);
      if (!open || token !== loadToken || index !== currentTrack()) return;
      loadedTrack = index; renderLyrics(true);
    } catch (e) {
      if (!open || token !== loadToken) return;
      loadedTrack = index; renderLoading('Nie udało się wczytać tekstu: ' + String(e && e.message || e));
    }
  }
  function renderLyrics(force) {
    if (!open || !ui.lines || loadedTrack !== currentTrack()) return;
    const data = player.__lyrics.data && player.__lyrics.data();
    lines = core.syncedLines(data); plain = lines.length ? [] : core.plainLines(data);
    ui.offset.textContent = offsetText(offset());
    el('pkOffsetMinus').disabled = el('pkOffsetPlus').disabled = el('pkOffsetReset').disabled = !lines.length;
    if (!lines.length) {
      activeLine = -2; progressElement = null; ui.lines.textContent = '';
      if (plain.length) {
        ui.lines.className = 'pk-lines pk-plain'; ui.lines.scrollTop = 0;
        plain.forEach(function (text) { const row = document.createElement('p'); row.textContent = text; ui.lines.appendChild(row); });
      } else {
        ui.lines.className = 'pk-lines';
        const empty = document.createElement('div'); empty.className = 'pk-empty'; empty.textContent = 'Brak tekstu dla tego utworu. Dodaj plik .lrc obok audio albo użyj wyszukiwania napisów w edytorze.'; ui.lines.appendChild(empty);
      }
      return;
    }
    ui.lines.className = 'pk-lines pk-synced';
    const active = core.activeIndex(lines, audio.currentTime || 0, offset());
    if (!force && active === activeLine) { updateProgress(); return; }
    activeLine = active; progressElement = null; ui.lines.textContent = '';
    core.visibleWindow(lines, active, 2).forEach(function (item) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pk-line pk-' + item.role;
      button.dataset.index = String(item.index); button.dataset.time = String(item.t);
      const text = document.createElement('span'); text.className = 'pk-line-text'; text.textContent = item.txt; button.appendChild(text);
      if (item.index === active) { const progress = document.createElement('span'); progress.className = 'pk-line-progress'; button.appendChild(progress); progressElement = progress; }
      button.addEventListener('click', function () { audio.currentTime = Math.max(0, item.t + offset()); renderLyrics(true); });
      ui.lines.appendChild(button);
    });
    updateProgress();
  }
  function updateProgress() { if (progressElement && activeLine >= 0) progressElement.style.width = (core.lineProgress(lines, activeLine, audio.currentTime || 0, offset(), audio.duration) * 100).toFixed(2) + '%'; }
  function changeOffset(delta) { if (!player.__lyrics.setOffset || !lines.length) return; player.__lyrics.setOffset(Math.round((offset() + delta) * 1000) / 1000); renderLyrics(true); }

  function tick(timestamp) {
    if (!open) return;
    if (currentTrack() !== trackIndex) { trackIndex = currentTrack(); renderTrack(); loadLyrics(); }
    if (timestamp - lastTick > 60) {
      lastTick = timestamp;
      renderLyrics(false);
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      ui.current.textContent = core.formatTime(audio.currentTime || 0); ui.duration.textContent = core.formatTime(duration);
      if (!seeking) ui.seek.value = String(duration > 0 ? Math.round((audio.currentTime || 0) / duration * 1000) : 0);
      ui.play.textContent = audio.paused ? '▶' : '❚❚'; ui.play.setAttribute('aria-label', audio.paused ? 'Odtwórz' : 'Wstrzymaj');
    }
    raf = requestAnimationFrame(tick);
  }
  function openKaraoke() {
    if (open) return;
    buildPanel(); open = true; trackIndex = currentTrack(); loadedTrack = -2;
    ui.dim.hidden = false; document.body.classList.add('pk-open'); if (launchButton) launchButton.classList.add('active');
    renderSettings(); renderTrack(); loadLyrics();
    requestAnimationFrame(function () { if (open) ui.dim.classList.add('show'); });
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    setTimeout(function () { if (open) el('pkClose').focus(); }, 80);
  }
  function closeKaraoke() {
    if (!open) return;
    open = false; ++loadToken; cancelAnimationFrame(raf); document.body.classList.remove('pk-open');
    if (launchButton) launchButton.classList.remove('active'); ui.dim.classList.remove('show');
    if (document.fullscreenElement === ui.dim && document.exitFullscreen) { try { document.exitFullscreen(); } catch (e) {} }
    setTimeout(function () { if (!open) ui.dim.hidden = true; }, 180);
  }
  async function toggleFullscreen() {
    if (!open) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (ui.dim.requestFullscreen) await ui.dim.requestFullscreen();
    } catch (e) { toast('Przeglądarka nie zezwoliła na pełny ekran; karaoke nadal działa jako nakładka.'); }
  }

  window.addEventListener('keydown', function (event) {
    if (!open) return;
    const key = String(event.key || '').toLowerCase();
    if (key === 'escape') { event.preventDefault(); event.stopImmediatePropagation(); closeKaraoke(); return; }
    const tag = String(event.target && event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space' || key === ' ') { event.preventDefault(); event.stopImmediatePropagation(); if (host) host.toggle(); }
    else if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); event.stopImmediatePropagation(); audio.currentTime = Math.max(0, Math.min(audio.duration || 0, (audio.currentTime || 0) + (key === 'arrowleft' ? -5 : 5))); }
    else if (key === 'f') { event.preventDefault(); event.stopImmediatePropagation(); toggleFullscreen(); }
    else if (key === '+' || key === '=' || key === '-') { event.preventDefault(); event.stopImmediatePropagation(); setSettings({ scale: settings.scale + (key === '-' ? -0.1 : 0.1) }); }
  }, true);

  buildButton(); buildPanel(); renderSettings();
  window.PulsarKaraoke = {
    open: openKaraoke, close: closeKaraoke, refresh: function () { renderTrack(); renderLyrics(true); },
    setSettings: setSettings,
    state: function () { return { open: open, trackIndex: trackIndex, loadedTrack: loadedTrack, activeLine: activeLine, lines: lines.length, plain: plain.length, scale: settings.scale, align: settings.align, theme: settings.theme, cover: settings.cover, offset: offset(), fullscreen: !!document.fullscreenElement }; }
  };
})();

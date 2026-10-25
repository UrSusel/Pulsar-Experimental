/* Pulsar Desktop — edytor audio i przesuwanie napisów. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.PulsarEditorCore) return;

  const core = window.PulsarEditorCore;
  const player = window.__player;
  const host = window.__pulsarHost;
  const mainAudio = document.getElementById('audio');
  if (!player || !player.__editor || !host || !mainAudio) return;

  let editorApi = null;
  let open = false;
  let activeTab = 'audio';
  let track = null;
  let duration = 0;
  let buffer = null;
  let peaks = null;
  let cuts = [];
  let history = [];
  let draft = null;
  let preview = false;
  let saveBusy = false;
  let decodeToken = 0;
  let lyricsToken = 0;
  let lyricsLoadedId = '';
  let raf = 0;
  let lastLyricsPaint = 0;
  let ui = {};
  let editButton = null;

  function byId(id) { return document.getElementById(id); }
  function toast(text) { try { host.toast(text); } catch (e) {} }
  function round3(value) { return Math.round((Number(value) || 0) * 1000) / 1000; }
  function numberValue(value) { return Number(String(value == null ? '' : value).replace(',', '.')); }
  function formatTime(seconds, milliseconds) {
    let value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) value = 0;
    const factor = milliseconds ? 1000 : 100;
    const digits = milliseconds ? 3 : 2;
    const units = Math.round(value * factor);
    const minutes = Math.floor(units / (60 * factor));
    const sec = (units - minutes * 60 * factor) / factor;
    return minutes + ':' + sec.toFixed(digits).padStart(digits + 3, '0');
  }
  function formatOffset(value) {
    const n = Number(value) || 0;
    return (n > 0 ? '+' : '') + n.toFixed(2).replace('.', ',') + ' s';
  }
  function samePath(a, b) {
    const normalize = function (value) { return String(value || '').trim().replace(/^"+|"+$/g, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); };
    const left = normalize(a), right = normalize(b);
    return !!left && left === right;
  }
  function fileNameFromPath(path, fallback) {
    const parts = String(path || '').split(/[\\/]/);
    return parts[parts.length - 1] || fallback;
  }
  function setStatus(element, text, kind, loading) {
    if (!element) return;
    element.classList.toggle('pae-error', kind === 'error');
    element.classList.toggle('pae-success', kind === 'success');
    element.textContent = '';
    if (loading) {
      const spin = document.createElement('span');
      spin.className = 'pae-spin';
      spin.setAttribute('aria-hidden', 'true');
      element.appendChild(spin);
    }
    element.appendChild(document.createTextNode(String(text || '')));
  }

  function buildButton() {
    const lyricsButton = byId('lyricsBtn');
    if (!lyricsButton || !lyricsButton.parentNode || byId('audioEditorBtn')) return;
    editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'icon-btn';
    editButton.dataset.ic = 'stroke';
    editButton.id = 'audioEditorBtn';
    editButton.title = 'Edytuj audio i napisy';
    editButton.setAttribute('aria-label', 'Edytuj audio i napisy');
    editButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.5 8.5L20 19M8.5 15.5L20 5M13.2 12l2.1 2"/></svg>';
    editButton.addEventListener('click', function () { openEditor('audio'); });
    lyricsButton.parentNode.insertBefore(editButton, lyricsButton);
  }

  function buildPanel() {
    if (byId('audioEditor')) return byId('audioEditor');
    const dim = document.createElement('div');
    dim.id = 'audioEditor';
    dim.className = 'pae-dim';
    dim.hidden = true;
    dim.innerHTML = `
      <section class="pae-modal" role="dialog" aria-modal="true" aria-labelledby="paeTitle">
        <header class="pae-head">
          <div class="pae-heading"><h2 id="paeTitle">Edycja utworu</h2><div class="pae-track" id="paeTrack"></div></div>
          <button type="button" class="pae-close" id="paeClose" aria-label="Zamknij edytor">×</button>
        </header>
        <nav class="pae-tabs" role="tablist" aria-label="Narzędzia edycji">
          <button type="button" class="pae-tab active" data-tab="audio" role="tab" aria-selected="true">✂ Audio</button>
          <button type="button" class="pae-tab" data-tab="lyrics" role="tab" aria-selected="false">♪ Napisy</button>
        </nav>
        <div class="pae-body">
          <div class="pae-pane" id="paeAudioPane" role="tabpanel">
            <p class="pae-note"><strong>Przeciągnij po fali, aby usunąć fragment.</strong> Kliknięcie przewija odtwarzanie. Zapis tworzy nowy plik WAV — oryginał nie jest nadpisywany.</p>
            <div>
              <div class="pae-wave-wrap" id="paeWaveWrap">
                <canvas class="pae-wave" id="paeWave" aria-label="Fala dźwiękowa — przeciągnij, aby wybrać wycinek"></canvas>
                <div class="pae-wave-empty" id="paeWaveEmpty">Wczytywanie fali dźwiękowej…</div>
                <div class="pae-playhead" id="paePlayhead"></div>
              </div>
              <div class="pae-time-axis"><span>0:00,000</span><span id="paeAxisDuration">0:00,000</span></div>
            </div>
            <div class="pae-summary">
              <div class="pae-stat"><span>Oryginał</span><strong id="paeOriginalDuration">0:00,00</strong></div>
              <div class="pae-stat removed"><span>Do usunięcia</span><strong id="paeRemovedDuration">0:00,00</strong></div>
              <div class="pae-stat result"><span>Po edycji</span><strong id="paeFinalDuration">0:00,00</strong></div>
            </div>
            <div class="pae-toolbar">
              <button type="button" class="pae-btn" id="paeDetect">Wykryj ciszę</button>
              <button type="button" class="pae-btn" id="paePreview" aria-pressed="false">▶ Podgląd bez wycinków</button>
              <span class="spacer"></span>
              <button type="button" class="pae-btn" id="paeUndo">Cofnij</button>
              <button type="button" class="pae-btn danger" id="paeClear">Wyczyść</button>
            </div>
            <section class="pae-section">
              <div class="pae-section-title"><h3>Dodaj wycinek</h3><span>czas w sekundach</span></div>
              <div class="pae-cut-form">
                <label class="pae-field">Początek
                  <input class="pae-input" id="paeCutStart" type="number" min="0" step="0.001" value="0">
                </label>
                <label class="pae-field">Koniec
                  <input class="pae-input" id="paeCutEnd" type="number" min="0" step="0.001" value="0">
                </label>
                <button type="button" class="pae-btn primary" id="paeAddCut">+ Usuń zakres</button>
              </div>
              <div class="pae-time-buttons" style="margin-top:8px">
                <button type="button" class="pae-btn" id="paeSetStart">Początek = pozycja odtwarzacza</button>
                <button type="button" class="pae-btn" id="paeSetEnd">Koniec = pozycja odtwarzacza</button>
              </div>
              <div class="pae-cuts" id="paeCuts"></div>
            </section>
            <div class="pae-status" id="paeAudioStatus" aria-live="polite"></div>
            <div class="pae-save">
              <label class="pae-check"><input type="checkbox" id="paeImport" checked> Dodaj wynik do biblioteki</label>
              <button type="button" class="pae-btn primary" id="paeSave">Zapisz jako nowy utwór WAV</button>
            </div>
          </div>

          <div class="pae-pane" id="paeLyricsPane" role="tabpanel" hidden>
            <p class="pae-note">Przesunięcie działa od razu i jest zapamiętywane osobno dla tego utworu. <strong>Wartość dodatnia pokazuje napisy później, ujemna — wcześniej.</strong></p>
            <div class="pae-offset-hero"><span class="pae-offset-value" id="paeOffsetValue">+0,00 s</span><span>aktualne przesunięcie napisów</span></div>
            <div class="pae-offset-controls">
              <label class="pae-field">Regulacja płynna
                <input class="pae-range" id="paeOffsetRange" type="range" min="-10" max="10" step="0.05" value="0">
              </label>
              <label class="pae-field pae-offset-number">Dokładnie (s)
                <input class="pae-input" id="paeOffsetNumber" type="number" min="-300" max="300" step="0.05" value="0">
              </label>
              <button type="button" class="pae-btn" id="paeOffsetReset">Resetuj</button>
            </div>
            <div class="pae-step-buttons">
              <button type="button" class="pae-btn" data-offset-step="-0.5">−0,5 s</button>
              <button type="button" class="pae-btn" data-offset-step="-0.1">−0,1 s</button>
              <button type="button" class="pae-btn" data-offset-step="0.1">+0,1 s</button>
              <button type="button" class="pae-btn" data-offset-step="0.5">+0,5 s</button>
            </div>
            <section class="pae-section">
              <div class="pae-section-title"><h3>Podgląd synchronizacji</h3><span>czasy po przesunięciu</span></div>
              <div class="pae-lyrics-preview" id="paeLyricsPreview"></div>
            </section>
            <div class="pae-status" id="paeLyricsStatus" aria-live="polite"></div>
            <div class="pae-lyrics-actions">
              <span class="pae-note">Zmiana zapisuje się automatycznie.</span>
              <button type="button" class="pae-btn primary" id="paeExportLrc">Eksportuj przesunięte .lrc</button>
            </div>
          </div>
        </div>
      </section>`;
    document.body.appendChild(dim);

    ui = {
      dim: dim,
      track: byId('paeTrack'),
      audioPane: byId('paeAudioPane'), lyricsPane: byId('paeLyricsPane'),
      wave: byId('paeWave'), waveWrap: byId('paeWaveWrap'), waveEmpty: byId('paeWaveEmpty'), playhead: byId('paePlayhead'),
      axisDuration: byId('paeAxisDuration'), originalDuration: byId('paeOriginalDuration'), removedDuration: byId('paeRemovedDuration'), finalDuration: byId('paeFinalDuration'),
      detect: byId('paeDetect'), preview: byId('paePreview'), undo: byId('paeUndo'), clear: byId('paeClear'),
      start: byId('paeCutStart'), end: byId('paeCutEnd'), addCut: byId('paeAddCut'), cuts: byId('paeCuts'),
      audioStatus: byId('paeAudioStatus'), import: byId('paeImport'), save: byId('paeSave'),
      offsetValue: byId('paeOffsetValue'), offsetRange: byId('paeOffsetRange'), offsetNumber: byId('paeOffsetNumber'),
      lyricsPreview: byId('paeLyricsPreview'), lyricsStatus: byId('paeLyricsStatus'), exportLrc: byId('paeExportLrc')
    };

    byId('paeClose').addEventListener('click', closeEditor);
    dim.addEventListener('pointerdown', function (event) { if (event.target === dim) closeEditor(); });
    dim.querySelectorAll('.pae-tab').forEach(function (button) {
      button.addEventListener('click', function () { setTab(button.dataset.tab); });
    });
    ui.detect.addEventListener('click', detectSilence);
    ui.preview.addEventListener('click', function () { setPreview(!preview); });
    ui.undo.addEventListener('click', undoCuts);
    ui.clear.addEventListener('click', clearCuts);
    ui.addCut.addEventListener('click', addCutFromInputs);
    byId('paeSetStart').addEventListener('click', function () { ui.start.value = String(round3(mainAudio.currentTime || 0)); });
    byId('paeSetEnd').addEventListener('click', function () { ui.end.value = String(round3(mainAudio.currentTime || 0)); });
    [ui.start, ui.end].forEach(function (input) {
      input.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); addCutFromInputs(); } });
    });
    ui.save.addEventListener('click', saveEditedAudio);
    ui.offsetRange.addEventListener('input', function () { setLyricsOffset(numberValue(ui.offsetRange.value), 'range'); });
    ui.offsetNumber.addEventListener('change', function () { setLyricsOffset(numberValue(ui.offsetNumber.value), 'number'); });
    byId('paeOffsetReset').addEventListener('click', function () { setLyricsOffset(0); });
    dim.querySelectorAll('[data-offset-step]').forEach(function (button) {
      button.addEventListener('click', function () {
        const current = player.__lyrics.offset ? player.__lyrics.offset() : 0;
        setLyricsOffset(current + Number(button.dataset.offsetStep));
      });
    });
    ui.exportLrc.addEventListener('click', exportShiftedLrc);
    bindWaveEvents();
    return dim;
  }

  function setTab(name) {
    activeTab = name === 'lyrics' ? 'lyrics' : 'audio';
    ui.audioPane.hidden = activeTab !== 'audio';
    ui.lyricsPane.hidden = activeTab !== 'lyrics';
    ui.dim.querySelectorAll('.pae-tab').forEach(function (button) {
      const selected = button.dataset.tab === activeTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    if (activeTab === 'audio') requestAnimationFrame(drawWave);
    else ensureLyrics();
  }

  async function decodeFile(file) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) throw new Error('Ta wersja WebView nie obsługuje dekodowania audio.');
    let context = null;
    try { const tap = host.audioTap && host.audioTap(); if (tap && tap.ctx) context = tap.ctx; } catch (e) {}
    const ownContext = context ? null : new AudioCtor();
    if (!context) context = ownContext;
    try {
      const bytes = await file.arrayBuffer();
      return await new Promise(function (resolve, reject) {
        try { context.decodeAudioData(bytes.slice(0), resolve, reject); } catch (error) { reject(error); }
      });
    } finally {
      if (ownContext && ownContext.close) try { await ownContext.close(); } catch (e) {}
    }
  }

  async function loadAudioBuffer(token) {
    buffer = null;
    peaks = null;
    ui.waveEmpty.hidden = false;
    ui.waveEmpty.textContent = 'Wczytywanie fali dźwiękowej…';
    setStatus(ui.audioStatus, 'Dekodowanie audio do edycji…', '', true);
    updateAudioUi();
    try {
      const decoded = await decodeFile(track.file);
      if (!open || token !== decodeToken) return;
      buffer = decoded;
      duration = decoded.length / decoded.sampleRate;
      peaks = core.waveformPeaks(decoded, 1600);
      ui.waveEmpty.hidden = true;
      ui.start.max = String(duration);
      ui.end.max = String(duration);
      ui.end.value = String(round3(Math.min(duration, Math.max(1, (mainAudio.currentTime || 0) + 1))));
      setStatus(ui.audioStatus, 'Fala gotowa. Zaznacz fragment albo użyj wykrywania ciszy.', 'success');
      updateAudioUi();
      drawWave();
    } catch (error) {
      if (!open || token !== decodeToken) return;
      console.warn('Pulsar Editor: dekodowanie nie powiodło się', error);
      ui.waveEmpty.textContent = 'Nie udało się zdekodować tego pliku.';
      setStatus(ui.audioStatus, 'Nie można edytować tego formatu w tej wersji WebView. Napisy nadal możesz przesuwać.', 'error');
      updateAudioUi();
      drawWave();
    }
  }

  function openEditor(tab) {
    const current = player.__editor.current();
    if (!current || !current.file) { toast('Najpierw wybierz utwór do edycji'); return; }
    if (open) { setTab(tab || activeTab); return; }
    buildPanel();
    track = current;
    duration = Number(current.duration || mainAudio.duration || 0) || 0;
    cuts = [];
    history = [];
    draft = null;
    preview = false;
    saveBusy = false;
    open = true;
    const token = ++decodeToken;
    ++lyricsToken;
    lyricsLoadedId = '';
    ui.dim.hidden = false;
    ui.track.textContent = (current.artist ? current.artist + ' — ' : '') + (current.title || current.file.name);
    ui.track.title = ui.track.textContent;
    ui.start.value = '0';
    ui.end.value = String(round3(Math.min(duration || 1, 1)));
    ui.start.max = ui.end.max = String(duration || 0);
    setStatus(ui.audioStatus, '');
    setStatus(ui.lyricsStatus, '');
    setPreview(false);
    setTab(tab || 'audio');
    updateAudioUi();
    updateLyricsOffsetUi();
    if (editButton) editButton.classList.add('active');
    requestAnimationFrame(function () { if (open) ui.dim.classList.add('show'); });
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(animationTick);
    loadAudioBuffer(token);
    setTimeout(function () { if (open) byId('paeClose').focus(); }, 80);
  }

  function closeEditor() {
    if (!open || saveBusy) return;
    open = false;
    ++decodeToken;
    ++lyricsToken;
    preview = false;
    draft = null;
    cancelAnimationFrame(raf);
    ui.dim.classList.remove('show');
    if (editButton) editButton.classList.remove('active');
    setTimeout(function () { if (!open) ui.dim.hidden = true; }, 190);
  }

  function updateAudioUi() {
    if (!ui.dim) return;
    const removed = duration > 0 ? Math.max(0, duration - core.editedDuration(duration, cuts)) : 0;
    const finalDuration = Math.max(0, duration - removed);
    ui.originalDuration.textContent = formatTime(duration, false);
    ui.removedDuration.textContent = formatTime(removed, false);
    ui.finalDuration.textContent = formatTime(finalDuration, false);
    ui.axisDuration.textContent = formatTime(duration, true);
    ui.detect.disabled = !buffer || saveBusy;
    ui.preview.disabled = !cuts.length || saveBusy;
    ui.preview.classList.toggle('active', preview);
    ui.preview.setAttribute('aria-pressed', String(preview));
    ui.undo.disabled = !history.length || saveBusy;
    ui.clear.disabled = !cuts.length || saveBusy;
    ui.save.disabled = !buffer || !cuts.length || finalDuration < 0.1 || saveBusy;
    ui.save.textContent = saveBusy ? 'Zapisywanie…' : 'Zapisz jako nowy utwór WAV';
    ui.addCut.disabled = saveBusy;
    renderCuts();
  }

  function renderCuts() {
    ui.cuts.textContent = '';
    if (!cuts.length) {
      const empty = document.createElement('div');
      empty.className = 'pae-empty-cuts';
      empty.textContent = 'Brak wycinków — cały utwór zostanie zachowany.';
      ui.cuts.appendChild(empty);
      return;
    }
    cuts.forEach(function (cut, index) {
      const row = document.createElement('div');
      row.className = 'pae-cut-row';
      const num = document.createElement('span'); num.className = 'pae-cut-num'; num.textContent = String(index + 1) + '.';
      const times = document.createElement('span'); times.className = 'pae-cut-time'; times.textContent = formatTime(cut.start, true) + ' → ' + formatTime(cut.end, true);
      const length = document.createElement('span'); length.className = 'pae-cut-len'; length.textContent = '−' + formatTime(cut.end - cut.start, false);
      const seek = document.createElement('button'); seek.type = 'button'; seek.className = 'pae-btn icon'; seek.textContent = '▶'; seek.title = 'Przewiń do początku wycinka'; seek.setAttribute('aria-label', seek.title);
      seek.addEventListener('click', function () { try { mainAudio.currentTime = cut.start; } catch (e) {} });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pae-btn icon danger'; remove.textContent = '×'; remove.title = 'Przywróć ten fragment'; remove.setAttribute('aria-label', remove.title); remove.disabled = saveBusy;
      remove.addEventListener('click', function () {
        mutateCuts(cuts.filter(function (_, i) { return i !== index; }), 'Przywrócono fragment.');
      });
      row.appendChild(num); row.appendChild(times); row.appendChild(length); row.appendChild(seek); row.appendChild(remove);
      ui.cuts.appendChild(row);
    });
  }

  function mutateCuts(next, message) {
    let normalized;
    try { normalized = core.normalizeCuts(next, duration); } catch (e) { return false; }
    if (duration - core.editedDuration(duration, normalized) >= duration - 0.05 || core.editedDuration(duration, normalized) < 0.1) {
      setStatus(ui.audioStatus, 'Nie można usunąć całego utworu — zostaw co najmniej 0,1 s dźwięku.', 'error');
      return false;
    }
    history.push(cuts.map(function (cut) { return { start: cut.start, end: cut.end }; }));
    if (history.length > 30) history.shift();
    cuts = normalized;
    setPreview(false);
    if (message) setStatus(ui.audioStatus, message, 'success');
    updateAudioUi();
    drawWave();
    return true;
  }

  function addCutFromInputs() {
    const start = numberValue(ui.start.value), end = numberValue(ui.end.value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.01 || start < 0 || end > duration) {
      setStatus(ui.audioStatus, 'Podaj poprawny zakres: koniec musi być później niż początek i mieścić się w utworze.', 'error');
      return;
    }
    if (mutateCuts(cuts.concat([{ start: start, end: end }]), 'Dodano wycinek ' + formatTime(start, true) + ' → ' + formatTime(end, true) + '.')) {
      ui.start.value = String(round3(end));
      ui.end.value = String(round3(Math.min(duration, end + 1)));
    }
  }

  function undoCuts() {
    if (!history.length || saveBusy) return;
    cuts = history.pop();
    setPreview(false);
    setStatus(ui.audioStatus, 'Cofnięto ostatnią zmianę.', 'success');
    updateAudioUi();
    drawWave();
  }

  function clearCuts() {
    if (!cuts.length || saveBusy) return;
    mutateCuts([], 'Wyczyszczono wszystkie wycinki.');
  }

  function detectSilence() {
    if (!buffer || saveBusy) return;
    setStatus(ui.audioStatus, 'Analizowanie cichych fragmentów…', '', true);
    setTimeout(function () {
      if (!open || !buffer) return;
      try {
        const found = core.detectSilence(buffer, { db: -45, minDuration: 0.6, padding: 0.03 });
        if (!found.length) { setStatus(ui.audioStatus, 'Nie znaleziono ciszy dłuższej niż 0,6 s przy progu −45 dB.', ''); return; }
        const before = JSON.stringify(cuts);
        const combined = core.normalizeCuts(cuts.concat(found), duration);
        if (JSON.stringify(combined) === before) { setStatus(ui.audioStatus, 'Wykryte ciche fragmenty są już zaznaczone.', ''); return; }
        mutateCuts(combined, 'Dodano ciszę: ' + found.length + (found.length === 1 ? ' zakres.' : ' zakresy.') + ' Sprawdź je przed zapisem.');
      } catch (error) {
        setStatus(ui.audioStatus, 'Nie udało się przeanalizować ciszy: ' + (error.message || error), 'error');
      }
    }, 30);
  }

  function setPreview(value) {
    preview = !!value && cuts.length > 0;
    if (ui.preview) {
      ui.preview.classList.toggle('active', preview);
      ui.preview.setAttribute('aria-pressed', String(preview));
    }
  }

  function animationTick(timestamp) {
    if (!open) return;
    if (duration > 0) {
      const position = Math.max(0, Math.min(1, (mainAudio.currentTime || 0) / duration));
      ui.playhead.style.left = (position * 100) + '%';
    }
    if (preview && cuts.length) {
      const now = mainAudio.currentTime || 0;
      const hit = cuts.find(function (cut) { return now >= cut.start && now < cut.end - 0.002; });
      if (hit) {
        try {
          if (hit.end >= duration - 0.03) { mainAudio.currentTime = duration; mainAudio.pause(); }
          else mainAudio.currentTime = hit.end + 0.001;
        } catch (e) {}
      }
    }
    if (activeTab === 'lyrics' && timestamp - lastLyricsPaint > 450) {
      lastLyricsPaint = timestamp;
      renderLyricsPreview();
    }
    raf = requestAnimationFrame(animationTick);
  }

  function drawWave() {
    if (!open || activeTab !== 'audio' || !ui.wave) return;
    const rect = ui.wave.getBoundingClientRect();
    const width = Math.max(2, Math.round(rect.width));
    const height = Math.max(2, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (ui.wave.width !== Math.round(width * dpr) || ui.wave.height !== Math.round(height * dpr)) {
      ui.wave.width = Math.round(width * dpr);
      ui.wave.height = Math.round(height * dpr);
    }
    const ctx = ui.wave.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#0d1222'); bg.addColorStop(1, '#080b14');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) { const x = Math.round(width * i / 8) + .5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }

    if (peaks && peaks.length && duration > 0) {
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(77,227,255,.72)');
      gradient.addColorStop(.55, 'rgba(160,107,255,.78)');
      gradient.addColorStop(1, 'rgba(255,95,208,.68)');
      ctx.fillStyle = gradient;
      const middle = height / 2;
      for (let x = 0; x < width; x++) {
        const index = Math.min(peaks.length - 1, Math.floor(x / width * peaks.length));
        const peak = Math.max(.012, peaks[index]);
        const half = Math.max(1, peak * (height - 18) / 2);
        ctx.fillRect(x, middle - half, 1, half * 2);
      }
      ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(0, middle, width, 1);
    }

    if (duration > 0) {
      cuts.forEach(function (cut) {
        const x = cut.start / duration * width;
        const w = Math.max(1, (cut.end - cut.start) / duration * width);
        ctx.fillStyle = 'rgba(255,72,105,.25)'; ctx.fillRect(x, 0, w, height);
        ctx.fillStyle = 'rgba(255,125,145,.9)'; ctx.fillRect(x, 0, 1, height); ctx.fillRect(Math.min(width - 1, x + w - 1), 0, 1, height);
        ctx.strokeStyle = 'rgba(255,180,190,.32)';
        for (let sx = x - height; sx < x + w; sx += 9) { ctx.beginPath(); ctx.moveTo(Math.max(x, sx), 0); ctx.lineTo(Math.min(x + w, sx + height), height); ctx.stroke(); }
      });
      if (draft) {
        const start = Math.min(draft.start, draft.end), end = Math.max(draft.start, draft.end);
        const x = start / duration * width, w = Math.max(1, (end - start) / duration * width);
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, 0, w, height);
        ctx.strokeStyle = '#fff'; ctx.strokeRect(x + .5, .5, Math.max(0, w - 1), height - 1);
      }
    }
  }

  function eventTime(event) {
    const rect = ui.wave.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * duration;
  }

  function bindWaveEvents() {
    ui.wave.addEventListener('pointerdown', function (event) {
      if (!buffer || saveBusy || event.button !== 0) return;
      event.preventDefault();
      const time = eventTime(event);
      draft = { start: time, end: time, pointerId: event.pointerId };
      try { ui.wave.setPointerCapture(event.pointerId); } catch (e) {}
      drawWave();
    });
    ui.wave.addEventListener('pointermove', function (event) {
      if (!draft || draft.pointerId !== event.pointerId) return;
      draft.end = eventTime(event);
      drawWave();
    });
    ui.wave.addEventListener('pointerup', function (event) {
      if (!draft || draft.pointerId !== event.pointerId) return;
      const selection = draft;
      draft = null;
      const start = Math.min(selection.start, selection.end), end = Math.max(selection.start, selection.end);
      if (end - start >= 0.08) {
        ui.start.value = String(round3(start)); ui.end.value = String(round3(end));
        mutateCuts(cuts.concat([{ start: start, end: end }]), 'Dodano wycinek ' + formatTime(start, true) + ' → ' + formatTime(end, true) + '.');
      } else {
        try { mainAudio.currentTime = start; } catch (e) {}
        drawWave();
      }
    });
    ui.wave.addEventListener('pointercancel', function () { draft = null; drawWave(); });
    window.addEventListener('resize', function () { if (open) drawWave(); });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  async function writeBlob(path, blob) {
    const fs = window.__pulsarFs;
    if (!fs || !fs.writeBinary) { downloadBlob(blob, fileNameFromPath(path, 'edycja.wav')); return; }
    const chunkSize = 8 * 1024 * 1024;
    if (!fs.appendBinary && blob.size > chunkSize) throw new Error('Zapis dużych plików nie jest obsługiwany.');
    const first = new Uint8Array(await blob.slice(0, Math.min(chunkSize, blob.size)).arrayBuffer());
    await fs.writeBinary(path, first);
    for (let offset = chunkSize; offset < blob.size; offset += chunkSize) {
      const chunk = new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + chunkSize)).arrayBuffer());
      await fs.appendBinary(path, chunk);
    }
  }

  async function localSyncedLyrics() {
    // Nie używaj globalnego lyricsData bez kontroli utworu: przy wyłączonych
    // napisach mogło ono zostać po poprzednim odtwarzanym pliku.
    const data = player.__lyrics.forTrack ? player.__lyrics.forTrack(track.id) : null;
    if (data && Array.isArray(data.synced) && data.synced.length) return data.synced;
    if (track && track.lrcFile && typeof track.lrcFile.text === 'function') {
      try {
        const parsed = player.__lyrics.parse(await track.lrcFile.text());
        if (parsed.length) return parsed;
      } catch (e) {}
    }
    return null;
  }

  async function saveEditedAudio() {
    if (!buffer || !cuts.length || saveBusy) return;
    saveBusy = true;
    let completed = false;
    updateAudioUi();
    setStatus(ui.audioStatus, 'Sklejanie audio i zapisywanie WAV…', '', true);
    try {
      const wav = core.renderCutWav(buffer, cuts, { fadeMs: 5 });
      const blob = new Blob([wav], { type: 'audio/wav' });
      const defaultName = core.editedFileName(track.file.name, ' (edycja)');
      const fs = window.__pulsarFs;
      let path = '';
      if (fs && fs.saveDialog) {
        path = await fs.saveDialog('Zapisz przycięty utwór', defaultName, 'wav', 'WAV PCM');
        if (!path) { setStatus(ui.audioStatus, 'Anulowano zapis — zmiany nadal są w edytorze.', ''); return; }
        if (track.srcPath && samePath(path, track.srcPath)) throw new Error('Wybierz inną nazwę lub folder. Edytor nie nadpisuje oryginalnego pliku.');
      }
      const outputName = fileNameFromPath(path, defaultName);
      setStatus(ui.audioStatus, 'Zapisywanie ' + outputName + '…', '', true);
      if (path) await writeBlob(path, blob);
      else downloadBlob(blob, outputName);

      let imported = false;
      let alreadyThere = false;
      if (ui.import.checked) {
        let adjusted = null;
        const sourceLines = await localSyncedLyrics();
        if (sourceLines) {
          const offset = player.__lyrics.offset ? player.__lyrics.offset() : 0;
          const lines = core.remapLyrics(sourceLines, cuts, offset, duration);
          if (lines.length) adjusted = { synced: lines, plain: null, source: 'lrc' };
        }
        const outputFile = new File([blob], outputName, { type: 'audio/wav' });
        const id = player.__editor.importEdited(outputFile, track.id, {
          path: path,
          title: (track.title || outputName.replace(/\.wav$/i, '')) + ' (edycja)',
          duration: core.editedDuration(duration, cuts),
          lyrics: adjusted,
          lrcText: adjusted ? core.formatLRC(adjusted.synced) : ''
        });
        imported = !!id;
        alreadyThere = !id;
      }
      setStatus(ui.audioStatus, imported ? 'Zapisano i dodano nowy utwór do biblioteki.' : alreadyThere ? 'Plik zapisany. Identyczna wersja jest już w bibliotece.' : 'Zapisano przycięty plik WAV.', 'success');
      toast(imported ? 'Zapisano i dodano przycięty utwór do biblioteki' : alreadyThere ? 'Zapisano WAV — taka wersja już jest w bibliotece' : 'Zapisano przycięty plik WAV');
      completed = true;
    } catch (error) {
      console.warn('Pulsar Editor: zapis nie powiódł się', error);
      setStatus(ui.audioStatus, 'Nie udało się zapisać: ' + (error.message || error), 'error');
    } finally {
      saveBusy = false;
      if (open) updateAudioUi();
    }
    if (completed && open) closeEditor();
  }

  async function ensureLyrics() {
    if (!open || !track) return;
    const token = ++lyricsToken;
    updateLyricsOffsetUi();
    if (lyricsLoadedId === track.id) { renderLyricsPreview(); return; }
    setStatus(ui.lyricsStatus, 'Wczytywanie napisów…', '', true);
    try {
      if (player.__lyrics.set) player.__lyrics.set(true);
      // fetchFor jest szybkie dla cache, a przede wszystkim gwarantuje, że
      // globalny podgląd należy do utworu otwartego w edytorze.
      await player.__lyrics.fetchFor(track.index);
      if (!open || token !== lyricsToken) return;
      lyricsLoadedId = track.id;
      renderLyricsPreview();
      const data = player.__lyrics.data();
      if (data && data.synced) setStatus(ui.lyricsStatus, 'Przeciągnij suwak podczas odtwarzania, aby dopasować tekst.', 'success');
      else if (data && data.plain) setStatus(ui.lyricsStatus, 'Ten tekst nie ma znaczników czasu. Przesuwać i eksportować można tylko napisy zsynchronizowane (LRC).', '');
      else setStatus(ui.lyricsStatus, 'Nie znaleziono napisów dla tego utworu.', '');
    } catch (error) {
      if (!open || token !== lyricsToken) return;
      setStatus(ui.lyricsStatus, 'Nie udało się wczytać napisów: ' + (error.message || error), 'error');
      renderLyricsPreview();
    }
  }

  function updateLyricsOffsetUi(source) {
    if (!ui.offsetValue || !player.__lyrics.offset) return;
    const value = player.__lyrics.offset();
    ui.offsetValue.textContent = formatOffset(value);
    if (source !== 'range') ui.offsetRange.value = String(Math.max(-10, Math.min(10, value)));
    if (source !== 'number') ui.offsetNumber.value = String(Math.round(value * 100) / 100);
  }

  function setLyricsOffset(value, source) {
    if (!player.__lyrics.setOffset) return;
    if (!Number.isFinite(value)) { updateLyricsOffsetUi(); return; }
    player.__lyrics.setOffset(Math.max(-300, Math.min(300, value)));
    updateLyricsOffsetUi(source);
    renderLyricsPreview();
  }

  function renderLyricsPreview() {
    if (!open || !ui.lyricsPreview) return;
    const data = player.__lyrics.data && player.__lyrics.data();
    ui.lyricsPreview.textContent = '';
    ui.exportLrc.disabled = !(data && Array.isArray(data.synced) && data.synced.length);
    if (!data || !Array.isArray(data.synced) || !data.synced.length) {
      const empty = document.createElement('div');
      empty.className = 'pae-empty-cuts';
      empty.textContent = data && data.plain ? 'Tekst bez znaczników czasu — brak synchronizacji do regulacji.' : 'Brak zsynchronizowanych napisów do podglądu.';
      ui.lyricsPreview.appendChild(empty);
      return;
    }
    const offset = player.__lyrics.offset ? player.__lyrics.offset() : 0;
    const shifted = core.shiftLyrics(data.synced, offset);
    const now = mainAudio.currentTime || 0;
    let current = -1;
    shifted.forEach(function (line, index) { if (line.t <= now + .05) current = index; });
    const start = Math.max(0, Math.min(Math.max(0, current - 2), Math.max(0, shifted.length - 8)));
    shifted.slice(start, start + 8).forEach(function (line, localIndex) {
      const index = start + localIndex;
      const row = document.createElement('div');
      row.className = 'pae-lyric-row' + (index === current ? ' active' : '');
      const time = document.createElement('time'); time.textContent = formatTime(line.t, false);
      const text = document.createElement('span'); text.textContent = line.txt;
      row.appendChild(time); row.appendChild(text);
      row.addEventListener('click', function () { try { mainAudio.currentTime = line.t; } catch (e) {} });
      ui.lyricsPreview.appendChild(row);
    });
  }

  async function exportShiftedLrc() {
    const data = player.__lyrics.data && player.__lyrics.data();
    if (!data || !Array.isArray(data.synced) || !data.synced.length || !track) return;
    try {
      const offset = player.__lyrics.offset ? player.__lyrics.offset() : 0;
      const lines = core.shiftLyrics(data.synced, offset);
      const blob = new Blob([core.formatLRC(lines)], { type: 'text/plain;charset=utf-8' });
      const base = String(track.file.name || 'napisy').replace(/\.[^.]+$/, '');
      const name = core.safeFileName(base + ' (przesunięte)') + '.lrc';
      const fs = window.__pulsarFs;
      let path = '';
      if (fs && fs.saveDialog) {
        path = await fs.saveDialog('Eksportuj przesunięte napisy', name, 'lrc', 'Napisy LRC');
        if (!path) return;
      }
      if (path) await writeBlob(path, blob); else downloadBlob(blob, name);
      setStatus(ui.lyricsStatus, 'Zapisano przesunięte napisy LRC.', 'success');
      toast('Wyeksportowano przesunięte napisy LRC');
    } catch (error) {
      setStatus(ui.lyricsStatus, 'Nie udało się wyeksportować LRC: ' + (error.message || error), 'error');
    }
  }

  // Blokuje skróty głównego okna, które mogłyby zmienić utwór pod otwartym edytorem.
  window.addEventListener('keydown', function (event) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); closeEditor(); return;
    }
    const tag = String(event.target && event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = String(event.key || '').toLowerCase();
    if (event.code === 'Space' || key === ' ') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (mainAudio.paused) { const promise = mainAudio.play(); if (promise && promise.catch) promise.catch(function () {}); }
      else mainAudio.pause();
    } else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'n', 'p', 's', 'r', 'l', 'q', 'f', 'm', '?'].indexOf(key) > -1) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (key === 'arrowleft') mainAudio.currentTime = Math.max(0, (mainAudio.currentTime || 0) - 5);
      if (key === 'arrowright') mainAudio.currentTime = Math.min(duration, (mainAudio.currentTime || 0) + 5);
    }
  }, true);

  buildButton();
  buildPanel();
  window.PulsarAudioEditor = {
    open: openEditor,
    close: closeEditor,
    state: function () { return { open: open, tab: activeTab, trackId: track && track.id, cuts: cuts.map(function (cut) { return { start: cut.start, end: cut.end }; }), preview: preview, decoded: !!buffer, busy: saveBusy }; }
  };
})();

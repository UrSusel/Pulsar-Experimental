#!/usr/bin/env python3
"""Idempotentne zaczepy edytora w zamkniętym runtime index.html."""
from __future__ import annotations

import re
from pathlib import Path

EDITOR_DIR = Path(__file__).resolve().parents[1]
LYRICS_PARSER = "\n".join(
    ("  " + line) if line else line
    for line in (EDITOR_DIR / "lyrics-core.js").read_text(encoding="utf-8").splitlines()
).rstrip()

HELPER_BEGIN = "  /* ---- Pulsar editor: lyrics offset ---- */"
HELPER_END = "  /* ---- end Pulsar editor: lyrics offset ---- */"
API_BEGIN = "    /* ---- Pulsar editor: library bridge ---- */"
API_END = "    /* ---- end Pulsar editor: library bridge ---- */"

LYRICS_METHODS = '''      data: () => lyricsData, parse: parseLRC, parseWords: parseLyricsfile, fetchFor: i => fetchLyrics(tracks[i]),
      forTrack: id => { const tr = tracks.find(x => x.id === id); if (!tr) return null; return lyricsCache.has(id) ? lyricsCache.get(id) : (tr.lyricsData || null); },
      render: function(data){ if (data !== undefined) lyricsData = data; renderLyricsLines(); }, highlight: () => updateLyricsHighlight(true),
      offset: () => lyricsOffset(), setOffset: v => setLyricsOffset(v)
'''

LYRICS_HELPER = r'''  /* ---- Pulsar editor: lyrics offset ---- */
  function lyricsOffset(track){
    const tr = track || tracks[currentIndex];
    if (!tr) return 0;
    try {
      const raw = localStorage.getItem('playerLyricsOffset:' + tr.id);
      if (raw === null) return 0;
      const value = Number(raw);
      return isFinite(value) ? Math.max(-300, Math.min(300, value)) : 0;
    } catch(e){ return 0; }
  }
  function setLyricsOffset(value, track){
    const tr = track || tracks[currentIndex];
    if (!tr) return 0;
    const numeric = Number(value);
    const next = Math.round((isFinite(numeric) ? Math.max(-300, Math.min(300, numeric)) : 0) * 1000) / 1000;
    try { localStorage.setItem('playerLyricsOffset:' + tr.id, String(next)); } catch(e){}
    if (tracks[currentIndex] === tr){
      lyricsCurIdx = -1;
      updateLyricsHighlight(true);
    }
    try { document.dispatchEvent(new CustomEvent('pulsar:lyricsoffset', { detail: { trackId: tr.id, offset: next } })); } catch(e){}
    return next;
  }
  /* ---- end Pulsar editor: lyrics offset ---- */'''

LYRICS_RENDERER = r'''  /* Pulsar editor: word lyrics renderer */
  function renderLyricsLines(){
    if (!lyricsBox) return;
    lyricsBox.hidden = !lyricsOn;
    if (document.body.classList) document.body.classList.toggle('lyrics-side', !!lyricsOn);
    lyricsBox.innerHTML = '';
    lyricsCurIdx = -1;
    if (!lyricsData){ lyricsBox.innerHTML = '<div class="lyrics-empty">Brak tekstu</div>'; return; }
    if (lyricsData.synced){
      lyricsData.synced.forEach(function(l, i){
        const d = document.createElement('div');
        d.className = 'lyrics-line'; d.dataset.i = String(i); d.dataset.t = String(l.t);
        if (Array.isArray(l.words) && l.words.length){
          d.classList.add('lyrics-line-words');
          l.words.forEach(function(word){
            const span = document.createElement('span');
            span.className = 'lyrics-word'; span.dataset.t = String(word.t); span.textContent = word.txt;
            d.appendChild(span);
          });
        } else d.textContent = l.txt;
        d.addEventListener('click', function(){ audio.currentTime = Math.max(0, l.t + lyricsOffset()); updateLyricsHighlight(true); });
        lyricsBox.appendChild(d);
      });
      updateLyricsHighlight(true);
      ensureLyricsWordClock();
    } else {
      (lyricsData.plain || []).forEach(function(txt){
        const d = document.createElement('div'); d.className = 'lyrics-line lyrics-plain'; d.textContent = txt;
        lyricsBox.appendChild(d);
      });
    }
  }
  function lyricsHasWords(){
    return !!(lyricsData && Array.isArray(lyricsData.synced) && lyricsData.synced.some(function(line){ return Array.isArray(line.words) && line.words.length; }));
  }
  var lyricsWordFrame = 0, lyricsWordLast = 0;
  function lyricsWordClock(timestamp){
    lyricsWordFrame = 0;
    if (!lyricsOn || audio.paused || !lyricsHasWords()) return;
    if (timestamp - lyricsWordLast >= 33){
      lyricsWordLast = timestamp;
      updateLyricsHighlight(false);
    }
    lyricsWordFrame = requestAnimationFrame(lyricsWordClock);
  }
  function ensureLyricsWordClock(){
    if (!lyricsWordFrame && lyricsOn && !audio.paused && lyricsHasWords()) lyricsWordFrame = requestAnimationFrame(lyricsWordClock);
  }
  audio.addEventListener('play', ensureLyricsWordClock);
  audio.addEventListener('seeked', function(){ updateLyricsHighlight(true); ensureLyricsWordClock(); });
  function updateLyricsHighlight(force){
    if (!lyricsOn || !lyricsData || !lyricsData.synced || !lyricsBox) return;
    const t = (audio.currentTime || 0) - lyricsOffset();
    const arr = lyricsData.synced;
    let idx = -1;
    for (let i = 0; i < arr.length; i++){ if (arr[i].t <= t + 0.05) idx = i; else break; }
    if (idx !== lyricsCurIdx || force){
      const prev = lyricsBox.querySelector('.lyrics-line.active');
      if (prev) prev.classList.remove('active');
      lyricsCurIdx = idx;
      if (idx >= 0){
        const el = lyricsBox.querySelector('.lyrics-line[data-i="' + idx + '"]');
        if (el){
          el.classList.add('active');
          if (typeof el.scrollIntoView === 'function'){ try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e){} }
        }
      }
    }
    if (idx < 0) return;
    const active = lyricsBox.querySelector('.lyrics-line[data-i="' + idx + '"]');
    if (!active || !active.classList.contains('lyrics-line-words')) return;
    active.querySelectorAll('.lyrics-word').forEach(function(span){
      span.classList.toggle('sung', Number(span.dataset.t) <= t);
    });
  }
  /* end word-synced lyrics rendering */'''

WORD_STYLE_BEGIN = "  <!-- Pulsar editor: word lyrics styles -->"
WORD_STYLE_END = "  <!-- end Pulsar editor: word lyrics styles -->"
WORD_LYRICS_STYLE = '''  <!-- Pulsar editor: word lyrics styles -->
  <style>
  .lyrics-line .lyrics-word { color: inherit; }
  .lyrics-line.active .lyrics-word { color: rgba(255,255,255,.36); text-shadow: none; }
  .lyrics-line.active .lyrics-word.sung { color: #fff; text-shadow: none; }
  </style>
  <!-- end Pulsar editor: word lyrics styles -->'''

EDITOR_API = r'''    /* ---- Pulsar editor: library bridge ---- */
    __editor: {
      current: function(){
        const tr = tracks[currentIndex];
        if (!tr) return null;
        return {
          id: tr.id, index: currentIndex, file: tr.file, lrcFile: tr.lrcFile || null,
          title: tr.title || '', artist: tr.artist || '', srcPath: tr.srcPath || '',
          duration: isFinite(audio.duration) ? audio.duration : (Number(tr.durMs || 0) / 1000)
        };
      },
      importEdited: function(file, sourceId, opts){
        const source = tracks.find(function(x){ return x.id === sourceId; });
        if (!source || !file) return null;
        opts = opts || {};
        if (opts.path){ try { file.__srcPath = String(opts.path); } catch(e){} }
        const before = new Set(tracks.map(function(x){ return x.id; }));
        const files = [file];
        if (opts.lrcText){
          try { files.push(new File([String(opts.lrcText)], file.name.replace(/\.[^.]+$/, '') + '.lrc', { type: 'text/plain;charset=utf-8' })); } catch(e){}
        }
        addFilesToLibrary(files);
        const imported = tracks.find(function(x){ return !before.has(x.id) && x.file && x.file.name === file.name && x.file.size === file.size; });
        if (!imported) return null;
        imported.title = String(opts.title || ((source.title || file.name.replace(/\.[^.]+$/, '')) + ' (edycja)'));
        imported.artist = source.artist || imported.artist;
        imported.album = source.album || '';
        imported.year = source.year || '';
        imported.folder = source.folder || imported.folder;
        imported.coverBlob = source.coverBlob || source.matchedImg || null;
        imported.matchedImg = null;
        imported.coverUrl = imported.coverBlob ? URL.createObjectURL(imported.coverBlob) : null;
        imported.resolved = true;
        imported.srcPath = String(opts.path || '');
        imported.durMs = Math.round(Math.max(0, Number(opts.duration) || 0) * 1000);
        imported.netId = '';
        imported.netLink = '';
        if (opts.lyrics && Array.isArray(opts.lyrics.synced) && opts.lyrics.synced.length){
          const lines = opts.lyrics.synced.map(function(line){
            return { t: Math.max(0, Number(line && line.t) || 0), txt: String(line && line.txt || '') };
          }).sort(function(a, b){ return a.t - b.t; });
          imported.lyricsData = { synced: lines, plain: null, source: 'lrc' };
          lyricsCache.set(imported.id, imported.lyricsData);
        }
        persistTrack(imported);
        rebuildQueue();
        renderLibrary();
        return imported.id;
      }
    },
    /* ---- end Pulsar editor: library bridge ---- */'''


def _replace_block(html: str, begin: str, end: str, block: str, anchor: str, insert_before: bool = False) -> str:
    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.S)
    if pattern.search(html):
        return pattern.sub(lambda _: block, html, count=1)
    if html.count(anchor) != 1:
        raise ValueError(f"Nie znaleziono dokładnie jednego zaczepu: {anchor[:80]!r}")
    replacement = block + "\n" + anchor if insert_before else anchor + block + "\n"
    return html.replace(anchor, replacement, 1)


def _replace_section(html: str, start: str, end: str, block: str) -> str:
    # Akceptuj także jeden przejściowy build, w którym parser był bez wcięcia.
    alternate = start[2:] if start.startswith("  ") else start
    if html.count(start) == 1:
        pass
    elif alternate != start and html.count(alternate) == 1:
        start = alternate
    else:
        raise ValueError(f"Nie znaleziono jednoznacznej sekcji runtime: {start[:70]!r}")
    if html.count(end) != 1:
        raise ValueError(f"Nie znaleziono końca sekcji runtime: {end[:70]!r}")
    first = html.index(start)
    last = html.index(end, first + len(start))
    return html[:first] + block.rstrip() + "\n" + html[last:]


def _replace_named_section(html: str, marker: str, legacy_start: str, end: str, block: str) -> str:
    bare_marker = marker.lstrip()
    if bare_marker not in html:
        return _replace_section(html, legacy_start, end, block)
    # Od najwcześniejszego markera usuwamy także przejściowe duplikaty.
    first = html.index(bare_marker)
    first = html.rfind("\n", 0, first) + 1
    if html.count(end) != 1:
        raise ValueError(f"Nie znaleziono końca sekcji runtime: {end[:70]!r}")
    last = html.index(end, first + len(bare_marker))
    return html[:first] + block.rstrip() + "\n" + html[last:]


def _replace_once(html: str, old: str, new: str) -> str:
    if new in html:
        return html
    if html.count(old) != 1:
        raise ValueError(f"Zaczep runtime występuje {html.count(old)}x zamiast 1x: {old[:100]!r}")
    return html.replace(old, new, 1)


def _patch_lyrics_methods(html: str) -> str:
    """Wymienia cały ogon __lyrics, także w starszych/partialnych buildach."""
    owner = "    __lyrics: {\n"
    anchor = "      data: () => lyricsData, parse: parseLRC,"
    if html.count(owner) != 1 or html.count(anchor) != 1:
        raise ValueError("Nie znaleziono jednoznacznego API __lyrics")
    start = html.index(anchor, html.index(owner))
    end = html.index("    },", start)
    return html[:start] + LYRICS_METHODS + html[end:]


def apply_editor_runtime_patches(html: str) -> str:
    html = _replace_block(
        html, HELPER_BEGIN, HELPER_END, LYRICS_HELPER,
        "  const lyricsBox = document.getElementById('lyricsBox');\n",
    )
    html = _replace_block(html, API_BEGIN, API_END, EDITOR_API, "    __export:", insert_before=True)
    html = _replace_named_section(html, "  /* Pulsar editor: word-synced lyrics parser", "  function parseLRC(text){", "  function lyricsSetBox(html){", LYRICS_PARSER)
    html = _replace_block(html, WORD_STYLE_BEGIN, WORD_STYLE_END, WORD_LYRICS_STYLE, "</head>", insert_before=True)

    html = _replace_once(
        html,
        "d.addEventListener('click', function(){ audio.currentTime = l.t; updateLyricsHighlight(true); });",
        "d.addEventListener('click', function(){ audio.currentTime = Math.max(0, l.t + lyricsOffset()); updateLyricsHighlight(true); });",
    )
    html = _replace_once(
        html,
        "  function updateLyricsHighlight(force){\n    if (!lyricsOn || !lyricsData || !lyricsData.synced || !lyricsBox) return;\n    const t = audio.currentTime || 0;",
        "  function updateLyricsHighlight(force){\n    if (!lyricsOn || !lyricsData || !lyricsData.synced || !lyricsBox) return;\n    const t = (audio.currentTime || 0) - lyricsOffset();",
    )
    html = _replace_named_section(html, "  /* Pulsar editor: word lyrics renderer */", "  function renderLyricsLines(){", "  function refreshLyrics(track){", LYRICS_RENDERER)
    html = _replace_once(
        html,
        "        if (hit.instrumental) return { synced: null, plain: ['(Instrumental)'], source: 'lrclib' };\n        if (hit.syncedLyrics){",
        "        if (hit.instrumental) return { synced: null, plain: ['(Instrumental)'], source: 'lrclib' };\n"
        "        /* Pulsar editor: LRCLIB word sync */\n"
        "        if (hit.hasWordSync && hit.lyricsfile){\n"
        "          const wordLines = parseLyricsfile(hit.lyricsfile);\n"
        "          if (wordLines.some(function(line){ return Array.isArray(line.words) && line.words.length; })) return { synced: wordLines, plain: null, source: 'lrclib', wordSync: true };\n"
        "        }\n"
        "        if (hit.syncedLyrics){",
    )
    html = _replace_once(
        html,
        "          for (let k = 0; k < Math.min(3, rs.length); k++){\n            data = pickFrom(rs[k]);",
        "          /* Pulsar editor: prefer LRCLIB word sync among the same three duration candidates */\n"
        "          const bestLyrics = rs.slice(0, 3).sort(function(a, b){ return Number(!!b.hasWordSync) - Number(!!a.hasWordSync); });\n"
        "          for (let k = 0; k < bestLyrics.length; k++){\n            data = pickFrom(bestLyrics[k]);",
    )
    html = _patch_lyrics_methods(html)
    html = _replace_once(
        html,
        "        srcPath: track.srcPath || '', // ścieżka oryginału na dysku — edytor tagów może go zaktualizować\n",
        "        srcPath: track.srcPath || '', // ścieżka oryginału na dysku — edytor tagów może go zaktualizować\n"
        "        lyricsData: track.lyricsData || null, // dopasowane napisy utworu zapisanego w edytorze audio\n",
    )
    html = _replace_once(
        html,
        "        fav: !!item.fav, plays: item.plays || 0, lastPlay: item.lastPlay || 0, srcPath: item.srcPath || '',\n",
        "        fav: !!item.fav, plays: item.plays || 0, lastPlay: item.lastPlay || 0, srcPath: item.srcPath || '',\n"
        "        lyricsData: item.lyricsData || null,\n",
    )
    html = _replace_once(
        html,
        "    if (!lyricsCache.has(track.id)){\n      try { const ser = localStorage.getItem('playerLyrics:' + track.id);",
        "    if (!lyricsCache.has(track.id) && track.lyricsData) lyricsCache.set(track.id, track.lyricsData);\n"
        "    if (!lyricsCache.has(track.id)){\n      try { const ser = localStorage.getItem('playerLyrics:' + track.id);",
    )
    return html


def editor_runtime_patched(html: str) -> bool:
    needles = [
        HELPER_BEGIN, HELPER_END, API_BEGIN, API_END,
        "const t = (audio.currentTime || 0) - lyricsOffset();",
        "audio.currentTime = Math.max(0, l.t + lyricsOffset())",
        "offset: () => lyricsOffset(), setOffset: v => setLyricsOffset(v)",
        "forTrack: id => { const tr = tracks.find(x => x.id === id)",
        "lyricsData: track.lyricsData || null",
        "lyricsData: item.lyricsData || null",
        "track.lyricsData) lyricsCache.set(track.id, track.lyricsData)",
        "Pulsar editor: word-synced lyrics parser",
        "Pulsar editor: word lyrics renderer",
        "Pulsar editor: LRCLIB word sync",
        "Pulsar editor: prefer LRCLIB word sync",
        WORD_STYLE_BEGIN,
        WORD_STYLE_END,
        "parseWords: parseLyricsfile",
    ]
    return all(html.count(needle) == 1 for needle in needles)

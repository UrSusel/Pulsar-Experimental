#!/usr/bin/env python3
"""Idempotentne zaczepy edytora w zamkniętym runtime index.html."""
from __future__ import annotations

import re

HELPER_BEGIN = "  /* ---- Pulsar editor: lyrics offset ---- */"
HELPER_END = "  /* ---- end Pulsar editor: lyrics offset ---- */"
API_BEGIN = "    /* ---- Pulsar editor: library bridge ---- */"
API_END = "    /* ---- end Pulsar editor: library bridge ---- */"

LYRICS_METHODS = '''      data: () => lyricsData, parse: parseLRC, fetchFor: i => fetchLyrics(tracks[i]),
      forTrack: id => { const tr = tracks.find(x => x.id === id); if (!tr) return null; return lyricsCache.has(id) ? lyricsCache.get(id) : (tr.lyricsData || null); },
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


def _replace_once(html: str, old: str, new: str) -> str:
    if new in html:
        return html
    if html.count(old) != 1:
        raise ValueError(f"Zaczep runtime występuje {html.count(old)}x zamiast 1x: {old[:100]!r}")
    return html.replace(old, new, 1)


def _patch_lyrics_methods(html: str) -> str:
    """Wymienia cały ogon __lyrics, także w starszych/partialnych buildach."""
    owner = "    __lyrics: {\n"
    anchor = "      data: () => lyricsData, parse: parseLRC, fetchFor: i => fetchLyrics(tracks[i])"
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
    ]
    return all(html.count(needle) == 1 for needle in needles)

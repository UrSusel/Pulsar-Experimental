#!/usr/bin/env python3
"""Idempotentne zaczepy Auto-DJ i bezpiecznych kopii w zamkniętym runtime."""
from __future__ import annotations


def _replace_once(html: str, old: str, new: str, marker: str) -> str:
    if marker in html:
        return html
    if html.count(old) != 1:
        raise ValueError(f"Zaczep rozszerzeń występuje {html.count(old)}x zamiast 1x: {old[:110]!r}")
    return html.replace(old, new, 1)


def apply_extras_runtime_patches(html: str) -> str:
    html = _replace_once(
        html,
        "  function chooseAutoDjNext(){\n    if (tracks.length < 2) return -1;\n    const cur = tracks[currentIndex];",
        "  function chooseAutoDjNext(){\n    if (tracks.length < 2) return -1;\n    /* Pulsar extras: configurable DJ selector */\n"
        "    if (typeof window.__pulsarDjSelector === 'function'){\n"
        "      try { const customIndex = window.__pulsarDjSelector(); if (customIndex !== null && customIndex !== undefined && customIndex >= 0 && customIndex < tracks.length && customIndex !== currentIndex) return customIndex; } catch(e){ console.warn('Auto-DJ selector', e); }\n"
        "    }\n"
        "    const cur = tracks[currentIndex];",
        "Pulsar extras: configurable DJ selector",
    )
    html = _replace_once(
        html,
        "      choose: chooseAutoDjNext, recent: () => djRecent.slice(), history: () => djHistory.slice(),",
        "      choose: chooseAutoDjNext, recent: () => djRecent.slice(), history: () => djHistory.slice(),\n"
        "      /* Pulsar extras: DJ context */\n"
        "      context: () => ({ currentIndex: currentIndex, queue: queue.slice(), recent: djRecent.slice(), history: djHistory.slice(), tracks: tracks.map(function(tr, index){ const a = analysisCache.get(tr.id) || {}; return { index: index, id: tr.id, title: tr.title || '', artist: tr.artist || '', album: tr.album || '', genre: tr.genre || '', folder: tr.folder || '', fav: !!tr.fav, plays: tr.plays || 0, lastPlay: tr.lastPlay || 0, bpm: a.bpm || 0, bpmConf: a.bpmConf || 0, rms: a.rms || 0, duration: a.dur || (tr.durMs || 0) / 1000 || 0 }; }) }),",
        "Pulsar extras: DJ context",
    )
    html = _replace_once(
        html,
        "    __export: { m3u: () => buildQueueM3U(), run: () => exportQueueM3U() },",
        "    /* Pulsar extras: backup bridge */\n"
        "    __backup: { build: () => buildBackup(), count: () => tracks.length },\n"
        "    __export: { m3u: () => buildQueueM3U(), run: () => exportQueueM3U() },",
        "Pulsar extras: backup bridge",
    )
    html = _replace_once(
        html,
        "    const removeIds = new Set((ids || []).filter(id => tracks.some(t => t.id === id)));\n    if (!removeIds.size) return 0;\n    if (manual && !window.confirm(t('Usunąć ') + pluralTracks(removeIds.size) + t(' z biblioteki?'))) return 0;\n\n    const currentId = currentIndex > -1 && tracks[currentIndex] ? tracks[currentIndex].id : null;\n    const wasPlaying = !audio.paused;\n    const removed = tracks.filter(track => removeIds.has(track.id));",
        "    const removeIds = new Set((ids || []).filter(id => tracks.some(t => t.id === id)));\n    if (!removeIds.size) return 0;\n    const removed = tracks.filter(track => removeIds.has(track.id));\n    /* Pulsar safety: remove guard */\n"
        "    if (manual && window.__pulsarLibraryGuard){\n      if (!await window.__pulsarLibraryGuard.beforeRemove(removed, { total: tracks.length, kind: 'remove' })) return 0;\n    } else if (manual && !window.confirm(t('Usunąć ') + pluralTracks(removeIds.size) + t(' z biblioteki?'))) return 0;\n\n"
        "    const currentId = currentIndex > -1 && tracks[currentIndex] ? tracks[currentIndex].id : null;\n    const wasPlaying = !audio.paused;",
        "Pulsar safety: remove guard",
    )
    html = _replace_once(
        html,
        "    const doomed = extras.map(function(x){ return tracks[x.i]; });\n    const playingIdx = currentIndex;",
        "    const doomed = extras.map(function(x){ return tracks[x.i]; });\n"
        "    /* Pulsar safety: dedupe snapshot */\n"
        "    if (manual && window.__pulsarLibraryGuard && !await window.__pulsarLibraryGuard.beforeChange(doomed, { total: tracks.length, kind: 'dedupe' })) return 0;\n"
        "    const playingIdx = currentIndex;",
        "Pulsar safety: dedupe snapshot",
    )
    html = _replace_once(
        html,
        "          importBackup(file, m, withS).then(function(r){\n            showToast(t('Przywrócono: ') + r.tracks + t(' utw., ') + r.albums + t(' alb.') + (r.merged ? t(' · scalono: ') + r.merged : '') + (r.settings ? t(' · ustawienia po restarcie') : ''));",
        "          /* Pulsar safety: restore snapshot */\n"
        "          Promise.resolve(window.__pulsarBackupGuard ? window.__pulsarBackupGuard.beforeRestore({ tracks: m.tracks.length }) : true).then(function(proceed){\n            if (proceed === false) return null;\n            return importBackup(file, m, withS);\n          }).then(function(r){\n            if (!r) return;\n            showToast(t('Przywrócono: ') + r.tracks + t(' utw., ') + r.albums + t(' alb.') + (r.merged ? t(' · scalono: ') + r.merged : '') + (r.settings ? t(' · ustawienia po restarcie') : ''));",
        "Pulsar safety: restore snapshot",
    )
    html = _replace_once(
        html,
        "      bpmOf: function(id){ const a = analysisCache.get(id); return a ? { bpm: a.bpm || 0, conf: a.bpmConf || 0, beatStart: a.beatStart || 0 } : null; }",
        "      /* Pulsar extras: DJ direct play and undo */\n"
        "      play: function(index){ if (index < 0 || index >= tracks.length || index === currentIndex) return false; if (xf.active) cancelCrossfade(); djNotePlayed(); djHistory.push(currentIndex); loadTrack(index, { autoplay: true }); return true; },\n"
        "      back: function(){ if (!djHistory.length) return false; const back = djHistory.pop(); if (back < 0 || back >= tracks.length || back === currentIndex) return false; cancelCrossfade(); djNotePlayed(); loadTrack(back, { autoplay: true }); return true; },\n"
        "      bpmOf: function(id){ const a = analysisCache.get(id); return a ? { bpm: a.bpm || 0, conf: a.bpmConf || 0, beatStart: a.beatStart || 0 } : null; }",
        "Pulsar extras: DJ direct play and undo",
    )
    html = _replace_once(
        html,
        "      analysisFor(id){ const a = analysisCache.get(id); return a ? { rms: a.rms, peak: a.peak, norm: a.norm, len: a.peaks.length, dur: a.dur || 0, silences: a.silences ? a.silences.map(x => x.slice()) : null } : null; },",
        "      analysisFor(id){ const a = analysisCache.get(id); return a ? { rms: a.rms, peak: a.peak, norm: a.norm, len: a.peaks.length, peaks: a.peaks ? Array.from(a.peaks) : null, dur: a.dur || 0, silences: a.silences ? a.silences.map(x => x.slice()) : null } : null; }, /* Pulsar extras: analysis peaks */",
        "Pulsar extras: analysis peaks",
    )
    return html


def extras_runtime_patched(html: str) -> bool:
    markers = [
        "Pulsar extras: configurable DJ selector",
        "Pulsar extras: DJ context",
        "Pulsar extras: backup bridge",
        "Pulsar safety: remove guard",
        "Pulsar safety: dedupe snapshot",
        "Pulsar safety: restore snapshot",
        "Pulsar extras: analysis peaks",
        "Pulsar extras: DJ direct play and undo",
    ]
    return all(html.count(marker) == 1 for marker in markers)

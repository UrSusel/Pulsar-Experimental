/* Pulsar Karaoke — czysta logika synchronizacji i ustawień. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PulsarKaraokeCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function number(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function syncedLines(data) {
    return data && Array.isArray(data.synced) ? data.synced.map(function (line) {
      return { t: Math.max(0, number(line && line.t, 0)), txt: String(line && line.txt || '') };
    }).filter(function (line) { return line.txt.trim(); }).sort(function (a, b) { return a.t - b.t; }) : [];
  }
  function plainLines(data) {
    const text = String(data && data.plain || '');
    return text ? text.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean) : [];
  }
  function activeIndex(lines, time, offset) {
    const value = number(time, 0) - number(offset, 0);
    let low = 0, high = lines.length - 1, answer = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (number(lines[middle] && lines[middle].t, 0) <= value + 0.000001) { answer = middle; low = middle + 1; }
      else high = middle - 1;
    }
    return answer;
  }
  function lineProgress(lines, index, time, offset, duration) {
    if (!Array.isArray(lines) || index < 0 || index >= lines.length) return 0;
    const now = number(time, 0), by = number(offset, 0);
    const start = number(lines[index].t, 0) + by;
    const end = index + 1 < lines.length ? number(lines[index + 1].t, start) + by : Math.max(start, number(duration, start));
    if (now <= start || end <= start) return 0;
    return clamp((now - start) / (end - start), 0, 1);
  }
  function visibleWindow(lines, active, radius) {
    const list = Array.isArray(lines) ? lines : [];
    const r = Math.max(1, Math.round(number(radius, 2)));
    let start;
    if (active < 0) start = 0;
    else start = Math.max(0, Math.min(active - r, Math.max(0, list.length - (r * 2 + 1))));
    return list.slice(start, start + r * 2 + 1).map(function (line, local) {
      const index = start + local;
      return { index: index, t: line.t, txt: line.txt, role: index === active ? 'current' : index < active ? 'previous' : 'next' };
    });
  }
  function settingsOf(value) {
    const input = value || {};
    return {
      scale: clamp(number(input.scale, 1), 0.7, 2),
      align: input.align === 'left' ? 'left' : 'center',
      theme: ['nebula', 'contrast', 'light'].includes(input.theme) ? input.theme : 'nebula',
      cover: input.cover !== false
    };
  }
  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(number(value, 0)));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  return { syncedLines: syncedLines, plainLines: plainLines, activeIndex: activeIndex, lineProgress: lineProgress, visibleWindow: visibleWindow, settingsOf: settingsOf, formatTime: formatTime };
});

'use strict';
const assert = require('assert');
const core = require('../karaoke-core.js');
let passed = 0;
function test(name, fn) { fn(); console.log('PASS ' + name); passed++; }
const lines = [{ t: 1, txt: 'A' }, { t: 2.5, txt: 'B' }, { t: 4.5, txt: 'C' }, { t: 6, txt: 'D' }, { t: 8, txt: 'E' }, { t: 10, txt: 'F' }];

test('activeIndex przed pierwszą linią i na granicach', () => {
  assert.strictEqual(core.activeIndex(lines, 0.99, 0), -1);
  assert.strictEqual(core.activeIndex(lines, 1, 0), 0);
  assert.strictEqual(core.activeIndex(lines, 2.499, 0), 0);
  assert.strictEqual(core.activeIndex(lines, 2.5, 0), 1);
});
test('dodatni offset opóźnia napisy', () => {
  assert.strictEqual(core.activeIndex(lines, 2.5, 0.5), 0);
  assert.strictEqual(core.activeIndex(lines, 3, 0.5), 1);
  assert.strictEqual(core.activeIndex(lines, 2.5, -0.5), 1);
});
test('lineProgress używa następnej linii jako końca', () => {
  assert.strictEqual(core.lineProgress(lines, 0, 1, 0, 12), 0);
  assert.strictEqual(core.lineProgress(lines, 0, 1.75, 0, 12), 0.5);
  assert.strictEqual(core.lineProgress(lines, 0, 3, 0, 12), 1);
});
test('lineProgress respektuje offset i koniec utworu', () => {
  assert.strictEqual(core.lineProgress(lines, 0, 2.25, 0.5, 12), 0.5);
  assert.strictEqual(core.lineProgress([{ t: 8, txt: 'x' }], 0, 9, 0, 10), 0.5);
  assert.strictEqual(core.lineProgress(lines, -1, 2, 0, 12), 0);
});
test('visibleWindow pokazuje dwie poprzednie i dwie następne', () => {
  const window = core.visibleWindow(lines, 3, 2);
  assert.deepStrictEqual(window.map(x => x.index), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(window.map(x => x.role), ['previous', 'previous', 'current', 'next', 'next']);
});
test('visibleWindow przed pierwszą linią i przy końcu', () => {
  assert.deepStrictEqual(core.visibleWindow(lines, -1, 2).map(x => x.index), [0, 1, 2, 3, 4]);
  const end = core.visibleWindow(lines, 5, 2);
  assert.deepStrictEqual(end.map(x => x.index), [1, 2, 3, 4, 5]);
  assert.strictEqual(end[4].role, 'current');
});
test('syncedLines czyści i sortuje dane', () => {
  const result = core.syncedLines({ synced: [{ t: 3, txt: 'C' }, { t: -1, txt: 'A' }, { t: 2, txt: '  ' }, { t: 1, txt: 'B' }] });
  assert.deepStrictEqual(result, [{ t: 0, txt: 'A' }, { t: 1, txt: 'B' }, { t: 3, txt: 'C' }]);
});
test('plainLines obsługuje zwykły tekst', () => {
  assert.deepStrictEqual(core.plainLines({ plain: ' Ala \r\n\n ma kota ' }), ['Ala', 'ma kota']);
  assert.deepStrictEqual(core.plainLines(null), []);
});
test('settingsOf ogranicza skalę i poprawia motywy', () => {
  assert.deepStrictEqual(core.settingsOf({ scale: 99, align: 'bad', theme: 'bad', cover: 0 }), { scale: 2, align: 'center', theme: 'nebula', cover: true });
  assert.deepStrictEqual(core.settingsOf({ scale: 0.1, align: 'left', theme: 'contrast', cover: false }), { scale: 0.7, align: 'left', theme: 'contrast', cover: false });
});
test('formatTime jest stabilne dla błędnych danych', () => {
  assert.strictEqual(core.formatTime(65.9), '1:05');
  assert.strictEqual(core.formatTime(-2), '0:00');
  assert.strictEqual(core.formatTime(NaN), '0:00');
});
console.log(`\n${passed}/${passed} testów karaoke zaliczonych.`);

#!/usr/bin/env node
/* Uruchamia build zasobów www niezależnie od tego, jak na tym komputerze nazywa
 * się Python 3: `python`, `py -3` (Windows) czy `python3`. Gdyby Pythona nie
 * było, mówi o tym wprost — zamiast zostawiać użytkownika z niezrozumiałym
 * błędem npm. Wołane przez `npm run prepare:web` (a więc i `android:sync`).
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, 'build_web_assets.py');
const cwd = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

// Windows: `python` bywa z Microsoft Store i wtedy `python3` nie istnieje,
// a instalacja z python.org ma `py`. Kolejność odpowiada temu, co najczęściej
// działa na danej platformie.
const candidates = isWindows
  ? [['python', []], ['py', ['-3']], ['python3', []]]
  : [['python3', []], ['python', []]];

for (const [command, prefix] of candidates) {
  let probe;
  try {
    probe = spawnSync(command, prefix.concat(['--version']), { encoding: 'utf8', shell: isWindows });
  } catch (error) {
    continue;
  }
  if (!probe || probe.status !== 0) continue;
  const version = String(probe.stdout || '') + String(probe.stderr || '');
  if (!/^Python 3\./m.test(version)) continue;

  const run = spawnSync(command, prefix.concat([script]), { stdio: 'inherit', cwd, shell: isWindows });
  process.exit(run.status === null || run.status === undefined ? 1 : run.status);
}

console.error('Nie znalazłem Pythona 3. Próbowałem: ' +
  candidates.map(([command, prefix]) => [command].concat(prefix).join(' ')).join(', ') + '.');
console.error('Zainstaluj Python 3 (na Windowsie z python.org, z zaznaczonym „Add python.exe to PATH”)');
console.error('albo uruchom sam ten krok ręcznie: py -3 "' + script + '"');
process.exit(1);

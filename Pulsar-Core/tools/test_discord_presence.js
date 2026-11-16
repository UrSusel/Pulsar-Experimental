#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');

for (const platform of ['Linux', 'Windows']) {
  const html = fs.readFileSync(path.join(root, platform, 'resources', 'index.html'), 'utf8');
  const desktop = fs.readFileSync(path.join(root, platform, 'resources', 'desktop.js'), 'utf8');
  assert.match(html, /id="smDiscordPresenceToggle"/, `${platform}: presence is opt-in`);
  assert.match(html, /id="smDiscordApplicationId"/, `${platform}: user can configure their Discord application ID`);
  assert.match(html, /id="smDiscordSaveIdBtn"/, `${platform}: application ID can be saved`);
  assert.match(html, /pulsarDiscordPresenceEnabled/, `${platform}: preference persists locally`);
  assert.match(html, /pulsarDiscordApplicationId/, `${platform}: application ID preference remains overridable`);
  assert.ok(html.includes("||'1571647035168530442'"),
    `${platform}: Pulsar's shared public Application ID is preconfigured for all users`);
  assert.match(html, /function startDiscordPolling\(\)/,
    `${platform}: enabling presence starts its retry/update timer`);
  assert.match(html, /function stopDiscordPolling\(\)/,
    `${platform}: disabling presence clears its timers`);
  assert.match(html, /discordPresenceTimer=setInterval\(updateDiscordActivity,15000\)/,
    `${platform}: active presence retries when Discord becomes available`);
  assert.match(html, /clearInterval\(discordPresenceTimer\)/,
    `${platform}: the retry timer is cleared when presence is disabled`);
  const pollingDefinition = html.indexOf('function startDiscordPolling()');
  const pollingStartup = html.indexOf('if(discordPresenceEnabled&&/^');
  assert.ok(pollingDefinition >= 0 && pollingStartup > pollingDefinition,
    `${platform}: polling functions exist before saved preferences start polling`);
  for (const key of [
    'Discord Rich Presence', 'Pokaż odtwarzany utwór na Discordzie',
    'Otwórz Discord Developer Portal', 'Zapisz Application ID', 'Application ID zapisany.',
    'Połączono z Discordem', 'Nie znaleziono Discorda — uruchom aplikację desktopową.'
  ]) {
    assert.match(html, new RegExp(`['"]${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]\\s*:\\s*\\{\\s*en:[^,]+,\\s*es:`),
      `${platform}: PL/EN/ES translation exists for ${key}`);
  }
  assert.match(html, /api\.update\(\{appId:discordApplicationId,title:player\.title,artist:player\.artist,playing:player\.playing,position:player\.pos,duration:player\.dur\}\)/,
    `${platform}: current player metadata and position are sent only when presence is enabled`);
  assert.match(html, /window\.addEventListener\('pagehide',[\s\S]*?api\.stop\(\)/,
    `${platform}: helper is stopped when the app page closes`);
  assert.match(desktop, /discordPresence:\s*\{ update: updateDiscordPresence, clear: clearDiscordPresence, stop: stopDiscordPresence \}/,
    `${platform}: desktop layer exposes update, clear and stop actions`);
  assert.match(desktop, /os\.spawnProcess/, `${platform}: Discord IPC client runs as a native helper process`);
  assert.match(desktop, /updateSpawnedProcess\([^\n]+'stdIn'/, `${platform}: helper commands use local process stdin, not a web service`);
  assert.match(desktop, /pulsar:discord-status/, `${platform}: helper connection errors reach the settings UI`);
  assert.doesNotMatch(desktop, /discord\.com\/api|discordapp\.com\/api|Authorization:\s*Bot/i,
    `${platform}: no bot credentials or Discord web API calls are introduced`);

  const source = platform === 'Linux' ? 'discord-rpc.py' : 'discord-rpc.ps1';
  assert.ok(fs.existsSync(path.join(root, platform, 'resources', source)), `${platform}: IPC helper source is present`);
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  for (let i = 0; i < inline.length; i++) {
    const result = spawnSync('node', ['--check'], { input: inline[i][1], encoding: 'utf8' });
    assert.equal(result.status, 0, `${platform}: inline script ${i} syntax: ${result.stderr}`);
  }
  const syntax = spawnSync('node', ['--check', path.join(root, platform, 'resources', 'desktop.js')], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `${platform}: desktop bridge syntax: ${syntax.stderr}`);
  console.log(`${platform}: Discord Rich Presence configuration, privacy and bridge checks passed`);
}

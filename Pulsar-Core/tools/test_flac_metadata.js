#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
require('../Windows/resources/tags.js');

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function le32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}
function utf8(value) { return new TextEncoder().encode(value); }
function vorbisComments(entries) {
  const vendor = utf8('Pulsar test fixture');
  const comments = entries.map(utf8);
  return concat(le32(vendor.length), vendor, le32(comments.length),
    ...comments.flatMap(comment => [le32(comment.length), comment]));
}
function flacFile(entries) {
  const comments = vorbisComments(entries);
  const header = new Uint8Array([0x84, (comments.length >>> 16) & 0xff, (comments.length >>> 8) & 0xff, comments.length & 0xff]);
  const blob = new Blob([utf8('fLaC'), header, comments], { type: 'audio/flac' });
  Object.defineProperty(blob, 'name', { value: 'metadata-test.flac' });
  return blob;
}

(async () => {
  const metadata = await globalThis.PulsarTags.extractAudioMetadata(flacFile([
    'TITLE=Track title',
    'ARTIST=Primary artist',
    'ALBUM=Album name',
    'DATE=2025-04-03',
    'GENRE=Jazz',
    'ALBUMARTIST=Album artist',
    'COMPOSER=Composer name',
    'TRACKNUMBER=7',
    'DISCNUMBER=2'
  ]));
  assert.equal(metadata.title, 'Track title');
  assert.equal(metadata.artist, 'Primary artist');
  assert.equal(metadata.album, 'Album name');
  assert.equal(metadata.year, '2025-04-03');
  assert.equal(metadata.genre, 'Jazz');
  assert.equal(metadata.albumArtist, 'Album artist');
  assert.equal(metadata.composer, 'Composer name');
  assert.equal(metadata.trackNumber, '7');
  assert.equal(metadata.discNumber, '2');
  assert.equal(await globalThis.PulsarTags.extractAudioMetadata(flacFile(['COMMENT=Only a comment'])), null);
  console.log('FLAC Vorbis-comment metadata extraction passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

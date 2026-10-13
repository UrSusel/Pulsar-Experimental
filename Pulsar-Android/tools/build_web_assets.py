#!/usr/bin/env python3
"""Prepare Capacitor web assets from the packed Pulsar runtime.

The checked-in app remains closed-source: only the existing resources.neu
runtime archive is read. Extracted HTML/JS is generated into ignored www/ and
is never meant to be committed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import struct
import sys
from pathlib import Path

ANDROID_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = ANDROID_DIR.parent / "Pulsar-Linux" / "resources.neu"
DEFAULT_OUT = ANDROID_DIR / "www"
REQUIRED_RESOURCES = {"index.html", "tags.js"}


def archive_files(section: dict, prefix: str = ""):
    for name, meta in section.items():
        rel = f"{prefix}{name}"
        if "files" in meta:
            yield from archive_files(meta["files"], rel + "/")
        else:
            yield rel, meta


def read_archive(path: Path):
    data = path.read_bytes()
    if len(data) < 16:
        raise ValueError("resources.neu is too small to be a valid archive")
    outer_marker, header_size, inner_size, json_size = struct.unpack("<4I", data[:16])
    if outer_marker != 4 or inner_size > header_size or json_size > inner_size - 4:
        raise ValueError("unrecognised resources.neu header")
    header_raw = data[16:16 + json_size]
    header = json.loads(header_raw.decode("utf-8"))
    if not isinstance(header, dict) or "files" not in header:
        raise ValueError("resources.neu has no file table")
    base = 8 + header_size
    if base > len(data):
        raise ValueError("resources.neu header extends beyond the archive")
    return data, header, base


def extract_resource(data: bytes, base: int, meta: dict) -> bytes:
    size = int(meta["size"])
    offset = int(meta["offset"])
    start, end = base + offset, base + offset + size
    if offset < 0 or size < 0 or end > len(data):
        raise ValueError("invalid file offset in resources.neu")
    blob = data[start:end]
    integrity = meta.get("integrity", {})
    expected_hash = integrity.get("hash")
    if expected_hash and hashlib.sha256(blob).hexdigest() != expected_hash:
        raise ValueError("SHA-256 mismatch in resources.neu")
    blocks = integrity.get("blocks") or []
    block_size = int(integrity.get("blockSize") or 0)
    if blocks and block_size > 0:
        actual = [hashlib.sha256(blob[i:i + block_size]).hexdigest()
                  for i in range(0, len(blob), block_size)]
        if actual != blocks:
            raise ValueError("block-integrity mismatch in resources.neu")
    return blob


def build(archive: Path, out_dir: Path, bridge: Path) -> None:
    data, header, base = read_archive(archive)
    selected = {}
    for path, meta in archive_files(header["files"]):
        if not path.startswith("resources/"):
            continue
        relative = path[len("resources/"):]
        if relative in REQUIRED_RESOURCES:
            selected[relative] = extract_resource(data, base, meta)
    missing = REQUIRED_RESOURCES - selected.keys()
    if missing:
        raise ValueError("required resources missing from archive: " + ", ".join(sorted(missing)))

    html = selected["index.html"].decode("utf-8")
    replacements = [
        ('  <script src="neutralino.js"></script>\n', ""),
        ('  <script src="desktop.js"></script>\n', '  <script src="android-bridge.js"></script>\n'),
        ("if (/Linux/i.test(navigator.platform || navigator.userAgent || '') && decodeErrStreak === 2){",
         "if (!window.__pulsarAndroid && /Linux/i.test(navigator.platform || navigator.userAgent || '') && decodeErrStreak === 2){"),
    ]
    for old, new in replacements:
        if html.count(old) != 1:
            raise ValueError(f"expected exactly one source fragment: {old.strip()}")
        html = html.replace(old, new, 1)

    # Android owns a native MediaSession in the playback service. Suppress the
    # browser MediaSession hooks in this generated copy to avoid competing
    # system sessions and duplicate transport actions.
    media_session_replacements = [
        (
            "    if (!('mediaSession' in navigator)) return;",
            "    if (window.__pulsarAndroid || !('mediaSession' in navigator)) return;",
        ),
        (
            "if ('mediaSession' in navigator) try{ navigator.mediaSession.playbackState = 'playing'; } catch(e){}",
            "if (!window.__pulsarAndroid && 'mediaSession' in navigator) try{ navigator.mediaSession.playbackState = 'playing'; } catch(e){}",
        ),
        (
            "if ('mediaSession' in navigator) try{ navigator.mediaSession.playbackState = 'paused'; } catch(e){}",
            "if (!window.__pulsarAndroid && 'mediaSession' in navigator) try{ navigator.mediaSession.playbackState = 'paused'; } catch(e){}",
        ),
        (
            "  if ('mediaSession' in navigator){\n    try{\n      navigator.mediaSession.setActionHandler('play', () => audio.play().catch(() => {}));",
            "  if (!window.__pulsarAndroid && 'mediaSession' in navigator){\n    try{\n      navigator.mediaSession.setActionHandler('play', () => audio.play().catch(() => {}));",
        ),
    ]
    for old, new in media_session_replacements:
        if html.count(old) != 1:
            raise ValueError(f"expected exactly one MediaSession source fragment: {old[:100]!r}")
        html = html.replace(old, new, 1)

    # Keep synchronized lyric scrolling inside the lyrics panel on Android.
    # Element.scrollIntoView can also scroll the page/player ancestors, so the
    # Android copy centers each active line by changing only lyricsBox.scrollTop.
    lyrics_scroll_source = "if (typeof el.scrollIntoView === 'function'){ try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e){} }"
    lyrics_scroll_android = (
        "if (window.__pulsarAndroid){ try { "
        "var boxRect = lyricsBox.getBoundingClientRect(); "
        "var lineRect = el.getBoundingClientRect(); "
        "var targetTop = lyricsBox.scrollTop + lineRect.top - boxRect.top - (lyricsBox.clientHeight - lineRect.height) / 2; "
        "targetTop = Math.max(0, Math.min(targetTop, lyricsBox.scrollHeight - lyricsBox.clientHeight)); "
        "if (typeof lyricsBox.scrollTo === 'function') lyricsBox.scrollTo({ top: targetTop, behavior: 'smooth' }); "
        "else lyricsBox.scrollTop = targetTop; "
        "} catch(e){} } else if (typeof el.scrollIntoView === 'function'){ try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e){} }"
    )
    if html.count(lyrics_scroll_source) != 1:
        raise ValueError("expected exactly one synchronized lyrics scroll source fragment")
    html = html.replace(lyrics_scroll_source, lyrics_scroll_android, 1)

    # The Android build exposes the existing network-library view but cannot
    # reach the desktop-only yt-dlp bridge on loopback. Skip that probe and use
    # the runtime's public search/stream fallbacks instead.
    android_network_replacements = [
        (
            "  /* ---- YouTube: mostek yt-dlp (zalecany) + Cobalt/Piped/Invidious jako kaskada awaryjna ----\n     Publiczne instancje Piped/Invidious są często blokowane przez YouTube (audioStreams: 0 / 302),\n     dlatego pierwszym źródłem jest lokalny mostek ytdl-bridge.mjs (yt-dlp), a reszta to fallback. */",
            "  /* ---- Android: built-in InnerTube extraction first; public Piped/Cobalt providers remain as fallbacks. ---- */",
        ),
        (
            "  const BRIDGE_BASE = 'http://127.0.0.1:' + BRIDGE_PORT;",
            "  const BRIDGE_BASE = '';",
        ),
        (
            "  async function ytBridgePing(force){\n    // true → zawsze odśwież; bez force: dodatni cache wiarygodny, ujemny wygasa po 15 s (mostek mógł właśnie wystartować)",
            "  async function ytBridgePing(force){\n    if (window.__pulsarAndroid){ ytBridgeOk = false; ytBridgeFfmpeg = false; ytBridgeAt = Date.now(); return false; }\n    // true → zawsze odśwież; bez force: dodatni cache wiarygodny, ujemny wygasa po 15 s (mostek mógł właśnie wystartować)",
        ),
        (
            "  function bridgeHintHtml(r){\n    const cmd = 'node ytdl-bridge.mjs';",
            "  function bridgeHintHtml(r){\n    if (window.__pulsarAndroid) return t('Nie znaleziono strumienia audio. Wbudowany ekstraktor Androida i publiczne źródła nie udostępniły audio dla tego filmu. Spróbuj ponownie później.') + (ytAndroidExtractError ? ' — ' + ytAndroidExtractError : '');\n    const cmd = 'node ytdl-bridge.mjs';",
        ),
    ]
    for old, new in android_network_replacements:
        if html.count(old) != 1:
            raise ValueError(f"expected exactly one Android network source fragment: {old[:100]!r}")
        html = html.replace(old, new, 1)

    # The packed desktop runtime ships an old Cobalt client (stale instance-list
    # schema, mandatory JWT/session flow, and an invalid bitrate). Android uses
    # native InnerTube first, then current public Piped/Cobalt fallback instances.
    youtube_provider_replacements = [
        (
            "  const YT_PIPED = ['https://api.piped.private.coffee', 'https://pipedapi.ducks.party', 'https://pipedapi.kavin.rocks']; // tylko wyszukiwanie (CORS OK)",
            "  const YT_PIPED = ['https://api.piped.yt', 'https://pipedapi.ducks.party', 'https://api.piped.private.coffee']; // Piped instances with browser API access",
        ),
        (
            "  const YT_INVIDIOUS = ['https://invidious.f5.si', 'https://inv.nadeko.net']; // tylko wyszukiwanie",
            "  const YT_INVIDIOUS = ['https://invidious.f5.si', 'https://iv.ggtyler.dev', 'https://invidious.nerdvpn.de']; // search fallback only",
        ),
        (
            "  const YT_COBALT = ['https://cobalt-backend.canine.tools']; // jedyna instancja z CORS; większość wymaga kapczy lub jest martwa",
            "  const YT_COBALT = ['https://cobalt-api.meowing.de', 'https://cobalt-backend.canine.tools', 'https://kityune.imput.net', 'https://capi.3kh0.net', 'https://nachos.imput.net', 'https://sunny.imput.net', 'https://blossom.imput.net']; // public fallback instances",
        ),
        (
            "  let ytCobaltDead = false; // po serii porażek nie odpytuj Cobalt jeszcze raz",
            "  let ytCobaltListCache = [], ytCobaltListAt = 0, ytCobaltLastGood = '';",
        ),
        (
            r'''          const m = String(it.url || '').match(/[?&]v=([\w-]{6,})/);
          const id = m ? m[1] : '';''',
            r'''          const m = String(it.url || '').match(/[?&]v=([\w-]{6,})/) || String(it.url || '').match(/\/shorts\/([\w-]{6,})/);
          const rawId = String(it.videoId || it.id || '').trim();
          const id = /^[\w-]{6,}$/.test(rawId) ? rawId : (m ? m[1] : '');''',
        ),
        (
            r'''  function ytIdFromText(t){
    const m = String(t || '').trim().match(/(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/);
    if (m) return m[1];
    const bare = String(t || '').trim().match(/^([\w-]{11})$/);
    return bare ? bare[1] : null;
  }''',
            r'''  function ytIdFromText(t){
    const raw = String(t || '').trim();
    const bare = raw.match(/^([\w-]{11})$/);
    if (bare) return bare[1];
    const match = raw.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?[^\s#]*?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([\w-]{11})/i);
    return match ? match[1] : null;
  }''',
        ),
        (
            "    for (const base of [ytLastGood.piped, 'https://api.piped.private.coffee']){",
            "    const pipedStreams = [ytLastGood.piped].concat(YT_PIPED).filter(function(base, index, all){ return base && all.indexOf(base) === index; });\n    for (const base of pipedStreams){",
        ),
        (
            "      const d = await netJson(base + '/streams/' + encodeURIComponent(ytId), 9000);",
            "      const d = await netJson(base + '/streams/' + encodeURIComponent(ytId), 7500);",
        ),
    ]
    for old, new in youtube_provider_replacements:
        if html.count(old) != 1:
            raise ValueError(f"expected exactly one Android YouTube provider fragment: {old[:100]!r}")
        html = html.replace(old, new, 1)

    cobalt_pattern = re.compile(r"  async function ytCobaltList\(\)\{.*?\n  function ytThumbUrl\(id\)\{", re.S)
    cobalt_replacement = r'''  async function ytCobaltList(){
    if (ytCobaltListCache.length && Date.now() - ytCobaltListAt < 300000) return ytCobaltListCache.slice();
    const cacheKey = 'ytCobaltCacheV2';
    const list = [], seen = new Set(), discovered = [];
    function normalize(api, protocol){
      if (typeof api !== 'string' || !api.trim()) return '';
      const raw = api.trim();
      let parsed;
      try { parsed = new URL(/^https?:\/\//i.test(raw) ? raw : ((protocol === 'http' ? 'http:' : 'https:') + '//' + raw)); }
      catch(e){ return ''; }
      if (parsed.protocol !== 'https:' || !parsed.hostname) return '';
      return parsed.origin + parsed.pathname.replace(/\/+$/, '');
    }
    function add(api, protocol){
      const base = normalize(api, protocol);
      if (!base || seen.has(base)) return '';
      seen.add(base); list.push(base); return base;
    }
    try {
      const data = await netJson('https://instances.cobalt.best/instances.json', 7000);
      if (Array.isArray(data)){
        const candidates = data.filter(function(x){
          if (!x || x.online === false || x.api_online === false || x.api_key) return false;
          const info = x.info || {};
          if (info.auth === true) return false;
          const cors = info.cors != null ? info.cors : x.cors;
          if (cors === false || cors === 1 || cors === -1) return false;
          const services = x.services || {};
          return !Object.prototype.hasOwnProperty.call(services, 'youtube') || services.youtube === true;
        }).sort(function(a, b){ return (Number(b.score) || 0) - (Number(a.score) || 0); });
        candidates.slice(0, 6).forEach(function(x){
          const base = add(x.api, x.protocol || 'https');
          if (base) discovered.push(base);
        });
      }
    } catch(e){}
    if (discovered.length){
      try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), list: discovered.slice(0, 12) })); } catch(e){}
    }
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && Array.isArray(cached.list) && Date.now() - cached.t < 216e5){
        cached.list.forEach(function(api){ add(api, 'https'); });
      }
    } catch(e){}
    YT_COBALT.forEach(function(api){ add(api, 'https'); });
    ytCobaltListCache = list.slice(0, 12);
    ytCobaltListAt = Date.now();
    return ytCobaltListCache.slice();
  }
  async function netYtCobalt(ytId){
    const list = await ytCobaltList();
    const order = [ytCobaltLastGood].concat(list).filter(function(base, index, all){ return base && all.indexOf(base) === index; }).slice(0, 4);
    const jobs = order.map(async function(base){
      const ctl = netTimeout(8000);
      try {
        const endpoint = base.replace(/\/+$/, '') + '/';
        const response = await fetch(endpoint, { method: 'POST', signal: ctl.signal,
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://www.youtube.com/watch?v=' + encodeURIComponent(ytId),
            downloadMode: 'audio', audioFormat: 'mp3', audioBitrate: '128',
            filenameStyle: 'basic', alwaysProxy: true, localProcessing: 'disabled'
          }) });
        if (!response || !response.ok) throw new Error('Cobalt HTTP error');
        const data = await response.json();
        const status = String(data && data.status || '').toLowerCase();
        let fileUrl = data && typeof data.url === 'string' ? data.url : '';
        if (!fileUrl && status === 'local-processing' && Array.isArray(data.tunnel)){
          fileUrl = String(data.tunnel.find(function(url){ return typeof url === 'string' && url; }) || '');
        }
        if (!fileUrl || !['tunnel', 'redirect', 'local-processing', 'stream', 'success'].includes(status)) throw new Error('Cobalt returned no stream');
        let resolved;
        try { resolved = new URL(fileUrl, endpoint).href; } catch(e){ throw new Error('Invalid Cobalt stream URL'); }
        if (!/^https:\/\//i.test(resolved)) throw new Error('Cobalt returned a non-HTTPS stream');
        return { url: resolved, ext: 'mp3', via: 'cobalt', base: base };
      } finally { ctl.done(); }
    });
    const results = await Promise.allSettled(jobs);
    const streams = results.filter(function(result){ return result && result.status === 'fulfilled' && result.value && result.value.url; }).map(function(result){ return result.value; });
    if (!streams.length) return null;
    ytCobaltLastGood = streams[0].base;
    return Object.assign({}, streams[0], { fallbacks: streams.slice(1) });
  }
  function ytThumbUrl(id){'''
    html, cobalt_count = cobalt_pattern.subn(lambda _match: cobalt_replacement, html, count=1)
    if cobalt_count != 1:
        raise ValueError("could not replace the outdated Android Cobalt client")

    # Search can succeed while the selected instance has no stream for a
    # particular video. Probe a broader current Piped pool concurrently before
    # the slower Cobalt fallback, and reject placeholder stream entries.
    youtube_stream_pattern = re.compile(r"  async function netYtStream\(ytId\)\{.*?\n  /\* Wklejony link YouTube", re.S)
    youtube_stream_replacement = r'''  const YT_PIPED_STREAM = [
    'https://api.piped.yt', 'https://pipedapi.ducks.party', 'https://api.piped.private.coffee',
    'https://pipedapi.kavin.rocks', 'https://pipedapi.leptons.xyz', 'https://pipedapi.nosebs.ru',
    'https://piped-api.privacy.com.de', 'https://pipedapi.adminforge.de'
  ];
  async function ytPipedAudio(base, ytId){
    const data = await netJson(base + '/streams/' + encodeURIComponent(ytId), 7000);
    const streams = data && Array.isArray(data.audioStreams) ? data.audioStreams.filter(function(item){
      return item && typeof item.url === 'string' && item.url.trim();
    }) : [];
    if (!streams.length) throw new Error('No Piped audio streams');
    const best = streams.slice().sort(function(a, b){
      return ytScoreStream(b.mimeType || b.format || b.codec, b.bitrate) - ytScoreStream(a.mimeType || a.format || a.codec, a.bitrate);
    })[0];
    let streamUrl;
    try { streamUrl = new URL(String(best.url), data.proxyUrl || base).href; }
    catch(e){ throw new Error('Invalid Piped audio URL'); }
    if (!/^https:\/\//i.test(streamUrl)) throw new Error('Piped returned a non-HTTPS stream');
    const mime = String(best.mimeType || best.format || best.codec || '');
    return { url: streamUrl, ext: /mp4|m4a|aac/i.test(mime) ? 'm4a' : (/webm|opus/i.test(mime) ? 'webm' : 'm4a'), via: 'piped', base: base };
  }
  let ytAndroidExtractError = '';
  const ytAndroidResolve = new Map();
  async function netYtAndroidStream(ytId){
    if (!window.__pulsarAndroid) return null;
    const native = window.__pulsarAndroidYouTube;
    if (!native || typeof native.resolve !== 'function'){
      ytAndroidExtractError = 'The built-in YouTube extractor is unavailable.';
      return null;
    }
    const key = String(ytId || '').trim();
    if (!ytAndroidResolve.has(key)){
      const pending = Promise.resolve().then(function(){
        return native.resolve(key);
      }).then(function(response){
        const candidates = response && Array.isArray(response.streams) ? response.streams.filter(function(stream){
          return stream && typeof stream.url === 'string' && /^https:\/\//i.test(stream.url);
        }).map(function(stream){
          return {
            url: String(stream.url),
            ext: String(stream.ext || 'm4a'),
            mimeType: String(stream.mimeType || ''),
            via: 'android-extractor',
            client: String(stream.client || ''),
            userAgent: String(stream.userAgent || ''),
            itag: String(stream.itag || '')
          };
        }) : [];
        if (!candidates.length) throw new Error('No direct audio URL was returned.');
        ytAndroidExtractError = '';
        return Object.assign({}, candidates[0], { fallbacks: candidates.slice(1) });
      }).catch(function(error){
        ytAndroidExtractError = String(error && error.message || error || 'Built-in YouTube extraction failed').slice(0, 220);
        ytAndroidResolve.delete(key);
        return null;
      });
      ytAndroidResolve.set(key, pending);
    }
    return await ytAndroidResolve.get(key);
  }
  async function netYtExternalStream(ytId){
    const pipedBases = [ytLastGood.piped].concat(YT_PIPED_STREAM).filter(function(base, index, all){
      return base && all.indexOf(base) === index;
    });
    const pipedResults = await Promise.allSettled(pipedBases.map(function(base){ return ytPipedAudio(base, ytId); }));
    const pipedStreams = pipedResults.filter(function(result){ return result && result.status === 'fulfilled' && result.value && result.value.url; }).map(function(result){ return result.value; });
    if (pipedStreams.length){
      ytLastGood.piped = pipedStreams[0].base;
      return Object.assign({}, pipedStreams[0], { fallbacks: pipedStreams.slice(1) });
    }
    const cobalt = await netYtCobalt(ytId);
    if (cobalt) return cobalt;
    return null;
  }
  async function netYtStream(ytId){
    // Desktop keeps its local yt-dlp bridge. Android first resolves directly
    // through its built-in InnerTube extractor, then falls back to public APIs.
    if (await ytBridgePing()){
      return { url: BRIDGE_BASE + '/audio?id=' + encodeURIComponent(ytId), ext: 'm4a', via: 'bridge' };
    }
    if (window.__pulsarAndroid){
      const nativeStream = await netYtAndroidStream(ytId);
      if (nativeStream) return nativeStream;
    }
    return await netYtExternalStream(ytId);
  }
  /* Wklejony link YouTube'''
    html, stream_count = youtube_stream_pattern.subn(lambda _match: youtube_stream_replacement, html, count=1)
    if stream_count != 1:
        raise ValueError("could not replace the Android YouTube stream resolver")

    # Public instances can return audio URLs that are valid for a native client
    # but blocked by WebView CORS, redirect policy, or CDN request headers. On
    # Android, fetch that resolved media into app cache before using it in the
    # HTML audio element or importing it into the library.
    android_youtube_media_replacements = [
        (
            "  /* Wklejony link YouTube → natychmiastowy wynik bez wyszukiwarki */",
            r'''  let ytAndroidCacheError = '';
  const ytAndroidPrepare = new Map();
  async function netYtAndroidCacheOne(plugin, capacitor, ytId, stream){
    const key = String(ytId || '') + '|' + String(stream.url || '');
    if (!ytAndroidPrepare.has(key)){
      const pending = Promise.resolve().then(function(){
        return plugin.prepareYoutubeAudio({
          videoId: String(ytId || ''), url: String(stream.url), ext: String(stream.ext || 'm4a'),
          userAgent: String(stream.userAgent || '')
        });
      }).then(function(result){
        if (!result || !result.path) throw new Error('Android returned no cached audio file.');
        const path = String(result.path);
        const fileUri = path.slice(0, 7).toLowerCase() === 'file://' ? path : 'file://' + path;
        const localUrl = capacitor.convertFileSrc(fileUri);
        if (!localUrl) throw new Error('Capacitor could not map the cached audio file.');
        ytAndroidCacheError = '';
        ytAndroidExtractError = '';
        return Object.assign({}, stream, { url: localUrl, ext: result.ext || stream.ext || 'm4a', via: 'android-native' });
      }).catch(function(error){
        ytAndroidCacheError = String(error && error.message || error || 'Android audio cache failed').slice(0, 180);
        ytAndroidPrepare.delete(key);
        return null;
      });
      ytAndroidPrepare.set(key, pending);
    }
    return await ytAndroidPrepare.get(key);
  }
  async function netYtAndroidCacheTry(plugin, capacitor, ytId, stream){
    if (!stream || !stream.url) return { local: null, fallback: stream };
    let fallback = stream;
    const candidates = [stream].concat(Array.isArray(stream.fallbacks) ? stream.fallbacks : []).slice(0, 4);
    for (const candidate of candidates){
      if (!candidate || !candidate.url) continue;
      fallback = candidate;
      const local = await netYtAndroidCacheOne(plugin, capacitor, ytId, candidate);
      if (local) return { local: local, fallback: candidate };
    }
    return { local: null, fallback: fallback };
  }
  async function netYtAndroidCache(ytId, stream){
    if (!window.__pulsarAndroid || !stream || !stream.url) return stream;
    ytAndroidCacheError = '';
    const capacitor = window.Capacitor;
    const plugin = capacitor && capacitor.Plugins && capacitor.Plugins.PulsarMedia;
    if (!plugin || typeof plugin.prepareYoutubeAudio !== 'function' || typeof capacitor.convertFileSrc !== 'function') return stream;
    netSetHint(t('Przygotowuję audio YouTube na urządzeniu…'));

    let attempt = await netYtAndroidCacheTry(plugin, capacitor, ytId, stream);
    if (attempt.local) return attempt.local;
    let fallback = attempt.fallback || stream;
    let externalStream = null;
    if (stream.via === 'android-extractor'){
      externalStream = await netYtExternalStream(ytId);
      if (externalStream){
        attempt = await netYtAndroidCacheTry(plugin, capacitor, ytId, externalStream);
        if (attempt.local) return attempt.local;
        fallback = attempt.fallback || externalStream;
      }
    }
    if (stream.via === 'piped' || (externalStream && externalStream.via === 'piped')){
      const cobalt = await netYtCobalt(ytId);
      const cobaltAttempt = await netYtAndroidCacheTry(plugin, capacitor, ytId, cobalt);
      if (cobaltAttempt.local) return cobaltAttempt.local;
      if (cobaltAttempt.fallback) fallback = cobaltAttempt.fallback;
    }
    return fallback;
  }
  /* Wklejony link YouTube → natychmiastowy wynik bez wyszukiwarki */''',
        ),
    ]
    for old, new in android_youtube_media_replacements:
        if html.count(old) != 1:
            raise ValueError(f"expected exactly one Android YouTube media fragment: {old[:100]!r}")
        html = html.replace(old, new, 1)

    stream_call = "const sres = await netYtStream(r.ytId || r.id);"
    if html.count(stream_call) != 2:
        raise ValueError("expected exactly two YouTube stream-resolution call sites")
    html = html.replace(
        stream_call,
        "let sres = await netYtStream(r.ytId || r.id);\n      if (sres && sres.url) sres = await netYtAndroidCache(r.ytId || r.id, sres);",
    )

    playback_failure = "    if (p && p.catch) p.catch(() => netSetHint(t('Nie udało się odtworzyć strumienia — spróbuj zapisać plik.')));"
    playback_failure_with_native_detail = "    if (p && p.catch) p.catch(() => netSetHint(t('Nie udało się odtworzyć strumienia — spróbuj zapisać plik.') + (window.__pulsarAndroid && ytAndroidCacheError ? ' — ' + ytAndroidCacheError : '')));"
    if html.count(playback_failure) != 1:
        raise ValueError("could not add Android playback-fetch diagnostics")
    html = html.replace(playback_failure, playback_failure_with_native_detail, 1)

    import_failure = "    if (!blob || !blob.size){ if (btnEl){ btnEl.disabled = false; btnEl.textContent = r.isFull ? t('Zapisz') : t('Dodaj'); } netSetHint(t('Pobieranie nie powiodło się.')); return; }"
    import_failure_with_native_detail = "    if (!blob || !blob.size){ if (btnEl){ btnEl.disabled = false; btnEl.textContent = r.isFull ? t('Zapisz') : t('Dodaj'); }\n      const nativeError = window.__pulsarAndroid && ytAndroidCacheError ? ' ' + ytAndroidCacheError : '';\n      netSetHint(t('Pobieranie nie powiodło się.') + nativeError); return; }\n    if (window.__pulsarAndroid && r.provider === 'youtube') netSetHint('');"
    if html.count(import_failure) != 1:
        raise ValueError("could not add Android native-fetch diagnostics to YouTube imports")
    html = html.replace(import_failure, import_failure_with_native_detail, 1)

    input_pattern = re.compile(r'<input type="file" id="folderInput"[^>]*>')
    html, count = input_pattern.subn(
        '<input type="file" id="folderInput" accept="audio/*" multiple hidden>', html, count=1
    )
    if count != 1:
        raise ValueError("could not adapt the music picker for Android file selection")

    if "Neutralino.init" in html or "src=\"desktop.js\"" in html:
        raise ValueError("desktop runtime reference remains in generated Android HTML")

    # The desktop build offers folder drag/drop; Android starts by importing
    # several selected audio files through WebView's system document picker.
    mobile_text = [
        (
            "Wybierz folder z muzyką (ikona foldera na dole) albo po prostu upuść pliki audio na to okno. Wykryte zostaną MP3, WAV, OGG, M4A i FLAC wraz z okładkami ID3. Skróty: Spacja — play/pauza, ←/→ — utwory, R — powtarzanie, S — losowo.",
            "Wybierz pliki audio przyciskiem „Dodaj muzykę” poniżej. Obsługiwane formaty: MP3, WAV, OGG, M4A i FLAC.",
            1,
        ),
        (
            "Brak wybranego folderu. Kliknij ikonę foldera na dole albo upuść pliki audio na okno.",
            "Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.",
            2,
        ),
        (
            "Brak utworów. Upuść pliki audio na okno albo kliknij „+ Dodaj muzykę”.",
            "Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.",
            2,
        ),
        (
            "Dodaj utwory z folderu lub pliki audio",
            "Wybierz pliki audio",
            2,
        ),
        (
            "YouTube: wklej link w pole wyszukiwania albo szukaj frazą. Podgląd i „Zapisz” (MP3) wymagają lokalnego mostka yt-dlp — status w górnym pasku („● yt-dlp”). Linki do playlist wklej w to samo pole. iTunes i Deezer udostępniają 30-sekundowe podglądy. Audius, Internet Archive i Wikimedia Commons mogą udostępniać pełne pliki.",
            "Android: wklej link YouTube albo wyszukaj frazę. „Zapisz” pobiera audio do biblioteki aplikacji. Wbudowany ekstraktor Androida działa bez własnego serwera, a publiczne źródła są rezerwowe; niektóre filmy mogą być niedostępne. iTunes i Deezer udostępniają 30-sekundowe podglądy. Audius, Internet Archive i Wikimedia Commons mogą udostępniać pełne pliki.",
            2,
        ),
    ]
    for old, new, expected in mobile_text:
        if html.count(old) != expected:
            raise ValueError(f"unexpected Android UI text occurrence count for {old[:60]!r}")
        html = html.replace(old, new)

    old_folder_translation = "    'Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.': { en: 'No folder chosen. Click the folder icon below or drop audio files onto the window.', es: 'Ninguna carpeta elegida. Pulsa el icono de carpeta abajo o suelta archivos de audio en la ventana.' },"
    if html.count(old_folder_translation) != 1:
        raise ValueError("could not remove the obsolete folder-picker translation")
    html = html.replace(old_folder_translation, "", 1)

    old_dynamic_translation = "    'Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.': { en: 'No tracks yet. Drop audio files onto the window or click “+ Add music”.', es: 'Aún no hay canciones. Suelta archivos de audio en la ventana o pulsa «+ Añadir música».' },"
    new_dynamic_translation = "    'Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.': { en: 'No tracks yet. Tap “Add music” and choose audio files.', es: 'Aún no hay canciones. Pulsa «Añadir música» y elige archivos de audio.' },"
    if html.count(old_dynamic_translation) != 1:
        raise ValueError("could not update the Android empty-library translation")
    html = html.replace(old_dynamic_translation, new_dynamic_translation, 1)

    old_add_translation = "    'Wybierz pliki audio': { en: 'Add tracks from a folder or audio files', es: 'Añadir canciones de una carpeta o archivos de audio' },"
    new_add_translation = "    'Wybierz pliki audio': { en: 'Choose audio files', es: 'Elegir archivos de audio' },"
    if html.count(old_add_translation) != 1:
        raise ValueError("could not update the Android add-files translation")
    html = html.replace(old_add_translation, new_add_translation, 1)

    old_footer_translation = "    'Android: wklej link YouTube albo wyszukaj frazę. „Zapisz” pobiera audio do biblioteki aplikacji. Wbudowany ekstraktor Androida działa bez własnego serwera, a publiczne źródła są rezerwowe; niektóre filmy mogą być niedostępne. iTunes i Deezer udostępniają 30-sekundowe podglądy. Audius, Internet Archive i Wikimedia Commons mogą udostępniać pełne pliki.': { en: 'YouTube: paste a link into the search box or search by phrase. Preview and “Save” (MP3) need the local yt-dlp bridge — status in the top bar (“● yt-dlp”). Paste playlist links into the same box. iTunes and Deezer serve 30-second previews. Audius, Internet Archive and Wikimedia Commons may serve full files.', es: 'YouTube: pega un enlace en el cuadro de búsqueda o busca por frase. La vista previa y «Guardar» (MP3) necesitan el puente local yt-dlp — estado en la barra superior («● yt-dlp»). Los enlaces a listas se pegan en el mismo cuadro. iTunes y Deezer ofrecen vistas previas de 30 s. Audius, Internet Archive y Wikimedia Commons pueden ofrecer archivos completos.' },"
    new_footer_translation = "    'Android: wklej link YouTube albo wyszukaj frazę. „Zapisz” pobiera audio do biblioteki aplikacji. Wbudowany ekstraktor Androida działa bez własnego serwera, a publiczne źródła są rezerwowe; niektóre filmy mogą być niedostępne. iTunes i Deezer udostępniają 30-sekundowe podglądy. Audius, Internet Archive i Wikimedia Commons mogą udostępniać pełne pliki.': { en: 'Android: paste a YouTube link or search by phrase. “Save” downloads audio to the app library. The built-in extractor requires no server you run; public providers are fallbacks, and some videos may be unavailable. iTunes and Deezer offer 30-second previews. Audius, Internet Archive, and Wikimedia Commons may offer full tracks.', es: 'Android: pega un enlace de YouTube o busca por frase. «Guardar» descarga audio a la biblioteca de la app. El extractor integrado no necesita un servidor propio; los proveedores públicos son una alternativa y algunos vídeos pueden no estar disponibles. iTunes y Deezer ofrecen vistas previas de 30 segundos. Audius, Internet Archive y Wikimedia Commons pueden ofrecer canciones completas.' },"
    if html.count(old_footer_translation) != 1:
        raise ValueError("could not update the Android network-view translation")
    html = html.replace(old_footer_translation, new_footer_translation, 1)

    dictionary = "  var I18N_DICT = {\n"
    mobile_hint_translation = (
        "    'Wybierz pliki audio przyciskiem „Dodaj muzykę” poniżej. Obsługiwane formaty: MP3, WAV, OGG, M4A i FLAC.': "
        "{ en: 'Use the “Add music” button below to choose audio files. Supported formats: MP3, WAV, OGG, M4A, and FLAC.', "
        "es: 'Usa el botón «Añadir música» de abajo para elegir archivos de audio. Formatos compatibles: MP3, WAV, OGG, M4A y FLAC.' },\n"
    )
    android_hint_translation = (
        "    'Na Androidzie YouTube używa wbudowanego ekstraktora, a publiczne źródła są rezerwowe; dostępność może się zmieniać.': "
        "{ en: 'Android uses its built-in YouTube extractor first and public providers as fallbacks; availability can change.', "
        "es: 'Android usa primero el extractor integrado de YouTube y los proveedores públicos como alternativa; la disponibilidad puede cambiar.' },\n"
    )
    android_stream_error_translation = (
        "    'Nie znaleziono strumienia audio. Wbudowany ekstraktor Androida i publiczne źródła nie udostępniły audio dla tego filmu. Spróbuj ponownie później.': "
        "{ en: 'No audio stream was found. The built-in Android extractor and public providers did not return audio for this video. Please try again later.', "
        "es: 'No se encontró ningún flujo de audio. El extractor integrado de Android y los proveedores públicos no devolvieron audio para este vídeo. Inténtalo de nuevo más tarde.' },\n"
    )
    if html.count(dictionary) != 1:
        raise ValueError("could not find the app translation dictionary")
    html = html.replace(dictionary, dictionary + mobile_hint_translation + android_hint_translation + android_stream_error_translation, 1)

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    (out_dir / "index.html").write_text(html, encoding="utf-8")
    (out_dir / "tags.js").write_bytes(selected["tags.js"])
    shutil.copy2(bridge, out_dir / "android-bridge.js")
    print(f"Prepared {out_dir}: index.html, tags.js, android-bridge.js")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    try:
        build(args.archive.resolve(), args.out.resolve(), (ANDROID_DIR / "android-bridge.js"))
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"Android web asset preparation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

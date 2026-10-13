# Pulsar-Sync — one library on Android, Windows and Linux

Everything that makes the three builds share a single library lives here. There is one
engine and one set of runtime hooks; Android, Windows and Linux all ship the same code.

| File | What it is |
|---|---|
| `drive-sync.js` | The engine: builds the manifest, merges two manifests, applies the result, draws the Cloud panel. Runs on all three platforms. |
| `desktop-cloud-sync.js` | Desktop adapter (Neutralino). Talks to the folder the user picked; registers `window.__pulsarSyncAdapter`. |
| `cloud_sync_hooks.js` | Runtime hooks (`__pulsarSyncSnapshot`, `__pulsarSyncApply`) injected into the app's `index.html` on every platform. |
| `tools/build_desktop_sync.py` | Injects the layer into `Pulsar-Windows/resources.neu` and `Pulsar-Linux/resources.neu`. |
| `tools/cloud_runtime_patches.py` | The runtime edits shared by the Android build and the desktop packages. |
| `tools/test_drive_sync.js` | Offline test suite — Android plugins, desktop adapter, engine, panel. |
| `tools/test_desktop_bundle.py` | Checks both packaged archives after injection. |
| `tools/neu.py` | Unpack / pack / verify for the Neutralino `.neu` archives. |

## What travels, and what never does

Only metadata: track titles, artists, albums, years, favourites, play counts, the YouTube
identifier, album names and album membership. Audio files, covers and local paths stay on
the device that owns them. The manifest is a single file, `pulsar-library.json`.

## How a device joins the library

Folder mode needs no Google Cloud project, no OAuth screen and no tester list — the app
asks the system file picker for a folder once and remembers it:

* **Android** — *Settings → Cloud → Choose folder*, pick the Drive folder. The app keeps
  `pulsar-library.json` there through Storage Access Framework permissions.
* **Windows** — install *Google Drive for desktop*, let it sync (or mirror) a folder, then
  *Settings → Cloud → Choose folder* and pick that folder.
* **Linux** — mount or sync your Drive with `rclone`, `Insync`, `rclone bisync` or an
  overlay filesystem, then pick that local folder in the app.

The second device must pick the same folder, and the Drive client on each machine must have
finished its transfer. Sync is therefore near-real-time, not instant: the Drive client is
the one talking to Google, so what a device sees depends on when it last downloaded the
file.

Signing in with a Google account inside the app exists only on Android. Google no longer
allows the browser-based desktop flow, so on Windows and Linux the panel hides that option
and works with the folder instead (`supportsGoogle()` returns `false`).

## Rebuilding the desktop packages

The app itself is closed-source: `resources.neu` is a packed archive and its `index.html`
and `desktop.js` are never unpacked into the repository. The script does that in a scratch
directory, injects the layer and packs the archive back, so both platforms keep working
without touching the source of the app.

```bash
# inject into both packages (idempotent — running it again changes nothing)
python Pulsar-Sync/tools/build_desktop_sync.py

# only report whether a package already carries the layer
python Pulsar-Sync/tools/build_desktop_sync.py --check

# check the archives afterwards (checksums, script tags, runtime hooks)
python Pulsar-Sync/tools/test_desktop_bundle.py
```

What the script does inside the archive:

1. `resources/cloud-sync.js` — the desktop adapter, byte-for-byte copy of
   `desktop-cloud-sync.js`.
2. `resources/drive-sync.js` — the engine, byte-for-byte copy of `drive-sync.js`.
3. `resources/index.html` — two `<script>` lines right after `desktop.js`, adapter first
   (it registers before the engine starts).
4. The same runtime patches Android gets: `netId` and album/year are persisted, library
   changes emit `pulsar:library`, and the merge hooks are attached to the host API.

Neutralino verifies a SHA-256 checksum for every file at startup, and `neu.py` recomputes
them, so nothing else in the archive may change — the script re-checks the untouched files
byte by byte before it writes the result.

## Android

`Pulsar-Android/tools/build_web_assets.py` reads the engine from this folder and applies
`cloud_runtime_patches.py`, so the Android copy of the runtime is generated from the same
source. The desktop-only `<script>` lines are stripped from the generated `www/index.html`,
which keeps one copy of the engine on the page.

## Checks

```bash
node Pulsar-Sync/tools/test_drive_sync.js     # engine, panel, Android plugins, desktop adapter
python Pulsar-Sync/tools/test_desktop_bundle.py   # the two packed archives
node Pulsar-Android/tools/test_background_watchdog.js
```

The desktop adapter is tested for real: the suite loads `desktop-cloud-sync.js` into a VM
with a fake `Neutralino` filesystem, so picking a folder, writing the manifest, reading it
back on a second "computer" and reporting a write failure all go through the shipped code.

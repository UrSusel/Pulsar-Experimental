# Pulsar for Android — experimental port

This is a separate Android project; it does not change the Windows or Linux app folders.

## Current milestone

- Loads the packed Pulsar web runtime inside a Capacitor Android shell and keeps the existing player UI and browser-based library logic.
- Changes the desktop folder picker into Android's multi-file audio picker and keeps the network-library view available on Android.
- Resolves YouTube audio with a built-in native Android InnerTube extractor first. It bootstraps the current public player API key/visitor data from YouTube and tries several player-client profiles; no user-run bridge, self-hosted server, yt-dlp, Python runtime, or extra extractor package is required. Public Piped/Cobalt endpoints remain fallbacks.
- Downloads each resolved candidate natively into app-private cache with the matching client User-Agent, then uses that local audio for preview/playback and in-app library import. This avoids WebView CORS and missing-CDN-header failures when YouTube returns a direct URL.
- Adds Android safe-area handling for settings and dialogs, plus a compact three-row mobile control bar that retains the track text and transport controls.
- Keeps the karaoke/lyrics panel inside its own scroll area: synchronized lines only scroll that panel, so on phones the cover stays put and the track title, artist and progress bar stay at the bottom of the screen above the control bar.
- Drops the fullscreen button from the mobile app (fullscreen only duplicated the automatic hiding of the control bar). When the control bar hides by itself, the rest of the player slides down into the freed space: the karaoke panel grows, the middle progress bar fades back in and the track text settles lower, so the free area above the control bar is used instead of staying empty.
- Adds an Android media-playback foreground service, `MediaSession`, media notification, lock-screen/notification transport controls, and a partial wake lock while audio is playing. Controls are wired back to the existing WebView player; the notification permission is requested as soon as a track exists, so the notification is already in place before the app leaves the foreground.
- Background playback is defended in four layers: the WebView renderer is kept at important priority while the app is invisible, the activity re-resumes the WebView when Capacitor pauses it for a playing track, the foreground service holds the media session and wake lock, and `android-bridge.js` watches the audio element in the background and undoes a pause or stall coming from the system (a system pause is told apart from an app or user pause, and retries stop after a few attempts instead of fighting a dead pipeline). A suspended Web Audio context is resumed as well.
- Optionally syncs the library between devices through the user's own Google Drive. Only metadata travels: track titles, artists, albums, years, favourites, play counts, album membership and the YouTube identifier. Audio files, album cover blobs, local file paths and stream URLs never leave the device — stream URLs expire after a few hours and are bound to the network they were resolved on, so the other device re-resolves them itself with its own extractor. The manifest lives in the hidden application data folder (`drive.appdata`), and a readable copy is also written to `Pulsar/pulsar-library.json` in the user's own Drive (`drive.file`). No Pulsar server is involved: the device talks to Google directly.
- Sync is off by default and starts only after signing in with the user's own Google account. Tracks are matched between devices by `youtube:<videoId>` (or by name+size for local files), never by the local database id, which differs per device. Merging is field level: when both sides know when a change happened the newer one wins (so un-favouriting propagates), and on a first sync, where neither side has a comparable age, missing text is filled in, a favourite is never lost and play counters take the maximum.
- Deleting never deletes files: a track removed on one device becomes a tombstone in the manifest, the other device only reports it in the Cloud panel and keeps its audio. Entries that exist in the cloud but not on this device are listed as “cloud only” and are not turned into empty, unplayable library rows.
- Extracted web assets are generated locally from `../Pulsar-Linux/resources.neu` into the ignored `www/` folder; do not commit `www/` or unpacked app HTML/JS. The app UI/runtime source remains closed-source.

**Not release-ready yet:** This change has not been built or tested on an Android device because the current workspace has no JDK/Android SDK. YouTube changes its private InnerTube API and player-client rules; the built-in resolver currently accepts direct HTTPS formats and already-signed URLs, but does not implement YouTube's encrypted `s` signature decipher or mint proof-of-origin tokens. It falls through across client profiles and public providers, but some videos or networks may still be blocked. Verify playback and in-app saving against the user's affected videos, downloads with Wi-Fi/mobile data, screen-off playback, notification permission denial, media buttons, seeking, and Android-version compatibility before relying on it. Android still does not export MP3 files to a user-selected device folder, and a native Android mini-player is not implemented. Google Drive sync is also unverified on a device: the OAuth round trip through the system browser, the redirect intent-filter and the Drive upload/download calls still need a real run.

## Cloud sync setup (Google Drive)

The sync needs its own OAuth client, which only the app owner creates once:

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project.
2. Enable the **Google Drive API** for it.
3. Configure the OAuth consent screen (External, Testing is enough) and add your own Google account under **Test users**.
4. Create credentials → OAuth client ID → application type **Desktop app**. Note the **Client ID** and **Client secret**.
5. Add the redirect URI `pl.ursusel.pulsar.android:/oauth2redirect` to that client (it must match the `intent-filter` in `android/app/src/main/AndroidManifest.xml` character for character).
6. In the app: Settings → **Chmura** → paste the Client ID and secret → *Zapisz* → *Zaloguj się kontem Google* → enable *Synchronizuj automatycznie*.

Only the two non-sensitive scopes `drive.appdata` and `drive.file` are requested, so no Google verification or security assessment is needed; a personal “app not verified” warning is expected and can be dismissed. The refresh token is stored in the app's private shared preferences.

## Checks without a device

```bash
node Pulsar-Android/tools/test_background_watchdog.js
node Pulsar-Android/tools/test_drive_sync.js
```

The first runs the background-playback guard from `android-bridge.js` against a simulated WebView and media element (eight scenarios: system pause, notification pause, in-app pause, healthy background playback, frozen pipeline, retry limit, re-arm on resume, notification permission).

The second runs the whole Drive sync offline — a fake plugin with an in-memory Drive, a fake library and a fake IndexedDB — and asserts what matters before a phone is involved: no audio, cover or path ever lands in the manifest, how two devices merge, that deletions never delete audio, that the merge is idempotent and that the runtime hooks map album membership correctly. Useful when no Android device is at hand.

## Build

Requirements: Node.js 22+/npm, Python 3, Android Studio with Android SDK 36, and JDK 21+.

```bash
npm ci
npm run android:sync
npm run android:open
# or, with an emulator/device connected:
npm run android:run
```

The Capacitor `android/` project is included in this folder. Use Android Studio to build/run on an emulator or device. After changing the packed runtime, run `npm run android:sync` again to regenerate and copy the web assets.

The build deliberately reads the existing packed runtime instead of checking in unpacked player sources. The generated `www/` tree is disposable and ignored by Git.

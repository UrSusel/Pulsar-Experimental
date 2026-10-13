# Pulsar for Android — experimental port

This is a separate Android project; it does not change the Windows or Linux app folders.

## Current milestone

- Loads the packed Pulsar web runtime inside a Capacitor Android shell and keeps the existing player UI and browser-based library logic.
- Changes the desktop folder picker into Android's multi-file audio picker and keeps the network-library view available on Android.
- Resolves YouTube audio with a built-in native Android InnerTube extractor first. It bootstraps the current public player API key/visitor data from YouTube and tries several player-client profiles; no user-run bridge, self-hosted server, yt-dlp, Python runtime, or extra extractor package is required. Public Piped/Cobalt endpoints remain fallbacks.
- Downloads each resolved candidate natively into app-private cache with the matching client User-Agent, then uses that local audio for preview/playback and in-app library import. This avoids WebView CORS and missing-CDN-header failures when YouTube returns a direct URL.
- Adds Android safe-area handling for settings and dialogs, plus a compact three-row mobile control bar that retains the track text and transport controls.
- Keeps the karaoke/lyrics panel inside its own scroll area: synchronized lines only scroll that panel, so on phones the cover stays put and the track title, artist and progress bar stay at the bottom of the screen above the control bar.
- Drops the fullscreen button from the mobile app (fullscreen only duplicated the automatic hiding of the control bar) and keeps one progress bar: the middle copy no longer fades in when the bar hides, and the track text no longer shifts, so nothing moves on screen once playback starts.
- Adds an Android media-playback foreground service, `MediaSession`, media notification, lock-screen/notification transport controls, and a partial wake lock while audio is playing. Controls are wired back to the existing WebView player; notification permission is requested on first playback where Android requires it. While a track plays, the activity re-resumes the WebView on pause so audio keeps playing in the background and with the screen off, and a suspended Web Audio context is resumed again.
- Extracted web assets are generated locally from `../Pulsar-Linux/resources.neu` into the ignored `www/` folder; do not commit `www/` or unpacked app HTML/JS. The app UI/runtime source remains closed-source.

**Not release-ready yet:** This change has not been built or tested on an Android device because the current workspace has no JDK/Android SDK. YouTube changes its private InnerTube API and player-client rules; the built-in resolver currently accepts direct HTTPS formats and already-signed URLs, but does not implement YouTube's encrypted `s` signature decipher or mint proof-of-origin tokens. It falls through across client profiles and public providers, but some videos or networks may still be blocked. Verify playback and in-app saving against the user's affected videos, downloads with Wi-Fi/mobile data, screen-off playback, notification permission denial, media buttons, seeking, and Android-version compatibility before relying on it. Android still does not export MP3 files to a user-selected device folder, and a native Android mini-player is not implemented.

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

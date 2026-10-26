# Pulsar Editor 2.0 — audio i napisy (desktop)

Moduł dla wersji **Windows i Linux**, wbudowany w gotowe `resources.neu`. Zachowuje nieniszczący edytor WAV/LRC i dodaje precyzyjną edycję, sesje oraz natywny eksport przez FFmpeg.

## Dla użytkownika

1. Wybierz utwór i kliknij **nożyczki** obok przycisku napisów.
2. W zakładce **Audio**:
   - przeciągnij po fali, aby usunąć fragment; chwyć czerwoną granicę, aby ją przesunąć;
   - użyj **+ / −** albo **Ctrl + kółko**, aby powiększyć falę do 32×; **Pełny utwór** wraca do całości;
   - każdy wycinek ma pola początku i końca z krokiem **1 ms**;
   - **Wykryj ciszę** korzysta z regulowanego progu w dB i minimalnej długości ciszy;
   - **Fade-in**, **fade-out** i **wygładzanie łączeń** ustawia się niezależnie w milisekundach;
   - **Podgląd bez wycinków** pomija zaznaczenia podczas odtwarzania;
   - **Zapisz sesję** zachowuje decyzje edycji. Zmiany zapisują się też automatycznie i wracają po ponownym otwarciu utworu. **Usuń sesję** czyści zapisane decyzje, nie audio.
3. Wybierz **WAV PCM**, **MP3 192 kbps** albo **FLAC** i eksportuj jako nowy utwór. Import wyniku do biblioteki jest opcjonalny.
4. W zakładce **Napisy** reguluj przesunięcie suwakiem, polem liczbowym lub przyciskami ±0,1/±0,5 s. Dodatnia wartość opóźnia tekst, ujemna przyspiesza. **Eksportuj przesunięte .lrc** zapisuje osobny plik.

Edytor nigdy nie zapisuje pod ścieżką oryginału. Metadane, okładka i dopasowane napisy są przenoszone do wpisu biblioteki. Linie z usuniętych zakresów znikają, a pozostałe czasy są przeliczane po cięciach i ręcznym przesunięciu.

## FFmpeg i duże pliki

- **WAV** dla zwykłych plików nadal działa bez FFmpeg, przez Web Audio i PCM 16-bit.
- **MP3 i FLAC** wymagają `ffmpeg.exe` (Windows) albo `ffmpeg` (Linux) obok aplikacji lub w `PATH`.
- Pliki powyżej **80 MB** lub **30 minut** automatycznie używają natywnej ścieżki FFmpeg. Nie jest tworzony pełny `AudioBuffer`; cięcie i przejścia wykonuje FFmpeg. Fala pochodzi z zapisanej analizy, jeśli jest dostępna, a granice zawsze można ustawić czasem.
- Jeśli źródło ma ścieżkę na dysku, FFmpeg czyta je bezpośrednio. Dla utworu tylko z biblioteki mostek tworzy tymczasową kopię i usuwa ją po eksporcie.
- Przy natywnym wyniku powyżej **256 MB** można zapisać plik, ale import do biblioteki jest pomijany dla ochrony pamięci WebView.

Sesja w `localStorage` zawiera tylko zakresy, ustawienia i zoom — nigdy dane audio.

## Pliki

- `editor-core.js` — cięcia, cisza, WAV, przejścia, argumenty FFmpeg i LRC; bez DOM;
- `lyrics-core.js` — parser zwykłego/rozszerzonego LRC oraz LRCLIB Lyricsfile z rzeczywistymi czasami słów; jest wstawiany inline do wspólnego runtime;
- `audio-editor.js` / `audio-editor.css` — panel, zoom, granice, sesje, podgląd i eksport;
- `tools/runtime_patches.py` — idempotentne zaczepy runtime edytora;
- `tools/build_desktop_editor.py` — wspólny build Windows/Linux dla edytora i `Pulsar-Extras`;
- `tools/test_editor_core.js`, `test_lyrics_core.js`, `test_desktop_editor.py`, `test_editor_browser.mjs` — testy logiki, parserów, paczek i E2E.

Auto-DJ 2.0, automatyczne kopie i natywny mostek są opisane w [`Pulsar-Extras/README.md`](../Pulsar-Extras/README.md).

## Build i testy

```bash
python Pulsar-Editor/tools/build_desktop_editor.py
python Pulsar-Editor/tools/build_desktop_editor.py --check
node Pulsar-Editor/tools/test_editor_core.js
node Pulsar-Editor/tools/test_lyrics_core.js
node Pulsar-Extras/tools/test_extras.js
python Pulsar-Editor/tools/test_desktop_editor.py
python Pulsar-Sync/tools/test_desktop_bundle.py
python Pulsar-Sync/tools/refresh_download_zips.py
```

Test przeglądarkowy wymaga `puppeteer-core` i `@sparticuz/chromium` oraz rozpakowanego `resources.neu`:

```bash
python Pulsar-Sync/tools/neu.py unpack Pulsar-Windows/resources.neu .tmp/editor-test
NODE_PATH=<node_modules> node Pulsar-Editor/tools/test_editor_browser.mjs .tmp/editor-test/resources
EDITOR_DESKTOP=1 NODE_PATH=<node_modules> node Pulsar-Editor/tools/test_editor_browser.mjs .tmp/editor-test/resources
```

E2E używa syntetycznego WAV z ciszą i LRC. Sprawdza cięcia, dokładne granice, zoom, zapis/wznowienie sesji, podgląd, WAV, metadane, napisy po restarcie, rzeczywiste rozjaśnianie słów w zwykłym panelu, fallback liniowy, brak osobnej nakładki karaoke, Auto-DJ oraz — w wariancie desktopowym — natywny zapis, FFmpeg, tryb dużego pliku, rotację `.pulsarlib` i ostrzeżenie przed usunięciem jedynej kopii. Stub FFmpeg testuje integrację i argumenty; nie jest testem zgodności samego kodeka.

Android pomija desktopowe zasoby edytora i rozszerzeń w `Pulsar-Android/tools/build_web_assets.py`. Wspólny parser i renderer napisów są częścią inline `index.html`, więc czasy słów działają także na telefonie bez kopiowania desktopowych assetów.

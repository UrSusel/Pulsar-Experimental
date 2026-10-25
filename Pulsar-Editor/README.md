# Pulsar Editor — audio i napisy (desktop)

Moduł dla wersji **Windows i Linux**. Jest wbudowany w gotowe `resources.neu`; nie wymaga FFmpeg, Node.js ani dodatkowych bibliotek w zainstalowanej aplikacji.

## Dla użytkownika

1. Wybierz utwór w Pulsarze.
2. Kliknij ikonę **nożyczek** obok przycisku napisów.
3. W zakładce **Audio**:
   - przeciągnij po fali, aby zaznaczyć fragment do usunięcia, albo wpisz dokładny czas początku i końca;
   - **Wykryj ciszę** zaznacza ciche zakresy (próg −45 dB, minimum 0,6 s);
   - **Podgląd bez wycinków** pomija zaznaczenia podczas odtwarzania;
   - **Zapisz jako nowy utwór WAV** tworzy plik PCM 16-bit i opcjonalnie dodaje go do biblioteki.
4. W zakładce **Napisy** reguluj przesunięcie suwakiem, polem liczbowym lub przyciskami ±0,1/±0,5 s. Dodatnia wartość opóźnia tekst, ujemna przyspiesza. Zmiana działa od razu i jest zapamiętywana dla utworu. **Eksportuj przesunięte .lrc** zapisuje osobny plik.

Edycja jest niezdestructywna: edytor nie pozwala zapisać wyniku pod ścieżką oryginalnego audio. Metadane i okładka są kopiowane. Jeżeli źródło ma napisy LRC, zapisana kopia otrzymuje własne dopasowane napisy: linie z usuniętych zakresów znikają, a pozostałe czasy są skracane o wycinki z uwzględnieniem ręcznego przesunięcia. Napisy i przesunięcia przeżywają restart i backup biblioteki.

> Eksport do WAV dekoduje źródło przez WebView i zapisuje PCM bez dodatkowej kompresji stratnej. Plik WAV będzie zwykle większy niż MP3/FLAC. Dostępność dekodowania formatu wejściowego zależy od kodeków WebView2/WebKitGTK, tak jak przy zwykłym odtwarzaniu.

## Pliki

- `editor-core.js` — normalizacja cięć, wykrywanie ciszy, WAV PCM, mapowanie i eksport LRC; bez DOM;
- `audio-editor.js` — panel, fala, podgląd, natywny zapis i integracja z biblioteką;
- `audio-editor.css` — wygląd panelu;
- `tools/runtime_patches.py` — idempotentne zaczepy w zapakowanym runtime (trwały offset, API biblioteki, przechowywanie LRC);
- `tools/build_desktop_editor.py` — build i kontrola `--check` dla Windows/Linux.

## Build

```bash
python Pulsar-Editor/tools/build_desktop_editor.py
python Pulsar-Sync/tools/refresh_download_zips.py
```

Build nie nadpisuje warstwy `Pulsar-Sync` ani innych zasobów. Android pomija desktopowe znaczniki edytora w `Pulsar-Android/tools/build_web_assets.py`.

## Testy

```bash
node Pulsar-Editor/tools/test_editor_core.js
python Pulsar-Editor/tools/test_desktop_editor.py
python Pulsar-Sync/tools/test_desktop_bundle.py
python Pulsar-Editor/tools/build_desktop_editor.py --check
python Pulsar-Sync/tools/refresh_download_zips.py --check
```

Test przeglądarkowy wymaga `puppeteer-core` i `@sparticuz/chromium` oraz rozpakowanego `resources.neu`:

```bash
python Pulsar-Sync/tools/neu.py unpack Pulsar-Windows/resources.neu .tmp/editor-test
NODE_PATH=<node_modules> node Pulsar-Editor/tools/test_editor_browser.mjs .tmp/editor-test/resources
# Ta sama ścieżka, ale z natywnym dialogiem i zapisem przez stub Neutralino:
EDITOR_DESKTOP=1 NODE_PATH=<node_modules> node Pulsar-Editor/tools/test_editor_browser.mjs .tmp/editor-test/resources
```

Test integracyjny używa syntetycznego WAV z dwoma ciszami i LRC. Sprawdza wykrywanie, ręczne cięcia, podgląd, zapis, metadane, mapowanie napisów i odtworzenie biblioteki po restarcie.

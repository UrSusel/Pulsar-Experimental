# Pulsar Karaoke

Wspólny, otwarty moduł dużych napisów dla Windows, Linux i Androida. Nie zastępuje istniejącego panelu LRC ani edytora tekstu — korzysta z tego samego `window.__player.__lyrics`, cache'u, wyszukiwania i offsetu zapisanego dla utworu.

## Obsługa

Przycisk z ekranem i liniami tekstu obok dotychczasowego przycisku napisów otwiera nakładkę karaoke.

- Duży bieżący wers, dwa poprzednie i dwa następne (o ile istnieją).
- Aktywność jest liczona jako `audio.currentTime - offset`, dokładnie jak w istniejącym runtime. Dodatni offset opóźnia napisy.
- Kliknięcie wersu przewija do `czas wersu + offset`.
- Pasek pod bieżącym wersem pokazuje postęp do następnego wersu albo do końca utworu.
- Przyciski `A−` / `A+` zmieniają skalę od 70% do 200%; dostępne są wyrównanie do środka/lewej, motywy Neon/Kontrast/Jasny i tło okładki.
- Dolny pasek ma seek, play/pauza, poprzedni/następny utwór oraz korektę synchronizacji o ±0,1 s i reset.
- `F` przełącza natywny pełny ekran, `Esc` zamyka, `Spacja` steruje odtwarzaniem, strzałki przewijają o 5 s, `+`/`−` zmieniają tekst. Gdy WebView nie zezwoli na natywny fullscreen, nakładka nadal wypełnia ekran aplikacji.
- Zwykły tekst bez znaczników czasu jest wyświetlany jako przewijana lista. Brak tekstu ma osobny, czytelny komunikat.
- Otwarcie karaoke nie przełącza starego panelu napisów; tekst jest pobierany niezależnie, bez podwójnego żądania i bez zmiany jego widoczności.

Ustawienia wyglądu są lokalne w `localStorage` pod kluczem `pulsarKaraokeSettings`. Offset pozostaje w dotychczasowym kluczu `playerLyricsOffset:<id>`.

## Pliki

- `karaoke-core.js` — czysta logika: wyszukiwanie binarne aktywnego wersu, postęp, okno sąsiednich linii, normalizacja danych i ustawień.
- `karaoke.js` — wspólny UI, zdarzenia audio, skróty i integracja z odtwarzaczem.
- `karaoke.css` — responsywny widok, safe-area Androida i motywy.
- `tools/test_karaoke_core.js` — testy logiki bez przeglądarki.

## Build i testy

```bash
node Pulsar-Karaoke/tools/test_karaoke_core.js
python Pulsar-Editor/tools/build_desktop_editor.py
python Pulsar-Android/tools/build_web_assets.py
python Pulsar-Editor/tools/build_desktop_editor.py --check
```

Build desktopowy dodaje trzy zasoby do obu `resources.neu`. Build Androida kopiuje te same pliki do generowanego, ignorowanego `www/`; nie zawiera desktopowych modułów edytora, Auto-DJ ani kopii. Test przeglądarkowy `Pulsar-Editor/tools/test_editor_browser.mjs` sprawdza gotowy moduł z prawdziwym LRC, wspólny offset, klikalne wersy, ustawienia, zwykły tekst i stan pusty.

#!/usr/bin/env python3
"""Regression checks for the cross-platform retro player layout and controls."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
THEMES = {"classic", "green", "pink", "amber", "metal"}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def check(platform: str) -> None:
    source = (ROOT / "Pulsar-Core" / platform / "resources" / "index.html").read_text(encoding="utf-8")

    require('id="smRetroTheme"' in source, f"{platform}: theme selector is missing")
    require("localStorage.setItem('playerRetroTheme', chosen)" in source,
            f"{platform}: selected theme is not persisted")
    require("document.body.dataset.retroTheme = chosen" in source,
            f"{platform}: theme selection is not applied to the document")
    require("body.retro-mode { --retro-cyan:" in source,
            f"{platform}: missing classic retro theme styling")
    for theme in THEMES - {"classic"}:
        require(f'data-retro-theme="{theme}"' in source,
                f"{platform}: missing retro theme styling for {theme}")

    retro_tick = re.search(r"function resetHideTimer\(\)\s*\{(.*?)\n  \}", source, re.S)
    require(retro_tick is not None and
            "if (document.body.classList.contains('retro-mode')) return;" in retro_tick.group(1),
            f"{platform}: retro playback bar can still be auto-hidden")
    require("body.retro-mode .bottombar.hidden { transform: none; opacity: 1; pointer-events: auto; }" in source,
            f"{platform}: retro control bar hidden styling is not overridden")

    track_click = re.search(
        r"li\.addEventListener\('click', \(\) => \{(.*?)\n      \}\);\n      trackListEl\.appendChild\(li\);",
        source, re.S)
    require(track_click is not None and
            "if (!document.body.classList.contains('retro-mode')) closeLibrary();" in track_click.group(1),
            f"{platform}: selecting a track closes the retro library")
    album_play = re.search(r"function playAlbumFrom\(album, withShuffle\)\s*\{(.*?)\n  \}", source, re.S)
    require(album_play is not None and
            "if (!document.body.classList.contains('retro-mode')) closeLibrary();" in album_play.group(1),
            f"{platform}: playing an album closes the retro library")

    require("overflow-x: clip" in source and
            "body.retro-mode .player::-webkit-scrollbar { display: none; width: 0; height: 0; }" in source,
            f"{platform}: cover display can show a horizontal scrollbar")
    require("width: min(100%, 180px)" in source,
            f"{platform}: retro cover display artwork is not compact")
    require("grid-template-columns:repeat(auto-fill,minmax(136px,160px))" in source and
            "max-width:144px" in source,
            f"{platform}: album artwork cards are not constrained to a compact size")
    print(f"{platform}: retro layout/theme regressions passed")


if __name__ == "__main__":
    for target in ("Linux", "Windows"):
        check(target)

#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import math
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "lyrics-aligner.py"
SPEC = importlib.util.spec_from_file_location("pulsar_lyrics_aligner", MODULE_PATH)
aligner = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(aligner)


def request(**changes):
    value = {
        "audio_path": "song.mp3",
        "lines": [" I saw the fire ", "Take my breath"],
        "language": "en",
        "model": "base",
        "model_root": "models",
    }
    value.update(changes)
    return value


def result():
    return {
        "segments": [
            {
                "start": 30.205,
                "text": "I saw the fire",
                "words": [
                    {"word": "I ", "start": 30.205, "end": 30.372, "probability": 0.9},
                    {"word": "saw ", "start": 30.372, "end": 30.581, "probability": 0.8},
                    {"word": "the ", "start": 30.581, "end": 30.779, "probability": 0.95},
                    {"word": "fire", "start": 30.779, "end": 31.299, "probability": 0.85},
                ],
            },
            {
                "start": 78.68,
                "text": "Take my breath",
                "words": [
                    {"word": "Take ", "start": 78.68, "end": 78.897},
                    {"word": "my ", "start": 78.897, "end": 79.137},
                    {"word": "breath", "start": 79.137, "end": 79.761},
                ],
            },
        ]
    }


class RequestTests(unittest.TestCase):
    def test_request_is_validated_and_normalized(self):
        parsed = aligner.validate_request(request())
        self.assertEqual(parsed["lines"], ["I saw the fire", "Take my breath"])
        self.assertEqual(parsed["language"], "en")
        self.assertEqual(parsed["model"], "base")

    def test_invalid_requests_fail_closed(self):
        for changes in (
            {"audio_path": ""}, {"lines": []}, {"lines": [" "]},
            {"language": "auto"}, {"model": "large-v3"}, {"model_root": ""},
        ):
            with self.subTest(changes=changes), self.assertRaises(aligner.AlignmentError):
                aligner.validate_request(request(**changes))


class EnvironmentTests(unittest.TestCase):
    @staticmethod
    def modules(pyav_version, decode_audio):
        stable = types.ModuleType("stable_whisper")
        stable.__version__ = "2.19.1"
        faster = types.ModuleType("faster_whisper")
        faster.__version__ = "1.2.1"
        faster.__path__ = []
        audio = types.ModuleType("faster_whisper.audio")
        audio.decode_audio = decode_audio
        faster.audio = audio
        av = types.ModuleType("av")
        av.__version__ = pyav_version
        return {
            "stable_whisper": stable,
            "faster_whisper": faster,
            "faster_whisper.audio": audio,
            "av": av,
        }

    def test_pyav19_is_rejected_before_alignment(self):
        def forbidden_decode(*args, **kwargs):
            raise AssertionError("decoder should not run for a known incompatible version")
        with patch.dict(sys.modules, self.modules("19.0.2", forbidden_decode)):
            with self.assertRaisesRegex(aligner.AlignmentError, "av<19"):
                aligner.check_environment()

    def test_environment_check_really_decodes_pcm(self):
        seen = {}
        def decode(buffer, sampling_rate):
            seen["header"] = buffer.read(4)
            seen["rate"] = sampling_rate
            return types.SimpleNamespace(size=1600)
        with patch.dict(sys.modules, self.modules("18.1.0", decode)):
            checked = aligner.check_environment()
        self.assertTrue(checked["ok"])
        self.assertEqual(checked["pyav"], "18.1.0")
        self.assertEqual(seen, {"header": b"RIFF", "rate": 16000})


class ConversionTests(unittest.TestCase):
    def test_real_word_times_and_source_text_are_preserved(self):
        converted = aligner.convert_result(result(), ["I saw the fire", "Take my breath"])
        self.assertEqual(converted["word_count"], 7)
        self.assertEqual(converted["coverage"], 1.0)
        self.assertEqual(converted["lines"][0]["t"], 30.205)
        self.assertEqual(converted["lines"][0]["words"][0], {"t": 30.205, "txt": "I "})
        self.assertEqual(converted["lines"][1]["words"][2], {"t": 79.137, "txt": "breath"})
        self.assertAlmostEqual(converted["mean_probability"], 0.875)

    def test_missing_time_is_not_replaced_with_zero(self):
        data = result()
        data["segments"][0]["words"][1]["start"] = None
        converted = aligner.convert_result(data, ["I saw the fire", "Take my breath"])
        self.assertNotIn("words", converted["lines"][0])
        self.assertIn("words", converted["lines"][1])
        self.assertTrue(all(word["t"] > 30 for line in converted["lines"] for word in line.get("words", [])))

    def test_nan_and_negative_times_are_rejected(self):
        for bad in (math.nan, -0.1):
            data = result()
            data["segments"][0]["words"][0]["start"] = bad
            converted = aligner.convert_result(data, ["I saw the fire", "Take my breath"])
            self.assertNotIn("words", converted["lines"][0])
            self.assertTrue(all(word["t"] > 30 for line in converted["lines"] for word in line.get("words", [])))

    def test_low_coverage_is_rejected(self):
        data = result()
        data["segments"] = data["segments"][:1]
        data["segments"][0]["text"] = "I"
        data["segments"][0]["words"] = data["segments"][0]["words"][:1]
        with self.assertRaisesRegex(aligner.AlignmentError, "zbyt małą"):
            aligner.convert_result(data, ["I saw the fire", "Take my breath"])

    def test_mismatched_words_fall_back_to_the_line(self):
        data = result()
        data["segments"][0]["words"][0]["word"] = "Wrong "
        converted = aligner.convert_result(data, ["I saw the fire", "Take my breath"])
        self.assertNotIn("words", converted["lines"][0])
        self.assertIn("words", converted["lines"][1])

    def test_empty_alignment_is_an_error(self):
        with self.assertRaises(aligner.AlignmentError):
            aligner.convert_result({"segments": []}, ["I saw the fire"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

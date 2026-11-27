import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline import aspa


def raw(n=aspa.MIN_EXPECTED, extra=()):
    """n well-formed ASPAs (customers 1..n, provider 174), plus extra entries."""
    return {"buildtime": "2026-11-27T06:42:05Z",
            "aspas": [{"customer_asid": c, "expires": 2_000_000_000, "providers": [174]} for c in range(1, n + 1)] + list(extra)}


class TestExtract(unittest.TestCase):
    def test_keeps_customers_and_sorted_providers(self):
        out = aspa.extract(raw(extra=[{"customer_asid": 13335, "expires": 2_000_000_000, "providers": [3356, 174, 0]}]))
        self.assertEqual(out[13335], [0, 174, 3356])
        self.assertEqual(out[1], [174])

    def test_drops_expired(self):
        out = aspa.extract(raw(extra=[{"customer_asid": 99999, "expires": 100, "providers": [174]}]), now=1000)
        self.assertNotIn(99999, out)

    def test_merges_duplicate_customers(self):
        out = aspa.extract(raw(extra=[{"customer_asid": 1, "providers": [6939]}]))
        self.assertEqual(out[1], [174, 6939])

    def test_rejects_bad_entries_and_too_few(self):
        for bad in [{"customer_asid": "1", "providers": [2]}, {"customer_asid": 0, "providers": [2]},
                    {"customer_asid": 5, "providers": []}, {"customer_asid": 5, "providers": [2**32]},
                    {"customer_asid": 5, "providers": [True]}]:
            with self.assertRaises(ValueError, msg=bad):
                aspa.extract(raw(extra=[bad]))
        with self.assertRaises(ValueError):
            aspa.extract(raw(n=aspa.MIN_EXPECTED - 1))

    def test_times_shown_in_ist(self):
        self.assertEqual(aspa.to_ist("2026-11-27T06:42:05Z"), "2026-11-27T12:12:05+05:30")
        self.assertIsNone(aspa.to_ist(None))


class TestBuild(unittest.TestCase):
    def test_fresh(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "aspas.json"
            src.write_text(json.dumps(raw()))
            self.assertEqual(aspa.build(src, Path(d) / "out"), "fresh")
            doc = json.loads((Path(d) / "out" / "aspas.json").read_text())
            self.assertEqual(doc["schema_version"], 1)
            self.assertEqual(doc["customers"], aspa.MIN_EXPECTED)
            self.assertEqual(doc["aspas"]["1"], [174])
            self.assertEqual(doc["source_time"], "2026-11-27T12:12:05+05:30")
            self.assertTrue(doc["built"].endswith("+05:30"))

    def test_bad_fresh_reuses_live_file(self):
        live = aspa.document(aspa.extract(raw()), "2026-11-27T12:12:05+05:30")
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "aspas.json"
            src.write_text(json.dumps(raw(n=10)))  # too few: rejected
            with mock.patch.object(aspa, "get", return_value=json.dumps(live).encode()):
                self.assertEqual(aspa.build(src, Path(d) / "out", "https://example.test/aspas.json"), "reused")
            doc = json.loads((Path(d) / "out" / "aspas.json").read_text())
            self.assertEqual(doc["source_time"], "2026-11-27T12:12:05+05:30")  # keeps the data's real age
            self.assertIn("reused_at", doc)

    def test_missing_fresh_and_broken_live_gives_no_file(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(aspa, "get", return_value=b'{"schema_version": 2}'):
                self.assertEqual(aspa.build(Path(d) / "nope.json", Path(d) / "out", "https://example.test/x"), "none")
            self.assertFalse((Path(d) / "out" / "aspas.json").exists())


if __name__ == "__main__":
    unittest.main()

import gzip
import json
import tempfile
import unittest
from pathlib import Path

from pipeline import validation

RAW = {"schema_version": 1, "generated_at": "2026-11-28T20:13:01+05:30", "as_of": "2026-11-28T19:45:00+05:30",
       "feeds_total": 16, "counts": {"paths_verified": 2488137},
       "invalid_pairs": [
           {"customer": 151704, "provider": 153759, "side": "peer", "invalid_paths": 879, "routes": 5589, "feeds": 1,
            "first_observed": "2026-11-28T20:13:01+05:30", "customer_cc": "IN", "customer_rir": "apnic"},
           {"customer": 153292, "provider": 140148, "side": "origin", "invalid_paths": 15, "routes": 28, "feeds": 9,
            "first_observed": "2026-11-28T20:13:01+05:30", "customer_cc": "IN", "customer_rir": "apnic"},
           {"customer": 58717, "provider": 153759, "side": "origin", "invalid_paths": 762, "routes": 5163, "feeds": 1,
            "first_observed": "2026-11-28T20:13:01+05:30", "customer_cc": "BD", "customer_rir": "apnic"},
       ]}


class TestValidationPairs(unittest.TestCase):
    def test_keeps_origin_side_sorted_by_invalid_paths(self):
        doc = validation.pairs_doc(RAW)
        self.assertEqual([p[0] for p in doc["pairs"]], [58717, 153292])  # the peer-side pair is left out
        self.assertEqual(doc["pairs"][1], [153292, 140148, 15, 28, 9, "2026-11-28T20:13:01+05:30", "IN", "apnic"])
        self.assertEqual(doc["fields"][6:], ["customer_cc", "customer_rir"])
        self.assertEqual((doc["pairs_total"], doc["feeds_total"], doc["paths_verified"]), (3, 16, 2488137))

    def test_unknown_schema_or_missing_file_writes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            work, out = Path(d) / "work", Path(d) / "out"
            self.assertFalse(validation.build(work, out))
            work.mkdir()
            (work / "invalid_pairs.json.gz").write_bytes(gzip.compress(json.dumps({**RAW, "schema_version": 2}).encode()))
            self.assertFalse(validation.build(work, out))
            self.assertFalse((out / "invalid_pairs.json").exists())
            (work / "invalid_pairs.json.gz").write_bytes(gzip.compress(json.dumps(RAW).encode()))
            self.assertTrue(validation.build(work, out))
            self.assertEqual(len(json.loads((out / "invalid_pairs.json").read_text())["pairs"]), 2)


if __name__ == "__main__":
    unittest.main()

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


HYGIENE = {"schema_version": 1, "generated_at": "2026-11-28T20:13:01+05:30", "as_of": "2026-11-28T19:45:00+05:30",
           "feeds_total": 16, "evidence_thresholds": {"strong": 0.667, "partial": 0.25},
           "inputs": {"caida_citation": "The CAIDA AS Relationships Dataset, 2026-11, https://www.caida.org/catalog/datasets/as-relationships/",
                      "caida_file": "20261101.as-rel2", "ris_as_of": "2026-11-28T19:45:00+05:30",
                      "rpki_as_of": "2026-11-28T20:03:01+05:30", "aspa_history_as_of": None},
           "counts": {}, "asns": [
               {"asn": 141476, "rir": "apnic", "cc": "IN", "tas": ["apnic"], "group": "under_declared", "evidence": "partial",
                "declared": [{"asn": 9829, "rel": "provider", "seen": True}],
                "observed": [{"asn": 9829, "rel": "provider", "declared": True, "routes": 23, "share": 0.5349, "feeds": 15,
                              "evidence": "strong", "first_observed": "2026-11-28T20:08:08+05:30"},
                             {"asn": 45117, "rel": "provider", "declared": False, "routes": 20, "share": 0.4651, "feeds": 10,
                              "evidence": "partial", "first_observed": "2026-11-28T20:08:08+05:30"}],
                "missing": [45117], "missing_unknown_rel": [], "declared_not_seen": [], "origin_routes": 43, "aspa": None},
               {"asn": 3333, "rir": "ripencc", "cc": "NL", "tas": ["ripencc"], "group": "match", "evidence": None,
                "declared": [], "observed": [], "missing": [], "missing_unknown_rel": [], "declared_not_seen": [],
                "origin_routes": 5, "aspa": None}]}


class TestHygiene(unittest.TestCase):
    def test_summary_rows_missing_details_and_shards(self):
        summary, buckets = validation.hygiene_docs(HYGIENE)
        self.assertEqual(summary["asns"][0], [141476, "apnic", "IN", "under_declared", "partial", 1, 2])
        self.assertEqual(summary["missing"], {"141476": [[45117, 10, 0.4651, "partial", "2026-11-28T20:08:08+05:30"]]})
        self.assertIn("CAIDA", summary["inputs"]["caida_citation"])
        self.assertEqual(buckets[76]["141476"]["origin_routes"], 43)
        self.assertEqual(buckets[33]["3333"]["group"], "match")

    def test_citation_is_required_and_files_written(self):
        with self.assertRaises(ValueError):
            validation.hygiene_docs({**HYGIENE, "inputs": {}})
        with tempfile.TemporaryDirectory() as d:
            work, out = Path(d) / "work", Path(d) / "out"
            work.mkdir()
            (work / "hygiene.json.gz").write_bytes(gzip.compress(json.dumps(HYGIENE).encode()))
            self.assertTrue(validation.build_hygiene(work, out))
            self.assertTrue((out / "hygiene" / "summary.json").exists())
            self.assertEqual(len(list((out / "hygiene" / "asn").glob("*.json"))), 100)


if __name__ == "__main__":
    unittest.main()

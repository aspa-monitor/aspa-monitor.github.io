import unittest

from pipeline.build_site import assign_colours


class TestColours(unittest.TestCase):
    def test_first_build_uses_order(self):
        self.assertEqual(assign_colours(["a", "b", "c"], {}), {"a": 0, "b": 1, "c": 2})

    def test_removed_peer_does_not_repaint_others(self):
        before = assign_colours(["a", "b", "c"], {})
        self.assertEqual(assign_colours(["a", "c"], before), {"a": 0, "c": 2})

    def test_new_peer_takes_lowest_free_slot(self):
        self.assertEqual(assign_colours(["a", "c", "d"], {"a": 0, "c": 2}), {"a": 0, "c": 2, "d": 1})

    def test_bad_or_duplicate_previous_slots(self):
        got = assign_colours(["a", "b", "c"], {"a": 1, "b": 1, "c": "x"})
        self.assertEqual(got["a"], 1)
        self.assertEqual(sorted(got.values()), [0, 1, 2])

    def test_ninth_peer_gets_slot_8(self):
        got = assign_colours([f"s{i}" for i in range(9)], {})
        self.assertEqual(got["s8"], 8)

    def test_more_than_sixteen(self):
        got = assign_colours([f"s{i}" for i in range(17)], {})
        self.assertIsNone(got["s16"])


if __name__ == "__main__":
    unittest.main()

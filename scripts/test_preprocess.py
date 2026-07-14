import json
import os
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(BASE_DIR, "build", "data.json")


class TestPreprocessOutput(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(DATA_PATH) as f:
            cls.data = json.load(f)

    def test_has_substantial_graph(self):
        self.assertGreater(len(self.data["nodes"]), 500)
        self.assertGreater(len(self.data["edges"]), 500)

    def test_poi_counts(self):
        by_type = {}
        for p in self.data["pois"]:
            by_type[p["type"]] = by_type.get(p["type"], 0) + 1
        self.assertEqual(by_type.get("hospital"), 8)
        self.assertEqual(by_type.get("police"), 7)
        self.assertGreaterEqual(by_type.get("school", 0), 8)
        self.assertGreaterEqual(by_type.get("community_centre", 0), 1)
        self.assertGreaterEqual(by_type.get("place_of_worship", 0), 1)

    def test_patrol_route_connects_all_pois(self):
        adj = {}
        for a, b in self.data["patrolEdges"]:
            adj.setdefault(a, set()).add(b)
            adj.setdefault(b, set()).add(a)
        poi_nodes = {p["node"] for p in self.data["pois"]}
        start = next(iter(poi_nodes))
        seen = {start}
        stack = [start]
        while stack:
            u = stack.pop()
            for v in adj.get(u, ()):
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        missing = poi_nodes - seen
        self.assertEqual(missing, set(), f"POIs not connected by patrol route: {missing}")

    def test_strategy_comparison_present_and_sane(self):
        sc = self.data["strategyComparison"]
        self.assertGreater(sc["individual"]["total"], 0)
        self.assertGreater(sc["patrol"]["total"], 0)
        self.assertGreater(len(sc["individual"]["assignments"]), 0)
        for a in sc["individual"]["assignments"]:
            self.assertIn("poi", a)
            self.assertIn("station", a)
            self.assertAlmostEqual(a["roundtrip"], 2 * a["cost"])


if __name__ == "__main__":
    unittest.main()

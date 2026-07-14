import unittest
import tempfile
import os
from graph_core import haversine_m, parse_osm

FIXTURE_OSM = """<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
 <node id="1" lat="4.6100" lon="-74.1500"/>
 <node id="2" lat="4.6101" lon="-74.1501"/>
 <node id="3" lat="4.6102" lon="-74.1502"/>
 <way id="100">
  <nd ref="1"/>
  <nd ref="2"/>
  <tag k="highway" v="residential"/>
 </way>
 <way id="101">
  <nd ref="2"/>
  <nd ref="3"/>
  <tag k="highway" v="footway"/>
 </way>
</osm>
"""


class TestHaversine(unittest.TestCase):
    def test_known_distance(self):
        d = haversine_m(0.0, 0.0, 1.0, 0.0)
        self.assertAlmostEqual(d, 111195, delta=200)

    def test_zero_distance(self):
        self.assertAlmostEqual(haversine_m(4.61, -74.15, 4.61, -74.15), 0.0, delta=0.01)


class TestParseOsm(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".osm")
        with os.fdopen(fd, "w") as f:
            f.write(FIXTURE_OSM)

    def tearDown(self):
        os.remove(self.path)

    def test_parses_nodes_and_ways(self):
        nodes, ways = parse_osm(self.path)
        self.assertEqual(nodes[1], (4.6100, -74.1500))
        self.assertEqual(nodes[2], (4.6101, -74.1501))
        self.assertEqual(len(ways), 2)
        self.assertEqual(ways[0]["tags"]["highway"], "residential")
        self.assertEqual(ways[0]["nodes"], [1, 2])
        self.assertEqual(ways[1]["tags"]["highway"], "footway")


from graph_core import build_graph, adjacency


class TestBuildGraph(unittest.TestCase):
    def setUp(self):
        self.nodes = {
            1: (4.6100, -74.1500),
            2: (4.6101, -74.1501),
            3: (4.6102, -74.1502),
        }
        self.ways = [
            {"id": 100, "tags": {"highway": "residential"}, "nodes": [1, 2]},
            {"id": 101, "tags": {"highway": "primary", "oneway": "yes"}, "nodes": [2, 3]},
            {"id": 102, "tags": {"highway": "footway"}, "nodes": [1, 3]},
        ]

    def test_excludes_non_drivable(self):
        edges = build_graph(self.nodes, self.ways)
        self.assertEqual(len(edges), 2)
        pairs = {(e["from"], e["to"]) for e in edges}
        self.assertIn((1, 2), pairs)
        self.assertIn((2, 3), pairs)
        self.assertNotIn((1, 3), pairs)

    def test_oneway_flag(self):
        edges = build_graph(self.nodes, self.ways)
        by_pair = {(e["from"], e["to"]): e for e in edges}
        self.assertFalse(by_pair[(1, 2)]["directed"])
        self.assertTrue(by_pair[(2, 3)]["directed"])

    def test_adjacency_respects_directed(self):
        edges = build_graph(self.nodes, self.ways)
        adj = adjacency(edges)
        neighbors_of_2 = {n for n, _ in adj[2]}
        self.assertIn(1, neighbors_of_2)
        self.assertIn(3, neighbors_of_2)
        neighbors_of_3 = {n for n, _ in adj.get(3, [])}
        self.assertNotIn(2, neighbors_of_3)


if __name__ == "__main__":
    unittest.main()

import unittest
import tempfile
import os
import math
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


from graph_core import dijkstra, shortest_path


class TestDijkstra(unittest.TestCase):
    def setUp(self):
        self.adj = {
            1: [(2, 1.0), (3, 4.0)],
            2: [(1, 1.0), (3, 2.0), (4, 7.0)],
            3: [(1, 4.0), (2, 2.0), (4, 1.0)],
            4: [(2, 7.0), (3, 1.0)],
        }

    def test_dist(self):
        dist, _ = dijkstra(self.adj, 1)
        self.assertEqual(dist[4], 4.0)

    def test_shortest_path_reconstruction(self):
        path, cost = shortest_path(self.adj, 1, 4)
        self.assertEqual(path, [1, 2, 3, 4])
        self.assertEqual(cost, 4.0)

    def test_unreachable(self):
        adj = {1: [(2, 1.0)], 2: [(1, 1.0)], 3: []}
        path, cost = shortest_path(adj, 1, 3)
        self.assertIsNone(path)
        self.assertEqual(cost, math.inf)


from graph_core import extract_pois


class TestExtractPois(unittest.TestCase):
    def test_snaps_to_nearest_graph_node(self):
        nodes = {
            1: (4.6100, -74.1500),
            2: (4.6150, -74.1550),
            10: (4.6149, -74.1549),
            11: (4.6151, -74.1549),
            12: (4.6151, -74.1551),
            13: (4.6149, -74.1551),
        }
        ways = [{
            "id": 999,
            "tags": {"amenity": "school", "name": "Test School"},
            "nodes": [10, 11, 12, 13],
        }]
        pois = extract_pois(nodes, ways, graph_node_ids={1, 2})
        self.assertEqual(len(pois), 1)
        self.assertEqual(pois[0]["type"], "school")
        self.assertEqual(pois[0]["name"], "Test School")
        self.assertEqual(pois[0]["node"], 2)


class TestExtractPoisAmenityTypes(unittest.TestCase):
    def test_recognizes_community_centre_and_place_of_worship(self):
        nodes = {1: (4.6100, -74.1500), 10: (4.6101, -74.1501)}
        ways = [
            {"id": 200, "tags": {"amenity": "community_centre", "name": "Salón Comunal"}, "nodes": [10]},
            {"id": 201, "tags": {"amenity": "place_of_worship", "name": "Iglesia San Rafael"}, "nodes": [10]},
        ]
        pois = extract_pois(nodes, ways, graph_node_ids={1})
        types = {p["type"] for p in pois}
        self.assertEqual(types, {"community_centre", "place_of_worship"})


from graph_core import prim_mst


class TestPrimMst(unittest.TestCase):
    def test_classic_mst(self):
        poi_ids = ["A", "B", "C", "D"]
        raw = {("A", "B"): 1.0, ("A", "C"): 3.0, ("A", "D"): 4.0,
               ("B", "C"): 2.0, ("B", "D"): 5.0, ("C", "D"): 6.0}
        cost_matrix = {}
        for (a, b), c in raw.items():
            cost_matrix[(a, b)] = c
            cost_matrix[(b, a)] = c
        mst = prim_mst(poi_ids, cost_matrix)
        self.assertEqual(len(mst), 3)
        total = sum(e[2] for e in mst)
        self.assertEqual(total, 7.0)
        connected = {poi_ids[0]}
        changed = True
        while changed:
            changed = False
            for a, b, _ in mst:
                if a in connected and b not in connected:
                    connected.add(b); changed = True
                elif b in connected and a not in connected:
                    connected.add(a); changed = True
        self.assertEqual(connected, set(poi_ids))


from graph_core import patrol_edges


class TestPatrolEdges(unittest.TestCase):
    def test_union_of_shortest_paths(self):
        adj = {
            1: [(2, 1.0)], 2: [(1, 1.0), (3, 2.0)],
            3: [(2, 2.0), (4, 1.0)], 4: [(3, 1.0)],
        }
        mst_edges = [("poiA", "poiD", 4.0)]
        poi_node = {"poiA": 1, "poiD": 4}
        edges = patrol_edges(mst_edges, poi_node, adj)
        self.assertEqual(edges, {(1, 2), (2, 3), (3, 4)})


from graph_core import compare_strategies


class TestCompareStrategies(unittest.TestCase):
    def test_individual_vs_patrol_totals(self):
        pois = [
            {"id": "s1", "name": "Hospital A", "type": "hospital", "node": 1},
            {"id": "c1", "name": "Colegio B", "type": "school", "node": 2},
            {"id": "c2", "name": "Templo C", "type": "place_of_worship", "node": 3},
        ]
        cost_matrix = {
            ("s1", "c1"): 5.0, ("c1", "s1"): 5.0,
            ("s1", "c2"): 8.0, ("c2", "s1"): 8.0,
            ("c1", "c2"): 3.0, ("c2", "c1"): 3.0,
        }
        mst_edges = [("s1", "c1", 5.0), ("c1", "c2", 3.0)]

        result = compare_strategies(pois, cost_matrix, mst_edges)

        self.assertAlmostEqual(result["individual"]["total"], 2 * 5.0 + 2 * 8.0)
        self.assertAlmostEqual(result["patrol"]["total"], 2 * (5.0 + 3.0))
        self.assertEqual(len(result["individual"]["assignments"]), 2)
        c1_assignment = next(a for a in result["individual"]["assignments"] if a["poi"] == "Colegio B")
        self.assertEqual(c1_assignment["station"], "Hospital A")
        self.assertAlmostEqual(c1_assignment["cost"], 5.0)
        self.assertAlmostEqual(c1_assignment["roundtrip"], 10.0)
        self.assertGreater(result["savingsPct"], 0)

    def test_no_critical_points_gives_zero_savings(self):
        pois = [{"id": "s1", "name": "Hospital A", "type": "hospital", "node": 1}]
        result = compare_strategies(pois, {}, [])
        self.assertEqual(result["individual"]["total"], 0.0)
        self.assertEqual(result["individual"]["assignments"], [])
        self.assertEqual(result["savingsPct"], 0.0)

    def test_critical_points_without_stations_gives_zero_savings(self):
        """Test that critical POIs with no stations (no hospital/police) don't crash."""
        pois = [
            {"id": "c1", "name": "School A", "type": "school", "node": 1},
            {"id": "c2", "name": "Community Hall B", "type": "community_centre", "node": 2},
            {"id": "c3", "name": "Church C", "type": "place_of_worship", "node": 3},
        ]
        result = compare_strategies(pois, {}, [])
        self.assertEqual(result["individual"]["total"], 0.0)
        self.assertEqual(result["individual"]["assignments"], [])
        self.assertEqual(result["savingsPct"], 0.0)


if __name__ == "__main__":
    unittest.main()

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


if __name__ == "__main__":
    unittest.main()

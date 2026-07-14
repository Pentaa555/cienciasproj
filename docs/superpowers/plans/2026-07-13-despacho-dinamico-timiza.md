# Despacho dinámico de vehículos — Timiza — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single self-contained `cad_timiza.html` app where a fixed set of vehicles sits on the MST-derived patrol route of Timiza; clicking any street corner triggers a two-stage A* dispatch (nearest vehicle → emergency, then emergency → nearest hospital), animated live.

**Architecture:** Offline Python pipeline (`scripts/graph_core.py` + `scripts/preprocess.py`) parses `map(1).osm`, builds the drivable street graph, extracts POIs, runs Prim to get the patrol route, and writes `build/data.json`. `scripts/bundle.py` inlines that JSON plus two vanilla-JS files (`app/algorithms.js` for A*, `app/app.js` for rendering/dispatch/animation) into `app/template.html`, producing the final single-file `cad_timiza.html` at the project root — no server, no build step to open it.

**Tech Stack:** Python 3 stdlib only (no pip installs) for the offline pipeline. Vanilla JS (no framework, no bundler) for the app itself. Node's built-in test runner (`node --test`) for JS unit tests. `puppeteer-core` (dev-only, driving the system `chromium` binary) for one end-to-end browser test — never shipped inside `cad_timiza.html`.

## Global Constraints

- Python: standard library only (`xml.etree.ElementTree`, `heapq`, `json`, `math`, `os`, `unittest`) — no `pip install`.
- JS shipped inside `cad_timiza.html`: vanilla only, no runtime dependencies.
- Final deliverable is exactly one file, `cad_timiza.html` at `/home/pentaa/Documentos/cienciasproj/cad_timiza.html`, openable via `file://` with no server.
- Emergency destination type is fixed to "hospital" only for this iteration (per user decision — no CAI/other types).
- Vehicles: 6 fixed random positions on the patrol route at load time; no continuous movement (per user decision).
- `MAX_SPEED_KMH = 50` must be identical on the Python side (`graph_core.SPEED_KMH["primary"]`) and the JS side (`app.js`), since it's the denominator of the A* heuristic — a mismatch would make the heuristic inadmissible.
- Highway types considered drivable: `residential, service, tertiary, primary, secondary, primary_link, secondary_link, tertiary_link, unclassified, living_street`. Everything else (`footway, cycleway, steps, pedestrian, corridor, construction`, …) is excluded from the graph.
- POI types considered: `amenity=hospital`, `amenity=police`, `amenity=school` (real counts confirmed in `map(1).osm`: 3 hospitals, 1 police, 11 schools).

---

### Task 1: `graph_core.py` — haversine distance + OSM parsing

**Files:**
- Create: `scripts/graph_core.py`
- Test: `scripts/test_graph_core.py`

**Interfaces:**
- Produces: `haversine_m(lat1, lon1, lat2, lon2) -> float` (meters), `parse_osm(path: str) -> tuple[dict[int, tuple[float,float]], list[dict]]` where the dict is `{node_id: (lat, lon)}` and each way dict is `{"id": int, "tags": dict[str,str], "nodes": list[int]}`.

- [ ] **Step 1: Write the failing tests**

```python
# scripts/test_graph_core.py
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: FAIL / ModuleNotFoundError (no `graph_core.py` yet).

- [ ] **Step 3: Implement**

```python
# scripts/graph_core.py
import math
import xml.etree.ElementTree as ET

EARTH_RADIUS_M = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def parse_osm(path):
    tree = ET.parse(path)
    root = tree.getroot()
    nodes = {}
    ways = []
    for el in root:
        if el.tag == "node":
            nodes[int(el.get("id"))] = (float(el.get("lat")), float(el.get("lon")))
        elif el.tag == "way":
            way_id = int(el.get("id"))
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            way_nodes = [int(nd.get("ref")) for nd in el.findall("nd")]
            ways.append({"id": way_id, "tags": tags, "nodes": way_nodes})
    return nodes, ways
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit** (skip if this project isn't using git — see note below)

This project directory is not a git repository. Do not run `git commit`. If the user later initializes git, these changes should be the first commit.

---

### Task 2: `graph_core.py` — drivable graph construction

**Files:**
- Modify: `scripts/graph_core.py`
- Modify: `scripts/test_graph_core.py`

**Interfaces:**
- Consumes: nothing new from Task 1 besides `haversine_m`.
- Produces: `DRIVABLE_HIGHWAYS: set[str]`, `SPEED_KMH: dict[str, float]`, `DEFAULT_SPEED_KMH: float`, `build_graph(nodes: dict, ways: list[dict]) -> list[dict]` (each edge dict: `{"from": int, "to": int, "w": float, "directed": bool}`, `w` in minutes), `adjacency(edges: list[dict]) -> dict[int, list[tuple[int, float]]]`.

- [ ] **Step 1: Write the failing tests** (append to `scripts/test_graph_core.py`)

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: FAIL (`ImportError: cannot import name 'build_graph'`)

- [ ] **Step 3: Implement** (append to `scripts/graph_core.py`)

```python
DRIVABLE_HIGHWAYS = {
    "residential", "service", "tertiary", "primary", "secondary",
    "primary_link", "secondary_link", "tertiary_link", "unclassified",
    "living_street",
}

SPEED_KMH = {
    "primary": 50.0, "secondary": 40.0, "tertiary": 35.0,
    "primary_link": 30.0, "secondary_link": 30.0, "tertiary_link": 30.0,
    "residential": 25.0, "living_street": 20.0, "service": 15.0,
    "unclassified": 30.0,
}
DEFAULT_SPEED_KMH = 20.0


def build_graph(nodes, ways):
    edges = []
    for way in ways:
        highway = way["tags"].get("highway")
        if highway not in DRIVABLE_HIGHWAYS:
            continue
        speed = SPEED_KMH.get(highway, DEFAULT_SPEED_KMH)
        directed = way["tags"].get("oneway") == "yes"
        way_nodes = way["nodes"]
        for a, b in zip(way_nodes, way_nodes[1:]):
            if a not in nodes or b not in nodes:
                continue
            lat1, lon1 = nodes[a]
            lat2, lon2 = nodes[b]
            dist_m = haversine_m(lat1, lon1, lat2, lon2)
            weight_min = dist_m / (speed * 1000.0 / 60.0)
            edges.append({"from": a, "to": b, "w": weight_min, "directed": directed})
    return edges


def adjacency(edges):
    adj = {}
    for e in edges:
        adj.setdefault(e["from"], []).append((e["to"], e["w"]))
        if not e["directed"]:
            adj.setdefault(e["to"], []).append((e["from"], e["w"]))
    return adj
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit** — skipped, no git repo (see Task 1 note).

---

### Task 3: `graph_core.py` — Dijkstra + shortest path reconstruction

**Files:**
- Modify: `scripts/graph_core.py`
- Modify: `scripts/test_graph_core.py`

**Interfaces:**
- Consumes: adjacency dict shape produced by `adjacency()` in Task 2.
- Produces: `dijkstra(adj: dict, source: int) -> tuple[dict[int,float], dict[int,int]]` (dist, prev), `shortest_path(adj: dict, source: int, target: int) -> tuple[list[int] | None, float]`.

- [ ] **Step 1: Write the failing tests** (append to `scripts/test_graph_core.py`)

```python
import math
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: FAIL (`ImportError: cannot import name 'dijkstra'`)

- [ ] **Step 3: Implement** (append to `scripts/graph_core.py`, add `import heapq` at top)

```python
import heapq  # add to the top imports alongside math, xml.etree.ElementTree


def dijkstra(adj, source):
    dist = {source: 0.0}
    prev = {}
    visited = set()
    heap = [(0.0, source)]
    while heap:
        d, u = heapq.heappop(heap)
        if u in visited:
            continue
        visited.add(u)
        for v, w in adj.get(u, []):
            nd = d + w
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(heap, (nd, v))
    return dist, prev


def shortest_path(adj, source, target):
    dist, prev = dijkstra(adj, source)
    if target not in dist:
        return None, math.inf
    path = [target]
    while path[-1] != source:
        path.append(prev[path[-1]])
    path.reverse()
    return path, dist[target]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit** — skipped, no git repo.

---

### Task 4: `graph_core.py` — POI extraction (hospitals, police, schools)

**Files:**
- Modify: `scripts/graph_core.py`
- Modify: `scripts/test_graph_core.py`

**Interfaces:**
- Consumes: `nodes` / `ways` shapes from Task 1, `haversine_m` from Task 1.
- Produces: `POI_AMENITIES: dict[str,str]`, `extract_pois(nodes: dict, ways: list[dict], graph_node_ids: set[int]) -> list[dict]` (each: `{"id": str, "name": str, "type": str, "node": int}`).

- [ ] **Step 1: Write the failing test** (append to `scripts/test_graph_core.py`)

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: FAIL (`ImportError: cannot import name 'extract_pois'`)

- [ ] **Step 3: Implement** (append to `scripts/graph_core.py`)

```python
POI_AMENITIES = {"hospital": "hospital", "police": "police", "school": "school"}


def _way_centroid(way, nodes):
    coords = [nodes[n] for n in way["nodes"] if n in nodes]
    if not coords:
        return None
    lat = sum(c[0] for c in coords) / len(coords)
    lon = sum(c[1] for c in coords) / len(coords)
    return lat, lon


def extract_pois(nodes, ways, graph_node_ids):
    candidates = list(graph_node_ids)
    pois = []
    for way in ways:
        amenity = way["tags"].get("amenity")
        if amenity not in POI_AMENITIES:
            continue
        centroid = _way_centroid(way, nodes)
        if centroid is None:
            continue
        lat, lon = centroid
        nearest = min(
            candidates,
            key=lambda nid: haversine_m(lat, lon, nodes[nid][0], nodes[nid][1]),
        )
        pois.append({
            "id": f"poi_{way['id']}",
            "name": way["tags"].get("name", "?"),
            "type": POI_AMENITIES[amenity],
            "node": nearest,
        })
    return pois
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit** — skipped, no git repo.

---

### Task 5: `graph_core.py` — Prim MST over POIs

**Files:**
- Modify: `scripts/graph_core.py`
- Modify: `scripts/test_graph_core.py`

**Interfaces:**
- Produces: `prim_mst(poi_ids: list[str], cost_matrix: dict[tuple[str,str], float]) -> list[tuple[str,str,float]]`. `cost_matrix` must contain both `(a,b)` and `(b,a)` for every pair used.

- [ ] **Step 1: Write the failing test** (append to `scripts/test_graph_core.py`)

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: FAIL (`ImportError: cannot import name 'prim_mst'`)

- [ ] **Step 3: Implement** (append to `scripts/graph_core.py`)

```python
def prim_mst(poi_ids, cost_matrix):
    if not poi_ids:
        return []
    visited = {poi_ids[0]}
    remaining = set(poi_ids[1:])
    mst = []
    while remaining:
        best = None
        for a in visited:
            for b in remaining:
                c = cost_matrix[(a, b)]
                if best is None or c < best[2]:
                    best = (a, b, c)
        mst.append(best)
        visited.add(best[1])
        remaining.remove(best[1])
    return mst
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit** — skipped, no git repo.

---

### Task 6: `graph_core.py` — patrol route (union of MST edge paths)

**Files:**
- Modify: `scripts/graph_core.py`
- Modify: `scripts/test_graph_core.py`

**Interfaces:**
- Consumes: `shortest_path` (Task 3), MST edge shape from Task 5 (`(poi_a, poi_b, weight)`).
- Produces: `patrol_edges(mst_edges: list[tuple[str,str,float]], poi_node: dict[str,int], adj: dict) -> set[tuple[int,int]]` (each tuple is a canonical `(min(a,b), max(a,b))` node pair).

- [ ] **Step 1: Write the failing test** (append to `scripts/test_graph_core.py`)

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: FAIL (`ImportError: cannot import name 'patrol_edges'`)

- [ ] **Step 3: Implement** (append to `scripts/graph_core.py`)

```python
def patrol_edges(mst_edges, poi_node, adj):
    result = set()
    for poi_a, poi_b, _ in mst_edges:
        path, _ = shortest_path(adj, poi_node[poi_a], poi_node[poi_b])
        if path is None:
            continue
        for a, b in zip(path, path[1:]):
            result.add((a, b) if a < b else (b, a))
    return result
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core -v`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit** — skipped, no git repo.

---

### Task 7: `preprocess.py` — run the real pipeline on `map(1).osm`

**Files:**
- Create: `scripts/preprocess.py`
- Create: `scripts/test_preprocess.py`
- Produces at runtime: `build/data.json`

**Interfaces:**
- Consumes: every function from Tasks 1–6 (`parse_osm, build_graph, adjacency, extract_pois, shortest_path, prim_mst, patrol_edges`).
- Produces: `build/data.json` with schema `{"nodes": [{"id","lat","lon"}], "edges": [{"from","to","w","directed"}], "pois": [{"id","name","type","node"}], "patrolEdges": [[a,b], ...]}`.

- [ ] **Step 1: Implement the orchestration script**

```python
# scripts/preprocess.py
import json
import os
from graph_core import (
    parse_osm, build_graph, adjacency, extract_pois,
    shortest_path, prim_mst, patrol_edges,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM_PATH = os.path.join(BASE_DIR, "map(1).osm")
OUT_PATH = os.path.join(BASE_DIR, "build", "data.json")


def main():
    nodes, ways = parse_osm(OSM_PATH)
    edges = build_graph(nodes, ways)
    graph_node_ids = {e["from"] for e in edges} | {e["to"] for e in edges}
    adj = adjacency(edges)

    pois = extract_pois(nodes, ways, graph_node_ids)
    poi_node = {p["id"]: p["node"] for p in pois}
    poi_ids = list(poi_node.keys())

    cost_matrix = {}
    for i, a in enumerate(poi_ids):
        for b in poi_ids[i + 1:]:
            _, cost = shortest_path(adj, poi_node[a], poi_node[b])
            cost_matrix[(a, b)] = cost
            cost_matrix[(b, a)] = cost

    mst = prim_mst(poi_ids, cost_matrix)
    patrol = patrol_edges(mst, poi_node, adj)

    out_nodes = [{"id": nid, "lat": nodes[nid][0], "lon": nodes[nid][1]} for nid in graph_node_ids]
    out_edges = [{"from": e["from"], "to": e["to"], "w": e["w"], "directed": e["directed"]} for e in edges]
    out_patrol = [[a, b] for a, b in sorted(patrol)]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump({"nodes": out_nodes, "edges": out_edges, "pois": pois, "patrolEdges": out_patrol}, f)

    by_type = {}
    for p in pois:
        by_type[p["type"]] = by_type.get(p["type"], 0) + 1
    print(f"nodes={len(out_nodes)} edges={len(out_edges)} pois={len(pois)} {by_type}")
    print(f"MST edges={len(mst)} total_cost={sum(e[2] for e in mst):.2f} patrol_edges={len(out_patrol)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it against the real data**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 preprocess.py`
Expected: prints a line like `nodes=1800 edges=2600 pois=15 {'hospital': 3, 'police': 1, 'school': 11}` (exact node/edge counts will vary) and `build/data.json` exists. If `pois` doesn't show `hospital: 3, police: 1`, stop and re-check `POI_AMENITIES`/tag matching before continuing — the real file is known to contain exactly those counts.

- [ ] **Step 3: Write the failing tests against the real output**

```python
# scripts/test_preprocess.py
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
        self.assertEqual(by_type.get("hospital"), 3)
        self.assertEqual(by_type.get("police"), 1)
        self.assertGreaterEqual(by_type.get("school", 0), 8)

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


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_preprocess -v`
Expected: PASS (3 tests). This is the real end-to-end validation of the whole Python pipeline against the actual `map(1).osm`.

- [ ] **Step 5: Commit** — skipped, no git repo.

---

### Task 8: `app/algorithms.js` — A* in the browser

**Files:**
- Create: `app/algorithms.js`
- Create: `app/algorithms.test.js`

**Interfaces:**
- Produces: `haversineM(lat1, lon1, lat2, lon2) -> number`, `buildAdjacency(edges: Array<{from,to,w,directed}>) -> Map<number, Array<[number, number]>>`, `astar(adj: Map, nodesById: Map<number,{lat,lon}>, start: number, goal: number, maxSpeedKmh: number) -> {path: number[] | null, cost: number, explored: number[]}`.
- Both `haversineM` and `SPEED_KMH.primary` (Python, Task 2) must stay at `50` km/h — `astar`'s heuristic divides by `maxSpeedKmh` and must never overestimate the true remaining cost.

- [ ] **Step 1: Write the failing tests**

```js
// app/algorithms.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { haversineM, buildAdjacency, astar } = require("./algorithms.js");

test("haversineM known distance", () => {
  const d = haversineM(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111195) < 200);
});

test("astar matches dijkstra on zero-heuristic graph", () => {
  const edges = [
    { from: 1, to: 2, w: 1.0, directed: false },
    { from: 2, to: 3, w: 2.0, directed: false },
    { from: 1, to: 3, w: 4.0, directed: false },
    { from: 3, to: 4, w: 1.0, directed: false },
    { from: 2, to: 4, w: 7.0, directed: false },
  ];
  const adj = buildAdjacency(edges);
  const nodesById = new Map([
    [1, { lat: 0, lon: 0 }], [2, { lat: 0, lon: 0 }],
    [3, { lat: 0, lon: 0 }], [4, { lat: 0, lon: 0 }],
  ]);
  const result = astar(adj, nodesById, 1, 4, 1000000);
  assert.equal(result.cost, 4);
  assert.deepEqual(result.path, [1, 2, 3, 4]);
});

test("astar finds optimum against brute-force on a small real-coordinate graph", () => {
  const nodesById = new Map([
    [1, { lat: 4.610, lon: -74.150 }],
    [2, { lat: 4.611, lon: -74.150 }],
    [3, { lat: 4.612, lon: -74.149 }],
    [4, { lat: 4.613, lon: -74.148 }],
  ]);
  const edges = [
    { from: 1, to: 2, w: 2.0, directed: false },
    { from: 2, to: 3, w: 2.0, directed: false },
    { from: 3, to: 4, w: 2.0, directed: false },
    { from: 1, to: 4, w: 5.0, directed: false },
  ];
  const adj = buildAdjacency(edges);
  const result = astar(adj, nodesById, 1, 4, 40);
  assert.equal(result.cost, 5.0);
  assert.deepEqual(result.path, [1, 4]);
});

test("astar returns unreachable goal as Infinity", () => {
  const edges = [{ from: 1, to: 2, w: 1.0, directed: false }];
  const adj = buildAdjacency(edges);
  const nodesById = new Map([[1, { lat: 0, lon: 0 }], [2, { lat: 0, lon: 0 }], [3, { lat: 0, lon: 0 }]]);
  const result = astar(adj, nodesById, 1, 3, 1000);
  assert.equal(result.cost, Infinity);
  assert.equal(result.path, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test algorithms.test.js`
Expected: FAIL (`Cannot find module './algorithms.js'`)

- [ ] **Step 3: Implement**

```js
// app/algorithms.js
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000.0;
  const toRad = (d) => (d * Math.PI) / 180;
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lon2 - lon1);
  const phi1 = toRad(lat1), phi2 = toRad(lat2);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function buildAdjacency(edges) {
  const adj = new Map();
  const push = (u, v, w) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u).push([v, w]);
  };
  for (const e of edges) {
    push(e.from, e.to, e.w);
    if (!e.directed) push(e.to, e.from, e.w);
  }
  return adj;
}

function astar(adj, nodesById, start, goal, maxSpeedKmh) {
  const maxSpeedMPerMin = (maxSpeedKmh * 1000) / 60;
  const heuristic = (n) => {
    const a = nodesById.get(n), b = nodesById.get(goal);
    return haversineM(a.lat, a.lon, b.lat, b.lon) / maxSpeedMPerMin;
  };
  const gScore = new Map([[start, 0]]);
  const cameFrom = new Map();
  const open = new Map([[start, heuristic(start)]]);
  const closed = new Set();
  const explored = [];

  while (open.size > 0) {
    let current = null, currentF = Infinity;
    for (const [n, f] of open) {
      if (f < currentF) { current = n; currentF = f; }
    }
    open.delete(current);
    if (closed.has(current)) continue;
    closed.add(current);
    explored.push(current);

    if (current === goal) {
      const path = [current];
      while (cameFrom.has(path[path.length - 1])) {
        path.push(cameFrom.get(path[path.length - 1]));
      }
      path.reverse();
      return { path, cost: gScore.get(goal), explored };
    }

    for (const [neighbor, w] of adj.get(current) || []) {
      if (closed.has(neighbor)) continue;
      const tentative = gScore.get(current) + w;
      if (tentative < (gScore.has(neighbor) ? gScore.get(neighbor) : Infinity)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentative);
        open.set(neighbor, tentative + heuristic(neighbor));
      }
    }
  }
  return { path: null, cost: Infinity, explored };
}

if (typeof module !== "undefined") {
  module.exports = { haversineM, buildAdjacency, astar };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test algorithms.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit** — skipped, no git repo.

---

### Task 9: `app/app.js` — seeded RNG, projection, vehicle placement

**Files:**
- Create: `app/app.js`
- Create: `app/app.test.js`

**Interfaces:**
- Produces: `mulberry32(seed: number) -> () => number`, `projectLatLon(lat, lon, bounds: {minLat,maxLat,minLon,maxLon}, width, height) -> {x,y}`, `VEHICLE_TYPES: string[]`, `placeVehicles(patrolEdgeList: Array<{from,to,w}>, nodesById: Map<number,{lat,lon}>, rng: () => number, count: number) -> Array<{id,type,edge:[number,number],t,lat,lon,nearestNode}>`.

- [ ] **Step 1: Write the failing tests**

```js
// app/app.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { mulberry32, projectLatLon, placeVehicles } = require("./app.js");

test("mulberry32 is deterministic for a given seed", () => {
  const a = mulberry32(42), b = mulberry32(42);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test("projectLatLon maps bounds corners to canvas corners", () => {
  const bounds = { minLat: 4.60, maxLat: 4.62, minLon: -74.16, maxLon: -74.14 };
  const topLeft = projectLatLon(4.62, -74.16, bounds, 800, 600);
  assert.ok(Math.abs(topLeft.x) < 1e-6 && Math.abs(topLeft.y) < 1e-6);
  const bottomRight = projectLatLon(4.60, -74.14, bounds, 800, 600);
  assert.ok(Math.abs(bottomRight.x - 800) < 1e-6 && Math.abs(bottomRight.y - 600) < 1e-6);
});

test("placeVehicles returns count vehicles on patrol edges with valid t", () => {
  const patrolEdgeList = [
    { from: 1, to: 2, w: 3.0 },
    { from: 2, to: 3, w: 1.0 },
  ];
  const nodesById = new Map([
    [1, { lat: 4.61, lon: -74.15 }],
    [2, { lat: 4.611, lon: -74.151 }],
    [3, { lat: 4.612, lon: -74.152 }],
  ]);
  for (let seed = 0; seed < 20; seed++) {
    const rng = mulberry32(seed);
    const vehicles = placeVehicles(patrolEdgeList, nodesById, rng, 6);
    assert.equal(vehicles.length, 6);
    for (const v of vehicles) {
      assert.ok(v.t >= 0 && v.t < 1);
      const onEdge = patrolEdgeList.some((e) => e.from === v.edge[0] && e.to === v.edge[1]);
      assert.ok(onEdge);
      assert.ok(v.nearestNode === v.edge[0] || v.nearestNode === v.edge[1]);
    }
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test app.test.js`
Expected: FAIL (`Cannot find module './app.js'`)

- [ ] **Step 3: Implement**

```js
// app/app.js
function mulberry32(seed) {
  let s = seed;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function projectLatLon(lat, lon, bounds, width, height) {
  const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * width;
  const y = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * height;
  return { x, y };
}

const VEHICLE_TYPES = ["ambulancia", "patrulla"];

function placeVehicles(patrolEdgeList, nodesById, rng, count) {
  const total = patrolEdgeList.reduce((s, e) => s + e.w, 0);
  const vehicles = [];
  for (let i = 0; i < count; i++) {
    let r = rng() * total;
    let edge = patrolEdgeList[patrolEdgeList.length - 1];
    for (const e of patrolEdgeList) {
      if (r < e.w) { edge = e; break; }
      r -= e.w;
    }
    const t = rng();
    const a = nodesById.get(edge.from), b = nodesById.get(edge.to);
    const lat = a.lat + (b.lat - a.lat) * t;
    const lon = a.lon + (b.lon - a.lon) * t;
    vehicles.push({
      id: i,
      type: VEHICLE_TYPES[i % VEHICLE_TYPES.length],
      edge: [edge.from, edge.to],
      t, lat, lon,
      nearestNode: t < 0.5 ? edge.from : edge.to,
    });
  }
  return vehicles;
}

if (typeof module !== "undefined") {
  module.exports = { mulberry32, projectLatLon, placeVehicles, VEHICLE_TYPES };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test app.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit** — skipped, no git repo.

---

### Task 10: `app/app.js` — winner selection + nearest facility

**Files:**
- Modify: `app/app.js`
- Modify: `app/app.test.js`

**Interfaces:**
- Consumes: `astar` from `app/algorithms.js` (Task 8) as a **bare global** — see note below.
- Produces: `selectWinner(costs: Array<{vehicleId,cost}>) -> {vehicleId,cost}`, `nearestFacility(adj, nodesById, fromNode, facilities: Array<{id,node}>, maxSpeedKmh) -> {facilityId, node, path, cost, explored}`.

**Note on the global `astar`:** in the final bundled `cad_timiza.html`, `algorithms.js` and `app.js` are concatenated into the *same* `<script>` tag (Task 11), so `astar` is a plain script-scope function visible to `app.js`'s code without any `require`/`import`. `app.js` must therefore reference `astar` as a bare identifier, never `require("./algorithms.js")`. For the Node test file, set `global.astar = require("./algorithms.js").astar;` before calling any function that uses it.

- [ ] **Step 1: Write the failing tests** (append to `app/app.test.js`)

```js
const { selectWinner, nearestFacility } = require("./app.js");
const { buildAdjacency } = require("./algorithms.js");

test("selectWinner picks minimum cost, ties broken by lowest vehicleId", () => {
  const costs = [
    { vehicleId: 2, cost: 5.0 },
    { vehicleId: 0, cost: 5.0 },
    { vehicleId: 1, cost: 7.0 },
  ];
  const winner = selectWinner(costs);
  assert.equal(winner.vehicleId, 0);
});

test("nearestFacility picks the closest of several candidates", () => {
  global.astar = require("./algorithms.js").astar;
  const edges = [
    { from: 1, to: 2, w: 2.0, directed: false },
    { from: 1, to: 3, w: 9.0, directed: false },
  ];
  const adj = buildAdjacency(edges);
  const nodesById = new Map([
    [1, { lat: 0, lon: 0 }], [2, { lat: 0, lon: 0 }], [3, { lat: 0, lon: 0 }],
  ]);
  const facilities = [{ id: "near", node: 2 }, { id: "far", node: 3 }];
  const best = nearestFacility(adj, nodesById, 1, facilities, 1000000);
  assert.equal(best.facilityId, "near");
  assert.equal(best.cost, 2.0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test app.test.js`
Expected: FAIL (`selectWinner is not a function`)

- [ ] **Step 3: Implement** (append to `app/app.js`, then replace the `module.exports` block)

```js
function selectWinner(costs) {
  return costs.reduce((best, c) => {
    if (best === null) return c;
    if (c.cost < best.cost) return c;
    if (c.cost === best.cost && c.vehicleId < best.vehicleId) return c;
    return best;
  }, null);
}

function nearestFacility(adj, nodesById, fromNode, facilities, maxSpeedKmh) {
  let best = null;
  for (const f of facilities) {
    const r = astar(adj, nodesById, fromNode, f.node, maxSpeedKmh);
    if (best === null || r.cost < best.cost) {
      best = { facilityId: f.id, node: f.node, path: r.path, cost: r.cost, explored: r.explored };
    }
  }
  return best;
}
```

Replace the existing `module.exports` block at the bottom of `app/app.js` with:

```js
if (typeof module !== "undefined") {
  module.exports = {
    mulberry32, projectLatLon, placeVehicles, VEHICLE_TYPES,
    selectWinner, nearestFacility,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test app.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit** — skipped, no git repo.

---

### Task 11: `scripts/bundle.py` — single-file assembly plumbing

**Files:**
- Create: `scripts/bundle.py`
- Create: `app/template.html` (minimal placeholder version — Task 12 replaces it with the full styled version)
- Create: `scripts/test_bundle.py`

**Interfaces:**
- Consumes: `build/data.json` (Task 7), `app/algorithms.js` (Task 8), `app/app.js` (Task 9/10), `app/template.html`.
- Produces: `/home/pentaa/Documentos/cienciasproj/cad_timiza.html`.

- [ ] **Step 1: Create the minimal template**

```html
<!-- app/template.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>Timiza</title></head>
<body>
<script>
/*__GRAPH_DATA__*/
</script>
<script>
//__ALGORITHMS_JS__
</script>
<script>
//__APP_JS__
</script>
</body></html>
```

- [ ] **Step 2: Write the failing test**

```python
# scripts/test_bundle.py
import os
import subprocess
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(BASE_DIR, "cad_timiza.html")


class TestBundle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(["python3", os.path.join(BASE_DIR, "scripts", "bundle.py")], check=True, cwd=BASE_DIR)

    def test_output_exists_and_has_no_placeholders(self):
        with open(OUT_PATH) as f:
            html = f.read()
        self.assertNotIn("__GRAPH_DATA__", html)
        self.assertNotIn("__ALGORITHMS_JS__", html)
        self.assertNotIn("__APP_JS__", html)
        self.assertIn("GRAPH_DATA", html)
        self.assertIn("function astar", html)
        self.assertEqual(html.count("<script"), html.count("</script>"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_bundle -v`
Expected: FAIL (`FileNotFoundError` — `bundle.py` doesn't exist yet)

- [ ] **Step 4: Implement**

```python
# scripts/bundle.py
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(BASE_DIR, "app")
DATA_PATH = os.path.join(BASE_DIR, "build", "data.json")
OUT_PATH = os.path.join(BASE_DIR, "cad_timiza.html")


def main():
    with open(os.path.join(APP_DIR, "template.html")) as f:
        html = f.read()
    with open(DATA_PATH) as f:
        data_json = f.read()
    with open(os.path.join(APP_DIR, "algorithms.js")) as f:
        algorithms_js = f.read()
    with open(os.path.join(APP_DIR, "app.js")) as f:
        app_js = f.read()

    html = html.replace("/*__GRAPH_DATA__*/", f"const GRAPH_DATA = {data_json};")
    html = html.replace("//__ALGORITHMS_JS__", algorithms_js)
    html = html.replace("//__APP_JS__", app_js)

    with open(OUT_PATH, "w") as f:
        f.write(html)
    print(f"wrote {OUT_PATH} ({len(html)} bytes)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_bundle -v`
Expected: PASS (1 test). `cad_timiza.html` now exists at the project root, though it renders a blank page (no CSS/canvas/panel yet — that's Task 12).

- [ ] **Step 6: Commit** — skipped, no git repo.

---

### Task 12: `app/template.html` (full) + rendering — map, patrol route, POIs, vehicles

**Files:**
- Modify: `app/template.html` (replace entirely)
- Modify: `app/app.js` (append rendering code, add a temporary `dispatchEmergency` stub, replace `module.exports`)
- Modify: `app/app.test.js` (add `computeBounds` test)

**Interfaces:**
- Produces: `computeBounds(nodes: Array<{lat,lon}>) -> {minLat,maxLat,minLon,maxLon}`, `drawBaseMap(ctx, state)`, `initApp()` (reads `GRAPH_DATA` global, wires canvas + slider + click listener), and a temporary `dispatchEmergency(ctx, state, emergencyNode)` stub that Task 13 replaces with the real two-stage dispatch.

- [ ] **Step 1: Replace `app/template.html`**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Consola de despacho — Timiza</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: Arial, sans-serif; background: #0b0f0e; color: #e8f0ee;
    display: flex; height: 100vh;
  }
  #mapCanvas { background: #101614; flex: 1; display: block; cursor: crosshair; }
  #panel {
    width: 320px; padding: 16px; background: #131a18; border-left: 1px solid #1f5652;
    overflow-y: auto;
  }
  #panel h2 { font-size: 15px; color: #4fd1c5; margin: 0 0 8px; }
  #vehicleList div, #summary div { font-size: 12px; margin-bottom: 4px; }
  .winner { color: #4fd1c5; font-weight: bold; }
  #speedRow { margin-top: 16px; font-size: 12px; }
  #speedSlider { width: 100%; }
</style>
</head>
<body>
  <canvas id="mapCanvas" width="900" height="700"></canvas>
  <div id="panel">
    <h2>Despacho</h2>
    <div id="summary">Haz clic en una esquina para simular una emergencia.</div>
    <h2>Vehículos</h2>
    <div id="vehicleList"></div>
    <div id="speedRow">
      Velocidad de animación
      <input id="speedSlider" type="range" min="1" max="100" value="50">
    </div>
  </div>
  <script>
/*__GRAPH_DATA__*/
  </script>
  <script>
//__ALGORITHMS_JS__
  </script>
  <script>
//__APP_JS__
  </script>
</body>
</html>
```

- [ ] **Step 2: Write the failing test** (append to `app/app.test.js`)

```js
const { computeBounds } = require("./app.js");

test("computeBounds finds min/max lat/lon", () => {
  const nodes = [
    { id: 1, lat: 4.61, lon: -74.15 },
    { id: 2, lat: 4.62, lon: -74.14 },
    { id: 3, lat: 4.605, lon: -74.155 },
  ];
  const b = computeBounds(nodes);
  assert.equal(b.minLat, 4.605);
  assert.equal(b.maxLat, 4.62);
  assert.equal(b.minLon, -74.155);
  assert.equal(b.maxLon, -74.14);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test app.test.js`
Expected: FAIL (`computeBounds is not a function`)

- [ ] **Step 4: Implement** (append to `app/app.js`)

```js
function computeBounds(nodes) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const n of nodes) {
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function drawBaseMap(ctx, state) {
  const { data, bounds, width, height } = state;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#274744";
  ctx.lineWidth = 1;
  for (const e of data.edges) {
    const a = state.nodesById.get(e.from), b = state.nodesById.get(e.to);
    const pa = projectLatLon(a.lat, a.lon, bounds, width, height);
    const pb = projectLatLon(b.lat, b.lon, bounds, width, height);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#4fd1c5";
  ctx.lineWidth = 3;
  for (const [a, b] of data.patrolEdges) {
    const na = state.nodesById.get(a), nb = state.nodesById.get(b);
    const pa = projectLatLon(na.lat, na.lon, bounds, width, height);
    const pb = projectLatLon(nb.lat, nb.lon, bounds, width, height);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  const poiColors = { hospital: "#ff5c5c", police: "#5c8cff", school: "#ffd75c" };
  for (const p of data.pois) {
    const n = state.nodesById.get(p.node);
    const pt = projectLatLon(n.lat, n.lon, bounds, width, height);
    ctx.fillStyle = poiColors[p.type] || "#ffffff";
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, p.type === "school" ? 3 : 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = "16px sans-serif";
  for (const v of state.vehicles) {
    const pt = projectLatLon(v.lat, v.lon, bounds, width, height);
    ctx.fillText(v.type === "ambulancia" ? "🚑" : "🚓", pt.x - 8, pt.y + 6);
  }
}

function dispatchEmergency(ctx, state, emergencyNode) {
  // Placeholder — Task 13 replaces this with the real two-stage A* dispatch.
  console.log("emergency at", emergencyNode);
}

const MAX_SPEED_KMH = 50;

function initApp() {
  const data = GRAPH_DATA;
  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  const bounds = computeBounds(data.nodes);
  const adj = buildAdjacency(data.edges);
  const patrolEdgeList = data.patrolEdges.map(([a, b]) => {
    const match = data.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    return { from: a, to: b, w: match ? match.w : 1 };
  });
  const rng = mulberry32(20260713);
  const vehicles = placeVehicles(patrolEdgeList, nodesById, rng, 6);
  const hospitals = data.pois.filter((p) => p.type === "hospital");
  const state = { data, bounds, width: canvas.width, height: canvas.height, nodesById, vehicles, adj, hospitals, speed: 50 };
  drawBaseMap(ctx, state);

  document.getElementById("speedSlider").addEventListener("input", (e) => {
    state.speed = Number(e.target.value);
  });

  canvas.addEventListener("click", (evt) => {
    const rect = canvas.getBoundingClientRect();
    const cx = evt.clientX - rect.left, cy = evt.clientY - rect.top;
    let nearest = null, nearestD = Infinity;
    for (const n of data.nodes) {
      const p = projectLatLon(n.lat, n.lon, bounds, state.width, state.height);
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < nearestD) { nearestD = d; nearest = n.id; }
    }
    dispatchEmergency(ctx, state, nearest);
  });

  return state;
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initApp);
}
```

Replace the `module.exports` block at the bottom of `app/app.js` with:

```js
if (typeof module !== "undefined") {
  module.exports = {
    mulberry32, projectLatLon, placeVehicles, VEHICLE_TYPES,
    selectWinner, nearestFacility, computeBounds,
  };
}
```

- [ ] **Step 5: Run the JS test suite**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test app.test.js algorithms.test.js`
Expected: PASS (10 tests total). The `document is not defined` guard means `require("./app.js")` still works under plain Node.

- [ ] **Step 6: Re-bundle and visually verify in a real browser**

```bash
cd /home/pentaa/Documentos/cienciasproj
python3 scripts/bundle.py
mkdir -p build
chromium --headless --disable-gpu --screenshot=build/render_check.png --window-size=1000,800 "file://$(pwd)/cad_timiza.html"
```

Expected: `build/render_check.png` is created. Open it (e.g. with the Read tool) and confirm: a network of thin gray streets, a highlighted teal patrol route, red dots (3, hospitals), one blue dot (police), several small yellow dots (schools), and 6 vehicle emoji (🚑/🚓) sitting on the teal route.

- [ ] **Step 7: Commit** — skipped, no git repo.

---

### Task 13: `app/app.js` — real two-stage dispatch, animation, panel, and end-to-end test

**Files:**
- Modify: `app/app.js` (replace the `dispatchEmergency` stub, add animation/panel helpers, replace `module.exports`)
- Modify: `app/app.test.js` (add `speedToIntervalMs` test)
- Create: `package.json` (root, for `puppeteer-core` dev dependency only)
- Create: `scripts/e2e_test.js`

**Interfaces:**
- Consumes: `astar` (bare global, Task 8), `selectWinner`, `nearestFacility` (Task 10), `drawBaseMap`, `computeBounds` (Task 12).
- Produces: `speedToIntervalMs(speed: number) -> number`, `renderVehicleList(state, costs, winnerId)`, `animatePath(ctx, state, result, color, onDone)`, real `dispatchEmergency(ctx, state, emergencyNode)`.

- [ ] **Step 1: Write the failing test** (append to `app/app.test.js`)

```js
const { speedToIntervalMs } = require("./app.js");

test("speedToIntervalMs decreases as speed increases", () => {
  assert.ok(speedToIntervalMs(1) > speedToIntervalMs(100));
  assert.ok(speedToIntervalMs(100) >= 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test app.test.js`
Expected: FAIL (`speedToIntervalMs is not a function`)

- [ ] **Step 3: Implement.** In `app/app.js`, delete the placeholder `dispatchEmergency` function from Task 12 and replace it (in the same location) with:

```js
function speedToIntervalMs(speed) {
  return Math.max(2, 220 - speed * 2);
}

function renderVehicleList(state, costs, winnerId) {
  const list = document.getElementById("vehicleList");
  list.innerHTML = "";
  const sorted = [...costs].sort((a, b) => a.cost - b.cost);
  for (const c of sorted) {
    const div = document.createElement("div");
    const v = state.vehicles.find((x) => x.id === c.vehicleId);
    div.textContent = `${v.type} #${c.vehicleId}: ${c.cost.toFixed(1)} min`;
    if (c.vehicleId === winnerId) div.className = "winner";
    list.appendChild(div);
  }
}

function animatePath(ctx, state, result, color, onDone) {
  const interval = speedToIntervalMs(state.speed);
  let i = 0;
  const timer = setInterval(() => {
    if (i >= result.explored.length) {
      clearInterval(timer);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      result.path.forEach((nodeId, idx) => {
        const n = state.nodesById.get(nodeId);
        const p = projectLatLon(n.lat, n.lon, state.bounds, state.width, state.height);
        if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      onDone();
      return;
    }
    const n = state.nodesById.get(result.explored[i]);
    const p = projectLatLon(n.lat, n.lon, state.bounds, state.width, state.height);
    ctx.fillStyle = "#b8860b";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
    i++;
  }, interval);
}

function dispatchEmergency(ctx, state, emergencyNode) {
  drawBaseMap(ctx, state);
  ctx.fillStyle = "#ff2d2d";
  const en = state.nodesById.get(emergencyNode);
  const ep = projectLatLon(en.lat, en.lon, state.bounds, state.width, state.height);
  ctx.beginPath();
  ctx.arc(ep.x, ep.y, 7, 0, Math.PI * 2);
  ctx.fill();

  const costs = state.vehicles.map((v) => {
    const r = astar(state.adj, state.nodesById, v.nearestNode, emergencyNode, MAX_SPEED_KMH);
    return { vehicleId: v.id, cost: r.cost, result: r };
  });
  const winner = selectWinner(costs);
  renderVehicleList(state, costs, winner.vehicleId);
  document.getElementById("summary").textContent = "Etapa 1: buscando vehículo más cercano...";

  animatePath(ctx, state, winner.result, "#ffffff", () => {
    document.getElementById("summary").textContent =
      `Vehículo #${winner.vehicleId} en camino a la emergencia (${winner.cost.toFixed(1)} min). Buscando hospital...`;
    const toHospital = nearestFacility(state.adj, state.nodesById, emergencyNode, state.hospitals, MAX_SPEED_KMH);
    animatePath(ctx, state, toHospital, "#4fd1c5", () => {
      const total = winner.cost + toHospital.cost;
      document.getElementById("summary").innerHTML =
        `Vehículo #${winner.vehicleId} → emergencia: ${winner.cost.toFixed(1)} min<br>` +
        `Emergencia → ${toHospital.facilityId}: ${toHospital.cost.toFixed(1)} min<br>` +
        `<b>Tiempo total: ${total.toFixed(1)} min</b>`;
    });
  });
}
```

Replace the `module.exports` block at the bottom of `app/app.js` with:

```js
if (typeof module !== "undefined") {
  module.exports = {
    mulberry32, projectLatLon, placeVehicles, VEHICLE_TYPES,
    selectWinner, nearestFacility, computeBounds, speedToIntervalMs,
  };
}
```

- [ ] **Step 4: Run to verify unit tests pass**

Run: `cd /home/pentaa/Documentos/cienciasproj/app && node --test app.test.js algorithms.test.js`
Expected: PASS (11 tests total)

- [ ] **Step 5: Re-bundle**

Run: `cd /home/pentaa/Documentos/cienciasproj && python3 scripts/bundle.py`
Expected: `wrote .../cad_timiza.html (... bytes)`

- [ ] **Step 6: Install the dev-only e2e dependency**

```bash
cd /home/pentaa/Documentos/cienciasproj
npm init -y
npm install --save-dev puppeteer-core
```

Expected: creates `package.json`, `package-lock.json`, `node_modules/` at the project root. None of this is referenced by `cad_timiza.html` — it only drives the test below.

- [ ] **Step 7: Write the end-to-end test**

```js
// scripts/e2e_test.js
const path = require("path");
const puppeteer = require("puppeteer-core");

const HTML_PATH = path.join(__dirname, "..", "cad_timiza.html");
const CHROMIUM_PATH = "/usr/bin/chromium";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await page.goto(`file://${HTML_PATH}`);
  await page.waitForSelector("#mapCanvas");

  const initialCount = await page.evaluate(() => document.getElementById("vehicleList").children.length);
  if (initialCount !== 0) throw new Error(`expected empty vehicle list before click, got ${initialCount}`);

  await page.click("#mapCanvas", { offset: { x: 450, y: 350 } });

  await page.waitForFunction(
    () => document.getElementById("summary").textContent.includes("Tiempo total"),
    { timeout: 15000 }
  );

  const summaryText = await page.evaluate(() => document.getElementById("summary").textContent);
  const listCount = await page.evaluate(() => document.getElementById("vehicleList").children.length);

  await page.screenshot({ path: path.join(__dirname, "..", "build", "e2e_screenshot.png") });
  await browser.close();

  if (listCount !== 6) throw new Error(`expected 6 vehicles in panel, got ${listCount}`);
  if (errors.length > 0) throw new Error(`console/page errors: ${errors.join("; ")}`);
  if (!/Tiempo total: \d/.test(summaryText)) throw new Error(`summary missing total time: ${summaryText}`);

  console.log("E2E OK:", summaryText.replace(/\n/g, " | "));
}

main().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 8: Run it**

Run: `cd /home/pentaa/Documentos/cienciasproj && node scripts/e2e_test.js`
Expected: exits 0, prints `E2E OK: Vehículo #<n> → emergencia: <x> min | Emergencia → poi_<id>: <y> min | Tiempo total: <z> min`. `build/e2e_screenshot.png` is created — open it to confirm the winning vehicle's path (white) and the emergency→hospital path (teal) are both drawn, and the emergency marker (red dot) is visible.

- [ ] **Step 9: Commit** — skipped, no git repo.

---

## Post-plan checklist (for whoever executes this)

- [ ] `cad_timiza.html` opens directly via double-click / `file://` with no console errors and no server running.
- [ ] Clicking different corners repeatedly always produces a plausible winner (compare the printed per-vehicle cost list — the highlighted one should be the minimum).
- [ ] The two animated stages are visually distinguishable (white path stage 1, teal path stage 2) and the amber "explored" dots differ from both.
- [ ] Total node/edge/POI counts logged by `preprocess.py` roughly match: ~3 hospitals, ~1 police, ~11 schools.

# Fusión de las 4 piezas de Timiza — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `cad_timiza.html`, `cad_timizaexample.html`, `mapa_timiza.html`, and `Proyecto1_Rutas_Emergencia_Timiza.ipynb` with a single regenerated `cad_timiza.html` that renders on Leaflet with real map tiles, extracts 5 POI types, and shows a dispatch-strategy comparison panel — while keeping all existing MST/vehicle/two-stage-A* dispatch logic intact.

**Architecture:** Python data pipeline (`scripts/graph_core.py` → `preprocess.py`) gains a 5th/6th POI type pair and a `compare_strategies` function, both flowing into `build/data.json`. The frontend (`app/template.html` + `app/app.js`) swaps its `<canvas>` renderer for Leaflet (tiles + polylines + circleMarkers), reusing the exploration-then-final-path animation pattern already proven working in `cad_timizaexample.html`, but wired to this repo's existing `algorithms.js`/`app.js` data shapes and dispatch logic (`selectWinner`, `nearestFacility`, `placeVehicles`). `scripts/bundle.py` needs no changes — it already does pure string substitution. Once verified end-to-end, the three now-redundant files are deleted.

**Tech Stack:** Python 3 stdlib only (no `osmnx`/`networkx`), vanilla JS (no framework) + Leaflet 1.9.4 via CDN, `node:test` for JS unit tests, Python `unittest` for Python tests, Puppeteer (`puppeteer-core` against system Chromium) for the e2e test.

## Global Constraints

- No external Python dependencies — `scripts/graph_core.py` and `scripts/preprocess.py` stay stdlib-only (`xml.etree.ElementTree`, `heapq`, `math`, `json`, `os`).
- `app/algorithms.js` and `app/app.js` stay dependency-free except for the Leaflet global (`L`) that the CDN `<script>` tag injects at runtime — no `npm install` of a map library.
- Leaflet version pinned to `1.9.4` via `cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/` (same version already used in `cad_timizaexample.html`).
- Tile provider: CartoDB `dark_all` raster tiles at `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`, subdomains `abcd`, attribution `&copy; OpenStreetMap contributors &copy; CARTO` (same provider/pattern already used by `mapa_timiza.html`, dark variant chosen to match the existing dark UI theme).
- POI color/label mapping (must match across Python data, JS rendering, and the HTML legend): `hospital=#ff5c5c` (Hospital), `police=#5c8cff` (Policía), `school=#5ee08a` (Colegio), `community_centre=#ffb454` (Centro comunal), `place_of_worship=#c48bff` (Templo).
- `cad_timiza.html` is a generated artifact (produced by `python3 scripts/preprocess.py && python3 scripts/bundle.py`) — never hand-edit it directly; edit `app/template.html`, `app/algorithms.js`, `app/app.js` and regenerate.
- Keep the `.winner` CSS class and `#vehicleList`/`#summary` element IDs intact — `scripts/e2e_test.js` and `app/app.js`'s `renderVehicleList` depend on them.

---

### Task 1: Extend POI_AMENITIES to include community_centre and place_of_worship

**Files:**
- Modify: `scripts/graph_core.py:106` (the `POI_AMENITIES` dict)
- Test: `scripts/test_graph_core.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `POI_AMENITIES` now maps 5 keys instead of 3; `extract_pois` (unchanged function body) will now also recognize `community_centre` and `place_of_worship` way tags. Downstream tasks rely on `extract_pois` returning POIs of type `"community_centre"` and `"place_of_worship"` when present in the input.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test_graph_core.py`, after the existing `TestExtractPois` class (before `from graph_core import prim_mst`):

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && python3 -m unittest test_graph_core.TestExtractPoisAmenityTypes -v`
Expected: FAIL — `assertEqual` sees `types == set()` (empty), because `community_centre`/`place_of_worship` aren't in `POI_AMENITIES` yet.

- [ ] **Step 3: Extend POI_AMENITIES**

In `scripts/graph_core.py`, replace line 106:

```python
POI_AMENITIES = {"hospital": "hospital", "police": "police", "school": "school"}
```

with:

```python
POI_AMENITIES = {
    "hospital": "hospital",
    "police": "police",
    "school": "school",
    "community_centre": "community_centre",
    "place_of_worship": "place_of_worship",
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && python3 -m unittest test_graph_core.TestExtractPoisAmenityTypes -v`
Expected: PASS

- [ ] **Step 5: Run the full Python test suite to check for regressions**

Run: `cd scripts && python3 -m unittest test_graph_core -v`
Expected: all tests PASS (existing `TestExtractPois.test_snaps_to_nearest_graph_node` still passes — it only uses `"school"`, unaffected).

- [ ] **Step 6: Commit**

```bash
git add scripts/graph_core.py scripts/test_graph_core.py
git commit -m "Extend POI_AMENITIES with community_centre and place_of_worship"
```

---

### Task 2: Implement compare_strategies (individual dispatch vs MST patrol)

**Files:**
- Modify: `scripts/graph_core.py` (append new function)
- Test: `scripts/test_graph_core.py`

**Interfaces:**
- Consumes: `pois` (list of `{"id", "name", "type", "node"}` as produced by `extract_pois`), `cost_matrix` (dict keyed by `(poi_id_a, poi_id_b)` → float minutes, symmetric, as built in `preprocess.py`'s `main()`), `mst_edges` (list of `(poi_id_a, poi_id_b, cost)` tuples as returned by `prim_mst`).
- Produces: `compare_strategies(pois, cost_matrix, mst_edges) -> dict` with shape `{"individual": {"total": float, "assignments": [{"poi": str, "station": str, "cost": float, "roundtrip": float}, ...]}, "patrol": {"total": float}, "savingsPct": float}`. Task 3 calls this and embeds the result verbatim under the `"strategyComparison"` key of `data.json`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test_graph_core.py`, after `TestPatrolEdges` (before the `if __name__ == "__main__":` line):

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && python3 -m unittest test_graph_core.TestCompareStrategies -v`
Expected: FAIL with `ImportError: cannot import name 'compare_strategies'`

- [ ] **Step 3: Implement compare_strategies**

Append to the end of `scripts/graph_core.py`:

```python
STATION_TYPES = {"hospital", "police"}
CRITICAL_TYPES = {"school", "community_centre", "place_of_worship"}


def compare_strategies(pois, cost_matrix, mst_edges):
    stations = [p for p in pois if p["type"] in STATION_TYPES]
    critical = [p for p in pois if p["type"] in CRITICAL_TYPES]

    assignments = []
    total_individual = 0.0
    for c in critical:
        best_station = min(stations, key=lambda s: cost_matrix[(s["id"], c["id"])])
        cost = cost_matrix[(best_station["id"], c["id"])]
        roundtrip = 2 * cost
        total_individual += roundtrip
        assignments.append({
            "poi": c["name"],
            "station": best_station["name"],
            "cost": cost,
            "roundtrip": roundtrip,
        })

    mst_total = sum(e[2] for e in mst_edges)
    patrol_total = 2 * mst_total

    savings_pct = 100 * (1 - patrol_total / total_individual) if total_individual > 0 else 0.0

    return {
        "individual": {"total": total_individual, "assignments": assignments},
        "patrol": {"total": patrol_total},
        "savingsPct": savings_pct,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && python3 -m unittest test_graph_core.TestCompareStrategies -v`
Expected: PASS

- [ ] **Step 5: Run the full Python test suite**

Run: `cd scripts && python3 -m unittest test_graph_core -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/graph_core.py scripts/test_graph_core.py
git commit -m "Add compare_strategies: individual dispatch vs MST patrol totals"
```

---

### Task 3: Wire compare_strategies into preprocess.py and regenerate data.json

**Files:**
- Modify: `scripts/preprocess.py`
- Modify: `scripts/test_preprocess.py`

**Interfaces:**
- Consumes: `compare_strategies` from Task 2, `POI_AMENITIES` from Task 1 (already wired through `extract_pois`, no `preprocess.py` change needed for that part).
- Produces: `build/data.json` gains a top-level `"strategyComparison"` key with the shape from Task 2. `data.json["pois"]` now includes `community_centre`/`place_of_worship` entries when present in the source OSM data. Task 5/6 (frontend) read `data.strategyComparison` and `data.pois[*].type`.

- [ ] **Step 1: Update the import and call compare_strategies**

In `scripts/preprocess.py`, replace line 3-6:

```python
from graph_core import (
    parse_osm, build_graph, adjacency, extract_pois,
    shortest_path, prim_mst, patrol_edges,
)
```

with:

```python
from graph_core import (
    parse_osm, build_graph, adjacency, extract_pois,
    shortest_path, prim_mst, patrol_edges, compare_strategies,
)
```

Then in `main()`, after the line `mst = prim_mst(poi_ids, cost_matrix)` (line 30) and before `patrol = patrol_edges(mst, poi_node, adj)` (line 31), no reordering needed — just add the new call after `patrol` is computed. Replace lines 30-39:

```python
    mst = prim_mst(poi_ids, cost_matrix)
    patrol = patrol_edges(mst, poi_node, adj)

    out_nodes = [{"id": nid, "lat": nodes[nid][0], "lon": nodes[nid][1]} for nid in graph_node_ids]
    out_edges = [{"from": e["from"], "to": e["to"], "w": e["w"], "directed": e["directed"]} for e in edges]
    out_patrol = [[a, b] for a, b in sorted(patrol)]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump({"nodes": out_nodes, "edges": out_edges, "pois": pois, "patrolEdges": out_patrol}, f)
```

with:

```python
    mst = prim_mst(poi_ids, cost_matrix)
    patrol = patrol_edges(mst, poi_node, adj)
    strategy_comparison = compare_strategies(pois, cost_matrix, mst)

    out_nodes = [{"id": nid, "lat": nodes[nid][0], "lon": nodes[nid][1]} for nid in graph_node_ids]
    out_edges = [{"from": e["from"], "to": e["to"], "w": e["w"], "directed": e["directed"]} for e in edges]
    out_patrol = [[a, b] for a, b in sorted(patrol)]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump({
            "nodes": out_nodes, "edges": out_edges, "pois": pois,
            "patrolEdges": out_patrol, "strategyComparison": strategy_comparison,
        }, f)
```

- [ ] **Step 2: Update the print summary to show strategy comparison**

Replace the last two lines of `main()` (lines 44-45):

```python
    print(f"nodes={len(out_nodes)} edges={len(out_edges)} pois={len(pois)} {by_type}")
    print(f"MST edges={len(mst)} total_cost={sum(e[2] for e in mst):.2f} patrol_edges={len(out_patrol)}")
```

with:

```python
    print(f"nodes={len(out_nodes)} edges={len(out_edges)} pois={len(pois)} {by_type}")
    print(f"MST edges={len(mst)} total_cost={sum(e[2] for e in mst):.2f} patrol_edges={len(out_patrol)}")
    print(f"strategy comparison: individual={strategy_comparison['individual']['total']:.1f} "
          f"patrol={strategy_comparison['patrol']['total']:.1f} "
          f"savings={strategy_comparison['savingsPct']:.1f}%")
```

- [ ] **Step 3: Regenerate build/data.json**

Run: `cd scripts && python3 preprocess.py`
Expected output: a line like `nodes=... edges=... pois=... {'hospital': 3, 'police': 1, 'school': 11, 'community_centre': 3, 'place_of_worship': 2}` followed by the MST and strategy comparison lines with no errors.

- [ ] **Step 4: Update test_preprocess.py POI count assertions**

In `scripts/test_preprocess.py`, replace `test_poi_counts` (lines 19-25):

```python
    def test_poi_counts(self):
        by_type = {}
        for p in self.data["pois"]:
            by_type[p["type"]] = by_type.get(p["type"], 0) + 1
        self.assertEqual(by_type.get("hospital"), 3)
        self.assertEqual(by_type.get("police"), 1)
        self.assertGreaterEqual(by_type.get("school", 0), 8)
```

with:

```python
    def test_poi_counts(self):
        by_type = {}
        for p in self.data["pois"]:
            by_type[p["type"]] = by_type.get(p["type"], 0) + 1
        self.assertEqual(by_type.get("hospital"), 3)
        self.assertEqual(by_type.get("police"), 1)
        self.assertGreaterEqual(by_type.get("school", 0), 8)
        self.assertGreaterEqual(by_type.get("community_centre", 0), 1)
        self.assertGreaterEqual(by_type.get("place_of_worship", 0), 1)
```

- [ ] **Step 5: Add a test for the strategyComparison output shape**

Add to `scripts/test_preprocess.py`, after `test_patrol_route_connects_all_pois`:

```python
    def test_strategy_comparison_present_and_sane(self):
        sc = self.data["strategyComparison"]
        self.assertGreater(sc["individual"]["total"], 0)
        self.assertGreater(sc["patrol"]["total"], 0)
        self.assertGreater(len(sc["individual"]["assignments"]), 0)
        for a in sc["individual"]["assignments"]:
            self.assertIn("poi", a)
            self.assertIn("station", a)
            self.assertAlmostEqual(a["roundtrip"], 2 * a["cost"])
```

- [ ] **Step 6: Run the preprocess tests**

Run: `cd scripts && python3 -m unittest test_preprocess -v`
Expected: all tests PASS (requires `build/data.json` from Step 3 to already exist)

- [ ] **Step 7: Commit**

```bash
git add scripts/preprocess.py scripts/test_preprocess.py build/data.json
git commit -m "Wire compare_strategies and extended POI types into preprocess.py output"
```

---

### Task 4: Rewrite app/template.html for Leaflet

**Files:**
- Modify: `app/template.html` (full rewrite)

**Interfaces:**
- Consumes: nothing (static markup).
- Produces: element IDs that Task 5/6's `app.js` binds to: `#map` (Leaflet container, replaces `#mapCanvas`), `#panel`, `#summary`, `#vehicleList`, `#strategyPanel` (new), `#speedSlider`. The `.winner` CSS class must still exist (used by `renderVehicleList` and `scripts/e2e_test.js`).

- [ ] **Step 1: Replace the full contents of app/template.html**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Consola de despacho — Timiza</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: Arial, sans-serif; background: #0b0f0e; color: #e8f0ee;
    display: flex; height: 100vh;
  }
  #map { background: #101614; flex: 1; }
  #panel {
    width: 320px; padding: 16px; background: #131a18; border-left: 1px solid #1f5652;
    overflow-y: auto;
  }
  #panel h2 { font-size: 15px; color: #4fd1c5; margin: 16px 0 8px; }
  #panel h2:first-child { margin-top: 0; }
  #vehicleList div, #summary div, #strategyPanel div { font-size: 12px; margin-bottom: 4px; }
  .winner { color: #4fd1c5; font-weight: bold; }
  #speedRow { margin-top: 16px; font-size: 12px; }
  #speedSlider { width: 100%; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 4px; }
  .legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
</style>
</head>
<body>
  <div id="map"></div>
  <div id="panel">
    <h2>Despacho</h2>
    <div id="summary">Haz clic en una esquina para simular una emergencia.</div>
    <h2>Vehículos</h2>
    <div id="vehicleList"></div>
    <h2>Comparación de estrategias</h2>
    <div id="strategyPanel"></div>
    <h2>Leyenda</h2>
    <div class="legend-item"><span class="legend-dot" style="background:#ff5c5c;"></span>Hospital</div>
    <div class="legend-item"><span class="legend-dot" style="background:#5c8cff;"></span>Policía</div>
    <div class="legend-item"><span class="legend-dot" style="background:#5ee08a;"></span>Colegio</div>
    <div class="legend-item"><span class="legend-dot" style="background:#ffb454;"></span>Centro comunal</div>
    <div class="legend-item"><span class="legend-dot" style="background:#c48bff;"></span>Templo</div>
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

- [ ] **Step 2: Verify the substitution markers are intact**

Run: `grep -n '__GRAPH_DATA__\|__ALGORITHMS_JS__\|__APP_JS__' app/template.html`
Expected: 3 lines, matching exactly `/*__GRAPH_DATA__*/`, `//__ALGORITHMS_JS__`, `//__APP_JS__` — `bundle.py` does an exact string `.replace()` on these, so they must be byte-identical to before.

- [ ] **Step 3: Commit**

```bash
git add app/template.html
git commit -m "Rewrite template.html for Leaflet map and strategy comparison panel"
```

---

### Task 5: Rewrite app/app.js rendering and dispatch animation on Leaflet

**Files:**
- Modify: `app/app.js` (full rewrite)
- Modify: `app/app.test.js`

**Interfaces:**
- Consumes: `buildAdjacency`, `astar` from `app/algorithms.js` (unchanged). `GRAPH_DATA` global (unchanged shape, plus the new `strategyComparison` key from Task 3, used by Task 6).
- Produces: same exported surface as before minus `projectLatLon`/`computeBounds` (removed — Leaflet handles projection/bounds), i.e. `mulberry32`, `placeVehicles`, `VEHICLE_TYPES`, `selectWinner`, `nearestFacility`, `speedToIntervalMs`. Task 6 adds `formatStrategyComparison` to this same export list.

- [ ] **Step 1: Update app.test.js to drop the removed functions**

In `app/app.test.js`, remove the `projectLatLon` import/usage from line 3 and delete the whole `"projectLatLon maps bounds corners to canvas corners"` test (lines 11-17). Remove the `computeBounds` import (line 71) and delete the whole `"computeBounds finds min/max lat/lon"` test (lines 71-84).

The resulting top of the file (replacing original lines 1-17) should read:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const { mulberry32, placeVehicles } = require("./app.js");

test("mulberry32 is deterministic for a given seed", () => {
  const a = mulberry32(42), b = mulberry32(42);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});
```

And remove the `computeBounds` block entirely — the file goes directly from the `nearestFacility` test to the `speedToIntervalMs` import/test. After this edit, `app/app.test.js` should have this test list in order: `mulberry32 is deterministic...`, `placeVehicles returns count vehicles...`, `selectWinner picks minimum cost...`, `nearestFacility picks the closest...`, `speedToIntervalMs decreases as speed increases`.

- [ ] **Step 2: Run tests to verify they fail (app.js not yet updated, but this checks the test file itself is syntactically valid and the removed imports are gone)**

Run: `cd app && node --test app.test.js`
Expected: existing tests still PASS (app.js hasn't changed yet in this step, and `projectLatLon`/`computeBounds` are simply no longer imported/tested) — this step just confirms the test file edit didn't break anything before touching app.js.

- [ ] **Step 3: Replace the full contents of app/app.js**

```javascript
function mulberry32(seed) {
  let s = seed;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function speedToIntervalMs(speed) {
  return Math.max(2, 220 - speed * 2);
}

const POI_COLOR = {
  hospital: "#ff5c5c", police: "#5c8cff", school: "#5ee08a",
  community_centre: "#ffb454", place_of_worship: "#c48bff",
};
const POI_LABEL = {
  hospital: "Hospital", police: "Policía", school: "Colegio",
  community_centre: "Centro comunal", place_of_worship: "Templo",
};

const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

function buildMap() {
  const map = L.map("map", { preferCanvas: true, zoomControl: false });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer(TILE_URL, { minZoom: 0, maxZoom: 20, subdomains: "abcd", attribution: TILE_ATTRIBUTION }).addTo(map);
  return map;
}

function drawStreets(map, data, nodesById) {
  for (const e of data.edges) {
    const a = nodesById.get(e.from), b = nodesById.get(e.to);
    L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: "#3a4750", weight: 1.2, opacity: 0.6 }).addTo(map);
  }
}

function drawPatrolRoute(map, data, nodesById) {
  for (const [a, b] of data.patrolEdges) {
    const na = nodesById.get(a), nb = nodesById.get(b);
    L.polyline([[na.lat, na.lon], [nb.lat, nb.lon]], { color: "#4fd1c5", weight: 3, opacity: 0.85 }).addTo(map);
  }
}

function drawPois(map, data, nodesById) {
  for (const p of data.pois) {
    const n = nodesById.get(p.node);
    const marker = L.circleMarker([n.lat, n.lon], {
      radius: p.type === "school" ? 5 : 7,
      color: "#0a1015", weight: 2,
      fillColor: POI_COLOR[p.type] || "#ffffff", fillOpacity: 1,
      interactive: false,
    }).addTo(map);
    marker.bindTooltip(`${p.name} (${POI_LABEL[p.type] || p.type})`, { direction: "top", offset: [0, -8] });
  }
}

function vehicleIcon(type) {
  return L.divIcon({
    className: "vehicle-icon",
    html: type === "ambulancia" ? "🚑" : "🚓",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function drawVehicles(map, vehicles) {
  for (const v of vehicles) {
    L.marker([v.lat, v.lon], { icon: vehicleIcon(v.type), interactive: false }).addTo(map);
  }
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

function animatePath(map, state, result, color, onDone) {
  const interval = speedToIntervalMs(state.speed);
  const explorationLayer = L.layerGroup().addTo(map);
  let i = 0;
  const timer = setInterval(() => {
    if (i >= result.explored.length) {
      clearInterval(timer);
      if (result.path) {
        const latlngs = result.path.map((nodeId) => {
          const n = state.nodesById.get(nodeId);
          return [n.lat, n.lon];
        });
        L.polyline(latlngs, { color, weight: 4, opacity: 0.95, interactive: false }).addTo(map);
      }
      onDone();
      return;
    }
    const n = state.nodesById.get(result.explored[i]);
    L.circleMarker([n.lat, n.lon], {
      radius: 2, color: "#b8860b", weight: 0, fillColor: "#b8860b", fillOpacity: 0.9, interactive: false,
    }).addTo(explorationLayer);
    i++;
  }, interval);
}

const MAX_SPEED_KMH = 50;

function dispatchEmergency(map, state, emergencyNode) {
  if (state.emergencyMarker) map.removeLayer(state.emergencyMarker);
  const en = state.nodesById.get(emergencyNode);
  state.emergencyMarker = L.circleMarker([en.lat, en.lon], {
    radius: 9, color: "#ff2d2d", weight: 2, fillColor: "#ff2d2d", fillOpacity: 0.9, interactive: false,
  }).addTo(map);

  const costs = state.vehicles.map((v) => {
    const r = astar(state.adj, state.nodesById, v.nearestNode, emergencyNode, MAX_SPEED_KMH);
    return { vehicleId: v.id, cost: r.cost, result: r };
  });
  const winner = selectWinner(costs);

  if (!winner || winner.cost === Infinity) {
    renderVehicleList(state, costs, null);
    document.getElementById("summary").textContent = "Ningún vehículo puede llegar a la emergencia.";
    return;
  }

  renderVehicleList(state, costs, winner.vehicleId);
  document.getElementById("summary").textContent = "Etapa 1: buscando vehículo más cercano...";

  animatePath(map, state, winner.result, "#ffffff", () => {
    document.getElementById("summary").textContent =
      `Vehículo #${winner.vehicleId} en camino a la emergencia (${winner.cost.toFixed(1)} min). Buscando hospital...`;
    const toHospital = nearestFacility(state.adj, state.nodesById, emergencyNode, state.hospitals, MAX_SPEED_KMH);
    animatePath(map, state, toHospital, "#4fd1c5", () => {
      if (!toHospital.path || toHospital.cost === Infinity) {
        document.getElementById("summary").innerHTML =
          `Vehículo #${winner.vehicleId} → emergencia: ${winner.cost.toFixed(1)} min<br>` +
          `Ningún hospital alcanzable desde la emergencia.`;
        return;
      }
      const total = winner.cost + toHospital.cost;
      document.getElementById("summary").innerHTML =
        `Vehículo #${winner.vehicleId} → emergencia: ${winner.cost.toFixed(1)} min<br>` +
        `Emergencia → ${toHospital.facilityId}: ${toHospital.cost.toFixed(1)} min<br>` +
        `<b>Tiempo total: ${total.toFixed(1)} min</b>`;
    });
  });
}

function initApp() {
  const data = GRAPH_DATA;
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(data.edges);
  const patrolEdgeList = data.patrolEdges.map(([a, b]) => {
    const match = data.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    return { from: a, to: b, w: match ? match.w : 1 };
  });
  const rng = mulberry32(20260713);
  const vehicles = placeVehicles(patrolEdgeList, nodesById, rng, 6);
  const hospitals = data.pois.filter((p) => p.type === "hospital");

  const map = buildMap();
  drawStreets(map, data, nodesById);
  drawPatrolRoute(map, data, nodesById);
  drawPois(map, data, nodesById);
  drawVehicles(map, vehicles);
  map.fitBounds(data.nodes.map((n) => [n.lat, n.lon]), { padding: [20, 20] });

  const state = { data, nodesById, vehicles, adj, hospitals, speed: 50, emergencyMarker: null };

  document.getElementById("speedSlider").addEventListener("input", (e) => {
    state.speed = Number(e.target.value);
  });

  map.on("click", (evt) => {
    let nearest = null, nearestD = Infinity;
    for (const n of data.nodes) {
      const d = (n.lat - evt.latlng.lat) ** 2 + (n.lon - evt.latlng.lng) ** 2;
      if (d < nearestD) { nearestD = d; nearest = n.id; }
    }
    dispatchEmergency(map, state, nearest);
  });

  return state;
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initApp);
}

if (typeof module !== "undefined") {
  module.exports = {
    mulberry32, placeVehicles, VEHICLE_TYPES,
    selectWinner, nearestFacility, speedToIntervalMs,
  };
}
```

- [ ] **Step 4: Run app.js unit tests**

Run: `cd app && node --test app.test.js`
Expected: all 5 tests PASS (`mulberry32`, `placeVehicles`, `selectWinner`, `nearestFacility`, `speedToIntervalMs`)

- [ ] **Step 5: Run algorithms.js tests to confirm no regression**

Run: `cd app && node --test algorithms.test.js`
Expected: all 3 tests PASS (unchanged file)

- [ ] **Step 6: Commit**

```bash
git add app/app.js app/app.test.js
git commit -m "Rewrite app.js rendering and dispatch animation on Leaflet"
```

---

### Task 6: Add strategy comparison panel rendering

**Files:**
- Modify: `app/app.js`
- Modify: `app/app.test.js`

**Interfaces:**
- Consumes: `data.strategyComparison` (shape from Task 2/3: `{individual: {total, assignments}, patrol: {total}, savingsPct}`).
- Produces: `formatStrategyComparison(sc) -> {individualMin, patrolMin, savings}` (pure, exported for testing), `renderStrategyPanel(sc)` (DOM-writing, calls `formatStrategyComparison` and fills `#strategyPanel`). `initApp` calls `renderStrategyPanel(data.strategyComparison)` once at startup.

- [ ] **Step 1: Write the failing test**

Add to `app/app.test.js`, after the `speedToIntervalMs` test:

```javascript
const { formatStrategyComparison } = require("./app.js");

test("formatStrategyComparison converts seconds to minutes and formats savings", () => {
  const sc = { individual: { total: 600 }, patrol: { total: 300 }, savingsPct: 50 };
  const f = formatStrategyComparison(sc);
  assert.equal(f.individualMin, "10.0");
  assert.equal(f.patrolMin, "5.0");
  assert.equal(f.savings, "50.0");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && node --test app.test.js`
Expected: FAIL — `formatStrategyComparison` is `undefined` (not exported yet)

- [ ] **Step 3: Implement formatStrategyComparison and renderStrategyPanel in app.js**

In `app/app.js`, add this block right after the `POI_LABEL` constant definition (before `TILE_URL`):

```javascript
function formatStrategyComparison(sc) {
  return {
    individualMin: (sc.individual.total / 60).toFixed(1),
    patrolMin: (sc.patrol.total / 60).toFixed(1),
    savings: sc.savingsPct.toFixed(1),
  };
}

function renderStrategyPanel(sc) {
  const el = document.getElementById("strategyPanel");
  const f = formatStrategyComparison(sc);
  el.innerHTML =
    `<div>Despacho individual: <b>${f.individualMin} min</b></div>` +
    `<div>Recorrido de patrullaje (MST): <b>${f.patrolMin} min</b></div>` +
    `<div>Ahorro con patrullaje conjunto: <b>${f.savings}%</b></div>`;
}
```

- [ ] **Step 4: Call renderStrategyPanel from initApp**

In `app/app.js`, inside `initApp`, right after the line `const state = { data, nodesById, vehicles, adj, hospitals, speed: 50, emergencyMarker: null };`, add:

```javascript
  renderStrategyPanel(data.strategyComparison);
```

- [ ] **Step 5: Export formatStrategyComparison**

In `app/app.js`, update the `module.exports` block at the bottom to:

```javascript
if (typeof module !== "undefined") {
  module.exports = {
    mulberry32, placeVehicles, VEHICLE_TYPES,
    selectWinner, nearestFacility, speedToIntervalMs,
    formatStrategyComparison,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && node --test app.test.js`
Expected: all 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add app/app.js app/app.test.js
git commit -m "Add strategy comparison panel (individual dispatch vs MST patrol)"
```

---

### Task 7: Regenerate cad_timiza.html, update e2e test, verify end-to-end

**Files:**
- Modify: `scripts/e2e_test.js`
- Regenerate: `build/data.json` (only if not already current from Task 3), `cad_timiza.html`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a working `cad_timiza.html` at the repo root, verified by the updated e2e test and manual browser check.

- [ ] **Step 1: Regenerate data.json and cad_timiza.html**

Run:
```bash
cd scripts && python3 preprocess.py && python3 bundle.py
```
Expected: two success lines, the second being `wrote /home/pentaa/Documentos/cienciasproj/cad_timiza.html (<N> bytes)`.

- [ ] **Step 2: Update scripts/e2e_test.js for the Leaflet container**

Replace line 22:

```javascript
    await page.waitForSelector("#mapCanvas");
```

with:

```javascript
    await page.waitForSelector("#map");
```

Replace line 40:

```javascript
    await page.click("#mapCanvas", { offset: { x: 450, y: 350 } });
```

with:

```javascript
    await page.click("#map", { offset: { x: 200, y: 300 } });
```

- [ ] **Step 3: Run the full Python test suite**

Run: `cd scripts && python3 -m unittest test_graph_core test_preprocess test_bundle -v`
Expected: all tests PASS

- [ ] **Step 4: Run the full JS unit test suite**

Run: `cd app && node --test`
Expected: all tests in `algorithms.test.js` and `app.test.js` PASS (9 tests total)

- [ ] **Step 5: Run the e2e test**

Run: `cd scripts && node e2e_test.js`
Expected: `E2E OK: ...` printed, exit code 0. If it fails because the click coordinate lands on a POI/vehicle marker or misses the map bounds, adjust the `offset` in Step 2 and re-run — do not weaken the assertions.

- [ ] **Step 6: Manual browser verification**

Open `cad_timiza.html` directly in a browser (e.g. `xdg-open cad_timiza.html` or drag into a tab). Confirm visually:
- Real map tiles load under the street network (requires internet).
- All 5 POI colors are visible on the map matching the legend.
- The teal patrol route is drawn.
- Vehicle emoji markers appear on the patrol route.
- The "Comparación de estrategias" panel shows non-zero individual/patrol minutes and a savings percentage on page load, without clicking anything.
- Clicking anywhere on the map triggers the two-stage animated dispatch (amber exploration dots, then white path to the vehicle's destination, then teal path to the hospital) and the summary panel updates with total time.

- [ ] **Step 7: Commit**

```bash
git add scripts/e2e_test.js cad_timiza.html build/data.json
git commit -m "Regenerate cad_timiza.html on Leaflet, update e2e test for #map"
```

---

### Task 8: Remove the superseded standalone files

**NOTE — not a subagent task:** `cad_timizaexample.html`, `mapa_timiza.html`, and
`Proyecto1_Rutas_Emergencia_Timiza.ipynb` were never `git add`ed in the original
repo (they show as `??` in `git status`), so they don't exist inside the
implementation worktree at all — a worktree only checks out tracked files.
This step must run in the original repo working directory
(`/home/pentaa/Documentos/cienciasproj`, not the worktree) after the worktree
branch has been merged back, and it's plain filesystem cleanup, not a git
operation — `git rm` would fail with "not under version control". The
controller performs this step directly instead of dispatching an implementer.

**Files:**
- Delete (plain `rm`, not `git rm`): `cad_timizaexample.html`, `mapa_timiza.html`, `Proyecto1_Rutas_Emergencia_Timiza.ipynb`

**Interfaces:**
- Consumes: confirmation from Task 7 that `cad_timiza.html` covers the content of all three (real tiles, 5 POI types, strategy comparison).
- Produces: a clean repo state with `cad_timiza.html` as the single dispatch-console artifact.

- [ ] **Step 1: Remove the files from the original repo directory**

```bash
cd /home/pentaa/Documentos/cienciasproj
rm cad_timizaexample.html mapa_timiza.html Proyecto1_Rutas_Emergencia_Timiza.ipynb
```

- [ ] **Step 2: Verify nothing else references them**

Run: `grep -rn "cad_timizaexample\|mapa_timiza\.html\|Proyecto1_Rutas" --include="*.py" --include="*.js" --include="*.html" --include="*.md" .`
Expected: no matches outside of `docs/superpowers/specs/` and `docs/superpowers/plans/` (design/plan documents are allowed to mention the old filenames as historical context).

- [ ] **Step 3: Confirm git status is unaffected by the deletion**

Run: `git status`
Expected: the three filenames no longer appear at all (they were untracked, so their removal leaves no diff to commit).

---

## Self-Review Notes

- **Spec coverage:** Data pipeline extension (Task 1-2), preprocess wiring (Task 3), Leaflet template (Task 4), Leaflet renderer + animation (Task 5), strategy panel (Task 6), regeneration + e2e + manual verification (Task 7), cleanup (Task 8) — all sections of `2026-07-14-fusion-consola-timiza-design.md` are covered.
- **Type consistency checked:** `compare_strategies` signature `(pois, cost_matrix, mst_edges)` is identical between its Task 2 definition and its Task 3 call site. `formatStrategyComparison`/`renderStrategyPanel` names match between Task 6's definition and `initApp`'s call. `#strategyPanel`/`#map`/`#vehicleList`/`#summary`/`#speedSlider` IDs match between Task 4's HTML and Task 5/6's `app.js` `document.getElementById` calls.
- **No placeholders:** every step has literal code or an exact shell command with expected output.

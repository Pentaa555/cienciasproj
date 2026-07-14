# Restyle CAD + buscador de ruta A/B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `cad_timiza.html`'s panel to the branded card-based look from the deleted `cad_timizaexample.html` prototype, and add a secondary A/B point-to-point route-finder tool (station → critical point, via quick-list shortcut buttons only, never by map click) alongside the existing emergency-dispatch console — without changing dispatch behavior.

**Architecture:** `app/app.js`'s animation engine (`animatePath`) is generalized to accept a `tracker` object (`{layers, generation, nodesById}`) instead of reading dispatch-specific fields off `state` directly, so both the existing dispatch flow and the new route-finder flow can each get an independent, non-interfering animation context. `app/template.html` is restyled with a branded header, card-based panel sections, A/B selection slots, two quick-list containers (stations/critical points), a floating "coach" hint, and an expanded legend. New pure-ish functions (`renderQuickList`, `updateRouteCoach`) plus DOM-driving functions (`selectRoutePoint`, `clearRouteSelection`, `computeAndAnimateRoute`) implement the route-finder. `scripts/bundle.py` and the Python data pipeline are untouched — this is a frontend-only change.

**Tech Stack:** Same as the existing project — vanilla JS + Leaflet 1.9.4 via CDN, `node:test` for JS unit tests (no DOM library available; DOM is hand-mocked with minimal fake elements, matching this file's existing `global.astar = ...` mocking pattern), Puppeteer e2e test.

## Global Constraints

- Dispatch behavior (`dispatchEmergency`'s decision logic, message text, `selectWinner`, `nearestFacility`, `placeVehicles`) must not change — only its internal tracker field names change (`state.dispatchLayers` → `state.dispatch.layers`, `state.dispatchGeneration` → `state.dispatch.generation`, `state.emergencyMarker` → `state.dispatch.emergencyMarker`).
- Map click stays reserved exclusively for triggering `dispatchEmergency`. The A/B route tool is only ever set via the `#stationsList`/`#criticalList` quick-list buttons — never by a map click handler.
- Existing element IDs/classes stay intact: `#map`, `#summary`, `#vehicleList`, `#strategyPanel`, `#speedSlider`, `.winner`.
- New element IDs introduced by this plan (must match exactly between `template.html` and `app.js`): `#coach`, `#route-a-label`, `#route-b-label`, `#route-result`, `#route-reset`, `#stationsList`, `#criticalList`.
- Station/critical-point partition matches the backend's `compare_strategies` partition exactly: stations = `hospital`/`police`, critical points = `school`/`community_centre`/`place_of_worship`.
- Real CartoDB `dark_all` tiles stay (not reverting to the tile-less background from `cad_timizaexample.html`).
- `cad_timiza.html` is a generated artifact (via `python3 scripts/preprocess.py && python3 scripts/bundle.py` — preprocess only needed if Python data changed, which it doesn't in this plan, so just `python3 scripts/bundle.py` suffices here) — never hand-edited.

---

### Task 1: Generalize animatePath into a tracker-based animation engine

**Files:**
- Modify: `app/app.js`

**Interfaces:**
- Consumes: nothing new (still uses `astar`'s `{path, cost, explored}` shape and `speedToIntervalMs`).
- Produces: `animatePath(map, tracker, speed, result, color, onDone)` where `tracker = {layers: [], generation: N, nodesById: Map}`. `state.dispatch` and `state.route` are both tracker-shaped objects on `state`. Task 3 relies on `state.route` existing with this exact shape (even though nothing populates `state.route.a`/`.b` until Task 3).

- [ ] **Step 1: Replace animatePath**

In `app/app.js`, replace the existing `animatePath` function (currently reads `state.speed`, `state.dispatchGeneration`, `state.dispatchLayers`, `state.nodesById`):

```javascript
function animatePath(map, state, result, color, onDone) {
  const interval = speedToIntervalMs(state.speed);
  const myGeneration = state.dispatchGeneration;
  const explorationLayer = L.layerGroup().addTo(map);
  state.dispatchLayers.push(explorationLayer);
  let i = 0;
  const timer = setInterval(() => {
    if (state.dispatchGeneration !== myGeneration) {
      clearInterval(timer);
      return;
    }
    if (i >= result.explored.length) {
      clearInterval(timer);
      if (result.path) {
        const latlngs = result.path.map((nodeId) => {
          const n = state.nodesById.get(nodeId);
          return [n.lat, n.lon];
        });
        const routeLine = L.polyline(latlngs, { color, weight: 4, opacity: 0.95, interactive: false }).addTo(map);
        state.dispatchLayers.push(routeLine);
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
```

with:

```javascript
function animatePath(map, tracker, speed, result, color, onDone) {
  const interval = speedToIntervalMs(speed);
  const myGeneration = tracker.generation;
  const explorationLayer = L.layerGroup().addTo(map);
  tracker.layers.push(explorationLayer);
  let i = 0;
  const timer = setInterval(() => {
    if (tracker.generation !== myGeneration) {
      clearInterval(timer);
      return;
    }
    if (i >= result.explored.length) {
      clearInterval(timer);
      if (result.path) {
        const latlngs = result.path.map((nodeId) => {
          const n = tracker.nodesById.get(nodeId);
          return [n.lat, n.lon];
        });
        const routeLine = L.polyline(latlngs, { color, weight: 4, opacity: 0.95, interactive: false }).addTo(map);
        tracker.layers.push(routeLine);
      }
      onDone();
      return;
    }
    const n = tracker.nodesById.get(result.explored[i]);
    L.circleMarker([n.lat, n.lon], {
      radius: 2, color: "#b8860b", weight: 0, fillColor: "#b8860b", fillOpacity: 0.9, interactive: false,
    }).addTo(explorationLayer);
    i++;
  }, interval);
}
```

- [ ] **Step 2: Update dispatchEmergency to use the dispatch tracker**

Replace the existing `dispatchEmergency` function:

```javascript
const MAX_SPEED_KMH = 50;

function dispatchEmergency(map, state, emergencyNode) {
  state.dispatchGeneration++;
  for (const layer of state.dispatchLayers) map.removeLayer(layer);
  state.dispatchLayers = [];
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
```

with:

```javascript
const MAX_SPEED_KMH = 50;

function dispatchEmergency(map, state, emergencyNode) {
  state.dispatch.generation++;
  for (const layer of state.dispatch.layers) map.removeLayer(layer);
  state.dispatch.layers = [];
  if (state.dispatch.emergencyMarker) map.removeLayer(state.dispatch.emergencyMarker);
  const en = state.nodesById.get(emergencyNode);
  state.dispatch.emergencyMarker = L.circleMarker([en.lat, en.lon], {
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

  animatePath(map, state.dispatch, state.speed, winner.result, "#ffffff", () => {
    document.getElementById("summary").textContent =
      `Vehículo #${winner.vehicleId} en camino a la emergencia (${winner.cost.toFixed(1)} min). Buscando hospital...`;
    const toHospital = nearestFacility(state.adj, state.nodesById, emergencyNode, state.hospitals, MAX_SPEED_KMH);
    animatePath(map, state.dispatch, state.speed, toHospital, "#4fd1c5", () => {
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
```

- [ ] **Step 3: Update initApp's state construction**

Replace this block inside `initApp`:

```javascript
  const state = {
    data, nodesById, vehicles, adj, hospitals, speed: 50,
    emergencyMarker: null, dispatchLayers: [], dispatchGeneration: 0,
  };
```

with:

```javascript
  const state = {
    data, nodesById, vehicles, adj, hospitals, speed: 50,
    dispatch: { layers: [], generation: 0, nodesById, emergencyMarker: null },
    route: { layers: [], generation: 0, nodesById, a: null, b: null },
  };
```

- [ ] **Step 4: Regenerate the bundle and run the existing test suite**

```bash
cd scripts && python3 bundle.py
node --test /home/pentaa/Documentos/cienciasproj/app/app.test.js /home/pentaa/Documentos/cienciasproj/app/algorithms.test.js
```

Expected: `wrote .../cad_timiza.html (...)`, then all 10 existing tests PASS (this refactor doesn't touch any exported function's signature — `mulberry32`, `placeVehicles`, `selectWinner`, `nearestFacility`, `speedToIntervalMs`, `formatStrategyComparison` are all unaffected).

- [ ] **Step 5: Run the e2e test to confirm dispatch still works after the refactor**

```bash
node /home/pentaa/Documentos/cienciasproj/scripts/e2e_test.js
```

Expected: `E2E OK: ...`, exit code 0. This confirms the tracker rename didn't silently break the dispatch click flow before any new UI is layered on top.

- [ ] **Step 6: Commit**

```bash
git add app/app.js cad_timiza.html
git commit -m "Generalize animatePath into a tracker-based animation engine"
```

---

### Task 2: Restyle template.html with branded header, cards, A/B slots, and coach

**Files:**
- Modify: `app/template.html` (full rewrite)

**Interfaces:**
- Consumes: nothing (static markup).
- Produces: new element IDs `#coach`, `#route-a-label`, `#route-b-label`, `#route-result`, `#route-reset`, `#stationsList`, `#criticalList` for Task 3's `app.js` to bind to. Existing IDs/classes (`#map`, `#summary`, `#vehicleList`, `#strategyPanel`, `#speedSlider`, `.winner`) and the 3 `bundle.py` substitution markers stay unchanged.

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
  #mapwrap { position: relative; flex: 1; }
  #map { background: #101614; width: 100%; height: 100%; }
  #panel {
    width: 320px; padding: 16px; background: #131a18; border-left: 1px solid #1f5652;
    overflow-y: auto; display: flex; flex-direction: column; gap: 14px;
  }

  .brand { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid #1f5652; }
  .brand-dot { width: 9px; height: 9px; border-radius: 50%; background: #4fd1c5; box-shadow: 0 0 8px #4fd1c5; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
  .brand h1 { font-size: 14px; letter-spacing: .06em; text-transform: uppercase; margin: 0; color: #4fd1c5; }
  .brand span { display: block; font-size: 11px; color: #8fa3a8; margin-top: 2px; }

  .card { background: #182420; border: 1px solid #1f5652; border-radius: 6px; padding: 14px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #4fd1c5; margin: 0 0 8px; }

  #vehicleList div, #summary div, #strategyPanel div { font-size: 12px; margin-bottom: 4px; }
  .winner { color: #4fd1c5; font-weight: bold; }

  .slot { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 4px; background: #101614; border: 1px solid #1f5652; margin-bottom: 8px; }
  .slot:last-of-type { margin-bottom: 0; }
  .slot .tag { font-family: monospace; font-size: 10px; color: #0b0f0e; padding: 2px 6px; border-radius: 3px; font-weight: 700; }
  .slot.origin .tag { background: #4fd1c5; }
  .slot.dest .tag { background: #ffb454; }
  .slot .val { font-size: 12px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .slot .val.empty { color: #8fa3a8; font-style: italic; }
  #route-result { font-size: 12px; margin-top: 8px; }
  #route-reset {
    width: 100%; margin-top: 10px; background: transparent; border: 1px solid #1f5652; color: #8fa3a8;
    font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 8px; border-radius: 4px; cursor: pointer;
  }
  #route-reset:hover { border-color: #ff5c5c; color: #ff5c5c; }

  .quick-list { display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; }
  .quick-btn {
    text-align: left; background: #101614; border: 1px solid #1f5652; color: #8fa3a8; font-size: 11px;
    padding: 6px 8px; border-radius: 4px; cursor: pointer; width: 100%;
  }
  .quick-btn:hover { border-color: #4fd1c5; color: #e8f0ee; }

  #speedRow { font-size: 12px; }
  #speedSlider { width: 100%; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 4px; }
  .legend-item:last-child { margin-bottom: 0; }
  .legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .legend-line { width: 16px; height: 3px; border-radius: 2px; flex-shrink: 0; }

  #coach {
    position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
    background: rgba(19, 26, 24, .92); border: 1px solid #1f5652; color: #e8f0ee;
    font-size: 12px; padding: 8px 16px; border-radius: 20px; z-index: 1000; pointer-events: none;
  }
</style>
</head>
<body>
  <div id="mapwrap">
    <div id="coach"></div>
    <div id="map"></div>
  </div>
  <div id="panel">
    <div class="brand">
      <div class="brand-dot"></div>
      <div>
        <h1>CAD · Timiza</h1>
        <span>Consola de rutas de emergencia</span>
      </div>
    </div>

    <div class="card">
      <h2>Despacho</h2>
      <div id="summary">Haz clic en una esquina para simular una emergencia.</div>
      <h2 style="margin-top:12px;">Vehículos</h2>
      <div id="vehicleList"></div>
    </div>

    <div class="card">
      <h2>Selección de ruta</h2>
      <div class="slot origin">
        <span class="tag">A</span>
        <span class="val empty" id="route-a-label">clic en un atajo</span>
      </div>
      <div class="slot dest">
        <span class="tag">B</span>
        <span class="val empty" id="route-b-label">clic en un atajo</span>
      </div>
      <div id="route-result"></div>
      <button id="route-reset">Limpiar selección</button>
    </div>

    <div class="card">
      <h2>Estaciones (atajo A)</h2>
      <div class="quick-list" id="stationsList"></div>
    </div>

    <div class="card">
      <h2>Puntos críticos (atajo B)</h2>
      <div class="quick-list" id="criticalList"></div>
    </div>

    <div class="card">
      <h2>Comparación de estrategias</h2>
      <div id="strategyPanel"></div>
    </div>

    <div class="card">
      <h2>Leyenda</h2>
      <div class="legend-item"><span class="legend-dot" style="background:#ff5c5c;"></span>Hospital</div>
      <div class="legend-item"><span class="legend-dot" style="background:#5c8cff;"></span>Policía</div>
      <div class="legend-item"><span class="legend-dot" style="background:#5ee08a;"></span>Colegio</div>
      <div class="legend-item"><span class="legend-dot" style="background:#ffb454;"></span>Centro comunal</div>
      <div class="legend-item"><span class="legend-dot" style="background:#c48bff;"></span>Templo</div>
      <div class="legend-item"><span class="legend-line" style="background:#3a4750;"></span>Red vial</div>
      <div class="legend-item"><span class="legend-line" style="background:#b8860b;"></span>Calles exploradas por A*</div>
      <div class="legend-item"><span class="legend-line" style="background:#ffffff;"></span>Ruta óptima</div>
    </div>

    <div class="card">
      <h2>Velocidad de animación</h2>
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

- [ ] **Step 2: Verify the substitution markers and required IDs are present**

```bash
grep -c '__GRAPH_DATA__\|__ALGORITHMS_JS__\|__APP_JS__' /home/pentaa/Documentos/cienciasproj/app/template.html
grep -c 'id="map"\|id="summary"\|id="vehicleList"\|id="strategyPanel"\|id="speedSlider"\|id="coach"\|id="route-a-label"\|id="route-b-label"\|id="route-result"\|id="route-reset"\|id="stationsList"\|id="criticalList"' /home/pentaa/Documentos/cienciasproj/app/template.html
```

Expected: first command outputs `3`, second outputs `12`.

- [ ] **Step 3: Regenerate the bundle**

```bash
cd scripts && python3 bundle.py
```

Expected: `wrote .../cad_timiza.html (...)`. The page won't be fully functional yet (Task 3 hasn't wired the quick-lists or coach text), so don't run the e2e test against this state — that happens in Task 4.

- [ ] **Step 4: Commit**

```bash
git add app/template.html cad_timiza.html
git commit -m "Restyle template.html with branded header, cards, A/B slots, and coach"
```

---

### Task 3: Implement the A/B route-finder logic in app.js

**Files:**
- Modify: `app/app.js`
- Modify: `app/app.test.js`

**Interfaces:**
- Consumes: `state.route` (tracker shape from Task 1: `{layers, generation, nodesById, a, b}`), `astar`/`buildAdjacency` from `algorithms.js`, `animatePath`/`MAX_SPEED_KMH` from Task 1, the element IDs from Task 2 (`#coach`, `#route-a-label`, `#route-b-label`, `#route-result`, `#route-reset`, `#stationsList`, `#criticalList`).
- Produces: `renderQuickList(elementId, pois, onSelect)`, `updateRouteCoach(state)` (both exported for testing), `selectRoutePoint(map, state, poi, kind)`, `clearRouteSelection(map, state)`, `computeAndAnimateRoute(map, state)` (DOM/map-driving, unexported — same pattern as `dispatchEmergency`). `initApp` wires the two quick-lists and the reset button.

- [ ] **Step 1: Write the failing tests**

Add to `app/app.test.js`, after the `formatStrategyComparison` test (at the end of the file):

```javascript
function fakeElement() {
  const el = {
    className: "", textContent: "", innerHTML: "", children: [], _listeners: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    appendChild(child) { el.children.push(child); },
    addEventListener(evt, cb) { el._listeners[evt] = cb; },
  };
  return el;
}

const { renderQuickList } = require("./app.js");

test("renderQuickList creates one button per POI wired to onSelect", () => {
  const container = fakeElement();
  global.document = {
    getElementById: (id) => (id === "list" ? container : null),
    createElement: () => fakeElement(),
  };
  const pois = [{ id: "p1", name: "Hospital A" }, { id: "p2", name: "Hospital B" }];
  const selected = [];
  renderQuickList("list", pois, (poi) => selected.push(poi));
  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].textContent, "Hospital A");
  assert.equal(container.children[0].className, "quick-btn");
  container.children[1]._listeners.click();
  assert.deepEqual(selected, [{ id: "p2", name: "Hospital B" }]);
});

const { updateRouteCoach } = require("./app.js");

test("updateRouteCoach shows contextual text for each selection state", () => {
  const coach = fakeElement();
  global.document = { getElementById: (id) => (id === "coach" ? coach : null) };
  updateRouteCoach({ route: { a: null, b: null } });
  assert.equal(coach.textContent, "Elige una estación (atajo A) o un punto crítico (atajo B) para trazar una ruta");
  updateRouteCoach({ route: { a: { name: "X" }, b: null } });
  assert.equal(coach.textContent, "Selecciona el punto B (destino)");
  updateRouteCoach({ route: { a: null, b: { name: "Y" } } });
  assert.equal(coach.textContent, "Selecciona el punto A (origen)");
  updateRouteCoach({ route: { a: { name: "X" }, b: { name: "Y" } } });
  assert.equal(coach.textContent, "Ruta A → B calculada");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test /home/pentaa/Documentos/cienciasproj/app/app.test.js
```

Expected: FAIL — `renderQuickList`/`updateRouteCoach` are `undefined` (not exported yet).

- [ ] **Step 3: Implement renderQuickList and updateRouteCoach**

In `app/app.js`, add this block right after the `POI_LABEL` constant definition (before `formatStrategyComparison`):

```javascript
function renderQuickList(elementId, pois, onSelect) {
  const container = document.getElementById(elementId);
  container.innerHTML = "";
  for (const poi of pois) {
    const btn = document.createElement("button");
    btn.className = "quick-btn";
    btn.textContent = poi.name;
    btn.addEventListener("click", () => onSelect(poi));
    container.appendChild(btn);
  }
}

function updateRouteCoach(state) {
  const coach = document.getElementById("coach");
  const hasA = !!state.route.a;
  const hasB = !!state.route.b;
  if (hasA && hasB) {
    coach.textContent = "Ruta A → B calculada";
  } else if (hasA) {
    coach.textContent = "Selecciona el punto B (destino)";
  } else if (hasB) {
    coach.textContent = "Selecciona el punto A (origen)";
  } else {
    coach.textContent = "Elige una estación (atajo A) o un punto crítico (atajo B) para trazar una ruta";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test /home/pentaa/Documentos/cienciasproj/app/app.test.js
```

Expected: all tests PASS (12 total: 10 existing + 2 new).

- [ ] **Step 5: Implement the DOM/map-driving route functions**

In `app/app.js`, add this block right after `renderVehicleList` (before `animatePath`):

```javascript
function computeAndAnimateRoute(map, state) {
  state.route.generation++;
  for (const layer of state.route.layers) map.removeLayer(layer);
  state.route.layers = [];
  const result = astar(state.adj, state.nodesById, state.route.a.node, state.route.b.node, MAX_SPEED_KMH);
  animatePath(map, state.route, state.speed, result, "#ffffff", () => {
    const resultEl = document.getElementById("route-result");
    if (!result.path || result.cost === Infinity) {
      resultEl.textContent = "Sin ruta posible entre estos dos puntos.";
    } else {
      resultEl.innerHTML = `Ruta A → B: <b>${result.cost.toFixed(1)} min</b>`;
    }
  });
}

function selectRoutePoint(map, state, poi, kind) {
  state.route[kind] = poi;
  const label = document.getElementById(kind === "a" ? "route-a-label" : "route-b-label");
  label.textContent = poi.name;
  label.classList.remove("empty");
  updateRouteCoach(state);
  if (state.route.a && state.route.b) {
    computeAndAnimateRoute(map, state);
  }
}

function clearRouteSelection(map, state) {
  state.route.generation++;
  for (const layer of state.route.layers) map.removeLayer(layer);
  state.route.layers = [];
  state.route.a = null;
  state.route.b = null;
  const labelA = document.getElementById("route-a-label");
  labelA.textContent = "clic en un atajo";
  labelA.classList.add("empty");
  const labelB = document.getElementById("route-b-label");
  labelB.textContent = "clic en un atajo";
  labelB.classList.add("empty");
  document.getElementById("route-result").textContent = "";
  updateRouteCoach(state);
}
```

Note: `computeAndAnimateRoute` is defined before `MAX_SPEED_KMH` textually (the `const MAX_SPEED_KMH = 50;` line comes right before `dispatchEmergency`, further down the file) — this is fine because `MAX_SPEED_KMH` is only referenced inside the function body, evaluated at call time (after the whole script, including the `const`, has run), not at definition time.

- [ ] **Step 6: Wire the route-finder into initApp**

In `app/app.js`, inside `initApp`, add this block right after `renderStrategyPanel(data.strategyComparison);` and before the `speedSlider` event listener:

```javascript
  const stations = data.pois.filter((p) => p.type === "hospital" || p.type === "police");
  const criticalPoints = data.pois.filter(
    (p) => p.type === "school" || p.type === "community_centre" || p.type === "place_of_worship"
  );
  renderQuickList("stationsList", stations, (poi) => selectRoutePoint(map, state, poi, "a"));
  renderQuickList("criticalList", criticalPoints, (poi) => selectRoutePoint(map, state, poi, "b"));
  document.getElementById("route-reset").addEventListener("click", () => clearRouteSelection(map, state));
  updateRouteCoach(state);
```

- [ ] **Step 7: Export the two testable functions**

In `app/app.js`, update the `module.exports` block at the bottom to:

```javascript
if (typeof module !== "undefined") {
  module.exports = {
    mulberry32, placeVehicles, VEHICLE_TYPES,
    selectWinner, nearestFacility, speedToIntervalMs,
    formatStrategyComparison, renderQuickList, updateRouteCoach,
  };
}
```

- [ ] **Step 8: Run the full JS test suite**

```bash
node --test /home/pentaa/Documentos/cienciasproj/app/app.test.js /home/pentaa/Documentos/cienciasproj/app/algorithms.test.js
```

Expected: all tests PASS (12 in app.test.js + 4 in algorithms.test.js = 16).

- [ ] **Step 9: Commit**

```bash
git add app/app.js app/app.test.js
git commit -m "Implement A/B route-finder logic (quick-list shortcuts, independent animation)"
```

---

### Task 4: Regenerate cad_timiza.html, extend e2e test, verify end-to-end

**Files:**
- Modify: `scripts/e2e_test.js`
- Regenerate: `cad_timiza.html`

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: a working `cad_timiza.html` with both the dispatch flow and the A/B route-finder flow verified end-to-end.

- [ ] **Step 1: Regenerate cad_timiza.html**

```bash
cd scripts && python3 bundle.py
```

Expected: `wrote /home/pentaa/Documentos/cienciasproj/cad_timiza.html (...)`.

- [ ] **Step 2: Add the A/B route-finder flow to scripts/e2e_test.js**

In `scripts/e2e_test.js`, insert this block right before the line `console.log("E2E OK:", ...)` (i.e., after all the existing dispatch-flow assertions, still inside the `try` block):

```javascript
    await page.evaluate(() => {
      document.getElementById("stationsList").children[0].click();
      document.getElementById("criticalList").children[0].click();
    });

    await page.waitForFunction(
      () => document.getElementById("route-result").textContent.length > 0,
      { timeout: 15000 }
    );

    const routeResultText = await page.evaluate(() => document.getElementById("route-result").textContent);
    if (!/min|Sin ruta posible/.test(routeResultText)) {
      throw new Error(`route-result text unexpected: ${routeResultText}`);
    }
```

And update the final `console.log` line from:

```javascript
    console.log("E2E OK:", summaryText.replace(/\n/g, " | "), `winner cost=${winnerCost} min=${minCost}`);
```

to:

```javascript
    console.log(
      "E2E OK:", summaryText.replace(/\n/g, " | "), `winner cost=${winnerCost} min=${minCost}`,
      "| A/B route:", routeResultText
    );
```

- [ ] **Step 3: Run the full verification suite**

```bash
cd /home/pentaa/Documentos/cienciasproj/scripts && python3 -m unittest test_graph_core test_preprocess test_bundle -v
cd /home/pentaa/Documentos/cienciasproj && node --test app/app.test.js app/algorithms.test.js
cd /home/pentaa/Documentos/cienciasproj && node scripts/e2e_test.js
```

Expected: Python tests unaffected (this plan doesn't touch `scripts/graph_core.py`/`preprocess.py`, so the count/results should match whatever they already were), 16/16 JS tests pass, e2e prints `E2E OK: ... | A/B route: Ruta A → B: X.X min` (or `Sin ruta posible...` if the first station/critical pair happens to be unreachable — either is an acceptable pass condition per the regex) and exits 0.

- [ ] **Step 4: Manual browser verification**

Open `cad_timiza.html` directly in a browser. Confirm visually:
- Branded header "CAD · Timiza" with pulsing teal dot.
- Panel sections render as distinct cards.
- "Estaciones (atajo A)" and "Puntos críticos (atajo B)" lists are populated with real POI names.
- Clicking a station button fills slot A; clicking a critical-point button fills slot B and immediately animates an amber-exploration → white-path route between them, independent of the map-click dispatch flow.
- The coach bubble above the map updates its text through the 4 states (idle / only A / only B / both) as you make and clear selections.
- "Limpiar selección" clears both slots, the route line, and resets the coach text.
- Legend shows the 3 new line swatches (red vial, calles exploradas, ruta óptima) alongside the 5 POI dots.
- Clicking on the map still triggers the emergency-dispatch flow exactly as before, unaffected by any route-finder selection.
- Triggering a dispatch while an A/B route is displayed (or vice versa) — both remain visible simultaneously without either clearing the other.

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e_test.js cad_timiza.html
git commit -m "Regenerate cad_timiza.html, extend e2e test to cover the A/B route-finder"
```

---

## Self-Review Notes

- **Spec coverage:** Header/cards restyle (Task 2), tracker generalization for independent dispatch/route animations (Task 1), quick-list + coach + route computation (Task 3), regeneration + e2e coverage of both flows + manual visual checklist (Task 4) — all sections of `2026-07-14-restyle-ruta-ab-timiza-design.md` are covered.
- **Type consistency checked:** `animatePath(map, tracker, speed, result, color, onDone)` signature is identical between Task 1's definition and both its Task 1 (`dispatchEmergency`) and Task 3 (`computeAndAnimateRoute`) call sites. `state.route`/`state.dispatch` shape from Task 1 matches exactly what Task 3's functions read/write (`.layers`, `.generation`, `.nodesById`, `.a`, `.b`, `.emergencyMarker`). Element IDs introduced in Task 2 (`#coach`, `#route-a-label`, `#route-b-label`, `#route-result`, `#route-reset`, `#stationsList`, `#criticalList`) match exactly what Task 3's `app.js` calls `document.getElementById` with.
- **No placeholders:** every step has literal code or an exact shell command with expected output.

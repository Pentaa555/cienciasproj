const test = require("node:test");
const assert = require("node:assert/strict");
const { mulberry32, placeVehicles } = require("./app.js");

test("mulberry32 is deterministic for a given seed", () => {
  const a = mulberry32(42), b = mulberry32(42);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
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

const { buildRaceCandidates } = require("./app.js");

test("buildRaceCandidates filters unreachable vehicles and flags the winner", () => {
  const costs = [
    { vehicleId: 0, cost: 5.0, result: { path: [1, 2, 3] } },
    { vehicleId: 1, cost: Infinity, result: { path: null } },
    { vehicleId: 2, cost: 3.0, result: { path: [4, 5] } },
  ];
  const candidates = buildRaceCandidates(costs, 2);
  assert.deepEqual(candidates, [
    { vehicleId: 0, path: [1, 2, 3], isWinner: false },
    { vehicleId: 2, path: [4, 5], isWinner: true },
  ]);
});

test("buildRaceCandidates preserves input order and flags a mid-list winner", () => {
  const costs = [
    { vehicleId: 5, cost: 2.0, result: { path: [9] } },
    { vehicleId: 3, cost: 1.0, result: { path: [8] } },
    { vehicleId: 1, cost: 4.0, result: { path: [7] } },
  ];
  const candidates = buildRaceCandidates(costs, 3);
  assert.deepEqual(
    candidates.map((c) => c.vehicleId),
    [5, 3, 1]
  );
  assert.deepEqual(
    candidates.map((c) => c.isWinner),
    [false, true, false]
  );
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

const { speedToIntervalMs } = require("./app.js");

test("speedToIntervalMs decreases as speed increases", () => {
  assert.ok(speedToIntervalMs(1) > speedToIntervalMs(100));
  assert.ok(speedToIntervalMs(100) >= 2);
});

const { formatStrategyComparison } = require("./app.js");

test("formatStrategyComparison formats minute totals and savings percentage", () => {
  const sc = { individual: { total: 43.46 }, patrol: { total: 35.12 }, savingsPct: 19.19 };
  const f = formatStrategyComparison(sc);
  assert.equal(f.individualMin, "43.5");
  assert.equal(f.patrolMin, "35.1");
  assert.equal(f.savings, "19.2");
});

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

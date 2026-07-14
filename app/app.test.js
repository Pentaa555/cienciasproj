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

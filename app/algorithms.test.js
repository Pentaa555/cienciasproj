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

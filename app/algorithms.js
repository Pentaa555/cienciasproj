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
      return { path, cost: gScore.get(goal), explored, cameFrom };
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
  return { path: null, cost: Infinity, explored, cameFrom };
}

if (typeof module !== "undefined") {
  module.exports = { haversineM, buildAdjacency, astar };
}

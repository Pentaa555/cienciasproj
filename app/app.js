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

if (typeof module !== "undefined") {
  module.exports = {
    mulberry32, projectLatLon, placeVehicles, VEHICLE_TYPES,
    selectWinner, nearestFacility, computeBounds,
  };
}

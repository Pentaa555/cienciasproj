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

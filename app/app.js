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

function formatStrategyComparison(sc) {
  return {
    individualMin: sc.individual.total.toFixed(1),
    patrolMin: sc.patrol.total.toFixed(1),
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
  state.dispatchLayers.push(explorationLayer);
  let i = 0;
  const timer = setInterval(() => {
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

const MAX_SPEED_KMH = 50;

function dispatchEmergency(map, state, emergencyNode) {
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

  const state = { data, nodesById, vehicles, adj, hospitals, speed: 50, emergencyMarker: null, dispatchLayers: [] };

  renderStrategyPanel(data.strategyComparison);

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
    formatStrategyComparison,
  };
}

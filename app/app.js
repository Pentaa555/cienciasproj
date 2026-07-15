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

function buildRaceCandidates(costs, winnerId) {
  return costs
    .filter((c) => c.result.path)
    .map((c) => ({ vehicleId: c.vehicleId, path: c.result.path, isWinner: c.vehicleId === winnerId }));
}

function nearestFacility(adj, nodesById, fromNode, facilities, maxSpeedKmh) {
  let best = null;
  for (const f of facilities) {
    const r = astar(adj, nodesById, fromNode, f.node, maxSpeedKmh);
    if (best === null || r.cost < best.cost) {
      best = { facilityId: f.id, node: f.node, path: r.path, cost: r.cost, explored: r.explored, cameFrom: r.cameFrom };
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
  const map = L.map("map", { preferCanvas: true, zoomControl: false, maxBoundsViscosity: 1.0 });
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
    iconSize: [32, 32],
    iconAnchor: [16, 16],
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

function finishRoute(map, state) {
  state.route.animating = false;
  if (state.route.pending && state.route.a && state.route.b) {
    state.route.pending = false;
    computeAndAnimateRoute(map, state);
  }
}

function computeAndAnimateRoute(map, state) {
  if (state.route.animating) {
    state.route.pending = true;
    return;
  }
  state.route.animating = true;
  state.route.generation++;
  for (const layer of state.route.layers) map.removeLayer(layer);
  state.route.layers = [];
  const result = astar(state.adj, state.nodesById, state.route.a.node, state.route.b.node, MAX_SPEED_KMH);
  animatePath(map, state, state.route, result, "#ffffff", "#b8860b", () => {
    const resultEl = document.getElementById("route-result");
    if (!result.path || result.cost === Infinity) {
      resultEl.textContent = "Sin ruta posible entre estos dos puntos.";
    } else {
      resultEl.innerHTML = `Ruta A → B: <b>${result.cost.toFixed(1)} min</b>`;
    }
    finishRoute(map, state);
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
  state.route.animating = false;
  state.route.pending = false;
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

function animatePath(map, state, tracker, result, color, exploreColor, onDone) {
  const myGeneration = tracker.generation;
  const explorationLayer = L.layerGroup().addTo(map);
  tracker.layers.push(explorationLayer);
  let i = 0;

  function step() {
    if (tracker.generation !== myGeneration) return;
    if (i >= result.explored.length) {
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
    const nodeId = result.explored[i];
    const parentId = result.cameFrom.get(nodeId);
    if (parentId !== undefined) {
      const n = tracker.nodesById.get(nodeId);
      const p = tracker.nodesById.get(parentId);
      L.polyline([[p.lat, p.lon], [n.lat, n.lon]], {
        color: exploreColor, weight: 2, opacity: 0.85, interactive: false,
      }).addTo(explorationLayer);
    }
    i++;
    setTimeout(step, speedToIntervalMs(state.speed));
  }
  step();
}

const MAX_SPEED_KMH = 50;

function finishDispatch(map, state) {
  state.dispatch.animating = false;
  if (state.dispatch.pendingNode !== null) {
    const next = state.dispatch.pendingNode;
    state.dispatch.pendingNode = null;
    dispatchEmergency(map, state, next);
  }
}

function dispatchEmergency(map, state, emergencyNode) {
  if (state.dispatch.animating) {
    state.dispatch.pendingNode = emergencyNode;
    return;
  }
  state.dispatch.animating = true;
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
    finishDispatch(map, state);
    return;
  }

  renderVehicleList(state, costs, winner.vehicleId);
  document.getElementById("summary").textContent = "Etapa 1: buscando vehículo más cercano...";

  animatePath(map, state, state.dispatch, winner.result, "#ffffff", "#b8860b", () => {
    document.getElementById("summary").textContent =
      `Vehículo #${winner.vehicleId} en camino a la emergencia (${winner.cost.toFixed(1)} min). Buscando hospital...`;
    const toHospital = nearestFacility(state.adj, state.nodesById, emergencyNode, state.hospitals, MAX_SPEED_KMH);
    animatePath(map, state, state.dispatch, toHospital, "#ffd93d", "#ff6ec7", () => {
      if (!toHospital.path || toHospital.cost === Infinity) {
        document.getElementById("summary").innerHTML =
          `Vehículo #${winner.vehicleId} → emergencia: ${winner.cost.toFixed(1)} min<br>` +
          `Ningún hospital alcanzable desde la emergencia.`;
        finishDispatch(map, state);
        return;
      }
      const total = winner.cost + toHospital.cost;
      document.getElementById("summary").innerHTML =
        `Vehículo #${winner.vehicleId} → emergencia: ${winner.cost.toFixed(1)} min<br>` +
        `Emergencia → ${toHospital.facilityId}: ${toHospital.cost.toFixed(1)} min<br>` +
        `<b>Tiempo total: ${total.toFixed(1)} min</b>`;
      finishDispatch(map, state);
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
  const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  const vehicles = placeVehicles(patrolEdgeList, nodesById, rng, 6);
  const hospitals = data.pois.filter((p) => p.type === "hospital");

  const map = buildMap();
  drawStreets(map, data, nodesById);
  drawPatrolRoute(map, data, nodesById);
  drawPois(map, data, nodesById);
  drawVehicles(map, vehicles);
  const dataBounds = L.latLngBounds(data.nodes.map((n) => [n.lat, n.lon]));
  map.fitBounds(dataBounds, { padding: [20, 20] });
  map.setMinZoom(map.getZoom());
  map.setMaxBounds(dataBounds.pad(0.2));

  const state = {
    data, nodesById, vehicles, adj, hospitals, speed: 50,
    dispatch: { layers: [], generation: 0, nodesById, emergencyMarker: null, animating: false, pendingNode: null },
    route: { layers: [], generation: 0, nodesById, a: null, b: null, animating: false, pending: false },
  };

  renderStrategyPanel(data.strategyComparison);

  const stations = data.pois.filter((p) => p.type === "hospital" || p.type === "police");
  const criticalPoints = data.pois.filter(
    (p) => p.type === "school" || p.type === "community_centre" || p.type === "place_of_worship"
  );
  renderQuickList("stationsList", stations, (poi) => selectRoutePoint(map, state, poi, "a"));
  renderQuickList("criticalList", criticalPoints, (poi) => selectRoutePoint(map, state, poi, "b"));
  document.getElementById("route-reset").addEventListener("click", () => clearRouteSelection(map, state));
  updateRouteCoach(state);

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
    formatStrategyComparison, renderQuickList, updateRouteCoach,
    buildRaceCandidates,
  };
}

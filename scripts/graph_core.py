import math
import xml.etree.ElementTree as ET
import heapq

EARTH_RADIUS_M = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def parse_osm(path):
    tree = ET.parse(path)
    root = tree.getroot()
    nodes = {}
    ways = []
    for el in root:
        if el.tag == "node":
            nodes[int(el.get("id"))] = (float(el.get("lat")), float(el.get("lon")))
        elif el.tag == "way":
            way_id = int(el.get("id"))
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            way_nodes = [int(nd.get("ref")) for nd in el.findall("nd")]
            ways.append({"id": way_id, "tags": tags, "nodes": way_nodes})
    return nodes, ways


DRIVABLE_HIGHWAYS = {
    "residential", "service", "tertiary", "primary", "secondary",
    "primary_link", "secondary_link", "tertiary_link", "unclassified",
    "living_street",
}

SPEED_KMH = {
    "primary": 50.0, "secondary": 40.0, "tertiary": 35.0,
    "primary_link": 30.0, "secondary_link": 30.0, "tertiary_link": 30.0,
    "residential": 25.0, "living_street": 20.0, "service": 15.0,
    "unclassified": 30.0,
}
DEFAULT_SPEED_KMH = 20.0


def build_graph(nodes, ways):
    edges = []
    for way in ways:
        highway = way["tags"].get("highway")
        if highway not in DRIVABLE_HIGHWAYS:
            continue
        speed = SPEED_KMH.get(highway, DEFAULT_SPEED_KMH)
        directed = way["tags"].get("oneway") == "yes"
        way_nodes = way["nodes"]
        for a, b in zip(way_nodes, way_nodes[1:]):
            if a not in nodes or b not in nodes:
                continue
            lat1, lon1 = nodes[a]
            lat2, lon2 = nodes[b]
            dist_m = haversine_m(lat1, lon1, lat2, lon2)
            weight_min = dist_m / (speed * 1000.0 / 60.0)
            edges.append({"from": a, "to": b, "w": weight_min, "directed": directed})
    return edges


def adjacency(edges):
    adj = {}
    for e in edges:
        adj.setdefault(e["from"], []).append((e["to"], e["w"]))
        if not e["directed"]:
            adj.setdefault(e["to"], []).append((e["from"], e["w"]))
    return adj


def dijkstra(adj, source):
    dist = {source: 0.0}
    prev = {}
    visited = set()
    heap = [(0.0, source)]
    while heap:
        d, u = heapq.heappop(heap)
        if u in visited:
            continue
        visited.add(u)
        for v, w in adj.get(u, []):
            nd = d + w
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(heap, (nd, v))
    return dist, prev


def shortest_path(adj, source, target):
    dist, prev = dijkstra(adj, source)
    if target not in dist:
        return None, math.inf
    path = [target]
    while path[-1] != source:
        path.append(prev[path[-1]])
    path.reverse()
    return path, dist[target]


POI_AMENITIES = {
    "hospital": "hospital",
    "police": "police",
    "school": "school",
    "community_centre": "community_centre",
    "place_of_worship": "place_of_worship",
}


def _way_centroid(way, nodes):
    coords = [nodes[n] for n in way["nodes"] if n in nodes]
    if not coords:
        return None
    lat = sum(c[0] for c in coords) / len(coords)
    lon = sum(c[1] for c in coords) / len(coords)
    return lat, lon


def extract_pois(nodes, ways, graph_node_ids):
    candidates = list(graph_node_ids)
    pois = []
    for way in ways:
        amenity = way["tags"].get("amenity")
        if amenity not in POI_AMENITIES:
            continue
        centroid = _way_centroid(way, nodes)
        if centroid is None:
            continue
        lat, lon = centroid
        nearest = min(
            candidates,
            key=lambda nid: haversine_m(lat, lon, nodes[nid][0], nodes[nid][1]),
        )
        pois.append({
            "id": f"poi_{way['id']}",
            "name": way["tags"].get("name", "?"),
            "type": POI_AMENITIES[amenity],
            "node": nearest,
        })
    return pois


def prim_mst(poi_ids, cost_matrix):
    if not poi_ids:
        return []
    visited = {poi_ids[0]}
    remaining = set(poi_ids[1:])
    mst = []
    while remaining:
        best = None
        for a in visited:
            for b in remaining:
                c = cost_matrix[(a, b)]
                if best is None or c < best[2]:
                    best = (a, b, c)
        mst.append(best)
        visited.add(best[1])
        remaining.remove(best[1])
    return mst


def patrol_edges(mst_edges, poi_node, adj):
    result = set()
    for poi_a, poi_b, _ in mst_edges:
        path, _ = shortest_path(adj, poi_node[poi_a], poi_node[poi_b])
        if path is None:
            continue
        for a, b in zip(path, path[1:]):
            result.add((a, b) if a < b else (b, a))
    return result


STATION_TYPES = {"hospital", "police"}
CRITICAL_TYPES = {"school", "community_centre", "place_of_worship"}


def compare_strategies(pois, cost_matrix, mst_edges):
    stations = [p for p in pois if p["type"] in STATION_TYPES]
    critical = [p for p in pois if p["type"] in CRITICAL_TYPES]

    assignments = []
    total_individual = 0.0
    if stations:
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

import math
import xml.etree.ElementTree as ET

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

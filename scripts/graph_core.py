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

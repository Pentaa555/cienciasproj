import json
import os
from graph_core import (
    parse_osm, build_graph, adjacency, extract_pois,
    shortest_path, prim_mst, patrol_edges, compare_strategies,
    largest_scc_nodes,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM_PATH = os.path.join(BASE_DIR, "map(2).osm")
OUT_PATH = os.path.join(BASE_DIR, "build", "data.json")


def main():
    nodes, ways = parse_osm(OSM_PATH)
    all_edges = build_graph(nodes, ways)
    all_node_ids = {e["from"] for e in all_edges} | {e["to"] for e in all_edges}

    main_component = largest_scc_nodes(all_node_ids, all_edges)
    dropped = len(all_node_ids) - len(main_component)
    if dropped:
        print(f"dropping {dropped} nodes in {len(all_node_ids)} -> not mutually reachable "
              f"with the main road network (disconnected fragments or one-way traps)")

    edges = [e for e in all_edges if e["from"] in main_component and e["to"] in main_component]
    graph_node_ids = main_component
    adj = adjacency(edges)

    pois = extract_pois(nodes, ways, graph_node_ids)
    poi_node = {p["id"]: p["node"] for p in pois}
    poi_ids = list(poi_node.keys())

    # Costs aren't assumed symmetric: one-way streets mean a->b and b->a can
    # differ (or one direction can be unreachable while the other isn't), so
    # each ordered pair is computed independently rather than reused.
    cost_matrix = {}
    for a in poi_ids:
        for b in poi_ids:
            if a == b:
                continue
            _, cost = shortest_path(adj, poi_node[a], poi_node[b])
            cost_matrix[(a, b)] = cost

    mst = prim_mst(poi_ids, cost_matrix)
    patrol = patrol_edges(mst, poi_node, adj)
    strategy_comparison = compare_strategies(pois, cost_matrix, mst)

    out_nodes = [{"id": nid, "lat": nodes[nid][0], "lon": nodes[nid][1]} for nid in graph_node_ids]
    out_edges = [{"from": e["from"], "to": e["to"], "w": e["w"], "directed": e["directed"]} for e in edges]
    out_patrol = [[a, b] for a, b in sorted(patrol)]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump({
            "nodes": out_nodes, "edges": out_edges, "pois": pois,
            "patrolEdges": out_patrol, "strategyComparison": strategy_comparison,
        }, f)

    by_type = {}
    for p in pois:
        by_type[p["type"]] = by_type.get(p["type"], 0) + 1
    print(f"nodes={len(out_nodes)} edges={len(out_edges)} pois={len(pois)} {by_type}")
    print(f"MST edges={len(mst)} total_cost={sum(e[2] for e in mst):.2f} patrol_edges={len(out_patrol)}")
    print(f"strategy comparison: individual={strategy_comparison['individual']['total']:.1f} "
          f"patrol={strategy_comparison['patrol']['total']:.1f} "
          f"savings={strategy_comparison['savingsPct']:.1f}%")


if __name__ == "__main__":
    main()

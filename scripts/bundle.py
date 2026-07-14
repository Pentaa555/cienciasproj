import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(BASE_DIR, "app")
DATA_PATH = os.path.join(BASE_DIR, "build", "data.json")
OUT_PATH = os.path.join(BASE_DIR, "cad_timiza.html")


def main():
    with open(os.path.join(APP_DIR, "template.html")) as f:
        html = f.read()
    with open(DATA_PATH) as f:
        data_json = f.read()
    with open(os.path.join(APP_DIR, "algorithms.js")) as f:
        algorithms_js = f.read()
    with open(os.path.join(APP_DIR, "app.js")) as f:
        app_js = f.read()

    html = html.replace("/*__GRAPH_DATA__*/", f"const GRAPH_DATA = {data_json};")
    html = html.replace("//__ALGORITHMS_JS__", algorithms_js)
    html = html.replace("//__APP_JS__", app_js)

    with open(OUT_PATH, "w") as f:
        f.write(html)
    print(f"wrote {OUT_PATH} ({len(html)} bytes)")


if __name__ == "__main__":
    main()

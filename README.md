# CAD Timiza

Consola de despacho de emergencias (CAD, *Computer-Aided Dispatch*) para el barrio
Timiza, Bogotá. A partir de un extracto real de OpenStreetMap, calcula un grafo vial
con tiempos de viaje reales y lo usa para decidir, en cada emergencia, qué ambulancia
despachar y por dónde debe ir, y cuál es el hospital más cercano una vez recogido el
paciente.

El resultado es un único archivo HTML autocontenido (`cad_timiza.html`): sin
servidor, sin build step para el usuario final, abre con doble clic.

## Arquitectura

El proyecto tiene dos mitades independientes:

```
map(2).osm ──▶ scripts/preprocess.py ──▶ build/data.json ──▶ scripts/bundle.py ──▶ cad_timiza.html
              (grafo + POIs + MST,             (datos              (empaqueta
               una sola vez, offline)          precalculados)      todo en un HTML)
```

- **`scripts/`** (Python, corre una sola vez offline): parsea el `.osm`, construye
  el grafo vial (peso = tiempo estimado, no distancia), filtra a un único componente
  fuertemente conexo (para que las calles de sentido único no dejen zonas
  inalcanzables), extrae los puntos de interés (hospitales, policía, colegios,
  centros comunales, templos), calcula la matriz de costos entre ellos (Dijkstra),
  el árbol de expansión mínima que los conecta (Prim, usado como "ruta de
  patrullaje") y una comparación de estrategias de cobertura. Todo esto se escribe
  en `build/data.json`.
- **`app/`** (JavaScript, corre en el navegador de cada usuario): `algorithms.js`
  reimplementa lo mínimo necesario para rutear en vivo (Haversine, lista de
  adyacencia, A*); `app.js` es la lógica de la aplicación — posiciona la flota,
  anima cada despacho de emergencia (vehículo más cercano → hospital más cercano),
  la búsqueda de rutas punto a punto, y el estado de la interfaz.
- **`scripts/bundle.py`** cose `app/template.html` + `data.json` + `algorithms.js` +
  `app.js` en el archivo final `cad_timiza.html`.

## Requisitos

- Python 3 (sin dependencias externas — solo librería estándar)
- Node.js 18+ (usa el runner de pruebas integrado, `node --test`)
- Un extracto `.osm` del área a mapear (este repo trae `map(2).osm` para Timiza)

## Regenerar los datos y la app

```bash
python3 scripts/preprocess.py   # OSM -> build/data.json
python3 scripts/bundle.py       # build/data.json -> cad_timiza.html
```

Luego abre `cad_timiza.html` en el navegador.

## Pruebas

```bash
# Unitarias Python (grafo, preprocesamiento, empaquetado)
python3 -m unittest discover -s scripts -p "test_*.py"

# Unitarias JavaScript (algoritmos y lógica de la app)
node --test app/*.test.js

# End-to-end (abre cad_timiza.html en un Chromium real y simula un despacho)
# tarda hasta ~2 min: anima la búsqueda A* completa sobre el grafo real (~9800 nodos)
node scripts/e2e_test.js
```

## Resultados y análisis

`docs/resultados-escenarios-cad-timiza.xlsx` compara 3 escenarios de tamaño de
flota (3, 6 y 12 ambulancias) sobre las mismas 300 emergencias simuladas, con
métricas de conflictos de despacho resueltos, utilización de la flota y tiempo de
cómputo. Incluye la metodología y las semillas usadas para que sea reproducible.

## Estructura del repositorio

```
app/                  algorithms.js, app.js, template.html + sus pruebas
scripts/               preprocess.py, graph_core.py, bundle.py, e2e_test.js + pruebas
build/data.json        datos precalculados (grafo, POIs, MST, comparación de estrategias)
cad_timiza.html        app final, autocontenida
map(2).osm             extracto de OpenStreetMap usado como fuente
docs/                  resultados y análisis
```

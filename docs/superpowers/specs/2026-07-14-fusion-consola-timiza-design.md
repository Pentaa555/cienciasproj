# Diseño: Fusión de las 4 piezas de Timiza en una sola consola

**Fecha:** 2026-07-14
**Estado:** Aprobado, pendiente de implementación

## Contexto

Existen actualmente 4 artefactos separados sobre el mismo proyecto de curso (rutas
de emergencia en Timiza), hechos en momentos distintos:

1. **`cad_timiza.html`** — la consola de despacho construida por el pipeline de
   este repo (`scripts/graph_core.py` → `preprocess.py` → `build/data.json` →
   `bundle.py` → `app/template.html` + `app/algorithms.js` + `app/app.js`).
   Renderiza en `<canvas>` sin dependencias externas. Implementa: grafo vial
   completo, 3 tipos de POI (hospital/police/school), MST de patrullaje,
   vehículos posicionados sobre la ruta de patrullaje, y despacho en dos etapas
   (vehículo→emergencia, emergencia→hospital) con animación de A*. Ver spec previo
   `2026-07-13-despacho-dinamico-timiza-design.md`, que dejó fuera de alcance el
   notebook y el mapa estático.
2. **`Proyecto1_Rutas_Emergencia_Timiza.ipynb`** — notebook de análisis (`osmnx`/
   `networkx`, no ejecutable en este repo por la ruta `/mnt/user-data/uploads/`
   hardcodeada). Extrae 5 tipos de POI (hospital, police, school,
   community_centre, place_of_worship), implementa A* y Prim propios, y compara
   dos estrategias de despacho: individual (ida+vuelta desde estación más
   cercana) vs recorrido único de patrullaje (aproximación 2×MST).
3. **`mapa_timiza.html`** — mapa Leaflet exportado con `folium` desde la celda 13
   del notebook: red vial completa, POIs coloreados por tipo, aristas del MST
   resaltadas. Estático (sin interacción de despacho), depende de tiles de
   internet.
4. **`cad_timizaexample.html`** — prototipo standalone (Leaflet + A* propio) que
   ya resuelve animar la exploración de A* sobre un mapa Leaflet real
   (`revealFinalPath`, animación por frames), con selección de origen/destino
   entre estaciones y puntos críticos. No tiene vehículos, MST ni despacho en dos
   etapas.

El usuario pide fusionar las 4 piezas en **un único HTML autocontenido** que las
reemplace a todas.

## Alcance de esta iteración

Reemplazar `cad_timiza.html` por una versión que:
- Conserva toda la lógica de despacho ya implementada (vehículos sobre ruta de
  patrullaje, selección de ganador, despacho en dos etapas animado).
- Se renderiza sobre Leaflet con tiles reales de internet (decisión explícita del
  usuario: se acepta que el archivo requiera conexión la primera carga, a cambio
  de tener calles/edificios reales de fondo en vez de solo líneas dibujadas).
- Extiende los POIs de 3 a 5 tipos (agrega `community_centre` y
  `place_of_worship`), igual que el notebook.
- Agrega un panel de comparación de estrategias (despacho individual vs
  recorrido de patrullaje MST) con el mismo cálculo del notebook (celdas 9-11).

Al terminar y confirmar que el HTML final cubre el contenido de las 4 piezas, se
eliminan del repo: `cad_timizaexample.html`, `mapa_timiza.html`, y
`Proyecto1_Rutas_Emergencia_Timiza.ipynb`.

Fuera de alcance (se mantiene igual que el spec anterior):
- Tipos de emergencia distintos a "médica → hospital" en el flujo de despacho.
- Movimiento continuo de vehículos en el tiempo.
- Reasignación de vehículos ya despachados a una segunda emergencia concurrente.
- Hacer el notebook ejecutable en este entorno (se elimina, no se repara).

## Cambios en el pipeline de datos (Python)

**`scripts/graph_core.py`:**
- `POI_AMENITIES` pasa de `{"hospital": "hospital", "police": "police", "school":
  "school"}` a incluir también `"community_centre": "community_centre"` y
  `"place_of_worship": "place_of_worship"`.
- Nueva función `compare_strategies(pois, poi_node, cost_matrix, mst_edges)`:
  - Estaciones = POIs de tipo `hospital`/`police`; críticos = tipo `school`/
    `community_centre`/`place_of_worship` (misma partición que el notebook).
  - Estrategia individual: para cada punto crítico, costo = 2× (costo mínimo a
    cualquier estación, usando `cost_matrix` ya calculado en `preprocess.py`).
    Suma total + detalle por punto (nombre, estación asignada, costo ida,
    ida+vuelta) para mostrar en el panel.
  - Estrategia patrullaje: 2× costo total del MST.
  - Devuelve `{individual: {total, assignments: [...]}, patrol: {total},
    savingsPct}`.

**`scripts/preprocess.py`:**
- Sin cambios en la extracción de POIs en sí (ya usa `POI_AMENITIES` de
  `graph_core.py`, así que los 2 tipos nuevos salen "gratis").
- Llama a `compare_strategies` y agrega su resultado como clave
  `"strategyComparison"` en el JSON de salida (`build/data.json`).

## Cambios en el frontend

**Rearquitectura de renderizado — de `<canvas>` a Leaflet:**

`app/template.html`:
- Reemplaza `<canvas id="mapCanvas">` por `<div id="map">`.
- Agrega `<link>`/`<script>` de Leaflet 1.9.4 vía CDN (mismo que
  `cad_timizaexample.html`: `cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/`).
- Agrega sección de panel nueva: "Comparación de estrategias" (siempre visible,
  no depende de hacer clic en una emergencia), y leyenda de 5 tipos de POI con
  los mismos colores del notebook: hospital=rojo, police=azul, school=verde,
  community_centre=naranja, place_of_worship=morado.

`app/app.js` (reescritura del renderer, se conserva la lógica de negocio):
- Se eliminan `projectLatLon`, `computeBounds`, `drawBaseMap` (Leaflet resuelve
  proyección/bounds/tiles).
- `initApp` crea el mapa Leaflet (`L.map` + tile layer `cartodbpositron`,
  igual que el notebook/`mapa_timiza.html`), dibuja la red vial completa como
  `L.polyline` tenues, la ruta de patrullaje resaltada, los POIs como
  `L.circleMarker` coloreados por tipo, y los vehículos como `L.marker` con
  ícono emoji (mismo patrón que ya usa `drawBaseMap` actual, adaptado a capas
  Leaflet).
- El clic para disparar una emergencia pasa de coordenadas de canvas a
  `map.on("click", ...)` con `e.latlng`, buscando el nodo real más cercano
  (reutiliza la misma búsqueda de nodo más cercano por distancia, ya no hace
  falta reproyectar a píxeles).
- La animación de exploración de A* (`animatePath`) se reescribe para agregar/
  quitar `L.circleMarker` por frame sobre el mapa en vez de dibujar en canvas,
  siguiendo el patrón ya resuelto en `cad_timizaexample.html`
  (`frame`/`revealFinalPath`). La lógica de temporización
  (`speedToIntervalMs`, el slider de velocidad) no cambia.
- Se mantienen intactas: `selectWinner`, `nearestFacility`, `placeVehicles`,
  `mulberry32`, `dispatchEmergency` (solo cambia cómo pinta, no cómo decide).
- Nueva función `renderStrategyPanel(data.strategyComparison)`: pinta el total
  individual, el total de patrullaje y el % de ahorro en el panel lateral al
  cargar la app (una sola vez, no depende de clics).

`app/algorithms.js`: sin cambios (agnóstico al renderer).

**Tests (`app/app.test.js`):**
- Se eliminan/actualizan los tests que cubrían `projectLatLon`/`computeBounds`
  (funciones que desaparecen).
- Se mantienen los tests de `placeVehicles`, `selectWinner`, `mulberry32`,
  `speedToIntervalMs`.
- Nuevo test para `compare_strategies` en Python (`scripts/test_graph_core.py`)
  y opcionalmente un test JS de `renderStrategyPanel` si se extrae como función
  pura de formateo (separar cálculo de DOM para poder testear).

**`scripts/bundle.py`:** sin cambios estructurales (sigue empalmando
`template.html` + `data.json` + `algorithms.js` + `app.js` → `cad_timiza.html`).

## Limpieza final

Una vez verificado que `cad_timiza.html` regenerado funciona end-to-end
(construir con `preprocess.py` + `bundle.py`, abrir y probar clic→despacho, y
confirmar visualmente el panel de comparación de estrategias y los 5 tipos de
POI), se eliminan del repo:
- `cad_timizaexample.html`
- `mapa_timiza.html`
- `Proyecto1_Rutas_Emergencia_Timiza.ipynb`

## Validación

- Los cálculos de A*/MST/comparación de estrategias siguen siendo correctos por
  construcción (mismos algoritmos ya probados, solo cambia el renderer y se
  amplía el conjunto de POIs).
- Verificación manual en navegador: abrir `cad_timiza.html`, confirmar que el
  mapa muestra tiles reales, los 5 tipos de POI con sus colores, la ruta de
  patrullaje, los vehículos, que el clic dispara el despacho en dos etapas
  animado sobre el mapa Leaflet, y que el panel de comparación de estrategias
  muestra números coherentes (patrullaje < individual, con algún % de ahorro).
- `scripts/e2e_test.js` (Playwright/Chromium existente) se actualiza para
  interactuar con el mapa Leaflet en vez de coordenadas de canvas.

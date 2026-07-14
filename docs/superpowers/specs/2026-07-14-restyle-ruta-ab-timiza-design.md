# Diseño: Restyle CAD + buscador de ruta A/B — Timiza

**Fecha:** 2026-07-14
**Estado:** Aprobado, pendiente de implementación

## Contexto

Tras fusionar las 4 piezas del proyecto en una sola consola (`cad_timiza.html`,
ver `2026-07-14-fusion-consola-timiza-design.md`), el usuario compartió una
captura de la UI de `cad_timizaexample.html` (el prototipo ya eliminado) y pidió
recuperar dos cosas de ahí:

1. **El estilo visual**: header con marca ("CAD · TIMIZA" + punto pulsante),
   panel dividido en tarjetas (`.card`) con bordes/fondo propio, listas de
   atajos clicables, leyenda con swatches de línea además de los puntos de
   POI, burbuja "coach" flotante sobre el mapa.
2. **El patrón de selección A/B**: en `cad_timizaexample.html`, el usuario
   elegía dos puntos (una estación como origen A, un punto crítico como
   destino B) y la app trazaba y animaba la ruta más corta (A*) entre ambos.

Decisiones tomadas con el usuario:
- El despacho de emergencias (clic en el mapa = emergencia, ya implementado)
  sigue siendo la interacción **principal** del mapa. La selección A/B es una
  **herramienta secundaria** que solo se activa por los botones de atajo de
  las listas "Estaciones" / "Puntos críticos" — nunca por clic directo en el
  mapa. Así no hay ambigüedad sobre qué hace un clic.
- Se mantienen los tiles reales de CartoDB ya integrados (no se vuelve al
  fondo negro sin mapa de `cad_timizaexample.html`).

## Alcance de esta iteración

Reestilizar `app/template.html` (CSS + estructura de tarjetas) y extender
`app/app.js` con la funcionalidad de selección de ruta A/B, sin tocar la
lógica de despacho de vehículos ya implementada y revisada (`dispatchEmergency`,
`selectWinner`, `nearestFacility`, `placeVehicles`, etc. no cambian de
comportamiento).

Fuera de alcance:
- Cambiar el flujo de despacho (sigue siendo clic-en-mapa = emergencia).
- Volver a quitar los tiles reales.
- Panel de métricas detallado de la ruta A/B (tiempo/distancia/nodos
  expandidos/tramos como en `cad_timizaexample.html`) — se muestra solo el
  tiempo total en minutos, igual de simple que el resto de la consola.

## Cambios de estilo (`app/template.html`)

**Header con marca**, reemplaza el `<h2>Despacho</h2>` actual:

```html
<div class="brand">
  <div class="brand-dot"></div>
  <div>
    <h1>CAD · Timiza</h1>
    <span>Consola de rutas de emergencia</span>
  </div>
</div>
```

con el punto pulsante (`@keyframes pulse`) y tipografía monoespaciada para el
branding, tal como en `cad_timizaexample.html`.

**Todas las secciones del panel pasan a ser `.card`** (fondo `#16232b`-ish
sobre el panel `#131a18` existente, borde 1px, radio 6px, padding 14px), en
este orden:
1. Despacho (existente: `#summary`, `#vehicleList`)
2. Selección de ruta A/B (nueva)
3. Estaciones — atajo A (nueva)
4. Puntos críticos — atajo B (nueva)
5. Comparación de estrategias (existente)
6. Leyenda (existente, ampliada con swatches de línea)
7. Velocidad de animación (existente `#speedSlider`)

**Tarjeta "Selección de ruta A/B":**

```html
<div class="card">
  <h2>Selección de ruta</h2>
  <div class="slot origin">
    <span class="tag">A</span>
    <span class="val empty" id="route-a-label">clic en un atajo</span>
  </div>
  <div class="slot dest">
    <span class="tag">B</span>
    <span class="val empty" id="route-b-label">clic en un atajo</span>
  </div>
  <div id="route-result"></div>
  <button id="route-reset">Limpiar selección</button>
</div>
```

`.slot.origin .tag` en teal (`#4fd1c5`, reutiliza el acento ya existente),
`.slot.dest .tag` en ámbar (`#ffb454`, ya usado para `community_centre`).

**Tarjetas "Estaciones (atajo A)" / "Puntos críticos (atajo B)":** listas
`.quick-list` (`max-height` + `overflow-y:auto`) generadas dinámicamente desde
`data.pois` — estaciones = `hospital`/`police`, críticos =
`school`/`community_centre`/`place_of_worship` (misma partición que
`compare_strategies` en el backend). Cada ítem es un `<button class="quick-btn">`
con el nombre del POI.

**Leyenda ampliada:** además de los 5 puntos de POI ya existentes, se agregan
3 swatches de línea: red vial (gris `#3a4750`), calles exploradas por A*
(ámbar `#b8860b`), ruta óptima (blanco `#ffffff`).

**Burbuja "coach"** flotante centrada arriba del mapa (`position:absolute`,
`z-index` sobre el mapa), visible siempre, con texto contextual (ver lógica
abajo). Distinta del `#summary` del despacho — este coach habla solo de la
herramienta de ruta A/B.

## Cambios de lógica (`app/app.js`)

**Refactor de `animatePath`** para que sirva tanto al despacho como a la
ruta A/B sin duplicar código: en vez de leer `state.dispatchLayers`/
`state.dispatchGeneration` directamente, recibe un objeto "tracker"
`{ layers: [], generation: N }` y el `speed` como parámetros:

```javascript
function animatePath(map, tracker, speed, result, color, onDone) {
  const interval = speedToIntervalMs(speed);
  const myGeneration = tracker.generation;
  const explorationLayer = L.layerGroup().addTo(map);
  tracker.layers.push(explorationLayer);
  let i = 0;
  const timer = setInterval(() => {
    if (tracker.generation !== myGeneration) { clearInterval(timer); return; }
    if (i >= result.explored.length) {
      clearInterval(timer);
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
    const n = tracker.nodesById.get(result.explored[i]);
    L.circleMarker([n.lat, n.lon], {
      radius: 2, color: "#b8860b", weight: 0, fillColor: "#b8860b", fillOpacity: 0.9, interactive: false,
    }).addTo(explorationLayer);
    i++;
  }, interval);
}
```

(`tracker.nodesById` is set once at init so the tracker is self-contained —
avoids threading `state` through a function whose job is purely animation.)

`state` gains two independent tracking contexts, replacing the flat
`dispatchLayers`/`dispatchGeneration`/`emergencyMarker` fields:

```javascript
state.dispatch = { layers: [], generation: 0, nodesById, emergencyMarker: null };
state.route = { layers: [], generation: 0, nodesById, a: null, b: null };
```

`dispatchEmergency` updates its tracker references from `state.dispatchLayers`
→ `state.dispatch.layers`, `state.dispatchGeneration` → `state.dispatch.generation`,
`state.emergencyMarker` → `state.dispatch.emergencyMarker`, and calls
`animatePath(map, state.dispatch, state.speed, result, color, onDone)`. No
change to its decision logic (winner selection, message text).

**New functions:**

- `renderQuickList(elementId, pois, onSelect)`: fills `#stationsList` /
  `#criticalList` with one `<button class="quick-btn">` per POI, wired to
  `onSelect(poi)` on click. Pure DOM population, reused for both lists.
- `updateRouteCoach(state)`: sets `#coach` text based on
  `state.route.a`/`state.route.b`: neither set → "Elige una estación (atajo A)
  o un punto crítico (atajo B) para trazar una ruta"; only A set → "Selecciona
  el punto B (destino)"; both set → "Ruta A → B calculada".
- `selectRoutePoint(map, state, poi, kind)`: `kind` is `"a"` or `"b"`. Sets
  `state.route[kind] = poi`, updates the corresponding `#route-a-label`/
  `#route-b-label` text (removing the `.empty` class), calls
  `updateRouteCoach(state)`, and if both `state.route.a` and `state.route.b`
  are set, calls `computeAndAnimateRoute(map, state)`.
- `clearRouteSelection(map, state)`: bumps `state.route.generation`, removes
  all `state.route.layers` from the map, resets `state.route.layers = []`,
  `state.route.a = state.route.b = null`, resets both label elements back to
  their empty placeholder text/class, clears `#route-result`, calls
  `updateRouteCoach(state)`. Wired to the `#route-reset` button's click
  handler.
- `computeAndAnimateRoute(map, state)`: bumps `state.route.generation` and
  clears `state.route.layers` (same clear-before-redraw pattern already used
  by `dispatchEmergency`), runs
  `astar(state.adj, state.nodesById, state.route.a.node, state.route.b.node, MAX_SPEED_KMH)`,
  and calls `animatePath(map, state.route, state.speed, result, "#ffffff", onDone)`
  where `onDone` writes the result into `#route-result`: if `result.path` is
  null, `"Sin ruta posible entre estos dos puntos."`; otherwise
  `` `Ruta A → B: <b>${result.cost.toFixed(1)} min</b>` ``.

`initApp` additionally: builds `state.route`/`state.dispatch` tracker objects,
calls `renderQuickList("stationsList", stations, (poi) => selectRoutePoint(map, state, poi, "a"))`
and the equivalent for `criticalList`/`"b"`, wires `#route-reset`'s click to
`clearRouteSelection`, and calls `updateRouteCoach(state)` once at startup so
the coach shows its idle text immediately.

`module.exports` gains `renderQuickList`, `updateRouteCoach` (pure-ish,
testable without a live map) — `selectRoutePoint`/`computeAndAnimateRoute`/
`clearRouteSelection` stay unexported (they need `map`/DOM, same pattern as
`dispatchEmergency` today).

## Interacción entre despacho y ruta A/B

Independientes por diseño: cada uno tiene su propio `tracker` (`layers` +
`generation`), así que limpiar uno nunca borra las capas del otro, y una
animación en curso de uno no se cancela por una acción en el otro. Ambos
pueden tener resultados visibles en el mapa simultáneamente (p. ej. una
emergencia despachada y una ruta A/B calculada a la vez) — esto es
intencional, no un caso a prevenir.

## Testing

- `renderQuickList`: test con datos de POI sintéticos, verifica que se crean
  los botones correctos y que el click dispara `onSelect` con el POI correcto
  (usando un DOM simulado mínimo o verificando la estructura generada).
- `updateRouteCoach`: test puro de las 3 ramas de texto (ninguno, solo A,
  ambos) contra un `state.route` sintético.
- `scripts/e2e_test.js`: se agrega un segundo flujo end-to-end (además del ya
  existente de despacho): hacer clic en el primer botón de `#stationsList` y
  en el primer botón de `#criticalList`, esperar a que `#route-result` tenga
  texto, y verificar que contiene "min" o "Sin ruta posible".

## Validación

- El despacho de emergencias sigue funcionando exactamente igual (mismos
  tests existentes de `dispatchEmergency`/`selectWinner`/`nearestFacility`
  sin cambios).
- Verificación manual en navegador: confirmar visualmente el header con
  marca, las tarjetas, las listas de atajos pobladas con los nombres reales
  de estaciones/puntos críticos, que elegir A y B traza y anima una ruta
  ámbar→blanca independiente de cualquier despacho en curso, que "Limpiar
  selección" borra la ruta del mapa, y que la leyenda muestra los 3 swatches
  de línea nuevos.

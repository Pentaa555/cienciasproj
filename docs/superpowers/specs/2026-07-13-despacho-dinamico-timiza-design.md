# Diseño: Consola de despacho dinámico de vehículos — Timiza

**Fecha:** 2026-07-13
**Estado:** Aprobado, pendiente de implementación

## Contexto

Proyecto de curso (grafos) sobre optimización de rutas de emergencia en el barrio
Timiza (Kennedy, Bogotá). El insumo real disponible es `map(1).osm` (extracto de
OpenStreetMap, ~2.9 MB, 8004 nodos / 1686 ways). No existe código previo en este
directorio — se construye desde cero.

El profesor pidió un modelo específico: un conjunto de vehículos (ambulancias,
patrullas) recorre/está distribuido sobre una **ruta de patrullaje** (obtenida vía
MST/Prim). Cuando ocurre una emergencia en una esquina cualquiera, se debe (1)
identificar cuál vehículo, de los que están sobre la ruta de patrullaje, es el más
cercano en tiempo real de viaje (A*), desviarlo a la emergencia, y (2) desde la
emergencia, encaminarlo (A* otra vez) a la instalación pertinente (hospital). El
MST y A* no son estrategias alternativas: conviven en un mismo flujo — el MST fija
dónde están los vehículos disponibles, A* resuelve el despacho puntual sobre esa
base, dos veces por emergencia.

## Alcance de esta iteración

Un único entregable: **app interactiva HTML/JS autocontenida** (consola de
despacho). Notebook de análisis y mapa estático quedan fuera de esta iteración.

Simplificaciones deliberadas (decididas con el usuario):
- Todas las emergencias tienen un solo tipo de instalación de destino: hospital
  (no se modela CAI/otro tipo de instalación en esta iteración).
- Los vehículos no se animan en movimiento continuo; se colocan en posiciones
  aleatorias fijas sobre la ruta de patrullaje al cargar la app y permanecen ahí
  hasta que se les asigna una emergencia.

## Datos reales extraídos de `map(1).osm`

- **Hospitales** (`amenity=hospital`, tag en `way`): Hospital de Kennedy, Compensar
  Unidad de Servicios Kennedy, Centro Médico EPS Sanitas — 3 en total.
- **Policía** (`amenity=police`): Octava Estación de Policía Kennedy — 1.
- **Colegios** (`amenity=school`): ~10-11 (IED Fernando Soto Aparicio, IED John F.
  Kennedy, IED Tom Adams, Colegio Las Américas, IED Los Periodistas, IED San
  Rafael, Colegio Santa Luisa, IED Francisco de Miranda, Colegio de Formación
  Integral Nuevo Mundo, Liceo Samario, Colegio Militar Justiniano Quiñónez Angulo).
- Estos POIs están tageados sobre `way` (polígonos de edificio), no `node`: se debe
  calcular el centroide del way y snapearlo al nodo de calle transitable más
  cercano.
- Tipos de vía presentes (`highway=`): residential, footway, service, tertiary,
  primary, cycleway, construction, pedestrian, secondary, primary_link,
  tertiary_link, corridor, steps.

## Pipeline de datos (Python, offline, una sola vez)

1. Parsear `map(1).osm` con `xml.etree.ElementTree` (sin dependencias externas).
2. Construir el grafo vial:
   - Nodos: nodos OSM que son extremos/intermedios de ways `highway=*`
     transitables en carro. Se **excluyen** `footway`, `cycleway`, `steps`,
     `pedestrian`, `corridor`, `construction`.
   - Aristas: cada segmento consecutivo de un way; dirigida solamente si el way
     tiene `oneway=yes`.
   - Peso de arista = distancia Haversine entre extremos (m) / velocidad típica
     según `highway` (km/h aproximados: primary=50, secondary=40, tertiary=35,
     primary_link/secondary_link/tertiary_link=30, residential=25,
     living_street=20, service=15, unclassified=30), convertido a minutos.
3. Extraer POIs (hospitales, policía, colegios): centroide del way → nodo de calle
   transitable más cercano (por distancia euclidiana en lat/lon).
4. Calcular el costo real de viaje (Dijkstra o A*) entre cada par de POIs →
   grafo completo de costos POI-a-POI.
5. Prim sobre ese grafo completo de POIs → MST (qué pares de POI se conectan).
6. Para cada arista del MST, recuperar el camino real de calles (misma búsqueda
   del paso 4) → la unión de esos caminos es la **ruta de patrullaje**: un
   subconjunto de aristas del grafo vial completo.
7. Volcar todo a JSON compacto: `nodes` (id, lat, lon), `edges` (from, to, weight,
   directed), `pois` (id, nombre, tipo, nodo snapeado), `patrolEdges` (lista de
   aristas que forman la ruta de patrullaje). Este JSON se embebe directamente
   como `<script>const DATA = {...}</script>` dentro del HTML final — sin
   servidor, sin fetch, un solo archivo que se abre con doble clic.

## App (HTML/JS, un solo archivo)

**Render del mapa:** SVG (o canvas) con las calles del grafo completo en un tono
tenue, y las aristas de `patrolEdges` resaltadas como "ruta de patrullaje".
Proyección simple lat/lon → coordenadas de pantalla (equirectangular, suficiente
para un área tan pequeña).

**Vehículos:** al cargar la app, 5-8 vehículos (mezcla ambulancia/patrulla, solo
para variar el ícono — no cambia la lógica de despacho) se colocan en puntos
aleatorios sobre las aristas de `patrolEdges` (interpolación a lo largo de la
arista elegida al azar). Quedan fijos ahí.

**Disparar una emergencia:** clic en cualquier nodo real (esquina) del grafo
completo (no restringido a la ruta de patrullaje) marca ese nodo como punto de
emergencia.

**Despacho, en dos etapas, ambas animadas:**
1. *Vehículo → emergencia*: A* corre desde el nodo más cercano a cada uno de los
   vehículos hasta el nodo de la emergencia, sobre el **grafo vial completo**
   (no restringido a `patrolEdges`). Se comparan los 5-8 costos, se determina el
   ganador (mínimo tiempo real), y se anima su búsqueda de A* (nodos explorados
   en un color, ruta óptima final en otro — mismo lenguaje visual ya usado en
   iteraciones anteriores del curso: ámbar oscuro para descartados, blanco para
   la ruta óptima). Los demás vehículos no se animan, solo se muestra su costo
   final en el panel lateral para comparación.
2. *Emergencia → hospital*: al terminar la animación anterior, A* corre desde el
   nodo de la emergencia hasta el hospital más cercano (de los 3), mismo
   lenguaje visual.

**Panel lateral:** vehículo seleccionado (tipo + id), tiempo etapa 1, tiempo
etapa 2, tiempo total, y la lista comparativa de costos de los demás vehículos
(para dejar explícito que sí se evaluaron todos antes de elegir).

**Control de velocidad:** slider continuo que regula la velocidad de propagación
de la animación de exploración de A* (reutilizando el mismo mecanismo de
iteraciones anteriores).

## Validación / métricas visibles en la app

- El costo mostrado para cada etapa debe ser el óptimo real (A* es correcto por
  construcción al usar una heurística admisible: distancia en línea recta entre
  nodo actual y destino / velocidad máxima del grafo).
- El panel comparativo de costos de los 5-8 vehículos deja ver, caso a caso, que
  el vehículo elegido es efectivamente el de menor tiempo real (no el más
  cercano en línea recta ni el primero de una lista).

## Fuera de alcance

- Notebook de análisis Python y mapa estático (quedan para una iteración
  posterior si se piden).
- Tipos de emergencia distintos a "médica → hospital".
- Movimiento continuo/animado de los vehículos en el tiempo.
- Reasignación de vehículos ya despachados a una segunda emergencia concurrente.

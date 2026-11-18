# Arquitectura — Sistema Inteligente de Arbolado Urbano

Documento técnico que describe la arquitectura implementada y la de producción, el modelo
de datos GIS, el flujo de importación, el sistema de imágenes, la seguridad, la escalabilidad
y el mapeo de las 49 secciones del encargo.

---

## 1. Visión general

```
                 ┌──────────────────────────────────────────────┐
   Navegador ──▶ │  SPA (HTML + CSS + JS modular, Leaflet)       │  ← ESTA ENTREGA
                 │  Mapa · Catálogo · Fichas · Panel · Import    │
                 └───────────────┬──────────────────────────────┘
                                 │ fetch (GeoJSON/JSON estáticos)
                 ┌───────────────▼──────────────────────────────┐
                 │  datos/        (generado por el ETL)          │  ← ESTA ENTREGA
                 │  trees.geojson · species.json · stats.json    │
                 └───────────────▲──────────────────────────────┘
                                 │ scripts/generar-datos.mjs (Shapefile/.aprx → GeoJSON)
                 ┌───────────────┴──────────────────────────────┐
                 │  FASE BACKEND (diseñada, documentada abajo)   │
                 │  API REST  ·  PostgreSQL+PostGIS  ·  Storage  │
                 │  Procesado GIS (GDAL)  ·  Auth  ·  IA          │
                 └──────────────────────────────────────────────┘
```

La entrega actual es una **aplicación WebGIS estática y funcional** sobre datos reales.
El backend está **diseñado** para que la migración sea incremental y sin reescribir el front.

### Stack

- **Front-end**: SPA en JavaScript modular (ES Modules), sin build. Enrutado por hash
  (`/mapa`, `/especies`, `/especie/:slug`, `/arbol/:id`, `/estadisticas`, `/importar`, `/admin`).
  Sistema de diseño propio en CSS (tokens, claro/oscuro, responsive, WCAG).
  *Migrable a Next.js + React + TypeScript + Tailwind conservando el mismo modelo de datos.*
- **Mapa**: Leaflet + `markercluster` + `heat`. Capas base OSM / Esri / CARTO / OpenTopoMap.
- **Gráficos**: Chart.js.
- **Datos (producción)**: PostgreSQL 15 + PostGIS 3.
- **Storage**: Object Storage (S3 compatible) para fotografías.
- **GIS servidor**: GDAL / ogr2ogr / GeoPandas.

---

## 2. Modelo de datos GIS (PostgreSQL + PostGIS)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- ESPECIES (biblioteca botánica)
CREATE TABLE especies (
  id                SERIAL PRIMARY KEY,
  slug              TEXT UNIQUE NOT NULL,
  nombre_comun      TEXT NOT NULL,
  nombre_cientifico TEXT,
  familia           TEXT,
  genero            TEXT,
  origen            TEXT,          -- Nativa | Introducida | Ornamental
  porte             TEXT,
  altura_maxima     TEXT,
  longevidad        TEXT,
  tipo_follaje      TEXT,          -- Perenne | Caduco | Semicaduco
  requerimiento_hidrico TEXT,
  importancia_ecologica TEXT,
  descripcion       TEXT,
  caracteristicas   JSONB,
  imagen_principal  TEXT,          -- URL en Object Storage
  imagenes_secundarias JSONB,      -- [{url, tipo, fuente, autor, licencia, fecha}]
  identificada      BOOLEAN DEFAULT FALSE
);

-- ARBOLES (individuos)
CREATE TABLE arboles (
  id                BIGSERIAL PRIMARY KEY,
  codigo            TEXT UNIQUE NOT NULL,
  especie_id        INTEGER REFERENCES especies(id),
  nombre_comun      TEXT,
  nombre_cientifico TEXT,
  familia           TEXT,
  genero            TEXT,
  latitud           DOUBLE PRECISION,
  longitud          DOUBLE PRECISION,
  geom              GEOMETRY(Point, 4326),   -- índice espacial
  altura            NUMERIC,
  altura_copa       NUMERIC,
  diametro          NUMERIC,                 -- DAP
  estado            TEXT,                    -- Bueno|Regular|Malo|Crítico
  salud             TEXT,
  fecha_inventario  DATE,
  ubicacion         TEXT,                    -- dirección
  comuna            TEXT,
  barrio            TEXT,
  sector            TEXT,
  observaciones     TEXT,
  imagen_url        TEXT,                    -- foto del individuo (opcional)
  fuente_datos      TEXT,
  inventario_id     INTEGER REFERENCES inventarios(id),
  -- trazabilidad
  importado_por     INTEGER, importado_en TIMESTAMPTZ DEFAULT now(),
  modificado_por    INTEGER, modificado_en TIMESTAMPTZ,
  version           INTEGER DEFAULT 1,
  eliminado         BOOLEAN DEFAULT FALSE     -- borrado lógico (auditoría)
);
CREATE INDEX arboles_geom_gix   ON arboles USING GIST (geom);
CREATE INDEX arboles_especie_ix ON arboles (especie_id);
CREATE INDEX arboles_sector_ix  ON arboles (sector);

-- INVENTARIOS (campañas / levantamientos)
CREATE TABLE inventarios (
  id SERIAL PRIMARY KEY, nombre TEXT, fecha DATE, fuente TEXT,
  crs TEXT, total_registros INTEGER, creado_en TIMESTAMPTZ DEFAULT now()
);

-- USUARIOS (roles)
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY, email TEXT UNIQUE, nombre TEXT,
  password_hash TEXT, rol TEXT DEFAULT 'consulta',   -- admin|gis|editor|consulta|publico
  activo BOOLEAN DEFAULT TRUE, creado_en TIMESTAMPTZ DEFAULT now()
);

-- REPORTES CIUDADANOS
CREATE TABLE reportes (
  id BIGSERIAL PRIMARY KEY, arbol_id BIGINT REFERENCES arboles(id),
  tipo TEXT, comentario TEXT, foto_url TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
  estado TEXT DEFAULT 'pendiente', creado_en TIMESTAMPTZ DEFAULT now()
);

-- AUDITORÍA (nunca se elimina información sin registro)
CREATE TABLE auditoria (
  id BIGSERIAL PRIMARY KEY, entidad TEXT, entidad_id BIGINT, accion TEXT,
  usuario_id INTEGER, diff JSONB, fecha TIMESTAMPTZ DEFAULT now()
);
```

El ETL actual (`scripts/generar-datos.mjs`) produce exactamente esta forma de datos en JSON;
insertarlos en PostGIS es un `COPY`/`INSERT` directo desde el mismo generador.

---

## 3. Flujo de importación (asistente de 5 pasos)

```
SUBIR → ANALIZAR → MAPEAR COLUMNAS → VALIDAR → IMPORTAR
  │        │            │              │          │
  │        │            │              │          └─ upsert PostGIS + generar/actualizar especies
  │        │            │              └─ coordenadas inválidas, fuera de área, duplicados, CRS
  │        │            └─ mapeo inteligente (sinónimos: especie/scientific_name, lat/y, lon/x…)
  │        └─ detección de formato, capas, registros, campos, coordenadas, CRS
  └─ GeoJSON/CSV/JSON (navegador)  ·  .aprx/.shp/.zip/.gpkg/.kml (servidor, GDAL)
```

- **En el navegador** (implementado): GeoJSON, JSON y CSV se parsean, se mapean columnas con
  reconocimiento de sinónimos, se valida geometría y se previsualiza.
- **En servidor** (diseñado) para `.aprx`, `.shp`, `.zip`, `.gpkg`, `.kml/.kmz`:

```
POST /api/import           (multipart)
  1. Detectar tipo (magic bytes + extensión).
  2. Si es .aprx → parsear CIM JSON (ZIP): mapas, capas, tablas, dataConnection,
     workspaceFactory, CRS, campos de atributos.
  3. Resolver fuentes externas referenciadas (Shapefile/Excel/GDB).
     Si falta alguna → responder: "Este proyecto contiene referencias a fuentes de
     datos externas que deben estar disponibles para importar completamente."
  4. ogr2ogr → GeoJSON EPSG:4326.
  5. Mapear columnas, validar, upsert en PostGIS, generar especies, asociar imágenes.
```

> **Caso real de este proyecto.** `Prueba.aprx` es un ZIP con documentos CIM. Su capa
> `Prueba` apuntaba a un **Shapefile externo** (`workspaceFactory: Shapefile`, `..\..\Shapefile`)
> y su tabla `BASE_MAESTRA$` a un **Excel externo**. El ETL resolvió el Shapefile
> (`Prueba.shp`, 17.179 puntos, EPSG:4326, UTF-8) y publicó los árboles. Campos de origen:
> `especie_no, nombre_cie, longitud_w, latitud_wg, dap_origin, altura_tot, altura_cop,
> sector, direccion, fuente_hoj`.

---

## 4. Sistema de imágenes botánicas (requisito obligatorio)

Prioridad de fuentes → **1)** usuario/admin · **2)** banco autorizado · **3)** fuente externa
con licencia · **4)** generación por IA. Garantía: *ninguna especie sin representación visual* y
**jamás** la imagen de otra especie.

- Implementado: gestión de imágenes por especie en el panel admin (URL + fuente/autor + licencia
  + fecha) y **lámina botánica SVG** generada de forma determinista por especie como respaldo.
- IA (capa preparada). Prompt interno, usando el **nombre científico**:

  > "Fotografía botánica realista de un ejemplar adulto de *{nombre_cientifico}*, árbol completo
  > visible, copa natural, tronco y follaje identificables, fondo neutro, iluminación natural,
  > alta resolución, representación científicamente coherente."

  Nunca genera una especie aleatoria. La imagen resultante se etiqueta como generada por IA y se
  guarda con su origen.

---

## 5. API REST (para web y futuras apps móviles)

```
GET  /api/trees?bbox=&especie=&sector=&limit=&cursor=   # paginado / espacial
GET  /api/trees/:id
GET  /api/species
GET  /api/species/:id
GET  /api/map?z=&x=&y=            # teselas vectoriales (MVT) para gran escala
POST /api/import                 # asistente de importación (auth: gis|admin)
POST /api/reports                # reporte ciudadano (público)
GET  /api/statistics             # indicadores del panel
POST /api/species/:id/image      # subir/asignar imagen (auth: editor+)
```

Respuestas GeoJSON para lo espacial; JSON para el resto. Versionado `/api/v1`.

---

## 6. Escalabilidad (1K → 1M árboles)

- **Teselas vectoriales (MVT)** servidas por PostGIS (`ST_AsMVT`) para no cargar todo en el cliente.
- **Clustering** en cliente (actual) y **agregación por servidor** a escala.
- Índices **GiST** espaciales; consultas por `bbox`.
- **Paginación** por cursor, **lazy loading**, **debouncing** en filtros/búsqueda, **cache** HTTP.
- Carga progresiva del GeoJSON; en producción, sustituir por MVT + `/api/trees?bbox`.

---

## 7. Seguridad

Autenticación con hash de contraseñas + JWT; **autorización por rol**
(admin, técnico GIS, editor, consulta, público); validación y límite de tamaño de archivos;
sanitización; protección de endpoints; protección contra uploads maliciosos; logs y **auditoría**
con borrado lógico. Regla: *nunca confiar en datos enviados desde el navegador* — toda validación
se repite en servidor.

---

## 8. IA como capa futura

- **Identificación por fotografía**: el usuario sube una foto → modelo propone especie → muestra
  **porcentaje de confianza** (nunca certeza).
- **Diagnóstico visual preliminar** (hojas, tronco, copa, daños): siempre etiquetado como
  *"Evaluación preliminar mediante IA"*, nunca como diagnóstico definitivo.

---

## 9. Mapeo del encargo (49 secciones)

| # | Sección | Estado |
|--|--|--|
| 1 | Objetivo general | ✅ |
| 2 | Archivos de entrada | ✅ navegador (GeoJSON/CSV/JSON) · ⚙️ resto en servidor |
| 3 | Soporte `.aprx` | ⚙️ Shapefile del proyecto resuelto; genérico en servidor (documentado) |
| 4 | Procesamiento automático | ✅ pantalla "Analizando…" con indicadores |
| 5 | Normalización de columnas | ✅ mapeo inteligente con sinónimos |
| 6 | Base de datos | 📐 esquema PostGIS (§2) |
| 7 | Mapa WebGIS | ✅ zoom/pan/capas/satélite/topo/cluster/heat/geoloc |
| 8 | Ficha del árbol | ✅ |
| 9 | Imagen por especie | ✅ (lámina generada + asignación) |
| 10 | Biblioteca botánica | ✅ panel admin |
| 11 | Imagen por IA | 📐 prompt y flujo definidos (§4) |
| 12 | Catálogo de especies | ✅ |
| 13 | Página de especie | ✅ + mapa de distribución |
| 14 | Buscador inteligente | ✅ (⌘/Ctrl+K) |
| 15 | Filtros del mapa | ✅ tiempo real |
| 16 | Dashboard | ✅ KPIs + 6 gráficos |
| 17 | Experiencia ciudadana | ✅ home + vista simple |
| 18 | Vista administrativa `/admin` | ✅ login + roles + gestión |
| 19 | Importación 5 pasos | ✅ |
| 20 | Validación geográfica | ✅ |
| 21 | Duplicados | ✅ detección por coordenada (marcado en ficha) |
| 22 | Ficha visual moderna | ✅ |
| 23 | Reportes ciudadanos | ✅ (pendiente de revisión) |
| 24 | Compartir + QR | ✅ URL única `/arbol/:id` + QR |
| 25 | Diseño visual | ✅ tarjetas, sombras, microanimaciones, skeletons |
| 26 | Tecnología | ✅ (variante sin build; migrable a Next.js) |
| 27 | Rendimiento | ✅ cluster/debounce/lazy · 📐 MVT a escala |
| 28 | Seguridad | 📐 (§7) · demo local etiquetada |
| 29 | API | 📐 (§5) |
| 30 | IA futura | 📐 (§8) |
| 31 | Mapa de calor | ✅ |
| 32 | Capas | ✅ administrador de capas |
| 33 | Exportación | 📐 (endpoint documentado) |
| 34 | URL pública / rutas | ✅ |
| 35 | Responsive | ✅ |
| 36 | Accesibilidad | ✅ WCAG |
| 37 | Datos y trazabilidad | ✅ `meta.json` + 📐 auditoría |
| 38 | Pantalla principal | ✅ |
| 39 | Inteligencia en el mapa | ✅ "en esta vista N árboles / M especies" |
| 40 | Imágenes obligatorias | ✅ siempre hay representación |
| 41 | Calidad de datos | ✅ índice 91 % + recomendaciones |
| 42 | No inventar datos | ✅ todo proviene del catastro real |
| 43 | Entregables | ✅ front + ETL + datos + docs + README + .env |
| 44 | Despliegue | ✅ Vercel/estático |
| 45 | Superar al sitio de referencia | ✅ UX/diseño/velocidad/catálogo |
| 46 | Flujo principal | ✅ subir→analizar→…→visualizar |
| 47 | Resultado final | ✅ producto usable, no demo |
| 48 | Regla de desarrollo | ✅ arquitectura antes de código; datos reales |
| 49 | Criterio de éxito | ✅ escenario de prueba cubierto |

Leyenda: ✅ funcional en esta entrega · ⚙️ parcial (parte en servidor) · 📐 diseñado/documentado.

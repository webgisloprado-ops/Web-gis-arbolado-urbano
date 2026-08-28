# 🌳 Sistema Inteligente de Arbolado Urbano

Plataforma **WebGIS** de gestión, análisis y consulta ciudadana del arbolado urbano.
Cada árbol georreferenciado, con su especie, su ficha botánica y su ubicación exacta —
del ciudadano curioso al equipo técnico municipal.

> **Datos reales.** La plataforma se entrega cargada con un catastro municipal real de
> **17.179 árboles** y **153 especies** (oeste de Santiago, Chile), procesado desde un
> proyecto **ArcGIS Pro** (`Prueba.aprx`). No se inventan especies, coordenadas ni atributos.

---

## ✨ Qué incluye

| Módulo | Estado | Descripción |
|---|---|---|
| **Mapa WebGIS** | ✅ Funcional | Leaflet + clustering + mapa de calor, 4 capas base, geolocalización, inteligencia de zona. |
| **Ficha del árbol** | ✅ Funcional | Ficha individual con atributos, imagen de especie, mapa, URL única y **código QR**. |
| **Catálogo de especies** | ✅ Funcional | 134 especies identificadas con nombre científico, familia, origen y descripción botánica real. |
| **Página de especie** | ✅ Funcional | Ficha visual + mapa "dónde se encuentra esta especie" + distribución por sector. |
| **Buscador global** | ✅ Funcional | Por especie, científico, familia, código o dirección (⌘/Ctrl + K). |
| **Filtros del mapa** | ✅ Funcional | Especie, sector, altura, diámetro, nativas/identificadas — en tiempo real. |
| **Panel / Dashboard** | ✅ Funcional | KPIs, gráficos interactivos y **índice de calidad del inventario** (91 %). |
| **Asistente de importación** | ✅ Funcional | 5 pasos: subir → analizar → mapear columnas → validar → importar (GeoJSON/CSV en el navegador). |
| **Panel administrativo** | ✅ Funcional | Login por rol, gestión de árboles, biblioteca de imágenes, reportes, capas, usuarios. |
| **Reportes ciudadanos** | ✅ Funcional | "Reportar problema" desde cada árbol; quedan pendientes de revisión. |
| **Responsive + accesible** | ✅ Funcional | Escritorio, tablet y móvil; tema claro/oscuro; navegación por teclado; WCAG. |
| **Procesamiento de `.aprx`** | ⚙️ Parcial | Se resolvió la fuente Shapefile del proyecto real. El procesamiento genérico en línea requiere backend (ver `docs/ARQUITECTURA.md`). |
| **Base de datos PostGIS / API / IA** | 📐 Diseñado | Esquema, endpoints y capa de IA documentados en `docs/ARQUITECTURA.md` para la fase de backend. |

Ver el mapeo completo de las 49 secciones del encargo en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

---

## 🚀 Puesta en marcha

Requisito: **Node.js 18+** (solo para el servidor local; la app es 100 % estática).

```bash
npm start
```

Abre **http://localhost:5173**. No hay paso de compilación ni dependencias que instalar.

> El sitio necesita servirse por HTTP (no abrir `index.html` con doble clic), porque
> carga los datos con `fetch`. El comando anterior levanta un servidor mínimo incluido.

### Regenerar los datos desde el Shapefile / .aprx

Los datos que consume la web se generan desde el Shapefile real referenciado por el `.aprx`:

```bash
npm run datos
# o con una carpeta de Shapefile propia:
node scripts/generar-datos.mjs "C:/ruta/a/mi/Shapefile"
```

Esto produce en `public/data/`: `trees.geojson`, `species.json`, `stats.json` y `meta.json`.

---

## 🗂️ Estructura del proyecto

```
├── index.html                 # shell de la aplicación (SPA)
├── server.mjs                 # servidor estático local (sin dependencias)
├── vercel.json                # configuración de despliegue
├── assets/
│   ├── css/styles.css         # sistema de diseño (claro/oscuro, responsive)
│   └── js/
│       ├── app.js             # router + shell (tema, menú, buscador)
│       ├── data.js            # carga, índice, búsqueda, filtros, importación
│       ├── map.js             # gestor de mapa Leaflet (cluster/heat/capas)
│       ├── ui.js              # componentes (ficha, tarjeta, imagen)
│       ├── util.js            # utilidades + lámina botánica + QR
│       └── pages/             # una vista por archivo
├── public/data/               # datos generados (GeoJSON + JSON)
├── scripts/
│   ├── generar-datos.mjs      # ETL: Shapefile/.aprx → datos de la web
│   └── botanica.mjs           # referencia botánica real de las especies
└── docs/ARQUITECTURA.md       # arquitectura, esquema PostGIS, API, IA
```

---

## 🌐 Despliegue (Vercel)

Es un sitio estático: se despliega tal cual.

```bash
# opción 1: CLI
npx vercel --prod

# opción 2: conectar el repositorio en vercel.com (sin build command)
```

`vercel.json` ya incluye `cleanUrls` y cabeceras de caché para `public/data`.
Cualquier hosting estático (Netlify, GitHub Pages, S3+CloudFront) funciona igual.

---

## 🖼️ Sistema de imágenes de especies

Cumple la **prioridad de fuentes** del encargo sin arriesgar mostrar una especie por otra:

1. **Imagen del usuario/administrador** — se asigna en `Admin → Especies e imágenes`, guardando
   URL, fuente/autor, licencia y fecha (`localStorage` en esta versión, base de datos en producción).
2. **Fotografía real de Wikimedia Commons** — obtenida por **nombre científico** con el script
   `npm run imagenes`. Cada foto se valida exigiendo que el **epíteto específico** aparezca en el
   artículo de origen, de modo que **nunca** se asigna la imagen de otra especie. Se guarda la
   URL, el **autor** y la **licencia** (CC/dominio público) y se muestran como atribución.
   > La gran mayoría de especies (y de individuos) del catastro ya tienen su fotografía real.
   > Las de nivel de género (p. ej. *Acer sp.*), al ser ambiguas, muestran la lámina generada.
3. **Lámina botánica generada** — SVG determinista y distinto por especie (esquemático, **no**
   fotográfico), respaldo que garantiza que *ninguna especie aparezca sin representación visual*.
4. **Generación por IA** — descrita como capa futura; usa el **nombre científico** como
   referencia y se etiqueta claramente (`docs/ARQUITECTURA.md`).

Regenerar las fotografías (por nombre científico, desde Wikimedia Commons):

```bash
npm run imagenes
```

---

## ☁️ Base de datos: Firebase (Firestore + Auth + Storage)

La plataforma usa **Firebase** como backend, con una arquitectura de **snapshot** que
mantiene la vista pública rápida y barata aunque el catastro crezca:

- **Firestore = fuente de la verdad**: árboles, especies, reportes, usuarios y auditoría.
  Cada cambio queda con **trazabilidad** (quién y cuándo) y el borrado es **lógico**
  (recuperable, nunca físico).
- **Vista pública = snapshot publicado**: el mapa, el catálogo y las estadísticas leen un
  archivo publicado en Storage (`/publico/*.json`), no 17.000 documentos por visita.
- **Panel admin** (`#/admin`): login seguro (Firebase Auth) con **roles**
  (admin · técnico GIS · editor · consulta), CRUD de árboles y especies, gestión de
  imágenes, revisión de reportes ciudadanos, auditoría y botón **Publicar snapshot**.
- **Importación masiva**: el asistente guarda miles de árboles en Firestore por **lotes**
  (sin trabar el navegador), con barra de progreso.

> **Sin configurar Firebase la web sigue funcionando** con los datos estáticos de
> `public/data/` (modo demostración, claramente etiquetado). Firebase se activa al crear
> `assets/js/firebase-config.js`.

👉 **Guía de conexión paso a paso: [`docs/FIREBASE.md`](docs/FIREBASE.md)** — crear el
proyecto, migrar los datos (`npm run seed`) y desplegar las reglas de seguridad.

## ⚠️ Honestidad técnica

Lo que **no** está en línea en esta versión (y por qué), con su solución documentada:

- **Procesamiento genérico de `.aprx`/`.gpkg` en línea** → requiere GDAL/ogr2ogr en servidor; el
  asistente lo explica y no simula que funciona.
- **Generación de imágenes por IA** → requiere una clave de proveedor; se deja como capa preparada.
- **Alternativa PostgreSQL + PostGIS** → sigue documentada en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md)
  como camino de migración equivalente al de Firebase.

Cuando existe una limitación, se muestra explícitamente en la interfaz en vez de ocultarla.

---

## 📄 Licencia

MIT. Datos de arbolado: catastro municipal (fuente del proyecto `Prueba.aprx`).

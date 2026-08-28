# Conectar Firebase — guía paso a paso

Esta guía lleva el proyecto de **datos estáticos** a **Firestore + Auth + Storage**,
manteniendo la vista pública rápida mediante un *snapshot* publicado.

> Mientras no completes estos pasos, la web **sigue funcionando** con los datos
> estáticos de `public/data/`. Firebase se activa solo cuando existe
> `assets/js/firebase-config.js` con credenciales válidas.

---

## Arquitectura (por qué un "snapshot")

```
                 ┌───────────────────────────┐
  Vista pública ─┤ lee el SNAPSHOT publicado  │←── rápido y barato
   (mapa, fichas)│ (Storage /publico/*.json)  │    (no lee 17.000 docs)
                 └─────────────▲─────────────┘
                               │ "Publicar snapshot"
                 ┌─────────────┴─────────────┐
  Panel admin ──▶│ FIRESTORE = fuente verdad │←── CRUD en vivo, trazabilidad,
   (login, CRUD) │ arboles · especies · …    │    borrado lógico, auditoría
                 └───────────────────────────┘
```

Leer los 17.179 árboles desde Firestore en cada visita costaría ~17.000 lecturas
por usuario (el plan gratuito son 50.000/día). Por eso la vista pública lee un
archivo publicado y el admin **publica** cuando termina de editar.

---

## 1. Crear el proyecto

1. Entra en <https://console.firebase.google.com> e inicia sesión.
2. **Agregar proyecto** → nombre (p. ej. `arbolado-urbano`) → crear.
3. En **Compilación** activa los tres servicios:
   - **Firestore Database** → *Crear base de datos* → modo **producción** → una región (p. ej. `southamerica-east1`).
   - **Authentication** → *Comenzar* → habilita **Correo electrónico/contraseña**.
   - **Storage** → *Comenzar* → acepta las reglas por defecto (las reemplazaremos).

## 2. Registrar la app web y pegar la configuración

1. En **Configuración del proyecto** (rueda dentada) → *Tus apps* → icono **web (`</>`)**.
2. Registra la app (sin Hosting) y copia el objeto `firebaseConfig`.
3. Copia el archivo de ejemplo y pega tus valores:

   ```bash
   cp assets/js/firebase-config.example.js assets/js/firebase-config.js
   ```

   ```js
   // assets/js/firebase-config.js
   export const firebaseConfig = {
     apiKey: "…", authDomain: "TU_PROYECTO.firebaseapp.com",
     projectId: "TU_PROYECTO", storageBucket: "TU_PROYECTO.appspot.com",
     messagingSenderId: "…", appId: "…",
   };
   export const ADMINS = ["tucorreo@gmail.com"]; // respaldo si aún no hay rol en Firestore
   ```

   > Estas claves son **de cliente**: viajan al navegador y **no** son secretas.
   > La seguridad la dan las reglas y Auth. `firebase-config.js` sí se sube al repo.

## 3. Crear el usuario administrador

1. **Authentication** → *Users* → **Agregar usuario** → tu correo y una contraseña.
2. Ese correo será tu acceso al panel `#/admin`.

## 4. Migrar los datos y asignar el rol

Necesitas una **clave de cuenta de servicio** (solo para la migración, en tu PC):

1. **Configuración del proyecto** → *Cuentas de servicio* → **Generar nueva clave privada**.
2. Guarda el archivo como `serviceAccount.json` en la raíz del proyecto
   (ya está en `.gitignore`; **no lo subas**).
3. Instala la dependencia y corre la migración:

   ```bash
   npm install firebase-admin
   npm run seed -- --admin-email tucorreo@gmail.com
   ```

   Esto:
   - carga **especies** y **17.179 árboles** en Firestore (con trazabilidad),
   - marca tu usuario como **administrador** (`usuarios/{uid}.rol = "admin"`),
   - sube el **snapshot inicial** a Storage para que la vista pública funcione ya.

## 5. Desplegar las reglas de seguridad

```bash
npm install -g firebase-tools     # una sola vez
firebase login
firebase use --add                # elige tu proyecto
npm run deploy:rules              # despliega firestore.rules y storage.rules
```

## 6. Probar

```bash
npm start          # http://localhost:5173
```

- La vista pública debe cargar desde el snapshot (Storage).
- En `#/admin` inicia sesión con tu correo/contraseña de Authentication.
- Prueba: crear/editar/borrar un árbol → **Resumen → Publicar snapshot** → verlo en el mapa.

---

## Roles

Se guardan en `usuarios/{uid}.rol`:

| Rol | Permisos |
|---|---|
| `admin` | Todo, incluida la gestión de usuarios y la publicación. |
| `gis` | Importar y editar árboles/especies; publicar snapshot. |
| `editor` | Editar registros (sin publicar). |
| `consulta` | Solo lectura. |

Para dar acceso a otra persona: créala en **Authentication** y añade su documento
en **Firestore → `usuarios/{uid}`** con el campo `rol`.

## Seguridad y trazabilidad

- **Borrado lógico**: nada se borra físicamente; se marca `eliminado: true` y sale
  del snapshot. Las reglas prohíben `delete`.
- **Trazabilidad**: cada escritura sella `creadoPor/creadoEn`, `modificadoPor/modificadoEn`,
  `version`, y agrega una entrada en la colección **`auditoria`** (inmutable).
- **Reportes ciudadanos**: cualquiera crea uno *pendiente*; solo roles con permiso
  lo aprueban/rechazan.

## Republicar el snapshot sin editar

```bash
npm run seed -- --solo-snapshot
```

O desde el panel: **Admin → Resumen → Publicar snapshot**.

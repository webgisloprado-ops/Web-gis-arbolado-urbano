// ============================================================================
// firebase-config.example.js
// ----------------------------------------------------------------------------
// 1) Copia este archivo como  assets/js/firebase-config.js
// 2) Pega los valores de TU proyecto Firebase (Configuración del proyecto →
//    Tus apps → app web → SDK setup and configuration → Config).
// 3) Como el sitio es estático (sin build) y se despliega en Vercel, el archivo
//    firebase-config.js SÍ se incluye en el repositorio: estas claves son
//    "de cliente" y viajan al navegador de todos modos. NO son secretas: la
//    seguridad real la dan las reglas de Firestore/Storage y Firebase Auth.
// ============================================================================
export const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "0000000000",
  appId: "1:0000000000:web:xxxxxxxxxxxx",
};

// Email del/los administrador(es) autorizados a escribir (se validan además
// con Firebase Auth). Deja el array vacío para permitir cualquier usuario
// autenticado que crees en la consola.
export const ADMINS = [
  // "tucorreo@gmail.com",
];

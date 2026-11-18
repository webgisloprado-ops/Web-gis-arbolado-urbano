// ============================================================================
// firebase-config.js — proyecto Firebase "Web-gis-arbolado-urbano"
// ----------------------------------------------------------------------------
// Estas claves son "de cliente": viajan al navegador de todos modos y NO son
// secretas. La seguridad real la dan las reglas de Firestore/Storage y
// Firebase Auth (ver firestore.rules y storage.rules).
// ============================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyBjqYXVJa4GAlXJ3T4ek_q2pCp4-mEHY7A",
  authDomain: "web-gis-arbolado-urbano.firebaseapp.com",
  projectId: "web-gis-arbolado-urbano",
  storageBucket: "web-gis-arbolado-urbano.firebasestorage.app",
  messagingSenderId: "381605737439",
  appId: "1:381605737439:web:77639562a77e3f642d0a6a",
};

// Correos autorizados a entrar al panel administrativo. Los permisos de
// escritura los decide además el rol guardado en Firestore (usuarios/{uid}).
export const ADMINS = [
  "webgisloprado@gmail.com",
];

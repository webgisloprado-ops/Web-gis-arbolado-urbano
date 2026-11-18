// ============================================================================
// firebase-config.js — proyecto Firebase "Web-gis-arbolado-urbano"
// ----------------------------------------------------------------------------
// Estas claves son "de cliente": viajan al navegador de todos modos y NO son
// secretas. La seguridad real la dan las reglas de Firestore (firestore.rules)
// y Firebase Auth.
// ============================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyBjqYXVJa4GAlXJ3T4ek_q2pCp4-mEHY7A",
  authDomain: "web-gis-arbolado-urbano.firebaseapp.com",
  projectId: "web-gis-arbolado-urbano",
  storageBucket: "web-gis-arbolado-urbano.firebasestorage.app",
  messagingSenderId: "381605737439",
  appId: "1:381605737439:web:77639562a77e3f642d0a6a",
};

// Superadministradores iniciales: en su primer ingreso se les crea (o eleva)
// el rol "superadmin". Las reglas de Firestore lo permiten solo a sus uid
// (firestore.rules → esAdminInicial). El resto de usuarios los crea un
// superadministrador desde Admin → Usuarios.
export const ADMINS = [
  "xavixaviel47@gmail.com",
];

// ============================================================================
// firebase.js — inicialización de Firebase (Firestore + Auth, plan gratuito)
// ----------------------------------------------------------------------------
// Carga el SDK modular de Firebase desde el CDN oficial (gstatic) y lo inicia
// con la configuración de assets/js/firebase-config.js. Si no hay
// configuración, la app sigue funcionando en modo estático (fallback).
//
// Perfiles (usuarios/{uid}): rol superadmin | admin | gis | editor | consulta,
// estado activo | inactivo | eliminado, debeCambiarPassword (primer ingreso).
// ============================================================================

const SDK = 'https://www.gstatic.com/firebasejs/10.12.5';
let _ready = null;

export function isConfigured(cfg) {
  return !!(cfg && cfg.apiKey && !/^TU_/.test(cfg.apiKey) && cfg.projectId);
}

// Devuelve { configured, app, db, auth, cfg, firestore, authApi } o { configured:false }.
export function initFirebase() {
  if (_ready) return _ready;
  _ready = (async () => {
    let cfg = null, admins = [];
    // Se comprueba primero con fetch (silencioso) para no ensuciar la consola
    // cuando firebase-config.js aún no existe (el servidor devuelve index.html).
    const cfgUrl = new URL('./firebase-config.js', import.meta.url).href;
    try {
      const res = await fetch(cfgUrl, { cache: 'no-store' });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !/javascript|ecmascript/i.test(ct)) return { configured: false, reason: 'sin-config' };
      const mod = await import(cfgUrl);
      cfg = mod.firebaseConfig; admins = mod.ADMINS || [];
    } catch {
      return { configured: false, reason: 'sin-config' };
    }
    if (!isConfigured(cfg)) return { configured: false, reason: 'config-incompleta' };

    try {
      const [appApi, firestore, auth] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-firestore.js`),
        import(`${SDK}/firebase-auth.js`),
      ]);
      const app = appApi.initializeApp(cfg);
      const db = firestore.getFirestore(app);
      const authInst = auth.getAuth(app);
      authInst.languageCode = 'es';
      return {
        configured: true,
        app, db, auth: authInst, admins, cfg, appApi,
        fb: { ...firestore, ...auth },
        firestore, authApi: auth,
      };
    } catch (e) {
      console.error('Firebase init error:', e);
      return { configured: false, reason: 'error-sdk', error: e.message };
    }
  })();
  return _ready;
}

// Estado de autenticación (resuelve el usuario actual o null).
export async function currentUser() {
  const f = await initFirebase();
  if (!f.configured) return null;
  return new Promise(res => {
    const unsub = f.authApi.onAuthStateChanged(f.auth, u => { unsub(); res(u); });
  });
}

// Documento de perfil usuarios/{uid} (o null si no existe / sin permiso).
export async function getPerfil(user) {
  if (!user) return null;
  const f = await initFirebase();
  if (!f.configured) return null;
  try {
    const { doc, getDoc } = f.firestore;
    const s = await getDoc(doc(f.db, 'usuarios', user.uid));
    return s.exists() ? { uid: user.uid, ...s.data() } : null;
  } catch { return null; }
}

// Rol efectivo: solo cuenta si el perfil está activo.
export async function getUserRole(user) {
  const p = await getPerfil(user);
  if (!p || (p.estado && p.estado !== 'activo')) return null;
  return p.rol || null;
}

const esInicial = (f, email) => f.admins.map(a => a.toLowerCase()).includes((email || '').toLowerCase());

export async function login(email, password) {
  const f = await initFirebase();
  if (!f.configured) throw new Error('Firebase no está configurado.');
  const cred = await f.authApi.signInWithEmailAndPassword(f.auth, email, password);
  let perfil = await getPerfil(cred.user);

  // Superadministrador inicial (lista ADMINS): crea o eleva su perfil. Las
  // reglas de Firestore solo lo permiten a los uid de esAdminInicial.
  if (esInicial(f, cred.user.email) && (!perfil || perfil.rol !== 'superadmin')) {
    try {
      const { doc, setDoc, serverTimestamp } = f.firestore;
      await setDoc(doc(f.db, 'usuarios', cred.user.uid), {
        rol: 'superadmin', email: cred.user.email, nombre: perfil?.nombre || cred.user.email,
        estado: 'activo', debeCambiarPassword: false, creadoEn: perfil?.creadoEn || serverTimestamp(),
      });
      perfil = await getPerfil(cred.user);
    } catch (e) { console.warn('No se pudo asignar el rol de superadministrador:', e.message); }
  }

  if (!perfil || !perfil.rol) {
    await f.authApi.signOut(f.auth);
    throw new Error('Esta cuenta no tiene un perfil asignado. Pide a un superadministrador que te dé acceso.');
  }
  if (perfil.estado && perfil.estado !== 'activo') {
    await f.authApi.signOut(f.auth);
    throw new Error('Esta cuenta está desactivada. Contacta a un superadministrador.');
  }
  return { user: cred.user, rol: perfil.rol, perfil };
}

export async function logout() {
  const f = await initFirebase();
  if (f.configured) await f.authApi.signOut(f.auth);
}

// Cambia la contraseña del usuario actual (pide la actual para reautenticar)
// y marca el perfil como "ya no debe cambiar la contraseña".
export async function cambiarPassword(actual, nueva) {
  const f = await initFirebase();
  const user = f.auth.currentUser;
  if (!user) throw new Error('No hay sesión iniciada.');
  if (!nueva || nueva.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
  if (nueva === actual) throw new Error('La nueva contraseña debe ser distinta de la actual.');
  const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = f.authApi;
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, actual));
  await updatePassword(user, nueva);
  try {
    const { doc, updateDoc, serverTimestamp } = f.firestore;
    await updateDoc(doc(f.db, 'usuarios', user.uid), { debeCambiarPassword: false, passwordCambiadoEn: serverTimestamp() });
  } catch (e) { console.warn('No se pudo actualizar el perfil:', e.message); }
}

// Crea una cuenta de Authentication SIN cerrar la sesión del superadmin
// (usa una instancia secundaria de la app). Devuelve el uid.
export async function crearCuentaAuth(email, password) {
  const f = await initFirebase();
  const nombreApp = 'alta-usuarios';
  const sec = f.appApi.getApps().find(a => a.name === nombreApp) || f.appApi.initializeApp(f.cfg, nombreApp);
  const secAuth = f.authApi.getAuth(sec);
  try {
    const cred = await f.authApi.createUserWithEmailAndPassword(secAuth, email, password);
    return cred.user.uid;
  } finally {
    try { await f.authApi.signOut(secAuth); } catch { /* */ }
  }
}

// Envía el correo de restablecimiento de contraseña de Firebase.
export async function enviarResetPassword(email) {
  const f = await initFirebase();
  await f.authApi.sendPasswordResetEmail(f.auth, email);
}

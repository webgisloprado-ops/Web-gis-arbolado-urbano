// ============================================================================
// firebase.js — inicialización de Firebase (Firestore + Auth + Storage)
// ----------------------------------------------------------------------------
// Carga el SDK modular de Firebase desde el CDN oficial (gstatic) y lo inicia
// con la configuración de assets/js/firebase-config.js (que crea el usuario a
// partir de firebase-config.example.js). Si no hay configuración, la app sigue
// funcionando en modo estático (fallback) y el panel avisa cómo conectarla.
// ============================================================================

const SDK = 'https://www.gstatic.com/firebasejs/10.12.5';
let _ready = null;

export function isConfigured(cfg) {
  return !!(cfg && cfg.apiKey && !/^TU_/.test(cfg.apiKey) && cfg.projectId);
}

// Devuelve { configured, app, db, auth, storage, fb } o { configured:false }.
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
      // Plan gratuito (Spark): solo Firestore + Auth. Las imágenes y el snapshot
      // público también se guardan en Firestore (no se usa Cloud Storage).
      const [{ initializeApp }, firestore, auth] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-firestore.js`),
        import(`${SDK}/firebase-auth.js`),
      ]);
      const app = initializeApp(cfg);
      const db = firestore.getFirestore(app);
      const authInst = auth.getAuth(app);
      return {
        configured: true,
        app, db, auth: authInst, admins,
        fb: { ...firestore, ...auth }, // API modular reunida
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

export async function login(email, password) {
  const f = await initFirebase();
  if (!f.configured) throw new Error('Firebase no está configurado.');
  const cred = await f.authApi.signInWithEmailAndPassword(f.auth, email, password);
  let rol = await getUserRole(cred.user, { soloFirestore: true });
  const emailOk = !f.admins.length || f.admins.map(a => a.toLowerCase()).includes((cred.user.email || '').toLowerCase());
  // Primer ingreso de un administrador de la lista ADMINS: crea su documento de
  // rol en usuarios/{uid}. Las reglas de Firestore solo lo permiten a los uid
  // autorizados (ver firestore.rules → ADMIN_UIDS).
  if (!rol && emailOk) {
    try {
      const { doc, setDoc, serverTimestamp } = f.firestore;
      await setDoc(doc(f.db, 'usuarios', cred.user.uid), {
        rol: 'admin', email: cred.user.email, nombre: cred.user.email,
        estado: 'activo', creadoEn: serverTimestamp(),
      });
      rol = 'admin';
    } catch (e) { console.warn('No se pudo crear el documento de rol:', e.message); }
  }
  // Autorizado si está en la lista ADMINS o tiene un rol con permiso de escritura.
  const rolOk = ['admin', 'gis', 'editor'].includes(rol);
  if (!emailOk && !rolOk) {
    await f.authApi.signOut(f.auth);
    throw new Error('Esta cuenta no está autorizada para el panel administrativo.');
  }
  return { user: cred.user, rol: rol || (emailOk ? 'admin' : 'consulta') };
}

// Rol del usuario, leído de usuarios/{uid} en Firestore (admin|gis|editor|consulta).
export async function getUserRole(user, { soloFirestore = false } = {}) {
  if (!user) return null;
  const f = await initFirebase();
  if (!f.configured) return null;
  try {
    const { doc, getDoc } = f.firestore;
    const s = await getDoc(doc(f.db, 'usuarios', user.uid));
    if (s.exists()) return s.data().rol || 'consulta';
  } catch { /* sin doc de rol → se decide por la lista ADMINS */ }
  if (soloFirestore) return null;
  const inList = f.admins.map(a => a.toLowerCase()).includes((user.email || '').toLowerCase());
  return inList ? 'admin' : null;
}

export async function logout() {
  const f = await initFirebase();
  if (f.configured) await f.authApi.signOut(f.auth);
}

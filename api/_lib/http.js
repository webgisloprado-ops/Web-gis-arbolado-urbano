// Helpers HTTP compartidos por las funciones serverless.
export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
export const ok = (res, body = {}) => send(res, 200, body);
export const bad = (res, msg, status = 400) => send(res, status, { error: msg });

// Cuerpo JSON de la petición (Vercel suele parsearlo en req.body; si no, se lee del stream).
export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise(resolve => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// Comprueba el método permitido; responde 405 si no coincide.
export function method(req, res, allowed) {
  const list = [].concat(allowed);
  if (!list.includes(req.method)) { send(res, 405, { error: `Método no permitido. Usa ${list.join(', ')}.` }); return false; }
  return true;
}

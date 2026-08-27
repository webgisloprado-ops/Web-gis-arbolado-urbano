// Servidor estático mínimo sin dependencias — para uso local.
// Uso: node server.mjs   (abre el navegador automáticamente)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;
const URL = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// Abre el navegador por defecto (Windows / macOS / Linux).
function abrirNavegador(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.join(__dirname, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) {
      // Fallback SPA (rutas con #): siempre servimos index.html
      fs.readFile(path.join(__dirname, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(html);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  ✅ La página ya está en marcha. Abriendo ${URL} …\n`);
    abrirNavegador(URL);
    process.exit(0);
  } else {
    console.error(e);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`\n  🌳 Sistema Inteligente de Arbolado Urbano`);
  console.log(`  👉 Abriendo en el navegador: ${URL}`);
  console.log(`  ℹ️  Deja esta ventana abierta mientras usas la página.`);
  console.log(`     Para detener el servidor, cierra esta ventana o pulsa Ctrl + C.\n`);
  abrirNavegador(URL);
});

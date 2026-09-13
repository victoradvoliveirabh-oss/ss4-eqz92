// Servidor estático mínimo para abrir o app no PC e no tablet (mesma rede Wi-Fi).
// Uso: npm run servir  [-- --porta 8080]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--porta');
const PORTA = Number(i !== -1 ? process.argv[i + 1] : process.env.PORTA) || 8080;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
};

const servidor = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const alvo = path.join(RAIZ, path.normalize(rel).replace(/^[/\\]+/, ''));
  if (!alvo.startsWith(RAIZ)) { res.writeHead(403).end('403'); return; }
  fs.stat(alvo, (erro, st) => {
    if (erro || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Não encontrado'); return; }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(alvo).pipe(res);
  });
});

servidor.listen(PORTA, () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log(`App servindo ${RAIZ}`);
  console.log(`  neste PC:  http://localhost:${PORTA}`);
  for (const ip of ips) console.log(`  no tablet: http://${ip}:${PORTA}`);
  console.log('Ctrl+C para parar.');
});
